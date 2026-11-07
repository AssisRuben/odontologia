import type { NextRequest } from 'next/server'
import { withClinic } from '@/lib/ia/rotas'
import { getAiForClinic } from '@/lib/ia/conexao'
import { createAiDeps } from '@/lib/ia/repo'
import { needsPrerequisites, normalizeAgentConfig } from '@/lib/agente/config'
import { podarTipos, prepararConfigDaClinica } from '@/lib/agente/agendamento/rotas'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('agente config GET', async ({ clinicId, admin }) => {
    const [clinicRes, insRes, connRes, profRes, ai] = await Promise.all([
      admin.from('clinics').select('name, address, phone, agent_config').eq('id', clinicId).single(),
      admin.from('insurance_plans').select('name').eq('clinic_id', clinicId).order('name'),
      admin.from('whatsapp_connections').select('status').eq('clinic_id', clinicId).maybeSingle(),
      admin.from('professionals').select('id, name, whatsapp_booking').eq('clinic_id', clinicId).order('name'),
      getAiForClinic(clinicId, createAiDeps(admin)),
    ])
    if (profRes.error) throw new Error(profRes.error.message)
    if (clinicRes.error) throw new Error(clinicRes.error.message)
    if (insRes.error) throw new Error(insRes.error.message)
    if (connRes.error) throw new Error(connRes.error.message)
    const c = clinicRes.data as { name: string; address: string | null; phone: string | null; agent_config: unknown }
    const profs = (profRes.data ?? []) as { id: string; name: string; whatsapp_booking: boolean }[]
    const config = normalizeAgentConfig(c.agent_config)
    return {
      status: 200,
      body: {
        config: { ...config, tipos: podarTipos(config.tipos, new Set(profs.map((p) => p.id))) },
        profissionais: profs.map((p) => ({ id: p.id, name: p.name })),
        profissionaisWhatsApp: profs.filter((p) => p.whatsapp_booking).length,
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
    const [curRes, profRes] = await Promise.all([
      admin.from('clinics').select('agent_config').eq('id', clinicId).single(),
      admin.from('professionals').select('id').eq('clinic_id', clinicId),
    ])
    if (curRes.error) throw new Error(curRes.error.message)
    if (profRes.error) throw new Error(profRes.error.message)
    const atual = normalizeAgentConfig((curRes.data as { agent_config: unknown }).agent_config)
    const ids = new Set(((profRes.data ?? []) as { id: string }[]).map((p) => p.id))
    // Campos ausentes no corpo (ex.: tela da 6a) mantêm os valores salvos (podados de profissionais removidos).
    const v = prepararConfigDaClinica(atual, body, ids)
    if (!v.ok) return { status: 422, body: { error: v.error } }
    // Só ao ligar: com o agente já ligado, editar textos/horários funciona mesmo com o WhatsApp caído.
    if (needsPrerequisites(atual, v.config)) {
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
