// Lista de capturas do manual (npm run manual).
// Cada entrada vira public/ajuda/img/<arquivo>.png e deve ser citada em algum capítulo.
//
//   arquivo   nome do PNG, sem extensão: <slug-do-capítulo>-<tarefa>
//   url       tela a abrir (texto, ou função que devolve o texto)
//   passos    (opcional) ações antes da foto: clicar numa aba, abrir um formulário...
//             NUNCA clicar em Salvar, Excluir ou Enviar.
//   falsos    (opcional) seletor → valor de exemplo, só para a foto (nada é salvo)
//   fullPage  (opcional) fotografa a página inteira, não só a parte visível
//   semLogin  (opcional) fotografa sem estar logado (ex.: tela de login)
//   viewport  (opcional) tamanho de tela de celular, ex.: { width: 390, height: 844 }

// Os dados vêm do `npm run demo` (datas em volta de hoje).
// Paciente usado nas capturas da ficha.
export const PACIENTE_DEMO = 'Maria Silva Santos'

// Abre uma consulta futura (as passadas mostram botões que não fazem sentido no exemplo)
const abrirPrimeiraConsulta = async (page) => {
  await page.locator('.fc-event.fc-event-future').first().click()
  await page.getByRole('button', { name: 'Editar' }).waitFor()
}

// Abre a ficha do paciente de exemplo e, se pedido, uma aba dela
const abrirFicha = (aba, esperar, paciente = PACIENTE_DEMO) => async (page) => {
  await page.getByPlaceholder('Buscar por nome, telefone ou CPF...').fill(paciente)
  await page.getByText(paciente).first().click()
  await page.getByText('Odontograma').first().waitFor()
  if (aba) {
    await page.getByRole('button', { name: aba, exact: true }).click()
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(800)
  }
  if (esperar) await esperar(page)
}

export const CAPTURAS = [
  // Acesso
  { arquivo: 'acesso-cadastro', url: '/register', semLogin: true },
  { arquivo: 'acesso-login', url: '/login', semLogin: true },
  {
    arquivo: 'acesso-busca', url: '/agenda',
    passos: async (page) => {
      await page.locator('button[title="Buscar paciente (Ctrl+K)"]:visible').first().click()
      await page.getByPlaceholder('Nome, telefone ou CPF do paciente').fill('Ma')
      await page.waitForTimeout(1200)
    },
  },
  {
    arquivo: 'acesso-pendencias', url: '/agenda',
    passos: async (page) => {
      await page.locator('button[title="Pendências"]').click()
      await page.waitForTimeout(800)
    },
  },

  // Dados da clínica
  { arquivo: 'clinica-configuracoes', url: '/configuracoes' },
  { arquivo: 'clinica-dados', url: '/configuracoes/clinica' },

  // Agenda
  { arquivo: 'agenda-semana', url: '/agenda' },
  {
    arquivo: 'agenda-nova', url: '/agenda',
    passos: async (page) => {
      await page.getByRole('button', { name: 'Nova consulta' }).click()
      await page.getByRole('button', { name: 'Salvar consulta' }).waitFor()
    },
  },
  { arquivo: 'agenda-detalhes', url: '/agenda', passos: abrirPrimeiraConsulta },
  {
    arquivo: 'agenda-editar', url: '/agenda',
    passos: async (page) => {
      await abrirPrimeiraConsulta(page)
      await page.getByRole('button', { name: 'Editar' }).click()
      await page.getByRole('button', { name: 'Excluir consulta' }).waitFor()
    },
  },

  // Configuração inicial
  { arquivo: 'profissionais-lista', url: '/configuracoes/profissionais' },
  {
    arquivo: 'profissionais-editar', url: '/configuracoes/profissionais',
    passos: async (page) => {
      await page.locator('button:has(svg.lucide-pencil)').first().click() // Dr. Carlos Mendes (com comissão)
      await page.getByText('% comissão particular').waitFor()
    },
  },
  { arquivo: 'config-convenios-lista', url: '/configuracoes/convenios' },
  {
    arquivo: 'config-convenios-tabela', url: '/configuracoes/convenios',
    passos: async (page) => {
      await page.getByRole('button', { name: /Odonto Saúde/ }).first().click()
      await page.getByText('Tabela de procedimentos').waitFor()
      await page.waitForTimeout(800)
    },
  },
  { arquivo: 'taxas', url: '/configuracoes/taxas' },
  {
    arquivo: 'pagamentos-conexao', url: '/configuracoes/pagamentos',
    falsos: { 'input[placeholder="Cole aqui a chave de API do Asaas"]': 'demo-0000000000' },
  },
  { arquivo: 'config-mensagens-conexao', url: '/configuracoes/mensagens' },
  {
    arquivo: 'config-mensagens-automaticas', url: '/mensagens',
    passos: async (page) => {
      await page.getByRole('button', { name: 'Automáticas' }).click()
      await page.getByText('Confirmação de consulta').first().waitFor()
    },
  },
  { arquivo: 'ia', url: '/configuracoes/ia', falsos: { '#ia-chave': 'sk-demo-0000000000000000' } },
  { arquivo: 'agente', url: '/configuracoes/agente' },
  { arquivo: 'anamnese', url: '/configuracoes/anamnese' },
  { arquivo: 'laboratorios', url: '/configuracoes/laboratorios' },

  // Pacientes
  { arquivo: 'pacientes-lista', url: '/pacientes' },
  { arquivo: 'pacientes-ficha', url: '/pacientes', passos: abrirFicha() },
  { arquivo: 'pacientes-anamnese', url: '/pacientes', passos: abrirFicha('Anamneses', (p) => p.getByText('Anamnese Geral').first().click()) },
  { arquivo: 'pacientes-tratamentos', url: '/pacientes', passos: abrirFicha('Tratamentos') },
  { arquivo: 'pacientes-evolucoes', url: '/pacientes', passos: abrirFicha('Evoluções') },

  // Orçamentos
  { arquivo: 'orcamentos-ficha', url: '/pacientes', passos: abrirFicha('Orçamentos', (p) => p.getByRole('button', { name: 'Novo orçamento' }).waitFor()) },
  {
    arquivo: 'orcamentos-paciente', semLogin: true, viewport: { width: 390, height: 844 },
    url: () => `/orcamento/${process.env.MANUAL_ORCAMENTO_TOKEN}`,
    passos: async (page) => { await page.getByText('Itens do tratamento').waitFor() },
  },
  { arquivo: 'orcamentos-funil', url: '/orcamentos' },
  {
    arquivo: 'orcamentos-contato', url: '/orcamentos',
    passos: async (page) => {
      await page.getByRole('button', { name: 'Registrar contato' }).first().click()
      await page.getByText('Vai pensar').waitFor()
    },
  },

  // Mensagens
  {
    arquivo: 'mensagens-conversas', url: '/mensagens',
    passos: async (page) => {
      await page.getByText('Lucas Ferreira Gomes').first().click()
      await page.getByPlaceholder('Escreva uma resposta…').waitFor()
      await page.waitForTimeout(800)
    },
  },
  {
    arquivo: 'mensagens-historico', url: '/mensagens',
    passos: async (page) => {
      await page.getByRole('button', { name: 'Histórico' }).click()
      await page.getByLabel('Filtrar por tipo').waitFor()
      await page.waitForTimeout(800)
    },
  },

  // Convênios
  {
    arquivo: 'convenios-guias', url: '/pacientes',
    passos: abrirFicha('Tratamentos', async (p) => {
      await p.getByRole('button', { name: 'Criar guia' }).scrollIntoViewIfNeeded()
      await p.waitForTimeout(500)
    }, 'Roberto Almeida Nunes'),
  },
  { arquivo: 'convenios-pendencias', url: '/convenios' },
  { arquivo: 'convenios-lotes', url: '/convenios?aba=lotes' },
  { arquivo: 'convenios-pagamentos', url: '/convenios?aba=pagamentos' },

  // Prótese
  { arquivo: 'protese-quadro', url: '/protese' },

  // Estoque
  { arquivo: 'estoque-produtos', url: '/estoque' },
  {
    arquivo: 'estoque-entrada', url: '/estoque',
    passos: async (page) => {
      await page.getByRole('button', { name: 'Entrada', exact: true }).first().click() // produto com validade
      await page.getByText('Quantidade *').waitFor()
    },
  },
  {
    arquivo: 'estoque-kits', url: '/estoque',
    passos: async (page) => {
      await page.getByRole('button', { name: 'Kits', exact: true }).click()
      await page.getByText('Kit restauração').waitFor()
    },
  },
  {
    arquivo: 'estoque-compras', url: '/estoque',
    passos: async (page) => {
      await page.getByRole('button', { name: 'Lista de compras' }).click()
      await page.getByRole('button', { name: 'Copiar texto' }).waitFor()
    },
  },
]
