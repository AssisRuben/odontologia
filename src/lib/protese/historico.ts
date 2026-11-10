// Regras derivadas do histórico de etapas de uma prótese.

import type { ProstheticEvent, ProstheticStatus } from '@/types'
import { todayYmd } from '@/lib/messaging/time'
import { diffDias } from './atraso'

export function idasAoLab(eventos: Pick<ProstheticEvent, 'to_status'>[]): number {
  return eventos.filter(e => e.to_status === 'sent_to_lab').length
}

/** Último evento de instalação; registro migrado instalado sem evento usa a data da solicitação. */
export function dataInstalacao(p: {
  status: ProstheticStatus
  requested_at: string
  events?: Pick<ProstheticEvent, 'to_status' | 'created_at'>[]
}): string | null {
  const instalados = (p.events ?? []).filter(e => e.to_status === 'installed')
  if (instalados.length > 0) {
    return instalados.reduce((a, b) => (b.created_at > a.created_at ? b : a)).created_at
  }
  return p.status === 'installed' ? p.requested_at : null
}

/** Instalada há mais de 30 dias sai do quadro, a não ser que se peça "todas". */
export function visivelNoQuadro(
  p: { status: ProstheticStatus; requested_at: string; events?: Pick<ProstheticEvent, 'to_status' | 'created_at'>[] },
  hojeYmd: string,
  todas: boolean,
): boolean {
  if (todas || p.status !== 'installed') return true
  const quando = dataInstalacao(p)
  if (!quando) return true
  const dia = quando.length > 10 ? todayYmd(new Date(quando), 'America/Sao_Paulo') : quando
  return diffDias(dia, hojeYmd) <= 30
}
