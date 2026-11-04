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
