'use client'

import { useState, useEffect, useRef } from 'react'
import { X, CheckCircle2, ImagePlus, Trash2, ChevronLeft, ChevronRight, Wand2, Undo2, Loader2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { createClient } from '@/lib/supabase/client'
import { BarraVoz } from '@/components/ia/BarraVoz'
import { ListaSugestoes } from '@/components/ia/ListaSugestoes'
import { useIaStatus } from '@/components/ia/useIaStatus'
import { appendText } from '@/lib/ia/texto'
import { dataRetorno, type Sugestao } from '@/lib/ia/evolucao/sugestoes'
import type { Appointment, Professional } from '@/types'

interface Evolution {
  id: string
  date: string
  description: string
  ai_used: boolean
  professional?: { name: string; color: string }
}

interface ModalEvolucaoProps {
  open: boolean
  appointment: Appointment
  professionals: Professional[]
  clinicId: string
  onClose: () => void
  onSaved: (retorno: { data: string; motivo: string } | null) => void
}

export function ModalEvolucao({ open, appointment, professionals, onClose, onSaved }: ModalEvolucaoProps) {
  const [professionalId, setProfessionalId] = useState(appointment.professional_id)
  const [date, setDate] = useState(format(parseISO(appointment.start_time), 'yyyy-MM-dd'))
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<{ file: File; preview: string }[]>([])
  const [pastEvolutions, setPastEvolutions] = useState<Evolution[]>([])
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [organizando, setOrganizando] = useState(false)
  const [textoOriginal, setTextoOriginal] = useState<string | null>(null)
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [marcadas, setMarcadas] = useState<boolean[]>([])
  const [aiUsed, setAiUsed] = useState(false)
  const { conectado } = useIaStatus()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setProfessionalId(appointment.professional_id)
    setDate(format(parseISO(appointment.start_time), 'yyyy-MM-dd'))
    setDescription('')
    setImages([])
    setLoading(false)
    setSuccess(false)
    setError('')
    setOrganizando(false)
    setTextoOriginal(null)
    setSugestoes([])
    setMarcadas([])
    setAiUsed(false)

    async function loadPast() {
      const supabase = createClient()
      const { data } = await supabase
        .from('evolutions')
        .select('*, professional:professionals(name, color)')
        .eq('patient_id', appointment.patient_id)
        .order('date', { ascending: false })
        .limit(6)
      if (data) setPastEvolutions(data)
    }
    loadPast()
  }, [open, appointment])

  if (!open) return null

  const patientName = appointment.patient?.name || 'Paciente'

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    const newImages = files.map((file) => ({ file, preview: URL.createObjectURL(file) }))
    setImages((prev) => [...prev, ...newImages])
    e.target.value = ''
  }

  function removeImage(index: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  function scrollSlider(dir: 'left' | 'right') {
    if (sliderRef.current) {
      sliderRef.current.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' })
    }
  }

  async function handleSave() {
    if (!description.trim()) {
      setError('Descreva a evolução antes de salvar.')
      return
    }
    setError('')
    setLoading(true)

    const escolhidas = sugestoes.filter((_, k) => marcadas[k])
    const retornoSug = escolhidas.find((x) => x.acao.tipo === 'retorno')
    const acoes = escolhidas.map((x) => x.acao).filter((a) => a.tipo !== 'retorno')

    let res: Response
    try {
      res = await fetch('/api/evolucoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: appointment.patient_id,
          appointmentId: appointment.id,
          professionalId,
          date,
          description: description.trim(),
          images: [],
          aiUsed,
          acoes,
        }),
      })
    } catch {
      setError('Erro ao salvar. Verifique a conexão e tente de novo.')
      setLoading(false)
      return
    }
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(typeof j.error === 'string' ? j.error : 'Erro ao salvar. Tente de novo.')
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
    const retorno =
      retornoSug && retornoSug.acao.tipo === 'retorno'
        ? { data: dataRetorno(date, retornoSug.acao.dias), motivo: retornoSug.acao.motivo }
        : null
    onSaved(retorno)
    setTimeout(onClose, 1500)
  }

  async function handleOrganizar() {
    setError('')
    setOrganizando(true)
    try {
      const res = await fetch('/api/ia/evolucao/organizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: appointment.patient_id, texto: description }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || typeof j.texto !== 'string') {
        setError(typeof j.error === 'string' ? j.error : 'Não foi possível organizar agora. Tente de novo.')
        return
      }
      const novas: Sugestao[] = Array.isArray(j.sugestoes) ? j.sugestoes : []
      setTextoOriginal(description)
      setDescription(j.texto)
      setSugestoes(novas)
      setMarcadas(novas.map(() => true))
      setAiUsed(true)
    } catch {
      setError('Não foi possível organizar agora. Tente de novo.')
    } finally {
      setOrganizando(false)
    }
  }

  function handleDesfazer() {
    if (textoOriginal === null) return
    setDescription(textoOriginal)
    setTextoOriginal(null)
    setSugestoes([])
    setMarcadas([])
    setAiUsed(false)
  }

  function toggleSugestao(i: number) {
    setMarcadas((prev) => prev.map((m, k) => (k === i ? !m : m)))
  }

  const nMarcadas = marcadas.filter(Boolean).length

  const selectedProf = professionals.find((p) => p.id === professionalId)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!success ? onClose : undefined} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[92vh] overflow-y-auto">

        {/* Sucesso */}
        {success && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white rounded-2xl gap-3">
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-green-500" />
            </div>
            <p className="text-base font-semibold text-[#111827]">Evolução registrada!</p>
            <p className="text-sm text-[#6B7280]">{patientName}</p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#E5E7EB]">
          <div>
            <p className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">Evolução clínica</p>
            <h2 className="text-lg font-bold text-[#111827] leading-tight">{patientName}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#374151] hover:bg-[#F3F4F6]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* Dentista (slider horizontal) */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-2">Dentista</label>
            <div className="relative flex items-center gap-1">
              {professionals.length > 3 && (
                <button
                  type="button"
                  onClick={() => scrollSlider('left')}
                  className="shrink-0 p-1 rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F3F4F6]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              <div
                ref={sliderRef}
                className="flex gap-2 overflow-x-auto flex-1 scroll-smooth"
                style={{ scrollbarWidth: 'none' }}
              >
                {professionals.map((prof) => {
                  const active = prof.id === professionalId
                  return (
                    <button
                      key={prof.id}
                      type="button"
                      onClick={() => setProfessionalId(prof.id)}
                      className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all"
                      style={{
                        borderColor: active ? prof.color : '#E5E7EB',
                        backgroundColor: active ? prof.color + '18' : 'white',
                        color: active ? prof.color : '#374151',
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: prof.color }}
                      />
                      {prof.name}
                    </button>
                  )
                })}
              </div>
              {professionals.length > 3 && (
                <button
                  type="button"
                  onClick={() => scrollSlider('right')}
                  className="shrink-0 p-1 rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F3F4F6]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Data */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">Data</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]"
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-sm font-medium text-[#111827] mb-1">
              Descreva a evolução do tratamento desse paciente
            </label>
            <div className="mb-2">
              <BarraVoz
                gravarDisponivel={conectado}
                onTexto={(t) => setDescription((d) => appendText(d, t))}
                disabled={loading || organizando}
              />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Paciente compareceu para limpeza. Foram realizados procedimentos de profilaxia e aplicação de flúor. Sem intercorrências..."
              rows={5}
              className="w-full px-3 py-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] resize-none"
            />
            {conectado && (description.trim() || textoOriginal !== null) && (
              <div className="flex flex-wrap gap-2 mt-2">
                {description.trim() && (
                  <button
                    type="button"
                    onClick={handleOrganizar}
                    disabled={organizando || loading}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#3B82F6] bg-[#EFF6FF] text-sm font-medium text-[#3B82F6] hover:bg-[#DBEAFE] disabled:opacity-50"
                  >
                    {organizando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {organizando ? 'Organizando…' : 'Organizar com IA'}
                  </button>
                )}
                {textoOriginal !== null && (
                  <button
                    type="button"
                    onClick={handleDesfazer}
                    disabled={organizando || loading}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-sm font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50"
                  >
                    <Undo2 className="w-4 h-4" /> Desfazer
                  </button>
                )}
              </div>
            )}
          </div>

          <ListaSugestoes sugestoes={sugestoes} marcadas={marcadas} onToggle={toggleSugestao} />

          {/* Upload de imagens */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-[#D1D5DB] text-sm text-[#6B7280] hover:border-[#3B82F6] hover:text-[#3B82F6] hover:bg-[#EFF6FF] transition-colors w-full justify-center"
            >
              <ImagePlus className="w-4 h-4" />
              Adicionar imagem
            </button>

            {images.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {images.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img.preview}
                      alt=""
                      className="w-20 h-20 object-cover rounded-lg border border-[#E5E7EB]"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {error}
            </div>
          )}

          {/* Salvar */}
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="w-full h-11 rounded-xl bg-[#3B82F6] text-white text-sm font-semibold hover:bg-[#2563EB] transition-colors disabled:opacity-50"
          >
            {loading ? 'Salvando...' : nMarcadas > 0 ? `Salvar e aplicar ${nMarcadas} ${nMarcadas === 1 ? 'sugestão' : 'sugestões'}` : 'Salvar'}
          </button>

          {/* Últimas evoluções */}
          {pastEvolutions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-3">
                Últimas evoluções
              </p>
              <div className="space-y-2">
                {pastEvolutions.map((ev) => {
                  const color = ev.professional?.color || '#6B7280'
                  return (
                    <div
                      key={ev.id}
                      className="flex items-start gap-3 p-3 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA]"
                    >
                      <div
                        className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#6B7280] mb-1">
                          {format(parseISO(ev.date), "d MMM yyyy", { locale: ptBR })}
                          {ev.professional && ` · ${ev.professional.name}`}
                        </p>
                        <p className="text-sm text-[#111827] leading-snug line-clamp-2">
                          {ev.description}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
