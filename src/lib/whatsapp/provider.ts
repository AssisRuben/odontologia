export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

/** Mensagem de áudio como veio no webhook (key + message), usada para baixar o arquivo. */
export type AudioMedia = { key: Record<string, unknown>; message: Record<string, unknown> }

export type WebhookEvent =
  | {
      kind: 'incoming'
      instance: string
      from: string
      text: string
      audio?: { seconds: number; media: AudioMedia }
      providerMessageId: string
      at: Date
    }
  | { kind: 'outgoing'; instance: string; to: string; text: string; providerMessageId: string; at: Date }
  | { kind: 'connection'; instance: string; status: ConnectionStatus; phone: string | null }

export interface WhatsAppProvider {
  connect(clinicId: string): Promise<{ instance: string; token: string; qrCode: string | null; status: ConnectionStatus }>
  getStatus(instance: string, token: string): Promise<{ status: ConnectionStatus; phone: string | null }>
  disconnect(instance: string, token: string): Promise<void>
  sendText(instance: string, token: string, to: string, text: string): Promise<{ providerMessageId: string }>
  getAudio(instance: string, token: string, media: AudioMedia): Promise<{ bytes: Uint8Array; mimetype: string }>
  parseWebhook(body: unknown): WebhookEvent | null
}

/** Falha que não se resolve com nova tentativa (número sem WhatsApp, requisição inválida). */
export class PermanentSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentSendError'
  }
}

/** Falha temporária (rede, timeout, 5xx, instância desconectada): vale tentar de novo. */
export class TransientSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientSendError'
  }
}
