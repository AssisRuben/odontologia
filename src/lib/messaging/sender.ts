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
  let attempted = false

  for (const item of items) {
    if (deps.now() >= deps.deadline) break
    if (quota <= 0) {
      result.skippedReason = 'daily_limit'
      break
    }

    if (attempted) {
      await deps.sleep(3000 + deps.random() * 5000)
      if (deps.now() >= deps.deadline) break
    }

    if (!(await repo.lock(item.id))) continue
    attempted = true

    try {
      const { providerMessageId } = await provider.sendText(instance, token, item.phone, item.body)
      await repo.markSent(item.id, providerMessageId, deps.now())
      result.sent++
      quota--
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido no envio'
      const attempts = item.attempts + 1
      if (err instanceof PermanentSendError || attempts >= MAX_ATTEMPTS) {
        await repo.markFailed(item.id, message)
        result.failed++
      } else {
        await repo.requeue(item.id, attempts, new Date(deps.now().getTime() + RETRY_DELAY_MS), message)
        result.requeued++
      }
    }
  }

  return result
}
