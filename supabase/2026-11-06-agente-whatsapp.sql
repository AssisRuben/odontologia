-- ============================================================
-- AGENTE DE IA NO WHATSAPP (etapa 6a)
-- Acrescenta a tabela conversations (uma por telefone de cada clínica, com
-- quem atende: agente ou equipe), liga messages às conversas, aceita os tipos
-- 'agent' e 'human' em messages, guarda a configuração do agente em
-- clinics.agent_config e aceita os usos 'agente' e 'transcricao_whatsapp'
-- em ai_usage. Escrita só pelo servidor (service role).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
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
