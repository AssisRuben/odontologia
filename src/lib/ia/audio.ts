import { MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS } from './modelos'

export type AudioExt = 'webm' | 'mp4' | 'm4a' | 'mp3' | 'wav' | 'ogg'

const EXT_POR_TIPO: Record<string, AudioExt> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'video/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
}

/**
 * Valida o áudio pelo tamanho e pelo tipo. A duração informada pelo navegador
 * é só para registrar o uso: vem do relógio da página (que pode atrasar com a
 * tela bloqueada), então é limitada a MAX_AUDIO_SECONDS em vez de recusar —
 * o limite real é MAX_AUDIO_BYTES.
 */
export function checkAudio(
  file: { size: number; type: string } | null,
  seconds: number,
): { ok: true; ext: AudioExt; seconds: number } | { ok: false; status: 413 | 422; error: string } {
  if (!file || file.size <= 0) return { ok: false, status: 422, error: 'Áudio inválido' }
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, status: 413, error: 'Áudio longo demais (máximo 10 minutos)' }
  }
  const ext = EXT_POR_TIPO[file.type.split(';')[0].trim().toLowerCase()]
  if (!ext) return { ok: false, status: 422, error: 'Áudio inválido' }
  const secs = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(Math.min(seconds, MAX_AUDIO_SECONDS)) : 0
  return { ok: true, ext, seconds: secs }
}
