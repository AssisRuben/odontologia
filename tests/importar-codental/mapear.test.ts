import { describe, expect, it } from 'vitest'
import { mapearBackup } from '../../scripts/importar-codental/mapear.mjs'

type Linha = Record<string, unknown>
type Parcial = Partial<Record<'pacientes' | 'consultas' | 'convenios' | 'evolucoes' | 'orcamentos' | 'pagamentos' | 'tratamentos', Linha[]>>

const agora = new Date('2026-06-01T12:00:00.000Z')
const opts = { clinicId: 'clinica-teste', professionalId: 'prof-teste', agora }

const numerar = (linhas: Linha[] = []) => linhas.map((l, i) => ({ ...l, _linha: i + 2 }))
const paciente = (over: Linha = {}): Linha => ({ ID: 'P1', Numero: 1, 'Nome completo': 'Fulano Fictício', ...over })
const mapear = (b: Parcial) => mapearBackup({
  pacientes: numerar(b.pacientes ?? [paciente()]),
  consultas: numerar(b.consultas),
  convenios: numerar(b.convenios),
  evolucoes: numerar(b.evolucoes),
  orcamentos: numerar(b.orcamentos),
  pagamentos: numerar(b.pagamentos),
  tratamentos: numerar(b.tratamentos),
  profissionais: [],
}, opts)

const consulta = (over: Linha = {}): Linha => ({
  'ID Paciente': 'P1', 'Data consulta': '05/01/2026 09:00', Duração: 30, Status: 'Finalizada', ...over,
})
const tratamento = (over: Linha = {}): Linha => ({
  ID: 'T1', 'ID Paciente': 'P1', Procedimento: 'Restauração', Convênio: 'Plano Teste', Finalizado: 'Sim',
  Dente: '---', Faces: '---', 'Data de criação': '10/02/2026', ...over,
})
const preco = (over: Linha = {}): Linha => ({
  ID: 'PR1', Procedimento: 'Restauração', Valor: 'R$ 100,00', Ativo: 'Sim', Categoria: 'Geral',
  Convênio: 'Plano Teste', 'ID Convênio': 'C1', ...over,
})
const pagamento = (over: Linha = {}): Linha => ({
  'ID Paciente': 'P1', Pagamento: 'Parcela fictícia', 'Valor total': 'R$ 50,00', 'Valor liquído': 'R$ 50,00',
  'Data de vencimento': '10/03/2026', 'Data de pagamento': '10/03/2026', 'Forma de pagamento': 'Pix',
  Parcela: 1, 'Total de parcelas': 2, ...over,
})
const orcamento = (over: Linha = {}): Linha => ({
  ID: 'O1', 'ID Paciente': 'P1', Orçamento: 'Plano fictício', 'Valor total': 'R$ 300,00', Aprovado: 'Sim',
  'Data de criação': '01/02/2026', ...over,
})

describe('consultas', () => {
  it.each([
    ['Finalizada', 'completed'], ['Faltou', 'no_show'],
    ['Cancelada pelo paciente', 'cancelled'], ['Cancelada pelo dentista', 'cancelled'],
  ])('%s vira %s', (Status, esperado) => {
    const [c] = mapear({ consultas: [consulta({ Status })] }).consultas
    expect(c.status).toBe(esperado)
    expect(c.imported_from).toBe('codental')
  })

  it('cancelada guarda quem cancelou, com observação e etiquetas', () => {
    const [c] = mapear({ consultas: [consulta({ Status: 'Cancelada pelo dentista', Observação: 'Obs teste', Etiquetas: 'Retorno' })] }).consultas
    expect(c.notes).toContain('Cancelada pelo dentista')
    expect(c.notes).toContain('Obs teste')
    expect(c.notes).toContain('Retorno')
  })

  it.each(['Agendada', 'Confirmada'])('passada %s vira cancelada sem desfecho, com marca', (Status) => {
    const plano = mapear({ consultas: [consulta({ Status })] })
    expect(plano.consultas[0].status).toBe('cancelled')
    expect(plano.consultas[0].notes).toContain('sem desfecho registrado no Codental')
    expect(plano.consultas[0].imported_from).toBe('codental')
    expect(plano.avisos.consultasSemDesfecho).toBe(1)
  })

  it.each([['Agendada', 'scheduled'], ['Confirmada', 'confirmed']])('futura %s vira %s, sem marca', (Status, esperado) => {
    const plano = mapear({ consultas: [consulta({ Status, 'Data consulta': '05/07/2026 09:00' })] })
    expect(plano.consultas[0].status).toBe(esperado)
    expect(plano.consultas[0].imported_from).toBeNull()
    expect(plano.avisos.consultasSemDesfecho).toBe(0)
  })

  it('exatamente em agora conta como passada', () => {
    const [c] = mapear({ consultas: [consulta({ Status: 'Agendada', 'Data consulta': '01/06/2026 09:00' })] }).consultas
    expect(c.status).toBe('cancelled')
  })

  it('converte para UTC e soma a duração', () => {
    const [c] = mapear({ consultas: [consulta({ Duração: 45 })] }).consultas
    expect(c.start_time).toBe('2026-01-05T12:00:00.000Z')
    expect(c.end_time).toBe('2026-01-05T12:45:00.000Z')
  })

  it.each([0, -5, 1.5, 'meia hora', null])('duração inválida (%s) é erro', (Duração) => {
    expect(() => mapear({ consultas: [consulta({ Duração })] })).toThrow(/consultas.*Duração.*linha 2/)
  })

  it('duplicadas são preservadas com sourceId distinto', () => {
    const { consultas } = mapear({ consultas: [consulta(), consulta()] })
    expect(consultas.map((c: { sourceId: string }) => c.sourceId)).toEqual(['P1|05/01/2026 09:00|0', 'P1|05/01/2026 09:00|1'])
  })

  it('status desconhecido é erro sem o valor', () => {
    let msg = ''
    try { mapear({ consultas: [consulta({ Status: 'VALOR-SECRETO' })] }) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/consultas.*Status.*linha 2/)
    expect(msg).not.toContain('VALOR-SECRETO')
  })
})

describe('pacientes', () => {
  it('mapeia contatos, documentos e nascimento', () => {
    const [p] = mapear({ pacientes: [paciente({
      CPF: '529.982.247-25', Celular: '(11) 90000-0001', 'Data de nascimento': 45000, Sexo: 'Feminino',
      'Responsável nome': 'Responsável Fictício', 'Responsável CPF': '111.444.777-35',
      'Numero da carterinha': 'CART1', 'Data de criação': '01/01/2024',
    })] }).pacientes
    expect(p).toMatchObject({
      sourceId: 'P1', numero: '1', name: 'Fulano Fictício', cpf: '52998224725',
      phone: '11900000001', whatsapp: '11900000001', birthdate: '2023-03-15', gender: 'F',
      payer_name: 'Responsável Fictício', payer_cpf: '11144477735', insurance_card: 'CART1',
      created_at: '2024-01-01T03:00:00.000Z', imported_from: 'codental',
    })
  })

  it('Telefone tem prioridade em phone', () => {
    const [p] = mapear({ pacientes: [paciente({ Telefone: '(11) 3000-0000', Celular: '11900000001' })] }).pacientes
    expect(p.phone).toBe('1130000000')
    expect(p.whatsapp).toBe('11900000001')
  })

  it.each([['Masculino', 'M'], ['Feminino', 'F'], ['Outro', 'O'], [null, null]])('Sexo %s vira %s', (Sexo, g) => {
    expect(mapear({ pacientes: [paciente({ Sexo })] }).pacientes[0].gender).toBe(g)
  })

  it('Sexo desconhecido é erro', () => {
    expect(() => mapear({ pacientes: [paciente({ Sexo: 'X' })] })).toThrow(/pacientes.*Sexo.*linha 2/)
    expect(() => mapear({ pacientes: [paciente({ Sexo: 'constructor' })] })).toThrow(/pacientes.*Sexo.*linha 2/)
  })

  it.each(['Particular', null])('plano %s fica sem convênio', (plano) => {
    expect(mapear({ pacientes: [paciente({ 'Nome do plano': plano })] }).pacientes[0].convenioNome).toBeNull()
  })

  it('plano nomeado é mantido', () => {
    expect(mapear({ pacientes: [paciente({ 'Nome do plano': 'Plano Teste' })] }).pacientes[0].convenioNome).toBe('Plano Teste')
  })

  it('endereço null se vazio; preenchido quando há dado', () => {
    const { pacientes } = mapear({ pacientes: [paciente(), paciente({ ID: 'P2', Cidade: 'Cidade Teste', CEP: '01000-000' })] })
    expect(pacientes[0].address).toBeNull()
    expect(pacientes[1].address).toEqual({ street: null, complement: null, neighborhood: null, city: 'Cidade Teste', state: null, zip: '01000-000' })
  })

  it('notas juntam o que não tem coluna própria, em linhas rotuladas', () => {
    const [p] = mapear({ pacientes: [paciente({
      Observações: 'Obs', Anotações: 'Anot', Profissão: 'Testador', RG: '12345',
      'Contato de emergência nome': 'Contato', 'Contato de emergência telefone': '11900000002',
      'Responsável data de nascimento': 45000, 'CPF do titular': '111.444.777-35', 'Como conheceu': 'Indicação',
    })] }).pacientes
    for (const t of ['Obs', 'Anot', 'Profissão: Testador', 'RG: 12345', 'Contato', '11900000002', '15/03/2023', '111.444.777-35', 'Como conheceu: Indicação']) {
      expect(p.notes).toContain(t)
    }
    expect(mapear({}).pacientes[0].notes).toBeNull()
  })

  it('ID repetido é erro', () => {
    expect(() => mapear({ pacientes: [paciente(), paciente()] })).toThrow(/pacientes.*ID.*linha 3/)
  })
})

describe('tabela de preços', () => {
  it('um convênio por ID, sem Particular', () => {
    const plano = mapear({ convenios: [
      preco(), preco({ ID: 'PR2', Procedimento: 'Limpeza' }),
      preco({ ID: 'PR3', Convênio: 'Particular', 'ID Convênio': 'C0' }),
    ] })
    expect(plano.convenios).toEqual([{ sourceId: 'C1', name: 'Plano Teste' }])
    expect(plano.procedimentos.map((p) => p.sourceId)).toEqual(['PR1', 'PR2'])
    expect(plano.procedimentos[0]).toEqual({
      sourceId: 'PR1', code: 'PR1', convenioSourceId: 'C1', name: 'Restauração', price: 100, active: true, category: 'Geral',
    })
  })

  it('code acima de 20 caracteres é erro', () => {
    expect(() => mapear({ convenios: [preco({ ID: 'X'.repeat(21) })] })).toThrow(/convenios.*ID.*linha 2/)
  })

  it('valor vem da tabela do convênio', () => {
    const plano = mapear({ convenios: [preco()], tratamentos: [tratamento({ Procedimento: ' Restauração ' })] })
    expect(plano.tratamentos[0]).toMatchObject({ value: 100, procedimentoSourceId: 'PR1', convenioNome: 'Plano Teste' })
    expect(plano.avisos.tratamentosSemValor).toBe(0)
  })

  it('sem coincidência: 0 e aviso', () => {
    const plano = mapear({ convenios: [preco()], tratamentos: [tratamento({ Procedimento: 'Outro' })] })
    expect(plano.tratamentos[0]).toMatchObject({ value: 0, procedimentoSourceId: null })
    expect(plano.avisos.tratamentosSemValor).toBe(1)
  })

  it('Particular usa a própria tabela, sem procedimento', () => {
    const plano = mapear({
      convenios: [preco({ Convênio: 'Particular', 'ID Convênio': 'C0', Valor: 'R$ 80,00' })],
      tratamentos: [tratamento({ Convênio: 'Particular' })],
    })
    expect(plano.tratamentos[0]).toMatchObject({ value: 80, procedimentoSourceId: null, convenioNome: null })
    expect(plano.avisos.tratamentosSemValor).toBe(0)
  })

  it('Convênio vazio fica sem valor e com aviso', () => {
    const plano = mapear({
      convenios: [preco({ Convênio: 'Particular', 'ID Convênio': 'C0' })],
      tratamentos: [tratamento({ Convênio: null })],
    })
    expect(plano.tratamentos[0]).toMatchObject({ value: 0, procedimentoSourceId: null, convenioNome: null })
    expect(plano.avisos.tratamentosSemValor).toBe(1)
  })

  it('ativas têm prioridade sobre inativas', () => {
    const plano = mapear({
      convenios: [preco({ ID: 'PR1', Valor: 'R$ 50,00', Ativo: 'Não' }), preco({ ID: 'PR2', Valor: 'R$ 100,00' })],
      tratamentos: [tratamento()],
    })
    expect(plano.tratamentos[0]).toMatchObject({ value: 100, procedimentoSourceId: 'PR2' })
  })

  it('só inativas com preço único: usa a primeira', () => {
    const plano = mapear({
      convenios: [preco({ ID: 'PR1', Ativo: 'Não' }), preco({ ID: 'PR2', Ativo: 'Não' })],
      tratamentos: [tratamento()],
    })
    expect(plano.tratamentos[0]).toMatchObject({ value: 100, procedimentoSourceId: 'PR1' })
  })

  it('preços conflitantes: 0, null e aviso', () => {
    const plano = mapear({
      convenios: [preco({ ID: 'PR1' }), preco({ ID: 'PR2', Valor: 'R$ 120,00' })],
      tratamentos: [tratamento()],
    })
    expect(plano.tratamentos[0]).toMatchObject({ value: 0, procedimentoSourceId: null })
    expect(plano.avisos.tratamentosSemValor).toBe(1)
  })
})

describe('tratamentos', () => {
  it('Finalizado=Sim: completed com marca; data sem conversão', () => {
    const [t] = mapear({ tratamentos: [tratamento()] }).tratamentos
    expect(t).toMatchObject({ status: 'completed', imported_from: 'codental', date: '2026-02-10', created_at: '2026-02-10T03:00:00.000Z' })
  })

  it('Finalizado=Não: planned sem marca', () => {
    const [t] = mapear({ tratamentos: [tratamento({ Finalizado: 'Não' })] }).tratamentos
    expect(t).toMatchObject({ status: 'planned', imported_from: null })
  })

  it('mesmas faces para cada dente, nas chaves do odontograma', () => {
    const [t] = mapear({ tratamentos: [tratamento({ Dente: '11, 12', Faces: 'V, O/I' })] }).tratamentos
    expect(t.dentes).toEqual([{ tooth_number: 11, faces: ['V', 'O'] }, { tooth_number: 12, faces: ['V', 'O'] }])
  })

  it('L/P vira L', () => {
    const [t] = mapear({ tratamentos: [tratamento({ Dente: '11', Faces: 'M, V, L/P' })] }).tratamentos
    expect(t.dentes[0].faces).toEqual(['M', 'V', 'L'])
  })

  it('--- em dente: nenhum; em faces: lista vazia', () => {
    const { tratamentos } = mapear({ tratamentos: [tratamento(), tratamento({ ID: 'T2', Dente: '11' })] })
    expect(tratamentos[0].dentes).toEqual([])
    expect(tratamentos[1].dentes).toEqual([{ tooth_number: 11, faces: [] }])
  })

  it('dente ou face inválidos são erro', () => {
    expect(() => mapear({ tratamentos: [tratamento({ Dente: 'onze' })] })).toThrow(/tratamentos.*Dente.*linha 2/)
    expect(() => mapear({ tratamentos: [tratamento({ Dente: '11', Faces: 'Z' })] })).toThrow(/tratamentos.*Faces.*linha 2/)
    expect(() => mapear({ tratamentos: [tratamento({ Dente: '11', Faces: 'constructor' })] })).toThrow(/tratamentos.*Faces.*linha 2/)
  })

  it.each(['99', '19', '56', '10', '09', '011', '99999999999', '11, 99', '1a', '11;12'])('dente fora do FDI (%s) é erro sem o valor', (Dente) => {
    let msg = ''
    try { mapear({ tratamentos: [tratamento({ Dente })] }) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/tratamentos.*Dente.*linha 2.*dente inválido/)
    expect(msg).not.toContain(Dente)
  })

  it.each(['18', '28', '38', '48', '51', '55', '65', '75', '81', '85'])('dente %s é aceito', (Dente) => {
    const [t] = mapear({ tratamentos: [tratamento({ Dente })] }).tratamentos
    expect(t.dentes).toEqual([{ tooth_number: Number(Dente), faces: [] }])
  })

  it('dente repetido gera uma linha e mantém a ordem', () => {
    const [t] = mapear({ tratamentos: [tratamento({ Dente: '12, 11, 12, 11' })] }).tratamentos
    expect(t.dentes.map((d: { tooth_number: number }) => d.tooth_number)).toEqual([12, 11])
  })

  it('item do orçamento usa os dentes já validados e sem repetição', () => {
    const { orcamentos } = mapear({
      orcamentos: [orcamento()],
      tratamentos: [
        tratamento({ 'ID orçamento': 'O1', Dente: '12,11, 12' }),
        tratamento({ ID: 'T2', 'ID orçamento': 'O1', Dente: '---' }),
      ],
    })
    expect(orcamentos[0].itens.map((i: { tooth: string | null }) => i.tooth)).toEqual(['12, 11', null])
  })

  it('paciente ou orçamento inexistente é erro sem valores', () => {
    let msg = ''
    try { mapear({ tratamentos: [tratamento({ 'ID Paciente': 'SECRETO' })] }) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/tratamentos.*linha 2/)
    expect(msg).not.toContain('SECRETO')
    expect(() => mapear({ tratamentos: [tratamento({ 'ID orçamento': 'O9' })] })).toThrow(/tratamentos.*ID orçamento.*linha 2/)
  })
})

describe('orçamentos', () => {
  it('aprovado: total, itens aprovados e dente original', () => {
    const plano = mapear({
      convenios: [preco()], orcamentos: [orcamento()],
      tratamentos: [tratamento({ 'ID orçamento': 'O1', Dente: '11, 12' }), tratamento({ ID: 'T2', 'ID orçamento': 'O1', Procedimento: 'Outro' })],
    })
    const [o] = plano.orcamentos
    expect(o).toMatchObject({ sourceId: 'O1', pacienteSourceId: 'P1', status: 'approved', total: 300, approved_total: 300, imported_from: 'codental' })
    expect(o).not.toHaveProperty('sent_at')
    expect(o).not.toHaveProperty('decided_at')
    expect(o.itens).toEqual([
      { sourceId: 'T1', procedure: 'Restauração', tooth: '11, 12', quantity: 1, unit_price: 100, approved: true },
      { sourceId: 'T2', procedure: 'Outro', tooth: null, quantity: 1, unit_price: 0, approved: true },
    ])
    expect(plano.tratamentos[0].orcamentoSourceId).toBe('O1')
  })

  it('não aprovado: rascunho', () => {
    const [o] = mapear({ orcamentos: [orcamento({ Aprovado: 'Não' })], tratamentos: [tratamento({ 'ID orçamento': 'O1' })] }).orcamentos
    expect(o).toMatchObject({ status: 'draft', approved_total: null })
    expect(o.itens[0].approved).toBeNull()
  })

  it('notas juntam descrição, observações, desconto, entrada e parcelas', () => {
    const [o] = mapear({ orcamentos: [orcamento({
      Observações: 'Obs', Desconto: 'R$ 10,00', 'Valor da entrada': 'R$ 20,00', Parcelas: 3,
    })] }).orcamentos
    for (const t of ['Plano fictício', 'Obs', 'Desconto: R$ 10,00', 'Entrada: R$ 20,00', 'Parcelas: 3']) expect(o.notes).toContain(t)
  })

  it('desconto e entrada zerados não entram nas notas', () => {
    const [o] = mapear({ orcamentos: [orcamento({ Desconto: 'R$ 0,00', 'Valor da entrada': 'R$ 0,00', Parcelas: '-' })] }).orcamentos
    expect(o.notes).toBe('Plano fictício')
  })
})

describe('histórico', () => {
  it('pago, com datas sem conversão e amount de Valor total', () => {
    const [h] = mapear({ pagamentos: [pagamento({ 'Valor liquído': 'R$ 45,00', 'Data de pagamento': '10/03/2026 23:30' })] }).historico
    expect(h).toMatchObject({
      pacienteSourceId: 'P1', orcamentoSourceId: null, description: 'Parcela fictícia', amount: 50,
      due_date: '2026-03-10', paid_at: '2026-03-10', payment_method: 'pix',
      installment_number: 1, installment_count: 2, original_status: 'paid',
    })
  })

  it('sem data de pagamento: open; parcela - vira null', () => {
    const [h] = mapear({ pagamentos: [pagamento({ 'Data de pagamento': null, Parcela: '-', 'Total de parcelas': '-', 'Forma de pagamento': null })] }).historico
    expect(h).toMatchObject({ original_status: 'open', paid_at: null, installment_number: null, installment_count: null, payment_method: null })
  })

  it.each([['Crédito', 'cartao_credito'], ['Débito', 'cartao_debito'], ['Dinheiro', 'dinheiro'], ['Pix', 'pix']])('%s vira %s', (f, m) => {
    expect(mapear({ pagamentos: [pagamento({ 'Forma de pagamento': f })] }).historico[0].payment_method).toBe(m)
  })

  it('forma desconhecida é erro', () => {
    expect(() => mapear({ pagamentos: [pagamento({ 'Forma de pagamento': 'Cheque' })] })).toThrow(/pagamentos.*Forma de pagamento.*linha 2/)
  })

  it('sourceId conta as repetições', () => {
    const { historico } = mapear({ orcamentos: [orcamento()], pagamentos: [pagamento({ 'ID orçamento': 'O1' }), pagamento({ 'ID orçamento': 'O1' })] })
    expect(historico.map((h: { sourceId: string }) => h.sourceId)).toEqual([
      'P1|O1|10/03/2026|Parcela fictícia|1|0', 'P1|O1|10/03/2026|Parcela fictícia|1|1',
    ])
    expect(historico[0].orcamentoSourceId).toBe('O1')
  })

  it('orçamento inexistente é erro', () => {
    expect(() => mapear({ pagamentos: [pagamento({ 'ID orçamento': 'O9' })] })).toThrow(/pagamentos.*ID orçamento.*linha 2/)
  })
})

describe('evoluções e avisos', () => {
  const evolucao = (over: Linha = {}): Linha => ({
    ID: 'E1', 'ID Paciente': 'P1', Descrição: 'Evolução fictícia', Data: '05/01/2026', 'Data de criação': '05/01/2026 10:00', ...over,
  })

  it('mapeia evolução', () => {
    expect(mapear({ evolucoes: [evolucao()] }).evolucoes[0]).toEqual({
      sourceId: 'E1', pacienteSourceId: 'P1', date: '2026-01-05', description: 'Evolução fictícia', created_at: '2026-01-05T13:00:00.000Z',
    })
  })

  it('conta repetidas, grupos, telefones e pagamento antes do ano do vencimento', () => {
    const plano = mapear({
      pacientes: [
        paciente({ 'Data de nascimento': '01/01/1990', Celular: '11900000001' }),
        paciente({ ID: 'P2', 'Nome completo': ' fulano  fictício', 'Data de nascimento': '01/01/1990', Celular: '(11) 90000-0001' }),
        paciente({ ID: 'P3', 'Nome completo': 'Sem Nascimento Teste' }),
        paciente({ ID: 'P4', 'Nome completo': 'Sem Nascimento Teste' }),
      ],
      evolucoes: [evolucao(), evolucao({ ID: 'E2' }), evolucao({ ID: 'E3' }), evolucao({ ID: 'E4', Descrição: 'Outra' })],
      pagamentos: [pagamento({ 'Data de pagamento': '20/12/2025', 'Data de vencimento': '05/01/2026' }), pagamento()],
    })
    expect(plano.evolucoes).toHaveLength(4)
    expect(plano.avisos).toEqual({
      tratamentosSemValor: 0, consultasSemDesfecho: 0, evolucoesRepetidas: 2,
      gruposNomeNascimento: 1, telefonesCompartilhados: 1, pagamentoAntesDoVencimentoAno: 1,
    })
  })

  it('não altera o backup de entrada', () => {
    const backup = {
      pacientes: numerar([paciente()]), consultas: numerar([consulta()]), convenios: [], evolucoes: [],
      orcamentos: [], pagamentos: [], tratamentos: [], profissionais: [],
    }
    const antes = JSON.stringify(backup)
    mapearBackup(backup, opts)
    expect(JSON.stringify(backup)).toBe(antes)
  })
})
