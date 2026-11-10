'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import {
  FAIXAS,
  formatarPercentual,
  lerPercentual,
  lerTaxas,
  type FaixaTaxa,
  type TaxasMaquininha,
} from '@/lib/payments/taxasMaquininha'

type Textos = Record<FaixaTaxa, string>

const vazio: Textos = { debito: '', credito_vista: '', credito_2a6: '', credito_7a12: '', pix: '' }

function paraTextos(t: TaxasMaquininha): Textos {
  const r = { ...vazio }
  for (const f of FAIXAS) if (t[f.chave] !== undefined) r[f.chave] = formatarPercentual(t[f.chave]!)
  return r
}

export default function TaxasPage() {
  const { clinicId } = useClinicStore()
  const [textos, setTextos] = useState<Textos>(vazio)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clinicId) return
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('clinics').select('card_rates').eq('id', clinicId).single()
      setTextos(paraTextos(lerTaxas(data?.card_rates)))
      setLoading(false)
    }
    load()
  }, [clinicId])

  const invalidas = FAIXAS.filter((f) => lerPercentual(textos[f.chave]) === null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (invalidas.length > 0) { setError('Corrija as taxas marcadas: use um número entre 0 e 100.'); return }
    setSaving(true)
    setError('')
    const taxas: TaxasMaquininha = {}
    for (const f of FAIXAS) {
      if (textos[f.chave].trim() !== '') taxas[f.chave] = lerPercentual(textos[f.chave])!
    }
    const supabase = createClient()
    const { error: err } = await supabase.from('clinics').update({ card_rates: taxas }).eq('id', clinicId)
    setSaving(false)
    if (err) { setError(`Erro: ${err.message}`); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-start gap-3 mb-6">
        <Link href="/configuracoes" className="mt-0.5 p-1.5 rounded-lg hover:bg-porcelana text-tinta-3" aria-label="Voltar para Configurações">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Taxas de maquininhas</h1>
          <p className="text-sm text-tinta-3">
            Percentual que a maquininha desconta de cada venda. Ao lançar um pagamento em cartão ou Pix,
            o app calcula quanto a clínica recebe de fato. A comissão dos dentistas e o Livro-caixa usam esse valor.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="bg-white rounded-xl ring-1 ring-linha divide-y divide-linha">
            {FAIXAS.map((f) => {
              const invalida = lerPercentual(textos[f.chave]) === null
              return (
                <div key={f.chave} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <label htmlFor={`taxa-${f.chave}`} className="block text-sm font-medium text-tinta">{f.rotulo}</label>
                    {f.dica && <p className="text-xs text-tinta-3 mt-0.5">{f.dica}</p>}
                  </div>
                  <div className="relative w-28 shrink-0">
                    <input
                      id={`taxa-${f.chave}`}
                      inputMode="decimal"
                      value={textos[f.chave]}
                      onChange={(e) => setTextos((t) => ({ ...t, [f.chave]: e.target.value }))}
                      placeholder="0"
                      aria-invalid={invalida}
                      className={`w-full h-10 pl-3 pr-8 rounded-lg border text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-petroleo ${invalida ? 'border-red-400' : 'border-linha'}`}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tinta-4 font-medium">%</span>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-tinta-3">
            A taxa pode ser ajustada em cada lançamento. Mudar os valores aqui não altera pagamentos já registrados.
            Cobranças feitas pelo Asaas usam a tarifa informada pelo próprio Asaas.
          </p>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                <CheckCircle2 className="w-4 h-4" /> Taxas salvas
              </span>
            )}
            <button type="submit" disabled={saving}
              className="ml-auto h-10 px-6 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro transition-colors disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar taxas'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
