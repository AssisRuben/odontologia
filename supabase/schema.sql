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


-- ── Tabelas de mensagens ────────────────────────────────────

-- Conexão: somente servidor (RLS ligado, nenhuma policy para usuários)
CREATE TABLE IF NOT EXISTS whatsapp_connections (
  clinic_id   UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  instance    TEXT NOT NULL UNIQUE,
  token       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','connecting','connected')),
  phone       TEXT,
  ever_connected BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configuração por tipo de mensagem (membros da clínica leem e editam)
CREATE TABLE IF NOT EXISTS message_settings (
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('confirmation','reminder','recall','birthday','charge')),
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  template   TEXT NOT NULL,
  config     JSONB NOT NULL DEFAULT '{}',   -- { offset_hours } | { offset_months } | { offset_days: [1,7] }
  PRIMARY KEY (clinic_id, type)
);

-- Fila + histórico (membros da clínica leem; escrita só pelo servidor)
CREATE TABLE IF NOT EXISTS messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id          UUID REFERENCES patients(id) ON DELETE SET NULL,
  appointment_id      UUID REFERENCES appointments(id) ON DELETE SET NULL,
  payment_id          UUID REFERENCES payments(id) ON DELETE SET NULL,
  type                TEXT NOT NULL CHECK (type IN ('confirmation','reminder','recall','birthday','charge','manual','auto_reply','incoming')),
  direction           TEXT NOT NULL CHECK (direction IN ('out','in')),
  phone               TEXT NOT NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('queued','sending','sent','failed','cancelled','received')),
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,          -- depois disso, não enviar (ex.: início da consulta)
  attempts            INT NOT NULL DEFAULT 0,
  sent_at             TIMESTAMPTZ,
  error               TEXT,
  provider_message_id TEXT,
  reply_action        TEXT CHECK (reply_action IN ('confirmed','cancelled')),  -- em mensagens 'incoming'
  dedupe_key          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS messages_queue_idx ON messages (status, scheduled_for) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages (clinic_id, phone, sent_at DESC);

ALTER TABLE patients ADD COLUMN IF NOT EXISTS whatsapp_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clinics  ADD COLUMN IF NOT EXISTS messaging_config JSONB NOT NULL DEFAULT
  '{"window_start":"08:00","window_end":"20:00","daily_limit":300,"timezone":"America/Sao_Paulo"}';

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
-- Cada usuário só acessa a(s) clínica(s) em que tem um profissional
-- vinculado (professionals.user_id = auth.uid()).

-- SECURITY DEFINER para não depender da RLS de professionals (evita recursão).
CREATE OR REPLACE FUNCTION public.user_clinic_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
  SELECT clinic_id FROM professionals WHERE user_id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.user_clinic_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_clinic_ids() TO authenticated;

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
  END LOOP;
END $$;

-- Clínica: lê e edita só a sua. Criação pelo trigger de cadastro.
CREATE POLICY "clinic_member_select" ON clinics FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_clinic_ids()));
CREATE POLICY "clinic_member_update" ON clinics FOR UPDATE TO authenticated
  USING (id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (id IN (SELECT public.user_clinic_ids()));

-- Tabelas com clinic_id
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'professionals','insurance_plans','patients','appointments',
    'payments','expenses','prosthetics','inventory_items',
    'anamnesis_templates','anamneses','treatments','budgets',
    'documents','evolutions'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "clinic_member" ON %I FOR ALL TO authenticated
         USING (clinic_id IN (SELECT public.user_clinic_ids()))
         WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()))', t);
  END LOOP;
END $$;

-- Tabelas filhas (sem clinic_id): acesso pelo registro pai
CREATE POLICY "clinic_member" ON inventory_movements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = item_id
                 AND i.clinic_id IN (SELECT public.user_clinic_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = item_id
                 AND i.clinic_id IN (SELECT public.user_clinic_ids())));

CREATE POLICY "clinic_member" ON treatment_teeth FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM treatments tr WHERE tr.id = treatment_id
                 AND tr.clinic_id IN (SELECT public.user_clinic_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM treatments tr WHERE tr.id = treatment_id
                 AND tr.clinic_id IN (SELECT public.user_clinic_ids())));

CREATE POLICY "clinic_member" ON budget_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id
                 AND b.clinic_id IN (SELECT public.user_clinic_ids())))
  WITH CHECK (EXISTS (SELECT 1 FROM budgets b WHERE b.id = budget_id
                 AND b.clinic_id IN (SELECT public.user_clinic_ids())));


-- ── RLS das tabelas de mensagens ────────────────────────────

ALTER TABLE whatsapp_connections ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role
ALTER TABLE message_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_member_select" ON message_settings;
CREATE POLICY "clinic_member_select" ON message_settings FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

DROP POLICY IF EXISTS "clinic_member_update" ON message_settings;
CREATE POLICY "clinic_member_update" ON message_settings FOR UPDATE TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

DROP POLICY IF EXISTS "clinic_member_select" ON messages;
CREATE POLICY "clinic_member_select" ON messages FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Seed das 5 configurações padrão de uma clínica ──────────
-- Tudo desligado (enabled = false). Os textos devem ficar iguais a
-- DEFAULT_TEMPLATES em src/lib/messaging/templates.ts (há um teste).

CREATE OR REPLACE FUNCTION public.seed_message_settings(p_clinic UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO message_settings (clinic_id, type, enabled, template, config) VALUES
  (p_clinic, 'confirmation', FALSE, 'Olá, {paciente}! Sua consulta na {clinica} está marcada para {data} às {hora} com {profissional}.

Responda *1* para confirmar ou *2* para desmarcar.', '{"offset_hours":24}'),
  (p_clinic, 'reminder', FALSE, 'Olá, {paciente}! Lembrete: sua consulta na {clinica} é hoje às {hora}. Até logo!', '{"offset_hours":2}'),
  (p_clinic, 'recall', FALSE, 'Olá, {paciente}! Já faz um tempo desde sua última visita à {clinica}. Que tal agendar sua revisão? É só responder esta mensagem.', '{"offset_months":6}'),
  (p_clinic, 'birthday', FALSE, 'Feliz aniversário, {paciente}! 🎉 A equipe da {clinica} deseja um dia muito especial para você.', '{}'),
  (p_clinic, 'charge', FALSE, 'Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.', '{"offset_days":[1,7]}')
  ON CONFLICT (clinic_id, type) DO NOTHING;
END;
$fn$;

-- Só o servidor/trigger chama; usuários logados não.
REVOKE ALL ON FUNCTION public.seed_message_settings(UUID) FROM PUBLIC, anon, authenticated;

-- ── Cadastro: cria clínica + profissional + configs de mensagens ──
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

  PERFORM public.seed_message_settings(new_clinic_id);

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

-- Cada clínica só lista, envia e apaga na própria pasta.
-- Atenção: o bucket é público — quem tiver o link direto abre o arquivo.
CREATE POLICY "anneOdonto_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "anneOdonto_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "anneOdonto_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
