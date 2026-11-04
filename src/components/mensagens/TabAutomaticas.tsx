'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, findUnknownVariables, renderTemplate } from '@/lib/messaging/templates'
import type { MessageSetting, MessageType } from '@/lib/messaging/types'
import {
  DEFAULT_TZ, resolveTz, SETTING_META, SETTING_ORDER, buildPreviewContext, configToForm, insertAtCursor, validateConfig, variablesFor,
  type ConfigForm,
} from './helpers'

type Notice = { kind: 'ok' | 'error'; text: string } | null

interface CardProps {
  setting: MessageSetting
  clinicName: string
  tz: string
  onSaved: (s: MessageSetting) => void
  onToggle: (type: MessageType, enabled: boolean) => Promise<string | null>
  saveSetting: (type: MessageType, patch: { template: string; config: MessageSetting['config'] }) => Promise<string | null>
}

function SettingCard({ setting, clinicName, tz, onSaved, onToggle, saveSetting }: CardProps) {
  const { type } = setting
  const meta = SETTING_META[type]
  const [template, setTemplate] = useState(setting.template)
  const [form, setForm] = useState<ConfigForm>(() => configToForm(type, setting.config))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [toggling, setToggling] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const unknown = useMemo(() => findUnknownVariables(template), [template])
  const preview = useMemo(
    () => renderTemplate(template, buildPreviewContext(clinicName, tz)),
    [template, clinicName, tz],
  )
  const empty = template.trim() === ''

  function insertVariable(v: string) {
    const el = areaRef.current
    const focused = el !== null && document.activeElement === el
    const start = focused ? el.selectionStart : template.length
    const end = focused ? el.selectionEnd : template.length
    const r = insertAtCursor(template, start, end, `{${v}}`)
    setTemplate(r.value)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(r.cursor, r.cursor)
    })
  }

  async function handleToggle() {
    if (toggling) return
    setNotice(null)
    setToggling(true)
    const err = await onToggle(type, !setting.enabled)
    setToggling(false)
    if (err) setNotice({ kind: 'error', text: err })
  }

  async function handleSave() {
    setNotice(null)
    if (empty) return
    const res = validateConfig(type, form)
    if (!res.ok) {
      setNotice({ kind: 'error', text: res.error })
      return
    }
    setSaving(true)
    const next: MessageSetting = { ...setting, template, config: res.config }
    const err = await saveSetting(type, { template, config: res.config })
    setSaving(false)
    if (err) {
      setNotice({ kind: 'error', text: err })
      return
    }
    onSaved(next)
    setTemplate(next.template)
    setForm(configToForm(type, res.config))
    setNotice({ kind: 'ok', text: 'Alterações salvas.' })
  }

  const inputCls = 'w-20 px-2 py-1.5 border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:outline-none focus:border-[#3B82F6]'

  return (
    <div className="bg-white rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="font-semibold text-[#111827]">{meta.title}</h3>
          <p className="text-sm text-[#6B7280]">{meta.description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={setting.enabled}
          aria-label={`${setting.enabled ? 'Desligar' : 'Ligar'} ${meta.title}`}
          disabled={toggling}
          onClick={handleToggle}
          className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${setting.enabled ? 'bg-[#10B981]' : 'bg-[#D1D5DB]'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${setting.enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      <div className="mb-4 text-sm text-[#111827] flex items-center gap-2 flex-wrap">
        {(type === 'confirmation' || type === 'reminder') && (
          <>
            <label htmlFor={`cfg-${type}`} className="font-medium">Horas antes</label>
            <input id={`cfg-${type}`} type="number" min={1} max={72} step={1} value={form.offset}
              onChange={(e) => setForm({ ...form, offset: e.target.value })} className={inputCls} />
          </>
        )}
        {type === 'recall' && (
          <>
            <label htmlFor={`cfg-${type}`} className="font-medium">Meses após a última consulta</label>
            <input id={`cfg-${type}`} type="number" min={1} max={24} step={1} value={form.offset}
              onChange={(e) => setForm({ ...form, offset: e.target.value })} className={inputCls} />
          </>
        )}
        {type === 'charge' && (
          <>
            <span className="font-medium">Dias após o vencimento</span>
            {[0, 1].map((i) => (
              <input key={i} aria-label={`Dias após o vencimento (${i + 1}º envio)`} type="number" min={1} max={60} step={1}
                value={form.days[i] ?? ''}
                onChange={(e) => {
                  const days = [...form.days]
                  days[i] = e.target.value
                  setForm({ ...form, days })
                }}
                className={inputCls} />
            ))}
          </>
        )}
        {type === 'payment_due' && (
          <>
            <label htmlFor={`cfg-${type}`} className="font-medium">Dias antes do vencimento</label>
            <input id={`cfg-${type}`} type="number" min={1} max={60} step={1} value={form.days[0] ?? ''}
              onChange={(e) => setForm({ ...form, days: [e.target.value] })} className={inputCls} />
          </>
        )}
        {type === 'birthday' && <span className="text-[#6B7280]">Enviado no dia, às 9h</span>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`tpl-${type}`} className="block text-sm font-medium text-[#111827] mb-1">Texto da mensagem</label>
          <textarea
            id={`tpl-${type}`}
            ref={areaRef}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={7}
            className="w-full px-3 py-2 border border-[#E5E7EB] rounded-lg text-sm text-[#111827] focus:outline-none focus:border-[#3B82F6]"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {variablesFor(type, TEMPLATE_VARIABLES).map((v) => (
              <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v)}
                className="px-2 py-0.5 text-xs rounded-full bg-[#EFF6FF] text-[#3B82F6] hover:bg-[#DBEAFE]">
                {`{${v}}`}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="block text-sm font-medium text-[#111827] mb-1">Prévia</div>
          <div className="rounded-lg bg-[#DCF8C6] px-3 py-2 text-sm text-[#111827] whitespace-pre-wrap min-h-[8.5rem] break-words">
            {preview}
          </div>
        </div>
      </div>

      {unknown.length > 0 && (
        <div className="mt-3 text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-3 py-2">
          Variáveis desconhecidas (serão enviadas como aparecem): {unknown.map((u) => `{${u}}`).join(', ')}
        </div>
      )}
      {empty && <p className="mt-3 text-sm text-red-600">O texto não pode ficar vazio</p>}
      {notice && (
        <p className={`mt-3 text-sm ${notice.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`} role="status">{notice.text}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={handleSave} disabled={empty || saving}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[#3B82F6] text-white hover:bg-[#2563EB] disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
        <button type="button" onClick={() => setTemplate(DEFAULT_TEMPLATES[type])}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-[#E5E7EB] text-[#6B7280] hover:text-[#111827]">
          Restaurar texto padrão
        </button>
      </div>
    </div>
  )
}

export default function TabAutomaticas() {
  const { clinicId } = useClinicStore()
  const [supabase] = useState(() => createClient())
  const [settings, setSettings] = useState<MessageSetting[] | null>(null)
  const [clinicName, setClinicName] = useState('')
  const [tz, setTz] = useState(DEFAULT_TZ)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notConnected, setNotConnected] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/whatsapp/status', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<{ status?: string }>) : null))
      .then((data) => {
        if (active && data) setNotConnected(data.status !== 'connected')
      })
      .catch(() => {}) // falha de rede: sem aviso
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!clinicId) return
    let cancelled = false
    async function load() {
      const [s, c] = await Promise.all([
        supabase.from('message_settings').select('type, enabled, template, config').eq('clinic_id', clinicId),
        supabase.from('clinics').select('name, messaging_config').eq('id', clinicId).maybeSingle(),
      ])
      if (cancelled) return
      if (s.error) {
        setLoadError('Não foi possível carregar as mensagens automáticas.')
        return
      }
      const byType = new Map((s.data ?? []).map((r) => [r.type as MessageType, r as MessageSetting]))
      setSettings(SETTING_ORDER.flatMap((t) => (byType.has(t) ? [byType.get(t)!] : [])))
      setClinicName((c.data?.name as string | undefined) ?? '')
      const cfgTz = (c.data?.messaging_config as { timezone?: string } | null)?.timezone
      setTz(resolveTz(cfgTz))
    }
    load()
    return () => { cancelled = true }
  }, [clinicId, supabase])

  async function persist(type: MessageType, patch: Partial<Pick<MessageSetting, 'enabled' | 'template' | 'config'>>): Promise<string | null> {
    const { data, error } = await supabase
      .from('message_settings')
      .update(patch)
      .eq('clinic_id', clinicId)
      .eq('type', type)
      .select('type')
    if (error) return 'Não foi possível salvar. Tente novamente.'
    if (!data || data.length === 0) return 'Não foi possível salvar: configuração não encontrada.'
    return null
  }

  async function handleToggle(type: MessageType, enabled: boolean): Promise<string | null> {
    const current = settings?.find((s) => s.type === type)
    if (!current) return null
    const replace = (v: boolean) =>
      setSettings((prev) => prev?.map((s) => (s.type === type ? { ...s, enabled: v } : s)) ?? prev)
    replace(enabled) // otimista
    const err = await persist(type, { enabled })
    if (err) replace(current.enabled)
    return err
  }

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>
  if (!settings) return <p className="text-sm text-[#9CA3AF]">Carregando...</p>
  if (settings.length === 0) return <p className="text-sm text-[#6B7280]">Nenhuma mensagem automática configurada para esta clínica.</p>

  return (
    <div className="space-y-4 max-w-5xl">
      {notConnected && (
        <div className="text-sm bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl px-4 py-3" role="status">
          WhatsApp não conectado — as mensagens só serão enviadas depois de conectar em{' '}
          <Link href="/configuracoes/mensagens" className="font-semibold underline underline-offset-2 hover:opacity-90">
            Configurações de mensagens
          </Link>
          .
        </div>
      )}
      {settings.map((s) => (
        <SettingCard
          key={s.type}
          setting={s}
          clinicName={clinicName}
          tz={tz}
          saveSetting={persist}
          onToggle={handleToggle}
          onSaved={(next) => setSettings((prev) => prev?.map((x) => (x.type === next.type ? { ...x, template: next.template, config: next.config } : x)) ?? prev)}
        />
      ))}
    </div>
  )
}
