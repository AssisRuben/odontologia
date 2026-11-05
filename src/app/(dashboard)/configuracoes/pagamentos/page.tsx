'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import AsaasBanner from '@/components/pagamentos/AsaasBanner'

type Environment = 'sandbox' | 'production'

type Connection =
  | { connected: false }
  | {
      connected: true
      environment: Environment
      accountName: string | null
      apiKeyLast4: string
      status: 'connected' | 'invalid_key'
      fine_percent: number
      interest_percent_month: number
      nfse_auto: boolean
      nfse_description: string | null
      nfse_service_code: string | null
      nfse_iss_rate: number | null
      fiscal: { configured: boolean; missing: string[] } | null
    }

const ASAAS_URL: Record<Environment, string> = {
  production: 'https://www.asaas.com/',
  sandbox: 'https://sandbox.asaas.com/',
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'
const errCls = 'text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2'
const primaryBtn = 'h-10 px-5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50'

function toNumber(v: string): number {
  return Number(v.trim().replace(',', '.'))
}
function fmt(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',')
}

export default function PagamentosConfigPage() {
  const { clinicId } = useClinicStore()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [conn, setConn] = useState<Connection | null>(null)
  const [loadError, setLoadError] = useState('')

  // Conexão
  const [apiKey, setApiKey] = useState('')
  const [environment, setEnvironment] = useState<Environment>('sandbox')
  const [replacing, setReplacing] = useState(false)
  const [connBusy, setConnBusy] = useState(false)
  const [connError, setConnError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  // Configurações
  const [fine, setFine] = useState('')
  const [interest, setInterest] = useState('')
  const [nfseAuto, setNfseAuto] = useState(false)
  const [nfseDescription, setNfseDescription] = useState('')
  const [nfseCode, setNfseCode] = useState('')
  const [nfseIss, setNfseIss] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  // CNPJ da clínica
  const [hasCnpj, setHasCnpj] = useState<boolean | null>(null)

  const applyConnection = useCallback((data: Connection) => {
    setConn(data)
    if (data.connected) {
      setEnvironment(data.environment)
      setFine(fmt(data.fine_percent))
      setInterest(fmt(data.interest_percent_month))
      setNfseAuto(data.nfse_auto)
      setNfseDescription(data.nfse_description ?? '')
      setNfseCode(data.nfse_service_code ?? '')
      setNfseIss(fmt(data.nfse_iss_rate))
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/payments/connection', { cache: 'no-store' })
      const data = await res.json().catch(() => ({})) as Connection & { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setLoadError(data.error || 'Não foi possível carregar a conexão.')
        return
      }
      setLoadError('')
      applyConnection(data)
    } catch {
      if (mounted.current) setLoadError('Não foi possível carregar a conexão. Verifique sua conexão.')
    }
  }, [applyConnection])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    if (!clinicId) return
    async function loadCnpj() {
      const supabase = createClient()
      const { data } = await supabase.from('clinics').select('cnpj').eq('id', clinicId).single()
      if (mounted.current) setHasCnpj(!!(data?.cnpj && String(data.cnpj).replace(/\D/g, '')))
    }
    loadCnpj()
  }, [clinicId])

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) { setConnError('Informe a chave de API do Asaas.'); return }
    setConnBusy(true)
    setConnError('')
    try {
      const res = await fetch('/api/payments/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), environment }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setConnError(data.error || 'Não foi possível conectar o Asaas.')
      } else {
        setApiKey('')
        setReplacing(false)
        await load()
      }
    } catch {
      if (mounted.current) setConnError('Não foi possível conectar o Asaas. Verifique sua conexão.')
    }
    if (mounted.current) setConnBusy(false)
  }

  async function handleDisconnect() {
    setConnBusy(true)
    setConnError('')
    try {
      const res = await fetch('/api/payments/connection', { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setConnError(data.error || 'Não foi possível desconectar.')
      } else {
        setConfirmDisconnect(false)
        setReplacing(false)
        setConn({ connected: false })
      }
    } catch {
      if (mounted.current) setConnError('Não foi possível desconectar. Verifique sua conexão.')
    }
    if (mounted.current) setConnBusy(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    const body: Record<string, unknown> = {}
    const fineN = toNumber(fine || '0')
    const interestN = toNumber(interest || '0')
    if (!Number.isFinite(fineN) || !Number.isFinite(interestN)) {
      setSaveError('Informe valores numéricos para multa e juros.')
      return
    }
    body.fine_percent = fineN
    body.interest_percent_month = interestN
    if (hasCnpj) {
      body.nfse_auto = nfseAuto
      body.nfse_description = nfseDescription.trim() || null
      body.nfse_service_code = nfseCode.trim() || null
      if (nfseIss.trim()) {
        const iss = toNumber(nfseIss)
        if (!Number.isFinite(iss)) { setSaveError('Informe um valor numérico para o ISS.'); return }
        body.nfse_iss_rate = iss
      } else {
        body.nfse_iss_rate = null
      }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/payments/connection', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setSaveError(data.error || 'Não foi possível salvar.')
      } else {
        setSaved(true)
        setTimeout(() => { if (mounted.current) setSaved(false) }, 2500)
        await load()
      }
    } catch {
      if (mounted.current) setSaveError('Não foi possível salvar. Verifique sua conexão.')
    }
    if (mounted.current) setSaving(false)
  }

  const connected = conn?.connected ? conn : null
  const showKeyForm = conn !== null && (!conn.connected || replacing)

  return (
    <div>
      <AsaasBanner />
      <div className="p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-semibold text-[#111827]">Pagamentos</h1>
        </div>

        {loadError && <p className={`${errCls} mb-4`}>{loadError}</p>}

        {conn === null && !loadError ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conn !== null && (
          <div className="space-y-4">
            {/* Conexão */}
            <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
              <p className="text-sm font-semibold text-[#111827]">Conexão com o Asaas</p>

              {connected && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex items-center gap-1.5 text-[#10B981] font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      Conectado · conta {connected.accountName ?? '—'} · chave final ...{connected.apiKeyLast4}
                    </span>
                    {connected.environment === 'sandbox' && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">Teste</span>
                    )}
                  </div>
                  {connected.status === 'invalid_key' && (
                    <p className="text-sm text-amber-800">A chave não é mais válida. Use &quot;Trocar chave&quot; para reconectar.</p>
                  )}
                </div>
              )}

              {showKeyForm && (
                <form onSubmit={handleConnect} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-[#111827] mb-1">Ambiente</label>
                    <select value={environment} onChange={e => setEnvironment(e.target.value as Environment)}
                      disabled={connBusy} className={inputCls}>
                      <option value="sandbox">Teste (sandbox)</option>
                      <option value="production">Produção</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#111827] mb-1">Chave de API</label>
                    <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                      autoComplete="off" placeholder="Cole aqui a chave de API do Asaas"
                      disabled={connBusy} className={inputCls} />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={connBusy} className={primaryBtn}>
                      {connBusy ? 'Conectando...' : connected ? 'Salvar nova chave' : 'Conectar Asaas'}
                    </button>
                    {connected && (
                      <button type="button" disabled={connBusy}
                        onClick={() => { setReplacing(false); setApiKey(''); setConnError('') }}
                        className="h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50">
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              )}

              {connected && !replacing && (
                confirmDisconnect ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm text-red-700">
                      Desconectar o Asaas? Cobranças em aberto continuam no Asaas, mas o app deixa de acompanhá-las.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleDisconnect} disabled={connBusy}
                        className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                        {connBusy ? 'Desconectando...' : 'Sim, desconectar'}
                      </button>
                      <button type="button" onClick={() => setConfirmDisconnect(false)} disabled={connBusy}
                        className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-sm text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" disabled={connBusy}
                      onClick={() => { setReplacing(true); setConnError('') }}
                      className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-sm text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50">
                      Trocar chave
                    </button>
                    <button type="button" disabled={connBusy} onClick={() => setConfirmDisconnect(true)}
                      className="h-9 px-4 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50">
                      Desconectar
                    </button>
                  </div>
                )
              )}

              {connError && <p className={errCls}>{connError}</p>}
            </div>

            {connected && (
              <form onSubmit={handleSave} className="space-y-4">
                {/* Multa e juros */}
                <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
                  <p className="text-sm font-semibold text-[#111827]">Multa e juros por atraso</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-[#111827] mb-1">Multa (%)</label>
                      <input type="text" inputMode="decimal" value={fine} onChange={e => setFine(e.target.value)} className={inputCls} />
                      <p className="text-xs text-[#6B7280] mt-1">De 0 a 2%.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[#111827] mb-1">Juros ao mês (%)</label>
                      <input type="text" inputMode="decimal" value={interest} onChange={e => setInterest(e.target.value)} className={inputCls} />
                      <p className="text-xs text-[#6B7280] mt-1">De 0 a 1%.</p>
                    </div>
                  </div>
                </div>

                {/* Nota fiscal */}
                <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
                  <p className="text-sm font-semibold text-[#111827]">Nota fiscal (NFS-e)</p>

                  {hasCnpj === false ? (
                    <p className="text-sm text-[#6B7280]">Nota fiscal de serviço é para clínicas com CNPJ</p>
                  ) : hasCnpj === null ? (
                    <p className="text-sm text-[#6B7280]">Carregando...</p>
                  ) : (
                    <>
                      {connected.fiscal === null ? (
                        <p className="text-sm text-[#6B7280]">Não foi possível consultar a configuração fiscal agora</p>
                      ) : connected.fiscal.configured ? (
                        <p className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                          Nota fiscal: configurada <CheckCircle2 className="w-4 h-4" />
                        </p>
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2 text-sm text-amber-800">
                          <p className="font-medium">Falta configurar a nota fiscal no Asaas</p>
                          {connected.fiscal.missing.length > 0 && (
                            <ul className="list-disc pl-5">
                              {connected.fiscal.missing.map(m => <li key={m}>{m}</li>)}
                            </ul>
                          )}
                          <a href={ASAAS_URL[connected.environment]} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium underline">
                            Abrir o painel do Asaas <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-[#111827] mb-1">Descrição padrão do serviço</label>
                        <input type="text" value={nfseDescription} onChange={e => setNfseDescription(e.target.value)} className={inputCls} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-[#111827] mb-1">Código do serviço</label>
                          <input type="text" value={nfseCode} onChange={e => setNfseCode(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-[#111827] mb-1">ISS (%)</label>
                          <input type="text" inputMode="decimal" value={nfseIss} onChange={e => setNfseIss(e.target.value)} className={inputCls} />
                          <p className="text-xs text-[#6B7280] mt-1">De 0 a 5%.</p>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-[#111827]">
                        <input type="checkbox" checked={nfseAuto} onChange={e => setNfseAuto(e.target.checked)}
                          className="w-4 h-4 rounded border-[#E5E7EB]" />
                        Emitir automaticamente ao receber
                      </label>
                    </>
                  )}
                </div>

                {saveError && <p className={errCls}>{saveError}</p>}

                <div className="flex items-center justify-between pt-1">
                  {saved && (
                    <span className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                      <CheckCircle2 className="w-4 h-4" /> Configurações salvas
                    </span>
                  )}
                  <button type="submit" disabled={saving || connBusy} className={`ml-auto px-6 ${primaryBtn}`}>
                    {saving ? 'Salvando...' : 'Salvar configurações'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
