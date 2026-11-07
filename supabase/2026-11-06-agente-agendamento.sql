-- ============================================================
-- AGENDAMENTO PELO AGENTE DO WHATSAPP (etapa 6b)
-- Acrescenta: professionals.whatsapp_booking, patients.source,
-- appointments.source, conversations.offers/booking_draft/searches,
-- messages.agent_action, o índice de agenda por profissional e a função
-- book_whatsapp_appointment (grava a consulta sem conflito de horário).
-- Os tipos de consulta e as regras ficam em clinics.agent_config (JSON).
-- Tudo é acessado só pelo servidor (service role).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

ALTER TABLE professionals ADD COLUMN IF NOT EXISTS whatsapp_booking BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE patients      ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE appointments  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS offers        JSONB NOT NULL DEFAULT '[]';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS booking_draft JSONB;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS searches      JSONB NOT NULL DEFAULT '[]';

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_agent_action_check;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_action TEXT;
ALTER TABLE messages ADD CONSTRAINT messages_agent_action_check CHECK (agent_action IN ('marcada','remarcada','desmarcada'));

CREATE INDEX IF NOT EXISTS appointments_professional_start_idx ON appointments (professional_id, start_time);

-- ── Marcar (ou remarcar) pelo WhatsApp, sem conflito (service role) ──
-- Serializa as gravações do mesmo profissional. Erros:
--   HORARIO_OCUPADO  → já existe consulta ativa no intervalo
--   CONSULTA_INVALIDA → profissional, paciente ou consulta a remarcar inválidos
-- Se p_replace_id vier, a consulta antiga é cancelada na mesma transação.

CREATE OR REPLACE FUNCTION public.book_whatsapp_appointment(
  p_clinic_id UUID, p_patient_id UUID, p_professional_id UUID,
  p_start TIMESTAMPTZ, p_end TIMESTAMPTZ, p_procedure TEXT,
  p_replace_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_professional_id::text));

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start
     OR NOT EXISTS (SELECT 1 FROM professionals WHERE id = p_professional_id AND clinic_id = p_clinic_id)
     OR NOT EXISTS (SELECT 1 FROM patients WHERE id = p_patient_id AND clinic_id = p_clinic_id)
     OR (p_replace_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM appointments
          WHERE id = p_replace_id AND clinic_id = p_clinic_id AND patient_id = p_patient_id
            AND status IN ('scheduled','confirmed')))
  THEN
    RAISE EXCEPTION 'CONSULTA_INVALIDA';
  END IF;

  IF EXISTS (
    SELECT 1 FROM appointments
    WHERE clinic_id = p_clinic_id
      AND professional_id = p_professional_id
      AND status NOT IN ('cancelled','no_show')
      AND (p_replace_id IS NULL OR id <> p_replace_id)
      AND start_time < p_end AND end_time > p_start
  ) THEN
    RAISE EXCEPTION 'HORARIO_OCUPADO';
  END IF;

  INSERT INTO appointments (clinic_id, patient_id, professional_id, start_time, end_time, status, procedure, source)
  VALUES (p_clinic_id, p_patient_id, p_professional_id, p_start, p_end, 'scheduled', p_procedure, 'whatsapp')
  RETURNING id INTO v_id;

  IF p_replace_id IS NOT NULL THEN
    UPDATE appointments SET status = 'cancelled'
    WHERE id = p_replace_id AND clinic_id = p_clinic_id AND patient_id = p_patient_id
      AND status IN ('scheduled','confirmed');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONSULTA_INVALIDA';
    END IF;
  END IF;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.book_whatsapp_appointment(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_whatsapp_appointment(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID) TO service_role;
