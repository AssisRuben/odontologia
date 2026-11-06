import type { NextRequest } from 'next/server'
import { isUuid, withClinic } from '@/lib/ia/rotas'
import { INVALID_ID, cadastrarPaciente, parseNome } from '@/lib/agente/caixa'
import { createPacienteDeps } from '@/lib/agente/caixaRepo'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  return withClinic('conversa paciente', async ({ clinicId, admin }) => {
    if (!isUuid(id)) return { status: 422, body: INVALID_ID }
    const n = parseNome(body)
    if (!n.ok) return { status: 422, body: { error: n.error } }
    return cadastrarPaciente(createPacienteDeps(admin), clinicId, id, n.name)
  })
}
