import { describe, it, expect } from 'vitest'
import {
  MAX_REINICIOS_SEM_TEXTO,
  deveReiniciar,
  getSpeechRecognition,
  mensagemErroDitado,
  modoReconhecimento,
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

describe('deveReiniciar', () => {
  it('reinicia no Android enquanto o usuário quer ouvir e abaixo do limite', () => {
    expect(deveReiniciar(true, true, 0)).toBe(true)
    expect(deveReiniciar(true, true, MAX_REINICIOS_SEM_TEXTO - 1)).toBe(true)
  })
  it('para após 3 reinícios sem texto final', () => {
    expect(MAX_REINICIOS_SEM_TEXTO).toBe(3)
    expect(deveReiniciar(true, true, 3)).toBe(false)
  })
  it('não reinicia fora do Android nem depois de Parar/erro', () => {
    expect(deveReiniciar(false, true, 0)).toBe(false)
    expect(deveReiniciar(true, false, 0)).toBe(false)
  })
})

describe('mensagemErroDitado', () => {
  it('microfone negado', () => {
    expect(mensagemErroDitado('not-allowed')).toBe('Permita o uso do microfone no navegador.')
  })
  it('ditado indisponível no navegador', () => {
    const msg = 'O ditado não está disponível neste navegador. Use o Gravar ou o microfone do teclado.'
    expect(mensagemErroDitado('language-not-supported')).toBe(msg)
    expect(mensagemErroDitado('service-not-allowed')).toBe(msg)
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
