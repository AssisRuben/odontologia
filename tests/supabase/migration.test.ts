import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES } from '@/lib/messaging/templates'

const read = (f: string) =>
  readFileSync(path.resolve(__dirname, '../../supabase', f), 'utf8').replace(/\r\n/g, '\n')

describe.each(['2026-11-02-whatsapp-automatico.sql', 'schema.sql'])('%s', (file) => {
  const sql = read(file)
  it.each(Object.entries(DEFAULT_TEMPLATES))('contém o modelo padrão de %s', (_type, template) => {
    expect(sql).toContain(template.replace(/'/g, "''"))
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
