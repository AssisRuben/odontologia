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
  payer_name        TEXT,   -- responsável financeiro (recibo no Receita Saúde)
  payer_cpf         TEXT,   -- só dígitos
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
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled','refunded')),
  due_date       DATE,
  paid_at        TIMESTAMPTZ,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  category        TEXT NOT NULL DEFAULT 'outras'
                  CHECK (category IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','outras')),
  deduction_group TEXT CHECK (deduction_group IN ('custeio','pessoal','emolumentos')),  -- NULL = não dedutível
  payment_method  TEXT CHECK (payment_method IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto')),
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,
  notes           TEXT,
  receipt_path    TEXT,   -- caminho no bucket expense-receipts
  receipt_name    TEXT,
  receipt_size    BIGINT,
  receipt_type    TEXT,
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recibos de pacientes marcados como lançados no Receita Saúde.
CREATE TABLE IF NOT EXISTS health_receipts (
  payment_id UUID PRIMARY KEY REFERENCES payments(id) ON DELETE CASCADE,
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
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
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','rejected','expired','completed')),
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


-- ── Cobrança (Asaas): colunas em payments e tabelas novas ───

ALTER TABLE payments ADD COLUMN IF NOT EXISTS budget_id               UUID REFERENCES budgets(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS charge_kind             TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS charge_group_id         UUID;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS installment_number      INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS installment_count       INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_charge_id      TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_installment_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_state          TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_url             TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_amount              NUMERIC(10,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS alert                   TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_charge_kind_check;
ALTER TABLE payments ADD CONSTRAINT payments_charge_kind_check CHECK (charge_kind IN ('manual','avulsa','carne','cartao_parcelado'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_state_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_state_check CHECK (provider_state IN ('creating','active'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_alert_check;
ALTER TABLE payments ADD CONSTRAINT payments_alert_check CHECK (alert IN ('chargeback','refunded_with_invoice'));

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_charge_uidx ON payments (clinic_id, provider_charge_id) WHERE provider_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_charge_group_idx ON payments (charge_group_id);

-- Conexão: somente servidor (RLS ligado, nenhuma policy para usuários)
CREATE TABLE IF NOT EXISTS payment_connections (
  clinic_id              UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL DEFAULT 'asaas',
  environment            TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
  api_key                TEXT NOT NULL,
  api_key_last4          TEXT NOT NULL,
  account_name           TEXT,
  webhook_id             TEXT,
  webhook_token          TEXT NOT NULL UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','invalid_key')),
  fine_percent           NUMERIC(5,2) NOT NULL DEFAULT 2,
  interest_percent_month NUMERIC(5,2) NOT NULL DEFAULT 1,
  nfse_auto              BOOLEAN NOT NULL DEFAULT FALSE,
  nfse_description       TEXT NOT NULL DEFAULT 'Serviços odontológicos: {descricao}',
  nfse_service_code      TEXT NOT NULL DEFAULT '4.12',
  nfse_iss_rate          NUMERIC(5,2),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cliente do paciente no Asaas (somente servidor)
CREATE TABLE IF NOT EXISTS payment_customers (
  clinic_id            UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id           UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  provider_customer_id TEXT NOT NULL,
  PRIMARY KEY (clinic_id, patient_id)
);

-- Eventos de webhook recebidos (somente servidor)
CREATE TABLE IF NOT EXISTS payment_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  event             TEXT NOT NULL,
  payload           JSONB NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('processed','failed','ignored')),
  error             TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_uidx ON payment_events (clinic_id, provider_event_id);

-- Notas fiscais de serviço (membros da clínica leem; escrita só pelo servidor)
CREATE TABLE IF NOT EXISTS fiscal_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  payment_id          UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  provider_invoice_id TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('scheduled','authorized','error','cancelling','cancelled')),
  number              TEXT,
  value               NUMERIC(10,2) NOT NULL,
  description         TEXT NOT NULL,
  pdf_url             TEXT,
  xml_url             TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_invoices_provider_uidx ON fiscal_invoices (clinic_id, provider_invoice_id) WHERE provider_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_invoices_active_payment_uidx ON fiscal_invoices (clinic_id, payment_id) WHERE status IN ('scheduled','authorized','cancelling');
CREATE INDEX IF NOT EXISTS fiscal_invoices_payment_idx ON fiscal_invoices (payment_id);

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
  type       TEXT NOT NULL CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','budget','budget_reminder')),
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
  budget_id           UUID REFERENCES budgets(id) ON DELETE SET NULL,
  type                TEXT NOT NULL CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','budget','budget_reminder','manual','auto_reply','incoming')),
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
CREATE UNIQUE INDEX IF NOT EXISTS messages_incoming_provider_uidx ON messages (clinic_id, provider_message_id) WHERE direction = 'in' AND provider_message_id IS NOT NULL;

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


-- ── RLS da cobrança ─────────────────────────────────────────

ALTER TABLE payment_connections ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role
ALTER TABLE payment_customers   ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role
ALTER TABLE payment_events      ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role
ALTER TABLE fiscal_invoices     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_member_select" ON fiscal_invoices;
CREATE POLICY "clinic_member_select" ON fiscal_invoices FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── RLS do livro-caixa ──────────────────────────────────────

ALTER TABLE health_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "health_receipts_select" ON health_receipts;
CREATE POLICY "health_receipts_select" ON health_receipts FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

DROP POLICY IF EXISTS "health_receipts_insert" ON health_receipts;
CREATE POLICY "health_receipts_insert" ON health_receipts FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids())
              AND EXISTS (SELECT 1 FROM payments p
                          WHERE p.id = payment_id AND p.clinic_id = health_receipts.clinic_id));

DROP POLICY IF EXISTS "health_receipts_delete" ON health_receipts;
CREATE POLICY "health_receipts_delete" ON health_receipts FOR DELETE TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Proteção dos lançamentos do Asaas ───────────────────────
-- Usuário logado (cliente do navegador) não altera nem apaga lançamento do
-- Asaas, nem transforma um manual em um do Asaas: isso passa pelas rotas da
-- API. O servidor (service role) não é afetado. Nota emitida segura o
-- lançamento (ON DELETE RESTRICT).

ALTER TABLE fiscal_invoices DROP CONSTRAINT IF EXISTS fiscal_invoices_payment_id_fkey;
ALTER TABLE fiscal_invoices ADD CONSTRAINT fiscal_invoices_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.payments_guard_provider_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF OLD.charge_kind <> 'manual' THEN
      RAISE EXCEPTION 'Lançamentos do Asaas só podem ser alterados pelo sistema';
    END IF;
    IF TG_OP = 'UPDATE' AND (
         NEW.charge_kind <> 'manual'
         OR NEW.provider_charge_id IS DISTINCT FROM OLD.provider_charge_id
         OR NEW.provider_installment_id IS DISTINCT FROM OLD.provider_installment_id
         OR NEW.provider_state IS DISTINCT FROM OLD.provider_state
         OR NEW.invoice_url IS DISTINCT FROM OLD.invoice_url
       ) THEN
      RAISE EXCEPTION 'Lançamentos do Asaas só podem ser alterados pelo sistema';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_guard_provider_rows ON payments;
CREATE TRIGGER payments_guard_provider_rows
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_guard_provider_rows();

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

-- ============================================================
-- FUNIL DE ORÇAMENTOS E ASSINATURA ELETRÔNICA
-- ============================================================

-- ── clinics: validade padrão do orçamento ───────────────────

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS budget_validity_days INTEGER NOT NULL DEFAULT 30
  CHECK (budget_validity_days BETWEEN 1 AND 180);

-- ── budgets: colunas novas ──────────────────────────────────

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS professional_id  UUID REFERENCES professionals(id) ON DELETE SET NULL;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sent_at          TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS viewed_at        TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS decided_at       TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS valid_until      DATE;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS approved_total   NUMERIC(10,2);
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS lost_reason      TEXT
  CHECK (lost_reason IN ('preco','pensar','outro_lugar','tempo','medo','sem_resposta','outro'));
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS followup_at      DATE;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS approval_seen_at TIMESTAMPTZ;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_status_check;
ALTER TABLE budgets ADD CONSTRAINT budgets_status_check
  CHECK (status IN ('draft','sent','approved','rejected','expired','completed'));

-- budget_items: aprovação por item (nulo até a decisão)
ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS approved BOOLEAN;

-- ── budget_links: link público (só o servidor acessa) ───────

CREATE TABLE IF NOT EXISTS budget_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  view_count      INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ
);
-- No máximo um link ativo por orçamento
CREATE UNIQUE INDEX IF NOT EXISTS budget_links_active_uidx ON budget_links (budget_id) WHERE revoked_at IS NULL;
ALTER TABLE budget_links ENABLE ROW LEVEL SECURITY;
-- Sem policy de propósito: o navegador nunca lê nem escreve; só a service role.

-- ── budget_signatures: assinatura (membros leem; escrita só pelo servidor) ──

CREATE TABLE IF NOT EXISTS budget_signatures (
  budget_id     UUID PRIMARY KEY REFERENCES budgets(id) ON DELETE CASCADE,
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('app','reception')),  -- uma migração futura estende (ex.: zapsign)
  provider_ref  TEXT,
  signer_name   TEXT NOT NULL,
  signer_cpf    TEXT,
  snapshot      JSONB NOT NULL,
  document_hash TEXT NOT NULL,    -- SHA-256 hex do snapshot canônico
  ip            TEXT,
  user_agent    TEXT,
  signed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL      -- aprovação pela recepção
);
ALTER TABLE budget_signatures ADD COLUMN IF NOT EXISTS link_id UUID REFERENCES budget_links(id) ON DELETE SET NULL;  -- link usado na assinatura (null = recepção)
ALTER TABLE budget_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON budget_signatures;
CREATE POLICY "clinic_member_select" ON budget_signatures FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── budget_events: histórico (membros leem e registram contatos) ──

CREATE TABLE IF NOT EXISTS budget_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id  UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('sent','resent','reminder','viewed','contact','approved','rejected','expired','reopened','edited')),
  outcome    TEXT CHECK (outcome IN ('nao_atendeu','pensar','aprovou','perdido')),  -- para type = 'contact'
  reason     TEXT,
  note       TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS budget_events_budget_idx ON budget_events (budget_id, created_at DESC);
ALTER TABLE budget_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON budget_events;
CREATE POLICY "clinic_member_select" ON budget_events FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));
DROP POLICY IF EXISTS "clinic_member_insert_contact" ON budget_events;
CREATE POLICY "clinic_member_insert_contact" ON budget_events FOR INSERT TO authenticated
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()) AND type = 'contact' AND created_by = auth.uid());

-- ── Dados antigos ───────────────────────────────────────────
-- Roda antes dos gatilhos e em modo sistema; só preenche o que ainda está vazio.

DO $$
BEGIN
  PERFORM set_config('app.budget_system', 'on', true);

  UPDATE budget_items SET approved = TRUE
  WHERE approved IS NULL
    AND budget_id IN (SELECT id FROM budgets WHERE status IN ('approved','completed'));

  UPDATE budgets SET approved_total = total, decided_at = created_at
  WHERE status IN ('approved','completed') AND approved_total IS NULL;

  UPDATE budgets SET lost_reason = 'outro', decided_at = created_at
  WHERE status = 'rejected' AND lost_reason IS NULL;

  PERFORM set_config('app.budget_system', 'off', true);
END $$;

-- ── Gatilhos: edição de orçamento enviado e trava de aprovado ──
-- Modo sistema (app.budget_system = 'on'): as funções send/approve/reject_budget
-- ligam essa chave na própria transação e os gatilhos não interferem.

-- Orçamento enviado que foi editado volta a rascunho, perde o link e registra o evento.
CREATE OR REPLACE FUNCTION public.budget_revert_to_draft(p_budget_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_clinic UUID;
BEGIN
  UPDATE budgets SET status = 'draft', updated_at = NOW()
  WHERE id = p_budget_id AND status = 'sent'
  RETURNING clinic_id INTO v_clinic;

  IF v_clinic IS NULL THEN
    RETURN;
  END IF;

  UPDATE budget_links SET revoked_at = NOW() WHERE budget_id = p_budget_id AND revoked_at IS NULL;
  INSERT INTO budget_events (budget_id, clinic_id, type, created_by)
  VALUES (p_budget_id, v_clinic, 'edited', auth.uid());
END;
$fn$;

REVOKE ALL ON FUNCTION public.budget_revert_to_draft(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.budgets_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF current_setting('app.budget_system', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Trava: aprovado/concluído não muda total nem valor aprovado, e só alterna
  -- entre approved e completed (não volta para rascunho nem vira perdido)
  IF OLD.status IN ('approved','completed') THEN
    IF NEW.total IS DISTINCT FROM OLD.total
       OR NEW.approved_total IS DISTINCT FROM OLD.approved_total
       OR (NEW.status IS DISTINCT FROM OLD.status
           AND NOT (OLD.status = 'approved' AND NEW.status = 'completed')
           AND NOT (OLD.status = 'completed' AND NEW.status = 'approved')) THEN
      RAISE EXCEPTION 'Orçamento aprovado não pode ser alterado. Reabra-o ou crie um novo.';
    END IF;
  END IF;

  -- Concluído só vem de aprovado
  IF NEW.status = 'completed' AND OLD.status NOT IN ('approved','completed') THEN
    RAISE EXCEPTION 'Só um orçamento aprovado pode ser concluído.';
  END IF;

  -- Só o servidor envia, aprova ou vence um orçamento
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('sent','approved','expired') THEN
    RAISE EXCEPTION 'Mudança de status não permitida pelo aplicativo.';
  END IF;

  NEW.updated_at := NOW();

  -- Enviado e editado (total ou validade): volta a rascunho
  IF OLD.status = 'sent' AND NEW.status = 'sent'
     AND (NEW.total IS DISTINCT FROM OLD.total OR NEW.valid_until IS DISTINCT FROM OLD.valid_until) THEN
    NEW.status := 'draft';
    UPDATE budget_links SET revoked_at = NOW() WHERE budget_id = OLD.id AND revoked_at IS NULL;
    INSERT INTO budget_events (budget_id, clinic_id, type, created_by)
    VALUES (OLD.id, OLD.clinic_id, 'edited', auth.uid());
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.budgets_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS budgets_guard_trg ON budgets;
CREATE TRIGGER budgets_guard_trg BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION public.budgets_guard();

CREATE OR REPLACE FUNCTION public.budget_items_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_budget UUID;
  v_status TEXT;
  v_changed BOOLEAN;
BEGIN
  IF current_setting('app.budget_system', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_budget := OLD.budget_id;
  ELSE
    v_budget := NEW.budget_id;
  END IF;

  SELECT status INTO v_status FROM budgets WHERE id = v_budget;

  -- Orçamento inexistente ou sendo apagado em cascata: nada a fazer
  IF v_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.budget_id IS DISTINCT FROM NEW.budget_id THEN
    RAISE EXCEPTION 'Não é possível mover itens entre orçamentos.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_changed := NEW.procedure  IS DISTINCT FROM OLD.procedure
              OR NEW.tooth      IS DISTINCT FROM OLD.tooth
              OR NEW.quantity   IS DISTINCT FROM OLD.quantity
              OR NEW.unit_price IS DISTINCT FROM OLD.unit_price;
    IF v_status IN ('approved','completed')
       AND (v_changed OR NEW.approved IS DISTINCT FROM OLD.approved OR NEW.budget_id IS DISTINCT FROM OLD.budget_id) THEN
      RAISE EXCEPTION 'Orçamento aprovado não pode ser alterado. Reabra-o ou crie um novo.';
    END IF;
  ELSE
    v_changed := TRUE;   -- inserir ou apagar item muda o conjunto de itens
    IF v_status IN ('approved','completed') THEN
      RAISE EXCEPTION 'Orçamento aprovado não pode ser alterado. Reabra-o ou crie um novo.';
    END IF;
  END IF;

  IF v_status = 'sent' AND v_changed THEN
    PERFORM public.budget_revert_to_draft(v_budget);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.budget_items_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS budget_items_guard_trg ON budget_items;
CREATE TRIGGER budget_items_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION public.budget_items_guard();

-- ── Funções do servidor (service role) ──────────────────────

-- Enviar: cria o link novo (desativa o anterior) e passa para 'sent'.
CREATE OR REPLACE FUNCTION public.send_budget(
  p_budget_id UUID, p_token TEXT, p_validity_days INT, p_actor UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
  v_clinic UUID;
BEGIN
  PERFORM set_config('app.budget_system', 'on', true);

  SELECT status, clinic_id INTO v_status, v_clinic FROM budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_status NOT IN ('draft','sent') THEN
    RETURN 'not_sendable';
  END IF;

  UPDATE budget_links SET revoked_at = NOW() WHERE budget_id = p_budget_id AND revoked_at IS NULL;
  INSERT INTO budget_links (budget_id, clinic_id, token) VALUES (p_budget_id, v_clinic, p_token);

  UPDATE budgets SET
    status      = 'sent',
    sent_at     = COALESCE(sent_at, NOW()),
    valid_until = CASE
      WHEN valid_until IS NULL OR valid_until < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
        THEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date + p_validity_days
      ELSE valid_until
    END,
    viewed_at   = NULL,
    updated_at  = NOW()
  WHERE id = p_budget_id;

  INSERT INTO budget_events (budget_id, clinic_id, type, created_by)
  VALUES (p_budget_id, v_clinic, 'sent', p_actor);

  RETURN 'ok';
END;
$fn$;

-- Aprovar: pelo paciente (p_link_id do link ativo) ou pela recepção (p_link_id nulo).
CREATE OR REPLACE FUNCTION public.approve_budget(
  p_budget_id UUID, p_link_id UUID, p_item_ids UUID[], p_approved_total NUMERIC,
  p_signature JSONB, p_actor UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
  v_clinic UUID;
BEGIN
  PERFORM set_config('app.budget_system', 'on', true);

  SELECT status, clinic_id INTO v_status, v_clinic FROM budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_link_id IS NOT NULL THEN
    IF v_status <> 'sent' OR NOT EXISTS (
      SELECT 1 FROM budget_links
      WHERE id = p_link_id AND budget_id = p_budget_id AND revoked_at IS NULL
        AND (locked_until IS NULL OR locked_until <= NOW())
    ) THEN
      RETURN 'already_decided';
    END IF;
  ELSIF v_status NOT IN ('sent','draft') THEN
    RETURN 'already_decided';
  END IF;

  UPDATE budget_items SET approved = (id = ANY(p_item_ids)) WHERE budget_id = p_budget_id;

  UPDATE budgets SET
    status         = 'approved',
    approved_total = p_approved_total,
    decided_at     = NOW(),
    followup_at    = NULL,
    lost_reason    = NULL,
    updated_at     = NOW()
  WHERE id = p_budget_id;

  INSERT INTO budget_signatures (
    budget_id, clinic_id, provider, provider_ref, signer_name, signer_cpf,
    snapshot, document_hash, ip, user_agent, signed_at, approved_by, link_id
  ) VALUES (
    p_budget_id, v_clinic,
    p_signature->>'provider',
    p_signature->>'provider_ref',
    p_signature->>'signer_name',
    p_signature->>'signer_cpf',
    p_signature->'snapshot',
    p_signature->>'document_hash',
    p_signature->>'ip',
    p_signature->>'user_agent',
    COALESCE((p_signature->>'signed_at')::timestamptz, NOW()),
    NULLIF(p_signature->>'approved_by', '')::uuid,
    p_link_id
  )
  ON CONFLICT (budget_id) DO UPDATE SET
    clinic_id     = EXCLUDED.clinic_id,
    provider      = EXCLUDED.provider,
    provider_ref  = EXCLUDED.provider_ref,
    signer_name   = EXCLUDED.signer_name,
    signer_cpf    = EXCLUDED.signer_cpf,
    snapshot      = EXCLUDED.snapshot,
    document_hash = EXCLUDED.document_hash,
    ip            = EXCLUDED.ip,
    user_agent    = EXCLUDED.user_agent,
    signed_at     = EXCLUDED.signed_at,
    approved_by   = EXCLUDED.approved_by,
    link_id       = EXCLUDED.link_id;

  UPDATE budget_links SET revoked_at = NOW() WHERE budget_id = p_budget_id AND revoked_at IS NULL;

  INSERT INTO budget_events (budget_id, clinic_id, type, created_by)
  VALUES (p_budget_id, v_clinic, 'approved', p_actor);

  RETURN 'ok';
END;
$fn$;

-- Perder: p_status = 'rejected' (recusou/recepção) ou 'expired' (rotina de vencimento).
CREATE OR REPLACE FUNCTION public.reject_budget(
  p_budget_id UUID, p_link_id UUID, p_reason TEXT, p_note TEXT, p_actor UUID, p_status TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
  v_clinic UUID;
  v_reason TEXT;
BEGIN
  IF p_status NOT IN ('rejected','expired') THEN
    RAISE EXCEPTION 'p_status inválido: %', p_status;
  END IF;

  PERFORM set_config('app.budget_system', 'on', true);

  SELECT status, clinic_id INTO v_status, v_clinic FROM budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_link_id IS NOT NULL THEN
    IF v_status <> 'sent' OR NOT EXISTS (
      SELECT 1 FROM budget_links
      WHERE id = p_link_id AND budget_id = p_budget_id AND revoked_at IS NULL
    ) THEN
      RETURN 'already_decided';
    END IF;
  ELSIF v_status NOT IN ('sent','draft') THEN
    RETURN 'already_decided';
  END IF;

  v_reason := COALESCE(NULLIF(p_reason, ''), CASE p_status WHEN 'expired' THEN 'sem_resposta' ELSE 'outro' END);

  UPDATE budgets SET
    status      = p_status,
    lost_reason = v_reason,
    decided_at  = NOW(),
    followup_at = NULL,
    updated_at  = NOW()
  WHERE id = p_budget_id;

  UPDATE budget_links SET revoked_at = NOW() WHERE budget_id = p_budget_id AND revoked_at IS NULL;

  INSERT INTO budget_events (budget_id, clinic_id, type, reason, note, created_by)
  VALUES (p_budget_id, v_clinic, p_status, v_reason, p_note, p_actor);

  RETURN 'ok';
END;
$fn$;

-- Só o servidor (service role) chama; usuários logados não.
REVOKE ALL ON FUNCTION public.send_budget(UUID, TEXT, INT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_budget(UUID, UUID, UUID[], NUMERIC, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_budget(UUID, UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Conta uma tentativa errada de CPF de forma atômica (uma única UPDATE).
-- Devolve true se o link está (ou acabou de ficar) bloqueado por 1 hora.
CREATE OR REPLACE FUNCTION public.register_failed_attempt(p_link_id UUID, p_clinic_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_locked BOOLEAN;
BEGIN
  UPDATE budget_links SET
    failed_attempts = CASE
      WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN failed_attempts
      WHEN failed_attempts + 1 >= 5 THEN 0
      ELSE failed_attempts + 1
    END,
    locked_until = CASE
      WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN locked_until
      WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '1 hour'
      ELSE locked_until
    END
  WHERE id = p_link_id AND clinic_id = p_clinic_id
  RETURNING (locked_until IS NOT NULL AND locked_until > NOW()) INTO v_locked;
  RETURN COALESCE(v_locked, FALSE);
END;
$fn$;
REVOKE ALL ON FUNCTION public.register_failed_attempt(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ── Seed das 8 configurações padrão de uma clínica ──────────
-- Mensagens de orçamento ligadas; as demais desligadas. Os textos devem ficar iguais a
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
  (p_clinic, 'charge', FALSE, 'Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.

{link}', '{"offset_days":[1,7]}'),
  (p_clinic, 'payment_due', FALSE, 'Olá, {paciente}! Sua parcela de {valor} na {clinica} vence em {vencimento}. Pague por aqui: {link}', '{"offset_days":[3]}'),
  (p_clinic, 'budget', TRUE, 'Olá, {paciente}! Segue seu orçamento da {clinica}, no valor de {valor}. Para ver os detalhes e aprovar: {link}', '{}'),
  (p_clinic, 'budget_reminder', TRUE, 'Olá, {paciente}! Seu orçamento na {clinica} ainda está disponível até {vencimento}. Para ver e aprovar: {link}', '{"offset_days":[3,7]}')
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
VALUES ('anneOdonto', 'anneOdonto', false)
ON CONFLICT (id) DO NOTHING;

-- Cada clínica só lista, envia e apaga na própria pasta.
-- O bucket é privado: as telas abrem os arquivos com links assinados (createSignedUrl).
CREATE POLICY "anneOdonto_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "anneOdonto_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "anneOdonto_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'anneOdonto'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));


-- ── Storage: comprovantes de despesa (privado) ──────────────
-- Arquivos ficam em expense-receipts/<clinic_id>/<expense_id>/<uuid>.<ext>

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "expense_receipts_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "expense_receipts_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));
CREATE POLICY "expense_receipts_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts'
         AND (storage.foldername(name))[1] IN (SELECT public.user_clinic_ids()::text));


-- ── IA: evolução e anamnese por voz ─────────────────────────

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
      FOR UPDATE OF bi, b;

      IF NOT FOUND OR NOT (
        (v_cur_status = 'pending' AND v_new_status IN ('in_progress','completed'))
        OR (v_cur_status = 'in_progress' AND v_new_status = 'completed')
      ) THEN
        RAISE EXCEPTION 'O item% já foi concluído ou mudou. Organize de novo.', COALESCE(' ' || v_procedure, '');
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
        RAISE EXCEPTION 'O tratamento% já foi concluído ou mudou. Organize de novo.', COALESCE(' ' || v_procedure, '');
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


-- ── Modelo de anamnese padrão (2026-11-06-anamnese-padrao.sql) ──
CREATE OR REPLACE FUNCTION public.seed_anamnesis_template(p_clinic UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- Só cria se a clínica ainda não tem nenhum modelo.
  IF EXISTS (SELECT 1 FROM anamnesis_templates WHERE clinic_id = p_clinic) THEN
    RETURN;
  END IF;

  INSERT INTO anamnesis_templates (clinic_id, name, questions)
  SELECT p_clinic, 'Anamnese Geral', jsonb_agg(
           jsonb_strip_nulls(jsonb_build_object(
             'id', gen_random_uuid()::text, 'text', q.text, 'type', q.type, 'options', q.options
           )) ORDER BY q.ord)
  FROM (VALUES
    (1,  'Está em tratamento médico atualmente?',          'yesno',   NULL::jsonb),
    (2,  'Faz uso de algum medicamento? Qual?',            'text',    NULL),
    (3,  'Tem alergia a algum medicamento ou material?',   'yesno',   NULL),
    (4,  'Tem pressão alta?',                              'yesno',   NULL),
    (5,  'Tem diabetes?',                                  'yesno',   NULL),
    (6,  'Tem problema cardíaco?',                         'yesno',   NULL),
    (7,  'Está grávida?',                                  'yesno',   NULL),
    (8,  'Fuma?',                                          'options', '["Não","Sim","Ex-fumante"]'),
    (9,  'Já teve reação à anestesia odontológica?',       'yesno',   NULL),
    (10, 'Com que frequência escova os dentes?',           'options', '["1 vez ao dia","2 vezes ao dia","3 ou mais vezes ao dia"]'),
    (11, 'Qual o motivo da consulta?',                     'text',    NULL)
  ) AS q(ord, text, type, options);
END;
$fn$;

-- Só o trigger e o SQL Editor chamam; usuários logados não.
REVOKE ALL ON FUNCTION public.seed_anamnesis_template(UUID) FROM PUBLIC, anon, authenticated;

-- Clínica nova: cria o modelo junto.
CREATE OR REPLACE FUNCTION public.on_clinic_created_seed_anamnesis()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public.seed_anamnesis_template(NEW.id);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.on_clinic_created_seed_anamnesis() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clinics_seed_anamnesis ON clinics;
CREATE TRIGGER clinics_seed_anamnesis
  AFTER INSERT ON clinics
  FOR EACH ROW EXECUTE FUNCTION public.on_clinic_created_seed_anamnesis();

-- Clínicas que já existem e não têm modelo.
SELECT public.seed_anamnesis_template(id) FROM clinics;

-- ============================================================
-- AGENTE DE IA NO WHATSAPP (etapa 6a)
-- ============================================================

-- ── conversations ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  phone           TEXT NOT NULL,
  patient_id      UUID REFERENCES patients(id) ON DELETE SET NULL,
  contact_name    TEXT,
  handler         TEXT NOT NULL DEFAULT 'agent' CHECK (handler IN ('agent','human')),
  handoff_reason  TEXT,
  handler_since   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unread          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clinic_id, phone)
);
CREATE INDEX IF NOT EXISTS conversations_clinic_last_idx ON conversations (clinic_id, last_message_at DESC);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Membros da clínica leem; escrita só pelo servidor (service role).
DROP POLICY IF EXISTS "clinic_member_select" ON conversations;
CREATE POLICY "clinic_member_select" ON conversations FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── messages: tipos novos e ligação com a conversa ──────────

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','budget','budget_reminder','manual','auto_reply','incoming','agent','human'));

ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS transcribed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);

-- ── Configuração do agente na clínica ───────────────────────

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS agent_config JSONB NOT NULL DEFAULT
  '{"enabled":false,"hours":{},"info":""}';

-- ── ai_usage: usos novos ────────────────────────────────────

ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_kind_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('transcricao','evolucao','anamnese','agente','transcricao_whatsapp'));

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
  authorization          TEXT NOT NULL CHECK (authorization IN ('pendente','autorizado','negado','nao_exige')),
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
      clinic_id, guide_id, treatment_id, code, name, teeth, value, requires_authorization, authorization
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
    SET authorization = v_item->>'authorization',
        denial_reason = v_item->>'denial_reason',
        active = (v_item->>'authorization') <> 'negado'
    WHERE id = (v_item->>'id')::uuid AND guide_id = p_guide_id AND clinic_id = p_clinic_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'GUIA_INVALIDA'; END IF;
  END LOOP;

  v_new_status := CASE WHEN EXISTS (
      SELECT 1 FROM insurance_guide_items
      WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND active AND authorization = 'pendente'
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
-- Item que já está em lote (ou inativo) não é movido.

CREATE OR REPLACE FUNCTION public.assign_batch_items(
  p_clinic_id UUID, p_batch_id UUID, p_item_ids UUID[]
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_status TEXT;
  v_count INT;
BEGIN
  SELECT status INTO v_status FROM insurance_batches
  WHERE id = p_batch_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
  IF v_status = 'enviado' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;

  UPDATE insurance_guide_items SET batch_id = p_batch_id
  WHERE id = ANY(p_item_ids) AND clinic_id = p_clinic_id AND batch_id IS NULL AND active;
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
