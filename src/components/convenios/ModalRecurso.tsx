'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { todayYmd } from '@/lib/messaging/time'
import { parseValor, valorParaTexto } from '@/lib/convenios/valor'

export type GlosaRecurso = {
  item_id: string
  patient_name: string
  code: string
  name: string
  glosa_code: string | null
  glosa_reason: string | null
  glosa_value: number
  recovered_value: number | null
}

export type AcaoRecurso = 'recorrer' | 'resultado' | 'recebimento'

const INPUT = 'h-9 px-2.5 rounded-lg border border-[#E5E7EB] text-sm focus:outline-none focus:ring-2 focus:ring-[#3B82F6] bg-white'
const TITULOS: Record<AcaoRecurso, string> = {
  recorrer: 'Recorrer da glosa',
  resultado: 'Resultado do recurso',
  recebimento: 'Registrar recebimento do recurso',
}

export function ModalRecurso({
  acao,
  glosa,
  onClose,
  onSaved,
}: {
  acao: AcaoRecurso
  glosa: GlosaRecurso
  onClose: () => void
  onSaved: (aviso?: string) => void
}) {
  const hoje = todayYmd(new Date(), 'America/Sao_Paulo')
  const [data, setData] = useState(hoje)
  const [texto, setTexto] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [resultado, setResultado] = useState<'aceito' | 'negado'>('aceito')
  const [valor, setValor] = useState(valorParaTexto(acao === 'recebimento' ? (glosa.recovered_value ?? 0) : glosa.glosa_value))
  const [recebidoEm, setRecebidoEm] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
    } catch {
      setErro('Não foi possível copiar')
    }
  }

  const salvar = async () => {
    if (loading) return
    const base = `/api/convenios/itens/${glosa.item_id}/recurso`
    let url = base
    let body: Record<string, unknown>
    if (acao === 'recorrer') {
      body = { appealAt: data, appealText: texto }
    } else if (acao === 'resultado') {
      url = `${base}/resultado`
      if (resultado === 'negado') {
        body = { resultado, resultAt: data }
      } else {
        const v = parseValor(valor)
        if (!Number.isFinite(v)) {
          setErro('Valor recuperado inválido')
          return
        }
        body = { resultado, resultAt: data, recoveredValue: v, ...(recebidoEm ? { receivedAt: recebidoEm } : {}) }
      }
    } else {
      url = `${base}/recebimento`
      const v = parseValor(valor)
      if (!Number.isFinite(v)) {
        setErro('Valor recuperado inválido')
        return
      }
      body = { value: v, receivedAt: data }
    }
    setLoading(true)
    setErro('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErro(json.error || 'Não foi possível salvar')
        setLoading(false)
        return
      }
      window.dispatchEvent(new Event('convenios:changed'))
      onSaved(json.recebido === false ? json.aviso : undefined)
    } catch {
      setErro('Não foi possível salvar')
      setLoading(false)
    }
  }

  const rotuloData = acao === 'recorrer' ? 'Data do recurso' : acao === 'resultado' ? 'Data do resultado' : 'Data do recebimento'

  return (
    <div className="no-print fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-[#111827]">{TITULOS[acao]}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar">
            <X className="w-5 h-5 text-[#6B7280]" />
          </button>
        </div>
        <p className="text-xs text-[#6B7280]">
          {glosa.patient_name} · {glosa.code} · {glosa.name}
          <br />
          Glosa de {formatCurrency(glosa.glosa_value)}
          {glosa.glosa_code ? ` · motivo ${glosa.glosa_code}${glosa.glosa_reason ? ` ${glosa.glosa_reason}` : ''}` : ''}
        </p>

        {acao === 'resultado' && (
          <div className="flex gap-4 text-sm text-[#374151]">
            {(['aceito', 'negado'] as const).map((r) => (
              <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="resultado" checked={resultado === r} onChange={() => setResultado(r)} />
                {r === 'aceito' ? 'Aceito' : 'Negado'}
              </label>
            ))}
          </div>
        )}

        <label className="block text-sm text-[#374151]">
          {rotuloData}
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${INPUT} block mt-1 w-full`} />
        </label>

        {acao === 'recorrer' && (
          <div className="space-y-1">
            <label className="block text-sm text-[#374151]">
              Justificativa
              <textarea
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value)
                  setCopiado(false)
                }}
                maxLength={2000}
                rows={5}
                className="mt-1 w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={copiar}
              disabled={texto.trim() === ''}
              className="text-sm text-[#3B82F6] hover:underline disabled:opacity-50"
            >
              {copiado ? 'Copiado' : 'Copiar justificativa'}
            </button>
          </div>
        )}

        {((acao === 'resultado' && resultado === 'aceito') || acao === 'recebimento') && (
          <label className="block text-sm text-[#374151]">
            {acao === 'recebimento' ? 'Valor recebido (R$)' : 'Valor recuperado (R$)'}
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={`${INPUT} block mt-1 w-full`} />
          </label>
        )}

        {acao === 'resultado' && resultado === 'aceito' && (
          <label className="block text-sm text-[#374151]">
            Data do recebimento (opcional)
            <input
              type="date"
              value={recebidoEm}
              onChange={(e) => setRecebidoEm(e.target.value)}
              className={`${INPUT} block mt-1 w-full`}
            />
          </label>
        )}

        {erro && <p className="text-sm text-[#DC2626]">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-[#E5E7EB]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={loading}
            className="px-3 py-2 text-sm rounded-lg bg-[#3B82F6] text-white disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
