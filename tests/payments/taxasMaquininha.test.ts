import { describe, expect, it } from 'vitest'
import {
  faixaPara,
  formatarPercentual,
  lerPercentual,
  lerTaxas,
  liquidoCentavos,
  taxaPara,
} from '@/lib/payments/taxasMaquininha'

describe('lerTaxas', () => {
  it('lê números e textos com vírgula ou ponto', () => {
    expect(lerTaxas({ debito: 1.4, credito_vista: '3,1', credito_2a6: '4.5' }))
      .toEqual({ debito: 1.4, credito_vista: 3.1, credito_2a6: 4.5 })
  })

  it('ignora vazios, inválidos, fora de 0–100 e as chaves antigas por bandeira', () => {
    expect(lerTaxas({ debito: '', credito_vista: 'abc', credito_2a6: 120, pix: -1, visa_credito: '2.5' })).toEqual({})
  })

  it('aceita nulo e formatos estranhos', () => {
    expect(lerTaxas(null)).toEqual({})
    expect(lerTaxas('x')).toEqual({})
    expect(lerTaxas([1, 2])).toEqual({})
  })
})

describe('faixaPara', () => {
  it('separa débito, crédito por parcelas e pix', () => {
    expect(faixaPara('cartao_debito', 1)).toBe('debito')
    expect(faixaPara('cartao_credito', 1)).toBe('credito_vista')
    expect(faixaPara('cartao_credito', 2)).toBe('credito_2a6')
    expect(faixaPara('cartao_credito', 6)).toBe('credito_2a6')
    expect(faixaPara('cartao_credito', 7)).toBe('credito_7a12')
    expect(faixaPara('cartao_credito', 12)).toBe('credito_7a12')
    expect(faixaPara('pix', 1)).toBe('pix')
  })

  it('não tem taxa para dinheiro, boleto e convênio', () => {
    expect(faixaPara('dinheiro', 1)).toBeNull()
    expect(faixaPara('boleto', 1)).toBeNull()
    expect(faixaPara('convenio', 1)).toBeNull()
  })
})

describe('taxaPara', () => {
  const taxas = { debito: 1.4, credito_vista: 3.1, credito_7a12: 6 }
  it('devolve a taxa configurada ou 0 quando a faixa está em branco', () => {
    expect(taxaPara(taxas, 'cartao_debito', 1)).toBe(1.4)
    expect(taxaPara(taxas, 'cartao_credito', 10)).toBe(6)
    expect(taxaPara(taxas, 'cartao_credito', 3)).toBe(0)
    expect(taxaPara(taxas, 'dinheiro', 1)).toBeNull()
  })
})

describe('liquidoCentavos', () => {
  it('desconta a taxa e arredonda para o centavo', () => {
    expect(liquidoCentavos(40000, 3.1)).toBe(38760)
    expect(liquidoCentavos(10000, 0)).toBe(10000)
    expect(liquidoCentavos(333, 2.5)).toBe(325)
  })

  it('limita a taxa entre 0 e 100%', () => {
    expect(liquidoCentavos(10000, 150)).toBe(0)
    expect(liquidoCentavos(10000, -5)).toBe(10000)
  })
})

describe('lerPercentual / formatarPercentual', () => {
  it('lê o que a pessoa digita', () => {
    expect(lerPercentual('2,5')).toBe(2.5)
    expect(lerPercentual(' 3.19 ')).toBe(3.19)
    expect(lerPercentual('0')).toBe(0)
    expect(lerPercentual('')).toBe(0)
    expect(lerPercentual('abc')).toBeNull()
    expect(lerPercentual('101')).toBeNull()
    expect(lerPercentual('-1')).toBeNull()
  })

  it('mostra com vírgula e sem zeros sobrando', () => {
    expect(formatarPercentual(2.5)).toBe('2,5')
    expect(formatarPercentual(3)).toBe('3')
    expect(formatarPercentual(3.19)).toBe('3,19')
  })
})
