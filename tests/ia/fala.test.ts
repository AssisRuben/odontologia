import { describe, it, expect } from 'vitest'
import {
  getSpeechRecognition,
  mensagemErroDitado,
  modoReconhecimento,
  pedirProcessamentoLocal,
  pickRecorderMime,
  problemaGravacao,
} from '@/components/ia/fala'

describe('getSpeechRecognition', () => {
  it('devolve null quando não há suporte', () => {
    expect(getSpeechRecognition({})).toBeNull()
    expect(getSpeechRecognition(null)).toBeNull()
  })
  it('usa SpeechRecognition', () => {
    class A {}
    expect(getSpeechRecognition({ SpeechRecognition: A })).toBe(A)
  })
  it('usa webkitSpeechRecognition quando só ele existe', () => {
    class B {}
    expect(getSpeechRecognition({ webkitSpeechRecognition: B })).toBe(B)
  })
})

describe('pickRecorderMime', () => {
  it('prefere webm com opus', () => {
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus')
  })
  it('cai para mp4 no Safari', () => {
    expect(pickRecorderMime(m => m === 'audio/mp4')).toBe('audio/mp4')
  })
  it('devolve null se nenhum serve', () => {
    expect(pickRecorderMime(() => false)).toBeNull()
  })
})

describe('modoReconhecimento', () => {
  it('no Android usa frases curtas e reinicia sozinho', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'
    expect(modoReconhecimento(ua)).toEqual({ continuous: false, reiniciar: true })
  })
  it('nos demais mantém o modo contínuo', () => {
    expect(modoReconhecimento('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0')).toEqual({ continuous: true, reiniciar: false })
    expect(modoReconhecimento('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toEqual({ continuous: true, reiniciar: false })
    expect(modoReconhecimento('')).toEqual({ continuous: true, reiniciar: false })
  })
})

describe('pedirProcessamentoLocal', () => {
  it('liga processLocally quando existe', () => {
    const rec = { processLocally: false }
    pedirProcessamentoLocal(rec)
    expect(rec.processLocally).toBe(true)
  })
  it('não cria a propriedade quando não existe', () => {
    const rec = {}
    pedirProcessamentoLocal(rec)
    expect('processLocally' in rec).toBe(false)
  })
  it('não lança se a propriedade for somente leitura', () => {
    const rec = Object.freeze({ processLocally: false })
    expect(() => pedirProcessamentoLocal(rec)).not.toThrow()
  })
})

describe('mensagemErroDitado', () => {
  it('microfone negado', () => {
    expect(mensagemErroDitado('not-allowed')).toBe('Permita o uso do microfone no navegador.')
    expect(mensagemErroDitado('service-not-allowed')).toBe('Permita o uso do microfone no navegador.')
  })
  it('sem microfone e sem rede', () => {
    expect(mensagemErroDitado('audio-capture')).toBe('Nenhum microfone encontrado.')
    expect(mensagemErroDitado('network')).toBe('Sem conexão com o serviço de ditado.')
  })
  it('silêncio e cancelamento passam calados', () => {
    expect(mensagemErroDitado('no-speech')).toBeNull()
    expect(mensagemErroDitado('aborted')).toBeNull()
    expect(mensagemErroDitado(undefined)).toBeNull()
  })
})

describe('problemaGravacao', () => {
  it('vazia não é enviada', () => {
    expect(problemaGravacao(0)).toBe('vazia')
  })
  it('acima de 4 MB não é enviada', () => {
    expect(problemaGravacao(4 * 1024 * 1024 + 1)).toBe('grande')
  })
  it('até 4 MB pode enviar', () => {
    expect(problemaGravacao(4 * 1024 * 1024)).toBeNull()
    expect(problemaGravacao(1000)).toBeNull()
  })
})
