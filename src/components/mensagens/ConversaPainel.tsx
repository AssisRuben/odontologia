'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mic } from 'lucide-react'
import { format } from 'date-fns'
import { MAX_REPLY_CHARS } from '@/lib/agente/conversa'
import type { Conversation } from '@/types'
import { formatWhatsAppPhone } from './helpers'
import ModalCadastrarContato from './ModalCadastrarContato'

export type ConversaDetalhe = Conversation & { label: string }
interface Msg { id: string; role: 'paciente' | 'assistente' | 'equipe' | 'automatica'; body: string; transcribed: boolean; at: string }

const ROLE_LABEL: Record<string, string> = { assistente: 'Assistente', equipe: 'Equipe', automatica: 'Automática' }

interface Props {
  id: string
  onBack: () => void
  onChanged: () => void
}

export default function ConversaPainel({ id, onBack, onChanged }: Props) {
  const [conversa, setConversa] = useState<ConversaDetalhe | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(false)
  const [agenteLigado, setAgenteLigado] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversas/${id}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setLoadError(json.error ?? 'Não foi possível carregar a conversa.'); return }
      setLoadError(null)
      setConversa(json.conversa)
      setMsgs(json.mensagens ?? [])
      setAgenteLigado(json.agenteLigado !== false)
    } catch {
      setLoadError('Não foi possível carregar a conversa.')
    }
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 10_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (msgs.length !== lastCount.current) {
      lastCount.current = msgs.length
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [msgs])

  async function post(path: string, body?: unknown) {
    return fetch(`/api/conversas/${id}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async function toggleHandler(path: 'assumir' | 'encerrar') {
    setBusy(true)
    try {
      await post(path)
      await load()
      onChanged()
    } finally { setBusy(false) }
  }

  async function send() {
    const t = texto.trim()
    if (!t || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await post('responder', { texto: t })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setSendError(json.error ?? 'Não foi possível enviar.'); return }
      setTexto('')
      await load()
      onChanged()
    } catch {
      setSendError('Não foi possível enviar.')
    } finally { setSending(false) }
  }

  if (loadError && !conversa) {
    return (
      <div className="flex-1 flex flex-col">
        <button onClick={onBack} aria-label="Voltar" className="sm:hidden p-3 text-[#6B7280] self-start"><ArrowLeft className="w-5 h-5" /></button>
        <p className="p-6 text-sm text-[#EF4444]">{loadError}</p>
      </div>
    )
  }
  if (!conversa) return <div className="flex-1 p-6 text-sm text-[#6B7280]">Carregando…</div>

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center gap-3">
        <button onClick={onBack} aria-label="Voltar" className="sm:hidden text-[#6B7280]"><ArrowLeft className="w-5 h-5" /></button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#111827] truncate">{conversa.label}</p>
          <p className="text-xs text-[#6B7280]">{formatWhatsAppPhone(conversa.phone)}</p>
        </div>
        {conversa.patient_id ? (
          <Link href={`/pacientes/${conversa.patient_id}`} className="text-sm text-[#3B82F6] hover:underline shrink-0">Ver ficha</Link>
        ) : (
          <button onClick={() => setModal(true)} className="text-sm font-medium text-[#3B82F6] border border-[#3B82F6] rounded-lg px-3 py-1.5 shrink-0">
            Cadastrar paciente
          </button>
        )}
      </div>

      <div className={`px-4 py-2 border-b border-[#E5E7EB] flex items-center gap-3 text-sm ${conversa.handler === 'human' ? 'bg-[#FEF3C7]' : agenteLigado ? 'bg-[#EFF6FF]' : 'bg-[#F9FAFB]'}`}>
        <span className="flex-1 text-[#111827]">
          {conversa.handler === 'human'
            ? `Passada para a equipe${conversa.handoff_reason ? `: ${conversa.handoff_reason}` : ''}`
            : agenteLigado ? 'O assistente está atendendo' : 'Agente desligado'}
        </span>
        {(conversa.handler === 'human' || agenteLigado) && (
          <button disabled={busy} onClick={() => toggleHandler(conversa.handler === 'human' ? 'encerrar' : 'assumir')}
            className="px-3 py-1.5 text-sm font-medium bg-[#3B82F6] text-white rounded-lg disabled:opacity-50 shrink-0">
            {conversa.handler === 'human' ? 'Encerrar atendimento' : 'Assumir conversa'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#F9FAFB]">
        {msgs.map((m) => {
          const mine = m.role !== 'paciente'
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm border ${mine ? 'bg-[#EFF6FF] border-[#BFDBFE]' : 'bg-white border-[#E5E7EB]'}`}>
                {mine && <p className="text-[10px] font-medium text-[#6B7280] mb-0.5">{ROLE_LABEL[m.role]}</p>}
                <p className="text-[#111827] whitespace-pre-wrap break-words">
                  {m.transcribed && <Mic className="inline w-3.5 h-3.5 mr-1 text-[#6B7280]" aria-label="Áudio transcrito" />}
                  {m.body}
                </p>
                <p className="text-[10px] text-[#6B7280] mt-1 text-right">{format(new Date(m.at), 'dd/MM HH:mm')}</p>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[#E5E7EB] p-3 bg-white">
        {sendError && <p className="text-sm text-[#EF4444] mb-2">{sendError}</p>}
        <div className="flex gap-2 items-end">
          <textarea value={texto} rows={2} maxLength={MAX_REPLY_CHARS} placeholder="Escreva uma resposta…"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            className="flex-1 border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm text-[#111827] resize-none focus:outline-none focus:border-[#3B82F6]" />
          <button onClick={send} disabled={sending || !texto.trim()}
            className="px-4 py-2 text-sm font-medium bg-[#3B82F6] text-white rounded-lg disabled:opacity-50">
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>

      {modal && !conversa.patient_id && (
        <ModalCadastrarContato conversaId={id} phone={conversa.phone} nomeInicial={conversa.contact_name ?? ''}
          onClose={() => setModal(false)}
          onDone={() => { setModal(false); load(); onChanged() }} />
      )}
    </div>
  )
}
