'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Appointment } from '@/types'

export type ReplyAction = 'confirmed' | 'cancelled'
export type WhatsAppIndicator = 'confirmed' | 'sent'

export interface MessageRow {
  appointment_id: string | null
  type: string
  status: string
  reply_action?: ReplyAction | null
  created_at: string
}

export interface CancelNotice {
  appointment: Appointment
  repliedAt: string
}

const DAY_MS = 24 * 3_600_000
const CHUNK = 200

/** "Confirmada pelo WhatsApp" (resposta confirmou E a consulta está confirmada) > "Confirmação enviada". */
export function computeIndicators(
  rows: MessageRow[],
  appointments: Pick<Appointment, 'id' | 'status'>[],
): Map<string, WhatsAppIndicator> {
  const status = new Map(appointments.map((a) => [a.id, a.status]))
  const out = new Map<string, WhatsAppIndicator>()
  for (const r of rows) {
    if (!r.appointment_id || !status.has(r.appointment_id)) continue
    if (r.type === 'incoming' && r.reply_action === 'confirmed' && status.get(r.appointment_id) === 'confirmed') {
      out.set(r.appointment_id, 'confirmed')
    } else if (r.type === 'confirmation' && r.status === 'sent' && !out.has(r.appointment_id)) {
      out.set(r.appointment_id, 'sent')
    }
  }
  return out
}

/** Consultas desmarcadas por resposta WhatsApp nas últimas 24 h e ainda canceladas, mais antigas primeiro. */
export function computeCancelNotices(rows: MessageRow[], appointments: Appointment[], now: Date): CancelNotice[] {
  const byId = new Map(appointments.map((a) => [a.id, a]))
  const since = now.getTime() - DAY_MS
  const seen = new Map<string, CancelNotice>()
  for (const r of rows) {
    if (!r.appointment_id || r.type !== 'incoming' || r.reply_action !== 'cancelled') continue
    const at = new Date(r.created_at).getTime()
    if (at < since || at > now.getTime()) continue
    const apt = byId.get(r.appointment_id)
    if (!apt || apt.status !== 'cancelled' || seen.has(apt.id)) continue
    seen.set(apt.id, { appointment: apt, repliedAt: r.created_at })
  }
  return [...seen.values()].sort((a, b) => a.repliedAt.localeCompare(b.repliedAt))
}

/** dd/MM HH:mm em America/Sao_Paulo. */
export function formatNoticeTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`
}

const SELECT = 'appointment_id, type, status, reply_action, created_at'

/**
 * visible: consultas do intervalo exibido (indicadores; ids em chunks de ≤200);
 * all: consultas carregadas (aviso de desmarcações; incoming com reply_action cancelled e created_at ≥ 24 h).
 */
export function useWhatsAppStatus(visible: Appointment[], all: Appointment[]) {
  const [indicatorRows, setIndicatorRows] = useState<MessageRow[]>([])
  const [cancelState, setCancelState] = useState<{ rows: MessageRow[]; now: Date }>({ rows: [], now: new Date(0) })

  const idsKey = useMemo(() => visible.map((a) => a.id).sort().join(','), [visible])

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    if (ids.length === 0) return
    let active = true
    const supabase = createClient()
    void (async () => {
      const rows: MessageRow[] = []
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await supabase
          .from('messages')
          .select(SELECT)
          .in('appointment_id', ids.slice(i, i + CHUNK))
          .in('type', ['confirmation', 'incoming'])
        if (error) return // indicadores são opcionais: falha silenciosa
        rows.push(...((data ?? []) as MessageRow[]))
      }
      if (active) setIndicatorRows(rows)
    })()
    return () => {
      active = false
    }
  }, [idsKey])

  useEffect(() => {
    if (all.length === 0) return
    let active = true
    const now = new Date()
    createClient()
      .from('messages')
      .select(SELECT)
      .eq('type', 'incoming')
      .eq('reply_action', 'cancelled')
      .gte('created_at', new Date(now.getTime() - DAY_MS).toISOString())
      .then(({ data, error }) => {
        if (active && !error) setCancelState({ rows: (data ?? []) as MessageRow[], now })
      })
    return () => {
      active = false
    }
  }, [all])

  const indicators = useMemo(() => computeIndicators(indicatorRows, visible), [indicatorRows, visible])
  const cancelNotices = useMemo(
    () => computeCancelNotices(cancelState.rows, all, cancelState.now),
    [cancelState, all],
  )
  return { indicators, cancelNotices }
}
