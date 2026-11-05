import { EvolutionProvider } from './evolution'
import type { WhatsAppProvider } from './provider'

export * from './provider'
export { EvolutionProvider } from './evolution'

/** Monta o provedor a partir do ambiente. Lê as variáveis só quando chamado. */
export function getProvider(): WhatsAppProvider {
  const baseUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const appUrl = process.env.APP_URL
  const webhookToken = process.env.EVOLUTION_WEBHOOK_TOKEN
  const missing = Object.entries({
    EVOLUTION_API_URL: baseUrl,
    EVOLUTION_API_KEY: apiKey,
    APP_URL: appUrl,
    EVOLUTION_WEBHOOK_TOKEN: webhookToken,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) {
    throw new Error(`Variáveis de ambiente ausentes para o WhatsApp: ${missing.join(', ')}`)
  }
  const webhookUrl = `${appUrl!.replace(/\/+$/, '')}/api/webhooks/evolution?token=${webhookToken}`
  return new EvolutionProvider({ baseUrl: baseUrl!, apiKey: apiKey!, webhookUrl })
}
