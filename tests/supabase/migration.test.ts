import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES } from '@/lib/messaging/templates'

const read = (f: string) =>
  readFileSync(path.resolve(__dirname, '../../supabase', f), 'utf8').replace(/\r\n/g, '\n')

describe.each(['2026-11-04-cobranca-asaas.sql', 'schema.sql'])('%s', (file) => {
  const sql = read(file)
  it.each(Object.entries(DEFAULT_TEMPLATES))('contém o modelo padrão de %s', (_type, template) => {
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
