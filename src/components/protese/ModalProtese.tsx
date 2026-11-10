'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'
import type { Prosthetic } from '@/types'
import { etapa } from '@/lib/protese/etapas'
import { parseReaisInput } from '@/lib/payments/money'
import { formatValor } from '@/lib/messaging/time'
import { BuscaPaciente } from './BuscaPaciente'

const TIPOS = ['Coroa', 'Coroa sobre implante', 'Faceta', 'Inlay/Onlay', 'PPR', 'Prótese total', 'Protocolo', 'Placa miorrelaxante', 'Provisório', 'Outro']
const MSG_PAGA = 'Despesa já paga — ajuste no Financeiro se precisar'

const inputCls = 'w-full h-10 px-3 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo'
const labelCls = 'block text-sm font-medium text-tinta mb-1'

type Lab = { id: string; name: string; active: boolean }

interface Props {
  protese?: Prosthetic
  pacienteFixo?: { id: string; name: string }
  onClose: () => void
  onSaved: (msg?: string) => void
}

function fmtHistorico(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ModalProtese({ protese, pacienteFixo, onClose, onSaved }: Props) {
  const { clinicId } = useClinicStore()
  const [paciente, setPaciente] = useState<{ id: string; name: string } | null>(
    pacienteFixo ?? (protese?.patient ? { id: protese.patient.id, name: protese.patient.name } : null),
  )
  const [profId, setProfId] = useState(protese?.professional_id ?? '')
  const [labId, setLabId] = useState(protese?.laboratory_id ?? '')
  const [tipo, setTipo] = useState(protese?.type ?? '')
  const [dente, setDente] = useState(protese?.tooth_region ?? '')
  const [previsao, setPrevisao] = useState(protese?.expected_at?.slice(0, 10) ?? '')
  const [custo, setCusto] = useState(protese?.lab_cost != null ? protese.lab_cost.toFixed(2).replace('.', ',') : '')
  const [notas, setNotas] = useState(protese?.notes ?? '')
  const [profissionais, setProfissionais] = useState<{ id: string; name: string }[]>([])
  const [labs, setLabs] = useState<Lab[]>([])
  const [novoLab, setNovoLab] = useState<string | null>(null)
  const [erroLab, setErroLab] = useState('')
  const [erroCarga, setErroCarga] = useState(false)
  const [confirmaExcluir, setConfirmaExcluir] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  useEffect(() => {
    if (!clinicId) return
    let ativo = true
    createClient().from('professionals').select('id, name').eq('clinic_id', clinicId).order('name')
      .then(({ data }) => { if (ativo) setProfissionais(data ?? []) })
    return () => { ativo = false }
  }, [clinicId])

  useEffect(() => {
    let ativo = true
    fetch('/api/laboratorios')
      .then((r) => { if (!r.ok) throw new Error('falha'); return r.json() })
      .then((j) => { if (ativo) setLabs(j.itens ?? []) })
      .catch(() => { if (ativo) setErroCarga(true) })
    return () => { ativo = false }
  }, [])

  const custoTexto = custo.trim()
  const custoCents = custoTexto ? parseReaisInput(custoTexto) : null
  const custoInvalido = custoTexto !== '' && custoCents === null
  const labsVisiveis = labs.filter((l) => l.active || l.id === labId)
  // Edição: mostra o laboratório atual mesmo antes de a lista carregar.
  if (protese?.lab && !labsVisiveis.some((l) => l.id === protese.lab!.id)) labsVisiveis.push(protese.lab)
  const podeSalvar = !!paciente && !custoInvalido && !enviando

  async function pedir(fn: () => Promise<void>) {
    if (emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    try {
      await fn()
    } catch {
      setErro('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  function salvar() {
    if (!podeSalvar || !paciente) return
    void pedir(async () => {
      const body = {
        patientId: paciente.id,
        professionalId: profId || null,
        laboratoryId: labId || null,
        type: tipo.trim() || null,
        toothRegion: dente.trim() || null,
        expectedAt: previsao || null,
        labCostCents: custoCents,
        notes: notas.trim() || null,
      }
      const res = await fetch(protese ? `/api/protese/${protese.id}` : '/api/protese', {
        method: protese ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.error ?? 'Não foi possível salvar. Tente novamente.'); return }
      let msg: string | undefined
      if (json.aviso === 'despesa_paga') msg = MSG_PAGA
      else if (json.despesaRemovida) msg = 'Despesa pendente removida do Financeiro'
      else if (json.expense && !protese?.expense_id) {
        msg = `Despesa de ${formatValor(Number(json.expense.amount))} lançada no Financeiro (a pagar)`
      }
      onSaved(msg)
      onClose()
    })
  }

  function excluir() {
    if (!protese) return
    void pedir(async () => {
      const res = await fetch(`/api/protese/${protese.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.error ?? 'Não foi possível excluir. Tente novamente.'); return }
      onSaved(json.despesa === 'mantida' ? 'Despesa já paga continua no Financeiro' : undefined)
      onClose()
    })
  }

  function criarLab() {
    const nome = (novoLab ?? '').trim()
    if (!nome) return
    void pedir(async () => {
      setErroLab('')
      const res = await fetch('/api/laboratorios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErroLab(json.error ?? 'Não foi possível criar o laboratório'); return }
      setLabs((l) => [...l, json.laboratorio])
      setLabId(json.laboratorio.id)
      setNovoLab(null)
    })
  }

  const temDespesa = !!protese?.expense_id && !!protese.lab_cost

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={enviando ? undefined : onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-linha">
          <h2 className="text-base font-semibold text-tinta">{protese ? 'Editar prótese' : 'Nova prótese'}</h2>
          <button onClick={onClose} className="p-1 rounded text-tinta-4 hover:text-tinta-2" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Paciente</label>
            <BuscaPaciente value={paciente} onChange={setPaciente} disabled={!!pacienteFixo || enviando} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pr-prof" className={labelCls}>Dentista</label>
              <select id="pr-prof" value={profId} onChange={(e) => setProfId(e.target.value)} className={inputCls}>
                <option value="">Nenhum</option>
                {profissionais.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pr-lab" className={labelCls}>Laboratório</label>
              <select id="pr-lab" value={labId}
                onChange={(e) => {
                  if (e.target.value === '__novo') { setNovoLab(''); return }
                  setLabId(e.target.value)
                }}
                className={inputCls}>
                <option value="">{protese?.laboratory && !labId ? protese.laboratory : 'Nenhum'}</option>
                {labsVisiveis.map((l) => <option key={l.id} value={l.id}>{l.name}{l.active ? '' : ' (inativo)'}</option>)}
                <option value="__novo">+ Novo laboratório</option>
              </select>
              {erroCarga && <p className="text-xs text-red-600 mt-1">Não foi possível carregar os laboratórios.</p>}
            </div>
          </div>

          {novoLab !== null && (
            <div>
              <div className="flex gap-2">
                <input aria-label="Nome do novo laboratório" value={novoLab} onChange={(e) => setNovoLab(e.target.value)}
                  placeholder="Nome do laboratório" className={inputCls} autoFocus />
                <button type="button" onClick={criarLab} disabled={enviando || !novoLab.trim()}
                  className="px-4 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
                  Criar
                </button>
                <button type="button" onClick={() => { setNovoLab(null); setErroLab('') }} disabled={enviando}
                  className="px-3 h-10 rounded-lg border border-linha text-sm text-tinta-3 hover:bg-porcelana disabled:opacity-50">
                  Cancelar
                </button>
              </div>
              {erroLab && <p role="alert" className="text-xs text-red-600 mt-1">{erroLab}</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pr-tipo" className={labelCls}>Tipo</label>
              <input id="pr-tipo" list="pr-tipos" value={tipo} maxLength={80} onChange={(e) => setTipo(e.target.value)} className={inputCls} />
              <datalist id="pr-tipos">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <label htmlFor="pr-dente" className={labelCls}>Dente/região</label>
              <input id="pr-dente" value={dente} maxLength={40} onChange={(e) => setDente(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pr-prev" className={labelCls}>Previsão de retorno</label>
              <input id="pr-prev" type="date" value={previsao} onChange={(e) => setPrevisao(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="pr-custo" className={labelCls}>Custo do laboratório (R$)</label>
              <input id="pr-custo" inputMode="decimal" value={custo} onChange={(e) => setCusto(e.target.value)}
                placeholder="0,00" aria-invalid={custoInvalido}
                className={`${inputCls} ${custoInvalido ? 'border-red-400 focus:ring-red-400' : ''}`} />
              {custoInvalido && <p className="text-xs text-red-600 mt-1">Valor inválido</p>}
            </div>
          </div>

          <div>
            <label htmlFor="pr-obs" className={labelCls}>Observação</label>
            <textarea id="pr-obs" rows={2} maxLength={1000} value={notas} onChange={(e) => setNotas(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-linha text-sm bg-white focus:outline-none focus:ring-2 focus:ring-petroleo" />
          </div>

          {protese && (protese.events?.length ?? 0) > 0 && (
            <div>
              <p className={labelCls}>Histórico</p>
              <ul className="space-y-1 text-xs text-tinta-2">
                {protese.events!.map((e) => (
                  <li key={e.id}>
                    <span className="text-tinta-3">{fmtHistorico(e.created_at)}</span>{' '}
                    {e.from_status ? `${etapa(e.from_status).curto} → ` : ''}{etapa(e.to_status).curto}
                    {e.note ? ` — ${e.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {erro && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

          {confirmaExcluir && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 space-y-2">
              <p>Excluir esta prótese?{temDespesa && ' A despesa do laboratório, se ainda não estiver paga, também será apagada. Se já foi paga, continua no Financeiro.'}</p>
              <div className="flex gap-2">
                <button type="button" onClick={excluir} disabled={enviando}
                  className="px-3 h-9 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                  {enviando ? 'Excluindo...' : 'Excluir'}
                </button>
                <button type="button" onClick={() => setConfirmaExcluir(false)} disabled={enviando}
                  className="px-3 h-9 rounded-lg border border-red-200 bg-white text-sm text-tinta-3 disabled:opacity-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            {protese && !confirmaExcluir && (
              <button type="button" onClick={() => setConfirmaExcluir(true)} disabled={enviando}
                className="h-10 px-4 rounded-lg border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                Excluir
              </button>
            )}
            <button type="button" onClick={onClose} disabled={enviando}
              className="flex-1 h-10 rounded-lg border border-linha text-sm font-medium text-tinta-3 hover:bg-porcelana disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={!podeSalvar}
              className="flex-1 h-10 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro disabled:opacity-50">
              {enviando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
