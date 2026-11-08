-- ============================================================
-- CONVÊNIOS: PAGAMENTO DO LOTE, GLOSAS E RECURSO (etapa 7b)
-- Acrescenta: prazos de pagamento e de recurso em insurance_plans, a tabela
-- glosa_reasons (motivos de glosa; carga em supabase/2026-11-08-motivos-glosa.sql),
-- o status 'pago' e os dados do depósito em insurance_batches, os valores pagos,
-- a glosa e o recurso em insurance_guide_items, e as funções que registram o
-- pagamento do lote, desfazem o pagamento e recebem o recurso (service role).
-- Lote 'pago' é tratado como 'enviado' (fechado) pelas funções da etapa 7a.
-- Rode depois de supabase/2026-11-07-convenios-guias.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Prazos da operadora ─────────────────────────────────────

ALTER TABLE insurance_plans ADD COLUMN IF NOT EXISTS payment_days SMALLINT NOT NULL DEFAULT 30;
ALTER TABLE insurance_plans ADD COLUMN IF NOT EXISTS appeal_days  SMALLINT NOT NULL DEFAULT 30;

ALTER TABLE insurance_plans DROP CONSTRAINT IF EXISTS insurance_plans_payment_days_check;
ALTER TABLE insurance_plans ADD CONSTRAINT insurance_plans_payment_days_check
  CHECK (payment_days BETWEEN 0 AND 180);
ALTER TABLE insurance_plans DROP CONSTRAINT IF EXISTS insurance_plans_appeal_days_check;
ALTER TABLE insurance_plans ADD CONSTRAINT insurance_plans_appeal_days_check
  CHECK (appeal_days BETWEEN 0 AND 180);

-- ── Motivos de glosa (igual para todas as clínicas; carga em arquivo à parte) ──

CREATE TABLE IF NOT EXISTS glosa_reasons (
  code TEXT PRIMARY KEY CHECK (code ~ '^\d{4}$'),
  name TEXT NOT NULL
);

ALTER TABLE glosa_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_select" ON glosa_reasons;
CREATE POLICY "authenticated_select" ON glosa_reasons FOR SELECT TO authenticated
  USING (true);

-- ── Lote: status 'pago' e dados do depósito ─────────────────

ALTER TABLE insurance_batches DROP CONSTRAINT IF EXISTS insurance_batches_status_check;
ALTER TABLE insurance_batches ADD CONSTRAINT insurance_batches_status_check
  CHECK (status IN ('aberto','enviado','pago'));

ALTER TABLE insurance_batches ADD COLUMN IF NOT EXISTS paid_at            DATE;
ALTER TABLE insurance_batches ADD COLUMN IF NOT EXISTS deposit_amount     NUMERIC(10,2);
ALTER TABLE insurance_batches ADD COLUMN IF NOT EXISTS paid_registered_at TIMESTAMPTZ;

-- ── Item da guia: pagamento, glosa e recurso ────────────────

ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS paid_value           NUMERIC(10,2);
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS glosa_value          NUMERIC(10,2);
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS glosa_code           TEXT REFERENCES glosa_reasons(code);
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS glosa_note           TEXT;
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS payment_id           UUID REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS appeal_status        TEXT NOT NULL DEFAULT 'nenhum';
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS appeal_at            DATE;
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS appeal_text          TEXT;
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS appeal_result_at     DATE;
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS recovered_value      NUMERIC(10,2);
ALTER TABLE insurance_guide_items ADD COLUMN IF NOT EXISTS recovered_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL;

ALTER TABLE insurance_guide_items DROP CONSTRAINT IF EXISTS insurance_guide_items_appeal_status_check;
ALTER TABLE insurance_guide_items ADD CONSTRAINT insurance_guide_items_appeal_status_check
  CHECK (appeal_status IN ('nenhum','em_recurso','aceito','negado'));
ALTER TABLE insurance_guide_items DROP CONSTRAINT IF EXISTS insurance_guide_items_paid_value_check;
ALTER TABLE insurance_guide_items ADD CONSTRAINT insurance_guide_items_paid_value_check
  CHECK (paid_value IS NULL OR value IS NULL OR paid_value BETWEEN 0 AND value);
ALTER TABLE insurance_guide_items DROP CONSTRAINT IF EXISTS insurance_guide_items_glosa_value_check;
ALTER TABLE insurance_guide_items ADD CONSTRAINT insurance_guide_items_glosa_value_check
  CHECK (paid_value IS NULL OR glosa_value IS NULL OR value IS NULL OR glosa_value = value - paid_value);
ALTER TABLE insurance_guide_items DROP CONSTRAINT IF EXISTS insurance_guide_items_recovered_value_check;
ALTER TABLE insurance_guide_items ADD CONSTRAINT insurance_guide_items_recovered_value_check
  CHECK (recovered_value IS NULL OR glosa_value IS NULL OR recovered_value BETWEEN 0 AND glosa_value);

CREATE INDEX IF NOT EXISTS insurance_guide_items_appeal_idx ON insurance_guide_items (clinic_id, appeal_status);

-- ── Registrar o pagamento do lote (service role) ────────────
-- p_items: [{ id, paid_value, glosa_code, glosa_note }] com TODOS os itens do lote.
-- Erros: LOTE_INVALIDO, LOTE_NAO_ENVIADO, ITENS_INCOMPLETOS, VALOR_INVALIDO,
-- MOTIVO_OBRIGATORIO (glosa > 0 sem código). Motivo inexistente → FK (23503).
-- Cria um recebimento por paciente (soma paga > 0). Devolve quantos recebimentos criou.

CREATE OR REPLACE FUNCTION public.register_batch_payment(
  p_clinic_id UUID, p_batch_id UUID, p_paid_at DATE, p_deposit NUMERIC, p_items JSONB
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
  v_plan_id UUID;
  v_period_end DATE;
  v_plan_name TEXT;
  v_count INT := 0;
  v_pay_id UUID;
  v_pat RECORD;
BEGIN
  SELECT status, insurance_plan_id, period_end INTO v_status, v_plan_id, v_period_end
  FROM insurance_batches
  WHERE id = p_batch_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
  IF v_status <> 'enviado' THEN RAISE EXCEPTION 'LOTE_NAO_ENVIADO'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
     OR (SELECT COUNT(DISTINCT (e->>'id')) FROM jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
       WHERE NOT EXISTS (SELECT 1 FROM insurance_guide_items
                         WHERE id = (e->>'id')::uuid AND batch_id = p_batch_id AND clinic_id = p_clinic_id))
     OR EXISTS (
       SELECT 1 FROM insurance_guide_items i
       WHERE i.batch_id = p_batch_id AND i.clinic_id = p_clinic_id
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE (e->>'id')::uuid = i.id))
  THEN
    RAISE EXCEPTION 'ITENS_INCOMPLETOS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    JOIN insurance_guide_items i ON i.id = (e->>'id')::uuid
    WHERE (e->>'paid_value') IS NULL
       OR (e->>'paid_value')::numeric < 0
       OR (e->>'paid_value')::numeric > COALESCE(i.value, 0)
  ) THEN
    RAISE EXCEPTION 'VALOR_INVALIDO';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) e
    JOIN insurance_guide_items i ON i.id = (e->>'id')::uuid
    WHERE COALESCE(i.value, 0) - (e->>'paid_value')::numeric > 0
      AND COALESCE(e->>'glosa_code', '') = ''
  ) THEN
    RAISE EXCEPTION 'MOTIVO_OBRIGATORIO';
  END IF;

  UPDATE insurance_guide_items i
  SET paid_value = (e->>'paid_value')::numeric,
      glosa_value = COALESCE(i.value, 0) - (e->>'paid_value')::numeric,
      glosa_code = CASE WHEN COALESCE(i.value, 0) - (e->>'paid_value')::numeric > 0
                        THEN NULLIF(e->>'glosa_code', '') END,
      glosa_note = CASE WHEN COALESCE(i.value, 0) - (e->>'paid_value')::numeric > 0
                        THEN NULLIF(e->>'glosa_note', '') END
  FROM jsonb_array_elements(p_items) e
  WHERE i.id = (e->>'id')::uuid AND i.batch_id = p_batch_id AND i.clinic_id = p_clinic_id;

  SELECT name INTO v_plan_name FROM insurance_plans WHERE id = v_plan_id AND clinic_id = p_clinic_id;

  FOR v_pat IN
    SELECT g.patient_id, SUM(i.paid_value) AS total
    FROM insurance_guide_items i
    JOIN insurance_guides g ON g.id = i.guide_id
    WHERE i.batch_id = p_batch_id AND i.clinic_id = p_clinic_id
    GROUP BY g.patient_id
    HAVING SUM(i.paid_value) > 0
  LOOP
    INSERT INTO payments (clinic_id, patient_id, amount, payment_method, status, due_date, paid_at,
                          description, charge_kind)
    VALUES (p_clinic_id, v_pat.patient_id, v_pat.total, 'convenio', 'paid', p_paid_at,
            (p_paid_at::text || 'T12:00:00Z')::timestamptz,
            v_plan_name || ' — lote ' || to_char(v_period_end, 'MM/YYYY'), 'manual')
    RETURNING id INTO v_pay_id;

    UPDATE insurance_guide_items SET payment_id = v_pay_id
    WHERE batch_id = p_batch_id AND clinic_id = p_clinic_id
      AND guide_id IN (SELECT id FROM insurance_guides
                       WHERE patient_id = v_pat.patient_id AND clinic_id = p_clinic_id);
    v_count := v_count + 1;
  END LOOP;

  UPDATE insurance_batches
  SET status = 'pago', paid_at = p_paid_at, deposit_amount = p_deposit, paid_registered_at = NOW()
  WHERE id = p_batch_id AND clinic_id = p_clinic_id;

  RETURN v_count;
END;
$fn$;

-- ── Desfazer o pagamento do lote (service role) ─────────────
-- Erros: LOTE_INVALIDO, LOTE_NAO_PAGO, RECURSO_RECEBIDO (algum item já recebeu recurso).

CREATE OR REPLACE FUNCTION public.undo_batch_payment(
  p_clinic_id UUID, p_batch_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM insurance_batches
  WHERE id = p_batch_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
  IF v_status <> 'pago' THEN RAISE EXCEPTION 'LOTE_NAO_PAGO'; END IF;
  IF EXISTS (SELECT 1 FROM insurance_guide_items
             WHERE batch_id = p_batch_id AND clinic_id = p_clinic_id AND recovered_payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'RECURSO_RECEBIDO';
  END IF;

  UPDATE payments SET status = 'cancelled', updated_at = NOW()
  WHERE clinic_id = p_clinic_id
    AND id IN (SELECT payment_id FROM insurance_guide_items
               WHERE batch_id = p_batch_id AND clinic_id = p_clinic_id AND payment_id IS NOT NULL);

  UPDATE insurance_guide_items
  SET paid_value = NULL, glosa_value = NULL, glosa_code = NULL, glosa_note = NULL, payment_id = NULL,
      appeal_status = 'nenhum', appeal_at = NULL, appeal_text = NULL, appeal_result_at = NULL,
      recovered_value = NULL, recovered_payment_id = NULL
  WHERE batch_id = p_batch_id AND clinic_id = p_clinic_id;

  UPDATE insurance_batches
  SET status = 'enviado', paid_at = NULL, deposit_amount = NULL, paid_registered_at = NULL
  WHERE id = p_batch_id AND clinic_id = p_clinic_id;
END;
$fn$;

-- ── Receber o valor recuperado de um recurso aceito (service role) ──
-- Erros: RECURSO_INVALIDO (item inexistente, recurso não aceito ou já recebido),
-- VALOR_INVALIDO (valor fora de 0,01 até o valor glosado). Devolve o id do recebimento.

CREATE OR REPLACE FUNCTION public.receive_appeal(
  p_clinic_id UUID, p_item_id UUID, p_value NUMERIC, p_received_at DATE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_batch_id UUID;
  v_item insurance_guide_items%ROWTYPE;
  v_patient_id UUID;
  v_plan_name TEXT;
  v_pay_id UUID;
BEGIN
  -- Trava o lote antes do item (mesma ordem de undo_batch_payment).
  SELECT batch_id INTO v_batch_id FROM insurance_guide_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id;
  IF NOT FOUND OR v_batch_id IS NULL THEN RAISE EXCEPTION 'RECURSO_INVALIDO'; END IF;
  PERFORM 1 FROM insurance_batches WHERE id = v_batch_id AND clinic_id = p_clinic_id FOR UPDATE;

  SELECT * INTO v_item FROM insurance_guide_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND OR v_item.appeal_status <> 'aceito' OR v_item.recovered_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'RECURSO_INVALIDO';
  END IF;
  IF p_value IS NULL OR p_value <= 0 OR p_value > COALESCE(v_item.glosa_value, 0) THEN
    RAISE EXCEPTION 'VALOR_INVALIDO';
  END IF;

  SELECT g.patient_id, p.name INTO v_patient_id, v_plan_name
  FROM insurance_guides g JOIN insurance_plans p ON p.id = g.insurance_plan_id
  WHERE g.id = v_item.guide_id AND g.clinic_id = p_clinic_id;

  INSERT INTO payments (clinic_id, patient_id, amount, payment_method, status, due_date, paid_at,
                        description, charge_kind)
  VALUES (p_clinic_id, v_patient_id, p_value, 'convenio', 'paid', p_received_at,
          (p_received_at::text || 'T12:00:00Z')::timestamptz,
          v_plan_name || ' — recurso de glosa ' || v_item.glosa_code, 'manual')
  RETURNING id INTO v_pay_id;

  UPDATE insurance_guide_items SET recovered_value = p_value, recovered_payment_id = v_pay_id
  WHERE id = p_item_id AND clinic_id = p_clinic_id;

  RETURN v_pay_id;
END;
$fn$;

-- ── Lote 'pago' é fechado como 'enviado' (substitui as funções da 7a) ──

CREATE OR REPLACE FUNCTION public.assign_batch_items(
  p_clinic_id UUID, p_batch_id UUID, p_item_ids UUID[]
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
  v_plan_id UUID;
  v_count INT;
BEGIN
  SELECT status, insurance_plan_id INTO v_status, v_plan_id FROM insurance_batches
  WHERE id = p_batch_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
  IF v_status <> 'aberto' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;

  UPDATE insurance_guide_items SET batch_id = p_batch_id
  WHERE id = ANY(p_item_ids) AND clinic_id = p_clinic_id AND batch_id IS NULL AND active
    AND "authorization" IN ('autorizado','nao_exige')
    AND treatment_id IN (SELECT id FROM treatments WHERE clinic_id = p_clinic_id AND status = 'completed')
    AND guide_id IN (SELECT id FROM insurance_guides
                     WHERE insurance_plan_id = v_plan_id AND clinic_id = p_clinic_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remove_batch_item(
  p_clinic_id UUID, p_batch_id UUID, p_item_id UUID, p_defer_until DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM insurance_batches
  WHERE id = p_batch_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
  IF v_status <> 'aberto' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;

  UPDATE insurance_guide_items
  SET batch_id = NULL, typed = FALSE, defer_until = p_defer_until
  WHERE id = p_item_id AND clinic_id = p_clinic_id AND batch_id = p_batch_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.send_insurance_batch(
  p_clinic_id UUID, p_batch_id UUID, p_protocol TEXT, p_sent_at DATE
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM insurance_batches
  WHERE id = p_batch_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
  IF v_status <> 'aberto' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;
  IF NOT EXISTS (SELECT 1 FROM insurance_guide_items
                 WHERE batch_id = p_batch_id AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'LOTE_VAZIO';
  END IF;

  UPDATE insurance_batches SET status = 'enviado', protocol = p_protocol, sent_at = p_sent_at
  WHERE id = p_batch_id AND clinic_id = p_clinic_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.register_batch_payment(UUID, UUID, DATE, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_batch_payment(UUID, UUID, DATE, NUMERIC, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.undo_batch_payment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_batch_payment(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.receive_appeal(UUID, UUID, NUMERIC, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_appeal(UUID, UUID, NUMERIC, DATE) TO service_role;
REVOKE ALL ON FUNCTION public.assign_batch_items(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_batch_items(UUID, UUID, UUID[]) TO service_role;
REVOKE ALL ON FUNCTION public.remove_batch_item(UUID, UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_batch_item(UUID, UUID, UUID, DATE) TO service_role;
REVOKE ALL ON FUNCTION public.send_insurance_batch(UUID, UUID, TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_insurance_batch(UUID, UUID, TEXT, DATE) TO service_role;
