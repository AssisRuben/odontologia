import { describe, it, expect } from 'vitest'
import { getSpeechRecognition, pickRecorderMime } from '@/components/ia/fala'

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
