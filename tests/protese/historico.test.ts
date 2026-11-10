import { describe, it, expect } from 'vitest'
import { idasAoLab, dataInstalacao, visivelNoQuadro } from '@/lib/protese/historico'

describe('idasAoLab', () => {
  it('conta envios ao laboratório', () => {
    expect(idasAoLab([{ to_status: 'requested' }, { to_status: 'sent_to_lab' }, { to_status: 'returned' }, { to_status: 'sent_to_lab' }])).toBe(2)
    expect(idasAoLab([])).toBe(0)
  })
})

describe('dataInstalacao', () => {
  it('usa o último evento de instalação', () => {
    expect(dataInstalacao({
      status: 'installed', requested_at: '2026-09-01',
      events: [
        { to_status: 'installed', created_at: '2026-10-01' },
        { to_status: 'returned', created_at: '2026-10-05' },
        { to_status: 'installed', created_at: '2026-10-20' },
      ],
    })).toBe('2026-10-20')
  })
  it('migrada instalada sem evento de instalação usa requested_at', () => {
    expect(dataInstalacao({ status: 'installed', requested_at: '2026-09-01', events: [{ to_status: 'requested', created_at: '2026-09-01' }] })).toBe('2026-09-01')
    expect(dataInstalacao({ status: 'installed', requested_at: '2026-09-01' })).toBe('2026-09-01')
  })
  it('não instalada sem evento → null', () => {
    expect(dataInstalacao({ status: 'sent_to_lab', requested_at: '2026-09-01', events: [] })).toBeNull()
  })
})

describe('visivelNoQuadro', () => {
  const inst = (d: string) => ({ status: 'installed' as const, requested_at: '2026-01-01', events: [{ to_status: 'installed' as const, created_at: d }] })
  it('instalada há 30 dias ainda aparece; há 31 some', () => {
    expect(visivelNoQuadro(inst('2026-10-11'), '2026-11-10', false)).toBe(true)
    expect(visivelNoQuadro(inst('2026-10-10'), '2026-11-10', false)).toBe(false)
  })
  it('com "todas" sempre aparece', () => {
    expect(visivelNoQuadro(inst('2026-10-10'), '2026-11-10', true)).toBe(true)
  })
  it('não instalada sempre aparece', () => {
    expect(visivelNoQuadro({ status: 'sent_to_lab', requested_at: '2025-01-01' }, '2026-11-10', false)).toBe(true)
  })
  it('migrada instalada sem evento usa requested_at', () => {
    expect(visivelNoQuadro({ status: 'installed', requested_at: '2026-01-01' }, '2026-11-10', false)).toBe(false)
    expect(visivelNoQuadro({ status: 'installed', requested_at: '2026-11-01' }, '2026-11-10', false)).toBe(true)
  })
  it('timestamp é convertido para o dia de São Paulo', () => {
    // 2026-10-11T01:00Z = 2026-10-10 em SP, portanto 31 dias
    expect(visivelNoQuadro(inst('2026-10-11T01:00:00Z'), '2026-11-10', false)).toBe(false)
    expect(visivelNoQuadro(inst('2026-10-11T04:00:00Z'), '2026-11-10', false)).toBe(true)
  })
})
