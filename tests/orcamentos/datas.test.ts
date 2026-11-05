import { describe, it, expect } from 'vitest'
import { brDateFromInstant, maskCpfMiddle } from '@/lib/orcamentos/datas'
import { buildSnapshot } from '@/lib/orcamentos/assinatura'
import { buildReceiptPdf } from '@/lib/orcamentos/comprovante'

describe('datas do orçamento', () => {
  it('converte o instante para a data de São Paulo', () => {
    expect(brDateFromInstant('2026-11-06T01:30:00Z')).toBe('05/11/2026')
    expect(brDateFromInstant('2026-11-06T04:00:00Z')).toBe('06/11/2026')
  })
  it('mascara o CPF mantendo os 6 dígitos do meio', () => {
    expect(maskCpfMiddle('52998224725')).toBe('***.982.247-**')
    expect(maskCpfMiddle('529.982.247-25')).toBe('***.982.247-**')
  })
  it('comprovante aceita maskCpf', async () => {
    const s = buildSnapshot({
      clinicName: 'C', patientName: 'P', professionalName: null,
      budget: { id: 'abcdef12', created_at: '2026-11-06T01:30:00Z', valid_until: null },
      items: [{ id: '1', procedure: 'X', tooth: null, quantity: 1, unit_price: 10 }],
      approvedIds: ['1'], signer: { name: 'Maria Silva', cpf: '52998224725' }, signedAt: new Date('2026-11-06T12:00:00Z'),
    })
    const pdf = await buildReceiptPdf(s, { hash: 'h', ip: null, userAgent: null, provider: 'app', maskCpf: true })
    expect(Buffer.from(pdf.slice(0, 4)).toString()).toBe('%PDF')
  })
})
