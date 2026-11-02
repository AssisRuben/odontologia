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
