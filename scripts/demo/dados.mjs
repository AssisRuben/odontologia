// Monta os dados da clínica de demonstração (npm run demo). Função pura:
// recebe a data de hoje e um gerador de IDs e devolve as linhas de cada tabela,
// na ordem em que devem ser inseridas, mais as ações feitas pelas funções do banco.

import { randomBytes } from 'node:crypto'

// ── Datas (fuso de São Paulo, sem horário de verão) ────────────────────────
const utc = (ymd) => new Date(`${ymd}T12:00:00Z`)
const ymdDe = (d) => d.toISOString().slice(0, 10)
export const addDias = (ymd, n) => { const d = utc(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdDe(d) }
const diaSemana = (ymd) => utc(ymd).getUTCDay() // 0 = domingo
const ts = (ymd, hm) => `${ymd}T${hm}:00-03:00`
const mesInicio = (ymd, delta = 0) => {
  const d = utc(ymd); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + delta); return ymdDe(d)
}
// Mesmo cálculo do app (src/lib/convenios/periodo.ts): fim = primeiro dia de fechamento >= data.
const periodoDe = (data, dia) => {
  const [y, m, d] = data.split('-').map(Number)
  const mesFim = d <= dia ? m - 1 : m
  const end = ymdDe(new Date(Date.UTC(y, mesFim, dia, 12)))
  const start = addDias(ymdDe(new Date(Date.UTC(y, mesFim - 1, dia, 12))), 1)
  return { start, end }
}

// Código do link do orçamento: mesmo formato do app (src/lib/orcamentos/links.ts, 43 caracteres)
export const novoToken = () => randomBytes(32).toString('base64url')

// ── CPF com dígitos verificadores ─────────────────────────────────────────
export function cpfValido(base9) {
  const d = base9.split('').map(Number)
  for (const n of [9, 10]) {
    const s = d.slice(0, n).reduce((acc, x, i) => acc + x * (n + 1 - i), 0)
    const r = (s * 10) % 11
    d.push(r === 10 ? 0 : r)
  }
  const t = d.join('')
  return `${t.slice(0, 3)}.${t.slice(3, 6)}.${t.slice(6, 9)}-${t.slice(9)}`
}

const reais = (c) => Math.round(c * 100) / 100

// Mesmo formato do snapshot gerado pelo app (src/lib/orcamentos/assinatura.ts).
export function snapshotAprovacao({ clinica, paciente, dentista, orcamentoId, criadoEm, validade, itens, assinante, assinadoEm }) {
  const txt = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`
  let total = 0
  const itens_aprovados = itens.map((i) => {
    const unit = Math.round(i.unit_price * 100)
    const sub = unit * i.quantity
    total += sub
    return { procedimento: i.procedure, dente: i.tooth ?? null, quantidade: i.quantity, preco_unitario: txt(unit), subtotal: txt(sub) }
  })
  return {
    clinica, paciente, dentista,
    orcamento: orcamentoId.slice(0, 8).toUpperCase(),
    data: criadoEm, validade, itens_aprovados, itens_nao_aprovados: [],
    total_aprovado: txt(total),
    assinante, assinado_em: assinadoEm,
  }
}

const TUSS_PADRAO = [
  { code: '81000065', name: 'Consulta odontológica inicial' },
  { code: '84000198', name: 'Profilaxia: polimento coronário' },
  { code: '85100196', name: 'Restauração de resina composta' },
  { code: '82000174', name: 'Exodontia simples de permanente' },
  { code: '85200042', name: 'Tratamento endodôntico unirradicular' },
]

const PACIENTES = [
  ['Maria Silva Santos', 'F', '1985-03-15', 'Alérgica a penicilina'],
  ['João Pedro Oliveira', 'M', '1990-07-22', null],
  ['Ana Carolina Souza', 'F', '1978-11-05', 'Hipertensa, controlada'],
  ['Carlos Eduardo Lima', 'M', null, null], // aniversário hoje (preenchido abaixo)
  ['Fernanda Costa Ribeiro', 'F', '1995-09-30', null],
  ['Roberto Almeida Nunes', 'M', '1968-04-12', 'Diabético'],
  ['Juliana Martins Rocha', 'F', '2001-12-18', null],
  ['Lucas Ferreira Gomes', 'M', '1987-06-08', null],
  ['Patrícia Mendes Araújo', 'F', '1972-02-27', null],
  ['Rafael Barbosa Pinto', 'M', '1999-10-03', null],
  ['Camila Rodrigues Dias', 'F', '1983-08-19', 'Gestante (6 meses)'],
  ['Thiago Cardoso Melo', 'M', '1993-05-25', null],
  ['Beatriz Teixeira Lopes', 'F', '2010-01-14', 'Responsável: mãe, Sandra Lopes'],
  ['Marcelo Azevedo Castro', 'M', '1960-09-09', null],
  ['Larissa Moreira Freitas', 'F', '1997-03-31', null],
]

export function montarDados(ctx) {
  const { hoje, clinicId, donoId, userId, uid, perguntas, templateId } = ctx
  // Usa a tabela TUSS do banco e completa com a lista padrão até ter 5 procedimentos
  const tuss = [...(ctx.tuss ?? [])]
  for (const t of TUSS_PADRAO) if (tuss.length < 5 && !tuss.some((x) => x.code === t.code)) tuss.push(t)
  const C = { clinic_id: clinicId }
  const insercoes = []
  const add = (tabela, linhas) => { insercoes.push([tabela, linhas]); return linhas }

  // ── Profissionais (o dono vem do cadastro e só é atualizado) ─────────────
  // Horários que o agente do WhatsApp pode oferecer (formato de professionals.working_hours)
  const semanaUtil = Object.fromEntries(['1', '2', '3', '4', '5'].map((d) => [d, [['08:00', '12:00'], ['14:00', '18:00']]]))
  const dono = { name: 'Dra. Ana Beatriz Costa', cro: 'CRO-SP 98765', specialty: 'Clínica geral', color: '#173B47',
    whatsapp_booking: true, working_hours: { ...semanaUtil, 6: [['08:00', '10:00']] } }
  const [carlos, juliana] = add('professionals', [
    { id: uid(), ...C, name: 'Dr. Carlos Mendes', cro: 'CRO-SP 54321', specialty: 'Ortodontia', color: '#E0607E',
      commission_rate: 40, commission_rate_insurance: 30, commission_start: mesInicio(hoje, -3),
      whatsapp_booking: true, working_hours: semanaUtil },
    { id: uid(), ...C, name: 'Dra. Juliana Rocha', cro: 'CRO-SP 67890', specialty: 'Endodontia', color: '#8B5CF6',
      commission_rate: 35, commission_rate_insurance: 25, commission_start: mesInicio(hoje, -3),
      whatsapp_booking: false, working_hours: null },
  ])
  const profs = [donoId, carlos.id, juliana.id]

  const clinica = {
    cnpj: '12.345.678/0001-90', phone: '(11) 3456-7890',
    address: 'Av. Paulista, 1000, sala 42, Bela Vista, São Paulo — SP',
    card_rates: { debito: 1.99, credito_vista: 3.49, credito_2a6: 4.99, credito_7a12: 6.99 },
    // Agente desligado (a demo não tem WhatsApp nem OpenAI), mas já configurado
    agent_config: {
      enabled: false,
      hours: { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'], 6: ['08:00', '12:00'] },
      info: 'Estacionamento conveniado no prédio (1ª hora grátis). Aceitamos Pix, cartão em até 10x e os convênios Odonto Saúde, Sorria Mais e Dental Vida. Avaliação inicial gratuita.',
      tipos: [
        { id: 'avaliacao', nome: 'Avaliação', duracao_min: 30, profissionais: null, ativo: true },
        { id: 'retorno', nome: 'Retorno', duracao_min: 30, profissionais: null, ativo: true },
        { id: 'limpeza', nome: 'Limpeza', duracao_min: 60, profissionais: null, ativo: true },
      ],
      agendamento: { antecedencia_h: 2, dias_a_frente: 30, intervalo_min: 30 },
    },
  }

  // ── Convênios e tabela ────────────────────────────────────────────────
  const planos = add('insurance_plans', [
    { id: uid(), ...C, name: 'Odonto Saúde', ans_registry: '412345', closing_day: 25, submission_days: 10, payment_days: 30 },
    { id: uid(), ...C, name: 'Sorria Mais', ans_registry: '398765', closing_day: 20, submission_days: 5, payment_days: 45 },
    { id: uid(), ...C, name: 'Dental Vida', ans_registry: '356789', closing_day: 28, submission_days: 10, payment_days: 30 },
  ])
  const valoresTabela = [60, 90, 140, 120, 380]
  const tabelaPlanos = add('insurance_plan_procedures', planos.flatMap((p, ip) =>
    tuss.slice(0, 5).map((t, i) => ({
      id: uid(), ...C, insurance_plan_id: p.id, code: t.code, name: t.name,
      value: reais(valoresTabela[i] * (1 - ip * 0.1)), requires_authorization: i >= 2,
    }))))
  const procPlano = (planoId, i) => tabelaPlanos.filter((r) => r.insurance_plan_id === planoId)[i]

  // ── Pacientes ────────────────────────────────────────────────────────
  const pacientes = add('patients', PACIENTES.map(([name, gender, birthdate, notes], i) => {
    const conv = i >= 4 && i <= 8 ? planos[i % 3] : null
    const fone = `119${String(87654321 - i * 1111).padStart(8, '0')}`
    return {
      id: uid(), ...C, name, gender, notes,
      birthdate: birthdate ?? `1988-${hoje.slice(5)}`,
      cpf: cpfValido(String(123456789 + i * 7654321).slice(0, 9)),
      phone: fone, whatsapp: fone,
      email: `${name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.demo@exemplo.com`,
      insurance_plan_id: conv?.id ?? null,
      insurance_card: conv ? `${8000 + i}${String(123456 + i * 11).padStart(8, '0')}` : null,
      insurance_card_valid_until: conv ? addDias(hoje, 300) : null,
    }
  }))
  const P = pacientes

  // ── Agenda: semana passada, esta e a próxima (segunda a sábado) ─────────
  const segunda = addDias(hoje, -((diaSemana(hoje) + 6) % 7))
  const HORARIOS = [['08:00', '09:00'], ['09:00', '10:00'], ['10:30', '11:30'], ['14:00', '15:00'], ['15:30', '16:30']]
  const PROCS = ['Limpeza e profilaxia', 'Restauração', 'Avaliação', 'Canal — sessão', 'Manutenção ortodôntica', 'Extração']
  const STATUS_HOJE = ['completed', 'in_progress', 'waiting', 'confirmed', 'scheduled']
  const consultas = []
  let n = 0
  for (let dia = addDias(segunda, -7); dia <= addDias(segunda, 12); dia = addDias(dia, 1)) {
    const dow = diaSemana(dia)
    // Hoje sempre tem os 5 horários (sala de espera, em atendimento...), mesmo no sábado ou domingo
    if (dow === 0 && dia !== hoje) continue
    const slots = dow === 6 && dia !== hoje ? HORARIOS.slice(0, 2) : HORARIOS
    slots.forEach(([ini, fim], s) => {
      let status
      if (dia < hoje) status = n % 11 === 4 ? 'no_show' : n % 13 === 6 ? 'cancelled' : 'completed'
      else if (dia === hoje) status = STATUS_HOJE[s]
      else status = s % 2 === 0 ? 'confirmed' : 'scheduled'
      consultas.push({
        id: uid(), ...C, patient_id: P[n % P.length].id, professional_id: profs[s % 3],
        start_time: ts(dia, ini), end_time: ts(dia, fim), status, procedure: PROCS[n % PROCS.length],
        notes: null, source: null,
      })
      n++
    })
  }
  // Garante os dois status raros mesmo se a semana passada for curta
  const passadas = consultas.filter((c) => c.start_time.slice(0, 10) < hoje)
  if (!consultas.some((c) => c.status === 'no_show')) passadas[0].status = 'no_show'
  if (!consultas.some((c) => c.status === 'cancelled')) passadas[1].status = 'cancelled'
  // Uma consulta futura marcada pelo agente no WhatsApp
  const futuras = consultas.filter((c) => c.start_time.slice(0, 10) > hoje)
  futuras[2].source = 'whatsapp'
  futuras[2].notes = 'Marcada pelo WhatsApp'
  add('appointments', consultas)

  // ── Anamnese, tratamentos (odontograma) e evoluções ─────────────────────
  if (templateId && perguntas?.length) {
    add('anamneses', [0, 1, 2, 5].map((i) => ({
      id: uid(), ...C, patient_id: P[i].id, template_id: templateId,
      // Maria (0) tem alergia a penicilina; Roberto (5) está em tratamento médico (diabetes)
      answers: Object.fromEntries(perguntas.map((q) => {
        const t = q.text ?? ''
        if (q.type !== 'yesno') return [q.id, '']
        const sim = (i === 0 && /alergia/i.test(t)) || (i === 5 && /(diabet|tratamento médico)/i.test(t))
        return [q.id, sim ? 'Sim' : 'Não']
      })),
      notes: i === 0 ? 'Alérgica a penicilina.' : i === 5 ? 'Diabético, em uso de metformina.' : null,
    })))
  }

  const tr = (pi, prof, procedure, value, status, dias, extra = {}) => ({
    id: uid(), ...C, patient_id: P[pi].id, professional_id: prof, procedure, value, status,
    date: addDias(hoje, dias), notes: null, insurance_plan_id: null, insurance_procedure_id: null, ...extra,
  })
  const conv = (pi, i) => {
    const plano = P[pi].insurance_plan_id
    const proc = procPlano(plano, i)
    return { insurance_plan_id: plano, insurance_procedure_id: proc.id }
  }
  const tratamentos = add('treatments', [
    tr(0, donoId, 'Restauração de resina', 280, 'completed', -20),
    tr(0, donoId, 'Coroa de porcelana', 1800, 'in_progress', -6),
    tr(0, juliana.id, 'Tratamento de canal', 950, 'planned', 0),
    tr(1, donoId, 'Limpeza e profilaxia', 180, 'completed', -8),
    tr(1, carlos.id, 'Aparelho ortodôntico fixo', 3200, 'in_progress', -40),
    tr(2, donoId, 'Clareamento', 900, 'planned', 0),
    tr(4, donoId, procPlano(P[4].insurance_plan_id, 2).name, procPlano(P[4].insurance_plan_id, 2).value, 'planned', 0, conv(4, 2)),
    tr(5, donoId, procPlano(P[5].insurance_plan_id, 2).name, procPlano(P[5].insurance_plan_id, 2).value, 'completed', -35, conv(5, 2)),
    tr(5, donoId, procPlano(P[5].insurance_plan_id, 1).name, procPlano(P[5].insurance_plan_id, 1).value, 'completed', -35, conv(5, 1)),
    tr(6, juliana.id, procPlano(P[6].insurance_plan_id, 4).name, procPlano(P[6].insurance_plan_id, 4).value, 'completed', -3, conv(6, 4)),
    // Concluídos e pagos no mês passado: dão comissão ao Dr. Carlos e à Dra. Juliana
    tr(1, carlos.id, 'Instalação do aparelho ortodôntico', 1200, 'completed', -30),
    tr(9, juliana.id, 'Tratamento de canal', 950, 'completed', -27),
  ])
  add('treatment_teeth', [
    [0, 36, ['O', 'D']], [1, 26, []], [2, 46, []], [4, 11, []], [6, 15, ['O']], [7, 24, ['M', 'O']], [9, 21, []],
  ].map(([t, tooth_number, faces]) => ({ id: uid(), treatment_id: tratamentos[t].id, tooth_number, faces })))
  // Concluídos ficam com "baixa de material" pendente; só o primeiro continua pendente
  const pularMaterial = tratamentos.filter((t) => t.status === 'completed').slice(1).map((t) => t.id)

  const concluidas = consultas.filter((c) => c.status === 'completed' && c.start_time.slice(0, 10) <= hoje)
  const TEXTOS_EVOLUCAO = [
    'Profilaxia e remoção de tártaro supragengival. Orientação de higiene. Retorno em 6 meses.',
    'Restauração em resina composta no dente 36 (O, D). Paciente sem queixas. Ajuste oclusal realizado.',
    'Preparo do dente 26 para coroa. Moldagem enviada ao laboratório. Provisório cimentado.',
  ]
  add('evolutions', [P[0].id, P[1].id].flatMap((pid, k) =>
    concluidas.filter((c) => c.patient_id === pid).slice(0, 2).map((c, j) => ({
      id: uid(), ...C, patient_id: pid, appointment_id: c.id, professional_id: c.professional_id,
      date: c.start_time.slice(0, 10), description: TEXTOS_EVOLUCAO[(k + j) % 3], images: null,
    }))))

  // ── Orçamentos (criados como rascunho; o status vem das funções do banco) ─
  const orc = (pi, prof, itens, acao, extra = {}) => {
    const id = uid()
    const linhas = itens.map(([procedure, tooth, quantity, unit_price]) => ({ id: uid(), budget_id: id, procedure, tooth, quantity, unit_price }))
    const total = reais(linhas.reduce((s, l) => s + l.quantity * l.unit_price, 0))
    return { budget: { id, ...C, patient_id: P[pi].id, professional_id: prof, status: 'draft', total, notes: null }, linhas, acao, extra, paciente: P[pi] }
  }
  const ORC = [
    orc(0, donoId, [['Coroa de porcelana', '26', 1, 1800], ['Tratamento de canal', '46', 1, 950], ['Restauração de resina', '36', 1, 280]], 'aprovar'),
    orc(1, carlos.id, [['Aparelho ortodôntico fixo', null, 1, 3200], ['Manutenção mensal', null, 12, 180]], 'enviar'),
    orc(2, donoId, [['Clareamento em consultório', null, 1, 900], ['Limpeza e profilaxia', null, 1, 180]], 'ver'),
    orc(9, juliana.id, [['Tratamento de canal', '16', 1, 1100], ['Pino de fibra', '16', 1, 350], ['Coroa de porcelana', '16', 1, 1800]], 'perder', { motivo: 'preco', nota: 'Achou caro; vai pensar no parcelamento.' }),
    orc(11, donoId, [['Implante unitário', '36', 1, 3500], ['Coroa sobre implante', '36', 1, 1900]], 'rascunho'),
    orc(13, donoId, [['Prótese total superior', null, 1, 2400]], 'aprovar'),
  ]
  add('budgets', ORC.map((o) => o.budget))
  add('budget_items', ORC.flatMap((o) => o.linhas))
  const orcamentos = ORC.map((o) => ({
    id: o.budget.id, acao: o.acao, ...o.extra,
    itens: o.linhas, total: o.budget.total,
    assinante: { nome: o.paciente.name, cpf: o.paciente.cpf.replace(/\D/g, '') },
    paciente: o.paciente.name, dentista: o.budget.professional_id,
  }))

  // ── Pagamentos ───────────────────────────────────────────────────────
  const metodo = ['pix', 'cartao_credito', 'dinheiro', 'cartao_debito']
  const SEM_PARCELA = { budget_id: null, charge_group_id: null, installment_number: null, installment_count: null, appointment_id: null }
  const pagamentos = []
  concluidas.forEach((c, i) => {
    const pac = P.find((p) => p.id === c.patient_id)
    if (pac.insurance_plan_id) return
    const dia = c.start_time.slice(0, 10)
    pagamentos.push({
      id: uid(), ...C, ...SEM_PARCELA, patient_id: c.patient_id, appointment_id: c.id, amount: [180, 250, 320, 150][i % 4],
      payment_method: metodo[i % 4], status: 'paid', due_date: dia, paid_at: ts(dia, '18:00'), description: c.procedure,
    })
  })
  const parcelas = [-25, 5, 35].map((d, k) => ({
    id: uid(), ...C, ...SEM_PARCELA, patient_id: P[0].id, amount: reais(ORC[0].budget.total / 3), payment_method: 'boleto',
    status: d < 0 ? 'paid' : 'pending', due_date: addDias(hoje, d), paid_at: d < 0 ? ts(addDias(hoje, d), '10:00') : null,
    description: `Orçamento — parcela ${k + 1}/3`, budget_id: ORC[0].budget.id,
    charge_group_id: null, installment_number: k + 1, installment_count: 3,
  }))
  const grupo = uid()
  parcelas.forEach((p) => { p.charge_group_id = grupo })
  pagamentos.push(...parcelas)
  pagamentos.push(
    { id: uid(), ...C, ...SEM_PARCELA, patient_id: P[1].id, amount: 1200, payment_method: 'cartao_credito', status: 'paid', due_date: addDias(hoje, -29), paid_at: ts(addDias(hoje, -29), '11:00'), description: 'Instalação do aparelho' },
    { id: uid(), ...C, ...SEM_PARCELA, patient_id: P[9].id, amount: 950, payment_method: 'pix', status: 'paid', due_date: addDias(hoje, -26), paid_at: ts(addDias(hoje, -26), '15:00'), description: 'Tratamento de canal' },
    { id: uid(), ...C, ...SEM_PARCELA, patient_id: P[7].id, amount: 450, payment_method: 'pix', status: 'pending', due_date: addDias(hoje, -12), paid_at: null, description: 'Restauração (2 dentes)' },
    { id: uid(), ...C, ...SEM_PARCELA, patient_id: P[10].id, amount: 300, payment_method: 'boleto', status: 'pending', due_date: addDias(hoje, -4), paid_at: null, description: 'Avaliação e limpeza' },
    { id: uid(), ...C, ...SEM_PARCELA, patient_id: P[12].id, amount: 600, payment_method: 'cartao_credito', status: 'pending', due_date: addDias(hoje, 10), paid_at: null, description: 'Manutenção ortodôntica' },
  )
  add('payments', pagamentos)
  add('health_receipts', pagamentos.filter((p) => p.status === 'paid').slice(0, 2).map((p) => ({ payment_id: p.id, ...C, issued_by: userId })))

  // ── Despesas, laboratórios e próteses ───────────────────────────────────
  const desp = (description, amount, category, dias, status, extra = {}) => ({
    id: uid(), ...C, description, amount, category, deduction_group: category === 'salarios' ? 'pessoal' : 'custeio',
    payment_method: 'pix', due_date: addDias(hoje, dias), status,
    paid_at: status === 'paid' ? ts(addDias(hoje, dias), '12:00') : null, professional_id: null, ...extra,
  })
  const labs = add('laboratories', [
    { id: uid(), ...C, name: 'Lab Dental Premium', phone: '(11) 3333-4444', notes: 'Entrega em 7 dias úteis' },
    { id: uid(), ...C, name: 'Prótese Arte', phone: '(11) 2222-5555', notes: null },
  ])
  const despLabRetornada = desp(`Prótese: Coroa — ${P[0].name} — ${labs[0].name}`, 350, 'laboratorio', 0, 'pending', { professional_id: donoId })
  const despLabInstalada = desp(`Prótese: PPR — ${P[13].name} — ${labs[1].name}`, 600, 'laboratorio', -18, 'paid', { professional_id: donoId })
  add('expenses', [
    desp('Material de consumo (dental)', 1240.5, 'material', -15, 'paid'),
    desp('Conta de luz', 389.9, 'contas', -9, 'paid'),
    desp('Salário da recepcionista', 2300, 'salarios', -6, 'paid'),
    desp('Anuidade CRO', 690, 'conselho', -40, 'paid'),
    desp('Manutenção da autoclave', 450, 'manutencao', -2, 'pending'),
    desp('Marketing — redes sociais', 800, 'marketing', 12, 'pending'),
    desp('Contador', 550, 'servicos', 20, 'pending'),
    despLabRetornada, despLabInstalada,
  ])
  const prot = (pi, prof, lab, type, tooth_region, lab_cost, status, diasPedido, diasPrev, expense) => ({
    id: uid(), ...C, patient_id: P[pi].id, professional_id: prof, laboratory: lab.name, laboratory_id: lab.id,
    type, tooth_region, lab_cost, status, requested_at: ts(addDias(hoje, diasPedido), '10:00'),
    expected_at: addDias(hoje, diasPrev), notes: null,
    expense_id: expense?.id ?? null, expense_generated: !!expense,
  })
  const proteses = add('prosthetics', [
    prot(2, donoId, labs[0], 'Faceta', '11, 21', 500, 'requested', -1, 12),
    prot(5, juliana.id, labs[1], 'Coroa', '46', 400, 'sent_to_lab', -14, -2), // atrasada
    prot(0, donoId, labs[0], 'Coroa', '26', 350, 'returned', -12, 1, despLabRetornada),
    prot(13, donoId, labs[1], 'PPR', 'Superior', 600, 'installed', -30, -15, despLabInstalada),
  ])
  const ETAPAS = ['requested', 'sent_to_lab', 'returned', 'installed']
  add('prosthetic_events', proteses.flatMap((p) => {
    const ate = ETAPAS.indexOf(p.status)
    return ETAPAS.slice(0, ate + 1).map((to, k) => ({
      id: uid(), ...C, prosthetic_id: p.id, from_status: k === 0 ? null : ETAPAS[k - 1], to_status: to,
      note: null, created_by: userId, created_at: ts(addDias(p.requested_at.slice(0, 10), k * 4), '11:00'),
    }))
  }))

  // ── Estoque ──────────────────────────────────────────────────────────
  const item = (name, category, unit, min_quantity, ideal_quantity, tracks_expiry, quantity, supplier) =>
    ({ id: uid(), ...C, name, category, unit, min_quantity, ideal_quantity, tracks_expiry, quantity, supplier })
  const itens = [
    item('Luvas de procedimento (M)', 'Descartáveis', 'caixa', 5, 15, false, 12, 'Dental Cremer'),
    item('Máscara descartável', 'Descartáveis', 'caixa', 4, 10, false, 2, 'Dental Cremer'), // abaixo do mínimo
    item('Sugador descartável', 'Descartáveis', 'pacote', 3, 8, false, 6, null),
    item('Resina composta A2', 'Restauradores', 'seringa', 3, 8, true, 0, 'Dental Speed'),
    item('Ácido fosfórico 37%', 'Restauradores', 'seringa', 2, 5, true, 0, 'Dental Speed'),
    item('Anestésico lidocaína 2%', 'Anestésicos', 'tubete', 50, 150, true, 0, 'Dental Cremer'),
    item('Fio de sutura 4-0', 'Cirurgia', 'unidade', 10, 30, true, 0, null),
  ]
  const lotes = [
    [3, 'R2A-0921', 200, 5], [4, 'AF-3310', 120, 4], [5, 'LD-7781', 260, 90], [5, 'LD-6610', -10, 20], // vencido
    [6, 'FS-4402', 400, 18],
  ].map(([i, lot_code, dias, quantity]) => ({ id: uid(), ...C, item_id: itens[i].id, lot_code, expires_at: addDias(hoje, dias), quantity }))
  for (const it of itens) if (it.tracks_expiry) it.quantity = lotes.filter((l) => l.item_id === it.id).reduce((s, l) => s + l.quantity, 0)
  add('inventory_items', itens)
  add('inventory_lots', lotes)
  add('inventory_movements', [
    ...itens.filter((i) => !i.tracks_expiry).map((i) => ({
      id: uid(), ...C, item_id: i.id, type: 'in', kind: 'compra', quantity: i.quantity + 3, lot_id: null,
      reason: 'Compra', created_by: userId, created_at: ts(addDias(hoje, -20), '09:00'),
    })),
    ...lotes.map((l) => ({
      id: uid(), ...C, item_id: l.item_id, type: 'in', kind: 'compra', quantity: l.quantity, lot_id: l.id,
      reason: 'Compra', created_by: userId, created_at: ts(addDias(hoje, -20), '09:30'),
    })),
    ...itens.filter((i) => !i.tracks_expiry).map((i) => ({
      id: uid(), ...C, item_id: i.id, type: 'out', kind: 'uso', quantity: 3, lot_id: null,
      reason: 'Uso', created_by: userId, created_at: ts(addDias(hoje, -5), '16:00'),
    })),
  ])
  const kits = add('inventory_kits', [
    { id: uid(), ...C, name: 'Kit restauração' },
    { id: uid(), ...C, name: 'Kit extração' },
  ])
  add('inventory_kit_items', [
    [0, 3, 1], [0, 4, 1], [0, 0, 1], [1, 5, 2], [1, 6, 1], [1, 0, 1],
  ].map(([k, i, quantity]) => ({ id: uid(), ...C, kit_id: kits[k].id, item_id: itens[i].id, quantity })))

  // ── Convênios: guias e lote ─────────────────────────────────────────────
  const guia = (pi, profId, status, extra) => ({
    id: uid(), ...C, patient_id: P[pi].id, insurance_plan_id: P[pi].insurance_plan_id, professional_id: profId,
    status, insurance_card: P[pi].insurance_card, requested_at: addDias(hoje, -2),
    guide_number: null, password: null, password_valid_until: null, responded_at: null, ...extra,
  })
  const guias = add('insurance_guides', [
    guia(4, donoId, 'aguardando', { requested_at: addDias(hoje, -9) }), // vira pendência (mais de 7 dias)
    guia(5, donoId, 'liberada', { guide_number: '20260001', password: 'A7K2P9', password_valid_until: addDias(hoje, 30), requested_at: addDias(hoje, -40), responded_at: ts(addDias(hoje, -39), '15:00') }),
    guia(6, juliana.id, 'liberada', { guide_number: '20260002', password: 'B3M8Q1', password_valid_until: addDias(hoje, 3), requested_at: addDias(hoje, -6), responded_at: ts(addDias(hoje, -5), '10:00') }),
  ])
  const itemGuia = (g, t, authorization, executed_at) => {
    const tt = tratamentos[t]
    const proc = tabelaPlanos.find((r) => r.id === tt.insurance_procedure_id)
    return {
      id: uid(), ...C, guide_id: guias[g].id, treatment_id: tt.id, code: proc.code, name: proc.name,
      teeth: [], value: proc.value, requires_authorization: proc.requires_authorization, authorization, executed_at,
    }
  }
  const itensGuia = add('insurance_guide_items', [
    itemGuia(0, 6, 'pendente', null),
    itemGuia(1, 7, 'autorizado', addDias(hoje, -35)),
    itemGuia(1, 8, 'nao_exige', addDias(hoje, -35)),
    itemGuia(2, 9, 'autorizado', addDias(hoje, -3)),
  ])
  const planoLote = P[5].insurance_plan_id
  const plano = planos.find((p) => p.id === planoLote)
  const periodo = periodoDe(itensGuia[1].executed_at, plano.closing_day)
  const periodoFim = periodo.end
  const loteBatch = { id: uid(), ...C, insurance_plan_id: planoLote, period_start: periodo.start, period_end: periodoFim, due_date: addDias(periodoFim, plano.submission_days), status: 'aberto' }
  add('insurance_batches', [loteBatch])
  const noLote = [itensGuia[1], itensGuia[2]]
  const lote = {
    id: loteBatch.id,
    itemIds: noLote.map((i) => i.id),
    protocolo: 'PROT-2026-0457',
    enviadoEm: addDias(periodoFim, 3),
    pagoEm: addDias(hoje, -1),
    itens: [
      { id: noLote[0].id, paid_value: reais(noLote[0].value * 0.8), glosa_code: ctx.glosa ?? undefined, glosa_note: 'Faltou radiografia final' },
      { id: noLote[1].id, paid_value: noLote[1].value },
    ].map((i) => (i.glosa_code ? i : { id: i.id, paid_value: i.paid_value })),
  }
  if (!ctx.glosa) lote.itens[0] = { id: noLote[0].id, paid_value: noLote[0].value }
  lote.deposito = reais(lote.itens.reduce((s, i) => s + i.paid_value, 0))

  // ── WhatsApp: conversas e mensagens ─────────────────────────────────────
  const fone = (p) => `55${p.whatsapp}`
  const conversas = add('conversations', [
    { id: uid(), ...C, phone: fone(P[7]), patient_id: P[7].id, contact_name: P[7].name, handler: 'human', handoff_reason: 'Paciente pediu para falar com a recepção', unread: true, last_message_at: ts(hoje, '09:42') },
    { id: uid(), ...C, phone: '5511912340000', patient_id: null, contact_name: 'Renata (novo contato)', handler: 'agent', handoff_reason: null, unread: false, last_message_at: ts(hoje, '08:15') },
    { id: uid(), ...C, phone: fone(P[3]), patient_id: P[3].id, contact_name: P[3].name, handler: 'agent', handoff_reason: null, unread: false, last_message_at: ts(addDias(hoje, -1), '17:05') },
  ])
  const msg = (conversa, direction, type, body, quando, extra = {}) => ({
    id: uid(), ...C, conversation_id: conversa?.id ?? null, patient_id: conversa?.patient_id ?? null,
    direction, type, body, phone: conversa?.phone, status: direction === 'in' ? 'received' : 'sent',
    scheduled_for: quando, sent_at: direction === 'out' ? quando : null, created_at: quando,
    appointment_id: null, reply_action: null, ...extra,
  })
  const amanha = consultas.filter((c) => c.start_time.slice(0, 10) === addDias(hoje, 1) && c.status === 'scheduled')
  const confirmada = futuras.find((c) => c.status === 'confirmed')
  // De preferência nesta semana, para o aviso aparecer na agenda aberta hoje
  const candidatas = consultas.filter((c) => c.start_time.slice(0, 10) > hoje && c.status === 'scheduled' && !amanha.includes(c))
  const desmarcada = candidatas.find((c) => c.start_time.slice(0, 10) <= addDias(segunda, 5)) ?? candidatas[0]
  if (desmarcada) desmarcada.status = 'cancelled'
  const mensagens = [
    msg(conversas[0], 'in', 'incoming', 'Bom dia! Queria saber o valor do clareamento.', ts(hoje, '09:30')),
    msg(conversas[0], 'out', 'auto_reply', 'Olá! O valor depende da avaliação. Quer que eu marque uma avaliação?', ts(hoje, '09:31')),
    msg(conversas[0], 'in', 'incoming', 'Prefiro falar com uma pessoa, por favor.', ts(hoje, '09:42')),
    msg(conversas[1], 'in', 'incoming', 'Oi, vocês atendem sábado?', ts(hoje, '08:14')),
    msg(conversas[1], 'out', 'auto_reply', 'Olá, Renata! Atendemos de segunda a sábado. No sábado, das 8h às 10h.', ts(hoje, '08:15')),
    msg(conversas[2], 'out', 'birthday', `Feliz aniversário, ${P[3].name.split(' ')[0]}! 🎉 Toda a equipe da clínica deseja um ótimo dia.`, ts(addDias(hoje, -1), '17:05')),
    ...amanha.map((c) => {
      const p = P.find((x) => x.id === c.patient_id)
      return msg(null, 'out', 'confirmation', `Olá, ${p.name.split(' ')[0]}! Confirma sua consulta amanhã? Responda SIM ou NÃO.`, ts(hoje, '10:00'), { patient_id: p.id, appointment_id: c.id, phone: fone(p) })
    }),
  ]
  if (confirmada) {
    const p = P.find((x) => x.id === confirmada.patient_id)
    mensagens.push(
      msg(null, 'out', 'confirmation', `Olá, ${p.name.split(' ')[0]}! Confirma sua consulta? Responda SIM ou NÃO.`, ts(addDias(hoje, -1), '10:00'), { patient_id: p.id, appointment_id: confirmada.id, phone: fone(p) }),
      msg(null, 'in', 'incoming', 'SIM', ts(addDias(hoje, -1), '10:12'), { patient_id: p.id, appointment_id: confirmada.id, phone: fone(p), reply_action: 'confirmed' }),
    )
  }
  if (desmarcada) {
    const p = P.find((x) => x.id === desmarcada.patient_id)
    mensagens.push(msg(null, 'in', 'incoming', 'NÃO, não vou conseguir ir.', ts(hoje, '07:50'), { patient_id: p.id, appointment_id: desmarcada.id, phone: fone(p), reply_action: 'cancelled' }))
  }
  add('messages', mensagens)

  // ── Fluxo de caixa ───────────────────────────────────────────────────
  add('cash_balances', [{ id: uid(), ...C, balance_date: addDias(hoje, -1), amount: 45450.3, created_by: userId }])
  const recorrencias = [
    { description: 'Aluguel da sala', amount: 3500, category: 'aluguel', deduction_group: 'custeio', payment_method: 'boleto', day_of_month: 5, start_month: mesInicio(hoje, -1), end_month: null },
    { description: 'Internet e telefone', amount: 149.9, category: 'contas', deduction_group: 'custeio', payment_method: 'pix', day_of_month: 10, start_month: mesInicio(hoje, -1), end_month: null },
  ]

  return { insercoes, clinica, dono, orcamentos, recorrencias, lote, pularMaterial }
}
