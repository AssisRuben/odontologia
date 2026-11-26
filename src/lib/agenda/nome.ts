// Nome do paciente para a agenda: nomes gravados todo em maiúsculas (ou minúsculas) aparecem só com as
// iniciais, que ocupam menos espaço e são mais fáceis de ler. O cadastro não muda.

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

const inicial = (parte: string) => parte.charAt(0).toLocaleUpperCase('pt-BR') + parte.slice(1)

export function nomeExibicao(nome: string): string {
  const limpo = nome.trim().replace(/\s+/g, ' ')
  const todoIgual = limpo === limpo.toLocaleUpperCase('pt-BR') || limpo === limpo.toLocaleLowerCase('pt-BR')
  if (!todoIgual) return limpo
  return limpo
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((palavra, i) => (i > 0 && PARTICULAS.has(palavra) ? palavra : palavra.split('-').map(inicial).join('-')))
    .join(' ')
}
