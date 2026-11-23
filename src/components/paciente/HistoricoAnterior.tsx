'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { lerTudo } from '@/lib/supabase/lerTudo'
import { formatCurrency } from '@/lib/utils'
import { PAYMENT_METHOD_LABELS } from '@/types'
import type { PaymentMethod } from '@/types'
import { resumoHistorico, type LegacyPayment } from '@/lib/pacientes/historicoAnterior'

function brDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function formaPagamento(metodo: string): string {
  return PAYMENT_METHOD_LABELS[metodo as PaymentMethod] ?? metodo
}

/** Lançamentos do sistema anterior, só para consulta. Sem linhas ou com erro de leitura, não aparece. */
export function HistoricoAnterior({ patientId }: { patientId: string }) {
  const [carga, setCarga] = useState<{ patientId: string; linhas: LegacyPayment[] } | null>(null)

  useEffect(() => {
    let ativo = true
    const supabase = createClient()
    lerTudo<LegacyPayment>((de, ate) =>
      supabase
        .from('legacy_payments')
        .select('*')
        .eq('patient_id', patientId)
        .order('due_date', { ascending: false, nullsFirst: false })
        .order('id')
        .range(de, ate),
    ).then(
      (linhas) => { if (ativo) setCarga({ patientId, linhas }) },
      () => { if (ativo) setCarga({ patientId, linhas: [] }) },
    )
    return () => { ativo = false }
  }, [patientId])

  const linhas = carga?.patientId === patientId ? carga.linhas : []
  if (linhas.length === 0) return null

  const { pago, emAberto } = resumoHistorico(linhas)

  return (
    <section className="mt-4 bg-white rounded-xl border border-linha overflow-hidden">
      <div className="px-5 py-4 border-b border-linha flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-tinta">Histórico do sistema anterior</h3>
          <p className="text-xs text-tinta-3 mt-0.5">Estes valores não fazem parte do financeiro atual</p>
        </div>
        <span className="text-xs text-tinta-3 shrink-0">{linhas.length} lançamento(s)</span>
      </div>

      <ul className="divide-y divide-linha">
        {linhas.map((l) => {
          const pagoLinha = l.original_status === 'paid'
          const data = pagoLinha ? l.paid_at ?? l.due_date : l.due_date
          const detalhes = [
            data ? `${pagoLinha ? 'Pago em' : 'Vencimento'} ${brDate(data)}` : null,
            l.payment_method ? formaPagamento(l.payment_method) : null,
            l.installment_number && l.installment_count ? `Parcela ${l.installment_number}/${l.installment_count}` : null,
          ].filter(Boolean)
          return (
            <li key={l.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-tinta truncate">{l.description || 'Lançamento'}</p>
                {detalhes.length > 0 && <p className="text-xs text-tinta-4 mt-0.5">{detalhes.join(' · ')}</p>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${pagoLinha ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {pagoLinha ? 'Pago' : 'Em aberto'}
                </span>
                <span className="text-sm font-semibold text-tinta tabular-nums">{formatCurrency(Number(l.amount))}</span>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="px-5 py-3 bg-porcelana-2 border-t border-linha flex flex-wrap items-center justify-end gap-x-6 gap-y-1">
        <span className="text-xs font-medium text-tinta-3">
          Pago <span className="text-sm font-bold text-[#10B981] tabular-nums">{formatCurrency(pago)}</span>
        </span>
        <span className="text-xs font-medium text-tinta-3">
          Em aberto <span className="text-sm font-bold text-[#B45309] tabular-nums">{formatCurrency(emAberto)}</span>
        </span>
      </div>
    </section>
  )
}
