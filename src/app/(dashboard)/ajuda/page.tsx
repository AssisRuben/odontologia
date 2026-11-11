import { Download } from 'lucide-react'
import { INDICE, PARTES } from '@/content/ajuda/indice'
import { lerCapitulo, lerGeracao } from '@/lib/ajuda/manual'
import { ConteudoMarkdown } from '@/components/ajuda/ConteudoMarkdown'
import { IndiceManual } from '@/components/ajuda/IndiceManual'
import { CapaImpressao } from '@/components/ajuda/CapaImpressao'

export const metadata = { title: 'Ajuda — Manual do sistema' }

const ROMANOS = ['I', 'II', 'III', 'IV']

export default function AjudaPage() {
  const { data, temPdf } = lerGeracao()

  return (
    <div className="p-6 print:p-0 max-w-6xl">
      <CapaImpressao partes={PARTES} capitulos={INDICE} data={data} />

      <div className="print:hidden flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-semibold text-tinta leading-tight">Manual do sistema</h1>
          {data && <p className="mt-1 text-sm text-tinta-3">Atualizado em {data}</p>}
        </div>
        {temPdf && (
          <a href="/ajuda/manual.pdf" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-medio">
            <Download className="w-4 h-4" /> Baixar PDF
          </a>
        )}
      </div>

      <div className="md:flex md:gap-8">
        <IndiceManual partes={PARTES} capitulos={INDICE} />

        <article className="min-w-0 flex-1 max-w-3xl">
          {PARTES.map((parte, i) => (
            <div key={parte}>
              <p className="mt-2 mb-4 text-xs font-semibold uppercase tracking-wide text-petroleo print:hidden">
                Parte {ROMANOS[i]} · {parte}
              </p>
              {INDICE.filter(c => c.parte === parte).map(c => {
                const texto = lerCapitulo(c.slug)
                return (
                  <section key={c.slug} id={c.slug} data-capitulo
                    className="scroll-mt-20 mb-12 pb-8 border-b border-linha last:border-b-0 print:border-0 print:mb-0 print:break-before-page">
                    <h2 className="font-display text-2xl font-bold text-tinta">
                      <span className="text-tinta-4 font-semibold mr-2">{INDICE.indexOf(c) + 1}.</span>{c.titulo}
                    </h2>
                    {texto
                      ? <ConteudoMarkdown texto={texto} />
                      : <p className="mt-3 text-[15px] text-tinta-3">Capítulo em preparação.</p>}
                  </section>
                )
              })}
            </div>
          ))}
        </article>
      </div>
    </div>
  )
}
