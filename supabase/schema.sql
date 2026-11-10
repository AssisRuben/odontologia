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
  IF NEW.status = 'completed' AND TG_OP = 'INSERT' THEN
    -- Lançado já concluído (registro posterior): usa a data do tratamento, nunca no futuro.
    NEW.completed_at := COALESCE(NEW.completed_at,
      LEAST(NEW.date, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date));
  ELSIF NEW.status = 'completed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, (NOW() AT TIME ZONE 'America/Sao_Paulo')::date);
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
  requested_at         DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date,
  responded_at         TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE insurance_guides ALTER COLUMN requested_at SET DEFAULT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;

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
-- Erros: GUIA_INVALIDA, GUIA_CANCELADA, GUIA_EM_LOTE (algum item citado já está em lote).
-- Número, senha e validade só mudam se nenhum item da guia estiver em lote
-- (eles saem no lote já montado); senão ficam os gravados.
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
  v_em_lote BOOLEAN;
BEGIN
  SELECT status INTO v_status FROM insurance_guides
  WHERE id = p_guide_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GUIA_INVALIDA'; END IF;
  IF v_status = 'cancelada' THEN RAISE EXCEPTION 'GUIA_CANCELADA'; END IF;
  IF EXISTS (SELECT 1 FROM insurance_guide_items i
             JOIN jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e ON i.id = (e->>'id')::uuid
             WHERE i.guide_id = p_guide_id AND i.clinic_id = p_clinic_id AND i.batch_id IS NOT NULL) THEN
    RAISE EXCEPTION 'GUIA_EM_LOTE';
  END IF;
  v_em_lote := EXISTS (SELECT 1 FROM insurance_guide_items
                       WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND batch_id IS NOT NULL);

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
  SET guide_number = CASE WHEN v_em_lote THEN guide_number ELSE p_number END,
      password = CASE WHEN v_em_lote THEN password ELSE p_password END,
      password_valid_until = CASE WHEN v_em_lote THEN password_valid_until ELSE p_valid_until END,
      responded_at = NOW(), status = v_new_status
  WHERE id = p_guide_id AND clinic_id = p_clinic_id;

  RETURN v_new_status;
END;
$fn$;

-- ── Cancelar guia (service role) ────────────────────────────
-- Erros: GUIA_INVALIDA, GUIA_CANCELADA.
-- Desativa só os itens fora de lote. Sem item em lote a guia fica 'cancelada';
-- com item em lote ela continua valendo para eles e o status é recalculado.

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

  UPDATE insurance_guide_items SET active = FALSE
  WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND batch_id IS NULL;

  UPDATE insurance_guides
  SET status = CASE
    WHEN NOT EXISTS (SELECT 1 FROM insurance_guide_items
                     WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND batch_id IS NOT NULL)
      THEN 'cancelada'
    WHEN EXISTS (SELECT 1 FROM insurance_guide_items
                 WHERE guide_id = p_guide_id AND clinic_id = p_clinic_id AND active AND "authorization" = 'pendente')
      THEN 'aguardando'
    ELSE 'liberada' END
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
  IF v_status <> 'aberto' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;

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
  IF v_status <> 'aberto' THEN RAISE EXCEPTION 'LOTE_ENVIADO'; END IF;
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

-- ============================================================
-- COMISSÃO DOS DENTISTAS (item 8)
-- Acrescenta: percentuais e mês inicial da comissão em professionals, a categoria de despesa
-- 'comissoes', a tabela commission_closings (fechamento mensal por dentista, com o
-- extrato congelado) e as funções que fecham, reabrem, pagam e desfazem o pagamento
-- de uma comissão (service role). O pagamento cria a despesa no livro-caixa.
-- Rode depois de supabase/2026-11-08-convenios-pagamentos.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Percentuais do dentista (nulo = sem comissão configurada) ──

ALTER TABLE professionals ADD COLUMN IF NOT EXISTS commission_rate           NUMERIC(5,2);
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS commission_rate_insurance NUMERIC(5,2);

ALTER TABLE professionals DROP CONSTRAINT IF EXISTS professionals_commission_rate_check;
ALTER TABLE professionals ADD CONSTRAINT professionals_commission_rate_check
  CHECK (commission_rate IS NULL OR commission_rate BETWEEN 0 AND 100);
ALTER TABLE professionals DROP CONSTRAINT IF EXISTS professionals_commission_rate_insurance_check;
ALTER TABLE professionals ADD CONSTRAINT professionals_commission_rate_insurance_check
  CHECK (commission_rate_insurance IS NULL OR commission_rate_insurance BETWEEN 0 AND 100);

-- Mês a partir do qual há comissão (dia 1). O que for anterior não entra no cálculo,
-- nem como ajuste; nulo = sem comissão. Dentista que já tem percentual começa no mês atual.
ALTER TABLE professionals ADD COLUMN IF NOT EXISTS commission_start DATE;
ALTER TABLE professionals DROP CONSTRAINT IF EXISTS professionals_commission_start_check;
ALTER TABLE professionals ADD CONSTRAINT professionals_commission_start_check
  CHECK (commission_start IS NULL OR EXTRACT(DAY FROM commission_start) = 1);
UPDATE professionals
SET commission_start = date_trunc('month', (NOW() AT TIME ZONE 'America/Sao_Paulo'))::date
WHERE commission_rate IS NOT NULL AND commission_start IS NULL;

-- ── Categoria de despesa 'comissoes' ────────────────────────

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check
  CHECK (category IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','comissoes','outras'));

-- ── Fechamento mensal da comissão ───────────────────────────

CREATE TABLE IF NOT EXISTS commission_closings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  period          DATE NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),  -- dia 1 do mês
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  statement       JSONB NOT NULL,  -- resumo e extrato congelados, com os percentuais usados
  status          TEXT NOT NULL DEFAULT 'fechado' CHECK (status IN ('fechado','pago')),
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at         DATE,
  payment_method  TEXT CHECK (payment_method IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto')),
  expense_id      UUID REFERENCES expenses(id) ON DELETE SET NULL,
  UNIQUE (clinic_id, professional_id, period)
);

CREATE INDEX IF NOT EXISTS commission_closings_clinic_period_idx ON commission_closings (clinic_id, period);

ALTER TABLE commission_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member_select" ON commission_closings;
CREATE POLICY "clinic_member_select" ON commission_closings FOR SELECT TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Fechar o mês de um dentista (service role) ──────────────
-- O valor vem do cálculo no servidor. Devolve o id do fechamento.
-- Erros: PERIODO_INVALIDO (não é dia 1), PROFISSIONAL_INVALIDO, MES_ABERTO (o mês
-- ainda não terminou em São Paulo), VALOR_INVALIDO (<= 0), FECHAMENTO_EXISTE,
-- FECHAMENTO_POSTERIOR (já há fechamento do dentista em mês posterior),
-- ANTES_DO_INICIO (dentista sem mês inicial ou mês anterior a ele).

CREATE OR REPLACE FUNCTION public.close_commission(
  p_clinic_id UUID, p_professional_id UUID, p_period DATE, p_amount NUMERIC, p_statement JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_id UUID;
  v_start DATE;
BEGIN
  IF p_period IS NULL OR EXTRACT(DAY FROM p_period) <> 1 THEN RAISE EXCEPTION 'PERIODO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_professional_id::text));

  SELECT commission_start INTO v_start FROM professionals WHERE id = p_professional_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFISSIONAL_INVALIDO'; END IF;
  IF (p_period + INTERVAL '1 month' - INTERVAL '1 day')::date >= (NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'MES_ABERTO';
  END IF;
  IF v_start IS NULL OR p_period < v_start THEN RAISE EXCEPTION 'ANTES_DO_INICIO'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'VALOR_INVALIDO'; END IF;
  IF EXISTS (SELECT 1 FROM commission_closings
             WHERE clinic_id = p_clinic_id AND professional_id = p_professional_id AND period = p_period) THEN
    RAISE EXCEPTION 'FECHAMENTO_EXISTE';
  END IF;
  IF EXISTS (SELECT 1 FROM commission_closings
             WHERE clinic_id = p_clinic_id AND professional_id = p_professional_id AND period > p_period) THEN
    RAISE EXCEPTION 'FECHAMENTO_POSTERIOR';
  END IF;

  INSERT INTO commission_closings (clinic_id, professional_id, period, amount, statement)
  VALUES (p_clinic_id, p_professional_id, p_period, p_amount, p_statement)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ── Reabrir um mês fechado (service role) ───────────────────
-- Apaga o fechamento. Erros: FECHAMENTO_INVALIDO, FECHAMENTO_PAGO,
-- FECHAMENTO_POSTERIOR (há fechamento do dentista em mês posterior).

CREATE OR REPLACE FUNCTION public.reopen_commission(
  p_clinic_id UUID, p_closing_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_prof_id UUID;
  v_closing commission_closings%ROWTYPE;
BEGIN
  SELECT professional_id INTO v_prof_id FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_prof_id::text));

  SELECT * INTO v_closing FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;
  IF v_closing.status <> 'fechado' THEN RAISE EXCEPTION 'FECHAMENTO_PAGO'; END IF;
  IF EXISTS (SELECT 1 FROM commission_closings
             WHERE clinic_id = p_clinic_id AND professional_id = v_closing.professional_id
               AND period > v_closing.period) THEN
    RAISE EXCEPTION 'FECHAMENTO_POSTERIOR';
  END IF;

  DELETE FROM commission_closings WHERE id = p_closing_id AND clinic_id = p_clinic_id;
END;
$fn$;

-- ── Pagar a comissão (service role) ─────────────────────────
-- Cria a despesa paga no livro-caixa e liga ao fechamento. Devolve o id da despesa.
-- Forma de pagamento inválida → CHECK de expenses (23514).
-- Erros: FECHAMENTO_INVALIDO, FECHAMENTO_JA_PAGO.

CREATE OR REPLACE FUNCTION public.pay_commission(
  p_clinic_id UUID, p_closing_id UUID, p_paid_at DATE, p_method TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_prof_id UUID;
  v_closing commission_closings%ROWTYPE;
  v_name TEXT;
  v_expense_id UUID;
BEGIN
  SELECT professional_id INTO v_prof_id FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_prof_id::text));

  SELECT * INTO v_closing FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;
  IF v_closing.status <> 'fechado' THEN RAISE EXCEPTION 'FECHAMENTO_JA_PAGO'; END IF;

  SELECT name INTO v_name FROM professionals
  WHERE id = v_closing.professional_id AND clinic_id = p_clinic_id;

  INSERT INTO expenses (clinic_id, description, amount, category, deduction_group, payment_method,
                        professional_id, due_date, paid_at, status)
  VALUES (p_clinic_id,
          'Comissão — ' || COALESCE(v_name, '') || ' — ' || to_char(v_closing.period, 'MM/YYYY'),
          v_closing.amount, 'comissoes', 'custeio', p_method,
          v_closing.professional_id, p_paid_at,
          (p_paid_at::text || 'T12:00:00Z')::timestamptz, 'paid')
  RETURNING id INTO v_expense_id;

  UPDATE commission_closings
  SET status = 'pago', paid_at = p_paid_at, payment_method = p_method, expense_id = v_expense_id
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;

  RETURN v_expense_id;
END;
$fn$;

-- ── Desfazer o pagamento (service role) ─────────────────────
-- Apaga a despesa ligada e volta o fechamento a 'fechado'.
-- Erros: FECHAMENTO_INVALIDO, FECHAMENTO_NAO_PAGO.

CREATE OR REPLACE FUNCTION public.undo_commission_payment(
  p_clinic_id UUID, p_closing_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_prof_id UUID;
  v_closing commission_closings%ROWTYPE;
BEGIN
  SELECT professional_id INTO v_prof_id FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_prof_id::text));

  SELECT * INTO v_closing FROM commission_closings
  WHERE id = p_closing_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FECHAMENTO_INVALIDO'; END IF;
  IF v_closing.status <> 'pago' THEN RAISE EXCEPTION 'FECHAMENTO_NAO_PAGO'; END IF;

  UPDATE commission_closings
  SET status = 'fechado', paid_at = NULL, payment_method = NULL, expense_id = NULL
  WHERE id = p_closing_id AND clinic_id = p_clinic_id;

  IF v_closing.expense_id IS NOT NULL THEN
    DELETE FROM expenses WHERE id = v_closing.expense_id AND clinic_id = p_clinic_id;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.close_commission(UUID, UUID, DATE, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_commission(UUID, UUID, DATE, NUMERIC, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.reopen_commission(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_commission(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.pay_commission(UUID, UUID, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pay_commission(UUID, UUID, DATE, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.undo_commission_payment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_commission_payment(UUID, UUID) TO service_role;


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
-- Devolve {"expense": {"id","amount"} | null, "aviso": 'despesa_paga' | null, "despesa_removida": bool}.
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
  v_removida BOOLEAN := false;
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
        v_removida := true;
      ELSIF v_old.lab_cost IS DISTINCT FROM v_row.lab_cost
            OR v_old.professional_id IS DISTINCT FROM v_row.professional_id THEN
        UPDATE expenses
        SET amount = v_row.lab_cost, professional_id = v_row.professional_id, updated_at = now()
        WHERE id = v_exp.id AND clinic_id = p_clinic_id;
        v_expense := jsonb_build_object('id', v_exp.id, 'amount', v_row.lab_cost);
      ELSE
        -- custo e dentista não mudaram: preserva a despesa como está no Financeiro
        v_expense := jsonb_build_object('id', v_exp.id, 'amount', v_exp.amount);
      END IF;
    END IF;
  ELSIF NOT v_row.expense_generated
        AND v_row.status IN ('returned', 'installed')
        AND coalesce(v_row.lab_cost, 0) > 0 THEN
    v_exp_id := public.prosthetic_create_expense(v_row);
    v_expense := jsonb_build_object('id', v_exp_id, 'amount', v_row.lab_cost);
  END IF;

  RETURN jsonb_build_object('expense', v_expense, 'aviso', v_aviso, 'despesa_removida', v_removida);
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


-- ============================================================
-- ESTOQUE: LOTES, VALIDADE, HISTÓRICO E FUNÇÕES DE MOVIMENTAÇÃO
-- Acrescenta: colunas novas em inventory_items (ativo, controle de validade, quantidade
-- ideal, fornecedor), a tabela inventory_lots (lotes com validade), colunas novas em
-- inventory_movements (clinic_id, tipo, lote, despesa, observação, autor) e as funções
-- create_inventory_item, update_inventory_item, inventory_entry, inventory_exit,
-- inventory_count e inventory_discard_lot (service role). Na entrada de compra com valor,
-- a despesa (paga ou a pagar) é criada no Financeiro. Produtos com nome repetido (ignorando
-- maiúsculas e espaços) são renomeados com " (2)", " (3)"... antes do índice único.
-- Rode depois de supabase/2026-11-10-protese.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── inventory_items: colunas novas ──────────────────────────

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS active         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS tracks_expiry  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS ideal_quantity INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier       TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Saldos negativos antigos viram 0 para os CHECKs abaixo não falharem.
UPDATE inventory_items SET quantity = 0     WHERE quantity < 0;
UPDATE inventory_items SET min_quantity = 0 WHERE min_quantity < 0;

ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_quantity_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_quantity_check CHECK (quantity >= 0);
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_min_quantity_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_min_quantity_check CHECK (min_quantity >= 0);
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_ideal_quantity_check;
ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_ideal_quantity_check
  CHECK (ideal_quantity IS NULL OR ideal_quantity >= 0);

-- ── Nomes repetidos: o mais antigo fica, os demais ganham " (2)", " (3)"... ──

DO $$
DECLARE
  r      RECORD;
  v_base TEXT;
  v_n    INTEGER;
BEGIN
  FOR r IN
    SELECT id, clinic_id, btrim(name) AS base,
           row_number() OVER (PARTITION BY clinic_id, lower(btrim(name))
                              ORDER BY created_at, id) AS rn
    FROM inventory_items
  LOOP
    CONTINUE WHEN r.rn = 1;
    v_base := r.base;
    v_n := r.rn;
    -- pula sufixos que já estejam em uso na mesma clínica
    WHILE EXISTS (
      SELECT 1 FROM inventory_items i
      WHERE i.clinic_id = r.clinic_id
        AND i.id <> r.id
        AND lower(btrim(i.name)) = lower(v_base || ' (' || v_n || ')')
    ) LOOP
      v_n := v_n + 1;
    END LOOP;
    UPDATE inventory_items
    SET name = v_base || ' (' || v_n || ')'
    WHERE id = r.id AND clinic_id = r.clinic_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_clinic_name_uidx
  ON inventory_items (clinic_id, lower(btrim(name)));

-- ── Lotes ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_lots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_code   TEXT,          -- "Saldo anterior" usa NULL
  expires_at DATE,
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),  -- saldo restante
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_lots_item_expires_idx ON inventory_lots (item_id, expires_at);

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON inventory_lots;
CREATE POLICY "clinic_member" ON inventory_lots FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── inventory_movements: colunas novas ──────────────────────

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS clinic_id  UUID REFERENCES clinics(id) ON DELETE CASCADE;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS kind       TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS lot_id     UUID REFERENCES inventory_lots(id) ON DELETE SET NULL;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS notes      TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS created_by UUID;

ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_kind_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
  CHECK (kind IS NULL OR kind IN ('compra','devolucao','ajuste','uso','perda','vencido'));

UPDATE inventory_movements m
SET clinic_id = i.clinic_id
FROM inventory_items i
WHERE m.item_id = i.id AND m.clinic_id IS NULL;

ALTER TABLE inventory_movements ALTER COLUMN clinic_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_clinic_created_idx ON inventory_movements (clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_item_created_idx   ON inventory_movements (item_id, created_at DESC);

DROP POLICY IF EXISTS "clinic_member" ON inventory_movements;
CREATE POLICY "clinic_member" ON inventory_movements FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Criar produto (service role) ────────────────────────────
-- p_data: name, category, unit, min_quantity, ideal_quantity, supplier, tracks_expiry,
-- initial_quantity, lot_code, expires_at (null ou ausente = vazio). Saldo inicial > 0
-- grava um movimento in/ajuste "Saldo inicial" (e um lote, se controla validade).
-- Devolve o id do produto. Erros: QUANTIDADE_INVALIDA; nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.create_inventory_item(
  p_clinic_id UUID, p_user_id UUID, p_data JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tracks  BOOLEAN := coalesce((p_data->>'tracks_expiry')::boolean, false);
  v_initial INTEGER := coalesce(nullif(p_data->>'initial_quantity', '')::integer, 0);
  v_min     INTEGER := coalesce(nullif(p_data->>'min_quantity', '')::integer, 0);
  v_ideal   INTEGER := nullif(p_data->>'ideal_quantity', '')::integer;
  v_id      UUID;
  v_lot_id  UUID := NULL;
BEGIN
  IF v_initial < 0 OR v_min < 0 OR (v_ideal IS NOT NULL AND v_ideal < 0)
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  INSERT INTO inventory_items (clinic_id, name, category, unit, quantity, min_quantity,
                               ideal_quantity, supplier, tracks_expiry)
  VALUES (p_clinic_id,
          btrim(p_data->>'name'),
          nullif(btrim(coalesce(p_data->>'category', '')), ''),
          nullif(btrim(coalesce(p_data->>'unit', '')), ''),
          v_initial, v_min, v_ideal,
          nullif(btrim(coalesce(p_data->>'supplier', '')), ''),
          v_tracks)
  RETURNING id INTO v_id;

  IF v_initial > 0 THEN
    IF v_tracks THEN
      INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
      VALUES (p_clinic_id, v_id,
              nullif(btrim(coalesce(p_data->>'lot_code', '')), ''),
              nullif(p_data->>'expires_at', '')::date,
              v_initial)
      RETURNING id INTO v_lot_id;
    END IF;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
    VALUES (p_clinic_id, v_id, 'in', 'ajuste', v_initial, v_lot_id, 'Saldo inicial', p_user_id);
  END IF;

  RETURN v_id;
END;
$fn$;

-- ── Editar produto (service role) ───────────────────────────
-- p_data com as chaves name, category, unit, min_quantity, ideal_quantity, supplier,
-- active, tracks_expiry (substitui todos os campos editáveis; null ou ausente = vazio,
-- exceto active e tracks_expiry, que mantêm o valor atual se ausentes). O saldo não muda.
--   ligar validade com saldo > 0 e sem lotes: cria o lote "Saldo anterior" (sem código
--     nem validade) com o saldo;
--   desligar validade: apaga os lotes (o saldo total permanece em quantity).
-- Erros: PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INVALIDA; nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.update_inventory_item(
  p_clinic_id UUID, p_id UUID, p_data JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_old    inventory_items%ROWTYPE;
  v_tracks BOOLEAN;
  v_active BOOLEAN;
  v_min    INTEGER := coalesce(nullif(p_data->>'min_quantity', '')::integer, 0);
  v_ideal  INTEGER := nullif(p_data->>'ideal_quantity', '')::integer;
BEGIN
  SELECT * INTO v_old FROM inventory_items
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

  IF v_min < 0 OR (v_ideal IS NOT NULL AND v_ideal < 0)
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  v_tracks := coalesce(nullif(p_data->>'tracks_expiry', '')::boolean, v_old.tracks_expiry);
  v_active := coalesce(nullif(p_data->>'active', '')::boolean, v_old.active);

  UPDATE inventory_items
  SET name           = btrim(p_data->>'name'),
      category       = nullif(btrim(coalesce(p_data->>'category', '')), ''),
      unit           = nullif(btrim(coalesce(p_data->>'unit', '')), ''),
      min_quantity   = v_min,
      ideal_quantity = v_ideal,
      supplier       = nullif(btrim(coalesce(p_data->>'supplier', '')), ''),
      active         = v_active,
      tracks_expiry  = v_tracks,
      updated_at     = now()
  WHERE id = p_id AND clinic_id = p_clinic_id;

  IF v_tracks AND NOT v_old.tracks_expiry THEN
    IF v_old.quantity > 0 AND NOT EXISTS (
      SELECT 1 FROM inventory_lots WHERE item_id = p_id AND clinic_id = p_clinic_id
    ) THEN
      INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
      VALUES (p_clinic_id, p_id, NULL, NULL, v_old.quantity);
    END IF;
  ELSIF NOT v_tracks AND v_old.tracks_expiry THEN
    DELETE FROM inventory_lots WHERE item_id = p_id AND clinic_id = p_clinic_id;
  END IF;
END;
$fn$;

-- ── Entrada (service role) ──────────────────────────────────
-- p_kind: compra | devolucao | ajuste. Produto com validade exige p_expires_at e reaproveita
-- o lote de mesmo código (sem diferenciar maiúsculas) e mesma validade. Só 'compra' com
-- p_total_cost > 0 cria despesa; p_payment:
--   {"status":"paid","method":"pix","date":"YYYY-MM-DD"}  ou  {"status":"pending","due_date":"YYYY-MM-DD"}
-- Devolve {"quantity": novo saldo, "expense": {"id","amount","status"} | null}.
-- Erros: TIPO_INVALIDO, QUANTIDADE_INVALIDA, PAGAMENTO_INVALIDO, PRODUTO_NAO_ENCONTRADO,
-- PRODUTO_INATIVO, LOTE_OBRIGATORIO.

CREATE OR REPLACE FUNCTION public.inventory_entry(
  p_clinic_id UUID, p_user_id UUID, p_item_id UUID, p_quantity INTEGER, p_kind TEXT,
  p_lot_code TEXT, p_expires_at DATE, p_notes TEXT, p_total_cost NUMERIC, p_payment JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item     inventory_items%ROWTYPE;
  v_code     TEXT := nullif(btrim(coalesce(p_lot_code, '')), '');
  v_notes    TEXT := nullif(btrim(coalesce(p_notes, '')), '');
  v_lot_id   UUID := NULL;
  v_qty      INTEGER;
  v_with_exp BOOLEAN := false;
  v_pay_st   TEXT;
  v_method   TEXT;
  v_date     DATE;
  v_due      DATE;
  v_unit     TEXT;
  v_desc     TEXT;
  v_exp_id   UUID := NULL;
  v_expense  JSONB := NULL;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('compra','devolucao','ajuste')
  THEN RAISE EXCEPTION 'TIPO_INVALIDO'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  -- Valida o pagamento antes de mexer em qualquer coisa.
  IF p_kind = 'compra' AND coalesce(p_total_cost, 0) > 0 THEN
    v_with_exp := true;
    v_pay_st := p_payment->>'status';
    IF v_pay_st = 'paid' THEN
      v_method := p_payment->>'method';
      v_date := nullif(p_payment->>'date', '')::date;
      IF v_method IS NULL OR v_method NOT IN ('dinheiro','cartao_credito','cartao_debito','pix','boleto')
         OR v_date IS NULL
      THEN RAISE EXCEPTION 'PAGAMENTO_INVALIDO'; END IF;
    ELSIF v_pay_st = 'pending' THEN
      v_due := nullif(p_payment->>'due_date', '')::date;
      IF v_due IS NULL THEN RAISE EXCEPTION 'PAGAMENTO_INVALIDO'; END IF;
    ELSE
      RAISE EXCEPTION 'PAGAMENTO_INVALIDO';
    END IF;
  END IF;

  SELECT * INTO v_item FROM inventory_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;
  IF NOT v_item.active THEN RAISE EXCEPTION 'PRODUTO_INATIVO'; END IF;

  IF v_item.tracks_expiry THEN
    IF p_expires_at IS NULL THEN RAISE EXCEPTION 'LOTE_OBRIGATORIO'; END IF;

    SELECT id INTO v_lot_id FROM inventory_lots
    WHERE item_id = p_item_id AND clinic_id = p_clinic_id
      AND lower(btrim(lot_code)) IS NOT DISTINCT FROM lower(v_code)
      AND expires_at = p_expires_at
    ORDER BY created_at, id
    LIMIT 1
    FOR UPDATE;

    IF v_lot_id IS NULL THEN
      INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
      VALUES (p_clinic_id, p_item_id, v_code, p_expires_at, p_quantity)
      RETURNING id INTO v_lot_id;
    ELSE
      UPDATE inventory_lots SET quantity = quantity + p_quantity
      WHERE id = v_lot_id AND clinic_id = p_clinic_id;
    END IF;

    UPDATE inventory_items
    SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                    WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id),
        updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  ELSE
    UPDATE inventory_items
    SET quantity = quantity + p_quantity, updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  END IF;

  IF v_with_exp THEN
    v_unit := nullif(btrim(coalesce(v_item.unit, '')), '');
    v_desc := left('Compra: ' || v_item.name || ' — ' || p_quantity
                   || CASE WHEN v_unit IS NULL THEN '' ELSE ' ' || v_unit END, 200);

    IF v_pay_st = 'paid' THEN
      INSERT INTO expenses (clinic_id, description, amount, category, deduction_group,
                            payment_method, professional_id, status, due_date, paid_at)
      VALUES (p_clinic_id, v_desc, p_total_cost, 'material', 'custeio',
              v_method, NULL, 'paid', v_date,
              (v_date::timestamp + time '12:00') AT TIME ZONE 'America/Sao_Paulo')
      RETURNING id INTO v_exp_id;
    ELSE
      INSERT INTO expenses (clinic_id, description, amount, category, deduction_group,
                            payment_method, professional_id, status, due_date, paid_at)
      VALUES (p_clinic_id, v_desc, p_total_cost, 'material', 'custeio',
              NULL, NULL, 'pending', v_due, NULL)
      RETURNING id INTO v_exp_id;
    END IF;

    v_expense := jsonb_build_object('id', v_exp_id, 'amount', p_total_cost, 'status', v_pay_st);
  END IF;

  INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id,
                                   expense_id, notes, created_by)
  VALUES (p_clinic_id, p_item_id, 'in', p_kind, p_quantity, v_lot_id,
          v_exp_id, v_notes, p_user_id);

  RETURN jsonb_build_object('quantity', v_qty, 'expense', v_expense);
END;
$fn$;

-- ── Saída (service role) ────────────────────────────────────
-- p_kind: uso | perda | vencido. Produto com validade: com p_lot_id sai só desse lote;
-- sem p_lot_id sai primeiro o que vence antes (FEFO: expires_at ASC NULLS LAST,
-- created_at ASC), atravessando lotes, com um movimento por lote tocado. No motivo 'uso'
-- o automático pula lotes vencidos (expires_at < hoje em America/Sao_Paulo); perda,
-- vencido e lote explícito alcançam lotes vencidos. Produto sem
-- validade: um único movimento, sem lote (p_lot_id deve ser nulo).
-- Devolve {"quantity": novo saldo, "lotes": [{"lot_id","lot_code","quantidade"}]}.
-- Erros: TIPO_INVALIDO, QUANTIDADE_INVALIDA, PRODUTO_NAO_ENCONTRADO, PRODUTO_INATIVO,
-- LOTE_INVALIDO, ESTOQUE_INSUFICIENTE (nada é alterado).

CREATE OR REPLACE FUNCTION public.inventory_exit(
  p_clinic_id UUID, p_user_id UUID, p_item_id UUID, p_quantity INTEGER, p_kind TEXT,
  p_lot_id UUID, p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item  inventory_items%ROWTYPE;
  v_lot   inventory_lots%ROWTYPE;
  v_notes TEXT := nullif(btrim(coalesce(p_notes, '')), '');
  v_lotes JSONB := '[]'::jsonb;
  v_left  INTEGER;
  v_take  INTEGER;
  v_avail INTEGER;
  v_qty   INTEGER;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('uso','perda','vencido')
  THEN RAISE EXCEPTION 'TIPO_INVALIDO'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  SELECT * INTO v_item FROM inventory_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;
  IF NOT v_item.active THEN RAISE EXCEPTION 'PRODUTO_INATIVO'; END IF;

  IF v_item.tracks_expiry THEN
    IF p_lot_id IS NOT NULL THEN
      SELECT * INTO v_lot FROM inventory_lots
      WHERE id = p_lot_id AND item_id = p_item_id AND clinic_id = p_clinic_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
      IF p_quantity > v_lot.quantity THEN RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE'; END IF;

      UPDATE inventory_lots SET quantity = quantity - p_quantity
      WHERE id = v_lot.id AND clinic_id = p_clinic_id;

      INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
      VALUES (p_clinic_id, p_item_id, 'out', p_kind, p_quantity, v_lot.id, v_notes, p_user_id);

      v_lotes := jsonb_build_array(jsonb_build_object(
        'lot_id', v_lot.id, 'lot_code', v_lot.lot_code, 'quantidade', p_quantity));
    ELSE
      SELECT coalesce(sum(l.quantity), 0) INTO v_avail FROM inventory_lots l
      WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id AND l.quantity > 0
        AND (p_kind <> 'uso' OR l.expires_at IS NULL
             OR l.expires_at >= (now() AT TIME ZONE 'America/Sao_Paulo')::date);
      IF p_quantity > v_avail THEN RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE'; END IF;

      v_left := p_quantity;
      FOR v_lot IN
        SELECT * FROM inventory_lots l
        WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id AND l.quantity > 0
          AND (p_kind <> 'uso' OR l.expires_at IS NULL
               OR l.expires_at >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        ORDER BY l.expires_at ASC NULLS LAST, l.created_at ASC, l.id ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := least(v_left, v_lot.quantity);

        UPDATE inventory_lots SET quantity = quantity - v_take
        WHERE id = v_lot.id AND clinic_id = p_clinic_id;

        INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
        VALUES (p_clinic_id, p_item_id, 'out', p_kind, v_take, v_lot.id, v_notes, p_user_id);

        v_lotes := v_lotes || jsonb_build_array(jsonb_build_object(
          'lot_id', v_lot.id, 'lot_code', v_lot.lot_code, 'quantidade', v_take));
        v_left := v_left - v_take;
      END LOOP;
    END IF;

    UPDATE inventory_items
    SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                    WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id),
        updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  ELSE
    IF p_lot_id IS NOT NULL THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;
    IF p_quantity > v_item.quantity THEN RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE'; END IF;

    UPDATE inventory_items
    SET quantity = quantity - p_quantity, updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
    VALUES (p_clinic_id, p_item_id, 'out', p_kind, p_quantity, NULL, v_notes, p_user_id);
  END IF;

  RETURN jsonb_build_object('quantity', v_qty, 'lotes', v_lotes);
END;
$fn$;

-- ── Contagem (service role) ─────────────────────────────────
-- Acerta o saldo para o valor contado (p_counted >= 0). Produto com validade exige
-- p_lot_id (contagem por lote); sem validade, p_lot_id deve ser nulo. Diferença diferente
-- de zero grava um movimento ajuste (in se sobrou, out se faltou); igual não grava nada.
-- Aceita produto inativo. Devolve {"quantity": saldo total, "diferenca": contado - anterior}.
-- Erros: QUANTIDADE_INVALIDA, PRODUTO_NAO_ENCONTRADO, LOTE_OBRIGATORIO, LOTE_INVALIDO.

CREATE OR REPLACE FUNCTION public.inventory_count(
  p_clinic_id UUID, p_user_id UUID, p_item_id UUID, p_lot_id UUID, p_counted INTEGER, p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item  inventory_items%ROWTYPE;
  v_lot   inventory_lots%ROWTYPE;
  v_notes TEXT := nullif(btrim(coalesce(p_notes, '')), '');
  v_diff  INTEGER;
  v_qty   INTEGER;
BEGIN
  IF p_counted IS NULL OR p_counted < 0
  THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;

  SELECT * INTO v_item FROM inventory_items
  WHERE id = p_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

  IF v_item.tracks_expiry THEN
    IF p_lot_id IS NULL THEN RAISE EXCEPTION 'LOTE_OBRIGATORIO'; END IF;

    SELECT * INTO v_lot FROM inventory_lots
    WHERE id = p_lot_id AND item_id = p_item_id AND clinic_id = p_clinic_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

    v_diff := p_counted - v_lot.quantity;
    IF v_diff <> 0 THEN
      UPDATE inventory_lots SET quantity = p_counted
      WHERE id = v_lot.id AND clinic_id = p_clinic_id;
    END IF;

    UPDATE inventory_items
    SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                    WHERE l.item_id = p_item_id AND l.clinic_id = p_clinic_id),
        updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  ELSE
    IF p_lot_id IS NOT NULL THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

    v_diff := p_counted - v_item.quantity;
    UPDATE inventory_items
    SET quantity = p_counted, updated_at = now()
    WHERE id = p_item_id AND clinic_id = p_clinic_id
    RETURNING quantity INTO v_qty;
  END IF;

  IF v_diff <> 0 THEN
    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, notes, created_by)
    VALUES (p_clinic_id, p_item_id,
            CASE WHEN v_diff > 0 THEN 'in' ELSE 'out' END,
            'ajuste', abs(v_diff), p_lot_id, v_notes, p_user_id);
  END IF;

  RETURN jsonb_build_object('quantity', v_qty, 'diferenca', v_diff);
END;
$fn$;

-- ── Baixar lote vencido (service role) ──────────────────────
-- Baixa todo o saldo do lote com um movimento out/vencido (lote já zerado não grava nada).
-- Aceita produto inativo. O lote permanece com saldo 0 (histórico).
-- Devolve {"quantity": saldo total do produto, "baixado": unidades baixadas}.
-- Erros: LOTE_INVALIDO (inexistente ou de outra clínica), PRODUTO_NAO_ENCONTRADO.

CREATE OR REPLACE FUNCTION public.inventory_discard_lot(
  p_clinic_id UUID, p_user_id UUID, p_lot_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_item_id UUID;
  v_lot     inventory_lots%ROWTYPE;
  v_qty     INTEGER;
BEGIN
  -- Acha o produto do lote para travá-lo primeiro (mesma ordem de trava das outras funções).
  SELECT item_id INTO v_item_id FROM inventory_lots
  WHERE id = p_lot_id AND clinic_id = p_clinic_id;
  IF v_item_id IS NULL THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

  PERFORM 1 FROM inventory_items
  WHERE id = v_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

  SELECT * INTO v_lot FROM inventory_lots
  WHERE id = p_lot_id AND item_id = v_item_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_INVALIDO'; END IF;

  IF v_lot.quantity > 0 THEN
    UPDATE inventory_lots SET quantity = 0
    WHERE id = v_lot.id AND clinic_id = p_clinic_id;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id, created_by)
    VALUES (p_clinic_id, v_item_id, 'out', 'vencido', v_lot.quantity, v_lot.id, p_user_id);
  END IF;

  UPDATE inventory_items
  SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                  WHERE l.item_id = v_item_id AND l.clinic_id = p_clinic_id),
      updated_at = now()
  WHERE id = v_item_id AND clinic_id = p_clinic_id
  RETURNING quantity INTO v_qty;

  RETURN jsonb_build_object('quantity', v_qty, 'baixado', v_lot.quantity);
END;
$fn$;

-- ── Permissões ──────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_inventory_item(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.update_inventory_item(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_item(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_entry(UUID, UUID, UUID, INTEGER, TEXT, TEXT, DATE, TEXT, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_entry(UUID, UUID, UUID, INTEGER, TEXT, TEXT, DATE, TEXT, NUMERIC, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_exit(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_exit(UUID, UUID, UUID, INTEGER, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_count(UUID, UUID, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_count(UUID, UUID, UUID, UUID, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_discard_lot(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_discard_lot(UUID, UUID, UUID) TO service_role;


-- ============================================================
-- ESTOQUE (FASE 2): KITS DE MATERIAL E BAIXA POR TRATAMENTO
-- Acrescenta: as tabelas inventory_kits e inventory_kit_items, as colunas
-- material_status e material_kit_id em treatments, a coluna treatment_id em
-- inventory_movements, o gatilho treatments_material_status (tratamento concluído fica
-- com material "pendente") e as funções create_inventory_kit, update_inventory_kit,
-- treatment_material_apply, treatment_material_skip e treatment_material_return
-- (service role). A baixa reaproveita inventory_exit, sem modificá-la.
-- Tratamentos concluídos antes desta migração não ficam pendentes.
-- Rode depois de supabase/2026-11-10-estoque.sql.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

-- ── Kits ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_kits (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_kits_clinic_name_uidx
  ON inventory_kits (clinic_id, lower(btrim(name)));

ALTER TABLE inventory_kits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON inventory_kits;
CREATE POLICY "clinic_member" ON inventory_kits FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── Itens do kit ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_kit_items (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kit_id    UUID NOT NULL REFERENCES inventory_kits(id) ON DELETE CASCADE,
  item_id   UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity  INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (kit_id, item_id)
);

CREATE INDEX IF NOT EXISTS inventory_kit_items_kit_idx ON inventory_kit_items (kit_id);

ALTER TABLE inventory_kit_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinic_member" ON inventory_kit_items;
CREATE POLICY "clinic_member" ON inventory_kit_items FOR ALL TO authenticated
  USING (clinic_id IN (SELECT public.user_clinic_ids()))
  WITH CHECK (clinic_id IN (SELECT public.user_clinic_ids()));

-- ── treatments: colunas novas ───────────────────────────────

ALTER TABLE treatments ADD COLUMN IF NOT EXISTS material_status TEXT;
ALTER TABLE treatments ADD COLUMN IF NOT EXISTS material_kit_id UUID
  REFERENCES inventory_kits(id) ON DELETE SET NULL;

ALTER TABLE treatments DROP CONSTRAINT IF EXISTS treatments_material_status_check;
ALTER TABLE treatments ADD CONSTRAINT treatments_material_status_check
  CHECK (material_status IS NULL OR material_status IN ('pendente','baixado','dispensado'));

-- ── inventory_movements: coluna nova ────────────────────────

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS treatment_id UUID
  REFERENCES treatments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_treatment_idx ON inventory_movements (treatment_id);

-- ── Gatilho: situação do material do tratamento ─────────────
-- As funções abaixo ligam app.material = 'on' (só na transação) e o gatilho aceita os
-- valores enviados. Em qualquer outra gravação (navegador, IA, aprovação de orçamento):
--   1. material_status e material_kit_id não mudam (INSERT: nulos; UPDATE: valores de OLD);
--   2. tratamento que acaba de ser concluído, com material nulo, fica 'pendente';
--   3. tratamento que deixa de estar concluído, com material 'pendente' ou 'dispensado',
--      volta a nulo ('baixado' não muda: a devolução é uma pergunta separada).

CREATE OR REPLACE FUNCTION public.treatments_material_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF coalesce(current_setting('app.material', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.material_status := NULL;
    NEW.material_kit_id := NULL;

    IF NEW.status = 'completed' AND NEW.material_status IS NULL THEN
      NEW.material_status := 'pendente';
    END IF;
  ELSE
    NEW.material_status := OLD.material_status;
    NEW.material_kit_id := OLD.material_kit_id;

    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed'
       AND NEW.material_status IS NULL THEN
      NEW.material_status := 'pendente';
    END IF;

    IF OLD.status = 'completed' AND NEW.status IS DISTINCT FROM 'completed'
       AND NEW.material_status IN ('pendente','dispensado') THEN
      NEW.material_status := NULL;
      NEW.material_kit_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS treatments_material_status ON treatments;
CREATE TRIGGER treatments_material_status
  BEFORE INSERT OR UPDATE ON treatments
  FOR EACH ROW EXECUTE FUNCTION public.treatments_material_status();

-- ── Criar kit (service role) ────────────────────────────────
-- p_data: {name, active, items: [{item_id, quantity}]}. active ausente = true.
-- items: 1 a 50, quantidade inteira de 1 a 9999, sem produto repetido, produtos da
-- mesma clínica (inativos são aceitos). Devolve o id do kit.
-- Erros: KIT_VAZIO, QUANTIDADE_INVALIDA, ITEM_REPETIDO, PRODUTO_INVALIDO;
-- nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.create_inventory_kit(
  p_clinic_id UUID, p_data JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_items JSONB := p_data->'items';
  v_el    JSONB;
  v_num   NUMERIC;
  v_id    UUID;
BEGIN
  IF v_items IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;
  IF jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 50
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;

  FOR v_el IN SELECT e.value FROM jsonb_array_elements(v_items) AS e LOOP
    IF jsonb_typeof(v_el->'quantity') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
    v_num := (v_el->>'quantity')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 9999
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    GROUP BY (e.value->>'item_id')::uuid
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'ITEM_REPETIDO'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    WHERE e.value->>'item_id' IS NULL
       OR NOT EXISTS (SELECT 1 FROM inventory_items i
                      WHERE i.id = (e.value->>'item_id')::uuid AND i.clinic_id = p_clinic_id)
  ) THEN RAISE EXCEPTION 'PRODUTO_INVALIDO'; END IF;

  INSERT INTO inventory_kits (clinic_id, name, active)
  VALUES (p_clinic_id, btrim(p_data->>'name'), coalesce((p_data->>'active')::boolean, true))
  RETURNING id INTO v_id;

  INSERT INTO inventory_kit_items (clinic_id, kit_id, item_id, quantity)
  SELECT p_clinic_id, v_id, (e.value->>'item_id')::uuid, ((e.value->>'quantity')::numeric)::integer
  FROM jsonb_array_elements(v_items) AS e;

  RETURN v_id;
END;
$fn$;

-- ── Editar kit (service role) ───────────────────────────────
-- p_data: {name, active, items}. active ausente mantém o valor atual; items substitui a
-- lista inteira (mesmas regras da criação).
-- Erros: KIT_NAO_ENCONTRADO, KIT_VAZIO, QUANTIDADE_INVALIDA, ITEM_REPETIDO,
-- PRODUTO_INVALIDO; nome repetido sobe como 23505.

CREATE OR REPLACE FUNCTION public.update_inventory_kit(
  p_clinic_id UUID, p_id UUID, p_data JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_old   inventory_kits%ROWTYPE;
  v_items JSONB := p_data->'items';
  v_el    JSONB;
  v_num   NUMERIC;
BEGIN
  SELECT * INTO v_old FROM inventory_kits
  WHERE id = p_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KIT_NAO_ENCONTRADO'; END IF;

  IF v_items IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;
  IF jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 50
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;

  FOR v_el IN SELECT e.value FROM jsonb_array_elements(v_items) AS e LOOP
    IF jsonb_typeof(v_el->'quantity') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
    v_num := (v_el->>'quantity')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 9999
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    GROUP BY (e.value->>'item_id')::uuid
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'ITEM_REPETIDO'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_items) AS e
    WHERE e.value->>'item_id' IS NULL
       OR NOT EXISTS (SELECT 1 FROM inventory_items i
                      WHERE i.id = (e.value->>'item_id')::uuid AND i.clinic_id = p_clinic_id)
  ) THEN RAISE EXCEPTION 'PRODUTO_INVALIDO'; END IF;

  UPDATE inventory_kits
  SET name       = btrim(p_data->>'name'),
      active     = coalesce((p_data->>'active')::boolean, v_old.active),
      updated_at = now()
  WHERE id = p_id AND clinic_id = p_clinic_id;

  DELETE FROM inventory_kit_items WHERE kit_id = p_id AND clinic_id = p_clinic_id;

  INSERT INTO inventory_kit_items (clinic_id, kit_id, item_id, quantity)
  SELECT p_clinic_id, p_id, (e.value->>'item_id')::uuid, ((e.value->>'quantity')::numeric)::integer
  FROM jsonb_array_elements(v_items) AS e;
END;
$fn$;

-- ── Baixa de material do tratamento (service role) ──────────
-- p_kit_id é opcional e fica só como registro: a lista que vale é p_items
-- ([{item_id, quantity}], 1 a 50, quantidade inteira de 1 a 9999, sem repetição).
-- Cada produto sai por inventory_exit (motivo 'uso', FEFO), em ordem de item_id, e as
-- saídas criadas ganham o treatment_id. Falha de inventory_exit sobe como
-- '<CODIGO>:<item_id>' (ex.: ESTOQUE_INSUFICIENTE:<uuid>) e nada é gravado.
-- Devolve {"itens": [{"item_id","quantidade","lotes":[{"lot_id","lot_code","quantidade"}]}]}.
-- Erros: TRATAMENTO_NAO_ENCONTRADO, TRATAMENTO_NAO_CONCLUIDO, MATERIAL_JA_RESOLVIDO,
-- KIT_NAO_ENCONTRADO, KIT_VAZIO, QUANTIDADE_INVALIDA, ITEM_REPETIDO, <CODIGO>:<item_id>.

CREATE OR REPLACE FUNCTION public.treatment_material_apply(
  p_clinic_id UUID, p_user_id UUID, p_treatment_id UUID, p_kit_id UUID, p_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tr      treatments%ROWTYPE;
  v_el      JSONB;
  v_num     NUMERIC;
  v_item_id UUID;
  v_qty     INTEGER;
  v_res     JSONB;
  v_notes   TEXT;
  v_itens   JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_tr FROM treatments
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRATAMENTO_NAO_ENCONTRADO'; END IF;
  IF v_tr.status <> 'completed' THEN RAISE EXCEPTION 'TRATAMENTO_NAO_CONCLUIDO'; END IF;
  IF v_tr.material_status IS DISTINCT FROM 'pendente'
  THEN RAISE EXCEPTION 'MATERIAL_JA_RESOLVIDO'; END IF;

  IF p_kit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM inventory_kits WHERE id = p_kit_id AND clinic_id = p_clinic_id
  ) THEN RAISE EXCEPTION 'KIT_NAO_ENCONTRADO'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;
  IF jsonb_array_length(p_items) < 1 OR jsonb_array_length(p_items) > 50
  THEN RAISE EXCEPTION 'KIT_VAZIO'; END IF;

  FOR v_el IN SELECT e.value FROM jsonb_array_elements(p_items) AS e LOOP
    IF jsonb_typeof(v_el->'quantity') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
    v_num := (v_el->>'quantity')::numeric;
    IF v_num <> trunc(v_num) OR v_num < 1 OR v_num > 9999
    THEN RAISE EXCEPTION 'QUANTIDADE_INVALIDA'; END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    GROUP BY (e.value->>'item_id')::uuid
    HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'ITEM_REPETIDO'; END IF;

  v_notes := left('Tratamento: ' || v_tr.procedure, 200);

  -- Ordem crescente de item_id: as travas dos produtos saem sempre na mesma ordem.
  FOR v_item_id, v_qty IN
    SELECT (e.value->>'item_id')::uuid, ((e.value->>'quantity')::numeric)::integer
    FROM jsonb_array_elements(p_items) AS e
    ORDER BY 1
  LOOP
    BEGIN
      v_res := public.inventory_exit(p_clinic_id, p_user_id, v_item_id, v_qty, 'uso', NULL::uuid, v_notes);
    EXCEPTION WHEN raise_exception THEN
      RAISE EXCEPTION '%:%', SQLERRM, v_item_id;
    END;

    -- Liga ao tratamento só as saídas que essa chamada criou (now() é o default de
    -- created_at e é fixo na transação; cada produto aparece uma vez só na lista).
    UPDATE inventory_movements
    SET treatment_id = p_treatment_id
    WHERE clinic_id = p_clinic_id AND item_id = v_item_id AND type = 'out'
      AND treatment_id IS NULL AND created_at = now();

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'item_id', v_item_id, 'quantidade', v_qty, 'lotes', v_res->'lotes'));
  END LOOP;

  PERFORM set_config('app.material', 'on', true);
  UPDATE treatments
  SET material_status = 'baixado', material_kit_id = p_kit_id
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id;
  PERFORM set_config('app.material', 'off', true);

  RETURN jsonb_build_object('itens', v_itens);
END;
$fn$;

-- ── Dispensar material do tratamento (service role) ─────────
-- 'pendente' vira 'dispensado'.
-- Erros: TRATAMENTO_NAO_ENCONTRADO, MATERIAL_JA_RESOLVIDO.

CREATE OR REPLACE FUNCTION public.treatment_material_skip(
  p_clinic_id UUID, p_treatment_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tr treatments%ROWTYPE;
BEGIN
  SELECT * INTO v_tr FROM treatments
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRATAMENTO_NAO_ENCONTRADO'; END IF;
  IF v_tr.material_status IS DISTINCT FROM 'pendente'
  THEN RAISE EXCEPTION 'MATERIAL_JA_RESOLVIDO'; END IF;

  PERFORM set_config('app.material', 'on', true);
  UPDATE treatments
  SET material_status = 'dispensado'
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id;
  PERFORM set_config('app.material', 'off', true);
END;
$fn$;

-- ── Devolver material do tratamento (service role) ──────────
-- Devolve as saídas (type 'out') do tratamento criadas depois da última devolução dele
-- (in/devolucao com o mesmo treatment_id), em ordem de item_id. Produto com validade:
-- soma no lote original se ele ainda existe; senão cria um lote sem código e sem
-- validade; o saldo do produto vira a soma dos lotes. Produto sem validade: soma no
-- saldo. Cada saída gera um movimento in/devolucao ligado ao tratamento. Aceita produto
-- inativo. No fim, o material volta a 'pendente' (se concluído) ou a nulo, sem kit.
-- Devolve {"devolvidos": n}.
-- Erros: TRATAMENTO_NAO_ENCONTRADO, MATERIAL_NAO_BAIXADO, PRODUTO_NAO_ENCONTRADO.

CREATE OR REPLACE FUNCTION public.treatment_material_return(
  p_clinic_id UUID, p_user_id UUID, p_treatment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_tr     treatments%ROWTYPE;
  v_since  TIMESTAMPTZ;
  v_mov    RECORD;
  v_tracks BOOLEAN;
  v_lot_id UUID;
  v_notes  TEXT;
  v_n      INTEGER := 0;
BEGIN
  SELECT * INTO v_tr FROM treatments
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRATAMENTO_NAO_ENCONTRADO'; END IF;
  IF v_tr.material_status IS DISTINCT FROM 'baixado'
  THEN RAISE EXCEPTION 'MATERIAL_NAO_BAIXADO'; END IF;

  SELECT coalesce(max(m.created_at), '-infinity'::timestamptz) INTO v_since
  FROM inventory_movements m
  WHERE m.clinic_id = p_clinic_id AND m.treatment_id = p_treatment_id
    AND m.type = 'in' AND m.kind = 'devolucao';

  v_notes := left('Devolução: ' || v_tr.procedure, 200);

  FOR v_mov IN
    SELECT m.id, m.item_id, m.lot_id, m.quantity
    FROM inventory_movements m
    WHERE m.clinic_id = p_clinic_id AND m.treatment_id = p_treatment_id
      AND m.type = 'out' AND m.created_at > v_since
    ORDER BY m.item_id, m.created_at, m.id
  LOOP
    SELECT tracks_expiry INTO v_tracks FROM inventory_items
    WHERE id = v_mov.item_id AND clinic_id = p_clinic_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUTO_NAO_ENCONTRADO'; END IF;

    v_lot_id := NULL;

    IF v_tracks THEN
      IF v_mov.lot_id IS NOT NULL THEN
        UPDATE inventory_lots SET quantity = quantity + v_mov.quantity
        WHERE id = v_mov.lot_id AND item_id = v_mov.item_id AND clinic_id = p_clinic_id
        RETURNING id INTO v_lot_id;
      END IF;

      IF v_lot_id IS NULL THEN
        INSERT INTO inventory_lots (clinic_id, item_id, lot_code, expires_at, quantity)
        VALUES (p_clinic_id, v_mov.item_id, NULL, NULL, v_mov.quantity)
        RETURNING id INTO v_lot_id;
      END IF;

      UPDATE inventory_items
      SET quantity = (SELECT coalesce(sum(l.quantity), 0) FROM inventory_lots l
                      WHERE l.item_id = v_mov.item_id AND l.clinic_id = p_clinic_id),
          updated_at = now()
      WHERE id = v_mov.item_id AND clinic_id = p_clinic_id;
    ELSE
      UPDATE inventory_items
      SET quantity = quantity + v_mov.quantity, updated_at = now()
      WHERE id = v_mov.item_id AND clinic_id = p_clinic_id;
    END IF;

    INSERT INTO inventory_movements (clinic_id, item_id, type, kind, quantity, lot_id,
                                     treatment_id, notes, created_by)
    VALUES (p_clinic_id, v_mov.item_id, 'in', 'devolucao', v_mov.quantity, v_lot_id,
            p_treatment_id, v_notes, p_user_id);

    v_n := v_n + 1;
  END LOOP;

  PERFORM set_config('app.material', 'on', true);
  UPDATE treatments
  SET material_status = CASE WHEN status = 'completed' THEN 'pendente' ELSE NULL END,
      material_kit_id = NULL
  WHERE id = p_treatment_id AND clinic_id = p_clinic_id;
  PERFORM set_config('app.material', 'off', true);

  RETURN jsonb_build_object('devolvidos', v_n);
END;
$fn$;

-- ── Permissões ──────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_inventory_kit(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_kit(UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.update_inventory_kit(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory_kit(UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.treatment_material_apply(UUID, UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treatment_material_apply(UUID, UUID, UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.treatment_material_skip(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treatment_material_skip(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.treatment_material_return(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treatment_material_return(UUID, UUID, UUID) TO service_role;
