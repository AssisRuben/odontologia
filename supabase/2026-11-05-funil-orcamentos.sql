-- ============================================================
-- FUNIL DE ORÇAMENTOS E ASSINATURA ELETRÔNICA
-- Acrescenta o funil (rascunho > enviado > aprovado/perdido/vencido) em
-- budgets, a aprovação por item em budget_items, a validade padrão em
-- clinics, as tabelas budget_links (link público), budget_signatures
-- (assinatura) e budget_events (histórico/contatos), os tipos de mensagem
-- 'budget' e 'budget_reminder', os gatilhos de edição/trava e as funções
-- send_budget, approve_budget e reject_budget (chamadas só pelo servidor).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > New query >
-- cole este arquivo inteiro > Run. Pode rodar mais de uma vez.
-- (Bancos novos criados com supabase/schema.sql já vêm assim.)
-- ============================================================

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

-- ── Mensagens: tipos 'budget' e 'budget_reminder' ───────────

ALTER TABLE messages ADD COLUMN IF NOT EXISTS budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL;

ALTER TABLE message_settings DROP CONSTRAINT IF EXISTS message_settings_type_check;
ALTER TABLE message_settings ADD CONSTRAINT message_settings_type_check CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','budget','budget_reminder'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','budget','budget_reminder','manual','auto_reply','incoming'));

-- Seed das configurações padrão de uma clínica (agora com 8 tipos)
-- Os textos devem ficar iguais a DEFAULT_TEMPLATES em src/lib/messaging/templates.ts.
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

REVOKE ALL ON FUNCTION public.seed_message_settings(UUID) FROM PUBLIC, anon, authenticated;

-- Clínicas existentes ganham as duas configurações novas
INSERT INTO message_settings (clinic_id, type, enabled, template, config)
SELECT c.id, 'budget', TRUE, 'Olá, {paciente}! Segue seu orçamento da {clinica}, no valor de {valor}. Para ver os detalhes e aprovar: {link}', '{}'
FROM clinics c
ON CONFLICT (clinic_id, type) DO NOTHING;

INSERT INTO message_settings (clinic_id, type, enabled, template, config)
SELECT c.id, 'budget_reminder', TRUE, 'Olá, {paciente}! Seu orçamento na {clinica} ainda está disponível até {vencimento}. Para ver e aprovar: {link}', '{"offset_days":[3,7]}'
FROM clinics c
ON CONFLICT (clinic_id, type) DO NOTHING;
