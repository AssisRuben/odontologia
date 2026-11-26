'use client'

import { useId, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarX2, ChevronDown, NotebookPen } from 'lucide-react'
import { APPOINTMENT_STATUS_COLORS } from '@/types'
import { rotuloSituacao } from '@/lib/agenda/situacao'
import type { Appointment } from '@/types'
import { montarHistorico, type EvolucaoHist, type ResumoConsultas } from '@/lib/pacientes/historicoConsultas'

type Evolucao = EvolucaoHist & { description: string; professional?: { name: string } | null }

/** Histórico de consultas do paciente: resumo, próximas e passadas por ano, com a evolução de cada consulta. */
export function TabConsultas({ consultas, evolucoes }: { consultas: Appointment[]; evolucoes: Evolucao[] }) {
  // "Agora" fixo enquanto a aba está aberta: separa próximas e passadas.
  const [agora] = useState(() => new Date())
  const { resumo, proximas, anos, evolucoesDa } = useMemo(
    () => montarHistorico(consultas, evolucoes, agora),
    [consultas, evolucoes, agora],
  )

  if (consultas.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-linha flex flex-col items-center justify-center gap-2 h-40 px-6 text-center">
        <CalendarX2 className="w-5 h-5 text-tinta-4" aria-hidden="true" />
        <p className="text-sm text-tinta-3">Nenhuma consulta registrada. As consultas marcadas na agenda aparecem aqui.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Resumo resumo={resumo} />
      {proximas.length > 0 && (
        <Secao titulo="Próximas" consultas={proximas} evolucoesDa={evolucoesDa} destaque />
      )}
      {anos.map((a) => (
        <Secao key={a.ano} titulo={String(a.ano)} consultas={a.consultas} evolucoesDa={evolucoesDa} />
      ))}
    </div>
  )
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`
}

function Resumo({ resumo }: { resumo: ResumoConsultas }) {
  const itens: React.ReactNode[] = []
  itens.push(<><b className="font-semibold text-tinta">{resumo.realizadas}</b> {resumo.realizadas === 1 ? 'consulta realizada' : 'consultas realizadas'}</>)
  if (resumo.primeira) itens.push(<>desde <b className="font-semibold text-tinta">{format(parseISO(resumo.primeira), 'MMM/yyyy', { locale: ptBR })}</b></>)
  if (resumo.faltas) itens.push(<span className="text-[#B42318]">{plural(resumo.faltas, 'falta', 'faltas')}</span>)
  const semQuem = resumo.canceladas - resumo.canceladasPaciente - resumo.canceladasDentista
  if (resumo.canceladasPaciente) itens.push(<>{plural(resumo.canceladasPaciente, 'cancelada', 'canceladas')} pelo paciente</>)
  if (resumo.canceladasDentista) itens.push(<>{plural(resumo.canceladasDentista, 'cancelada', 'canceladas')} pelo dentista</>)
  if (semQuem) itens.push(<>{plural(semQuem, 'cancelada', 'canceladas')} sem informação de quem cancelou</>)
  if (resumo.dentistas.length) itens.push(<>com {resumo.dentistas.join(', ')}</>)

  return (
    <div className="bg-white rounded-xl border border-linha px-4 py-3 sm:px-5">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tinta-3">
        {itens.map((item, i) => <span key={i}>{item}</span>)}
      </p>
    </div>
  )
}

function Secao({ titulo, consultas, evolucoesDa, destaque = false }: {
  titulo: string
  consultas: Appointment[]
  evolucoesDa: Record<string, Evolucao[]>
  destaque?: boolean
}) {
  return (
    <section className="bg-white rounded-xl border border-linha overflow-hidden" aria-label={titulo}>
      <h3 className={`px-4 sm:px-5 py-2.5 text-xs font-semibold border-b border-linha ${destaque ? 'text-petroleo bg-petroleo-50' : 'text-tinta-3 bg-porcelana-2'}`}>
        {titulo}
      </h3>
      <ul className="divide-y divide-linha">
        {consultas.map((x) => <Linha key={x.id} consulta={x} evolucoes={evolucoesDa[x.id]} />)}
      </ul>
    </section>
  )
}

function Linha({ consulta: x, evolucoes }: { consulta: Appointment; evolucoes?: Evolucao[] }) {
  const [aberta, setAberta] = useState(false)
  const painelId = useId()
  const inicio = parseISO(x.start_time)
  const cor = APPOINTMENT_STATUS_COLORS[x.status] ?? '#5E6E75'

  const situacao = (
    <span className="shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: cor + '1A', color: cor }}>
      {rotuloSituacao(x.status, x.cancelled_by)}
    </span>
  )

  return (
    <li className="px-4 sm:px-5 py-3">
      <div className="flex flex-col gap-1.5 md:grid md:grid-cols-[150px_100px_minmax(0,180px)_minmax(0,1fr)_150px_100px] md:items-center md:gap-4">
        {/* data e hora (no celular, com a situação ao lado) */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 md:contents">
          <p className="text-sm text-tinta tabular-nums">
            {format(inicio, 'dd/MM/yyyy', { locale: ptBR })}{' '}
            <span className="text-tinta-4">{format(inicio, 'EEE', { locale: ptBR })}</span>
            <span className="md:hidden text-tinta-3"> {format(inicio, 'HH:mm')}–{format(parseISO(x.end_time), 'HH:mm')}</span>
          </p>
          <p className="hidden md:block text-sm text-tinta-3 tabular-nums">
            {format(inicio, 'HH:mm')}–{format(parseISO(x.end_time), 'HH:mm')}
          </p>
          <span className="md:hidden">{situacao}</span>
        </div>

        <div className="flex items-center gap-3 min-w-0 md:contents">
          <p className="flex items-center gap-1.5 min-w-0 text-sm text-tinta-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: x.professional?.color || '#173B47' }} aria-hidden="true" />
            <span className="truncate">{x.professional?.name || 'Dentista'}</span>
          </p>
          <p className="min-w-0 truncate text-sm text-tinta-3" title={x.procedure || undefined}>{x.procedure || '—'}</p>
        </div>

        {/* no computador, a situação e a evolução têm colunas fixas, para alinhar entre as linhas */}
        <div className="flex items-center gap-2 md:contents">
          <span className="hidden md:block">{situacao}</span>
          {evolucoes ? (
            <button
              type="button"
              onClick={() => setAberta((v) => !v)}
              aria-expanded={aberta}
              aria-controls={painelId}
              aria-label={`Evolução da consulta de ${format(inicio, "dd/MM/yyyy 'às' HH:mm")}`}
              className="md:justify-self-start inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-petroleo hover:bg-petroleo-50 focus-visible:outline-2 focus-visible:outline-petroleo"
            >
              <NotebookPen className="w-3.5 h-3.5" aria-hidden="true" />
              Evolução
              <ChevronDown className={`w-3.5 h-3.5 motion-safe:transition-transform ${aberta ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
          ) : (
            <span className="hidden md:block" aria-hidden="true" />
          )}
        </div>
      </div>

      {aberta && evolucoes && (
        <div id={painelId} className="mt-3 space-y-2">
          {evolucoes.map((ev) => (
            <div key={ev.id} className="rounded-lg bg-porcelana-2 border border-linha px-3 py-2.5">
              <p className="text-sm text-tinta leading-relaxed whitespace-pre-line">{ev.description}</p>
              {ev.professional?.name && <p className="mt-1.5 text-xs text-tinta-4">Registrada por {ev.professional.name}</p>}
            </div>
          ))}
        </div>
      )}
    </li>
  )
}
