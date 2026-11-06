import { formatDataLonga } from '@/lib/messaging/time'
import type { EvolucaoOutput } from './esquema'
import type { Ref } from './ficha'

export type Acao =
  | { tipo: 'item_orcamento' | 'tratamento'; id: string; novo_status: 'in_progress' | 'completed' }
  | { tipo: 'tratamento_novo'; procedimento: string; dentes: number[]; faces: string[]; status: 'completed' | 'planned' }
  | { tipo: 'retorno'; dias: number; motivo: string }

export type Sugestao = { acao: Acao; descricao: string }

type Bruta = EvolucaoOutput['sugestoes'][number]

const FACES = ['V', 'M', 'O', 'D', 'L']
const MAX_TEXTO = 200
const RANK: Record<string, number> = { pending: 0, planned: 0, in_progress: 1, completed: 2 }

export function isFdi(n: number): boolean {
  if (!Number.isInteger(n)) return false
  const quadrante = Math.floor(n / 10)
  const dente = n % 10
  if (quadrante >= 1 && quadrante <= 4) return dente >= 1 && dente <= 8
  if (quadrante >= 5 && quadrante <= 8) return dente >= 1 && dente <= 5
  return false
}

export function normalizarFaces(f: string[]): string[] | null {
  const out: string[] = []
  for (const x of f) {
    const u = x.trim().toUpperCase()
    if (!FACES.includes(u)) return null
    if (!out.includes(u)) out.push(u)
  }
  return out
}

/** Soma `dias` à data da evolução (aritmética de calendário, sem fuso). */
export function dataRetorno(dataEvolucao: string, dias: number): string {
  const [y, m, d] = dataEvolucao.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

function statusItem(raw: Bruta, ref: Ref | undefined, tipo: Ref['kind']): Acao | null {
  if (!ref || ref.kind !== tipo || !raw.novo_status) return null
  if (RANK[raw.novo_status] <= (RANK[ref.status] ?? 99)) return null
  return { tipo: tipo === 'item' ? 'item_orcamento' : 'tratamento', id: ref.id, novo_status: raw.novo_status }
}

function descreverStatus(acao: Extract<Acao, { id: string }>, ref: Ref): string {
  const concluir = acao.novo_status === 'completed'
  if (acao.tipo === 'item_orcamento') {
    const quando = ref.budgetDate ? ` (orçamento de ${formatDataLonga(ref.budgetDate)})` : ''
    return `${concluir ? 'Concluir' : 'Iniciar'} ${ref.label}${quando}`
  }
  return concluir ? `Concluir tratamento ${ref.label}` : `Marcar em andamento: tratamento ${ref.label}`
}

function tratamentoNovo(raw: Bruta): Sugestao | null {
  const procedimento = raw.procedimento?.trim().slice(0, MAX_TEXTO).trim()
  if (!procedimento || !raw.status) return null
  const dentes = raw.dentes ?? []
  if (!dentes.every(isFdi)) return null
  const faces = normalizarFaces(raw.faces ?? [])
  if (!faces) return null
  const alvo = [...new Set(dentes)].join(', ') + (dentes.length && faces.length ? ` ${faces.join('')}` : '')
  const situacao = raw.status === 'completed' ? 'concluído' : 'planejado'
  return {
    acao: { tipo: 'tratamento_novo', procedimento, dentes: [...new Set(dentes)], faces, status: raw.status },
    descricao: `Lançar tratamento: ${procedimento}${alvo ? ` — ${alvo}` : ''} (${situacao})`,
  }
}

function retorno(raw: Bruta): Sugestao | null {
  const motivo = raw.motivo?.trim().slice(0, MAX_TEXTO).trim()
  if (raw.dias == null || !Number.isInteger(raw.dias) || raw.dias < 1 || raw.dias > 365 || !motivo) return null
  return {
    acao: { tipo: 'retorno', dias: raw.dias, motivo },
    descricao: `Retorno em ${raw.dias} ${raw.dias === 1 ? 'dia' : 'dias'}: ${motivo}`,
  }
}

/** Descarta, sem erro, o que a IA sugeriu fora das regras; traduz apelidos para UUIDs. */
export function validarSugestoes(raw: Bruta[], refs: Map<string, Ref>): Sugestao[] {
  const out: Sugestao[] = []
  const usados = new Set<string>()
  let temRetorno = false
  for (const r of raw) {
    if (r.tipo === 'item_orcamento' || r.tipo === 'tratamento') {
      const ref = r.ref ? refs.get(r.ref) : undefined
      const acao = statusItem(r, ref, r.tipo === 'item_orcamento' ? 'item' : 'tratamento')
      if (!acao || !ref || usados.has(r.ref as string)) continue
      usados.add(r.ref as string)
      out.push({ acao, descricao: descreverStatus(acao as Extract<Acao, { id: string }>, ref) })
    } else if (r.tipo === 'tratamento_novo') {
      const s = tratamentoNovo(r)
      if (s) out.push(s)
    } else if (!temRetorno) {
      const s = retorno(r)
      if (s) {
        temRetorno = true
        out.push(s)
      }
    }
  }
  return out
}
