// Funções puras do `npm run manual` (testadas em tests/ajuda/util.test.ts).

export function lerAmbiente(env) {
  const email = env.MANUAL_EMAIL?.trim()
  const senha = env.MANUAL_SENHA
  if (!email || !senha) throw new Error('Defina MANUAL_EMAIL e MANUAL_SENHA no .env.local (conta de demonstração)')
  const url = (env.MANUAL_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '')
  return { url, email, senha }
}

export function verificarLogin(urlFinal) {
  if (new URL(urlFinal).pathname.startsWith('/login')) {
    throw new Error('Não consegui entrar com MANUAL_EMAIL — confira e-mail e senha')
  }
}

export function resumir(resultados) {
  const falhas = resultados.filter(r => r.erro)
  const linhas = [`${resultados.length - falhas.length} capturas ok, ${falhas.length} falharam`]
  for (const f of falhas) linhas.push(`- ${f.arquivo}: ${f.erro}`)
  return { texto: linhas.join('\n'), falhou: falhas.length > 0 }
}
