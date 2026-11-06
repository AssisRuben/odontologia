import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { getAiForClinic } from '@/lib/ia/conexao'
import { createAiDeps } from '@/lib/ia/repo'
import { normalizeAgentConfig, validateAgentConfig } from '@/lib/agente/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('agente config GET', async ({ clinicId, admin }) => {
    const [clinicRes, insRes, connRes, ai] = await Promise.all([
      admin.from('clinics').select('name, address, phone, agent_config').eq('id', clinicId).single(),
      admin.from('insurance_plans').select('name').eq('clinic_id', clinicId).order('name'),
      admin.from('whatsapp_connections').select('status').eq('clinic_id', clinicId).maybeSingle(),
      getAiForClinic(clinicId, createAiDeps(admin)),
    ])
    if (clinicRes.error) throw new Error(clinicRes.error.message)
    if (insRes.error) throw new Error(insRes.error.message)
    if (connRes.error) throw new Error(connRes.error.message)
    const c = clinicRes.data as { name: string; address: string | null; phone: string | null; agent_config: unknown }
    return {
      status: 200,
      body: {
        config: normalizeAgentConfig(c.agent_config),
        clinica: { name: c.name, address: c.address ?? null, phone: c.phone ?? null },
        convenios: ((insRes.data ?? []) as { name: string }[]).map((i) => i.name),
        whatsappConectado: (connRes.data as { status: string } | null)?.status === 'connected',
        iaConectada: !!ai,
      },
    }
  })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  return withClinic('agente config PUT', async ({ clinicId, admin }) => {
    const v = validateAgentConfig(body)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    if (v.config.enabled) {
      const [connRes, ai] = await Promise.all([
        admin.from('whatsapp_connections').select('status').eq('clinic_id', clinicId).maybeSingle(),
        getAiForClinic(clinicId, createAiDeps(admin)),
      ])
      if (connRes.error) throw new Error(connRes.error.message)
      const connected = (connRes.data as { status: string } | null)?.status === 'connected'
      if (!connected || !ai) {
        return { status: 409, body: { error: 'Para ligar, conecte o WhatsApp e cadastre a chave da OpenAI.' } }
      }
    }
    const { error } = await admin.from('clinics').update({ agent_config: v.config }).eq('id', clinicId)
    if (error) throw new Error(error.message)
    return { status: 200, body: { config: v.config } }
  })
}
