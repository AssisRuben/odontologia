import { LogoDente } from '@/components/layout/LogoDente'
import type { Capitulo, Parte } from '@/content/ajuda/indice'

type Props = { partes: Parte[]; capitulos: Capitulo[]; data: string | null }

// Capa e sumário: só aparecem na impressão / PDF.
export function CapaImpressao({ partes, capitulos, data }: Props) {
  return (
    <div className="hidden print:block">
      <section className="h-[250mm] flex flex-col items-center justify-center text-center break-after-page">
        <LogoDente size={72} />
        <h1 className="mt-6 font-display text-4xl font-bold text-petroleo">Manual do sistema</h1>
        <p className="mt-3 text-lg text-tinta-3">Implantação e uso no dia a dia</p>
        {data && <p className="mt-10 text-sm text-tinta-4">Atualizado em {data}</p>}
      </section>

      <section className="break-after-page">
        <h2 className="font-display text-2xl font-bold text-tinta mb-6">Sumário</h2>
        {partes.map((parte, i) => (
          <div key={parte} className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-petroleo mb-2">
              Parte {['I', 'II', 'III', 'IV'][i]} · {parte}
            </p>
            <ol className="space-y-1 text-[15px] text-tinta-2">
              {capitulos.filter(c => c.parte === parte).map(c => (
                <li key={c.slug}>{capitulos.indexOf(c) + 1}. {c.titulo}</li>
              ))}
            </ol>
          </div>
        ))}
      </section>
    </div>
  )
}
