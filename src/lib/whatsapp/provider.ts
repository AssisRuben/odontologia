export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export type WebhookEvent =
  | { kind: 'incoming'; instance: string; from: string; text: string; providerMessageId: string; at: Date }
  | { kind: 'connection'; instance: string; status: ConnectionStatus; phone: string | null }

export interface WhatsAppProvider {
  connect(clinicId: string): Promise<{ instance: string; token: string; qrCode: string | null; status: ConnectionStatus }>
  getStatus(instance: string, token: string): Promise<{ status: ConnectionStatus; phone: string | null }>
  disconnect(instance: string, token: string): Promise<void>
  sendText(instance: string, token: string, to: string, text: string): Promise<{ providerMessageId: string }>
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
