// Atualiza chaves no texto de um .env sem mexer nas outras linhas.

export function atualizarEnv(texto, valores) {
  const eol = texto.includes('\r\n') ? '\r\n' : '\n'
  const linhas = texto === '' ? [] : texto.split(/\r?\n/)
  if (linhas.length && linhas[linhas.length - 1] === '') linhas.pop()
  const faltam = new Set(Object.keys(valores))

  const novas = linhas.map((linha) => {
    const m = linha.match(/^\s*#?\s*([A-Z0-9_]+)\s*=/)
    if (m && m[1] in valores && faltam.has(m[1])) {
      faltam.delete(m[1])
      return `${m[1]}=${valores[m[1]]}`
    }
    return linha
  })
  for (const chave of faltam) novas.push(`${chave}=${valores[chave]}`)
  return novas.join(eol) + eol
}
