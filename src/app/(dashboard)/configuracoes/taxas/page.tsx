'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

interface CardRates {
  visa_credito: string
  visa_debito: string
  master_credito: string
  master_debito: string
  elo_credito: string
  elo_debito: string
  amex_credito: string
  hipercard_credito: string
  pix: string
}

const defaultRates: CardRates = {
  visa_credito: '', visa_debito: '',
  master_credito: '', master_debito: '',
  elo_credito: '', elo_debito: '',
  amex_credito: '',
  hipercard_credito: '',
  pix: '',
}

const fields: { key: keyof CardRates; label: string; group: string }[] = [
  { key: 'visa_credito',      label: 'Visa Crédito',        group: 'Visa' },
  { key: 'visa_debito',       label: 'Visa Débito',         group: 'Visa' },
  { key: 'master_credito',    label: 'Mastercard Crédito',  group: 'Mastercard' },
  { key: 'master_debito',     label: 'Mastercard Débito',   group: 'Mastercard' },
  { key: 'elo_credito',       label: 'Elo Crédito',         group: 'Elo' },
  { key: 'elo_debito',        label: 'Elo Débito',          group: 'Elo' },
  { key: 'amex_credito',      label: 'Amex Crédito',        group: 'Outros' },
  { key: 'hipercard_credito', label: 'Hipercard Crédito',   group: 'Outros' },
  { key: 'pix',               label: 'PIX',                 group: 'Outros' },
]

const groups = ['Visa', 'Mastercard', 'Elo', 'Outros']

export default function TaxasPage() {
  const { clinicId } = useClinicStore()
  const [rates, setRates] = useState<CardRates>(defaultRates)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clinicId) return
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('clinics').select('card_rates').eq('id', clinicId).single()
      if (data?.card_rates) setRates({ ...defaultRates, ...data.card_rates })
      setLoading(false)
    }
    load()
  }, [clinicId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase.from('clinics').update({ card_rates: rates }).eq('id', clinicId)
    setSaving(false)
    if (err) { setError(`Erro: ${err.message}`); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Taxas de maquininhas</h1>
          <p className="text-sm text-[#6B7280]">Configure a taxa cobrada por cada bandeira. Ex: 2.5 para 2,5%</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {groups.map(group => {
            const groupFields = fields.filter(f => f.group === group)
            return (
              <div key={group} className="bg-white rounded-xl border border-[#E5E7EB] p-5">
                <p className="text-sm font-semibold text-[#374151] mb-4">{group}</p>
                <div className="grid grid-cols-2 gap-4">
                  {groupFields.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-[#6B7280] mb-1">{f.label}</label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={rates[f.key]}
                          onChange={e => setRates(r => ({ ...r, [f.key]: e.target.value }))}
                          placeholder="0.00"
                          className="w-full h-10 pl-3 pr-8 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9CA3AF] font-medium">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                <CheckCircle2 className="w-4 h-4" /> Taxas salvas
              </span>
            )}
            <button type="submit" disabled={saving}
              className="ml-auto h-10 px-6 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar taxas'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
