'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { TZDate } from '@date-fns/tz'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { MessageKind, MessageStatus } from '@/lib/messaging/types'
import {
  DEFAULT_TZ, resolveTz, KIND_LABELS, PAGE_SIZE, REPLY_LABELS, STATUS_LABELS, STATUS_STYLES, errorLabel, formatWhatsAppPhone,
} from './helpers'

interface HistoryRow {
  id: string
  type: MessageKind
  status: MessageStatus
  body: string
  error: string | null
  reply_action: string | null
  sent_at: string | null
  created_at: string
  phone: string | null
  patients: { name: string } | { name: string }[] | null
}

const COLUMNS = 'id, type, status, body, error, reply_action, sent_at, created_at, phone, patients(name)'

/** Nome do paciente; sem paciente vinculado, o telefone formatado. */
function patientName(p: HistoryRow['patients'], phone: string | null): string {
  const name = p ? (Array.isArray(p) ? p[0]?.name : p.name) : undefined
  return name ?? (formatWhatsAppPhone(phone) || '—')
}

function formatWhen(iso: string, tz: string): string {
  return format(new TZDate(new Date(iso).getTime(), tz), 'dd/MM/yyyy HH:mm')
}

export default function TabHistorico() {
  const { clinicId } = useClinicStore()
  const [supabase] = useState(() => createClient())
  const [tz, setTz] = useState(DEFAULT_TZ)
  const [typeFilter, setTypeFilter] = useState<MessageKind | ''>('')
  const [statusFilter, setStatusFilter] = useState<MessageStatus | ''>('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [retrying, setRetrying] = useState<Set<string>>(new Set())
  const [rowError, setRowError] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!clinicId) return
    supabase.from('clinics').select('messaging_config').eq('id', clinicId).maybeSingle().then(({ data, error: err }) => {
      if (err) { setTz(DEFAULT_TZ); return }
      setTz(resolveTz((data?.messaging_config as { timezone?: string } | null)?.timezone))
    })
  }, [clinicId, supabase])

  useEffect(() => {
    if (!clinicId) return
    let cancelled = false
    async function run() {
      let q = supabase
        .from('messages')
        .select(COLUMNS, { count: 'exact' })
        .eq('clinic_id', clinicId)
      if (typeFilter) q = q.eq('type', typeFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      // supabase-js não ordena por coalesce(sent_at, created_at); usa created_at.
      const { data, error: err, count } = await q
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (cancelled) return
      if (err && err.code === 'PGRST103' && page > 0) {
        // página além do fim (a contagem diminuiu): volta para a última página existente
        let cq = supabase.from('messages').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId)
        if (typeFilter) cq = cq.eq('type', typeFilter)
        if (statusFilter) cq = cq.eq('status', statusFilter)
        const { count: c2, error: e2 } = await cq
        if (cancelled) return
        if (!e2) {
          setPage(Math.min(page - 1, Math.max(0, Math.ceil((c2 ?? 0) / PAGE_SIZE) - 1)))
          return
        }
      }
      if (err) {
        setError('Não foi possível carregar o histórico.')
        setRows([])
        setTotal(0)
      } else {
        setError(null)
        setRows((data ?? []) as unknown as HistoryRow[])
        setTotal(count ?? 0)
      }
      setLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [clinicId, supabase, typeFilter, statusFilter, page, reloadTick])

  async function retry(id: string) {
    setRetrying((s) => new Set(s).add(id))
    setRowError((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== id)))
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(id)}/retry`, { method: 'POST' })
      if (!res.ok) {
        setRowError((e) => ({
          ...e,
          [id]: res.status === 404 ? 'Esta mensagem não pode mais ser reenviada.' : 'Não foi possível reenviar. Tente novamente.',
        }))
      }
      setReloadTick((n) => n + 1)
    } catch {
      setRowError((e) => ({ ...e, [id]: 'Não foi possível reenviar. Tente novamente.' }))
    } finally {
      setRetrying((s) => { const n = new Set(s); n.delete(id); return n })
    }
  }

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const selectCls = 'px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-sm text-[#111827] bg-white'

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-3 mb-4">
        <select aria-label="Filtrar por tipo" value={typeFilter} className={selectCls}
          onChange={(e) => { setLoading(true); setTypeFilter(e.target.value as MessageKind | ''); setPage(0) }}>
          <option value="">Todos os tipos</option>
          {(Object.keys(KIND_LABELS) as MessageKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <select aria-label="Filtrar por status" value={statusFilter} className={selectCls}
          onChange={(e) => { setLoading(true); setStatusFilter(e.target.value as MessageStatus | ''); setPage(0) }}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABELS) as MessageStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F9FAFB] text-left text-[#6B7280]">
            <tr>
              <th className="px-4 py-2 font-medium">Data</th>
              <th className="px-4 py-2 font-medium">Paciente</th>
              <th className="px-4 py-2 font-medium">Tipo</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Mensagem</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const open = expanded.has(m.id)
              return (
                <tr key={m.id} className="border-t border-[#E5E7EB] align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-[#111827]">{formatWhen(m.sent_at ?? m.created_at, tz)}</td>
                  <td className="px-4 py-2 text-[#111827]">{patientName(m.patients, m.phone)}</td>
                  <td className="px-4 py-2 text-[#111827]">
                    {KIND_LABELS[m.type] ?? m.type}
                    {m.reply_action && REPLY_LABELS[m.reply_action] && (
                      <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700">{REPLY_LABELS[m.reply_action]}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[m.status]}`}>{STATUS_LABELS[m.status]}</span>
                    {m.status === 'failed' && m.error && <div className="mt-1 text-xs text-red-600 max-w-[14rem] break-words">{errorLabel(m.error)}</div>}
                    {m.status === 'cancelled' && m.error && <div className="mt-1 text-xs text-[#6B7280] max-w-[14rem] break-words">{errorLabel(m.error)}</div>}
                    {rowError[m.id] && <div className="mt-1 text-xs text-red-600 max-w-[14rem]">{rowError[m.id]}</div>}
                  </td>
                  <td className="px-4 py-2 text-[#6B7280] max-w-xs">
                    <div className={open ? 'whitespace-pre-wrap break-words' : 'truncate'}>{m.body}</div>
                    <button type="button" className="text-xs text-[#3B82F6] hover:underline"
                      onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}>
                      {open ? 'Recolher' : 'Expandir'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {m.status === 'failed' && (
                      <button type="button" disabled={retrying.has(m.id)} onClick={() => retry(m.id)}
                        className="px-3 py-1 rounded-lg text-xs font-medium border border-[#3B82F6] text-[#3B82F6] hover:bg-[#EFF6FF] disabled:opacity-50">
                        {retrying.has(m.id) ? 'Reenviando...' : 'Reenviar'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 && !error && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-[#9CA3AF]">Nenhuma mensagem encontrada.</td></tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-[#9CA3AF]">Carregando...</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm text-[#6B7280]">
        <span>{total} {total === 1 ? 'mensagem' : 'mensagens'}</span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={page === 0 || loading} onClick={() => { setLoading(true); setPage((p) => p - 1) }}
            className="px-3 py-1 border border-[#E5E7EB] rounded-lg disabled:opacity-50">Anterior</button>
          <span>Página {page + 1} de {lastPage + 1}</span>
          <button type="button" disabled={page >= lastPage || loading} onClick={() => { setLoading(true); setPage((p) => p + 1) }}
            className="px-3 py-1 border border-[#E5E7EB] rounded-lg disabled:opacity-50">Próxima</button>
        </div>
      </div>
    </div>
  )
}
