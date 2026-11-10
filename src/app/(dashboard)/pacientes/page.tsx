'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, Plus, Phone, Cake } from 'lucide-react'
import { parseISO, isThisMonth } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { getInitials, formatPhone } from '@/lib/utils'
import type { Patient } from '@/types'

const AVATAR_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899','#6366F1']
function getAvatarColor(name: string) {
  let h = 0
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

type Tab = 'buscar' | 'aniversariantes' | 'retornos'

export default function PacientesPage() {
  const { clinicId, loading: clinicLoading } = useClinicStore()
  const [patients, setPatients] = useState<Patient[]>([])
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('buscar')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  async function loadPatients(id: string) {
    const supabase = createClient()
    const { data } = await supabase
      .from('patients')
      .select('*, insurance_plan:insurance_plans(*)')
      .eq('clinic_id', id)
      .order('name')
    setPatients(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (clinicId) loadPatients(clinicId)
  }, [clinicId])

  const filtered = patients.filter((p) => {
    if (activeTab === 'aniversariantes') {
      if (!p.birthdate) return false
      return isThisMonth(parseISO(p.birthdate))
    }
    if (!search) return true
    const q = search.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.phone?.includes(q) || p.cpf?.includes(q)
  })

  const birthdayCount = patients.filter((p) => p.birthdate && isThisMonth(parseISO(p.birthdate))).length

  const tabs = [
    { id: 'buscar' as Tab, label: 'Buscar' },
    { id: 'aniversariantes' as Tab, label: 'Aniversariantes', count: birthdayCount },
    { id: 'retornos' as Tab, label: 'Retornos semestrais' },
  ]

  if (clinicLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="w-8 h-8 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Pacientes</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Cadastrar paciente</span>
          <span className="sm:hidden">Novo</span>
        </button>
      </div>

      <div className="border-b border-linha px-2 sm:px-6 overflow-x-auto">
        <div className="flex gap-0 min-w-max">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id ? 'border-petroleo text-petroleo' : 'border-transparent text-tinta-3 hover:text-tinta'
              }`}>
              {tab.label}
              {tab.count ? (
                <span className="bg-petroleo text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{tab.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-3 sm:px-6 pt-4 pb-4">
      <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl ring-1 ring-linha overflow-hidden">
      <div className="px-3 sm:px-4 py-3 border-b border-linha">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tinta-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, telefone ou CPF..."
            className="w-full pl-9 pr-4 h-9 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-petroleo border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="30" fill="#EEF2F2" />
              <path d="M32 20a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 18c8.84 0 16 3.58 16 8v2H16v-2c0-4.42 7.16-8 16-8z" fill="#CBD5D8" />
            </svg>
            <p className="text-sm text-tinta-3">Nenhum paciente encontrado</p>
            <button onClick={() => setShowForm(true)} className="text-sm text-petroleo font-medium hover:underline">
              Cadastrar primeiro paciente
            </button>
          </div>
        ) : (
          <div className="divide-y divide-linha">
            {filtered.map((patient) => (
              <Link key={patient.id} href={`/pacientes/${patient.id}`}
                className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-porcelana-2 transition-colors">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
                  style={{ backgroundColor: getAvatarColor(patient.name) }}>
                  {getInitials(patient.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-tinta text-sm truncate">{patient.name}</span>
                    {patient.insurance_plan && (
                      <span className="hidden sm:inline text-xs text-tinta-3">({patient.insurance_plan.name})</span>
                    )}
                    {patient.birthdate && isThisMonth(parseISO(patient.birthdate)) && (
                      <Cake className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-tinta-4 mt-0.5">
                    {patient.phone ? formatPhone(patient.phone) : 'Última consulta: —'}
                  </div>
                </div>
                {patient.phone && (
                  <div className="hidden sm:flex items-center gap-1.5 text-sm text-tinta-3 shrink-0">
                    <Phone className="w-3.5 h-3.5" />
                    <span>{formatPhone(patient.phone)}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
      </div>
      </div>

      {showForm && clinicId && (
        <FormCadastroPaciente
          clinicId={clinicId}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); loadPatients(clinicId) }}
        />
      )}
    </div>
  )
}

function FormCadastroPaciente({ clinicId, onClose, onSaved }: { clinicId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [cpf, setCpf] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [gender, setGender] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.from('patients').insert({ clinic_id: clinicId, name, phone, email, cpf, birthdate: birthdate || null, gender })
    if (err) { setError('Erro ao salvar paciente.'); setLoading(false); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-lg font-semibold">Cadastrar paciente</h2>
          <button onClick={onClose} className="text-tinta-3 hover:text-tinta">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-tinta mb-1">Nome *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Nome completo"
              className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Telefone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000"
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tinta mb-1">CPF</label>
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00"
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-tinta mb-1">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="paciente@email.com"
              className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Nascimento</label>
              <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Sexo</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo bg-white">
                <option value="">Selecione</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
                <option value="O">Outro</option>
              </select>
            </div>
          </div>
          {error && <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-linha text-sm text-tinta-3 hover:bg-porcelana">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
              {loading ? 'Salvando...' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
