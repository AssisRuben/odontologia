-- Tabela de evoluções clínicas
CREATE TABLE IF NOT EXISTS evolutions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id   UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  description  TEXT,
  images       TEXT[],
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE evolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON evolutions FOR ALL TO authenticated USING (true) WITH CHECK (true);
