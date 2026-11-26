-- ============================================================
-- QUEM CANCELOU A CONSULTA (paciente ou dentista)
-- Acrescenta: a coluna cancelled_by em appointments ('patient' ou 'professional';
-- vazia nos cancelamentos antigos), o gatilho que apaga a coluna quando a consulta
-- deixa de estar cancelada e uma nova versão de book_whatsapp_appointment: a consulta
-- remarcada pelo agente do WhatsApp fica "cancelada pelo paciente".
-- Rode depois de supabase/2026-11-22-importacao-codental.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Quem cancelou ───────────────────────────────────────────
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_cancelled_by_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_cancelled_by_check
  CHECK (cancelled_by IN ('patient','professional'));

-- Consulta que não está cancelada não tem "quem cancelou", venha a mudança de onde vier.
CREATE OR REPLACE FUNCTION public.appointments_cancelled_by_clear()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.status <> 'cancelled' THEN
    NEW.cancelled_by := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS appointments_cancelled_by_clear ON appointments;
CREATE TRIGGER appointments_cancelled_by_clear
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_cancelled_by_clear();

-- ── Marcar (ou remarcar) pelo WhatsApp: a consulta remarcada fica cancelada pelo paciente ──

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
    UPDATE appointments SET status = 'cancelled', cancelled_by = 'patient'
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
