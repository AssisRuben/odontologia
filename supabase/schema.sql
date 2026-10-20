-- ============================================================
-- SCHEMA COMPLETO - DENTAL APP
-- Cria do zero todas as tabelas, permissões (RLS), o bucket de
-- documentos e o trigger que cria clínica + profissional no cadastro.
--
-- Como usar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Rodar apenas UMA vez num banco novo.
-- ============================================================


-- ── Clínica e cadastros básicos ─────────────────────────────

CREATE TABLE clinics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  cnpj           TEXT,
  phone          TEXT,
  address        TEXT,
  card_rates     JSONB,
  whatsapp_key   TEXT,
  whatsapp_phone TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE professionals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  cro           TEXT,
  specialty     TEXT,
  color         TEXT NOT NULL DEFAULT '#3B82F6',
  working_hours JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE insurance_plans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE patients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  cpf               TEXT,
  phone             TEXT,
  whatsapp          TEXT,
  email             TEXT,
  birthdate         DATE,
  gender            TEXT,
  address           JSONB,  -- { street, number, complement, neighborhood, city, state, zip }
  insurance_plan_id UUID REFERENCES insurance_plans(id) ON DELETE SET NULL,
  notes             TEXT,   -- texto livre ou JSON { tags, notes }
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Agenda e financeiro ─────────────────────────────────────

CREATE TABLE appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','confirmed','waiting','in_progress','completed','cancelled','no_show')),
  procedure       TEXT,
  notes           TEXT,
  color           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  amount         NUMERIC(10,2) NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto','convenio')),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue')),
  due_date       DATE,
  paid_at        TIMESTAMPTZ,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  category    TEXT,
  due_date    DATE,
  paid_at     TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Prótese e estoque ───────────────────────────────────────

CREATE TABLE prosthetics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,
  laboratory      TEXT,
  type            TEXT,
  status          TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','sent_to_lab','returned','installed')),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_at     DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  category     TEXT,
  quantity     INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  unit         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory_movements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('in','out')),
  quantity   INTEGER NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Prontuário do paciente ──────────────────────────────────

CREATE TABLE anamnesis_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  questions  JSONB NOT NULL DEFAULT '[]',  -- [{ id, text, type: text|yesno|options, options? }]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE anamneses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  template_id UUID REFERENCES anamnesis_templates(id) ON DELETE SET NULL,
  answers     JSONB NOT NULL DEFAULT '{}',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE treatments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id   UUID REFERENCES professionals(id) ON DELETE SET NULL,
  insurance_plan_id UUID REFERENCES insurance_plans(id) ON DELETE SET NULL,
  procedure         TEXT NOT NULL,
  value             NUMERIC(10,2) NOT NULL DEFAULT 0,
  date              DATE NOT NULL DEFAULT CURRENT_DATE,
  status            TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned','in_progress','completed','cancelled')),
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE treatment_teeth (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id UUID NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
  tooth_number INTEGER NOT NULL,
  faces        TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE budgets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','completed')),
  notes      TEXT,
  total      NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE budget_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id  UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  procedure  TEXT NOT NULL,
  tooth      TEXT,
  quantity   INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE documents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  file_url   TEXT NOT NULL,
  file_type  TEXT,
  size_bytes BIGINT,
  category   TEXT NOT NULL DEFAULT 'outros',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE evolutions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id  UUID REFERENCES appointments(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT,
  images          TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Índices das consultas mais usadas ───────────────────────

CREATE INDEX ON professionals (clinic_id);
CREATE INDEX ON professionals (user_id);
CREATE INDEX ON patients (clinic_id);
CREATE INDEX ON appointments (clinic_id, start_time);
CREATE INDEX ON payments (clinic_id, due_date);
CREATE INDEX ON expenses (clinic_id, due_date);
CREATE INDEX ON treatments (patient_id);
CREATE INDEX ON treatment_teeth (treatment_id);
CREATE INDEX ON budgets (patient_id);
CREATE INDEX ON documents (patient_id);
CREATE INDEX ON anamneses (patient_id);
CREATE INDEX ON evolutions (patient_id);


-- ── Permissões (RLS) ────────────────────────────────────────
-- Mesmo modelo do banco original: qualquer usuário logado lê e
-- escreve em tudo. Suficiente para desenvolvimento; antes de ir
-- para produção, restringir por clinic_id.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clinics','professionals','insurance_plans','patients','appointments',
    'payments','expenses','prosthetics','inventory_items','inventory_movements',
    'anamnesis_templates','anamneses','treatments','treatment_teeth',
    'budgets','budget_items','documents','evolutions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;


-- ── Cadastro: cria clínica + profissional para cada novo usuário ──
-- A tela /register envia name e clinic_name em user_metadata.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_clinic_id UUID;
BEGIN
  INSERT INTO clinics (name)
  VALUES (COALESCE(NULLIF(NEW.raw_user_meta_data->>'clinic_name', ''), 'Minha Clínica'))
  RETURNING id INTO new_clinic_id;

  INSERT INTO professionals (clinic_id, user_id, name)
  VALUES (new_clinic_id, NEW.id, COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), NEW.email));

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── Storage: bucket dos documentos do paciente ──────────────
-- Arquivos ficam em anneOdonto/<clinic_id>/<patient_id>/<arquivo>

INSERT INTO storage.buckets (id, name, public)
VALUES ('anneOdonto', 'anneOdonto', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "anneOdonto_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'anneOdonto');
CREATE POLICY "anneOdonto_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'anneOdonto');
CREATE POLICY "anneOdonto_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'anneOdonto');
