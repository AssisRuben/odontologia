import { describe, it, expect } from 'vitest'
import { buildSnapshot, hashSnapshot } from '@/lib/orcamentos/assinatura'
import { buildReceiptPdf } from '@/lib/orcamentos/comprovante'

function snap(n = 2) {
  return buildSnapshot({
    clinicName: 'Clínica', patientName: 'José Ação – “teste”', professionalName: null,
    budget: { id: 'abcdef12', created_at: '2026-11-01T10:00:00.000Z', valid_until: null },
    items: Array.from({ length: n }, (_, i) => ({ id: String(i), procedure: `Proc ${i}`, tooth: '11', quantity: 1, unit_price: 10 })),
    approvedIds: Array.from({ length: n }, (_, i) => String(i)),
    signer: { name: 'José Ação – “teste”', cpf: '52998224725' },
    signedAt: new Date('2026-11-05T12:00:00.000Z'),
  })
}

describe('buildReceiptPdf', () => {
  for (const provider of ['app', 'reception'] as const) {
    it(`gera PDF (${provider})`, async () => {
      const s = snap()
      const pdf = await buildReceiptPdf(s, { hash: hashSnapshot(s), ip: '1.2.3.4', userAgent: 'UA', provider })
      expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe('%PDF')
    })
  }
  it('aceita muitos itens, cpf vazio e metadados nulos', async () => {
    const s = snap(80); s.assinante.cpf = ''
    const pdf = await buildReceiptPdf(s, { hash: 'h', ip: null, userAgent: null, provider: 'reception' })
    expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe('%PDF')
  })
})
