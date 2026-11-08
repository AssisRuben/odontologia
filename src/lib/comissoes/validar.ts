import { dataValida } from '@/lib/convenios/cadastro'
import { isUuid } from '@/lib/ia/uuid'
import { mesValido } from './periodo'

type Falha<E extends string> = { ok: false; error: E; status: 422 }

const FORMAS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'boleto']

export function validarPercentual(
  raw: unknown,
  opcional: boolean,
): { ok: true; valor: number | null } | { ok: false; error: 'Percentual inválido' } {
  const invalido = { ok: false, error: 'Percentual inválido' } as const
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return opcional ? { ok: true, valor: null } : invalido
  }
  let n: number
  if (typeof raw === 'number') {
    n = raw
    if (!Number.isFinite(n) || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return invalido
  } else if (typeof raw === 'string') {
    const t = raw.trim().replace(',', '.')
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return invalido
    n = Number(t)
  } else {
    return invalido
  }
  if (n < 0 || n > 100) return invalido
  return { ok: true, valor: n }
}

export function validarFechamento(
  raw: unknown,
): { ok: true; professionalId: string; mes: string } | Falha<'Identificador inválido' | 'Mês inválido'> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (!isUuid(o.professionalId)) return { ok: false, error: 'Identificador inválido', status: 422 }
  if (!mesValido(o.mes)) return { ok: false, error: 'Mês inválido', status: 422 }
  return { ok: true, professionalId: o.professionalId, mes: o.mes }
}

export function validarPagamentoComissao(
  raw: unknown,
): { ok: true; paidAt: string; paymentMethod: string } | Falha<'Data inválida' | 'Forma de pagamento inválida'> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (typeof o.paidAt !== 'string' || !dataValida(o.paidAt)) return { ok: false, error: 'Data inválida', status: 422 }
  if (typeof o.paymentMethod !== 'string' || !FORMAS.includes(o.paymentMethod)) {
    return { ok: false, error: 'Forma de pagamento inválida', status: 422 }
  }
  return { ok: true, paidAt: o.paidAt, paymentMethod: o.paymentMethod }
}
