const TZ = 'America/Sao_Paulo'

/** Data (dd/mm/aaaa) de um instante ISO, no fuso de São Paulo. */
export function brDateFromInstant(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ })
}

/** CPF mascarado mantendo os 6 dígitos do meio: ***.456.789-** */
export function maskCpfMiddle(cpf: string): string {
  const n = (cpf ?? '').replace(/\D/g, '')
  return n.length === 11 ? `***.${n.slice(3, 6)}.${n.slice(6, 9)}-**` : '***'
}
