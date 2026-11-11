// Ordem e títulos dos capítulos do manual (página /ajuda e PDF).
// Cada slug tem um arquivo <slug>.md nesta pasta.

export type Parte = 'Começando' | 'Configuração inicial' | 'Dia a dia' | 'Gestão'

export type Capitulo = { parte: Parte; slug: string; titulo: string }

export const PARTES: Parte[] = ['Começando', 'Configuração inicial', 'Dia a dia', 'Gestão']

export const INDICE: Capitulo[] = [
  { parte: 'Começando', slug: 'acesso', titulo: 'Acesso ao sistema' },
  { parte: 'Começando', slug: 'checklist', titulo: 'Checklist de implantação' },

  { parte: 'Configuração inicial', slug: 'clinica', titulo: 'Dados da clínica' },
  { parte: 'Configuração inicial', slug: 'profissionais', titulo: 'Profissionais' },
  { parte: 'Configuração inicial', slug: 'config-convenios', titulo: 'Convênios e tabela' },
  { parte: 'Configuração inicial', slug: 'taxas', titulo: 'Taxas de cartão' },
  { parte: 'Configuração inicial', slug: 'pagamentos', titulo: 'Cobrança e nota fiscal' },
  { parte: 'Configuração inicial', slug: 'config-mensagens', titulo: 'Mensagens automáticas (WhatsApp)' },
  { parte: 'Configuração inicial', slug: 'ia', titulo: 'Inteligência artificial' },
  { parte: 'Configuração inicial', slug: 'agente', titulo: 'Agente de IA no WhatsApp' },
  { parte: 'Configuração inicial', slug: 'anamnese', titulo: 'Modelos de anamnese' },
  { parte: 'Configuração inicial', slug: 'laboratorios', titulo: 'Laboratórios de prótese' },

  { parte: 'Dia a dia', slug: 'agenda', titulo: 'Agenda' },
  { parte: 'Dia a dia', slug: 'pacientes', titulo: 'Pacientes' },
  { parte: 'Dia a dia', slug: 'orcamentos', titulo: 'Orçamentos' },
  { parte: 'Dia a dia', slug: 'mensagens', titulo: 'Mensagens' },
  { parte: 'Dia a dia', slug: 'convenios', titulo: 'Convênios: guias e lotes' },
  { parte: 'Dia a dia', slug: 'protese', titulo: 'Prótese' },
  { parte: 'Dia a dia', slug: 'estoque', titulo: 'Estoque' },

  { parte: 'Gestão', slug: 'financeiro', titulo: 'Financeiro' },
  { parte: 'Gestão', slug: 'relatorios', titulo: 'Relatórios e indicadores' },
]
