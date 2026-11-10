-- ============================================================
-- PRÓTESE: LABORATÓRIOS, HISTÓRICO DE ETAPAS E DESPESA DO LABORATÓRIO
-- Acrescenta: tabela laboratories, colunas novas em prosthetics (laboratório, dente/região,
-- custo, despesa gerada), tabela prosthetic_events (uma linha por mudança de etapa) e as
-- funções create_prosthetic, move_prosthetic, update_prosthetic e delete_prosthetic
-- (service role). Ao registrar o retorno do laboratório, a despesa "a pagar" é criada
-- no Financeiro. Os registros antigos são migrados (laboratório em texto -> cadastro,
-- um evento inicial por prótese).
-- Rode depois de supabase/2026-11-08-comissoes.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Laboratórios ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS laboratories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT,
  notes      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS laboratories_clinic_name_uidx
  ON laboratories (clinic_id, lower(btrim(name)));

ALTER TABLE laboratories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON laboratories;
CREATE POLICY "clinic_member" ON laboratories FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Colunas novas em prosthetics ────────────────────────────
-- O texto antigo "laboratory" fica só para leitura de registros antigos.

ALTER TABLE prosthetics ADD COLUMN IF NOT EXISTS laboratory_id     UUID REFERENCES laboratories(id) ON DELETE SET NULL;
ALTER TABLE prosthetics ADD COLUMN IF NOT EXISTS tooth_region      TEXT;
ALTER TABLE prosthetics ADD COLUMN IF NOT EXISTS lab_cost          NUMERIC(10,2);
ALTER TABLE prosthetics ADD COLUMN IF NOT EXISTS expense_id        UUID REFERENCES expenses(id) ON DELETE SET NULL;
ALTER TABLE prosthetics ADD COLUMN IF NOT EXISTS expense_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE prosthetics ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE prosthetics DROP CONSTRAINT IF EXISTS prosthetics_lab_cost_check;
ALTER TABLE prosthetics ADD CONSTRAINT prosthetics_lab_cost_check
  CHECK (lab_cost IS NULL OR lab_cost >= 0);

CREATE INDEX IF NOT EXISTS prosthetics_laboratory_idx ON prosthetics (laboratory_id);

-- ── Histórico de etapas ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS prosthetic_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  prosthetic_id UUID NOT NULL REFERENCES prosthetics(id) ON DELETE CASCADE,
  from_status   TEXT CHECK (from_status IS NULL OR from_status IN ('requested','sent_to_lab','returned','installed')),  -- NULL = criação
  to_status     TEXT NOT NULL CHECK (to_status IN ('requested','sent_to_lab','returned','installed')),
  note          TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS prosthetic_events_prosthetic_idx ON prosthetic_events (prosthetic_id, created_at);

ALTER TABLE prosthetic_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON prosthetic_events;
CREATE POLICY "clinic_member" ON prosthetic_events FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Migração dos registros antigos ──────────────────────────

INSERT INTO laboratories (clinic_id, name)
SELECT DISTINCT clinic_id, btrim(laboratory)
FROM prosthetics
WHERE btrim(coalesce(laboratory, '')) <> ''
  AND laboratory_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE prosthetics p
SET laboratory_id = l.id
FROM laboratories l
WHERE p.laboratory_id IS NULL
  AND l.clinic_id = p.clinic_id
  AND lower(btrim(l.name)) = lower(btrim(p.laboratory));

INSERT INTO prosthetic_events (clinic_id, prosthetic_id, from_status, to_status, created_at)
SELECT p.clinic_id, p.id, NULL, p.status, p.requested_at
FROM prosthetics p
WHERE NOT EXISTS (SELECT 1 FROM prosthetic_events e WHERE e.prosthetic_id = p.id);

-- ── Despesa do laboratório (interna) ────────────────────────
-- Cria a despesa "a pagar" da prótese e a liga a ela. Chamada só pelas funções abaixo
-- (que já travaram a linha). Devolve o id da despesa.

CREATE OR REPLACE FUNCTION public.prosthetic_create_expense(p_row prosthetics)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_patient TEXT;
  v_lab     TEXT;
  v_desc    TEXT;
  v_id      UUID;
BEGIN
  SELECT name INTO v_patient FROM patients
  WHERE id = p_row.patient_id AND clinic_id = p_row.clinic_id;

  -- O texto antigo só vale para registros sem laboratório cadastrado.
  IF p_row.laboratory_id IS NOT NULL THEN
    SELECT l.name INTO v_lab FROM laboratories l
    WHERE l.id = p_row.laboratory_id AND l.clinic_id = p_row.clinic_id;
  ELSE
    v_lab := p_row.laboratory;
  END IF;

  v_desc := 'Prótese: ' || coalesce(nullif(btrim(p_row.type), ''), 'Prótese')
         || ' — ' || coalesce(v_patient, '');
  IF nullif(btrim(coalesce(v_lab, '')), '') IS NOT NULL THEN
    v_desc := v_desc || ' — ' || btrim(v_lab);
  END IF;
  v_desc := left(v_desc, 200);

  INSERT INTO expenses (clinic_id, description, amount, category, deduction_group,
                        professional_id, status, due_date, paid_at)
  VALUES (p_row.clinic_id, v_desc, p_row.lab_cost, 'laboratorio', 'custeio',
          p_row.professional_id, 'pending',
          (now() AT TIME ZONE 'America/Sao_Paulo')::date, NULL)
  RETURNING id INTO v_id;

  UPDATE prosthetics
  SET expense_id = v_id, expense_generated = true, updated_at = now()
  WHERE id = p_row.id AND clinic_id = p_row.clinic_id;

  RETURN v_id;
END;
$fn$;

-- ── Criar prótese (service role) ────────────────────────────
-- p_data: patient_id, professional_id, laboratory_id, type, tooth_region, expected_at,
-- lab_cost, notes (null ou ausente = vazio). Devolve o id da prótese.
-- Erros: PACIENTE_INVALIDO, PROFISSIONAL_INVALIDO, LABORATORIO_INVALIDO (inexistente,
-- de outra clínica ou inativo).

CREATE OR REPLACE FUNCTION public.create_prosthetic(
  p_clinic_id UUID, p_user_id UUID, p_data JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_patient UUID := nullif(p_data->>'patient_id', '')::uuid;
  v_prof    UUID := nullif(p_data->>'professional_id', '')::uuid;
  v_lab     UUID := nullif(p_data->>'laboratory_id', '')::uuid;
  v_id      UUID;
BEGIN
  IF v_patient IS NULL OR NOT EXISTS (
    SELECT 1 FROM patients WHERE id = v_patient AND clinic_id = p_clinic_id
  ) THEN RAISE EXCEPTION 'PACIENTE_INVALIDO'; END IF;

  IF v_prof IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM professionals WHERE id = v_prof AND clinic_id = p_clinic_id
  ) THEN RAISE EXCEPTION 'PROFISSIONAL_INVALIDO'; END IF;

  IF v_lab IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM laboratories WHERE id = v_lab AND clinic_id = p_clinic_id AND active
  ) THEN RAISE EXCEPTION 'LABORATORIO_INVALIDO'; END IF;

  INSERT INTO prosthetics (clinic_id, patient_id, professional_id, laboratory_id, type,
                           tooth_region, expected_at, lab_cost, notes, status)
  VALUES (p_clinic_id, v_patient, v_prof, v_lab,
          nullif(btrim(p_data->>'type'), ''),
          nullif(btrim(p_data->>'tooth_region'), ''),
          nullif(p_data->>'expected_at', '')::date,
          round((p_data->>'lab_cost')::numeric, 2),
          nullif(btrim(p_data->>'notes'), ''),
          'requested')
  RETURNING id INTO v_id;

  INSERT INTO prosthetic_events (clinic_id, prosthetic_id, from_status, to_status, created_by)
  VALUES (p_clinic_id, v_id, NULL, 'requested', p_user_id);

  RETURN v_id;
END;
$fn$;

-- ── Mudar de etapa (service role) ───────────────────────────
-- Devolve {"status": ..., "expense": {"id", "amount"} | null}. A despesa é criada no
-- primeiro retorno/instalação com custo > 0 e nunca mais recriada.
-- Erros: ETAPA_INVALIDA, PROTESE_NAO_ENCONTRADA, PROTESE_CONFLITO (a etapa atual não é
-- p_from), MESMA_ETAPA.

CREATE OR REPLACE FUNCTION public.move_prosthetic(
  p_clinic_id UUID, p_user_id UUID, p_id UUID, p_from TEXT, p_to TEXT, p_note TEXT, p_expected_at DATE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_row     prosthetics%ROWTYPE;
  v_expense JSONB := NULL;
  v_exp_id  UUID;
BEGIN
  IF p_from IS NULL OR p_to IS NULL
     OR p_from NOT IN ('requested','sent_to_lab','returned','installed')
     OR p_to   NOT IN ('requested','sent_to_lab','returned','installed')
  THEN RAISE EXCEPTION 'ETAPA_INVALIDA'; END IF;

  SELECT * INTO v_row FROM prosthetics
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROTESE_NAO_ENCONTRADA'; END IF;
  IF v_row.status <> p_from THEN RAISE EXCEPTION 'PROTESE_CONFLITO'; END IF;
  IF p_to = p_from THEN RAISE EXCEPTION 'MESMA_ETAPA'; END IF;

  UPDATE prosthetics
  SET status = p_to,
      expected_at = CASE WHEN p_to = 'sent_to_lab' AND p_expected_at IS NOT NULL
                         THEN p_expected_at ELSE expected_at END,
      updated_at = now()
  WHERE id = p_id AND clinic_id = p_clinic_id
  RETURNING * INTO v_row;

  INSERT INTO prosthetic_events (clinic_id, prosthetic_id, from_status, to_status, note, created_by)
  VALUES (p_clinic_id, p_id, p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''), p_user_id);

  IF p_to IN ('returned', 'installed')
     AND NOT v_row.expense_generated
     AND coalesce(v_row.lab_cost, 0) > 0 THEN
    v_exp_id := public.prosthetic_create_expense(v_row);
    v_expense := jsonb_build_object('id', v_exp_id, 'amount', v_row.lab_cost);
  END IF;

  RETURN jsonb_build_object('status', p_to, 'expense', v_expense);
END;
$fn$;

-- ── Editar prótese (service role) ───────────────────────────
-- p_data com as mesmas chaves de create_prosthetic (substitui todos os campos editáveis;
-- null ou ausente = vazio). Acerta a despesa ligada:
--   a pagar (pending/overdue): atualiza valor e dentista; custo vazio/zero apaga a despesa
--     e libera a geração futura (expense_generated = false);
--   paga: não mexe; se custo ou dentista mudaram, avisa 'despesa_paga';
--   sem despesa, nunca gerada, em returned/installed e custo > 0: cria.
-- Na edição o laboratório precisa pertencer à clínica e estar ativo, exceto o atual da prótese.
-- Devolve {"expense": {"id","amount"} | null, "aviso": 'despesa_paga' | null}.
-- Erros: PROTESE_NAO_ENCONTRADA, PACIENTE_INVALIDO, PROFISSIONAL_INVALIDO, LABORATORIO_INVALIDO.

CREATE OR REPLACE FUNCTION public.update_prosthetic(
  p_clinic_id UUID, p_id UUID, p_data JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_old     prosthetics%ROWTYPE;
  v_row     prosthetics%ROWTYPE;
  v_patient UUID := nullif(p_data->>'patient_id', '')::uuid;
  v_prof    UUID := nullif(p_data->>'professional_id', '')::uuid;
  v_lab     UUID := nullif(p_data->>'laboratory_id', '')::uuid;
  v_cost    NUMERIC(10,2) := round((p_data->>'lab_cost')::numeric, 2);
  v_exp     expenses%ROWTYPE;
  v_expense JSONB := NULL;
  v_aviso   TEXT := NULL;
  v_exp_id  UUID;
BEGIN
  SELECT * INTO v_old FROM prosthetics
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROTESE_NAO_ENCONTRADA'; END IF;

  IF v_patient IS NULL OR NOT EXISTS (
    SELECT 1 FROM patients WHERE id = v_patient AND clinic_id = p_clinic_id
  ) THEN RAISE EXCEPTION 'PACIENTE_INVALIDO'; END IF;

  IF v_prof IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM professionals WHERE id = v_prof AND clinic_id = p_clinic_id
  ) THEN RAISE EXCEPTION 'PROFISSIONAL_INVALIDO'; END IF;

  IF v_lab IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM laboratories WHERE id = v_lab AND clinic_id = p_clinic_id
      AND (active OR id = v_old.laboratory_id)
  ) THEN RAISE EXCEPTION 'LABORATORIO_INVALIDO'; END IF;

  UPDATE prosthetics
  SET patient_id      = v_patient,
      professional_id = v_prof,
      laboratory_id   = v_lab,
      laboratory      = NULL,  -- texto antigo é só leitura de registros migrados
      type            = nullif(btrim(p_data->>'type'), ''),
      tooth_region    = nullif(btrim(p_data->>'tooth_region'), ''),
      expected_at     = nullif(p_data->>'expected_at', '')::date,
      lab_cost        = v_cost,
      notes           = nullif(btrim(p_data->>'notes'), ''),
      updated_at      = now()
  WHERE id = p_id AND clinic_id = p_clinic_id
  RETURNING * INTO v_row;

  IF v_row.expense_id IS NOT NULL THEN
    SELECT * INTO v_exp FROM expenses
    WHERE id = v_row.expense_id AND clinic_id = p_clinic_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_exp.status = 'paid' THEN
        IF v_old.lab_cost IS DISTINCT FROM v_row.lab_cost
           OR v_old.professional_id IS DISTINCT FROM v_row.professional_id THEN
          v_aviso := 'despesa_paga';
        END IF;
      ELSIF coalesce(v_row.lab_cost, 0) = 0 THEN
        DELETE FROM expenses WHERE id = v_exp.id AND clinic_id = p_clinic_id;
        UPDATE prosthetics
        SET expense_id = NULL, expense_generated = false
        WHERE id = p_id AND clinic_id = p_clinic_id;
      ELSE
        UPDATE expenses
        SET amount = v_row.lab_cost, professional_id = v_row.professional_id, updated_at = now()
        WHERE id = v_exp.id AND clinic_id = p_clinic_id;
        v_expense := jsonb_build_object('id', v_exp.id, 'amount', v_row.lab_cost);
      END IF;
    END IF;
  ELSIF NOT v_row.expense_generated
        AND v_row.status IN ('returned', 'installed')
        AND coalesce(v_row.lab_cost, 0) > 0 THEN
    v_exp_id := public.prosthetic_create_expense(v_row);
    v_expense := jsonb_build_object('id', v_exp_id, 'amount', v_row.lab_cost);
  END IF;

  RETURN jsonb_build_object('expense', v_expense, 'aviso', v_aviso);
END;
$fn$;

-- ── Excluir prótese (service role) ──────────────────────────
-- Apaga a despesa ligada se ainda estiver a pagar; despesa paga permanece.
-- Devolve {"despesa": 'apagada' | 'mantida' | null}. Erro: PROTESE_NAO_ENCONTRADA.

CREATE OR REPLACE FUNCTION public.delete_prosthetic(
  p_clinic_id UUID, p_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_row     prosthetics%ROWTYPE;
  v_exp     expenses%ROWTYPE;
  v_despesa TEXT := NULL;
BEGIN
  SELECT * INTO v_row FROM prosthetics
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROTESE_NAO_ENCONTRADA'; END IF;

  IF v_row.expense_id IS NOT NULL THEN
    SELECT * INTO v_exp FROM expenses
    WHERE id = v_row.expense_id AND clinic_id = p_clinic_id
    FOR UPDATE;
    IF FOUND THEN
      IF v_exp.status = 'paid' THEN
        v_despesa := 'mantida';
      ELSE
        DELETE FROM expenses WHERE id = v_exp.id AND clinic_id = p_clinic_id;
        v_despesa := 'apagada';
      END IF;
    END IF;
  END IF;

  DELETE FROM prosthetics WHERE id = p_id AND clinic_id = p_clinic_id;

  RETURN jsonb_build_object('despesa', v_despesa);
END;
$fn$;

-- ── Permissões ──────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.prosthetic_create_expense(prosthetics) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_prosthetic(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_prosthetic(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.move_prosthetic(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_prosthetic(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE) TO service_role;
REVOKE ALL ON FUNCTION public.update_prosthetic(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_prosthetic(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.delete_prosthetic(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_prosthetic(UUID, UUID) TO service_role;
