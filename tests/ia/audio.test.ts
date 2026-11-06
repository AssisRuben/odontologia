import { describe, it, expect } from 'vitest'
import { checkAudio } from '@/lib/ia/audio'

const ok = (type: string) => checkAudio({ size: 1000, type }, 30)
const aceito = (ext: string) => ({ ok: true, ext, seconds: 30 })

describe('checkAudio', () => {
  it('aceita webm com codec', () => {
    expect(ok('audio/webm;codecs=opus')).toEqual(aceito('webm'))
  })
  it('aceita mp4 do Safari', () => {
    expect(ok('audio/mp4')).toEqual(aceito('mp4'))
    expect(ok('video/mp4')).toEqual(aceito('mp4'))
  })
  it('aceita m4a, mp3, wav e ogg', () => {
    expect(ok('audio/x-m4a')).toEqual(aceito('m4a'))
    expect(ok('audio/m4a')).toEqual(aceito('m4a'))
    expect(ok('audio/mpeg')).toEqual(aceito('mp3'))
    expect(ok('audio/wav')).toEqual(aceito('wav'))
    expect(ok('audio/ogg')).toEqual(aceito('ogg'))
  })
  it('recusa arquivo grande demais', () => {
    expect(checkAudio({ size: 26 * 1024 * 1024, type: 'audio/webm' }, 30)).toEqual({
      ok: false, status: 413, error: 'Áudio longo demais (máximo 10 minutos)',
    })
  })
  it('limita a duração informada a 10 minutos em vez de recusar', () => {
    expect(checkAudio({ size: 1000, type: 'audio/webm' }, 700)).toEqual({ ok: true, ext: 'webm', seconds: 600 })
    expect(checkAudio({ size: 1000, type: 'audio/webm' }, 605)).toEqual({ ok: true, ext: 'webm', seconds: 600 })
    expect(checkAudio({ size: 1000, type: 'audio/webm' }, 120.4)).toEqual({ ok: true, ext: 'webm', seconds: 121 })
  })
  it('duração ausente ou inválida vira 0', () => {
    expect(checkAudio({ size: 1000, type: 'audio/webm' }, NaN)).toEqual({ ok: true, ext: 'webm', seconds: 0 })
    expect(checkAudio({ size: 1000, type: 'audio/webm' }, -3)).toEqual({ ok: true, ext: 'webm', seconds: 0 })
  })
  it('recusa tipo desconhecido, vazio ou ausente', () => {
    expect(ok('text/plain')).toEqual({ ok: false, status: 422, error: 'Áudio inválido' })
    expect(checkAudio({ size: 0, type: 'audio/webm' }, 5)).toMatchObject({ ok: false, status: 422 })
    expect(checkAudio(null, 5)).toMatchObject({ ok: false, status: 422 })
  })
})
