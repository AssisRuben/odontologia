import { MAX_TEXT_CHARS } from '../modelos'
import { isUuid } from '../uuid'
import type { Pergunta } from './esquema'

const MAX_RESPOSTA = 500
const MAX_OBSERVACOES = 2000

export type IaAnamnese = { respostas: Record<string, string>; observacoes: string | null }

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** Valida o texto do modelo contra o modelo de anamnese; o que não bate é descartado. */
export function validarRespostas(raw: unknown, perguntas: Pergunta[]): IaAnamnese {
  const respostas: Record<string, string> = {}
  let observacoes: string | null = null
  if (!isRecord(raw)) return { respostas, observacoes }

  const porId = new Map(perguntas.map(p => [p.id, p]))
  if (Array.isArray(raw.respostas)) {
    for (const r of raw.respostas) {
      if (!isRecord(r) || typeof r.id !== 'string' || typeof r.valor !== 'string') continue
      const p = porId.get(r.id)
      const valor = r.valor.trim()
      if (!p || !valor) continue
      if (p.type === 'yesno') {
        const n = norm(valor)
        if (n === 'sim') respostas[p.id] = 'Sim'
        else if (n === 'nao') respostas[p.id] = 'Não'
      } else if (p.type === 'options') {
        const op = (p.options ?? []).find(o => norm(o) === norm(valor))
        if (op !== undefined) respostas[p.id] = op
      } else {
        respostas[p.id] = valor.slice(0, MAX_RESPOSTA).trim()
      }
    }
  }
  if (typeof raw.observacoes === 'string') {
    observacoes = raw.observacoes.trim().slice(0, MAX_OBSERVACOES).trim() || null
  }
  return { respostas, observacoes }
}

/** Aplica a sugestão da IA sem sobrescrever respostas existentes. */
export function mesclarAnamnese(
  atual: Record<string, string>,
  notas: string,
  ia: IaAnamnese,
): { answers: Record<string, string>; notes: string; preenchidas: string[] } {
  const answers = { ...atual }
  const preenchidas: string[] = []
  for (const [id, valor] of Object.entries(ia.respostas)) {
    if ((atual[id] ?? '').trim()) continue
    answers[id] = valor
    preenchidas.push(id)
  }
  const obs = ia.observacoes
  const notes = obs ? (notas ? notas + '\n' + obs : obs) : notas
  return { answers, notes, preenchidas }
}

/**
 * Respostas sim/não e de opções que já estavam marcadas e que a fala contradiz.
 * A ficha não muda; o aviso vai para Observações. Perguntas de texto não entram.
 */
export function conflitosAnamnese(
  atual: Record<string, string>,
  ia: IaAnamnese,
  perguntas: Pergunta[],
): string[] {
  const avisos: string[] = []
  for (const p of perguntas) {
    if (p.type === 'text') continue
    const marcada = (atual[p.id] ?? '').trim()
    const falada = ia.respostas[p.id]
    if (!marcada || !falada || norm(marcada) === norm(falada)) continue
    avisos.push(`Atenção: na fala, "${p.text}" = ${falada}; a ficha mantém ${marcada}.`)
  }
  return avisos
}

export function parsePreencher(
  body: unknown,
): { ok: true; templateId: string; texto: string } | { ok: false; status: 422; error: string } {
  if (!isRecord(body) || !isUuid(body.templateId)) return { ok: false, status: 422, error: 'Modelo inválido' }
  const texto = typeof body.texto === 'string' ? body.texto.trim() : ''
  if (!texto || texto.length > MAX_TEXT_CHARS) {
    return { ok: false, status: 422, error: 'Texto vazio ou longo demais' }
  }
  return { ok: true, templateId: body.templateId, texto }
}
