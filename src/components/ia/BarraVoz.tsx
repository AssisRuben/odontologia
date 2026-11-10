'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import {
  getSpeechRecognition,
  mensagemErroDitado,
  modoReconhecimento,
  deveReiniciar,
  pickRecorderMime,
  problemaGravacao,
  type SpeechRecognitionLike,
  type SpeechResultEvent,
} from './fala'

const MAX_SEGUNDOS = 600
const ERRO_MICROFONE = 'Permita o uso do microfone no navegador.'
const ERRO_TRANSCRICAO = 'Não foi possível transcrever agora. Tente de novo.'
const ERRO_DITADO = 'Não foi possível iniciar o ditado neste navegador.'
const ERRO_GRAVADOR = 'Não foi possível gravar neste navegador.'
const ERRO_GRANDE = 'Gravação grande demais para enviar. Grave trechos menores.'

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
  // Usuário ainda quer ditar (até apertar Parar): no Android o ditado reinicia a cada frase.
  const querOuvir = useRef(false)
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
      querOuvir.current = false
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
    const { continuous, reiniciar } = modoReconhecimento(navigator.userAgent)
    const rec = new Ctor()
    rec.lang = 'pt-BR'
    rec.continuous = continuous
    rec.interimResults = true
    // Reinícios seguidos sem texto final: evita laço start→end→start se o navegador não entrega nada.
    let reiniciosSemTexto = 0
    rec.onresult = (e: SpeechResultEvent) => {
      let interino = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          reiniciosSemTexto = 0
          onTextoRef.current(r[0].transcript)
        } else interino += r[0].transcript
      }
      setParcial(interino)
    }
    rec.onerror = e => {
      const msg = mensagemErroDitado(e.error)
      if (msg) {
        querOuvir.current = false
        setErro(msg)
      }
    }
    rec.onend = () => {
      setParcial('')
      if (montado.current && deveReiniciar(reiniciar, querOuvir.current, reiniciosSemTexto)) {
        reiniciosSemTexto++
        try {
          rec.start()
          return
        } catch {
          setErro(ERRO_DITADO)
        }
      }
      querOuvir.current = false
      reconhecimento.current = null
      setModo('parado')
    }
    reconhecimento.current = rec
    querOuvir.current = true
    setModo('ditando')
    try {
      rec.start()
    } catch {
      querOuvir.current = false
      reconhecimento.current = null
      setErro(ERRO_DITADO)
      setModo('parado')
    }
  }

  function pararDitado() {
    querOuvir.current = false
    reconhecimento.current?.stop()
  }

  async function enviar(blob: Blob, duracao: number) {
    const problema = problemaGravacao(blob.size)
    if (problema) {
      if (problema === 'grande') setErro(ERRO_GRANDE)
      setModo('parado')
      return
    }
    setModo('transcrevendo')
    try {
      const form = new FormData()
      form.append('audio', blob, 'audio')
      // O relógio da página pode atrasar (aba em segundo plano, tela bloqueada): nunca passa de 10 min.
      form.append('seconds', String(Math.min(MAX_SEGUNDOS, duracao)))
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
    let g: MediaRecorder
    try {
      g = new MediaRecorder(s, { mimeType: mime, audioBitsPerSecond: 32000 })
    } catch {
      liberarMicrofone()
      setErro(ERRO_GRAVADOR)
      setModo('parado')
      return
    }
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
    try {
      g.start()
    } catch {
      g.ondataavailable = null
      g.onstop = null
      gravador.current = null
      liberarMicrofone()
      setErro(ERRO_GRAVADOR)
      setModo('parado')
      return
    }
    setSegundos(0)
    setModo('gravando')
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
  const neutro = 'border-linha bg-white text-tinta-2 hover:border-petroleo hover:text-petroleo'
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
          <span className="inline-flex items-center gap-1.5 text-sm text-tinta-3">
            <Loader2 className="w-4 h-4 animate-spin" /> Transcrevendo…
          </span>
        )}
      </div>
      {parcial && <p className="text-sm text-tinta-4 italic">{parcial}</p>}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  )
}
