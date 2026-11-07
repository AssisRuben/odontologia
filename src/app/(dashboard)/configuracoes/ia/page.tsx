'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'

type Tier = 'economico' | 'caprichado'

interface View {
  conectado: boolean
  last4: string | null
  modelTier: Tier
  usoMes: { audioMinutes: number; transcricoes: number; evolucoes: number; anamneses: number; agente: number; transcricoesWhatsapp: number; estimatedUsd: number }
}

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'
const errCls = 'text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2'
const primaryBtn = 'h-10 px-5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50'

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR')
}

export default function IaConfigPage() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [view, setView] = useState<View | null>(null)
  const [loadError, setLoadError] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [tier, setTier] = useState<Tier>('economico')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ia/conexao', { cache: 'no-store' })
      const data = await res.json().catch(() => ({})) as View & { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setLoadError(data.error || 'Não foi possível carregar as configurações.')
        return
      }
      setLoadError('')
      setView(data)
      setTier(data.modelTier)
    } catch {
      if (mounted.current) setLoadError('Não foi possível carregar as configurações. Verifique sua conexão.')
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!view?.conectado && !apiKey.trim()) { setError('Informe a chave da OpenAI.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/ia/conexao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), modelTier: tier }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setError(data.error || 'Não foi possível salvar.')
      } else {
        setApiKey('')
        setSaved(true)
        setTimeout(() => { if (mounted.current) setSaved(false) }, 2500)
        await load()
      }
    } catch {
      if (mounted.current) setError('Não foi possível salvar. Verifique sua conexão.')
    }
    if (mounted.current) setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/ia/conexao', { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setError(data.error || 'Não foi possível remover a chave.')
      } else {
        setConfirmRemove(false)
        await load()
      }
    } catch {
      if (mounted.current) setError('Não foi possível remover a chave. Verifique sua conexão.')
    }
    if (mounted.current) setBusy(false)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold text-[#111827]">Inteligência artificial</h1>
      </div>

      {loadError && (
        <div role="alert" className={`${errCls} mb-4 flex items-center justify-between gap-3`}>
          <span>{loadError}</span>
          {view === null && (
            <button type="button" onClick={load}
              className="shrink-0 h-8 px-3 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-100">
              Tentar novamente
            </button>
          )}
        </div>
      )}

      {view === null && !loadError ? (
        <div className="flex justify-center py-8">
          <div className="w-7 h-7 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : view !== null && (
        <div className="space-y-4">
          <form onSubmit={handleSave} className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4">
            <p className="text-sm font-semibold text-[#111827]">Chave da OpenAI</p>

            {view.conectado && (
              <p className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Conectado · chave sk-…{view.last4}
              </p>
            )}

            <div>
              <label htmlFor="ia-chave" className="block text-sm font-medium text-[#111827] mb-1">
                {view.conectado ? 'Trocar a chave (opcional)' : 'Chave de API'}
              </label>
              <input id="ia-chave" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                autoComplete="off" placeholder="Cole aqui a chave da OpenAI"
                disabled={busy} className={inputCls} />
            </div>

            <div>
              <label htmlFor="ia-modelo" className="block text-sm font-medium text-[#111827] mb-1">Modelo para organizar</label>
              <select id="ia-modelo" value={tier} onChange={e => setTier(e.target.value as Tier)}
                disabled={busy} className={inputCls}>
                <option value="economico">Econômico (padrão)</option>
                <option value="caprichado">Mais caprichado</option>
              </select>
            </div>

            {error && <p role="alert" className={errCls}>{error}</p>}

            <div className="flex items-center gap-2">
              <button type="submit" disabled={busy} className={primaryBtn}>
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
              {view.conectado && !confirmRemove && (
                <button type="button" disabled={busy} onClick={() => setConfirmRemove(true)}
                  className="h-10 px-4 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50">
                  Remover
                </button>
              )}
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Salvo
                </span>
              )}
            </div>

            {confirmRemove && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                <p className="text-sm text-red-700">
                  Remover a chave? Gravar e organizar com IA deixam de funcionar até cadastrar outra chave.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={handleRemove} disabled={busy}
                    className="h-9 px-4 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                    {busy ? 'Removendo...' : 'Sim, remover'}
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy}
                    className="h-9 px-4 rounded-lg border border-[#E5E7EB] text-sm text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </form>

          <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-3">
            <p className="text-sm font-semibold text-[#111827]">Uso do mês</p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[#6B7280]">Minutos de áudio</dt>
                <dd className="text-[#111827] font-medium">{fmtNum(view.usoMes.audioMinutes)}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Organizações de evolução</dt>
                <dd className="text-[#111827] font-medium">{fmtNum(view.usoMes.evolucoes)}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Preenchimentos de anamnese</dt>
                <dd className="text-[#111827] font-medium">{fmtNum(view.usoMes.anamneses)}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Respostas do agente no WhatsApp</dt>
                <dd className="text-[#111827] font-medium">{fmtNum(view.usoMes.agente)}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Áudios do WhatsApp transcritos</dt>
                <dd className="text-[#111827] font-medium">{fmtNum(view.usoMes.transcricoesWhatsapp)}</dd>
              </div>
              <div>
                <dt className="text-[#6B7280]">Custo estimado</dt>
                <dd className="text-[#111827] font-medium">US$ {view.usoMes.estimatedUsd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </div>
            </dl>
            <p className="text-xs text-[#6B7280]">Estimativa; o valor real é o da fatura da OpenAI.</p>
          </div>

          <p className="text-xs text-[#6B7280] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2">
            Por padrão, segundo a política da OpenAI para a API, os dados enviados não são usados para treinar
            modelos. Para atender à LGPD, a clínica deve aceitar o contrato de tratamento de dados (DPA) da OpenAI
            na conta dela.
          </p>
          <p className="text-xs text-[#6B7280] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2">
            &quot;Ditar&quot; usa o serviço de voz do navegador ou do celular (Google ou Apple) e pode enviar o áudio a
            eles. Para mais controle, prefira &quot;Gravar&quot;, que usa a OpenAI, coberta pelo DPA da clínica.
          </p>
        </div>
      )}
    </div>
  )
}
