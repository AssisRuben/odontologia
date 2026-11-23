// Relatório agregado da simulação: só contagens e totais, nunca dados de pacientes.

const contarPor = (linhas, campo) => {
  const r = {}
  for (const l of linhas) r[l[campo]] = (r[l[campo]] ?? 0) + 1
  return r
}

const centavos = (v) => Math.round(v * 100)

function somar(linhas, campo) {
  return { quantidade: linhas.length, centavos: linhas.reduce((s, l) => s + centavos(l[campo]), 0) }
}

/** Quantas linhas apontam para um orçamento cujo paciente é outro. */
function outroPaciente(linhas, donos) {
  return linhas.filter((l) => {
    if (l.orcamentoSourceId == null) return false
    const dono = donos.get(l.orcamentoSourceId)
    return dono !== undefined && dono !== l.pacienteSourceId
  }).length
}

export function montarRelatorio(plano) {
  const donos = new Map(plano.orcamentos.map((o) => [o.sourceId, o.pacienteSourceId]))
  const importadas = (linhas) => linhas.filter((l) => l.imported_from === 'codental').length
  const pagos = plano.historico.filter((h) => h.original_status === 'paid')
  const abertos = plano.historico.filter((h) => h.original_status !== 'paid')

  return {
    contagens: {
      pacientes: plano.pacientes.length,
      convenios: plano.convenios.length,
      procedimentos: plano.procedimentos.length,
      consultas: plano.consultas.length,
      evolucoes: plano.evolucoes.length,
      tratamentos: plano.tratamentos.length,
      itensOrcamento: plano.orcamentos.reduce((s, o) => s + o.itens.length, 0),
      orcamentos: plano.orcamentos.length,
      historico: plano.historico.length,
    },
    consultas: {
      porStatus: contarPor(plano.consultas, 'status'),
      importadas: importadas(plano.consultas),
      vivas: plano.consultas.length - importadas(plano.consultas),
    },
    tratamentos: {
      porStatus: contarPor(plano.tratamentos, 'status'),
      importados: importadas(plano.tratamentos),
      vivos: plano.tratamentos.length - importadas(plano.tratamentos),
    },
    orcamentos: {
      porStatus: contarPor(plano.orcamentos, 'status'),
      totalCentavos: somar(plano.orcamentos, 'total').centavos,
    },
    historico: { pago: somar(pagos, 'amount'), emAberto: somar(abertos, 'amount') },
    avisos: { ...plano.avisos },
    tratamentosOrcamentoOutroPaciente: outroPaciente(plano.tratamentos, donos),
    historicoOrcamentoOutroPaciente: outroPaciente(plano.historico, donos),
  }
}

const reais = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`

/** Resumo legível, também só com contagens e totais. */
export function resumoTexto(r) {
  const c = r.contagens
  const linhas = [
    'Simulação da importação (nada foi gravado)',
    `Pacientes: ${c.pacientes} | Convênios: ${c.convenios} | Procedimentos: ${c.procedimentos}`,
    `Consultas: ${c.consultas} (importadas ${r.consultas.importadas}, vivas ${r.consultas.vivas})`,
    `Evoluções: ${c.evolucoes}`,
    `Tratamentos: ${c.tratamentos} (importados ${r.tratamentos.importados}, vivos ${r.tratamentos.vivos})`,
    `Orçamentos: ${c.orcamentos} com ${c.itensOrcamento} itens, total ${reais(r.orcamentos.totalCentavos)}`,
    `Histórico: ${c.historico} | pago ${r.historico.pago.quantidade} (${reais(r.historico.pago.centavos)}) | em aberto ${r.historico.emAberto.quantidade} (${reais(r.historico.emAberto.centavos)})`,
    `Tratamentos em orçamento de outro paciente: ${r.tratamentosOrcamentoOutroPaciente}`,
    `Histórico em orçamento de outro paciente: ${r.historicoOrcamentoOutroPaciente}`,
    'Avisos:',
    ...Object.entries(r.avisos).map(([k, v]) => `  ${k}: ${v}`),
  ]
  return linhas.join('\n')
}
