import { zonedParts } from '@/lib/messaging/time'
import type { Candidato } from './horarios'
import { OFFER_TTL_MS, MAX_OFFERS, MAX_APPOINTMENT_ALIASES } from './limites'

export type Oferta = Candidato & { n: number; tipo: string; expires_at: string }

export type ConsultaFutura = { id: string; start: string; procedure: string | null; professional: string | null }

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const ALIASES = ['C1', 'C2', 'C3'] as const

export const TEXTO_FECHO = 'Qual prefere? Responda com o número.'
export const TEXTO_RELAXOU = 'Não achei nesse dia ou período; estes são os mais próximos:'
export const TEXTO_VENCIDA = 'Esses horários expiraram. Vou buscar de novo.'
export const TEXTO_OCUPADO = 'Esse horário acabou de ser ocupado.'
export const TEXTO_NOME = 'Para marcar, preciso do seu nome completo.'

export function criarOfertas(escolhidos: Candidato[], tipo: string, now: Date): Oferta[] {
  const expires_at = new Date(now.getTime() + OFFER_TTL_MS).toISOString()
  return escolhidos.slice(0, MAX_OFFERS).map((c, i) => ({ ...c, n: i + 1, tipo, expires_at }))
}

export function ofertaValida(ofertas: Oferta[], n: number, now: Date): Oferta | null {
  const o = ofertas.find((x) => x.n === n)
  if (!o) return null
  return new Date(o.expires_at).getTime() > now.getTime() ? o : null
}

export function apelidos(consultas: ConsultaFutura[]): { alias: 'C1' | 'C2' | 'C3'; consulta: ConsultaFutura }[] {
  return [...consultas]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, MAX_APPOINTMENT_ALIASES)
    .map((consulta, i) => ({ alias: ALIASES[i], consulta }))
}

/** `8h30`, `10h`. */
export function formatHora(d: Date, tz: string): string {
  const p = zonedParts(d, tz)
  return p.minute === 0 ? `${p.hour}h` : `${p.hour}h${String(p.minute).padStart(2, '0')}`
}

function dm(d: Date, tz: string): string {
  const p = zonedParts(d, tz)
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`
}

export function diaCurto(d: Date, tz: string): string {
  return DIAS_CURTOS[zonedParts(d, tz).weekday]
}

export function diaLongo(d: Date, tz: string): string {
  return DIAS_LONGOS[zonedParts(d, tz).weekday]
}

export function linhaOferta(o: Oferta, tz: string): string {
  const d = new Date(o.start)
  return `${o.n}) ${diaCurto(d, tz)} ${dm(d, tz)} às ${formatHora(d, tz)} com ${o.professional_name}`
}

export function textoLista(ofertas: Oferta[], tz: string, relaxou: boolean): string {
  const linhas = ofertas.map((o) => linhaOferta(o, tz))
  return [...(relaxou ? [TEXTO_RELAXOU] : []), ...linhas, TEXTO_FECHO].join('\n')
}

function quando(o: Oferta, tz: string): string {
  const d = new Date(o.start)
  return `${diaLongo(d, tz)}, ${dm(d, tz)}, às ${formatHora(d, tz)} com ${o.professional_name}`
}

export function textoMarcada(o: Oferta, endereco: string | null, tz: string): string {
  const base = `Pronto! ${o.tipo} marcada para ${quando(o, tz)}.`
  return endereco?.trim() ? `${base} Endereço: ${endereco.trim()}.` : base
}

export function textoRemarcada(o: Oferta, tz: string): string {
  return `Pronto! Sua consulta foi remarcada para ${quando(o, tz)}.`
}

export function textoDesmarcada(c: ConsultaFutura, tz: string): string {
  const d = new Date(c.start)
  return `Consulta de ${dm(d, tz)} às ${formatHora(d, tz)} desmarcada. Se quiser marcar outra data, é só pedir.`
}
