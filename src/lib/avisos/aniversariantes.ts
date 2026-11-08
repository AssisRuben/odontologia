// Aniversariantes do dia para o sino de avisos. Datas são 'YYYY-MM-DD'.

type ComNascimento = { id: string; name: string; birthdate: string | null }

const bissexto = (ano: number) => (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0

export function aniversariantesDoDia<T extends ComNascimento>(pacientes: T[], hoje: string): T[] {
  const mmdd = hoje.slice(5, 10)
  // Quem nasceu em 29/02 é lembrado em 28/02 quando o ano não é bissexto.
  const incluiLeap = mmdd === '02-28' && !bissexto(Number(hoje.slice(0, 4)))
  return pacientes
    .filter((p) => {
      const d = p.birthdate?.slice(5, 10)
      return d === mmdd || (incluiLeap && d === '02-29')
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}
