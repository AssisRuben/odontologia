'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { formatCurrency } from '@/lib/utils'
import { lostReasonLabel } from '@/lib/orcamentos/etapas'
import type { FunnelListRow } from '@/lib/orcamentos/repo'
import { ModalContato } from './ModalContato'
import { ModalDecisao } from './ModalDecisao'
import { ModalNovaCobranca } from '@/components/pagamentos/ModalNovaCobranca'

export type TabKey = 'enviados' | 'paraLigar' | 'aprovados' | 'perdidos'

const EVENT_LABEL: Record<string, string> = {
  sent: 'Enviado', resent: 'Reenviado', reminder: 'Lembrete', viewed: 'Visualizado', contact: 'Contato',
  approved: 'Aprovado', rejected: 'Recusado', expired: 'Vencido', reopened: 'Reaberto', edited: 'Editado',
}
const OUTCOME_LABEL: Record<string, string> = {
  nao_atendeu: 'não atendeu', pensar: 'vai pensar', aprovou: 'aprovou', perdido: 'perdido',
}

const fmtDate = (iso: string | null) => (iso ? format(parseISO(iso), 'dd/MM/yyyy') : '—')
const btn = 'px-3 h-8 rounded-lg border border-linha text-xs font-medium text-tinta-2 hover:bg-porcelana-2 disabled:opacity-50'
const btnPrimary = 'px-3 h-8 rounded-lg bg-petroleo text-white text-xs font-medium hover:bg-petroleo-escuro disabled:opacity-50'

interface Props {
  tab: TabKey
  rows: FunnelListRow[]
  onChanged: () => void
}

export function ListaOrcamentos({ tab, rows, onChanged }: Props) {
  const [contact, setContact] = useState<FunnelListRow | null>(null)
  const [decision, setDecision] = useState<{ row: FunnelListRow; mode: 'approve' | 'lose' } | null>(null)
  const [charge, setCharge] = useState<FunnelListRow | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  async function call(id: string, url: string, init?: RequestInit) {
    setBusy(id); setNotice('')
    try {
      const res = await fetch(url, init)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice(json.error ?? 'Não foi possível concluir.'); return null }
      return json
    } catch {
      setNotice('Falha de conexão. Tente de novo.')
      return null
    } finally {
      setBusy(null)
    }
  }

  async function resend(r: FunnelListRow) {
    const json = await call(r.id, `/api/orcamentos/${r.id}/enviar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resend: true }),
    })
    if (json) {
      setNotice(json.warning ?? (json.sent ? 'Orçamento reenviado.' : 'Link gerado, mas a mensagem não foi enviada.'))
      onChanged()
    }
  }

  async function copyLink(r: FunnelListRow) {
    const json = await call(r.id, `/api/orcamentos/${r.id}/link`)
    if (!json) return
    try {
      await navigator.clipboard.writeText(json.link)
      setNotice('Link copiado.')
    } catch {
      setNotice(`Link: ${json.link}`)
    }
  }

  async function reopen(r: FunnelListRow) {
    const json = await call(r.id, `/api/orcamentos/${r.id}/decisao`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen' }),
    })
    if (json) onChanged()
  }

  if (rows.length === 0) {
    return <div className="bg-white rounded-xl border border-linha p-8 text-center text-sm text-tinta-3">Nenhum orçamento nesta etapa.</div>
  }

  return (
    <div className="space-y-2">
      {notice && <p className="text-sm text-tinta-2 bg-porcelana rounded-lg px-3 py-2">{notice}</p>}
      {rows.map(r => {
        const toCharge = Math.round((r.approved_total - r.charged) * 100) / 100
        return (
          <div key={r.id} className="bg-white rounded-xl border border-linha p-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-tinta">{r.patient.name}</p>
                <p className="text-xs text-tinta-3">
                  {r.professional_name ?? 'Sem dentista'}
                  {r.patient.phone ? ` · ${r.patient.phone}` : ''}
                </p>
              </div>
              <p className="font-bold text-tinta">
                {formatCurrency(tab === 'aprovados' ? r.approved_total : r.total)}
              </p>
            </div>

            <p className="text-xs text-tinta-3">
              Enviado em {fmtDate(r.sent_at)}
              {r.viewed_at && ` · visto em ${fmtDate(r.viewed_at)}`}
              {r.valid_until && (tab === 'enviados' || tab === 'paraLigar') && ` · vale até ${fmtDate(r.valid_until)}`}
              {r.decided_at && (tab === 'aprovados' || tab === 'perdidos') && ` · decidido em ${fmtDate(r.decided_at)}`}
              {tab === 'aprovados' && ` · cobrado ${formatCurrency(r.charged)}`}
              {tab === 'perdidos' && r.lost_reason && ` · motivo: ${lostReasonLabel(r.lost_reason)}`}
              {r.followup_at && tab === 'paraLigar' && ` · retorno em ${fmtDate(r.followup_at)}`}
            </p>

            {r.last_events.length > 0 && (
              <ul className="text-xs text-tinta-3 space-y-0.5">
                {r.last_events.map(e => (
                  <li key={e.id}>
                    {fmtDate(e.created_at)} · {EVENT_LABEL[e.type] ?? e.type}
                    {e.outcome ? ` (${OUTCOME_LABEL[e.outcome] ?? e.outcome})` : ''}
                    {e.note ? `: ${e.note}` : ''}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {tab === 'paraLigar' && <button className={btnPrimary} onClick={() => setContact(r)}>Registrar contato</button>}
              {(tab === 'enviados' || tab === 'paraLigar') && (
                <>
                  <button className={btn} disabled={busy === r.id} onClick={() => resend(r)}>Reenviar</button>
                  <button className={btn} disabled={busy === r.id} onClick={() => copyLink(r)}>Copiar link</button>
                </>
              )}
              {tab === 'aprovados' && (
                <>
                  {toCharge > 0 && <button className={btnPrimary} onClick={() => setCharge(r)}>Gerar cobrança</button>}
                  <a className={btn + ' inline-flex items-center'} href={`/api/orcamentos/${r.id}/comprovante`} target="_blank" rel="noreferrer">Comprovante</a>
                </>
              )}
              {tab === 'perdidos' && <button className={btn} disabled={busy === r.id} onClick={() => reopen(r)}>Reabrir</button>}
            </div>
          </div>
        )
      })}

      {contact && (
        <ModalContato
          budgetId={contact.id}
          patientName={contact.patient.name}
          onClose={() => setContact(null)}
          onSaved={() => { setContact(null); onChanged() }}
          onDecide={(mode) => { setDecision({ row: contact, mode }); setContact(null); onChanged() }}
        />
      )}
      {decision && (
        <ModalDecisao
          budget={{ id: decision.row.id }}
          mode={decision.mode}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); onChanged() }}
        />
      )}
      {charge && (
        <ModalNovaCobranca
          patient={{ id: charge.patient.id, name: charge.patient.name, cpf: charge.patient.cpf, whatsapp_opt_out: charge.patient.whatsapp_opt_out }}
          budget={{
            id: charge.id,
            total: Math.round((charge.approved_total - charge.charged) * 100) / 100,
            label: `Orçamento #${charge.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          }}
          onClose={() => setCharge(null)}
          onCreated={() => { setCharge(null); onChanged() }}
        />
      )}
    </div>
  )
}
