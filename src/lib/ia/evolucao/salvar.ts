import { isUuid } from '../uuid'
import { MAX_TEXT_CHARS } from '../modelos'
import { isFdi, normalizarFaces, type Acao } from './sugestoes'

export type AcaoSalvar = Exclude<Acao, { tipo: 'retorno' }>

export type SalvarInput = {
  patientId: string
  appointmentId: string | null
  professionalId: string | null
  date: string
  description: string
  images: string[]
  aiUsed: boolean
  acoes: AcaoSalvar[]
}

type Falha = { ok: false; status: 422; error: string }

const fail = (error: string): Falha => ({ ok: false, status: 422, error })
const SUGESTAO_INVALIDA = 'Sugestão inválida'
const MAX_ACOES = 50
const MAX_IMAGENS = 50

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Revalida uma ação vinda do navegador; null = inválida, 'descartar' = retorno. */
function parseAcao(raw: unknown): AcaoSalvar | 'descartar' | null {
  if (!isRecord(raw)) return null
  if (raw.tipo === 'retorno') return 'descartar'
  if (raw.tipo === 'item_orcamento' || raw.tipo === 'tratamento') {
    if (!isUuid(raw.id) || (raw.novo_status !== 'in_progress' && raw.novo_status !== 'completed')) return null
    return { tipo: raw.tipo, id: raw.id, novo_status: raw.novo_status }
  }
  if (raw.tipo === 'tratamento_novo') {
    const procedimento = typeof raw.procedimento === 'string' ? raw.procedimento.trim().slice(0, 200).trim() : ''
    if (!procedimento || (raw.status !== 'completed' && raw.status !== 'planned')) return null
    if (!Array.isArray(raw.dentes) || !raw.dentes.every(n => typeof n === 'number' && isFdi(n))) return null
    if (!Array.isArray(raw.faces) || !raw.faces.every(f => typeof f === 'string')) return null
    const faces = normalizarFaces(raw.faces as string[])
    if (!faces) return null
    const dentes = [...new Set(raw.dentes as number[])]
    // Faces só fazem sentido por dente; sem dentes a função do banco as descartaria.
    return { tipo: 'tratamento_novo', procedimento, dentes, faces: dentes.length ? faces : [], status: raw.status }
  }
  return null
}

export function parseSalvarEvolucao(body: unknown): { ok: true; input: SalvarInput } | Falha {
  if (!isRecord(body)) return fail('Dados inválidos')
  if (!isUuid(body.patientId)) return fail('Paciente inválido')
  const appointmentId = body.appointmentId ?? null
  const professionalId = body.professionalId ?? null
  if (appointmentId !== null && !isUuid(appointmentId)) return fail('Consulta inválida')
  if (professionalId !== null && !isUuid(professionalId)) return fail('Profissional inválido')
  if (!isDate(body.date)) return fail('Data inválida')
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description || description.length > MAX_TEXT_CHARS) return fail('Descrição vazia ou longa demais')

  const images = body.images ?? []
  if (!Array.isArray(images) || images.length > MAX_IMAGENS || !images.every(i => typeof i === 'string')) {
    return fail('Imagens inválidas')
  }

  const brutas = body.acoes ?? []
  if (!Array.isArray(brutas) || brutas.length > MAX_ACOES) return fail(SUGESTAO_INVALIDA)
  const acoes: AcaoSalvar[] = []
  for (const b of brutas) {
    const a = parseAcao(b)
    if (a === null) return fail(SUGESTAO_INVALIDA)
    if (a !== 'descartar') acoes.push(a)
  }

  return {
    ok: true,
    input: {
      patientId: body.patientId,
      appointmentId,
      professionalId,
      date: body.date,
      description,
      images: images as string[],
      aiUsed: body.aiUsed === true,
      acoes,
    },
  }
}

export function parseOrganizar(body: unknown): { ok: true; patientId: string; texto: string } | Falha {
  if (!isRecord(body) || !isUuid(body.patientId)) return fail('Paciente inválido')
  const texto = typeof body.texto === 'string' ? body.texto.trim() : ''
  if (!texto || texto.length > MAX_TEXT_CHARS) return fail('Texto vazio ou longo demais')
  return { ok: true, patientId: body.patientId, texto }
}

export type SalvarDeps = {
  rpc(args: Record<string, unknown>): Promise<{ data: string | null; error: { code?: string; message: string } | null }>
}

export async function salvarEvolucao(
  clinicId: string,
  input: SalvarInput,
  deps: SalvarDeps,
): Promise<{ status: number; body: unknown }> {
  const { data, error } = await deps.rpc({
    p_clinic_id: clinicId,
    p_patient_id: input.patientId,
    p_appointment_id: input.appointmentId,
    p_professional_id: input.professionalId,
    p_date: input.date,
    p_description: input.description,
    p_images: input.images,
    p_ai_used: input.aiUsed,
    p_actions: input.acoes,
  })
  if (error) {
    // Só P0001 (RAISE da função) tem mensagem própria para o usuário.
    if (error.code === 'P0001') return { status: 409, body: { error: error.message } }
    throw new Error(`falha ao salvar evolução (${error.code ?? 'sem código'})`)
  }
  return { status: 200, body: { id: data } }
}
