import { describe, it, expect } from 'vitest'
import { checkAudio } from '@/lib/ia/audio'

const ok = (type: string) => checkAudio({ size: 1000, type }, 30)

describe('checkAudio', () => {
  it('aceita webm com codec', () => {
    expect(ok('audio/webm;codecs=opus')).toEqual({ ok: true, ext: 'webm' })
  })
  it('aceita mp4 do Safari', () => {
    expect(ok('audio/mp4')).toEqual({ ok: true, ext: 'mp4' })
    expect(ok('video/mp4')).toEqual({ ok: true, ext: 'mp4' })
  })
  it('aceita m4a, mp3, wav e ogg', () => {
    expect(ok('audio/x-m4a')).toEqual({ ok: true, ext: 'm4a' })
    expect(ok('audio/m4a')).toEqual({ ok: true, ext: 'm4a' })
    expect(ok('audio/mpeg')).toEqual({ ok: true, ext: 'mp3' })
    expect(ok('audio/wav')).toEqual({ ok: true, ext: 'wav' })
    expect(ok('audio/ogg')).toEqual({ ok: true, ext: 'ogg' })
  })
  it('recusa arquivo grande demais', () => {
    expect(checkAudio({ size: 26 * 1024 * 1024, type: 'audio/webm' }, 30)).toEqual({
      ok: false, status: 413, error: 'Áudio longo demais (máximo 10 minutos)',
    })
  })
  it('recusa duração acima de 10 minutos', () => {
    expect(checkAudio({ size: 1000, type: 'audio/webm' }, 700)).toMatchObject({ ok: false, status: 413 })
    expect(checkAudio({ size: 1000, type: 'audio/webm' }, 605)).toMatchObject({ ok: true })
  })
  it('recusa tipo desconhecido, vazio ou ausente', () => {
    expect(ok('text/plain')).toEqual({ ok: false, status: 422, error: 'Áudio inválido' })
    expect(checkAudio({ size: 0, type: 'audio/webm' }, 5)).toMatchObject({ ok: false, status: 422 })
    expect(checkAudio(null, 5)).toMatchObject({ ok: false, status: 422 })
  })
})
