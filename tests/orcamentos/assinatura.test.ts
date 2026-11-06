import { describe, it, expect } from 'vitest'
import {
  buildSnapshot, canonicalJson, hashSnapshot, checkSignerCpf, appSignatureProvider,
} from '@/lib/orcamentos/assinatura'

const args = () => ({
  clinicName: 'Clínica X',
  patientName: 'Ana',
  professionalName: 'Dr. Y' as string | null,
  budget: { id: 'abcdef12-3456', created_at: '2026-11-01T10:00:00.000Z', valid_until: '2026-12-01' as string | null },
  items: [
    { id: 'a', procedure: 'Limpeza', tooth: '', quantity: 2, unit_price: 100.1 },
    { id: 'b', procedure: 'Canal', tooth: '11', quantity: 1, unit_price: 500 },
    { id: 'c', procedure: 'Clareamento', tooth: null, quantity: 1, unit_price: 300 },
  ],
  approvedIds: ['a', 'b'],
  signer: { name: 'Ana', cpf: '52998224725' },
  signedAt: new Date('2026-11-05T12:00:00.000Z'),
})

describe('snapshot e hash', () => {
  it('monta o snapshot', () => {
    const s = buildSnapshot(args())
    expect(s.orcamento).toBe('ABCDEF12')
    expect(s.itens_aprovados[0]).toEqual({ procedimento: 'Limpeza', dente: null, quantidade: 2, preco_unitario: '100.10', subtotal: '200.20' })
    expect(s.itens_nao_aprovados).toEqual([{ procedimento: 'Clareamento' }])
    expect(s.total_aprovado).toBe('700.20')
    expect(s.assinado_em).toBe('2026-11-05T12:00:00.000Z')
    expect(s.validade).toBe('2026-12-01')
  })
  it('mantém cpf vazio', () => {
    const a = args(); a.signer.cpf = ''
    expect(buildSnapshot(a).assinante.cpf).toBe('')
  })
  it('mesma entrada, mesmo hash; preço diferente muda', () => {
    expect(hashSnapshot(buildSnapshot(args()))).toBe(hashSnapshot(buildSnapshot(args())))
    const a = args(); a.items[0].unit_price = 101
    expect(hashSnapshot(buildSnapshot(a))).not.toBe(hashSnapshot(buildSnapshot(args())))
    expect(hashSnapshot(buildSnapshot(args()))).toMatch(/^[0-9a-f]{64}$/)
  })
  it('canonicalJson ordena chaves', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }))
    expect(canonicalJson({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}')
  })
})

describe('checkSignerCpf', () => {
  it('confere com o paciente formatado', () => {
    expect(checkSignerCpf('529.982.247-25', '52998224725', null)).toEqual({ ok: true, cpf: '52998224725' })
  })
  it('confere com o responsável', () => {
    expect(checkSignerCpf('52998224725', '11144477735', '52998224725')).toEqual({ ok: true, cpf: '52998224725' })
  })
  it('não confere', () => {
    expect(checkSignerCpf('52998224725', '11144477735', null)).toEqual({ ok: false, error: 'O CPF não confere com o cadastro. Confira ou fale com a clínica.' })
  })
  it('sem cadastro aceita qualquer válido', () => {
    expect(checkSignerCpf('52998224725', null, null)).toEqual({ ok: true, cpf: '52998224725' })
  })
  it('inválido', () => {
    expect(checkSignerCpf('111.111.111-11', null, null)).toEqual({ ok: false, error: 'CPF inválido' })
  })
  it('cadastro inválido conta como ausente', () => {
    expect(checkSignerCpf('52998224725', '11111111111', null)).toEqual({ ok: true, cpf: '52998224725' })
  })
})

describe('appSignatureProvider', () => {
  it('devolve providerRef null', async () => {
    expect(appSignatureProvider.id).toBe('app')
    expect(await appSignatureProvider.sign({})).toEqual({ providerRef: null })
  })
})
