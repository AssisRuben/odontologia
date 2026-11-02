'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

type ConnStatus = 'disconnected' | 'connecting' | 'connected'

const POLL_MS = 3000
const QR_REFRESH_MS = 40000
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** 5511987654321 -> (11) 98765-4321 */
function formatPhone(raw: string | null): string {
  if (!raw) return ''
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return raw
}

function qrSrc(qr: string): string {
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`
}

function validateConfig(start: string, end: string, limit: string): string | null {
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return 'Informe os horários no formato HH:mm (ex.: 08:00).'
  if (start >= end) return 'O horário de início deve ser anterior ao horário de fim.'
  if (!/^\d+$/.test(limit.trim())) return 'O limite diário deve ser um número inteiro.'
  const n = Number(limit)
  if (n < 1 || n > 1000) return 'O limite diário deve estar entre 1 e 1000.'
  return null
}

export default function MensagensConfigPage() {
  const { clinicId } = useClinicStore()

  // Conexão
  const [status, setStatus] = useState<ConnStatus>('disconnected')
  const [phone, setPhone] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [connLoading, setConnLoading] = useState(true)
  const [connBusy, setConnBusy] = useState(false)
  const [connError, setConnError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  // Configuração de envio
  const [windowStart, setWindowStart] = useState('08:00')
  const [windowEnd, setWindowEnd] = useState('20:00')
  const [dailyLimit, setDailyLimit] = useState('300')
  const [cfgLoading, setCfgLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cfgError, setCfgError] = useState('')

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/status', { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const data = await res.json() as { status: ConnStatus; phone: string | null }
      if (!mounted.current) return
      setStatus(data.status)
      setPhone(data.phone)
      if (data.status !== 'connecting') setQrCode(null)
    } catch {
      /* mantém o último estado conhecido */
    } finally {
      if (mounted.current) setConnLoading(false)
    }
  }, [])

  const requestQr = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/whatsapp/connect', { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { status?: ConnStatus; qrCode?: string | null; error?: string }
      if (!mounted.current) return false
      if (!res.ok) {
        setConnError(data.error || 'Não foi possível gerar o QR Code.')
        return false
      }
      setConnError('')
      setStatus(data.status ?? 'connecting')
      setQrCode(data.qrCode ?? null)
      return true
    } catch {
      if (mounted.current) setConnError('Não foi possível gerar o QR Code. Verifique sua conexão.')
      return false
    }
  }, [])

  // Status inicial
  useEffect(() => {
    const t = setTimeout(fetchStatus, 0)
    return () => clearTimeout(t)
  }, [fetchStatus])

  // Polling enquanto conectando + novo QR a cada 40 s
  useEffect(() => {
    if (status !== 'connecting') return
    const poll = setInterval(fetchStatus, POLL_MS)
    const refresh = setInterval(requestQr, QR_REFRESH_MS)
    return () => { clearInterval(poll); clearInterval(refresh) }
  }, [status, fetchStatus, requestQr])

  // Config de envio
  useEffect(() => {
    if (!clinicId) return
    async function load() {
      const supabase = createClient()
      const { data } = await supabase.from('clinics').select('messaging_config').eq('id', clinicId).single()
      const cfg = data?.messaging_config as { window_start?: string; window_end?: string; daily_limit?: number } | null
      if (cfg) {
        if (cfg.window_start) setWindowStart(cfg.window_start.slice(0, 5))
        if (cfg.window_end) setWindowEnd(cfg.window_end.slice(0, 5))
        if (cfg.daily_limit != null) setDailyLimit(String(cfg.daily_limit))
      }
      setCfgLoading(false)
    }
    load()
  }, [clinicId])

  async function handleConnect() {
    setConnBusy(true)
    setConnError('')
    await requestQr()
    if (mounted.current) setConnBusy(false)
  }

  async function handleDisconnect() {
    setConnBusy(true)
    setConnError('')
    try {
      const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setConnError(data.error || 'Não foi possível desconectar.')
      } else {
        setStatus('disconnected')
        setQrCode(null)
        setConfirmDisconnect(false)
      }
    } catch {
      if (mounted.current) setConnError('Não foi possível desconectar. Verifique sua conexão.')
    }
    if (mounted.current) setConnBusy(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setCfgError('')
    const invalid = validateConfig(windowStart, windowEnd, dailyLimit)
    if (invalid) { setCfgError(invalid); return }
    setSaving(true)
    const supabase = createClient()
    const { data: current, error: readErr } = await supabase
      .from('clinics').select('messaging_config').eq('id', clinicId).single()
    if (readErr) { setSaving(false); setCfgError(`Erro: ${readErr.message}`); return }
    const next = {
      ...((current?.messaging_config as Record<string, unknown> | null) ?? {}),
      window_start: windowStart,
      window_end: windowEnd,
      daily_limit: Number(dailyLimit),
    }
    const { error: err } = await supabase.from('clinics').update({ messaging_config: next }).eq('id', clinicId)
    setSaving(false)
    if (err) { setCfgError(`Erro: ${err.message}`); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold text-[#111827]">Configurações de mensagens</h1>
      </div>

      <div className="space-y-4">
        {/* WhatsApp */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#111827]">Conexão do WhatsApp</p>
          </div>

          {connLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : status === 'connected' ? (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Conectado{phone ? ` — ${formatPhone(phone)}` : ''}
              </p>
              {confirmDisconnect ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                  <p className="text-sm text-red-700">
                    Desconectar o WhatsApp? As mensagens automáticas deixarão de ser enviadas.
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleDisconnect} disabled={connBusy}
                      className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                      {connBusy ? 'Desconectando...' : 'Sim, desconectar'}
                    </button>
                    <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={connBusy}
                      className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-sm text-[#374151] hover:bg-[#F3F4F6]">
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDisconnect(true)}
                  className="h-9 px-4 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50">
                  Desconectar
                </button>
              )}
            </div>
          ) : status === 'connecting' ? (
            <div className="space-y-3">
              {qrCode ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrSrc(qrCode)} alt="QR Code do WhatsApp" className="w-56 h-56 border border-[#E5E7EB] rounded-lg" />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center border border-[#E5E7EB] rounded-lg">
                  <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <p className="text-sm text-[#374151]">
                Abra o WhatsApp no celular da clínica → Aparelhos conectados → Conectar aparelho
              </p>
              <p className="text-xs text-[#6B7280]">Aguardando leitura do QR Code. Ele é renovado automaticamente.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[#6B7280]">Desconectado. Conecte o WhatsApp da clínica para enviar mensagens automáticas.</p>
              <button type="button" onClick={handleConnect} disabled={connBusy}
                className="h-10 px-5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50">
                {connBusy ? 'Gerando QR Code...' : 'Conectar WhatsApp'}
              </button>
            </div>
          )}

          {connError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{connError}</p>}
        </div>

        {/* Envio */}
        {cfgLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
              <p className="text-sm font-semibold text-[#111827]">Horário de envio</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Início</label>
                  <input type="time" value={windowStart} onChange={e => setWindowStart(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#111827] mb-1">Fim</label>
                  <input type="time" value={windowEnd} onChange={e => setWindowEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#111827] mb-1">Limite diário</label>
                <input type="number" min={1} max={1000} step={1} value={dailyLimit}
                  onChange={e => setDailyLimit(e.target.value)} className={inputCls} />
                <p className="text-xs text-[#6B7280] mt-1">Máximo de mensagens enviadas por dia (1 a 1000).</p>
              </div>
            </div>

            {cfgError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{cfgError}</p>}

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
    </div>
  )
}
