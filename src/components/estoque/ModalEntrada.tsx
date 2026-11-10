'use client'

import { useRef, useState } from 'react'
import type { InventoryItem, PaymentMethod } from '@/types'
import { PAYMENT_METHOD_LABELS } from '@/types'
import { KIND_LABEL, KINDS_ENTRADA } from '@/lib/estoque/rotulos'
import { parseReaisInput } from '@/lib/payments/money'
import { formatValor } from '@/lib/messaging/time'
import { ModalBase, CaixaErro, inputCls, labelCls, btnPriCls, btnSecCls } from './ModalBase'

const FORMAS: PaymentMethod[] = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'boleto']

interface Props {
  item: InventoryItem
  hojeYmd: string
  onClose: () => void
  onSaved: (msg?: string) => void
}

export function ModalEntrada({ item, hojeYmd, onClose, onSaved }: Props) {
  const [qtd, setQtd] = useState('')
  const [lote, setLote] = useState('')
  const [validade, setValidade] = useState('')
  const [kind, setKind] = useState<(typeof KINDS_ENTRADA)[number]>('compra')
  const [valor, setValor] = useState('')
  const [pagamento, setPagamento] = useState<'paid' | 'pending'>('paid')
  const [forma, setForma] = useState<PaymentMethod>('dinheiro')
  const [dataPgto, setDataPgto] = useState(hojeYmd)
  const [vencimento, setVencimento] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const emAndamento = useRef(false)

  const qtdN = /^\d+$/.test(qtd.trim()) ? Number(qtd.trim()) : 0
  const comCusto = kind === 'compra' && valor.trim() !== ''
  const centavos = comCusto ? parseReaisInput(valor) : null
  const valorOk = !comCusto || (centavos !== null && centavos > 0 && centavos <= 9999999999)
  const pagamentoOk = !comCusto || (pagamento === 'paid' ? !!dataPgto : !!vencimento)
  const validadeOk = !item.tracks_expiry || validade !== ''
  const vencido = item.tracks_expiry && validade !== '' && validade < hojeYmd
  const podeSalvar = qtdN > 0 && valorOk && pagamentoOk && validadeOk && !enviando

  async function salvar() {
    if (!podeSalvar || emAndamento.current) return
    emAndamento.current = true
    setEnviando(true)
    setErro('')
    try {
      const body: Record<string, unknown> = { quantity: qtdN, kind, notes: obs.trim() || null }
      if (item.tracks_expiry) {
        body.lotCode = lote.trim() || null
        body.expiresAt = validade
      }
      if (comCusto && centavos !== null) {
        body.totalCostCents = centavos
        body.payment = pagamento === 'paid'
          ? { status: 'paid', method: forma, date: dataPgto }
          : { status: 'pending', dueDate: vencimento }
      }
      const res = await fetch(`/api/estoque/${item.id}/entrada`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setErro(json.error ?? 'Não foi possível salvar. Tente novamente.'); return }
      if (json.expense) {
        onSaved(`Despesa de ${formatValor((centavos ?? 0) / 100)} lançada no Financeiro${json.expense.status === 'pending' ? ' (a pagar)' : ''}`)
      } else {
        onSaved('Entrada registrada')
      }
    } catch {
      setErro('Não foi possível concluir. Verifique a conexão e tente novamente.')
    } finally {
      emAndamento.current = false
      setEnviando(false)
    }
  }

  return (
    <ModalBase
      titulo={`Entrada — ${item.name}`}
      onClose={onClose}
      bloqueado={enviando}
      rodape={
        <>
          <button onClick={onClose} disabled={enviando} className={btnSecCls}>Cancelar</button>
          <button onClick={salvar} disabled={!podeSalvar} className={btnPriCls}>{enviando ? 'Salvando...' : 'Confirmar'}</button>
        </>
      }
    >
      {erro && <CaixaErro>{erro}</CaixaErro>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ent-qtd" className={labelCls}>Quantidade *</label>
          <input id="ent-qtd" className={inputCls} inputMode="numeric" value={qtd} onChange={(e) => setQtd(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ent-tipo" className={labelCls}>Tipo</label>
          <select id="ent-tipo" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS_ENTRADA.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
      </div>

      {item.tracks_expiry && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ent-lote" className={labelCls}>Lote</label>
            <input id="ent-lote" className={inputCls} placeholder="opcional" maxLength={40} value={lote} onChange={(e) => setLote(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ent-validade" className={labelCls}>Validade *</label>
            <input id="ent-validade" type="date" className={inputCls} value={validade} onChange={(e) => setValidade(e.target.value)} />
          </div>
          {vencido && <p className="col-span-2 text-xs text-amber-700">Este lote já está vencido</p>}
        </div>
      )}

      {kind === 'compra' && (
        <div className="rounded-lg border border-linha p-3 space-y-3">
          <div>
            <label htmlFor="ent-valor" className={labelCls}>Valor total (R$)</label>
            <input id="ent-valor" className={inputCls} inputMode="decimal" placeholder="opcional — lança no Financeiro" value={valor} onChange={(e) => setValor(e.target.value)} />
            {!valorOk && <p className="text-xs text-red-600 mt-1">Valor inválido</p>}
          </div>
          {comCusto && (
            <>
              <div className="flex gap-4 text-sm text-tinta">
                <label className="flex items-center gap-2">
                  <input type="radio" name="ent-pgto" checked={pagamento === 'paid'} onChange={() => setPagamento('paid')} className="accent-petroleo" />
                  Já paga
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="ent-pgto" checked={pagamento === 'pending'} onChange={() => setPagamento('pending')} className="accent-petroleo" />
                  A pagar
                </label>
              </div>
              {pagamento === 'paid' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ent-forma" className={labelCls}>Forma de pagamento</label>
                    <select id="ent-forma" className={inputCls} value={forma} onChange={(e) => setForma(e.target.value as PaymentMethod)}>
                      {FORMAS.map((f) => <option key={f} value={f}>{PAYMENT_METHOD_LABELS[f]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ent-data" className={labelCls}>Data</label>
                    <input id="ent-data" type="date" className={inputCls} value={dataPgto} onChange={(e) => setDataPgto(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="ent-venc" className={labelCls}>Vencimento *</label>
                  <input id="ent-venc" type="date" className={inputCls} value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div>
        <label htmlFor="ent-obs" className={labelCls}>Observação</label>
        <input id="ent-obs" className={inputCls} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
    </ModalBase>
  )
}
