import { PermanentSendError, type WhatsAppProvider } from '@/lib/whatsapp/provider'
import type { MessagingConfig } from './types'
import type { QueueRepo } from './repo'
import { isWithinSendWindow, startOfClinicDay } from './window'

export interface SendDeps {
  now: () => Date
  sleep: (ms: number) => Promise<void>
  random: () => number
  deadline: Date
}

export interface ProcessResult {
  sent: number
  failed: number
  requeued: number
  skippedReason?: 'disconnected' | 'outside_window' | 'daily_limit'
}

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 5 * 60_000
const STUCK_AFTER_MS = 10 * 60_000
const BATCH_SIZE = 50
/** Timeout do fetch no provedor: só inicia um envio se ele cabe inteiro antes do prazo. */
const SEND_HEADROOM_MS = 15_000

/**
 * Cota diária e intervalo entre envios valem por execução. O cron (a cada 5 min, deadline de 50 s) não
 * se sobrepõe; disparos manuais podem sobrepor, e o lock() evita apenas envio duplicado da mesma mensagem.
 */
export async function processQueue(args: {
  clinicId: string
  cfg: MessagingConfig
  instance: string
  token: string
  connected: boolean
  repo: QueueRepo
  provider: WhatsAppProvider
  deps: SendDeps
}): Promise<ProcessResult> {
  const { clinicId, cfg, instance, token, connected, repo, provider, deps } = args
  const result: ProcessResult = { sent: 0, failed: 0, requeued: 0 }

  if (!connected) return { ...result, skippedReason: 'disconnected' }

  const start = deps.now()
  await repo.releaseStuck(clinicId, new Date(start.getTime() - STUCK_AFTER_MS))

  if (!isWithinSendWindow(start, cfg)) return { ...result, skippedReason: 'outside_window' }

  const alreadySent = await repo.countSentSince(clinicId, startOfClinicDay(start, cfg.timezone))
  let quota = cfg.daily_limit - alreadySent
  if (quota <= 0) return { ...result, skippedReason: 'daily_limit' }

  const items = await repo.listDue(clinicId, start, BATCH_SIZE)
  let needsGap = false // houve envio tentado desde a última espera

  const noTimeLeft = () => deps.deadline.getTime() - deps.now().getTime() < SEND_HEADROOM_MS

  for (const item of items) {
    if (noTimeLeft()) break
    if (quota <= 0) {
      result.skippedReason = 'daily_limit'
      break
    }

    if (needsGap) {
      await deps.sleep(3000 + deps.random() * 5000)
      needsGap = false
      if (noTimeLeft()) break
    }
    if (!isWithinSendWindow(deps.now(), cfg)) {
      result.skippedReason = 'outside_window'
      break
    }

    if (!(await repo.lock(item.id))) continue
    needsGap = true

    let providerMessageId: string
    try {
      ;({ providerMessageId } = await provider.sendText(instance, token, item.phone, item.body))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido no envio'
      const attempts = item.attempts + 1 // lock() já incrementou no banco
      if (err instanceof PermanentSendError || attempts >= MAX_ATTEMPTS) {
        await repo.markFailed(item.id, message)
        result.failed++
      } else {
        await repo.requeue(item.id, attempts, new Date(deps.now().getTime() + RETRY_DELAY_MS), message)
        result.requeued++
      }
      continue
    }

    // O provedor aceitou: nunca reenfileirar nem marcar falha. Tenta gravar duas vezes; se falhar, aborta.
    try {
      await repo.markSent(item.id, providerMessageId, deps.now())
    } catch {
      await repo.markSent(item.id, providerMessageId, deps.now())
    }
    result.sent++
    quota--
  }

  return result
}
