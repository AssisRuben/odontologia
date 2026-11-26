import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (f: string) =>
  readFileSync(path.resolve(__dirname, '../../supabase', f), 'utf8').replace(/\r\n/g, '\n')

describe.each(['2026-11-26-cancelado-por.sql', 'schema.sql'])('%s', (file) => {
  const sql = read(file)

  it('cria a coluna cancelled_by com os dois valores', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS cancelled_by TEXT')
    expect(sql).toContain("CHECK (cancelled_by IN ('patient','professional'))")
  })

  it('apaga quem cancelou quando a consulta deixa de estar cancelada', () => {
    expect(sql).toContain("NEW.status <> 'cancelled'")
    expect(sql).toContain('NEW.cancelled_by := NULL')
    const drop = sql.indexOf('DROP TRIGGER IF EXISTS appointments_cancelled_by_clear ON appointments;')
    const create = sql.indexOf('CREATE TRIGGER appointments_cancelled_by_clear')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })

  it('remarcação pelo agente grava o paciente', () => {
    expect(sql).toMatch(/UPDATE appointments SET status = 'cancelled', cancelled_by = 'patient'/)
  })
})
