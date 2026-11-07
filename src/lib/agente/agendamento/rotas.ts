import { validateAgentConfig, type AgentConfig } from '../config'
import { validateWorkingHours, type TipoConsulta, type WorkingHours } from './config'
import { linhaOferta, type Oferta } from './ofertas'

const TIPO_INVALIDO = 'Tipo de consulta inválido'

/** Funde o corpo do PUT com o salvo: campos ausentes mantêm os valores atuais; `profissionais: []` vira null. */
export function prepararConfig(
  atual: AgentConfig,
  body: unknown,
): { ok: true; config: AgentConfig } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Configuração inválida' }
  const b = body as Record<string, unknown>
  const merged: Record<string, unknown> = {
    enabled: b.enabled !== undefined ? b.enabled : atual.enabled,
    hours: b.hours !== undefined ? b.hours : atual.hours,
    info: b.info !== undefined ? b.info : atual.info,
    tipos: b.tipos !== undefined ? b.tipos : atual.tipos,
    agendamento: b.agendamento !== undefined ? b.agendamento : atual.agendamento,
  }
  if (Array.isArray(merged.tipos)) {
    merged.tipos = merged.tipos.map((t) => {
      if (t && typeof t === 'object' && Array.isArray((t as TipoConsulta).profissionais) && (t as TipoConsulta).profissionais!.length === 0) {
        return { ...(t as object), profissionais: null }
      }
      return t
    })
  }
  return validateAgentConfig(merged)
}

/** Todos os profissionais citados nos tipos precisam ser da clínica. */
export function tiposDaClinica(
  tipos: TipoConsulta[],
  idsDaClinica: Set<string>,
): { ok: true } | { ok: false; error: string } {
  for (const t of tipos) {
    if (t.profissionais?.some((p) => !idsDaClinica.has(p))) return { ok: false, error: TIPO_INVALIDO }
  }
  return { ok: true }
}

export function validarAgenda(
  body: unknown,
): { ok: true; whatsapp_booking: boolean; hours: WorkingHours } | { ok: false; error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  if (!b || typeof b.whatsapp_booking !== 'boolean') return { ok: false, error: 'Dados inválidos' }
  const h = validateWorkingHours(b.working_hours)
  if (!h.ok) return h
  return { ok: true, whatsapp_booking: b.whatsapp_booking, hours: h.hours }
}

export function ofertasParaResposta(ofertas: Oferta[] | undefined, tz: string): { n: number; texto: string }[] | null {
  if (!ofertas?.length) return null
  return ofertas.map((o) => ({ n: o.n, texto: linhaOferta(o, tz) }))
}
