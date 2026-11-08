-- ============================================================
-- CONVÊNIOS: OPERADORAS, TABELA, GUIAS E LOTE DO MÊS (etapa 7a)
-- Acrescenta: campos de operadora em insurance_plans, carteirinha em
-- patients, insurance_procedure_id/completed_at em treatments, as tabelas
-- tuss_procedures, insurance_plan_procedures, insurance_batches,
-- insurance_guides e insurance_guide_items, o gatilho de completed_at e as
-- funções que gravam guias e lotes (service role).
-- Guias, itens e lotes só são lidos pela tela (RLS); toda escrita é do servidor.
-- A lista TUSS é carregada por supabase/2026-11-07-tuss-odontologia.sql
-- (rode depois deste).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Operadora e carteirinha ─────────────────────────────────

ALTER TABLE insurance_plans ADD COLUMN IF NOT EXISTS ans_registry    TEXT;
ALTER TABLE insurance_plans ADD COLUMN IF NOT EXISTS provider_code   TEXT;
ALTER TABLE insurance_plans ADD COLUMN IF NOT EXISTS closing_day     SMALLINT;
ALTER TABLE insurance_plans ADD COLUMN IF NOT EXISTS submission_days SMALLINT NOT NULL DEFAULT 10;
ALTER TABLE insurance_plans ADD COLUMN IF NOT EXISTS active          BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE insurance_plans DROP CONSTRAINT IF EXISTS insurance_plans_ans_registry_check;
ALTER TABLE insurance_plans ADD CONSTRAINT insurance_plans_ans_registry_check
  CHECK (ans_registry IS NULL OR ans_registry ~ '^\d{6}$');
ALTER TABLE insurance_plans DROP CONSTRAINT IF EXISTS insurance_plans_provider_code_check;
ALTER TABLE insurance_plans ADD CONSTRAINT insurance_plans_provider_code_check
  CHECK (provider_code IS NULL OR char_length(provider_code) <= 30);
ALTER TABLE insurance_plans DROP CONSTRAINT IF EXISTS insurance_plans_closing_day_check;
ALTER TABLE insurance_plans ADD CONSTRAINT insurance_plans_closing_day_check
  CHECK (closing_day IS NULL OR closing_day BETWEEN 1 AND 28);
ALTER TABLE insurance_plans DROP CONSTRAINT IF EXISTS insurance_plans_submission_days_check;
ALTER TABLE insurance_plans ADD CONSTRAINT insurance_plans_submission_days_check
  CHECK (submission_days BETWEEN 0 AND 90);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_card             TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS insurance_card_valid_until DATE;

ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_insurance_card_check;
ALTER TABLE patients ADD CONSTRAINT patients_insurance_card_check
  CHECK (insurance_card IS NULL OR char_length(insurance_card) <= 30);

-- ── Lista TUSS (igual para todas as clínicas; carga em arquivo à parte) ──

CREATE TABLE IF NOT EXISTS tuss_procedures (
  code TEXT PRIMARY KEY CHECK (code ~ '^\d{8}$'),
  name TEXT NOT NULL
);

ALTER TABLE tuss_procedures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_select" ON tuss_procedures;
CREATE POLICY "authenticated_select" ON tuss_procedures FOR SELECT TO authenticated
  USING (true);

-- ── Tabela de procedimentos da operadora ────────────────────

CREATE TABLE IF NOT EXISTS insurance_plan_procedures (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id              UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  insurance_plan_id      UUID NOT NULL REFERENCES insurance_plans(id) ON DELETE CASCADE,
  code                   TEXT NOT NULL CHECK (char_length(code) BETWEEN 1 AND 20),
  name                   TEXT NOT NULL,
  value                  NUMERIC(10,2) NOT NULL CHECK (value >= 0),
  requires_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (insurance_plan_id, code)
);

ALTER TABLE insurance_plan_procedures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON insurance_plan_procedures;
CREATE POLICY "clinic_member" ON insurance_plan_procedures FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Tratamento: procedimento da tabela e data de conclusão ──

ALTER TABLE treatments ADD COLUMN IF NOT EXISTS insurance_procedure_id UUID
  REFERENCES insurance_plan_procedures(id) ON DELETE SET NULL;
ALTER TABLE treatments ADD COLUMN IF NOT EXISTS completed_at DATE;

CREATE OR REPLACE FUNCTION public.treatments_set_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.status = 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, CURRENT_DATE);
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS treatments_completed_at ON treatments;
CREATE TRIGGER treatments_completed_at
  BEFORE INSERT OR UPDATE OF status ON treatments
  FOR EACH ROW EXECUTE FUNCTION public.treatments_set_completed_at();

-- Tratamentos já concluídos antes desta etapa recebem a data do tratamento.
UPDATE treatments SET completed_at = date WHERE status = 'completed' AND completed_at IS NULL;

-- ── Lote do mês ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insurance_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  insurance_plan_id UUID NOT NULL REFERENCES insurance_plans(id) ON DELETE RESTRICT,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  due_date          DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','enviado')),
  protocol          TEXT,
  sent_at           DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (insurance_plan_id, period_end)
);

CREATE INDEX IF NOT EXISTS insurance_batches_clinic_status_idx ON insurance_batches (clinic_id, status);

ALTER TABLE insurance_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON insurance_batches;
CREATE POLICY "clinic_member_select" ON insurance_batches FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Guia ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insurance_guides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id           UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  insurance_plan_id    UUID NOT NULL REFERENCES insurance_plans(id) ON DELETE RESTRICT,
  professional_id      UUID REFERENCES professionals(id) ON DELETE SET NULL,
  status               TEXT NOT NULL CHECK (status IN ('aguardando','liberada','cancelada')),
  guide_number         TEXT,
  password             TEXT,
  password_valid_until DATE,
  insurance_card       TEXT,
  requested_at         DATE NOT NULL DEFAULT CURRENT_DATE,
  responded_at         TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS insurance_guides_clinic_patient_idx ON insurance_guides (clinic_id, patient_id);

ALTER TABLE insurance_guides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON insurance_guides;
CREATE POLICY "clinic_member_select" ON insurance_guides FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Item da guia ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insurance_guide_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id              UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  guide_id               UUID NOT NULL REFERENCES insurance_guides(id) ON DELETE CASCADE,
  treatment_id           UUID REFERENCES treatments(id) ON DELETE SET NULL,
  code                   TEXT NOT NULL,
  name                   TEXT NOT NULL,
  teeth                  JSONB NOT NULL DEFAULT '[]',
  value                  NUMERIC(10,2),
  requires_authorization BOOLEAN,
  "authorization"        TEXT NOT NULL CHECK ("authorization" IN ('pendente','autorizado','negado','nao_exige')),
  denial_reason          TEXT,
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  executed_at            DATE,
  batch_id               UUID REFERENCES insurance_batches(id) ON DELETE SET NULL,
  defer_until            DATE,
  typed                  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Um tratamento em uma guia ativa por vez.
CREATE UNIQUE INDEX IF NOT EXISTS insurance_guide_items_treatment_active_idx
  ON insurance_guide_items (treatment_id) WHERE active;
CREATE INDEX IF NOT EXISTS insurance_guide_items_batch_idx ON insurance_guide_items (batch_id);

ALTER TABLE insurance_guide_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON insurance_guide_items;
CREATE POLICY "clinic_member_select" ON insurance_guide_items FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Criar guia com itens (service role) ─────────────────────
-- p_items: [{ treatment_id, code, name, teeth, value, requires_authorization, authorization }]
-- Erro GUIA_INVALIDA → paciente, operadora, executante ou tratamento de outra clínica/paciente.
-- Tratamento já em guia ativa → violação do índice único (23505).

CREATE OR REPLACE FUNCTION public.create_insurance_guide(
  p_clinic_id UUID, p_patient_id UUID, p_plan_id UUID, p_professional_id UUID,
  p_card TEXT, p_status TEXT, p_items JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
  v_item JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM patients WHERE id = p_patient_id AND clinic_id = p_clinic_id)
     OR NOT EXISTS (SELECT 1 FROM insurance_plans WHERE id = p_plan_id AND clinic_id = p_clinic_id)
     OR (p_professional_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM professionals WHERE id = p_professional_id AND clinic_id = p_clinic_id))
     OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
  THEN
    RAISE EXCEPTION 'GUIA_INVALIDA';
  END IF;

  INSERT INTO insurance_guides (clinic_id, patient_id, insurance_plan_id, professional_id, status, insurance_card)
  VALUES (p_clinic_id, p_patient_id, p_plan_id, p_professional_id, p_status, p_card)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM treatments
      WHERE id = (v_item->>'treatment_id')::uuid AND clinic_id = p_clinic_id AND patient_id = p_patient_id
    ) THEN
      RAISE EXCEPTION 'GUIA_INVALIDA';
    END IF;

    INSERT INTO insurance_guide_items (
      clinic_id, guide_id, treatment_id, code, name, teeth, value, requires_authorization, "authorization"
    ) VALUES (
      p_clinic_id, v_id, (v_item->>'treatment_id')::uuid, v_item->>'code', v_item->>'name',
      COALESCE(v_item->'teeth', '[]'::jsonb), (v_item->>'value')::numeric,
      (v_item->>'requires_authorization')::boolean, v_item->>'authorization'
    );
  END LOOP;

  RETURN v_id;
END;
$fn$;

-- ── Registrar a resposta da operadora (service role) ────────
-- p_items: [{ id, authorization, denial_reason }] (pode citar só parte dos itens).
-- Erros: GUIA_INVALIDA, GUIA_CANCELADA, GUIA_EM_LOTE.
-- Devolve o status da guia: 'liberada' se nenhum item ativo está pendente, senão 'aguardando'.

CREATE OR REPLACE FUNCTION public.respond_insurance_guide(
  p_clinic_id UUID, p_guide_id UUID, p_number TEXT, p_password TEXT,
  p_valid_until DATE, p_items JSONB
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
  v_item JSONB;
  v_new_status TEXT;
BEGIN
  SELECT status INTO v_status FROM insurance_guides
  WHERE id = p_guide_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GUIA_INVALIDA'; END IF;
  IF v_status = 'cancelada' THEN RAISE EXCEPTION 'GUIA_CANCELADA'; END IF;
  IF EXISTS (SELECT 1 FROM insurance_guide_items
             WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND batch_id IS NOT NULL) THEN
    RAISE EXCEPTION 'GUIA_EM_LOTE';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    UPDATE insurance_guide_items
    SET "authorization" = v_item->>'authorization',
        denial_reason = v_item->>'denial_reason',
        active = (v_item->>'authorization') <> 'negado'
    WHERE id = (v_item->>'id')::uuid AND guide_id = p_guide_id AND clinic_id = p_clinic_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'GUIA_INVALIDA'; END IF;
  END LOOP;

  v_new_status := CASE WHEN EXISTS (
      SELECT 1 FROM insurance_guide_items
      WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND active AND "authorization" = 'pendente'
    ) THEN 'aguardando' ELSE 'liberada' END;

  UPDATE insurance_guides
  SET guide_number = p_number, password = p_password, password_valid_until = p_valid_until,
      responded_at = NOW(), status = v_new_status
  WHERE id = p_guide_id AND clinic_id = p_clinic_id;

  RETURN v_new_status;
END;
$fn$;

-- ── Cancelar guia (service role) ────────────────────────────
-- Erros: GUIA_INVALIDA, GUIA_CANCELADA, GUIA_EM_LOTE.

CREATE OR REPLACE FUNCTION public.cancel_insurance_guide(
  p_clinic_id UUID, p_guide_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM insurance_guides
  WHERE id = p_guide_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GUIA_INVALIDA'; END IF;
  IF v_status = 'cancelada' THEN RAISE EXCEPTION 'GUIA_CANCELADA'; END IF;
  IF EXISTS (SELECT 1 FROM insurance_guide_items
             WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND batch_id IS NOT NULL) THEN
    RAISE EXCEPTION 'GUIA_EM_LOTE';
  END IF;

  UPDATE insurance_guide_items SET active = FALSE
  WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id;

  UPDATE insurance_guides SET status = 'cancelada'
  WHERE id = p_guide_id AND clinic_id = p_clinic_id;
END;
$fn$;

-- ── Colocar itens prontos em um lote aberto (service role) ──
-- Erros: LOTE_INVALIDO, LOTE_ENVIADO. Devolve quantos itens entraram.
-- Só entram itens ativos, sem lote, de guias da mesma operadora do lote.

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
  IF v_status = 'enviado' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;

  UPDATE insurance_guide_items SET batch_id = p_batch_id
  WHERE id = ANY(p_item_ids) AND clinic_id = p_clinic_id AND batch_id IS NULL AND active
    AND guide_id IN (SELECT id FROM insurance_guides
                     WHERE insurance_plan_id = v_plan_id AND clinic_id = p_clinic_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count;
END;
$fn$;

-- ── Tirar um item do lote e adiar (service role) ────────────
-- Erros: LOTE_INVALIDO, LOTE_ENVIADO. Só mexe no item se ele estiver nesse lote.

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
  IF v_status = 'enviado' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;

  UPDATE insurance_guide_items
  SET batch_id = NULL, typed = FALSE, defer_until = p_defer_until
  WHERE id = p_item_id AND clinic_id = p_clinic_id AND batch_id = p_batch_id;
END;
$fn$;

-- ── Marcar o lote como enviado (service role) ───────────────
-- Erros: LOTE_INVALIDO, LOTE_ENVIADO, LOTE_VAZIO.

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
  IF v_status = 'enviado' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;
  IF NOT EXISTS (SELECT 1 FROM insurance_guide_items
                 WHERE batch_id = p_batch_id AND clinic_id = p_clinic_id) THEN
    RAISE EXCEPTION 'LOTE_VAZIO';
  END IF;

  UPDATE insurance_batches SET status = 'enviado', protocol = p_protocol, sent_at = p_sent_at
  WHERE id = p_batch_id AND clinic_id = p_clinic_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_insurance_guide(UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_insurance_guide(UUID, UUID, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.respond_insurance_guide(UUID, UUID, TEXT, TEXT, DATE, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_insurance_guide(UUID, UUID, TEXT, TEXT, DATE, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_insurance_guide(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_insurance_guide(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.assign_batch_items(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_batch_items(UUID, UUID, UUID[]) TO service_role;
REVOKE ALL ON FUNCTION public.remove_batch_item(UUID, UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_batch_item(UUID, UUID, UUID, DATE) TO service_role;
REVOKE ALL ON FUNCTION public.send_insurance_batch(UUID, UUID, TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_insurance_batch(UUID, UUID, TEXT, DATE) TO service_role;
