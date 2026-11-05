-- ============================================================
-- COBRANÇA INTEGRADA COM ASAAS
-- Cria payment_connections, payment_customers, payment_events e
-- fiscal_invoices, acrescenta colunas em payments, aceita os status
-- cancelled/refunded e o tipo de mensagem payment_due, e recria o seed
-- dos modelos padrão por clínica.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
--
-- Depois de aplicar, para a conferência diária e a conferência rápida
-- das cobranças em criação, descomente os blocos cron.schedule no fim do
-- arquivo, preencha <APP_URL> e <CRON_SECRET> e rode só aqueles blocos.
-- ============================================================

-- Extensões usadas pelo agendamento.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Função usada pelas policies (já existe se o isolamento por clínica foi aplicado)
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

-- ── payments: colunas novas ─────────────────────────────────

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

-- ── Novas tabelas ───────────────────────────────────────────

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

-- ── CHECKs (recriados para aceitar os novos valores) ────────

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending','paid','overdue','cancelled','refunded'));

ALTER TABLE message_settings DROP CONSTRAINT IF EXISTS message_settings_type_check;
ALTER TABLE message_settings ADD CONSTRAINT message_settings_type_check CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','manual','auto_reply','incoming'));

-- ── RLS da cobrança ─────────────────────────────────────────

ALTER TABLE payment_connections ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role
ALTER TABLE payment_customers   ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role
ALTER TABLE payment_events      ENABLE ROW LEVEL SECURITY;  -- sem policies: só via service role
ALTER TABLE fiscal_invoices     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_member_select" ON fiscal_invoices;
CREATE POLICY "clinic_member_select" ON fiscal_invoices FOR SELECT TO authenticated
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

-- ── Seed das 6 configurações padrão de uma clínica ──────────
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
  (p_clinic, 'charge', FALSE, 'Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.

{link}', '{"offset_days":[1,7]}'),
  (p_clinic, 'payment_due', FALSE, 'Olá, {paciente}! Sua parcela de {valor} na {clinica} vence em {vencimento}. Pague por aqui: {link}', '{"offset_days":[3]}')
  ON CONFLICT (clinic_id, type) DO NOTHING;
END;
$fn$;

-- Só o servidor/trigger chama; usuários logados não.
REVOKE ALL ON FUNCTION public.seed_message_settings(UUID) FROM PUBLIC, anon, authenticated;

-- Clínicas já existentes
SELECT public.seed_message_settings(id) FROM clinics;

-- Troca o modelo de cobrança só onde a clínica ainda usa o padrão antigo.
UPDATE message_settings SET template = 'Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.

{link}'
  WHERE type = 'charge' AND template = 'Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.';

-- ── Agendamento (pg_cron + pg_net) ──────────────────────────
-- Conferência diária às 06:00 de Brasília (09:00 UTC). Descomente, troque
-- <APP_URL> (sem barra no fim) e <CRON_SECRET> (o mesmo valor da variável
-- CRON_SECRET do app) e rode só este bloco:
--
-- SELECT cron.schedule('payments-reconcile', '0 9 * * *', $$
--   SELECT net.http_post(
--     url := '<APP_URL>/api/cron/payments',
--     headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
--     timeout_milliseconds := 60000
--   )
-- $$);
--
-- Para remover: SELECT cron.unschedule('payments-reconcile');
--
-- Conferência rápida das cobranças ainda em criação (o Asaas não respondeu
-- na hora), a cada 15 minutos. Mesmas trocas de <APP_URL> e <CRON_SECRET>:
--
-- SELECT cron.schedule('payments-creating', '*/15 * * * *', $$
--   SELECT net.http_post(
--     url := '<APP_URL>/api/cron/payments?scope=creating',
--     headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
--     timeout_milliseconds := 60000
--   )
-- $$);
--
-- Para remover: SELECT cron.unschedule('payments-creating');
