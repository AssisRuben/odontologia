-- ============================================================
-- MENSAGENS AUTOMÁTICAS POR WHATSAPP
-- Cria as tabelas whatsapp_connections, message_settings e messages,
-- as colunas patients.whatsapp_opt_out e clinics.messaging_config,
-- a RLS correspondente e o seed dos modelos padrão por clínica.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
--
-- Depois de aplicar, para o disparo automático a cada 5 minutos,
-- descomente o bloco cron.schedule no fim do arquivo, preencha
-- <APP_URL> e <CRON_SECRET> e rode só aquele bloco.
-- ============================================================

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

-- Clínicas já existentes
SELECT public.seed_message_settings(id) FROM clinics;

-- ── Agendamento (pg_cron + pg_net) ──────────────────────────
-- Se der erro nas extensões, ative em Dashboard > Database > Extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Descomente, troque <APP_URL> (ex.: https://meuapp.com, sem barra no fim)
-- e <CRON_SECRET> (o mesmo valor da variável CRON_SECRET do app) e rode:
--
-- SELECT cron.schedule('whatsapp-messages', '*/5 * * * *', $$
--   SELECT net.http_post(
--     url := '<APP_URL>/api/cron/messages',
--     headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
--     timeout_milliseconds := 60000
--   )
-- $$);
--
-- Para remover: SELECT cron.unschedule('whatsapp-messages');
