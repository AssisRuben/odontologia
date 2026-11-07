import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { NO_KEY_ERROR } from '@/lib/ia/erros'
import { simulateAgent } from '@/lib/agente/agente'
import { MAX_INCOMING_CHARS } from '@/lib/agente/conversa'
import { createAgentDeps } from '@/lib/agente/repo'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).texto : undefined
  const texto = typeof raw === 'string' ? raw.trim() : ''
  return withClinic('agente testar', async ({ clinicId, admin }) => {
    if (!texto || texto.length > MAX_INCOMING_CHARS) return { status: 422, body: { error: 'Mensagem vazia ou longa demais' } }
    const r = await simulateAgent(createAgentDeps(admin), clinicId, texto, new Date())
    if (r === 'no_key') return { status: NO_KEY_ERROR.status, body: { error: NO_KEY_ERROR.error } }
    const d = r as Record<string, unknown>
    return {
      status: 200,
      body: { acao: d.acao, resposta: d.resposta ?? null, nome: d.nome ?? null, motivo: d.motivo ?? null, ofertas: d.ofertas ?? null },
    }
  })
}
