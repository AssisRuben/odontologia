import type { NextRequest } from 'next/server'
import { getAiView, saveAiConnection } from '@/lib/ia/conexao'
import { createAiDeps } from '@/lib/ia/repo'
import { withClinic } from '@/lib/ia/rotas'

export const dynamic = 'force-dynamic'

async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const j = await req.json()
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function GET() {
  return withClinic('conexao GET', async ({ clinicId, admin }) => ({
    status: 200,
    body: await getAiView(clinicId, createAiDeps(admin), new Date()),
  }))
}

export async function PUT(req: NextRequest) {
  const input = await readJson(req)
  return withClinic('conexao PUT', async ({ clinicId, admin }) => {
    const r = await saveAiConnection(clinicId, input, createAiDeps(admin))
    if (!r.ok) return { status: r.status, body: { error: r.error } }
    return { status: 200, body: { ok: true } }
  })
}

export async function DELETE() {
  return withClinic('conexao DELETE', async ({ clinicId, admin }) => {
    await createAiDeps(admin).remove(clinicId)
    return { status: 200, body: { ok: true } }
  })
}
