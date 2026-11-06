import type { NextRequest } from 'next/server'
import { parseSalvarEvolucao, salvarEvolucao } from '@/lib/ia/evolucao/salvar'
import { withClinic } from '@/lib/ia/rotas'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  return withClinic('evolucoes', async ({ clinicId, admin }) => {
    const p = parseSalvarEvolucao(body)
    if (!p.ok) return { status: p.status, body: { error: p.error } }
    return salvarEvolucao(clinicId, p.input, {
      rpc: async args => {
        const { data, error } = await admin.rpc('save_evolution_with_actions', args)
        return { data: (data as string | null) ?? null, error: error ? { code: error.code, message: error.message } : null }
      },
    })
  })
}
