'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { InsuranceGuide, ItemAuthorization } from '@/types'

type Decisao = { authorization: 'autorizado' | 'negado'; denialReason: string }

interface Props {
  guide: InsuranceGuide
  onClose: () => void
  onSaved: () => void
}

export function ModalRespostaGuia({ guide, onClose, onSaved }: Props) {
  const [guideNumber, setGuideNumber] = useState(guide.guide_number || '')
  const [password, setPassword] = useState(guide.password || '')
  const [validUntil, setValidUntil] = useState(guide.password_valid_until || '')
  // Itens em lote não recebem resposta; com algum item em lote, número e senha
  // já saíram no lote e não mudam (o servidor mantém os gravados).
  const itens = (guide.items || []).filter((i) => i.active && i.requires_authorization && !i.batch_id)
  const emLote = (guide.items || []).some((i) => i.active && i.batch_id)
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>(() => {
    const ini: Record<string, Decisao> = {}
    for (const i of itens) {
      const a: ItemAuthorization = i.authorization
      if (a === 'autorizado' || a === 'negado') {
        ini[i.id] = { authorization: a, denialReason: i.denial_reason || '' }
      }
    }
    return ini
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function setDecisao(id: string, patch: Partial<Decisao>) {
    setDecisoes((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { authorization: 'autorizado' as const, denialReason: '' }), ...patch },
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`/api/guias/${guide.id}/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guideNumber,
          password,
          passwordValidUntil: validUntil,
          itens: Object.entries(decisoes).map(([id, d]) => ({
            id,
            authorization: d.authorization,
            denialReason: d.authorization === 'negado' ? d.denialReason : null,
          })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Erro ao registrar resposta')
        setLoading(false)
        return
      }
      window.dispatchEvent(new Event('convenios:changed'))
      onSaved()
    } catch {
      setError('Erro ao registrar resposta')
      setLoading(false)
    }
  }

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] disabled:bg-[#F9FAFB] disabled:text-[#6B7280]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Registrar resposta</h2>
          <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Número da guia</label>
              <input value={guideNumber} onChange={(e) => setGuideNumber(e.target.value)} maxLength={40} disabled={emLote} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Senha</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={40} disabled={emLote} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Validade da senha</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={emLote} className={inputCls} />
            </div>
          </div>
          {emLote && (
            <p className="text-xs text-[#6B7280] -mt-2">
              A guia tem item em lote: número, senha e validade ficam como estão.
            </p>
          )}

          <div>
            <p className="text-sm font-medium text-[#111827] mb-2">Itens</p>
            {itens.length === 0 ? (
              <p className="text-sm text-[#9CA3AF]">
                {emLote ? 'Nenhum item fora de lote exige autorização.' : 'Nenhum item exige autorização.'}
              </p>
            ) : (
              <div className="space-y-2">
                {itens.map((i) => {
                  const d = decisoes[i.id]
                  return (
                    <div key={i.id} className="rounded-lg border border-[#E5E7EB] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-[#111827] min-w-0 truncate">{i.code} · {i.name}</span>
                        <select
                          value={d?.authorization ?? ''}
                          onChange={(e) => {
                            if (e.target.value === '') {
                              setDecisoes((prev) => {
                                const next = { ...prev }
                                delete next[i.id]
                                return next
                              })
                            } else {
                              setDecisao(i.id, { authorization: e.target.value as Decisao['authorization'] })
                            }
                          }}
                          className="h-9 px-2 rounded-lg border border-[#E5E7EB] text-sm bg-white shrink-0"
                        >
                          <option value="">Sem resposta</option>
                          <option value="autorizado">Autorizado</option>
                          <option value="negado">Negado</option>
                        </select>
                      </div>
                      {d?.authorization === 'negado' && (
                        <input
                          value={d.denialReason}
                          onChange={(e) => setDecisao(i.id, { denialReason: e.target.value })}
                          maxLength={200}
                          placeholder="Motivo da negativa"
                          className={inputCls}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
            >
              {loading ? 'Salvando...' : 'Salvar resposta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
