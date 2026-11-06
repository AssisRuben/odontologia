import { describe, it, expect } from 'vitest'
import { validarRespostas, mesclarAnamnese, parsePreencher } from '@/lib/ia/anamnese/respostas'
import { perguntasTexto, type Pergunta } from '@/lib/ia/anamnese/esquema'

const T = '11111111-1111-4111-8111-111111111111'

const perguntas: Pergunta[] = [
  { id: 'q1', text: 'Tem alergia?', type: 'yesno' },
  { id: 'q2', text: 'Doença crônica?', type: 'options', options: ['Diabetes', 'Hipertensão', 'Nenhuma'] },
  { id: 'q3', text: 'Medicamentos', type: 'text' },
]

const ia = (respostas: { id: string; valor: string | null }[], observacoes: string | null = null) => ({
  respostas,
  observacoes,
})

describe('validarRespostas', () => {
  it('yesno: sim vira Sim', () => {
    expect(validarRespostas(ia([{ id: 'q1', valor: 'sim' }]), perguntas).respostas).toEqual({ q1: 'Sim' })
  })
  it('yesno: NAO vira Não', () => {
    expect(validarRespostas(ia([{ id: 'q1', valor: 'NAO' }]), perguntas).respostas).toEqual({ q1: 'Não' })
  })
  it('yesno: talvez é ignorado', () => {
    expect(validarRespostas(ia([{ id: 'q1', valor: 'talvez' }]), perguntas).respostas).toEqual({})
  })
  it('options: casa sem acento/maiúsculas e grava a grafia cadastrada', () => {
    expect(validarRespostas(ia([{ id: 'q2', valor: ' hipertensao ' }]), perguntas).respostas).toEqual({
      q2: 'Hipertensão',
    })
  })
  it('options: fora da lista é ignorado', () => {
    expect(validarRespostas(ia([{ id: 'q2', valor: 'Asma' }]), perguntas).respostas).toEqual({})
  })
  it('id desconhecido, null e vazio são ignorados', () => {
    const r = validarRespostas(
      ia([{ id: 'zzz', valor: 'x' }, { id: 'q3', valor: null }, { id: 'q3', valor: '   ' }]),
      perguntas,
    )
    expect(r.respostas).toEqual({})
  })
  it('text: trim e limite de 500', () => {
    const r = validarRespostas(ia([{ id: 'q3', valor: ' ' + 'a'.repeat(600) }]), perguntas)
    expect(r.respostas.q3).toHaveLength(500)
  })
  it('observações: trim, vazio vira null, limite de 2000', () => {
    expect(validarRespostas(ia([], '  '), perguntas).observacoes).toBeNull()
    expect(validarRespostas(ia([], ' ok '), perguntas).observacoes).toBe('ok')
    expect(validarRespostas(ia([], 'b'.repeat(2500)), perguntas).observacoes).toHaveLength(2000)
  })
  it('entrada malformada não quebra', () => {
    expect(validarRespostas(null, perguntas)).toEqual({ respostas: {}, observacoes: null })
  })
})

describe('mesclarAnamnese', () => {
  it('não sobrescreve resposta existente', () => {
    const r = mesclarAnamnese({ q1: 'Não' }, '', { respostas: { q1: 'Sim', q3: 'Losartana' }, observacoes: null })
    expect(r.answers).toEqual({ q1: 'Não', q3: 'Losartana' })
    expect(r.preenchidas).toEqual(['q3'])
  })
  it('preenche resposta só com espaços', () => {
    const r = mesclarAnamnese({ q2: '  ' }, '', { respostas: { q2: 'Diabetes' }, observacoes: null })
    expect(r.answers.q2).toBe('Diabetes')
    expect(r.preenchidas).toEqual(['q2'])
  })
  it('notas: junta com quebra de linha', () => {
    expect(mesclarAnamnese({}, 'A', { respostas: {}, observacoes: 'B' }).notes).toBe('A\nB')
  })
  it('notas vazias: só a observação', () => {
    expect(mesclarAnamnese({}, '', { respostas: {}, observacoes: 'B' }).notes).toBe('B')
  })
  it('sem observação mantém as notas', () => {
    expect(mesclarAnamnese({}, 'A', { respostas: {}, observacoes: null }).notes).toBe('A')
  })
})

describe('perguntasTexto', () => {
  it('uma linha por pergunta', () => {
    expect(perguntasTexto(perguntas).split('\n')).toEqual([
      'q1 | yesno | Tem alergia?',
      'q2 | options | Doença crônica? | opções: Diabetes; Hipertensão; Nenhuma',
      'q3 | text | Medicamentos',
    ])
  })
})

describe('parsePreencher', () => {
  it('aceita e faz trim', () => {
    expect(parsePreencher({ templateId: T, texto: ' oi ' })).toEqual({ ok: true, templateId: T, texto: 'oi' })
  })
  it('templateId inválido: 422', () => {
    expect(parsePreencher({ templateId: 'x', texto: 'oi' })).toMatchObject({ ok: false, status: 422 })
  })
  it('texto vazio ou longo: 422', () => {
    expect(parsePreencher({ templateId: T, texto: '  ' })).toMatchObject({
      ok: false, status: 422, error: 'Texto vazio ou longo demais',
    })
    expect(parsePreencher({ templateId: T, texto: 'a'.repeat(20001) })).toMatchObject({ ok: false, status: 422 })
  })
})
