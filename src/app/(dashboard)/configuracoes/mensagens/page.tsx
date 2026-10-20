'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

export default function MensagensConfigPage() {
  const { clinicId } = useClinicStore()
  const [whatsappKey, setWhatsappKey] = useState('')
  const [whatsappPhone, setWhatsappPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clinicId) return
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('clinics').select('whatsapp_key, whatsapp_phone').eq('id', clinicId).single()
      if (data) {
        setWhatsappKey(data.whatsapp_key || '')
        setWhatsappPhone(data.whatsapp_phone || '')
      }
      setLoading(false)
    }
    load()
  }, [clinicId])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase.from('clinics').update({
      whatsapp_key: whatsappKey || null,
      whatsapp_phone: whatsappPhone || null,
    }).eq('id', clinicId)
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
        <h1 className="text-xl font-semibold text-[#111827]">Configurações de mensagens</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {/* WhatsApp */}
          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-[#111827]">WhatsApp (Evolution API)</p>
            </div>
            <p className="text-xs text-[#6B7280] -mt-2">
              Configure sua instância da Evolution API para envio automático de mensagens.
            </p>

            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Chave da API</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={whatsappKey}
                  onChange={e => setWhatsappKey(e.target.value)}
                  placeholder="sua-chave-secreta"
                  className="w-full h-10 pl-3 pr-10 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] font-mono"
                />
                <button type="button" onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#374151]">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#111827] mb-1">Número de envio</label>
              <input
                type="text"
                value={whatsappPhone}
                onChange={e => setWhatsappPhone(e.target.value)}
                placeholder="5511999990000 (com DDI e DDD, sem caracteres)"
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
              />
            </div>
          </div>

          {/* Info box */}
          <div className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl p-4">
            <p className="text-sm font-medium text-[#1D4ED8] mb-1">Como configurar</p>
            <ol className="text-xs text-[#3B82F6] space-y-1 list-decimal list-inside">
              <li>Instale a Evolution API no seu servidor</li>
              <li>Crie uma instância e conecte seu WhatsApp</li>
              <li>Copie a API Key gerada e cole no campo acima</li>
              <li>Informe o número conectado no formato internacional</li>
            </ol>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                <CheckCircle2 className="w-4 h-4" /> Configurações salvas
              </span>
            )}
            <button type="submit" disabled={saving}
              className="ml-auto h-10 px-6 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
