-- ============================================================
-- FLUXO DE CAIXA: SALDO INFORMADO E DESPESAS RECORRENTES
-- Acrescenta: as tabelas cash_balances (saldo informado pela clínica) e
-- expense_recurrences (despesas fixas que se repetem todo mês), as colunas
-- recurrence_id e recurrence_month em expenses (com o índice único
-- expenses_recurrence_month_uidx) e as funções generate_recurring_expenses,
-- create_expense_recurrence, update_expense_recurrence e end_expense_recurrence
-- (service role). No fim, um bloco comentado agenda a geração diária no pg_cron.
-- Rode depois de supabase/2026-11-10-kits.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Saldo informado ─────────────────────────────────────────
-- O saldo que vale é o de balance_date mais recente; no empate, o de created_at mais
-- recente. O valor pode ser negativo.

CREATE TABLE IF NOT EXISTS cash_balances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  balance_date DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_balances_clinic_date_idx
  ON cash_balances (clinic_id, balance_date DESC, created_at DESC);

ALTER TABLE cash_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON cash_balances;
CREATE POLICY "clinic_member" ON cash_balances FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Despesas recorrentes ────────────────────────────────────
-- start_month e end_month ficam sempre no dia 1 do mês; end_month nulo = sem fim.
-- generated_until: dia 1 do último mês já gerado (nulo = nada gerado ainda).

CREATE TABLE IF NOT EXISTS expense_recurrences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  category        TEXT NOT NULL DEFAULT 'outras'
                  CHECK (category IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','comissoes','outras')),
  deduction_group TEXT CHECK (deduction_group IN ('custeio','pessoal','emolumentos')),  -- NULL = não dedutível
  payment_method  TEXT CHECK (payment_method IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto')),
  day_of_month    INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  start_month     DATE NOT NULL CHECK (extract(day from start_month) = 1),
  end_month       DATE CHECK (end_month IS NULL OR extract(day from end_month) = 1),
  generated_until DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_month IS NULL OR end_month >= start_month)
);

CREATE INDEX IF NOT EXISTS expense_recurrences_clinic_idx ON expense_recurrences (clinic_id);

ALTER TABLE expense_recurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON expense_recurrences;
CREATE POLICY "clinic_member" ON expense_recurrences FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── expenses: colunas novas ─────────────────────────────────
-- recurrence_month: dia 1 do mês que a despesa representa. O índice único (não
-- parcial) serve ao ON CONFLICT da geração; despesas avulsas têm as duas colunas nulas
-- e não colidem (NULLs são distintos).

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence_id UUID
  REFERENCES expense_recurrences(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence_month DATE;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_recurrence_month_uidx
  ON expenses (recurrence_id, recurrence_month);

-- ── Gerar despesas recorrentes (service role) ───────────────
-- Para cada recorrência da clínica (travadas em ordem de id), gera os meses M desde
-- greatest(start_month, generated_until + 1 mês) até o mês atual de São Paulo + 5
-- meses, sem passar de end_month. Cada M vira uma despesa 'pending' com os dados da
-- recorrência e vencimento make_date(ano(M), mês(M), least(dia, último dia de M)).
-- generated_until avança até o último M do intervalo: uma despesa apagada não volta.
-- Devolve quantas despesas foram criadas.

CREATE OR REPLACE FUNCTION public.generate_recurring_expenses(
  p_clinic_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_mes_atual DATE := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_rec       expense_recurrences%ROWTYPE;
  v_inicio    DATE;
  v_fim       DATE;
  v_n         INTEGER;
  v_total     INTEGER := 0;
BEGIN
  FOR v_rec IN
    SELECT * FROM expense_recurrences
    WHERE clinic_id = p_clinic_id
    ORDER BY id
    FOR UPDATE
  LOOP
    v_inicio := greatest(v_rec.start_month,
                         coalesce((v_rec.generated_until + interval '1 month')::date, v_rec.start_month));
    v_fim := (v_mes_atual + interval '5 months')::date;
    IF v_rec.end_month IS NOT NULL AND v_rec.end_month < v_fim THEN
      v_fim := v_rec.end_month;
    END IF;

    CONTINUE WHEN v_inicio > v_fim;

    INSERT INTO expenses (clinic_id, description, amount, category, deduction_group,
                          payment_method, status, due_date, recurrence_id, recurrence_month)
    SELECT p_clinic_id, v_rec.description, v_rec.amount, v_rec.category, v_rec.deduction_group,
           v_rec.payment_method, 'pending',
           make_date(extract(year from m.mes)::int, extract(month from m.mes)::int,
                     least(v_rec.day_of_month,
                           extract(day from (m.mes + interval '1 month' - interval '1 day'))::int)),
           v_rec.id, m.mes
    FROM (
      SELECT g::date AS mes
      FROM generate_series(v_inicio::timestamp, v_fim::timestamp, interval '1 month') AS g
    ) AS m
    ON CONFLICT (recurrence_id, recurrence_month) DO NOTHING;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;

    UPDATE expense_recurrences
    SET generated_until = v_fim
    WHERE id = v_rec.id AND clinic_id = p_clinic_id;
  END LOOP;

  RETURN v_total;
END;
$fn$;

-- ── Criar recorrência (service role) ────────────────────────
-- p_data: {description, amount (reais), category, deduction_group, payment_method,
-- day_of_month, start_month 'YYYY-MM-01', end_month 'YYYY-MM-01' | null}.
-- Insere a recorrência e chama generate_recurring_expenses. Devolve o id.
-- Erros: VALOR_INVALIDO (ausente, ≤ 0 ou grande demais), DIA_INVALIDO (fora de 1 a 31),
-- PERIODO_INVALIDO (start_month ausente ou fora do formato, end_month < start_month),
-- DADOS_INVALIDOS (descrição vazia, categoria, grupo ou forma de pagamento inválidos).

CREATE OR REPLACE FUNCTION public.create_expense_recurrence(
  p_clinic_id UUID, p_data JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_desc   TEXT := btrim(coalesce(p_data->>'description', ''));
  v_amount NUMERIC;
  v_day    NUMERIC;
  v_cat    TEXT := p_data->>'category';
  v_group  TEXT := nullif(p_data->>'deduction_group', '');
  v_method TEXT := nullif(p_data->>'payment_method', '');
  v_start  DATE;
  v_end    DATE;
  v_id     UUID;
BEGIN
  IF jsonb_typeof(p_data->'amount') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'VALOR_INVALIDO'; END IF;
  v_amount := round((p_data->>'amount')::numeric, 2);
  IF v_amount <= 0 OR v_amount >= 100000000
  THEN RAISE EXCEPTION 'VALOR_INVALIDO'; END IF;

  IF jsonb_typeof(p_data->'day_of_month') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'DIA_INVALIDO'; END IF;
  v_day := (p_data->>'day_of_month')::numeric;
  IF v_day <> trunc(v_day) OR v_day < 1 OR v_day > 31
  THEN RAISE EXCEPTION 'DIA_INVALIDO'; END IF;

  IF v_desc = ''
     OR v_cat IS NULL
     OR v_cat NOT IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','comissoes','outras')
     OR (v_group IS NOT NULL AND v_group NOT IN ('custeio','pessoal','emolumentos'))
     OR (v_method IS NOT NULL AND v_method NOT IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto'))
  THEN RAISE EXCEPTION 'DADOS_INVALIDOS'; END IF;

  IF coalesce(p_data->>'start_month', '') !~ '^\d{4}-\d{2}-01$'
  THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;
  IF p_data->>'end_month' IS NOT NULL AND p_data->>'end_month' !~ '^\d{4}-\d{2}-01$'
  THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;

  BEGIN
    v_start := (p_data->>'start_month')::date;
    v_end   := (p_data->>'end_month')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'PERIODO_INVALIDO';
  END;

  IF v_end IS NOT NULL AND v_end < v_start
  THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;

  INSERT INTO expense_recurrences (clinic_id, description, amount, category, deduction_group,
                                   payment_method, day_of_month, start_month, end_month)
  VALUES (p_clinic_id, v_desc, v_amount, v_cat, v_group, v_method, v_day::integer, v_start, v_end)
  RETURNING id INTO v_id;

  PERFORM public.generate_recurring_expenses(p_clinic_id);

  RETURN v_id;
END;
$fn$;

-- ── Editar recorrência: esta e as próximas (service role) ───
-- p_data: os mesmos campos da criação; start_month e end_month são ignorados.
-- Atualiza a recorrência e as despesas dela com recurrence_month >= p_from_month (dia 1
-- do mês) que não estão pagas: descrição, valor, categoria, grupo, forma de pagamento e
-- vencimento recalculado com o novo dia. Devolve quantas despesas foram alteradas.
-- Erros: RECORRENCIA_NAO_ENCONTRADA, VALOR_INVALIDO, DIA_INVALIDO, DADOS_INVALIDOS,
-- PERIODO_INVALIDO (p_from_month nulo).

CREATE OR REPLACE FUNCTION public.update_expense_recurrence(
  p_clinic_id UUID, p_id UUID, p_data JSONB, p_from_month DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_rec    expense_recurrences%ROWTYPE;
  v_desc   TEXT := btrim(coalesce(p_data->>'description', ''));
  v_amount NUMERIC;
  v_day    NUMERIC;
  v_cat    TEXT := p_data->>'category';
  v_group  TEXT := nullif(p_data->>'deduction_group', '');
  v_method TEXT := nullif(p_data->>'payment_method', '');
  v_from   DATE;
  v_n      INTEGER;
BEGIN
  SELECT * INTO v_rec FROM expense_recurrences
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECORRENCIA_NAO_ENCONTRADA'; END IF;

  IF jsonb_typeof(p_data->'amount') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'VALOR_INVALIDO'; END IF;
  v_amount := round((p_data->>'amount')::numeric, 2);
  IF v_amount <= 0 OR v_amount >= 100000000
  THEN RAISE EXCEPTION 'VALOR_INVALIDO'; END IF;

  IF jsonb_typeof(p_data->'day_of_month') IS DISTINCT FROM 'number'
  THEN RAISE EXCEPTION 'DIA_INVALIDO'; END IF;
  v_day := (p_data->>'day_of_month')::numeric;
  IF v_day <> trunc(v_day) OR v_day < 1 OR v_day > 31
  THEN RAISE EXCEPTION 'DIA_INVALIDO'; END IF;

  IF v_desc = ''
     OR v_cat IS NULL
     OR v_cat NOT IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','comissoes','outras')
     OR (v_group IS NOT NULL AND v_group NOT IN ('custeio','pessoal','emolumentos'))
     OR (v_method IS NOT NULL AND v_method NOT IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto'))
  THEN RAISE EXCEPTION 'DADOS_INVALIDOS'; END IF;

  IF p_from_month IS NULL THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;
  v_from := date_trunc('month', p_from_month)::date;

  UPDATE expense_recurrences
  SET description     = v_desc,
      amount          = v_amount,
      category        = v_cat,
      deduction_group = v_group,
      payment_method  = v_method,
      day_of_month    = v_day::integer,
      updated_at      = now()
  WHERE id = p_id AND clinic_id = p_clinic_id;

  UPDATE expenses e
  SET description     = v_desc,
      amount          = v_amount,
      category        = v_cat,
      deduction_group = v_group,
      payment_method  = v_method,
      due_date        = make_date(extract(year from e.recurrence_month)::int,
                                  extract(month from e.recurrence_month)::int,
                                  least(v_day::integer,
                                        extract(day from (e.recurrence_month + interval '1 month' - interval '1 day'))::int)),
      updated_at      = now()
  WHERE e.clinic_id = p_clinic_id
    AND e.recurrence_id = p_id
    AND e.recurrence_month >= v_from
    AND e.status <> 'paid';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- ── Encerrar recorrência (service role) ─────────────────────
-- Grava end_month = p_last_month (dia 1 do último mês que ainda vale; pode ser o mês
-- anterior ao atual) e apaga as despesas da recorrência com recurrence_month depois
-- dele que não estão pagas. Devolve quantas foram apagadas.
-- Erros: RECORRENCIA_NAO_ENCONTRADA, PERIODO_INVALIDO (p_last_month nulo ou antes de
-- start_month).

CREATE OR REPLACE FUNCTION public.end_expense_recurrence(
  p_clinic_id UUID, p_id UUID, p_last_month DATE
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_rec  expense_recurrences%ROWTYPE;
  v_last DATE;
  v_n    INTEGER;
BEGIN
  SELECT * INTO v_rec FROM expense_recurrences
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECORRENCIA_NAO_ENCONTRADA'; END IF;

  IF p_last_month IS NULL THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;
  v_last := date_trunc('month', p_last_month)::date;
  IF v_last < v_rec.start_month THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;

  UPDATE expense_recurrences
  SET end_month  = v_last,
      updated_at = now()
  WHERE id = p_id AND clinic_id = p_clinic_id;

  DELETE FROM expenses
  WHERE clinic_id = p_clinic_id
    AND recurrence_id = p_id
    AND recurrence_month > v_last
    AND status <> 'paid';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

-- ── Permissões ──────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.generate_recurring_expenses(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_expenses(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.create_expense_recurrence(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense_recurrence(UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.update_expense_recurrence(UUID, UUID, JSONB, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_expense_recurrence(UUID, UUID, JSONB, DATE) TO service_role;
REVOKE ALL ON FUNCTION public.end_expense_recurrence(UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_expense_recurrence(UUID, UUID, DATE) TO service_role;

-- ── Geração diária (opcional, para quem tem o pg_cron ativo) ─
-- Sem o agendamento, a geração roda quando a recorrência é criada e quando o app pede.
-- Para agendar todo dia às 9h (UTC), descomente e rode:
--
-- SELECT cron.schedule(
--   'expenses-recurring',
--   '0 9 * * *',
--   $$SELECT public.generate_recurring_expenses(id) FROM clinics$$
-- );
