import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (f: string) =>
  readFileSync(path.resolve(__dirname, '../../supabase', f), 'utf8').replace(/\r\n/g, '\n')

describe.each(['2026-11-22-importacao-codental.sql', 'schema.sql'])('%s', (file) => {
  const sql = read(file)

  it.each(['patients', 'appointments', 'treatments', 'budgets'])('marca a origem em %s', (t) => {
    expect(sql).toContain(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS imported_from TEXT`)
  })

  it('cria as tabelas de importação com RLS', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS import_links')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS legacy_payments')
    expect(sql).toContain('ALTER TABLE legacy_payments ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE import_links ENABLE ROW LEVEL SECURITY')
  })

  it('não marca material pendente em tratamento importado', () => {
    expect(sql).toContain("IF NEW.status = 'completed' AND NEW.imported_from IS NULL")
  })

  it('tratamento importado reaberto e concluído de novo não fica pendente', () => {
    expect(sql).toMatch(/NEW\.status = 'completed' AND OLD\.status IS DISTINCT FROM 'completed'\s+AND NEW\.imported_from IS NULL\s+AND NEW\.material_status IS NULL/)
  })

  it('legacy_payments só tem policy de leitura', () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON legacy_payments FOR (INSERT|UPDATE|DELETE|ALL)/)
    expect(sql).toMatch(/CREATE POLICY[^;]*ON legacy_payments FOR SELECT/)
  })

  it('import_links fica sem policies', () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON import_links/)
  })
})
