'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { InventoryItem, InventoryMovement } from '@/types'
import { KIND_LABEL } from '@/lib/estoque/rotulos'
import { ordemFefo } from '@/lib/estoque/fefo'
import { diasParaVencer, situacaoLote, type SituacaoLote } from '@/lib/estoque/validade'
import { dataBr, umAnoAntes } from '@/lib/estoque/formatar'
import { ModalBase, CaixaErro, btnPriCls, btnSecCls } from './ModalBase'

interface Props {
  item: InventoryItem
  hojeYmd: string
  onClose: () => void
  onSaved: (msg?: string) => void
  onAcao: (tipo: 'entrada' | 'saida', item: InventoryItem) => void
}

const SELO: Record<SituacaoLote, { texto: string; cls: string }> = {
  vencido: { texto: 'Vencido', cls: 'bg-red-50 text-red-700' },
  vence_em_breve: { texto: 'Vence em breve', cls: 'bg-amber-50 text-amber-700' },
  ok: { texto: 'Em dia', cls: 'bg-green-50 text-green-700' },
  sem_validade: { texto: 'Sem validade', cls: 'bg-porcelana-2 text-tinta-3' },
}

function motivo(m: InventoryMovement): string {
  return m.kind ? KIND_LABEL[m.kind] : (m.reason ?? '')
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function ModalDetalhes({ item, hojeYmd, onClose, onSaved, onAcao }: Props) {
  const [movs, setMovs] = useState<InventoryMovement[] | null>(null)
  const [erroMovs, setErroMovs] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)
  const lotes = useMemo(() => ordemFefo((item.lots ?? []).filter((l) => l.quantity > 0)), [item.lots])

  useEffect(() => {
    if (!hojeYmd) return
    let cancelado = false
    fetch(`/api/estoque/movimentos?produto=${item.id}&de=${umAnoAntes(hojeYmd)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('falha')
        return res.json()
      })
      .then((j) => { if (!cancelado) setMovs((j.itens ?? []).slice(0, 20)) })
      .catch(() => { if (!cancelado) setErroMovs(true) })
    return () => { cancelado = true }
  }, [item.id, hojeYmd])

  async function baixarVencido(loteId: string, rotulo: string) {
    if (emAndamento.current) return
    if (!window.confirm(`Baixar ${rotulo} como vencido? O saldo do lote sairá do estoque.`)) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    try {
      const res = await fetch(`/api/estoque/lotes/${loteId}/vencido`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.error ?? 'Não foi possível salvar. Tente novamente.'); return }
      onSaved('Lote baixado como vencido')
    } catch {
      setErro('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  const dado = (rotulo: string, valor: string | number | null | undefined) => (
    <div>
      <dt className="text-xs text-tinta-4">{rotulo}</dt>
      <dd className="text-sm text-tinta">{valor === null || valor === undefined || valor === '' ? '—' : valor}</dd>
    </div>
  )

  return (
    <ModalBase
      titulo={item.name}
      onClose={onClose}
      bloqueado={enviando}
      largo
      rodape={
        item.active ? (
          <>
            <button onClick={() => onAcao('saida', item)} disabled={enviando} className={btnSecCls}>Saída</button>
            <button onClick={() => onAcao('entrada', item)} disabled={enviando} className={btnPriCls}>Entrada</button>
          </>
        ) : undefined
      }
    >
      {erro && <CaixaErro>{erro}</CaixaErro>}

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {dado('Saldo', `${item.quantity} ${item.unit ?? ''}`.trim())}
        {dado('Mínimo', item.min_quantity)}
        {dado('Ideal', item.ideal_quantity)}
        {dado('Categoria', item.category)}
        {dado('Fornecedor', item.supplier)}
        {dado('Situação', item.active ? 'Ativo' : 'Inativo')}
      </dl>

      {item.tracks_expiry && (
        <section>
          <h3 className="text-sm font-semibold text-tinta mb-2">Lotes</h3>
          {lotes.length === 0 ? (
            <p className="text-sm text-tinta-3">Nenhum lote com saldo.</p>
          ) : (
            <ul className="divide-y divide-linha rounded-lg border border-linha">
              {lotes.map((l) => {
                const sit = situacaoLote(l.expires_at, hojeYmd)
                const selo = SELO[sit]
                const rotulo = `o lote ${l.lot_code ?? 'sem lote'}`
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                    <span className="font-medium text-tinta w-28 truncate">{l.lot_code ?? 'sem lote'}</span>
                    <span className="text-tinta-3 w-28">{l.expires_at ? dataBr(l.expires_at) : '—'}</span>
                    <span className="text-tinta w-16">{l.quantity}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${selo.cls}`}>
                      {selo.texto}{sit === 'vence_em_breve' && l.expires_at ? ` (${diasParaVencer(l.expires_at, hojeYmd)} d)` : ''}
                    </span>
                    {sit === 'vencido' && (
                      <button onClick={() => baixarVencido(l.id, rotulo)} disabled={enviando}
                        className="ml-auto px-3 py-1 rounded-lg border border-linha text-xs text-tinta hover:bg-porcelana-2 disabled:opacity-50">
                        Baixar como vencido
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-tinta mb-2">Últimas movimentações</h3>
        {erroMovs ? (
          <p className="text-sm text-tinta-3">Não foi possível carregar as movimentações.</p>
        ) : movs === null ? (
          <p className="text-sm text-tinta-3">Carregando...</p>
        ) : movs.length === 0 ? (
          <p className="text-sm text-tinta-3">Nenhuma movimentação no último ano.</p>
        ) : (
          <ul className="divide-y divide-linha rounded-lg border border-linha">
            {movs.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-sm">
                <span className="text-tinta-3 w-32">{dataHora(m.created_at)}</span>
                <span className={`w-14 font-medium ${m.type === 'in' ? 'text-green-700' : 'text-red-700'}`}>
                  {m.type === 'in' ? '+' : '−'}{m.quantity}
                </span>
                <span className="text-tinta">{motivo(m)}</span>
                {m.lot?.lot_code && <span className="text-tinta-3">lote {m.lot.lot_code}</span>}
                {m.notes && <span className="text-tinta-3 truncate max-w-48">{m.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </ModalBase>
  )
}
