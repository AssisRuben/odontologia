// Validação e normalização dos cadastros de convênio (funções puras).

type Falha = { ok: false; error: string }

function objeto(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

/** Texto aparado; vazio, nulo ou ausente viram null. Valor não textual vira null. */
function textoOuNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** Inteiro vindo como número ou texto numérico; vazio/ausente → null; inválido → NaN. */
function inteiroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'string' ? Number(v.trim()) : v
  if (typeof n !== 'number' || !Number.isInteger(n)) return NaN
  return n
}

export function dataValida(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export type DadosOperadora = {
  ans_registry: string | null
  provider_code: string | null
  closing_day: number | null
  submission_days: number
  payment_days: number
  appeal_days: number
  active: boolean
}

export function validarOperadora(raw: unknown): { ok: true; dados: DadosOperadora } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }

  const ans = textoOuNull(o.ans_registry)
  if (ans !== null && !/^\d{6}$/.test(ans)) return { ok: false, error: 'Registro ANS deve ter 6 dígitos' }

  const prestador = textoOuNull(o.provider_code)
  if (prestador !== null && prestador.length > 30) return { ok: false, error: 'Código do prestador muito longo' }

  const fechamento = inteiroOuNull(o.closing_day)
  if (fechamento !== null && !(fechamento >= 1 && fechamento <= 28)) {
    return { ok: false, error: 'Dia de fechamento deve ser de 1 a 28' }
  }

  const prazo = inteiroOuNull(o.submission_days) ?? 10
  if (!(prazo >= 0 && prazo <= 90)) return { ok: false, error: 'Prazo de envio deve ser de 0 a 90 dias' }

  const pagamento = inteiroOuNull(o.payment_days) ?? 30
  if (!(pagamento >= 0 && pagamento <= 180)) return { ok: false, error: 'Prazo de pagamento deve ser de 0 a 180 dias' }
  const recurso = inteiroOuNull(o.appeal_days) ?? 30
  if (!(recurso >= 0 && recurso <= 180)) return { ok: false, error: 'Prazo de recurso deve ser de 0 a 180 dias' }

  return {
    ok: true,
    dados: {
      ans_registry: ans,
      provider_code: prestador,
      closing_day: fechamento,
      submission_days: prazo,
      payment_days: pagamento,
      appeal_days: recurso,
      active: o.active === undefined || o.active === null ? true : o.active === true,
    },
  }
}

export type DadosItemTabela = {
  code: string
  name: string
  value: number
  requires_authorization: boolean
}

export function validarItemTabela(raw: unknown): { ok: true; dados: DadosItemTabela } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }

  const code = typeof o.code === 'string' ? o.code.trim() : ''
  if (code.length < 1 || code.length > 20 || !/^[A-Za-z0-9.\-]+$/.test(code)) {
    return { ok: false, error: 'Código inválido' }
  }

  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (name.length < 1 || name.length > 200) return { ok: false, error: 'Nome obrigatório' }

  const value = typeof o.value === 'string' && o.value.trim() !== '' ? Number(o.value.trim()) : o.value
  if (
    typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999999.99 ||
    Math.abs(Math.round(value * 100) - value * 100) > 1e-6
  ) {
    return { ok: false, error: 'Valor inválido' }
  }

  return { ok: true, dados: { code, name, value, requires_authorization: o.requires_authorization === true } }
}

export type DadosCarteirinha = {
  insurance_card: string | null
  insurance_card_valid_until: string | null
}

export function validarCarteirinha(raw: unknown): { ok: true; dados: DadosCarteirinha } | Falha {
  const o = objeto(raw)
  if (!o) return { ok: false, error: 'Dados inválidos' }

  const card = textoOuNull(o.insurance_card)
  if (card !== null && card.length > 30) return { ok: false, error: 'Carteirinha muito longa' }

  const validade = textoOuNull(o.insurance_card_valid_until)
  if (validade !== null && !dataValida(validade)) return { ok: false, error: 'Data inválida' }

  return { ok: true, dados: { insurance_card: card, insurance_card_valid_until: validade } }
}

/** `hoje` e `validUntil` são YYYY-MM-DD (comparação de texto é cronológica). */
export function situacaoCarteirinha(
  card: string | null,
  validUntil: string | null,
  hoje: string,
): 'ok' | 'vazia' | 'vencida' {
  if (!card || card.trim() === '') return 'vazia'
  if (validUntil && validUntil < hoje) return 'vencida'
  return 'ok'
}
