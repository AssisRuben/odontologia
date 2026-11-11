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

// Data que o navegador "vê" nas capturas: dentro do período dos dados do scripts/seed.mjs.
export const DATA_DEMO = '2026-05-26T10:00:00-03:00'

// Paciente do seed usado nas capturas da ficha (Maria Silva Santos).
export const PACIENTE_DEMO = 'cc000001-0000-4000-8000-000000000001'

export const CAPTURAS = []
