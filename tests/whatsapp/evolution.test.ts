import { describe, expect, it, vi } from 'vitest'
import { EvolutionProvider } from '@/lib/whatsapp/evolution'
import { getProvider } from '@/lib/whatsapp'
import { PermanentSendError, TransientSendError } from '@/lib/whatsapp/provider'
import createInstance from './fixtures/create-instance.json'
import connectFx from './fixtures/connect.json'
import connectionState from './fixtures/connection-state.json'
import fetchInstances from './fixtures/fetch-instances.json'
import sendOk from './fixtures/send-text-response.json'
import sendNotExists from './fixtures/send-text-not-exists.json'
import msgText from './fixtures/webhook-message-text.json'
import msgExtended from './fixtures/webhook-message-extended.json'
import connOpen from './fixtures/webhook-connection-open.json'
import msgLidAlt from './fixtures/webhook-message-lid-alt.json'
import msgLidSenderPn from './fixtures/webhook-message-lid-senderpn.json'
import msgAudio from './fixtures/webhook-message-audio.json'
import msgFromMe from './fixtures/webhook-message-fromme.json'
import mediaB64 from './fixtures/media-base64-response.json'

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function make(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => handler(String(url), init ?? {}))
  const provider = new EvolutionProvider({
    baseUrl: 'http://evo.test/',
    apiKey: 'GLOBAL',
    webhookUrl: 'https://app.test/api/webhooks/evolution?token=t',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { provider, fetchImpl }
}

const hdr = (init: RequestInit, k: string) => (init.headers as Record<string, string>)[k]
// Cópia mutável de um fixture; o tipo solto permite alterar/remover campos aninhados nos testes.
interface Loose {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}
const clone = (o: unknown) => JSON.parse(JSON.stringify(o)) as Loose

describe('EvolutionProvider.sendText', () => {
  it('envia apikey da instância e corpo {number,text}; devolve providerMessageId', async () => {
    const { provider, fetchImpl } = make(() => res(201, sendOk))
    const out = await provider.sendText('clinic-abc', 'TOK', '5511987654321', 'Olá')
    expect(out).toEqual({ providerMessageId: 'BAE5ABC123' })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://evo.test/message/sendText/clinic-abc')
    expect(init.method).toBe('POST')
    expect(hdr(init, 'apikey')).toBe('TOK')
    expect(JSON.parse(init.body as string)).toEqual({ number: '5511987654321', text: 'Olá' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('2xx sem key.id: não lança; devolve providerMessageId vazio (R15)', async () => {
    const { provider } = make(() => res(201, { status: 'PENDING' }))
    await expect(provider.sendText('i', 't', '5511987654321', 'x')).resolves.toEqual({ providerMessageId: '' })
  })

  it('400 exists:false -> PermanentSendError', async () => {
    const { provider } = make(() => res(400, sendNotExists))
    await expect(provider.sendText('i', 't', '5511900000000', 'x')).rejects.toBeInstanceOf(PermanentSendError)
  })
  it('outro 4xx -> PermanentSendError', async () => {
    const { provider } = make(() => res(400, { message: 'invalid' }))
    await expect(provider.sendText('i', 't', '1', 'x')).rejects.toBeInstanceOf(PermanentSendError)
  })
  it('500 -> TransientSendError', async () => {
    const { provider } = make(() => res(500, { error: 'boom' }))
    await expect(provider.sendText('i', 't', '1', 'x')).rejects.toBeInstanceOf(TransientSendError)
  })
  it('instância fechada -> TransientSendError', async () => {
    const { provider } = make(() => res(400, { response: { message: 'Connection Closed' } }))
    await expect(provider.sendText('i', 't', '1', 'x')).rejects.toBeInstanceOf(TransientSendError)
  })
  it('fetch rejeitado e timeout -> TransientSendError', async () => {
    const a = make(() => Promise.reject(new TypeError('fetch failed')))
    await expect(a.provider.sendText('i', 't', '1', 'x')).rejects.toBeInstanceOf(TransientSendError)
    const b = make(() => Promise.reject(new DOMException('timed out', 'TimeoutError')))
    await expect(b.provider.sendText('i', 't', '1', 'x')).rejects.toBeInstanceOf(TransientSendError)
  })
})

describe('EvolutionProvider instance management', () => {
  it('connect cria a instância e devolve token (hash) e QR', async () => {
    const { provider, fetchImpl } = make(() => res(201, createInstance))
    const out = await provider.connect('abc')
    expect(out).toEqual({
      instance: 'clinic-abc',
      token: 'tok-123',
      qrCode: 'data:image/png;base64,QR1',
      status: 'connecting',
    })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://evo.test/instance/create')
    expect(hdr(init, 'apikey')).toBe('GLOBAL')
    expect(JSON.parse(init.body as string)).toEqual({
      instanceName: 'clinic-abc',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        enabled: true,
        url: 'https://app.test/api/webhooks/evolution?token=t',
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
      },
    })
  })

  it('connect com instância existente pede novo QR e recupera o token', async () => {
    const { provider } = make((url) => {
      if (url.endsWith('/instance/create')) return res(403, { status: 403, response: { message: ['already in use'] } })
      if (url.includes('/instance/fetchInstances')) return res(200, [{ ...fetchInstances[0], connectionStatus: 'close' }])
      if (url.includes('/instance/connect/clinic-abc')) return res(200, connectFx)
      return res(404, {})
    })
    expect(await provider.connect('abc')).toEqual({
      instance: 'clinic-abc',
      token: 'tok-123',
      qrCode: 'data:image/png;base64,QR2',
      status: 'connecting',
    })
  })

  it('getStatus mapeia estado e traz o telefone (ownerJid)', async () => {
    const { provider, fetchImpl } = make((url) =>
      url.includes('connectionState') ? res(200, connectionState) : res(200, fetchInstances),
    )
    expect(await provider.getStatus('clinic-abc', 'TOK')).toEqual({ status: 'connected', phone: '5511987654321' })
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe(
      'http://evo.test/instance/fetchInstances?instanceName=clinic-abc',
    )
  })

  it.each([
    ['connecting', 'connecting'],
    ['close', 'disconnected'],
    ['refused', 'disconnected'],
  ])('getStatus %s -> %s', async (state, expected) => {
    const { provider } = make(() => res(200, { instance: { instanceName: 'i', state } }))
    expect(await provider.getStatus('i', 't')).toEqual({ status: expected, phone: null })
  })

  it('disconnect usa DELETE /instance/logout', async () => {
    const { provider, fetchImpl } = make(() => res(200, { status: 'SUCCESS' }))
    await provider.disconnect('clinic-abc', 'TOK')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://evo.test/instance/logout/clinic-abc')
    expect(init.method).toBe('DELETE')
  })
})

describe('EvolutionProvider.parseWebhook', () => {
  const { provider } = make(() => res(200, {}))

  it('texto normal -> incoming', () => {
    expect(provider.parseWebhook(msgText)).toEqual({
      kind: 'incoming',
      instance: 'clinic-abc',
      from: '5511987654321',
      text: '1',
      providerMessageId: 'MSG1',
      at: new Date(1762080000 * 1000),
    })
  })
  it('extendedTextMessage -> incoming', () => {
    expect(provider.parseWebhook(msgExtended)).toMatchObject({ kind: 'incoming', text: 'Sim', from: '5511987654321' })
  })
  it('JID sem o 9 casa com o celular canônico', () => {
    const b = clone(msgText)
    b.data.key.remoteJid = '551187654321@s.whatsapp.net'
    expect(provider.parseWebhook(b)).toMatchObject({ kind: 'incoming', from: '5511987654321' })
  })
  it('@lid com remoteJidAlt usa o telefone do alt', () => {
    expect(provider.parseWebhook(msgLidAlt)).toMatchObject({
      kind: 'incoming',
      from: '5511987654321',
      text: '1',
      providerMessageId: 'MSGLID1',
    })
  })
  it('@lid com senderPn usa o telefone do senderPn', () => {
    expect(provider.parseWebhook(msgLidSenderPn)).toMatchObject({ kind: 'incoming', from: '5511987654321', text: '2' })
  })
  it('@lid: primeiro campo que termina em @s.whatsapp.net vence', () => {
    const b = clone(msgLidAlt)
    b.data.key.remoteJidAlt = '999@lid'
    b.data.key.senderPn = '5511922223333@s.whatsapp.net'
    expect(provider.parseWebhook(b)).toMatchObject({ from: '5511922223333' })
  })
  it('@lid sem remoteJidAlt/senderPn -> null', () => {
    const b = clone(msgLidAlt)
    delete b.data.key.remoteJidAlt
    expect(provider.parseWebhook(b)).toBeNull()
  })
  it('sem messageTimestamp usa a data atual', () => {
    const b = clone(msgText)
    delete b.data.messageTimestamp
    const ev = provider.parseWebhook(b)
    expect(ev?.kind === 'incoming' && Math.abs(ev.at.getTime() - Date.now()) < 5000).toBe(true)
  })
  it('áudio -> incoming com text vazio e seconds', () => {
    expect(provider.parseWebhook(msgAudio)).toEqual({
      kind: 'incoming',
      instance: 'clinic-abc',
      from: '5511987654321',
      text: '',
      audio: { seconds: 12 },
      providerMessageId: 'MSGAUD1',
      at: new Date(1762080000 * 1000),
    })
  })
  it('áudio sem seconds -> seconds 0', () => {
    const b = clone(msgAudio)
    delete b.data.message.audioMessage.seconds
    expect(provider.parseWebhook(b)).toMatchObject({ audio: { seconds: 0 } })
  })
  it('fromMe de texto -> outgoing com to normalizado', () => {
    expect(provider.parseWebhook(msgFromMe)).toEqual({
      kind: 'outgoing',
      instance: 'clinic-abc',
      to: '5511987654321',
      text: 'Olá, confirmado!',
      providerMessageId: 'MSGOUT1',
      at: new Date(1762080100 * 1000),
    })
  })
  it('fromMe de áudio -> outgoing "[áudio]"', () => {
    const b = clone(msgAudio)
    b.data.key.fromMe = true
    expect(provider.parseWebhook(b)).toMatchObject({ kind: 'outgoing', text: '[áudio]', to: '5511987654321' })
  })
  it('fromMe com @lid usa o telefone do alt', () => {
    const b = clone(msgLidAlt)
    b.data.key.fromMe = true
    expect(provider.parseWebhook(b)).toMatchObject({ kind: 'outgoing', to: '5511987654321' })
  })
  it('fromMe em grupo, broadcast, newsletter ou sem conteúdo -> null', () => {
    for (const jid of ['120363000000@g.us', 'status@broadcast', '123@newsletter']) {
      const b = clone(msgFromMe)
      b.data.key.remoteJid = jid
      expect(provider.parseWebhook(b)).toBeNull()
    }
    const empty = clone(msgFromMe)
    empty.data.message = { reactionMessage: {} }
    expect(provider.parseWebhook(empty)).toBeNull()
  })
  it('grupo, status@broadcast, fixo e corpo inválido -> null', () => {
    const group = clone(msgText)
    group.data.key.remoteJid = '120363000000@g.us'
    const status = clone(msgText)
    status.data.key.remoteJid = 'status@broadcast'
    const landline = clone(msgText)
    landline.data.key.remoteJid = '551133334444@s.whatsapp.net'
    const other = clone(msgText)
    other.event = 'qrcode.updated'
    for (const b of [group, status, landline, other, null, 'x', 42, {}, { event: 'messages.upsert' }]) {
      expect(provider.parseWebhook(b)).toBeNull()
    }
  })
  it('aceita nome de evento em MAIÚSCULAS com underscore', () => {
    const b = clone(msgText)
    b.event = 'MESSAGES_UPSERT'
    expect(provider.parseWebhook(b)).toMatchObject({ kind: 'incoming' })
  })
  it('connection.update open -> connected com telefone do wuid', () => {
    expect(provider.parseWebhook(connOpen)).toEqual({
      kind: 'connection',
      instance: 'clinic-abc',
      status: 'connected',
      phone: '5511987654321',
    })
  })
  it('connection.update sem dono -> phone null; estados mapeados', () => {
    const mk = (state: string) => ({ event: 'connection.update', instance: 'i', data: { state } })
    expect(provider.parseWebhook(mk('connecting'))).toEqual({
      kind: 'connection',
      instance: 'i',
      status: 'connecting',
      phone: null,
    })
    expect(provider.parseWebhook(mk('close'))).toEqual({
      kind: 'connection',
      instance: 'i',
      status: 'disconnected',
      phone: null,
    })
  })
})

describe('EvolutionProvider.getAudio', () => {
  it('monta URL e corpo, envia apikey da instância e decodifica base64', async () => {
    const { provider, fetchImpl } = make(() => res(200, mediaB64))
    const out = await provider.getAudio('clinic-abc', 'TOK', 'MSGAUD1')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://evo.test/chat/getBase64FromMediaMessage/clinic-abc')
    expect(init.method).toBe('POST')
    expect(hdr(init, 'apikey')).toBe('TOK')
    expect(JSON.parse(String(init.body))).toEqual({ message: { key: { id: 'MSGAUD1' } }, convertToMp4: false })
    expect(Buffer.from(out.bytes).toString()).toBe('hello')
    expect(out.mimetype).toBe('audio/ogg; codecs=opus')
  })
  it('HTTP 500 -> TransientSendError', async () => {
    const { provider } = make(() => res(500, {}))
    await expect(provider.getAudio('i', 't', 'x')).rejects.toBeInstanceOf(TransientSendError)
  })
  it('resposta sem base64 -> TransientSendError', async () => {
    const { provider } = make(() => res(200, { mimetype: 'audio/ogg' }))
    await expect(provider.getAudio('i', 't', 'x')).rejects.toBeInstanceOf(TransientSendError)
  })
})

describe('getProvider', () => {
  it('lança erro claro quando faltam variáveis', () => {
    vi.stubEnv('EVOLUTION_API_URL', '')
    vi.stubEnv('EVOLUTION_API_KEY', 'k')
    vi.stubEnv('APP_URL', 'https://app.test')
    vi.stubEnv('EVOLUTION_WEBHOOK_TOKEN', 't')
    expect(() => getProvider()).toThrow(/EVOLUTION_API_URL/)
    vi.unstubAllEnvs()
  })
  it('constrói com todas as variáveis', () => {
    vi.stubEnv('EVOLUTION_API_URL', 'http://evo')
    vi.stubEnv('EVOLUTION_API_KEY', 'k')
    vi.stubEnv('APP_URL', 'https://app.test')
    vi.stubEnv('EVOLUTION_WEBHOOK_TOKEN', 't')
    expect(getProvider()).toBeInstanceOf(EvolutionProvider)
    vi.unstubAllEnvs()
  })
})
