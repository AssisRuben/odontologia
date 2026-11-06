'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import {
  getSpeechRecognition,
  pickRecorderMime,
  type SpeechRecognitionLike,
  type SpeechResultEvent,
} from './fala'

const MAX_SEGUNDOS = 600
const ERRO_MICROFONE = 'Permita o uso do microfone no navegador.'
const ERRO_TRANSCRICAO = 'Não foi possível transcrever agora. Tente de novo.'

interface BarraVozProps {
  gravarDisponivel: boolean
  onTexto: (t: string) => void
  disabled?: boolean
  onOcupado?: (ocupado: boolean) => void
}

type Modo = 'parado' | 'ditando' | 'gravando' | 'transcrevendo'

const semAssinatura = () => () => {}

function mimeSuportado(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') return null
  return pickRecorderMime(m => MediaRecorder.isTypeSupported(m))
}

function mmss(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function BarraVoz({ gravarDisponivel, onTexto, disabled, onOcupado }: BarraVozProps) {
  const [modo, setModo] = useState<Modo>('parado')
  const [parcial, setParcial] = useState('')
  const [erro, setErro] = useState('')
  const [segundos, setSegundos] = useState(0)
  // APIs do navegador só no cliente: no servidor o snapshot é sempre vazio.
  const podeDitar = useSyncExternalStore(semAssinatura, () => getSpeechRecognition(window) !== null, () => false)
  const mime = useSyncExternalStore(semAssinatura, mimeSuportado, () => null)

  const onTextoRef = useRef(onTexto)
  const reconhecimento = useRef<SpeechRecognitionLike | null>(null)
  const gravador = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const pedacos = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const montado = useRef(true)

  useEffect(() => {
    onTextoRef.current = onTexto
  }, [onTexto])

  useEffect(() => {
    onOcupado?.(modo !== 'parado')
  }, [modo, onOcupado])

  const liberarMicrofone = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
  }, [])

  useEffect(() => {
    montado.current = true
    return () => {
      montado.current = false
      const rec = reconhecimento.current
      if (rec) {
        rec.onresult = rec.onerror = rec.onend = null
        rec.abort()
      }
      const g = gravador.current
      if (g) {
        g.onstop = null
        g.ondataavailable = null
        if (g.state !== 'inactive') g.stop()
      }
      pedacos.current = []
      liberarMicrofone()
    }
  }, [liberarMicrofone])

  function ditar() {
    const Ctor = getSpeechRecognition(window)
    if (!Ctor) return
    setErro('')
    const rec = new Ctor()
    rec.lang = 'pt-BR'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e: SpeechResultEvent) => {
      let interino = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) onTextoRef.current(r[0].transcript)
        else interino += r[0].transcript
      }
      setParcial(interino)
    }
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setErro(ERRO_MICROFONE)
    }
    rec.onend = () => {
      reconhecimento.current = null
      setParcial('')
      setModo('parado')
    }
    reconhecimento.current = rec
    setModo('ditando')
    try {
      rec.start()
    } catch {
      reconhecimento.current = null
      setModo('parado')
    }
  }

  function pararDitado() {
    reconhecimento.current?.stop()
  }

  async function enviar(blob: Blob, duracao: number) {
    setModo('transcrevendo')
    try {
      const form = new FormData()
      form.append('audio', blob, 'audio')
      form.append('seconds', String(duracao))
      const res = await fetch('/api/ia/transcrever', { method: 'POST', body: form })
      const j = await res.json().catch(() => ({}))
      if (!montado.current) return
      if (!res.ok || typeof j.texto !== 'string') {
        setErro(typeof j.error === 'string' ? j.error : ERRO_TRANSCRICAO)
      } else {
        onTextoRef.current(j.texto)
      }
    } catch {
      if (montado.current) setErro(ERRO_TRANSCRICAO)
    } finally {
      if (montado.current) setModo('parado')
    }
  }

  async function gravar() {
    if (!mime) return
    setErro('')
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setErro(ERRO_MICROFONE)
      return
    }
    if (!montado.current) {
      s.getTracks().forEach(t => t.stop())
      return
    }
    stream.current = s
    pedacos.current = []
    const g = new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: 32000 })
    gravador.current = g
    const inicio = Date.now()
    g.ondataavailable = e => {
      if (e.data.size > 0) pedacos.current.push(e.data)
    }
    g.onstop = () => {
      const duracao = Math.max(1, Math.round((Date.now() - inicio) / 1000))
      const blob = new Blob(pedacos.current, { type: g.mimeType || mime })
      pedacos.current = []
      gravador.current = null
      liberarMicrofone()
      void enviar(blob, duracao)
    }
    setSegundos(0)
    setModo('gravando')
    g.start()
    timer.current = setInterval(() => {
      const dec = Math.round((Date.now() - inicio) / 1000)
      setSegundos(dec)
      if (dec >= MAX_SEGUNDOS && g.state !== 'inactive') g.stop()
    }, 500)
  }

  function pararGravacao() {
    const g = gravador.current
    if (g && g.state !== 'inactive') g.stop()
  }

  const botao =
    'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50'
  const neutro = 'border-[#E5E7EB] bg-white text-[#374151] hover:border-[#3B82F6] hover:text-[#3B82F6]'
  const ativo = 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
  const livre = modo === 'parado'

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {podeDitar && modo === 'ditando' && (
          <button type="button" onClick={pararDitado} className={`${botao} ${ativo}`}>
            <Square className="w-4 h-4" /> Parar
          </button>
        )}
        {podeDitar && livre && (
          <button type="button" onClick={ditar} disabled={disabled} className={`${botao} ${neutro}`}>
            <Mic className="w-4 h-4" /> Ditar
          </button>
        )}
        {gravarDisponivel && mime && modo === 'gravando' && (
          <button type="button" onClick={pararGravacao} className={`${botao} ${ativo}`}>
            <Square className="w-4 h-4" /> Parar {mmss(segundos)}
          </button>
        )}
        {gravarDisponivel && mime && livre && (
          <button type="button" onClick={gravar} disabled={disabled} className={`${botao} ${neutro}`}>
            <Mic className="w-4 h-4" /> Gravar
          </button>
        )}
        {modo === 'transcrevendo' && (
          <span className="inline-flex items-center gap-1.5 text-sm text-[#6B7280]">
            <Loader2 className="w-4 h-4 animate-spin" /> Transcrevendo…
          </span>
        )}
      </div>
      {parcial && <p className="text-sm text-[#9CA3AF] italic">{parcial}</p>}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  )
}
