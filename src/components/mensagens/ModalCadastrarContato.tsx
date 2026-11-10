'use client'

import { useState } from 'react'
import { MAX_NAME_CHARS } from '@/lib/agente/conversa'
import { formatWhatsAppPhone } from './helpers'

interface Props {
  conversaId: string
  phone: string
  nomeInicial: string
  onClose: () => void
  onDone: () => void
}

export default function ModalCadastrarContato({ conversaId, phone, nomeInicial, onClose, onDone }: Props) {
  const [name, setName] = useState(nomeInicial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/conversas/${conversaId}/paciente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Não foi possível cadastrar.'); return }
      onDone()
    } catch {
      setError('Não foi possível cadastrar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl border border-linha p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-tinta mb-4">Cadastrar paciente</h2>
        <label className="block text-xs font-medium text-tinta-3 mb-1">Nome</label>
        <input value={name} maxLength={MAX_NAME_CHARS} onChange={(e) => setName(e.target.value)}
          className="w-full border border-linha rounded-lg px-3 py-2 text-sm text-tinta mb-3 focus:outline-none focus:border-petroleo" />
        <label className="block text-xs font-medium text-tinta-3 mb-1">Telefone</label>
        <input value={formatWhatsAppPhone(phone)} readOnly
          className="w-full border border-linha rounded-lg px-3 py-2 text-sm text-tinta-3 bg-porcelana-2 mb-3" />
        {error && <p className="text-sm text-[#EF4444] mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-tinta-3 hover:text-tinta">Cancelar</button>
          <button onClick={save} disabled={saving || !name.trim()}
            className="px-4 py-2 text-sm font-medium bg-petroleo text-white rounded-lg disabled:opacity-50">
            {saving ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
