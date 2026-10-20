'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

export default function ClinicaPage() {
  const { clinicId } = useClinicStore()
  const [name, setName] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clinicId) return
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('clinics').select('*').eq('id', clinicId).single()
      if (data) {
        setName(data.name || '')
        setCnpj(data.cnpj || '')
        setPhone(data.phone || '')
        setAddress(data.address || '')
      }
      setLoading(false)
    }
    load()
  }, [clinicId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Nome da clínica é obrigatório.'); return }
    setError('')
    setSaving(true)
    const supabase = createClient()
    const { error: err } = await supabase
      .from('clinics')
      .update({ name: name.trim(), cnpj: cnpj || null, phone: phone || null, address: address || null })
      .eq('id', clinicId)
    setSaving(false)
    if (err) { setError(`Erro ao salvar: ${err.message}`); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold text-[#111827]">Configurações da clínica</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="bg-white rounded-xl border border-[#E5E7EB] p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Nome da clínica *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              placeholder="Ex: Clínica Odontológica Anne"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">CNPJ</label>
            <input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              placeholder="00.000.000/0001-00"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Telefone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              placeholder="(11) 99999-0000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Endereço</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none"
              placeholder="Rua, número, bairro, cidade — SP"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex items-center justify-between pt-2">
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                <CheckCircle2 className="w-4 h-4" /> Salvo com sucesso
              </span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="ml-auto h-10 px-6 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
