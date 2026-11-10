'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { formatCurrency } from '@/lib/utils'
import type { PaymentMethod } from '@/types'
import {
  faixaPara,
  formatarPercentual,
  lerPercentual,
  lerTaxas,
  liquidoCentavos,
  type TaxasMaquininha,
} from '@/lib/payments/taxasMaquininha'

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'

function useTaxasDaClinica(): TaxasMaquininha | null {
  const { clinicId } = useClinicStore()
  const [taxas, setTaxas] = useState<TaxasMaquininha | null>(null)
  useEffect(() => {
    if (!clinicId) return
    let ativo = true
    createClient()
      .from('clinics')
      .select('card_rates')
      .eq('id', clinicId)
      .single()
      .then(({ data }) => { if (ativo) setTaxas(lerTaxas(data?.card_rates)) })
    return () => { ativo = false }
  }, [clinicId])
  return taxas
}

/**
 * Campos de parcelas e taxa da maquininha para cartão e Pix lançados à mão.
 * A taxa vem de Configurações → Taxas de maquininhas e pode ser ajustada no lançamento.
 * `liquidoCentavos` é nulo quando não há taxa a descontar.
 */
export function useTaxaMaquininha(metodo: PaymentMethod | '', brutoCentavos: number, ativo: boolean) {
  const taxas = useTaxasDaClinica()
  const [parcelas, setParcelas] = useState(1)
  // Taxa editada vale só para a mesma forma/faixa; ao trocar, volta a taxa configurada.
  const [editada, setEditada] = useState<{ chave: string; texto: string } | null>(null)

  const faixa = ativo && metodo ? faixaPara(metodo, parcelas) : null
  const chave = `${metodo}|${faixa}`
  const padrao = faixa && taxas ? (taxas[faixa] ?? 0) : 0
  const texto = editada && editada.chave === chave ? editada.texto : formatarPercentual(padrao)
  const pct = lerPercentual(texto)
  const erro = faixa && pct === null ? 'Taxa da maquininha inválida' : null
  const liquido = faixa && pct !== null && pct > 0 && brutoCentavos > 0 ? liquidoCentavos(brutoCentavos, pct) : null

  const campos = faixa ? (
    <div className="rounded-lg bg-porcelana-2 ring-1 ring-linha p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {metodo === 'cartao_credito' && (
          <div>
            <label htmlFor="tm-parcelas" className="block text-sm font-medium text-tinta mb-1">Parcelas na maquininha</label>
            <select id="tm-parcelas" className={inputCls} value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x`}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="tm-taxa" className="block text-sm font-medium text-tinta mb-1">Taxa da maquininha</label>
          <div className="relative">
            <input id="tm-taxa" inputMode="decimal" className={`${inputCls} pr-8`} value={texto}
              onChange={(e) => setEditada({ chave, texto: e.target.value })} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tinta-4 font-medium">%</span>
          </div>
        </div>
      </div>
      {erro ? (
        <p className="text-xs text-red-600">{erro}</p>
      ) : liquido !== null ? (
        <p className="text-sm text-tinta-2">
          Taxa de {formatCurrency((brutoCentavos - liquido) / 100)}. A clínica recebe{' '}
          <strong className="text-tinta">{formatCurrency(liquido / 100)}</strong>.
        </p>
      ) : (
        <p className="text-xs text-tinta-3">
          {taxas && padrao === 0 && !editada
            ? 'Sem taxa configurada para esta forma. Cadastre em Configurações → Taxas de maquininhas.'
            : 'Sem taxa a descontar.'}
        </p>
      )}
    </div>
  ) : null

  return { campos, liquidoCentavos: liquido, erro }
}
