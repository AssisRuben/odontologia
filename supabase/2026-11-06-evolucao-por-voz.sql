-- ============================================================
-- EVOLUÇÃO CLÍNICA E ANAMNESE POR VOZ (IA)
-- Acrescenta as tabelas ai_connections (chave da OpenAI de cada clínica) e
-- ai_usage (registro de uso, sem texto nem dado do paciente), a marca ai_used
-- em evolutions e anamneses e a função save_evolution_with_actions, que grava
-- a evolução e as ações sugeridas (orçamento e tratamentos) numa transação só.
-- Tudo é acessado só pelo servidor (service role).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── ai_connections: chave da OpenAI da clínica (só o servidor acessa) ──

CREATE TABLE IF NOT EXISTS ai_connections (
  clinic_id     UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'openai',
  api_key       TEXT NOT NULL,
  api_key_last4 TEXT NOT NULL,
  model_tier    TEXT NOT NULL DEFAULT 'economico' CHECK (model_tier IN ('economico','caprichado')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ai_connections ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role

-- ── ai_usage: uso da IA (nunca guarda texto, áudio ou dado do paciente) ──

CREATE TABLE IF NOT EXISTS ai_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id       UUID,
  kind          TEXT NOT NULL CHECK (kind IN ('transcricao','evolucao','anamnese')),
  model         TEXT NOT NULL,
  audio_seconds INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  ok            BOOLEAN NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_usage_clinic_created_idx ON ai_usage (clinic_id, created_at);
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role

-- ── Marca de uso da IA ──────────────────────────────────────

ALTER TABLE evolutions ADD COLUMN IF NOT EXISTS ai_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE anamneses  ADD COLUMN IF NOT EXISTS ai_used BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Salvar evolução com as ações sugeridas (service role) ───
-- p_actions é um array JSON:
--   { "tipo": "item_orcamento", "id": uuid, "novo_status": "in_progress"|"completed" }
--   { "tipo": "tratamento",     "id": uuid, "novo_status": "in_progress"|"completed" }
--   { "tipo": "tratamento_novo", "procedimento": text, "dentes": int[], "faces": text[],
--     "status": "completed"|"planned" }
-- Se qualquer ação ficar inválida, nada é gravado (a exceção desfaz a transação).

CREATE OR REPLACE FUNCTION public.save_evolution_with_actions(
  p_clinic_id UUID, p_patient_id UUID, p_appointment_id UUID, p_professional_id UUID,
  p_date DATE, p_description TEXT, p_images TEXT[], p_ai_used BOOLEAN, p_actions JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_action     JSONB;
  v_tipo       TEXT;
  v_new_status TEXT;
  v_cur_status TEXT;
  v_procedure  TEXT;
  v_budget     UUID;
  v_treatment  UUID;
  v_tooth      INTEGER;
  v_faces      TEXT[];
  v_evolution  UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM patients WHERE id = p_patient_id AND clinic_id = p_clinic_id)
     OR (p_appointment_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM appointments
          WHERE id = p_appointment_id AND clinic_id = p_clinic_id AND patient_id = p_patient_id))
     OR (p_professional_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM professionals WHERE id = p_professional_id AND clinic_id = p_clinic_id))
  THEN
    RAISE EXCEPTION 'Paciente ou consulta inválidos';
  END IF;

  PERFORM set_config('app.budget_system', 'on', true);

  FOR v_action IN SELECT * FROM jsonb_array_elements(COALESCE(p_actions, '[]'::jsonb))
  LOOP
    v_tipo := v_action->>'tipo';

    IF v_tipo = 'item_orcamento' THEN
      v_new_status := v_action->>'novo_status';
      IF v_new_status IS NULL OR v_new_status NOT IN ('in_progress','completed') THEN
        RAISE EXCEPTION 'Ação inválida. Organize de novo.';
      END IF;

      SELECT bi.status, bi.procedure, bi.budget_id INTO v_cur_status, v_procedure, v_budget
      FROM budget_items bi
      JOIN budgets b ON b.id = bi.budget_id
      WHERE bi.id = (v_action->>'id')::uuid
        AND b.clinic_id = p_clinic_id
        AND b.patient_id = p_patient_id
        AND b.status = 'approved'
        AND bi.approved = TRUE
      FOR UPDATE OF bi;

      IF NOT FOUND OR NOT (
        (v_cur_status = 'pending' AND v_new_status IN ('in_progress','completed'))
        OR (v_cur_status = 'in_progress' AND v_new_status = 'completed')
      ) THEN
        RAISE EXCEPTION 'O item % já foi concluído ou mudou. Organize de novo.', COALESCE(v_procedure, '');
      END IF;

      UPDATE budget_items SET status = v_new_status WHERE id = (v_action->>'id')::uuid;

      IF NOT EXISTS (
        SELECT 1 FROM budget_items
        WHERE budget_id = v_budget AND approved = TRUE AND status <> 'completed'
      ) THEN
        UPDATE budgets SET status = 'completed', updated_at = NOW() WHERE id = v_budget;
      END IF;

    ELSIF v_tipo = 'tratamento' THEN
      v_new_status := v_action->>'novo_status';
      IF v_new_status IS NULL OR v_new_status NOT IN ('in_progress','completed') THEN
        RAISE EXCEPTION 'Ação inválida. Organize de novo.';
      END IF;

      SELECT status, procedure INTO v_cur_status, v_procedure
      FROM treatments
      WHERE id = (v_action->>'id')::uuid
        AND clinic_id = p_clinic_id
        AND patient_id = p_patient_id
      FOR UPDATE;

      IF NOT FOUND OR NOT (
        (v_cur_status = 'planned' AND v_new_status IN ('in_progress','completed'))
        OR (v_cur_status = 'in_progress' AND v_new_status = 'completed')
      ) THEN
        RAISE EXCEPTION 'O tratamento % já foi concluído ou mudou. Organize de novo.', COALESCE(v_procedure, '');
      END IF;

      UPDATE treatments SET status = v_new_status WHERE id = (v_action->>'id')::uuid;

    ELSIF v_tipo = 'tratamento_novo' THEN
      v_new_status := v_action->>'status';
      v_procedure  := NULLIF(btrim(COALESCE(v_action->>'procedimento', '')), '');
      IF v_new_status IS NULL OR v_new_status NOT IN ('completed','planned') OR v_procedure IS NULL THEN
        RAISE EXCEPTION 'Ação inválida. Organize de novo.';
      END IF;

      INSERT INTO treatments (clinic_id, patient_id, professional_id, procedure, value, date, status)
      VALUES (p_clinic_id, p_patient_id, p_professional_id, v_procedure, 0, p_date, v_new_status)
      RETURNING id INTO v_treatment;

      SELECT COALESCE(array_agg(f), '{}') INTO v_faces
      FROM jsonb_array_elements_text(COALESCE(v_action->'faces', '[]'::jsonb)) AS f;

      FOR v_tooth IN
        SELECT t::integer FROM jsonb_array_elements_text(COALESCE(v_action->'dentes', '[]'::jsonb)) AS t
      LOOP
        INSERT INTO treatment_teeth (treatment_id, tooth_number, faces)
        VALUES (v_treatment, v_tooth, v_faces);
      END LOOP;

    ELSE
      RAISE EXCEPTION 'Ação inválida. Organize de novo.';
    END IF;
  END LOOP;

  INSERT INTO evolutions (clinic_id, patient_id, appointment_id, professional_id, date, description, images, ai_used)
  VALUES (p_clinic_id, p_patient_id, p_appointment_id, p_professional_id, p_date, p_description,
          COALESCE(p_images, '{}'), COALESCE(p_ai_used, FALSE))
  RETURNING id INTO v_evolution;

  RETURN v_evolution;
END;
$fn$;

-- Só o servidor (service role) chama; usuários logados não.
REVOKE ALL ON FUNCTION public.save_evolution_with_actions(UUID, UUID, UUID, UUID, DATE, TEXT, TEXT[], BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_evolution_with_actions(UUID, UUID, UUID, UUID, DATE, TEXT, TEXT[], BOOLEAN, JSONB) TO service_role;
