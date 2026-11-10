'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { InventoryItem, Kit, MaterialStatus } from '@/types'
import { ModalBase, CaixaErro, inputCls, labelCls, btnPriCls, btnSecCls } from '@/components/estoque/ModalBase'
import { linhasDoKit, faltas, podeBaixar, type Linha } from '@/lib/kits/baixa'

interface Dados {
  tratamento: {
    id: string; procedure: string; status: string
    material_status: MaterialStatus | null
    patient: { id: string; name: string } | null
  }
  sugestao: string | null
  kits: Kit[]
}

export function ModalBaixaMaterial({ treatmentId, onClose }: {
  treatmentId: string
  onClose: (resolvido: boolean) => void
}) {
  const [dados, setDados] = useState<Dados | null>(null)
  const [produtos, setProdutos] = useState<InventoryItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erroCarga, setErroCarga] = useState(false)
  const [kitId, setKitId] = useState<string>('')
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [erro, setErro] = useState('')
  const [itemComErro, setItemComErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [novo, setNovo] = useState('')

  useEffect(() => {
    let cancelado = false
    Promise.all([
      fetch(`/api/tratamentos/${treatmentId}/material`).then(async (r) => {
        if (!r.ok) throw new Error('falha')
        return r.json() as Promise<Dados>
      }),
      fetch('/api/estoque').then(async (r) => {
        if (!r.ok) throw new Error('falha')
        return r.json() as Promise<{ itens: InventoryItem[] }>
      }),
    ])
      .then(([d, e]) => {
        if (cancelado) return
        setDados(d)
        setProdutos(e.itens ?? [])
        const sug = d.sugestao ? d.kits.find((k) => k.id === d.sugestao) : undefined
        if (sug) {
          setKitId(sug.id)
          setLinhas(linhasDoKit(sug))
        }
        setCarregando(false)
      })
      .catch(() => {
        if (cancelado) return
        setErroCarga(true)
        setCarregando(false)
      })
    return () => { cancelado = true }
  }, [treatmentId])

  const saldos = useMemo(() => new Map(produtos.map((p) => [p.id, p.quantity])), [produtos])
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos])
  const emFalta = useMemo(() => faltas(linhas, saldos), [linhas, saldos])
  const disponiveis = produtos.filter((p) => !linhas.some((l) => l.itemId === p.id))

  function trocarKit(id: string) {
    setKitId(id)
    setErro('')
    setItemComErro(null)
    const kit = dados?.kits.find((k) => k.id === id)
    setLinhas(kit ? linhasDoKit(kit) : [])
  }

  function mudarQtd(itemId: string, v: string) {
    setItemComErro(null)
    setLinhas((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, quantity: Number(v) } : l)))
  }

  async function chamar(caminho: string, corpo?: unknown) {
    setEnviando(true)
    setErro('')
    setItemComErro(null)
    try {
      const res = await fetch(`/api/tratamentos/${treatmentId}/material${caminho}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      })
      if (res.ok) { onClose(true); return }
      const j = await res.json().catch(() => ({}))
      setErro(j.error ?? 'Não foi possível concluir.')
      if (j.itemId) setItemComErro(j.itemId)
    } catch {
      setErro('Não foi possível concluir.')
    }
    setEnviando(false)
  }

  if (carregando || erroCarga || !dados) {
    return (
      <ModalBase titulo="Baixa de material" onClose={() => onClose(false)}
        rodape={<button className={btnSecCls} onClick={() => onClose(false)}>Fechar</button>}>
        {erroCarga
          ? <CaixaErro>Não foi possível carregar os dados da baixa.</CaixaErro>
          : <p className="text-sm text-tinta-3">Carregando...</p>}
      </ModalBase>
    )
  }

  const { tratamento, kits } = dados

  if (tratamento.material_status !== 'pendente') {
    return (
      <ModalBase titulo="Baixa de material" onClose={() => onClose(false)}
        rodape={<button className={btnSecCls} onClick={() => onClose(false)}>Fechar</button>}>
        <p className="text-sm text-tinta-2">A baixa deste tratamento já foi resolvida</p>
      </ModalBase>
    )
  }

  return (
    <ModalBase titulo="Baixa de material" largo bloqueado={enviando} onClose={() => onClose(false)}
      rodape={
        <>
          <button className={btnSecCls} disabled={enviando} onClick={() => onClose(false)}>Agora não</button>
          <button className={btnSecCls} disabled={enviando} onClick={() => chamar('/dispensar')}>Não usar material</button>
          <button className={btnPriCls} disabled={enviando || !podeBaixar(linhas, saldos)}
            onClick={() => chamar('', { kitId: kitId || null, items: linhas })}>
            {enviando ? 'Baixando...' : 'Dar baixa'}
          </button>
        </>
      }>
      <div className="text-sm text-tinta-2">
        <p><span className="text-tinta-4">Paciente: </span>{tratamento.patient?.name ?? '—'}</p>
        <p><span className="text-tinta-4">Procedimento: </span>{tratamento.procedure}</p>
      </div>

      {kits.length === 0 && (
        <p className="text-sm text-tinta-3">
          Nenhum kit cadastrado. Inclua os produtos usados ou cadastre kits em Estoque → Kits.
        </p>
      )}

      <div>
        <label htmlFor="baixa-kit" className={labelCls}>Kit</label>
        <select id="baixa-kit" value={kitId} onChange={(e) => trocarKit(e.target.value)} className={inputCls}>
          <option value="">Sem kit</option>
          {kits.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </div>

      {linhas.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-tinta-4">
              <th className="py-1 font-medium">Produto</th>
              <th className="py-1 font-medium w-24">Quantidade</th>
              <th className="py-1 font-medium">Saldo atual</th>
              <th className="py-1 w-8" />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const p = porId.get(l.itemId)
              const vermelho = emFalta.has(l.itemId) || itemComErro === l.itemId
              return (
                <tr key={l.itemId} className={vermelho ? 'bg-red-50 text-red-700' : ''}>
                  <td className="py-1.5 pr-2 align-top">
                    {p?.name ?? 'Produto indisponível'}
                    {p?.tracks_expiry && (
                      <p className="text-xs text-tinta-4">Sai do lote que vence primeiro (vencidos não entram)</p>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 align-top">
                    <input type="number" min={1} max={9999} step={1} value={l.quantity || ''}
                      aria-label={`Quantidade de ${p?.name ?? 'produto'}`}
                      onChange={(e) => mudarQtd(l.itemId, e.target.value)}
                      className="w-full h-9 px-2 rounded-lg border border-linha text-sm bg-white text-tinta focus:outline-none focus:ring-2 focus:ring-petroleo" />
                  </td>
                  <td className="py-1.5 pr-2 align-top">{p ? `${p.quantity}${p.unit ? ` ${p.unit}` : ''}` : '—'}</td>
                  <td className="py-1.5 align-top">
                    <button type="button" aria-label="Remover" className="p-1 text-tinta-4 hover:text-red-600"
                      onClick={() => { setItemComErro(null); setLinhas((ls) => ls.filter((x) => x.itemId !== l.itemId)) }}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="flex gap-2">
        <select value={novo} onChange={(e) => setNovo(e.target.value)} className={inputCls} aria-label="Produto a incluir">
          <option value="">Escolha um produto</option>
          {disponiveis.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" disabled={!novo} className={`${btnSecCls} flex items-center gap-1 shrink-0`}
          onClick={() => { setLinhas((ls) => [...ls, { itemId: novo, quantity: 1 }]); setNovo('') }}>
          <Plus className="w-4 h-4" />
          Incluir produto
        </button>
      </div>

      {erro && <CaixaErro>{erro}</CaixaErro>}
    </ModalBase>
  )
}
