import { normalizePhone } from '@/lib/messaging/phone'
import {
  PermanentSendError,
  TransientSendError,
  type ConnectionStatus,
  type WebhookEvent,
  type WhatsAppProvider,
} from './provider'

const TIMEOUT_MS = 15_000

export interface EvolutionOptions {
  baseUrl: string
  apiKey: string
  webhookUrl: string
  fetchImpl?: typeof fetch
}

type Json = Record<string, unknown>

/** Lê um caminho aninhado de um JSON não confiável; devolve undefined se algo no caminho não for objeto. */
function dig(v: unknown, ...path: string[]): unknown {
  let cur: unknown = v
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Json)[k]
  }
  return cur
}

function asObject(v: unknown): Json | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null
}

function mapState(state: unknown): ConnectionStatus {
  if (state === 'open') return 'connected'
  if (state === 'connecting') return 'connecting'
  return 'disconnected'
}

/** Extrai o telefone canônico de um JID (`5511...@s.whatsapp.net`, com ou sem `:device`). */
function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) return null
  return normalizePhone(jid.split('@')[0].split(':')[0])
}

export class EvolutionProvider implements WhatsAppProvider {
  private baseUrl: string
  private apiKey: string
  private webhookUrl: string
  private fetchImpl: typeof fetch

  constructor(opts: EvolutionOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey
    this.webhookUrl = opts.webhookUrl
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  /** Chamada HTTP com timeout. Falha de rede/timeout vira TransientSendError. */
  private async request(method: string, path: string, key: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      throw new TransientSendError(`Falha de rede ao chamar a Evolution API: ${(e as Error).message}`)
    }
  }

  private async readJson(res: Response): Promise<{ json: unknown; text: string }> {
    const text = await res.text().catch(() => '')
    try {
      return { json: JSON.parse(text), text }
    } catch {
      return { json: null, text }
    }
  }

  private async fetchInstance(instance: string, key: string): Promise<Json | null> {
    const res = await this.request('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`, key)
    if (!res.ok) return null
    const { json } = await this.readJson(res)
    const list: unknown[] = Array.isArray(json) ? json : json ? [json] : []
    for (const raw of list) {
      const item = asObject(raw)
      if (!item) continue
      const nested = asObject(item.instance) ?? {}
      const name = item.name ?? item.instanceName ?? nested.instanceName
      if (name === instance) return { ...nested, ...item }
    }
    return null
  }

  async connect(clinicId: string) {
    const instance = `clinic-${clinicId}`
    const res = await this.request('POST', '/instance/create', this.apiKey, {
      instanceName: instance,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: { enabled: true, url: this.webhookUrl, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] },
    })

    if (res.ok) {
      const { json } = await this.readJson(res)
      const token = dig(json, 'hash')
      if (typeof token !== 'string' || !token) throw new Error('Evolution API: resposta de criação sem "hash"')
      const qr = dig(json, 'qrcode', 'base64')
      return { instance, token, qrCode: typeof qr === 'string' && qr ? qr : null, status: 'connecting' as const }
    }

    // Instância já existe (Evolution responde 403 "already in use"): reaproveita e pede novo QR.
    const { text } = await this.readJson(res)
    if (res.status === 403 || res.status === 409 || /already in use|already exists/i.test(text)) {
      const existing = await this.fetchInstance(instance, this.apiKey)
      const token = typeof existing?.token === 'string' ? existing.token : null
      if (!token) throw new Error('Evolution API: instância existente sem token')
      const cres = await this.request('GET', `/instance/connect/${encodeURIComponent(instance)}`, this.apiKey)
      if (!cres.ok) throw new Error(`Evolution API: falha ao gerar QR (HTTP ${cres.status})`)
      const { json } = await this.readJson(cres)
      const qr = dig(json, 'base64')
      return {
        instance,
        token,
        qrCode: typeof qr === 'string' && qr ? qr : null,
        status: mapState(existing?.connectionStatus) === 'connected' ? ('connected' as const) : ('connecting' as const),
      }
    }
    throw new Error(`Evolution API: falha ao criar instância (HTTP ${res.status})`)
  }

  async getStatus(instance: string, token: string) {
    const res = await this.request('GET', `/instance/connectionState/${encodeURIComponent(instance)}`, token)
    if (!res.ok) {
      if (res.status === 404) return { status: 'disconnected' as const, phone: null }
      throw new Error(`Evolution API: falha ao consultar estado (HTTP ${res.status})`)
    }
    const { json } = await this.readJson(res)
    const status = mapState(dig(json, 'instance', 'state') ?? dig(json, 'state'))
    let phone: string | null = null
    if (status === 'connected') {
      const info = await this.fetchInstance(instance, token).catch(() => null)
      phone = phoneFromJid(info?.ownerJid)
    }
    return { status, phone }
  }

  async disconnect(instance: string, token: string) {
    const res = await this.request('DELETE', `/instance/logout/${encodeURIComponent(instance)}`, token)
    // 400/404 = já desconectada ou inexistente: o objetivo (estar desconectada) já está atingido.
    if (!res.ok && res.status !== 404 && res.status !== 400) {
      throw new Error(`Evolution API: falha ao desconectar (HTTP ${res.status})`)
    }
  }

  /**
   * Classificação de erros do envio:
   *  - rede/timeout, HTTP 5xx, 408, 429 -> Transient
   *  - corpo com `exists: false` (número sem WhatsApp) -> Permanent
   *  - corpo indicando instância fechada ("Connection Closed", "not connected", ...) -> Transient
   *  - demais 4xx (400 inválido, 401, 403, 404) -> Permanent
   */
  async sendText(instance: string, token: string, to: string, text: string) {
    const res = await this.request('POST', `/message/sendText/${encodeURIComponent(instance)}`, token, {
      number: to,
      text,
    })
    const { json, text: raw } = await this.readJson(res)

    if (res.ok) {
      const id = dig(json, 'key', 'id')
      // R15: 2xx sem key.id ainda é envio aceito — não reenviar (duplicaria a mensagem ao paciente).
      return { providerMessageId: typeof id === 'string' ? id : '' }
    }

    if (res.status >= 500 || res.status === 408 || res.status === 429) {
      throw new TransientSendError(`Evolution API: HTTP ${res.status}`)
    }
    const messages = dig(json, 'response', 'message')
    const notOnWhatsApp =
      Array.isArray(messages) && messages.some((m: unknown) => dig(m, 'exists') === false)
    if (notOnWhatsApp) throw new PermanentSendError('Número não possui WhatsApp')
    if (/connection closed|not connected|disconnected/i.test(raw)) {
      throw new TransientSendError('Instância do WhatsApp desconectada')
    }
    throw new PermanentSendError(`Evolution API recusou o envio (HTTP ${res.status})`)
  }

  parseWebhook(body: unknown): WebhookEvent | null {
    const b = asObject(body)
    if (!b || typeof b.instance !== 'string' || !b.instance) return null
    const data = asObject(b.data)
    if (!data) return null
    const event = typeof b.event === 'string' ? b.event.toLowerCase().replace(/_/g, '.') : ''

    if (event === 'connection.update') {
      const phone = phoneFromJid(data.wuid) ?? phoneFromJid(data.ownerJid) ?? phoneFromJid(b.sender)
      return { kind: 'connection', instance: b.instance, status: mapState(data.state), phone }
    }

    if (event === 'messages.upsert') {
      const key = asObject(data.key)
      if (!key || key.fromMe !== false) return null
      const id = key.id
      if (typeof id !== 'string' || !id) return null
      // Endereçamento LID: remoteJid é um id opaco (`...@lid`); o telefone vem em remoteJidAlt ou senderPn.
      const isPhoneJid = (v: unknown): v is string => typeof v === 'string' && v.endsWith('@s.whatsapp.net')
      const jid =
        typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@lid')
          ? [key.remoteJidAlt, key.senderPn].find(isPhoneJid)
          : key.remoteJid
      if (!isPhoneJid(jid)) return null
      const msg = asObject(data.message)
      const text = msg?.conversation ?? asObject(msg?.extendedTextMessage)?.text
      if (typeof text !== 'string' || !text.trim()) return null
      const from = normalizePhone(jid.split('@')[0])
      if (!from) return null
      const ts = Number(data.messageTimestamp)
      const at = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date()
      return { kind: 'incoming', instance: b.instance, from, text, providerMessageId: id, at }
    }
    return null
  }
}
