import { describe, it, expect } from 'vitest'
import { montarTexto, EvolucaoOutputSchema, EVOLUCAO_SYSTEM } from '@/lib/ia/evolucao/esquema'

describe('montarTexto', () => {
  it('omite seções nulas ou vazias', () => {
    expect(montarTexto({ motivo: 'Dor', procedimentos: 'Restauração 36 MO', observacoes: null, proximos_passos: '  ' }))
      .toBe('Motivo\nDor\n\nProcedimentos realizados\nRestauração 36 MO')
  })
  it('todas nulas → vazio', () => {
    expect(montarTexto({ motivo: null, procedimentos: null, observacoes: null, proximos_passos: null })).toBe('')
  })
  it('usa os quatro títulos', () => {
    const t = montarTexto({ motivo: 'a', procedimentos: 'b', observacoes: 'c', proximos_passos: 'd' })
    expect(t).toBe('Motivo\na\n\nProcedimentos realizados\nb\n\nObservações\nc\n\nPróximos passos\nd')
  })
})

describe('EvolucaoOutputSchema', () => {
  it('aceita resposta completa e rejeita campo ausente', () => {
    const sug = { tipo: 'retorno', ref: null, novo_status: null, procedimento: null, dentes: null, faces: null, status: null, dias: 7, motivo: 'x' }
    const ok = { secoes: { motivo: null, procedimentos: null, observacoes: null, proximos_passos: null }, sugestoes: [sug] }
    expect(EvolucaoOutputSchema.safeParse(ok).success).toBe(true)
    const semDias = { ...sug, dias: undefined }
    expect(EvolucaoOutputSchema.safeParse({ ...ok, sugestoes: [semDias] }).success).toBe(false)
  })
  it('prompt cobre as regras', () => {
    for (const t of ['português', 'FDI', 'V M O D L', 'tratamento_novo', 'apelidos']) expect(EVOLUCAO_SYSTEM).toContain(t)
  })
})
