-- ============================================================
-- COMISSÃO DOS DENTISTAS (item 8)
-- Acrescenta: percentuais e mês inicial da comissão em professionals, a categoria de despesa
-- 'comissoes', a tabela commission_closings (fechamento mensal por dentista, com o
-- extrato congelado) e as funções que fecham, reabrem, pagam e desfazem o pagamento
-- de uma comissão (service role). O pagamento cria a despesa no livro-caixa.
-- Rode depois de supabase/2026-11-08-convenios-pagamentos.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Percentuais do dentista (nulo = sem comissão configurada) ──

ALTER TABLE professionals ADD COLUMN IF NOT EXISTS commission_rate           NUMERIC(5,2);
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS commission_rate_insurance NUMERIC(5,2);

ALTER TABLE professionals DROP CONSTRAINT IF EXISTS professionals_commission_rate_check;
ALTER TABLE professionals ADD CONSTRAINT professionals_commission_rate_check
  CHECK (commission_rate IS NULL OR commission_rate BETWEEN 0 AND 100);
ALTER TABLE professionals DROP CONSTRAINT IF EXISTS professionals_commission_rate_insurance_check;
ALTER TABLE professionals ADD CONSTRAINT professionals_commission_rate_insurance_check
  CHECK (commission_rate_insurance IS NULL OR commission_rate_insurance BETWEEN 0 AND 100);

-- Mês a partir do qual há comissão (dia 1). O que for anterior não entra no cálculo,
-- nem como ajuste; nulo = sem comissão. Dentista que já tem percentual começa no mês atual.
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS commission_start DATE;
ALTER TABLE professionals DROP CONSTRAINT IF EXISTS professionals_commission_start_check;
ALTER TABLE professionals ADD CONSTRAINT professionals_commission_start_check
  CHECK (commission_start IS NULL OR EXTRACT(DAY FROM commission_start) = 1);
UPDATE professionals
SET commission_start = date_trunc('month', (NOW() AT TIME ZONE 'America/Sao_Paulo'))::date
WHERE commission_rate IS NOT NULL AND commission_start IS NULL;

-- ── Categoria de despesa 'comissoes' ────────────────────────

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
  CHECK (category IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','comissoes','outras'));

-- ── Fechamento mensal da comissão ───────────────────────────

CREATE TABLE IF NOT EXISTS commission_closings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  period          DATE NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),  -- dia 1 do mês
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  statement       JSONB NOT NULL,  -- resumo e extrato congelados, com os percentuais usados
  status          TEXT NOT NULL DEFAULT 'fechado' CHECK (status IN ('fechado','pago')),
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at         DATE,
  payment_method  TEXT CHECK (payment_method IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto')),
  expense_id      UUID REFERENCES expenses(id) ON DELETE SET NULL,
  UNIQUE (clinic_id, professional_id, period)
);

CREATE INDEX IF NOT EXISTS commission_closings_clinic_period_idx ON commission_closings (clinic_id, period);

ALTER TABLE commission_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON commission_closings;
CREATE POLICY "clinic_member_select" ON commission_closings FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Fechar o mês de um dentista (service role) ──────────────
-- O valor vem do cálculo no servidor. Devolve o id do fechamento.
-- Erros: PERIODO_INVALIDO (não é dia 1), PROFISSIONAL_INVALIDO, MES_ABERTO (o mês
-- ainda não terminou em São Paulo), VALOR_INVALIDO (<= 0), FECHAMENTO_EXISTE,
-- FECHAMENTO_POSTERIOR (já há fechamento do dentista em mês posterior),
-- ANTES_DO_INICIO (dentista sem mês inicial ou mês anterior a ele).

CREATE OR REPLACE FUNCTION public.close_commission(
  p_clinic_id UUID, p_professional_id UUID, p_period DATE, p_amount NUMERIC, p_statement JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
  v_start DATE;
BEGIN
  IF p_period IS NULL OR EXTRACT(DAY FROM p_period) <> 1 THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_professional_id::text));

  SELECT commission_start INTO v_start FROM professionals WHERE id = p_professional_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFISSIONAL_INVALIDO'; END IF;
  IF (p_period + INTERVAL '1 month' - INTERVAL '1 day')::date >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'MES_ABERTO';
  END IF;
  IF v_start IS NULL OR p_period < v_start THEN RAISE EXCEPTION 'ANTES_DO_INICIO'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'VALOR_INVALIDO'; END IF;
  IF EXISTS (SELECT 1 FROM commission_closings
             WHERE clinic_id = p_clinic_id AND professional_id = p_professional_id AND period = p_period) THEN
    RAISE EXCEPTION 'FECHAMENTO_EXISTE';
  END IF;
  IF EXISTS (SELECT 1 FROM commission_closings
             WHERE clinic_id = p_clinic_id AND professional_id = p_professional_id AND period > p_period) THEN
    RAISE EXCEPTION 'FECHAMENTO_POSTERIOR';
  END IF;

  INSERT INTO commission_closings (clinic_id, professional_id, period, amount, statement)
  VALUES (p_clinic_id, p_professional_id, p_period, p_amount, p_statement)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ── Reabrir um mês fechado (service role) ───────────────────
-- Apaga o fechamento. Erros: FECHAMENTO_INVALIDO, FECHAMENTO_PAGO,
-- FECHAMENTO_POSTERIOR (há fechamento do dentista em mês posterior).

CREATE OR REPLACE FUNCTION public.reopen_commission(
  p_clinic_id UUID, p_closing_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_prof_id UUID;
  v_closing commission_closings%ROWTYPE;
BEGIN
  SELECT professional_id INTO v_prof_id FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_prof_id::text));

  SELECT * INTO v_closing FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;
  IF v_closing.status <> 'fechado' THEN RAISE EXCEPTION 'FECHAMENTO_PAGO'; END IF;
  IF EXISTS (SELECT 1 FROM commission_closings
             WHERE clinic_id = p_clinic_id AND professional_id = v_closing.professional_id
               AND period > v_closing.period) THEN
    RAISE EXCEPTION 'FECHAMENTO_POSTERIOR';
  END IF;

  DELETE FROM commission_closings WHERE id = p_closing_id AND clinic_id = p_clinic_id;
END;
$fn$;

-- ── Pagar a comissão (service role) ─────────────────────────
-- Cria a despesa paga no livro-caixa e liga ao fechamento. Devolve o id da despesa.
-- Forma de pagamento inválida → CHECK de expenses (23514).
-- Erros: FECHAMENTO_INVALIDO, FECHAMENTO_JA_PAGO.

CREATE OR REPLACE FUNCTION public.pay_commission(
  p_clinic_id UUID, p_closing_id UUID, p_paid_at DATE, p_method TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_prof_id UUID;
  v_closing commission_closings%ROWTYPE;
  v_name TEXT;
  v_expense_id UUID;
BEGIN
  SELECT professional_id INTO v_prof_id FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_prof_id::text));

  SELECT * INTO v_closing FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;
  IF v_closing.status <> 'fechado' THEN RAISE EXCEPTION 'FECHAMENTO_JA_PAGO'; END IF;

  SELECT name INTO v_name FROM professionals
  WHERE id = v_closing.professional_id AND clinic_id = p_clinic_id;

  INSERT INTO expenses (clinic_id, description, amount, category, deduction_group, payment_method,
                        professional_id, due_date, paid_at, status)
  VALUES (p_clinic_id,
          'Comissão — ' || COALESCE(v_name, '') || ' — ' || to_char(v_closing.period, 'MM/YYYY'),
          v_closing.amount, 'comissoes', 'custeio', p_method,
          v_closing.professional_id, p_paid_at,
          (p_paid_at::text || 'T12:00:00Z')::timestamptz, 'paid')
  RETURNING id INTO v_expense_id;

  UPDATE commission_closings
  SET status = 'pago', paid_at = p_paid_at, payment_method = p_method, expense_id = v_expense_id
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;

  RETURN v_expense_id;
END;
$fn$;

-- ── Desfazer o pagamento (service role) ─────────────────────
-- Apaga a despesa ligada e volta o fechamento a 'fechado'.
-- Erros: FECHAMENTO_INVALIDO, FECHAMENTO_NAO_PAGO.

CREATE OR REPLACE FUNCTION public.undo_commission_payment(
  p_clinic_id UUID, p_closing_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_prof_id UUID;
  v_closing commission_closings%ROWTYPE;
BEGIN
  SELECT professional_id INTO v_prof_id FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_prof_id::text));

  SELECT * INTO v_closing FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;
  IF v_closing.status <> 'pago' THEN RAISE EXCEPTION 'FECHAMENTO_NAO_PAGO'; END IF;

  UPDATE commission_closings
  SET status = 'fechado', paid_at = NULL, payment_method = NULL, expense_id = NULL
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;

  IF v_closing.expense_id IS NOT NULL THEN
    DELETE FROM expenses WHERE id = v_closing.expense_id AND clinic_id = p_clinic_id;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.close_commission(UUID, UUID, DATE, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_commission(UUID, UUID, DATE, NUMERIC, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.reopen_commission(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_commission(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.pay_commission(UUID, UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_commission(UUID, UUID, DATE, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.undo_commission_payment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_commission_payment(UUID, UUID) TO service_role;
