// Etapas do trabalho de prótese: rótulos, cores e a próxima ação de cada uma.

import type { ProstheticStatus } from '@/types'

export const ETAPAS: { id: ProstheticStatus; rotulo: string; curto: string; cor: string }[] = [
  { id: 'requested', rotulo: 'Solicitação', curto: 'Solicitação', cor: '#F59E0B' },
  { id: 'sent_to_lab', rotulo: 'Enviado ao Laboratório', curto: 'Enviado', cor: '#173B47' },
  { id: 'returned', rotulo: 'Retornado à Clínica', curto: 'Retornado', cor: '#8B5CF6' },
  { id: 'installed', rotulo: 'Instalado', curto: 'Instalado', cor: '#10B981' },
]

const ACOES: Record<ProstheticStatus, string | null> = {
  requested: 'Enviar ao lab',
  sent_to_lab: 'Registrar retorno',
  returned: 'Instalar',
  installed: null,
}

export function etapa(id: ProstheticStatus): (typeof ETAPAS)[number] {
  return ETAPAS.find(e => e.id === id) ?? ETAPAS[0]
}

export function proximaEtapa(s: ProstheticStatus): ProstheticStatus | null {
  const i = ETAPAS.findIndex(e => e.id === s)
  return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1].id : null
}

export function acaoProxima(s: ProstheticStatus): string | null {
  return ACOES[s] ?? null
}

export function ehEtapa(x: unknown): x is ProstheticStatus {
  return typeof x === 'string' && ETAPAS.some(e => e.id === x)
}
