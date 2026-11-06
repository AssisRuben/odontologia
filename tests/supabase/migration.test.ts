import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES } from '@/lib/messaging/templates'

const read = (f: string) =>
  readFileSync(path.resolve(__dirname, '../../supabase', f), 'utf8').replace(/\r\n/g, '\n')

describe.each(['2026-11-04-cobranca-asaas.sql', '2026-11-05-funil-orcamentos.sql', 'schema.sql'])('%s', (file) => {
  const sql = read(file)
  const budgetOnly = (t: string) => t.startsWith('budget')
  const entries = Object.entries(DEFAULT_TEMPLATES).filter(([t]) =>
    file === '2026-11-04-cobranca-asaas.sql' ? !budgetOnly(t) : file === '2026-11-05-funil-orcamentos.sql' ? budgetOnly(t) : true,
  )
  it.each(entries)('contém o modelo padrão de %s', (_type, template) => {
    expect(sql).toContain(template.replace(/'/g, "''"))
  })
})

describe.each(['2026-11-04-cobranca-asaas.sql', 'schema.sql'])('%s fiscal_invoices', (file) => {
  it('impede duas notas ativas para o mesmo lançamento', () => {
    expect(read(file)).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS fiscal_invoices_active_payment_uidx ON fiscal_invoices (clinic_id, payment_id) WHERE status IN ('scheduled','authorized','cancelling');",
    )
  })
})

describe('2026-11-02-whatsapp-automatico.sql', () => {
  it('recria o gatilho on_auth_user_created depois de handle_new_user (bancos antigos)', () => {
    const sql = read('2026-11-02-whatsapp-automatico.sql')
    const fn = sql.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()')
    const drop = sql.indexOf('DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;')
    const create = sql.indexOf('CREATE TRIGGER on_auth_user_created')
    expect(fn).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(fn)
    expect(create).toBeGreaterThan(drop)
    expect(sql.slice(create)).toMatch(/AFTER INSERT ON auth\.users\s+FOR EACH ROW EXECUTE FUNCTION public\.handle_new_user\(\);/)
  })
})

describe('2026-11-04-cobranca-asaas.sql', () => {
  const sql = read('2026-11-04-cobranca-asaas.sql')

  it('payment_connections, payment_customers e payment_events não têm CREATE POLICY', () => {
    for (const t of ['payment_connections', 'payment_customers', 'payment_events']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`))
      expect(sql).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON ${t}\\b`))
    }
  })

  it('fiscal_invoices tem policy clinic_member com user_clinic_ids()', () => {
    expect(sql).toMatch(/CREATE POLICY "clinic_member_select" ON fiscal_invoices[^;]*user_clinic_ids\(\)/)
  })

  it('payments.status aceita cancelled e refunded', () => {
    expect(sql).toContain("CHECK (status IN ('pending','paid','overdue','cancelled','refunded'))")
  })

  it('messages e message_settings aceitam payment_due', () => {
    expect(sql).toMatch(/message_settings_type_check[^;]*'payment_due'/)
    expect(sql).toMatch(/messages_type_check[^;]*'payment_due'/)
  })

  it('atualiza o modelo de charge só se ainda for o padrão antigo', () => {
    const antigo = 'Olá, {paciente}. Identificamos um pagamento de {valor} com vencimento em {vencimento} ainda em aberto na {clinica}. Se já pagou, desconsidere esta mensagem.'
    const novo = DEFAULT_TEMPLATES.charge.replace(/'/g, "''")
    expect(sql).toMatch(/UPDATE message_settings SET template = '/)
    expect(sql).toContain(`WHERE type = 'charge' AND template = '${antigo}'`)
    expect(sql).toContain(`SET template = '${novo}'`)
  })
})

describe.each(['2026-11-04-cobranca-asaas.sql', 'schema.sql'])('%s proteção dos lançamentos', (file) => {
  const sql = read(file)

  it('fiscal_invoices.payment_id é ON DELETE RESTRICT (recriado pelo nome)', () => {
    const drop = sql.indexOf('ALTER TABLE fiscal_invoices DROP CONSTRAINT IF EXISTS fiscal_invoices_payment_id_fkey;')
    const add = sql.indexOf(
      'ALTER TABLE fiscal_invoices ADD CONSTRAINT fiscal_invoices_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;',
    )
    expect(drop).toBeGreaterThan(-1)
    expect(add).toBeGreaterThan(drop)
    expect(sql).not.toMatch(/payment_id\s+UUID NOT NULL REFERENCES payments\(id\) ON DELETE CASCADE/)
  })

  it('gatilho impede o usuário logado de alterar ou apagar lançamentos do Asaas', () => {
    const fn = sql.indexOf('CREATE OR REPLACE FUNCTION public.payments_guard_provider_rows()')
    const drop = sql.indexOf('DROP TRIGGER IF EXISTS payments_guard_provider_rows ON payments;')
    const create = sql.indexOf('CREATE TRIGGER payments_guard_provider_rows')
    expect(fn).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(fn)
    expect(create).toBeGreaterThan(drop)
    expect(sql.slice(create)).toMatch(
      /^CREATE TRIGGER payments_guard_provider_rows\s+BEFORE UPDATE OR DELETE ON payments\s+FOR EACH ROW EXECUTE FUNCTION public\.payments_guard_provider_rows\(\);/,
    )
    const body = sql.slice(fn, drop)
    expect(body).toContain("auth.role() = 'authenticated'")
    expect(body).toContain("OLD.charge_kind <> 'manual'")
    expect(body).toContain("RAISE EXCEPTION 'Lançamentos do Asaas só podem ser alterados pelo sistema'")
    expect(body).toContain("NEW.charge_kind <> 'manual'")
    for (const col of ['provider_charge_id', 'provider_installment_id', 'provider_state', 'invoice_url']) {
      expect(body).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`)
    }
  })
})

describe('2026-11-04-cobranca-asaas.sql agendamento', () => {
  it('traz o agendamento de 15 em 15 min dos grupos creating', () => {
    const sql = read('2026-11-04-cobranca-asaas.sql')
    expect(sql).toContain("-- SELECT cron.schedule('payments-creating', '*/15 * * * *', $$")
    expect(sql).toContain("--     url := '<APP_URL>/api/cron/payments?scope=creating',")
  })
})

describe.each(['2026-11-05-livro-caixa.sql', 'schema.sql'])('%s livro-caixa', (file) => {
  const sql = read(file)

  it('expenses aceita só as categorias da lista', () => {
    expect(sql).toContain(
      "CHECK (category IN ('aluguel','contas','material','laboratorio','servicos','manutencao','marketing','conselho','iptu_taxas','tarifas','salarios','emolumentos','equipamentos','reformas','cursos','outras'))",
    )
  })

  it('deduction_group com os três grupos', () => {
    expect(sql).toContain("CHECK (deduction_group IN ('custeio','pessoal','emolumentos'))")
  })

  it('health_receipts com RLS ligada', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS health_receipts')
    expect(sql).toContain('ALTER TABLE health_receipts ENABLE ROW LEVEL SECURITY;')
  })

  it('bucket de comprovantes privado', () => {
    expect(sql).toContain("('expense-receipts', 'expense-receipts', false)")
  })

  it('bucket de documentos privado', () => {
    if (file === 'schema.sql') {
      expect(sql).toContain("VALUES ('anneOdonto', 'anneOdonto', false)")
    } else {
      expect(sql).toContain("UPDATE storage.buckets SET public = false WHERE id = 'anneOdonto';")
    }
  })
})

describe('2026-11-05-livro-caixa.sql migração de dados', () => {
  const sql = read('2026-11-05-livro-caixa.sql')

  it('migra categorias antigas para outras antes do CHECK', () => {
    const update = sql.search(/UPDATE expenses SET[^;]*category = 'outras'/)
    const add = sql.indexOf('ADD CONSTRAINT expenses_category_check')
    expect(update).toBeGreaterThan(-1)
    expect(add).toBeGreaterThan(update)
  })

  it('converte file_url público em caminho', () => {
    expect(sql).toContain('/storage/v1/object/public/anneOdonto/')
  })
})

describe.each(['2026-11-05-funil-orcamentos.sql', 'schema.sql'])('%s funil-orcamentos', (file) => {
  const sql = read(file)

  it('clinics tem a validade padrão de 1 a 180 dias', () => {
    expect(sql).toContain('budget_validity_days INTEGER NOT NULL DEFAULT 30')
    expect(sql).toContain('CHECK (budget_validity_days BETWEEN 1 AND 180)')
  })

  it.each([
    'professional_id', 'sent_at', 'viewed_at', 'decided_at', 'valid_until',
    'approved_total', 'lost_reason', 'followup_at', 'approval_seen_at', 'updated_at',
  ])('budgets ganha a coluna %s', (col) => {
    expect(sql).toMatch(new RegExp(`ALTER TABLE budgets ADD COLUMN IF NOT EXISTS ${col}\\s`))
  })

  it('budget_items ganha approved', () => {
    expect(sql).toContain('ALTER TABLE budget_items ADD COLUMN IF NOT EXISTS approved BOOLEAN;')
  })

  it('status de budgets com os 6 valores', () => {
    expect(sql).toContain("CHECK (status IN ('draft','sent','approved','rejected','expired','completed'))")
  })

  it('lost_reason com os 7 códigos', () => {
    expect(sql).toContain(
      "CHECK (lost_reason IN ('preco','pensar','outro_lugar','tempo','medo','sem_resposta','outro'))",
    )
  })

  it('budget_links sem policy e com um link ativo por orçamento', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS budget_links')
    expect(sql).toContain('ALTER TABLE budget_links ENABLE ROW LEVEL SECURITY;')
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON budget_links/)
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS budget_links_active_uidx ON budget_links (budget_id) WHERE revoked_at IS NULL;',
    )
  })

  it('budget_signatures com RLS e só select', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS budget_signatures')
    expect(sql).toContain("CHECK (provider IN ('app','reception'))")
    expect(sql).toContain('ALTER TABLE budget_signatures ENABLE ROW LEVEL SECURITY;')
    expect(sql).toMatch(/CREATE POLICY "clinic_member_select" ON budget_signatures FOR SELECT/)
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON budget_signatures FOR (INSERT|UPDATE|DELETE|ALL)/)
  })

  it('budget_events: insert só de contato do próprio usuário', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS budget_events')
    expect(sql).toContain(
      "CHECK (type IN ('sent','resent','reminder','viewed','contact','approved','rejected','expired','reopened','edited'))",
    )
    expect(sql).toContain("CHECK (outcome IN ('nao_atendeu','pensar','aprovou','perdido'))")
    expect(sql).toMatch(
      /ON budget_events FOR INSERT TO authenticated\s+WITH CHECK \([^;]*type = 'contact' AND created_by = auth\.uid\(\)\)/,
    )
  })

  it('mensagens aceitam budget e budget_reminder', () => {
    expect(sql).toContain(
      "CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','budget','budget_reminder','manual','auto_reply','incoming'))",
    )
    expect(sql).toContain(
      "CHECK (type IN ('confirmation','reminder','recall','birthday','charge','payment_due','budget','budget_reminder'))",
    )
    if (file === 'schema.sql') {
      expect(sql).toContain('budget_id           UUID REFERENCES budgets(id) ON DELETE SET NULL')
    } else {
      expect(sql).toContain('ALTER TABLE messages ADD COLUMN IF NOT EXISTS budget_id UUID REFERENCES budgets(id) ON DELETE SET NULL;')
    }
  })

  it('seed_message_settings inclui os modelos de orçamento', () => {
    expect(sql).toContain(
      "'Olá, {paciente}! Segue seu orçamento da {clinica}, no valor de {valor}. Para ver os detalhes e aprovar: {link}'",
    )
    expect(sql).toContain(
      "'Olá, {paciente}! Seu orçamento na {clinica} ainda está disponível até {vencimento}. Para ver e aprovar: {link}'",
    )
    expect(sql).toContain('\'{"offset_days":[3,7]}\'')
  })

  it.each(['send_budget', 'approve_budget', 'reject_budget'])('função %s só para o servidor', (fn) => {
    expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`)
    expect(sql).toMatch(
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`),
    )
  })

  it('gatilhos de edição e trava, ignorados no modo sistema', () => {
    expect(sql).toContain('CREATE TRIGGER budgets_guard_trg BEFORE UPDATE ON budgets')
    expect(sql).toContain('CREATE TRIGGER budget_items_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON budget_items')
    expect(sql).toContain("current_setting('app.budget_system', true) = 'on'")
    expect(sql).toContain("PERFORM set_config('app.budget_system', 'on', true);")
    expect(sql).toContain("RAISE EXCEPTION 'Orçamento aprovado não pode ser alterado. Reabra-o ou crie um novo.';")
  })

  it('trava de status: aprovado/concluído só alterna entre si e concluído só vem de aprovado', () => {
    expect(sql).toContain("AND NOT (OLD.status = 'approved' AND NEW.status = 'completed')")
    expect(sql).toContain("AND NOT (OLD.status = 'completed' AND NEW.status = 'approved')")
    expect(sql).toContain("IF NEW.status = 'completed' AND OLD.status NOT IN ('approved','completed') THEN")
  })

  it('approve_budget sobrescreve assinatura existente em vez de falhar na chave', () => {
    expect(sql).toContain('ON CONFLICT (budget_id) DO UPDATE SET')
  })

  it('send_budget usa a data de São Paulo', () => {
    expect(sql).toContain("(NOW() AT TIME ZONE 'America/Sao_Paulo')::date + p_validity_days")
  })

  it('preenche os dados antigos antes dos gatilhos', () => {
    const backfill = sql.indexOf('UPDATE budgets SET approved_total = total, decided_at = created_at')
    const trigger = sql.indexOf('CREATE TRIGGER budgets_guard_trg')
    expect(backfill).toBeGreaterThan(-1)
    expect(trigger).toBeGreaterThan(backfill)
    expect(sql).toContain('UPDATE budget_items SET approved = TRUE')
    expect(sql).toContain("UPDATE budgets SET lost_reason = 'outro', decided_at = created_at")
    expect(sql).toContain('approved_total IS NULL')
    expect(sql).toContain('lost_reason IS NULL')
  })
})

describe('2026-11-05-funil-orcamentos.sql clínicas existentes', () => {
  const sql = read('2026-11-05-funil-orcamentos.sql')
  it('cria as duas configurações para clínicas já cadastradas', () => {
    expect(sql).toMatch(/SELECT c\.id, 'budget', TRUE[^;]*FROM clinics c\s+ON CONFLICT \(clinic_id, type\) DO NOTHING;/)
    expect(sql).toMatch(/SELECT c\.id, 'budget_reminder', TRUE[^;]*FROM clinics c\s+ON CONFLICT \(clinic_id, type\) DO NOTHING;/)
  })
})

describe.each(['2026-11-05-funil-orcamentos.sql', 'schema.sql'])('%s link da assinatura e tentativas atômicas', (file) => {
  const sql = read(file)
  it('budget_signatures guarda o link usado e approve_budget o grava', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS link_id UUID REFERENCES budget_links(id) ON DELETE SET NULL')
    expect(sql).toContain('signed_at, approved_by, link_id')
    expect(sql).toContain('    p_link_id\n  )')
    expect(sql).toContain('link_id       = EXCLUDED.link_id;')
  })
  it('register_failed_attempt é uma função só do servidor', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.register_failed_attempt(p_link_id UUID, p_clinic_id UUID)')
    expect(sql).toMatch(/register_failed_attempt[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = public/)
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.register_failed_attempt(UUID, UUID) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain("NOW() + INTERVAL '1 hour'")
  })
})

describe.each(['2026-11-05-funil-orcamentos.sql', 'schema.sql'])('%s ajustes da revisão final', (file) => {
  const sql = read(file)
  it('send_budget renova a validade vencida e zera viewed_at', () => {
    expect(sql).toContain("WHEN valid_until IS NULL OR valid_until < (NOW() AT TIME ZONE 'America/Sao_Paulo')::date")
    expect(sql).toContain('viewed_at   = NULL,')
  })
  it('budget_items_guard bloqueia mover item entre orçamentos', () => {
    expect(sql).toContain("IF TG_OP = 'UPDATE' AND OLD.budget_id IS DISTINCT FROM NEW.budget_id THEN")
    expect(sql).toContain("RAISE EXCEPTION 'Não é possível mover itens entre orçamentos.'")
  })
  it('approve_budget exige link não bloqueado', () => {
    expect(sql).toContain('AND (locked_until IS NULL OR locked_until <= NOW())')
  })
})

describe.each(['2026-11-06-evolucao-por-voz.sql', 'schema.sql'])('%s evolucao-por-voz', (file) => {
  const sql = read(file)

  it('cria ai_connections e ai_usage como na especificação', () => {
    expect(sql).toMatch(/CREATE TABLE (IF NOT EXISTS )?ai_connections \(\s+clinic_id\s+UUID PRIMARY KEY REFERENCES clinics\(id\) ON DELETE CASCADE,/)
    expect(sql).toMatch(/api_key_last4 TEXT NOT NULL,/)
    expect(sql).toContain("CHECK (model_tier IN ('economico','caprichado'))")
    expect(sql).toMatch(/CREATE TABLE (IF NOT EXISTS )?ai_usage \(/)
    expect(sql).toContain("CHECK (kind IN ('transcricao','evolucao','anamnese'))")
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS \w+ ON ai_usage \(clinic_id, created_at\);/)
  })

  it('as duas tabelas têm RLS e nenhuma policy', () => {
    for (const t of ['ai_connections', 'ai_usage']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`))
      expect(sql).not.toMatch(new RegExp(`CREATE POLICY[^;]*ON ${t}\\b`))
    }
  })

  it('marca ai_used em evolutions e anamneses', () => {
    expect(sql).toMatch(/ALTER TABLE evolutions\s+ADD COLUMN IF NOT EXISTS ai_used BOOLEAN NOT NULL DEFAULT FALSE;/)
    expect(sql).toMatch(/ALTER TABLE anamneses\s+ADD COLUMN IF NOT EXISTS ai_used BOOLEAN NOT NULL DEFAULT FALSE;/)
  })

  it('save_evolution_with_actions é SECURITY DEFINER, em modo sistema e só da service_role', () => {
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.save_evolution_with_actions'))
    expect(fn).toContain('CREATE OR REPLACE FUNCTION public.save_evolution_with_actions')
    expect(fn).toContain('SECURITY DEFINER')
    expect(fn).toContain("set_config('app.budget_system', 'on', true)")
    expect(fn).toMatch(/REVOKE ALL ON FUNCTION public\.save_evolution_with_actions\([^)]*\) FROM PUBLIC, anon, authenticated;/)
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_evolution_with_actions\([^)]*\) TO service_role;/)
    expect(fn).toContain('Paciente ou consulta inválidos')
  })
})
