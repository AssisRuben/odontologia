// Lista de capturas do manual (npm run manual).
// Cada entrada vira public/ajuda/img/<arquivo>.png e deve ser citada em algum capítulo.
//
//   arquivo   nome do PNG, sem extensão: <slug-do-capítulo>-<tarefa>
//   url       tela a abrir
//   passos    (opcional) ações antes da foto: clicar numa aba, abrir um formulário...
//             NUNCA clicar em Salvar, Excluir ou Enviar.
//   falsos    (opcional) seletor → valor de exemplo, só para a foto (nada é salvo)
//   fullPage  (opcional) fotografa a página inteira, não só a parte visível
//   semLogin  (opcional) fotografa sem estar logado (ex.: tela de login)

// Os dados vêm do `npm run demo` (datas em volta de hoje).
// Paciente usado nas capturas da ficha.
export const PACIENTE_DEMO = 'Maria Silva Santos'

// Abre uma consulta futura (as passadas mostram botões que não fazem sentido no exemplo)
const abrirPrimeiraConsulta = async (page) => {
  await page.locator('.fc-event.fc-event-future').first().click()
  await page.getByRole('button', { name: 'Editar' }).waitFor()
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
]
