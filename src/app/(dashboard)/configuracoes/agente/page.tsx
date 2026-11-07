'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ChevronLeft, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { MAX_TIPOS } from '@/lib/agente/agendamento/config'
import type { TipoConsulta, RegrasAgendamento } from '@/lib/agente/agendamento/config'

type Hours = Record<string, [string, string] | undefined>

interface View {
  config: { enabled: boolean; hours: Hours; info: string; tipos: TipoConsulta[]; agendamento: RegrasAgendamento }
  profissionais: { id: string; name: string }[]
  profissionaisWhatsApp: number
  clinica: { name: string; address: string | null; phone: string | null }
  convenios: string[]
  whatsappConectado: boolean
  iaConectada: boolean
}

interface Teste {
  acao: 'responder' | 'guardar_nome' | 'passar_recepcao'
  resposta: string | null
  nome: string | null
  motivo: string | null
  ofertas: { n: number; texto: string }[] | null
}

const DURACOES = Array.from({ length: 16 }, (_, i) => (i + 1) * 15)
function fmtDuracao(m: number) {
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? (r ? `${h}h${r}` : `${h}h`) : `${r} min`
}
function novoId() {
  return `tipo-${crypto.randomUUID().slice(0, 8)}`
}

const MAX_INFO = 4000
const DIAS: { key: string; label: string }[] = [
  { key: '1', label: 'Segunda' },
  { key: '2', label: 'Terça' },
  { key: '3', label: 'Quarta' },
  { key: '4', label: 'Quinta' },
  { key: '5', label: 'Sexta' },
  { key: '6', label: 'Sábado' },
  { key: '0', label: 'Domingo' },
]
const PLACEHOLDER = `Exemplos:
- Formas de pagamento: Pix, cartão em até 6x e dinheiro.
- Estacionamento: convênio com o estacionamento ao lado.
- Avaliação inicial: R$ 100, abatida do tratamento.
- Preparo: venha de boca escovada; para sedação, jejum de 6 horas.
- Faltas: avise com 24 horas de antecedência para remarcar.`

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]'
const timeCls = 'h-9 px-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] disabled:opacity-40'
const errCls = 'text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2'
const primaryBtn = 'h-10 px-5 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#2563EB] transition-colors disabled:opacity-50'
const cardCls = 'bg-white rounded-xl border border-[#E5E7EB] p-5 space-y-4'
const linkCls = 'text-[#3B82F6] hover:underline'

export default function AgenteConfigPage() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [view, setView] = useState<View | null>(null)
  const [loadError, setLoadError] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [hours, setHours] = useState<Hours>({})
  const [info, setInfo] = useState('')
  const [tipos, setTipos] = useState<TipoConsulta[]>([])
  const [regras, setRegras] = useState<RegrasAgendamento>({ antecedencia_h: 24, dias_a_frente: 30, intervalo_min: 30 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [texto, setTexto] = useState('')
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [teste, setTeste] = useState<Teste | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agente/config', { cache: 'no-store' })
      const data = await res.json().catch(() => ({})) as View & { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setLoadError(data.error || 'Não foi possível carregar as configurações.')
        return
      }
      setLoadError('')
      setView(data)
      setEnabled(data.config.enabled)
      setHours(data.config.hours)
      setInfo(data.config.info)
      setTipos(data.config.tipos)
      setRegras(data.config.agendamento)
    } catch {
      if (mounted.current) setLoadError('Não foi possível carregar as configurações. Verifique sua conexão.')
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  function setClosed(key: string, closed: boolean) {
    setHours(h => {
      const next = { ...h }
      if (closed) delete next[key]
      else next[key] = ['08:00', '18:00']
      return next
    })
  }

  function setTime(key: string, idx: 0 | 1, value: string) {
    setHours(h => {
      const cur = h[key] ?? ['08:00', '18:00']
      const range: [string, string] = idx === 0 ? [value, cur[1]] : [cur[0], value]
      return { ...h, [key]: range }
    })
  }

  function updTipo(id: string, patch: Partial<TipoConsulta>) {
    setTipos(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  function addTipo() {
    setTipos(ts => (ts.length >= MAX_TIPOS ? ts : [...ts, { id: novoId(), nome: '', duracao_min: 30, profissionais: null, ativo: true }]))
  }

  function toggleProf(t: TipoConsulta, profId: string, on: boolean) {
    const cur = t.profissionais ?? []
    updTipo(t.id, { profissionais: on ? [...cur, profId] : cur.filter(x => x !== profId) })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    for (const t of tipos) {
      if (!t.nome.trim() || t.nome.trim().length > 60) {
        setError('Todo tipo de consulta precisa de um nome com até 60 caracteres.')
        return
      }
      if (t.profissionais && t.profissionais.length === 0) {
        setError(`Escolha ao menos um profissional para "${t.nome.trim()}" ou marque "Todos os profissionais".`)
        return
      }
    }
    if (!tipos.some(t => t.ativo)) {
      setError('Deixe ao menos um tipo de consulta ativo.')
      return
    }
    if (!Number.isInteger(regras.antecedencia_h) || regras.antecedencia_h < 0 || regras.antecedencia_h > 168) {
      setError('Antecedência mínima deve estar entre 0 e 168 horas.')
      return
    }
    if (!Number.isInteger(regras.dias_a_frente) || regras.dias_a_frente < 1 || regras.dias_a_frente > 90) {
      setError('Dias à frente deve estar entre 1 e 90.')
      return
    }
    for (const d of DIAS) {
      const r = hours[d.key]
      if (r && (!r[0] || !r[1] || r[0] >= r[1])) {
        setError(`Horário de ${d.label} inválido: a abertura deve ser antes do fechamento.`)
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/agente/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, hours, info, tipos: tipos.map(t => ({ ...t, nome: t.nome.trim() })), agendamento: regras }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!mounted.current) return
      if (!res.ok) {
        setError(data.error || 'Não foi possível salvar.')
      } else {
        setSaved(true)
        setTimeout(() => { if (mounted.current) setSaved(false) }, 2500)
        await load()
      }
    } catch {
      if (mounted.current) setError('Não foi possível salvar. Verifique sua conexão.')
    }
    if (mounted.current) setBusy(false)
  }

  async function handleTest(e: React.FormEvent) {
    e.preventDefault()
    if (!texto.trim()) return
    setTesting(true)
    setTestError('')
    setTeste(null)
    try {
      const res = await fetch('/api/agente/testar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: texto.trim() }),
      })
      const data = await res.json().catch(() => ({})) as Teste & { error?: string }
      if (!mounted.current) return
      if (!res.ok) setTestError(data.error || 'Não foi possível testar.')
      else setTeste(data)
    } catch {
      if (mounted.current) setTestError('Não foi possível testar. Verifique sua conexão.')
    }
    if (mounted.current) setTesting(false)
  }

  const faltaAlgo = view !== null && (!view.whatsappConectado || !view.iaConectada)
  const toggleDisabled = busy || (faltaAlgo && !enabled)

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/configuracoes" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-[#6B7280]">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold text-[#111827]">Agente do WhatsApp</h1>
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
          <form onSubmit={handleSave} className="space-y-4">
            <div className={cardCls}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#111827]">Agente ligado</p>
                  <p className="text-sm text-[#6B7280]">Responde os pacientes no WhatsApp e passa para a recepção o que não souber.</p>
                </div>
                <input type="checkbox" role="switch" aria-label="Agente ligado" checked={enabled}
                  onChange={e => setEnabled(e.target.checked)} disabled={toggleDisabled}
                  className="w-5 h-5 mt-0.5 shrink-0 accent-[#3B82F6] disabled:opacity-40" />
              </div>

              {faltaAlgo && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  <p>Para ligar o agente, falta:</p>
                  <ul className="list-disc pl-5">
                    {!view.whatsappConectado && (
                      <li>conectar o WhatsApp em <Link href="/configuracoes/mensagens" className={linkCls}>Configurações de mensagens</Link></li>
                    )}
                    {!view.iaConectada && (
                      <li>cadastrar a chave da OpenAI em <Link href="/configuracoes/ia" className={linkCls}>Inteligência artificial</Link></li>
                    )}
                  </ul>
                </div>
              )}

              <p className="text-xs text-[#6B7280] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2">
                Com o agente ligado, mensagens de números que não são pacientes também ficam guardadas.
              </p>
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Desative a saudação e a mensagem de ausência do WhatsApp Business: o agente responde no lugar delas.
              </p>
            </div>

            <div className={cardCls}>
              <p className="text-sm font-semibold text-[#111827]">Horário de atendimento</p>
              <div className="space-y-2">
                {DIAS.map(d => {
                  const r = hours[d.key]
                  const closed = !r
                  return (
                    <div key={d.key} className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="w-20 text-[#111827]">{d.label}</span>
                      <label className="flex items-center gap-1.5 text-[#6B7280]">
                        <input type="checkbox" checked={closed} disabled={busy}
                          onChange={e => setClosed(d.key, e.target.checked)}
                          className="accent-[#3B82F6]" />
                        Fechado
                      </label>
                      <input type="time" aria-label={`${d.label}: abre às`} value={r?.[0] ?? ''}
                        disabled={busy || closed} onChange={e => setTime(d.key, 0, e.target.value)} className={timeCls} />
                      <span className="text-[#6B7280]">até</span>
                      <input type="time" aria-label={`${d.label}: fecha às`} value={r?.[1] ?? ''}
                        disabled={busy || closed} onChange={e => setTime(d.key, 1, e.target.value)} className={timeCls} />
                    </div>
                  )
                })}
              </div>
            </div>

            <div className={cardCls}>
              <div>
                <p className="text-sm font-semibold text-[#111827]">Tipos de consulta pelo WhatsApp</p>
                <p className="text-sm text-[#6B7280]">O agente só marca os tipos ativos desta lista.</p>
              </div>
              {view.profissionaisWhatsApp === 0 && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Nenhum profissional aceita agendamento pelo WhatsApp. Configure em <Link href="/configuracoes/profissionais" className={linkCls}>Profissionais</Link>.
                </p>
              )}
              <div className="space-y-3">
                {tipos.map((t, i) => (
                  <div key={t.id} className="border border-[#E5E7EB] rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="text" aria-label={`Nome do tipo ${i + 1}`} value={t.nome} maxLength={60}
                        onChange={e => updTipo(t.id, { nome: e.target.value })} placeholder="Ex.: Limpeza"
                        disabled={busy} className={`${inputCls} flex-1 min-w-40`} />
                      <select aria-label={`Duração do tipo ${i + 1}`} value={t.duracao_min} disabled={busy}
                        onChange={e => updTipo(t.id, { duracao_min: Number(e.target.value) })} className={timeCls}>
                        {DURACOES.map(m => <option key={m} value={m}>{fmtDuracao(m)}</option>)}
                      </select>
                      <label className="flex items-center gap-1.5 text-sm text-[#6B7280]">
                        <input type="checkbox" checked={t.ativo} disabled={busy}
                          onChange={e => updTipo(t.id, { ativo: e.target.checked })} className="accent-[#3B82F6]" />
                        Ativo
                      </label>
                      <button type="button" aria-label={`Remover tipo ${t.nome || i + 1}`} disabled={busy || tipos.length <= 1}
                        onClick={() => setTipos(ts => ts.filter(x => x.id !== t.id))}
                        className="p-1.5 rounded-lg text-[#6B7280] hover:bg-red-50 hover:text-red-500 disabled:opacity-40">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {view.profissionais.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#6B7280]">
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={t.profissionais === null} disabled={busy}
                            onChange={e => updTipo(t.id, { profissionais: e.target.checked ? null : [] })}
                            className="accent-[#3B82F6]" />
                          Todos os profissionais
                        </label>
                        {t.profissionais !== null && view.profissionais.map(p => (
                          <label key={p.id} className="flex items-center gap-1.5">
                            <input type="checkbox" checked={t.profissionais!.includes(p.id)} disabled={busy}
                              onChange={e => toggleProf(t, p.id, e.target.checked)} className="accent-[#3B82F6]" />
                            {p.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addTipo} disabled={busy || tipos.length >= MAX_TIPOS}
                className="flex items-center gap-1.5 text-sm text-[#3B82F6] hover:underline disabled:opacity-40">
                <Plus className="w-4 h-4" /> Adicionar tipo
              </button>
            </div>

            <div className={cardCls}>
              <p className="text-sm font-semibold text-[#111827]">Regras de agendamento</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <label htmlFor="regra-antecedencia" className="block text-[#6B7280] mb-1">Antecedência mínima (horas)</label>
                  <input id="regra-antecedencia" type="number" min={0} max={168} step={1} value={Number.isNaN(regras.antecedencia_h) ? '' : regras.antecedencia_h} disabled={busy}
                    onChange={e => setRegras(r => ({ ...r, antecedencia_h: e.target.value === '' ? NaN : Number(e.target.value) }))}
                    className={inputCls} />
                </div>
                <div>
                  <label htmlFor="regra-dias" className="block text-[#6B7280] mb-1">Dias à frente</label>
                  <input id="regra-dias" type="number" min={1} max={90} step={1} value={Number.isNaN(regras.dias_a_frente) ? '' : regras.dias_a_frente} disabled={busy}
                    onChange={e => setRegras(r => ({ ...r, dias_a_frente: e.target.value === '' ? NaN : Number(e.target.value) }))}
                    className={inputCls} />
                </div>
                <div>
                  <label htmlFor="regra-intervalo" className="block text-[#6B7280] mb-1">Intervalo entre horários</label>
                  <select id="regra-intervalo" value={regras.intervalo_min} disabled={busy}
                    onChange={e => setRegras(r => ({ ...r, intervalo_min: Number(e.target.value) as 15 | 30 | 60 }))}
                    className={inputCls}>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>60 min</option>
                  </select>
                </div>
              </div>
            </div>

            <div className={cardCls}>
              <div>
                <label htmlFor="agente-info" className="block text-sm font-semibold text-[#111827] mb-1">
                  Informações para o agente
                </label>
                <textarea id="agente-info" value={info} onChange={e => setInfo(e.target.value)}
                  maxLength={MAX_INFO} rows={8} placeholder={PLACEHOLDER} disabled={busy}
                  className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6]" />
                <p className="text-xs text-[#6B7280] text-right mt-1">{info.length}/{MAX_INFO}</p>
              </div>

              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm space-y-1">
                <p className="text-xs font-medium text-[#6B7280]">O agente também usa estes dados da clínica</p>
                <p className="text-[#111827]">{view.clinica.name}</p>
                <p className="text-[#6B7280]">Endereço: {view.clinica.address || 'não informado'}</p>
                <p className="text-[#6B7280]">Telefone: {view.clinica.phone || 'não informado'}</p>
                <p className="text-xs"><Link href="/configuracoes/clinica" className={linkCls}>Editar dados da clínica</Link></p>
                <p className="text-[#6B7280] pt-1">
                  Convênios: {view.convenios.length ? view.convenios.join(', ') : 'nenhum cadastrado'}
                </p>
                <p className="text-xs"><Link href="/configuracoes/convenios" className={linkCls}>Editar convênios</Link></p>
              </div>
            </div>

            {error && <p role="alert" className={errCls}>{error}</p>}

            <div className="flex items-center gap-3">
              <button type="submit" disabled={busy} className={primaryBtn}>
                {busy ? 'Salvando...' : 'Salvar'}
              </button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-[#10B981] font-medium">
                  <CheckCircle2 className="w-4 h-4" /> Salvo
                </span>
              )}
            </div>
          </form>

          <form onSubmit={handleTest} className={cardCls}>
            <div>
              <p className="text-sm font-semibold text-[#111827]">Testar</p>
              <p className="text-sm text-[#6B7280]">Escreva como um paciente e veja o que o agente faria. Usa as configurações já salvas.</p>
            </div>
            <div className="flex gap-2">
              <input type="text" aria-label="Mensagem de teste" value={texto} onChange={e => setTexto(e.target.value)}
                maxLength={2000} placeholder="Ex.: Vocês atendem sábado?" disabled={testing} className={inputCls} />
              <button type="submit" disabled={testing || !texto.trim()} className={primaryBtn}>
                {testing ? 'Testando...' : 'Testar'}
              </button>
            </div>
            {testError && <p role="alert" className={errCls}>{testError}</p>}
            {teste && (
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm space-y-1">
                <p className="text-xs font-medium text-[#6B7280]">
                  {teste.acao === 'responder' && 'Responderia'}
                  {teste.acao === 'guardar_nome' && `Guardaria o nome: ${teste.nome ?? ''}`}
                  {teste.acao === 'passar_recepcao' && `Passaria para a recepção: ${teste.motivo ?? ''}`}
                </p>
                {teste.resposta && <p className="text-[#111827] whitespace-pre-wrap">{teste.resposta}</p>}
                {teste.ofertas && teste.ofertas.length > 0 && (
                  <div className="pt-1">
                    <p className="text-xs font-medium text-[#6B7280]">Ofertas de horário</p>
                    <ul className="text-[#111827]">
                      {teste.ofertas.map(o => <li key={o.n}>{o.texto}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
