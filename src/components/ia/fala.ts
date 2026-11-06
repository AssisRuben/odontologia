export type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

export type SpeechResultEvent = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

/** Construtor do reconhecimento de fala do navegador, ou null se não houver. */
export function getSpeechRecognition(w: unknown): (new () => SpeechRecognitionLike) | null {
  if (!w || typeof w !== 'object') return null
  const o = w as Record<string, unknown>
  const ctor = o.SpeechRecognition ?? o.webkitSpeechRecognition
  return typeof ctor === 'function' ? (ctor as new () => SpeechRecognitionLike) : null
}

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

/** Primeiro formato de gravação aceito pelo navegador, ou null. */
export function pickRecorderMime(isSupported: (m: string) => boolean): string | null {
  return MIMES.find(isSupported) ?? null
}
