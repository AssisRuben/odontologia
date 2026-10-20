'use client'

import { useState, useEffect } from 'react'
import { X, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Patient, InsurancePlan } from '@/types'

interface Props {
  open: boolean
  patient: Patient
  onClose: () => void
  onSaved: (updated: Patient) => void
}

const GENDER_OPTIONS = [
  { value: '', label: 'Não informado' },
  { value: 'M', label: 'Masculino' },
  { value: 'F', label: 'Feminino' },
  { value: 'O', label: 'Outro' },
]

export function ModalEditarPaciente({ open, patient, onClose, onSaved }: Props) {
  const [name, setName]           = useState('')
  const [cpf, setCpf]             = useState('')
  const [phone, setPhone]         = useState('')
  const [whatsapp, setWhatsapp]   = useState('')
  const [email, setEmail]         = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [gender, setGender]       = useState('')
  const [planId, setPlanId]       = useState('')
  const [street, setStreet]       = useState('')
  const [number, setNumber]       = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity]           = useState('')
  const [state, setState]         = useState('')
  const [zip, setZip]             = useState('')
  const [plans, setPlans]         = useState<InsurancePlan[]>([])
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    if (!open) return
    setName(patient.name || '')
    setCpf(patient.cpf || '')
    setPhone(patient.phone || '')
    setWhatsapp(patient.whatsapp || '')
    setEmail(patient.email || '')
    setBirthdate(patient.birthdate || '')
    setGender(patient.gender || '')
    setPlanId(patient.insurance_plan_id || '')
    setStreet(patient.address?.street || '')
    setNumber(patient.address?.number || '')
    setNeighborhood(patient.address?.neighborhood || '')
    setCity(patient.address?.city || '')
    setState(patient.address?.state || '')
    setZip(patient.address?.zip || '')
    setSaved(false)
    setError('')

    const supabase = createClient()
    supabase.from('insurance_plans').select('*').eq('clinic_id', patient.clinic_id).order('name')
      .then(({ data }) => { if (data) setPlans(data) })
  }, [open, patient])

  if (!open) return null

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Nome é obrigatório.'); return }
    setError('')
    setSaving(true)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('patients')
      .update({
        name: name.trim(),
        cpf: cpf || null,
        phone: phone || null,
        whatsapp: whatsapp || null,
        email: email || null,
        birthdate: birthdate || null,
        gender: gender || null,
        insurance_plan_id: planId || null,
        address: { street, number, neighborhood, city, state, zip },
      })
      .eq('id', patient.id)
      .select('*, insurance_plan:insurance_plans(*)')
      .single()
    setSaving(false)
    if (err) { setError(`Erro: ${err.message}`); return }
    setSaved(true)
    setTimeout(() => { onSaved(data as Patient); onClose() }, 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[92vh] overflow-y-auto">

        {saved && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white rounded-xl gap-3">
            <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-base font-semibold text-[#111827]">Dados salvos!</p>
          </div>
        )}

        <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111827]">Editar paciente</h2>
          <button onClick={onClose} className="p-1 rounded text-[#9CA3AF] hover:text-[#374151]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-5">
          {/* Dados pessoais */}
          <section>
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">Dados pessoais</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[#111827] mb-1">Nome completo *</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">CPF</label>
                  <input value={cpf} onChange={e => setCpf(e.target.value)} placeholder="000.000.000-00"
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Data de nascimento</label>
                  <input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Gênero</label>
                  <select value={gender} onChange={e => setGender(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white">
                    {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Convênio</label>
                  <select value={planId} onChange={e => setPlanId(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white">
                    <option value="">Particular</option>
                    {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Contato */}
          <section>
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">Contato</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Telefone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-0000"
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">WhatsApp</label>
                  <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(11) 99999-0000"
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111827] mb-1">E-mail</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="paciente@email.com"
                  className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
              </div>
            </div>
          </section>

          {/* Endereço */}
          <section>
            <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">Endereço</p>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#111827] mb-1">Rua</label>
                  <input value={street} onChange={e => setStreet(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Número</label>
                  <input value={number} onChange={e => setNumber(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Bairro</label>
                  <input value={neighborhood} onChange={e => setNeighborhood(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">CEP</label>
                  <input value={zip} onChange={e => setZip(e.target.value)} placeholder="00000-000"
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[#111827] mb-1">Cidade</label>
                  <input value={city} onChange={e => setCity(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">UF</label>
                  <input value={state} onChange={e => setState(e.target.value)} maxLength={2} placeholder="SP"
                    className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] uppercase" />
                </div>
              </div>
            </div>
          </section>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#E5E7EB] text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6]">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 h-10 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
