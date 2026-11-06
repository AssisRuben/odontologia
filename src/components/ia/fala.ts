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

/**
 * No Chrome do Android o modo contínuo repete os trechos finais ("dente dente 36…").
 * Lá o ditado roda frase a frase e reinicia sozinho até o usuário parar.
 */
export function modoReconhecimento(userAgent: string): { continuous: boolean; reiniciar: boolean } {
  return /Android/i.test(userAgent) ? { continuous: false, reiniciar: true } : { continuous: true, reiniciar: false }
}

/** Reinícios seguidos sem texto final, no Android, antes de desistir do ditado. */
export const MAX_REINICIOS_SEM_TEXTO = 3

/** Reinicia o ditado (Android) só se o usuário ainda quer ouvir e não houve reinícios demais sem texto. */
export function deveReiniciar(reiniciar: boolean, querOuvir: boolean, reiniciosSemTexto: number): boolean {
  return reiniciar && querOuvir && reiniciosSemTexto < MAX_REINICIOS_SEM_TEXTO
}

/** Mensagem para erros do ditado; null quando o erro deve passar em silêncio. */
export function mensagemErroDitado(erro: string | undefined): string | null {
  switch (erro) {
    case 'not-allowed':
      return 'Permita o uso do microfone no navegador.'
    case 'language-not-supported':
    case 'service-not-allowed':
      return 'O ditado não está disponível neste navegador. Use o Gravar ou o microfone do teclado.'
    case 'audio-capture':
      return 'Nenhum microfone encontrado.'
    case 'network':
      return 'Sem conexão com o serviço de ditado.'
    default:
      return null
  }
}

/** Limite prático do corpo da requisição na hospedagem (~4,5 MB). */
export const MAX_ENVIO_BYTES = 4 * 1024 * 1024

/** Motivo para não enviar a gravação, ou null se pode enviar. */
export function problemaGravacao(tamanho: number): 'vazia' | 'grande' | null {
  if (tamanho <= 0) return 'vazia'
  if (tamanho > MAX_ENVIO_BYTES) return 'grande'
  return null
}
