'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { TreatmentStatus } from '@/types'

// ─── FDI quadrant arrays ──────────────────────────────────────────────────────
const UP_R_P = [18, 17, 16, 15, 14, 13, 12, 11]
const UP_L_P = [21, 22, 23, 24, 25, 26, 27, 28]
const LO_R_P = [48, 47, 46, 45, 44, 43, 42, 41]
const LO_L_P = [31, 32, 33, 34, 35, 36, 37, 38]
const UP_R_D = [55, 54, 53, 52, 51]
const UP_L_D = [61, 62, 63, 64, 65]
const LO_R_D = [85, 84, 83, 82, 81]
const LO_L_D = [71, 72, 73, 74, 75]

// ─── Types ────────────────────────────────────────────────────────────────────
type FaceKey = 'V' | 'M' | 'O' | 'D' | 'L'
const ALL_FACES: FaceKey[] = ['V', 'M', 'O', 'D', 'L']

type FaceStatus = Partial<Record<FaceKey, TreatmentStatus>>
type FaceMap    = Record<number, FaceStatus>

interface ToothDetail {
  procedure: string
  status: TreatmentStatus
  date?: string
  faces: string[]
}
type DetailMap = Record<number, ToothDetail[]>

const PRIORITY: Record<TreatmentStatus, number> = {
  completed: 4, in_progress: 3, planned: 2, cancelled: 0,
}

function mergeBest(cur: TreatmentStatus | undefined, next: TreatmentStatus): TreatmentStatus {
  if (!cur) return next
  return PRIORITY[next] > PRIORITY[cur] ? next : cur
}

function bestStatus(fd: FaceStatus | undefined): TreatmentStatus | null {
  if (!fd) return null
  const vals = Object.values(fd) as TreatmentStatus[]
  if (!vals.length) return null
  return vals.reduce((b, s) => (PRIORITY[s] > PRIORITY[b] ? s : b))
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const FACE_FILL: Record<string, string> = {
  completed: '#BBF7D0', in_progress: '#FED7AA', planned: '#BFDBFE', _: '#F8FAFC',
}
const FACE_STROKE: Record<string, string> = {
  completed: '#22C55E', in_progress: '#F97316', planned: '#3B82F6', _: '#D1D5DB',
}
const STATUS_LABEL: Record<TreatmentStatus, string> = {
  completed: 'Concluído', in_progress: 'Em andamento', planned: 'Planejado', cancelled: 'Cancelado',
}
const STATUS_COLOR: Record<TreatmentStatus, string> = {
  completed: '#16A34A', in_progress: '#EA580C', planned: '#2563EB', cancelled: '#DC2626',
}

function ff(s: TreatmentStatus | undefined) { return FACE_FILL[s ?? '_'] ?? FACE_FILL._ }
function fs(s: TreatmentStatus | undefined) { return FACE_STROKE[s ?? '_'] ?? FACE_STROKE._ }

// ─── Circular 5-face diagram ──────────────────────────────────────────────────
// viewBox 0 0 24 24, center (12,12), r=11
// Diagonal points at 45°: (4.22,4.22) (19.78,4.22) (19.78,19.78) (4.22,19.78)

function FaceDisk({ fd, size = 30 }: { fd: FaceStatus | undefined; size?: number }) {
  const f = (k: FaceKey) => ff(fd?.[k])
  const s = (k: FaceKey) => fs(fd?.[k])
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="11.5" fill="white" stroke="#D1D5DB" strokeWidth="0.8" />
      {/* V – vestibular (top) */}
      <path d="M12,12 L4.22,4.22 A11,11 0 0,1 19.78,4.22 Z" fill={f('V')} stroke={s('V')} strokeWidth="0.5" />
      {/* D – distal (right) */}
      <path d="M12,12 L19.78,4.22 A11,11 0 0,1 19.78,19.78 Z" fill={f('D')} stroke={s('D')} strokeWidth="0.5" />
      {/* L – lingual (bottom) */}
      <path d="M12,12 L19.78,19.78 A11,11 0 0,1 4.22,19.78 Z" fill={f('L')} stroke={s('L')} strokeWidth="0.5" />
      {/* M – mesial (left) */}
      <path d="M12,12 L4.22,19.78 A11,11 0 0,1 4.22,4.22 Z" fill={f('M')} stroke={s('M')} strokeWidth="0.5" />
      {/* O – oclusal (center) */}
      <circle cx="12" cy="12" r="4.8" fill={f('O')} stroke={s('O')} strokeWidth="0.5" />
    </svg>
  )
}

// ─── Single tooth button ──────────────────────────────────────────────────────

function ToothBtn({ num, fd, hasTreat, upper, onClick }: {
  num: number
  fd: FaceStatus | undefined
  hasTreat: boolean
  upper: boolean
  onClick: () => void
}) {
  const best = bestStatus(fd)
  const ringColor = best ? STATUS_COLOR[best] : '#E2E8F0'
  const numColor  = hasTreat ? STATUS_COLOR[best!] : '#94A3B8'

  return (
    <button
      onClick={onClick}
      title={`Dente ${num}`}
      className="flex flex-col items-center gap-[3px] p-[3px] rounded hover:bg-gray-100 active:scale-95 transition-transform focus:outline-none"
    >
      {upper ? (
        <>
          <FaceDisk fd={fd} />
          <span className="text-[9px] font-bold leading-none" style={{ color: numColor }}>{num}</span>
        </>
      ) : (
        <>
          <span className="text-[9px] font-bold leading-none" style={{ color: numColor }}>{num}</span>
          <FaceDisk fd={fd} />
        </>
      )}
      {/* status dot */}
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ringColor }} />
    </button>
  )
}

// ─── Arch row ─────────────────────────────────────────────────────────────────

function ArchRow({ teeth, faceMap, upper, onTooth }: {
  teeth: number[]
  faceMap: FaceMap
  upper: boolean
  onTooth: (n: number) => void
}) {
  return (
    <div className={`flex items-${upper ? 'end' : 'start'} gap-0`}>
      {teeth.map(n => (
        <ToothBtn
          key={n} num={n}
          fd={faceMap[n]}
          hasTreat={!!faceMap[n] && Object.keys(faceMap[n]).length > 0}
          upper={upper}
          onClick={() => onTooth(n)}
        />
      ))}
    </div>
  )
}

const VSep = () => <div className="self-stretch mx-1 border-l border-dashed border-[#E5E7EB]" />

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ num, details, onClose }: {
  num: number
  details: ToothDetail[]
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-xl shadow-xl w-72 p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-[#111827]">Dente {num}</p>
          <button onClick={onClose} className="p-1 rounded text-[#6B7280] hover:text-[#111827]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2">
          {details.map((d, i) => (
            <div key={i} className="p-2.5 rounded-lg bg-[#F9FAFB] border border-[#F3F4F6]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[d.status] }} />
                <span className="text-xs font-semibold text-[#111827]">{d.procedure}</span>
              </div>
              <div className="flex gap-2 mt-1 ml-4">
                <span className="text-[10px]" style={{ color: STATUS_COLOR[d.status] }}>{STATUS_LABEL[d.status]}</span>
                {d.faces.length > 0 && (
                  <span className="text-[10px] text-[#9CA3AF]">· {d.faces.join(', ')}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface OdontogramaProps {
  patientId: string
  clinicId: string
  refreshKey?: number
}

export function Odontograma({ patientId, refreshKey }: OdontogramaProps) {
  const [mode, setMode]       = useState<'permanentes' | 'deciduos'>('permanentes')
  const [faceMap, setFaceMap] = useState<FaceMap>({})
  const [detailMap, setDetailMap] = useState<DetailMap>({})
  const [selected, setSelected]   = useState<number | null>(null)
  const [localTick, setLocalTick] = useState(0)

  useEffect(() => {
    const h = () => setLocalTick(n => n + 1)
    window.addEventListener('odontoRefresh', h)
    return () => window.removeEventListener('odontoRefresh', h)
  }, [])

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: treats } = await supabase
        .from('treatments')
        .select('id, procedure, status, date')
        .eq('patient_id', patientId)

      if (!treats?.length) { setFaceMap({}); setDetailMap({}); return }

      const ids = treats.map(t => t.id)
      const { data: rows } = await supabase
        .from('treatment_teeth')
        .select('treatment_id, tooth_number, faces')
        .in('treatment_id', ids)

      const treatMap = new Map(treats.map(t => [t.id, t]))
      const fm: FaceMap = {}
      const dm: DetailMap = {}

      for (const row of (rows || [])) {
        const t = treatMap.get(row.treatment_id)
        if (!t) continue
        const n = row.tooth_number
        const status = t.status as TreatmentStatus
        const raw: string[] = Array.isArray(row.faces) ? row.faces : []
        const faces = raw.length === 0 || raw.includes('T')
          ? ALL_FACES
          : raw.filter((f): f is FaceKey => (ALL_FACES as string[]).includes(f))

        if (!fm[n]) fm[n] = {}
        for (const face of faces) {
          fm[n][face] = mergeBest(fm[n][face], status)
        }

        if (!dm[n]) dm[n] = []
        dm[n].push({ procedure: t.procedure, status, date: t.date, faces: raw.length ? raw : ['T'] })
      }

      setFaceMap(fm)
      setDetailMap(dm)
    }
    load()
  }, [patientId, refreshKey, localTick]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleClick(n: number) {
    if (detailMap[n]?.length) setSelected(n)
  }

  const [upR, upL, loR, loL] = mode === 'permanentes'
    ? [UP_R_P, UP_L_P, LO_R_P, LO_L_P]
    : [UP_R_D, UP_L_D, LO_R_D, LO_L_D]

  return (
    <div>
      {/* Toggle */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex rounded-lg border border-[#E5E7EB] overflow-hidden">
          {(['permanentes', 'deciduos'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m ? 'bg-[#3B82F6] text-white' : 'bg-white text-[#6B7280] hover:bg-[#F3F4F6]'
              }`}>
              {m === 'permanentes' ? 'Permanentes' : 'Decíduos'}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[#9CA3AF]">Clique num dente colorido para ver detalhes</span>
      </div>

      {/* Chart */}
      <div className="overflow-x-auto">
        <div className="flex flex-col items-center gap-1 min-w-fit mx-auto select-none">
          {/* Superior */}
          <div className="flex items-end">
            <ArchRow teeth={upR} faceMap={faceMap} upper onTooth={handleClick} />
            <VSep />
            <ArchRow teeth={upL} faceMap={faceMap} upper onTooth={handleClick} />
          </div>
          {/* Linha midline */}
          <div className="w-full flex items-center gap-1 my-1">
            <div className="flex-1 border-t border-dashed border-[#E5E7EB]" />
            <span className="text-[9px] text-[#CBD5E1] px-1">Superior · Inferior</span>
            <div className="flex-1 border-t border-dashed border-[#E5E7EB]" />
          </div>
          {/* Inferior */}
          <div className="flex items-start">
            <ArchRow teeth={loR} faceMap={faceMap} upper={false} onTooth={handleClick} />
            <VSep />
            <ArchRow teeth={loL} faceMap={faceMap} upper={false} onTooth={handleClick} />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 justify-center">
        {(Object.entries(STATUS_COLOR) as [TreatmentStatus, string][]).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1.5 text-xs text-[#6B7280]">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: c }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-[#6B7280]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#E2E8F0] inline-block" />
          Sem tratamento
        </span>
      </div>

      {/* Face legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 mt-2">
        {(['V','M','O','D','L'] as FaceKey[]).map(k => (
          <span key={k} className="text-[9px] text-[#9CA3AF]">
            <b>{k}</b>={({'V':'Vestibular','M':'Mesial','O':'Oclusal','D':'Distal','L':'Lingual'})[k]}
          </span>
        ))}
      </div>

      {selected !== null && detailMap[selected] && (
        <DetailPanel
          num={selected}
          details={detailMap[selected]}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
