import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPublicDeps } from '@/lib/orcamentos/repo'
import { publicView } from '@/lib/orcamentos/publico'
import AprovacaoPaciente from '@/components/orcamentos/AprovacaoPaciente'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Orçamento',
  robots: { index: false, follow: false },
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-[#F9FAFB] px-4 py-8">
      <div className="mx-auto w-full max-w-lg rounded-xl border border-[#E5E7EB] bg-white p-6 text-center">{children}</div>
    </main>
  )
}

export default async function Page({ params }: PageProps<'/orcamento/[token]'>) {
  const { token } = await params
  let view
  try {
    view = await publicView(token, new Date(), createPublicDeps(createAdminClient()))
  } catch (e) {
    console.error('[orcamento/page] falha:', (e as Error).message)
    return (
      <Card>
        <h1 className="text-lg font-semibold text-[#111827]">Não foi possível abrir o orçamento</h1>
        <p className="mt-2 text-sm text-[#6B7280]">Tente novamente em instantes ou fale com a clínica.</p>
      </Card>
    )
  }

  if (view.kind === 'unavailable') {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-[#111827]">Este link não está mais disponível</h1>
        <p className="mt-2 text-sm text-[#6B7280]">Fale com a clínica para receber um novo orçamento.</p>
      </Card>
    )
  }

  if (view.kind === 'approved') {
    return (
      <Card>
        <p className="text-2xl font-semibold text-[#111827]">Aprovado ✓</p>
        <p className="mt-2 text-sm text-[#6B7280]">Este orçamento já foi aprovado. A clínica entrará em contato para agendar.</p>
        {view.canDownload && (
          <a
            href={`/api/public/orcamento/${token}/comprovante`}
            className="mt-5 inline-block rounded-xl bg-[#3B82F6] px-5 py-3 text-sm font-medium text-white"
          >
            Baixar comprovante
          </a>
        )}
      </Card>
    )
  }

  return <AprovacaoPaciente token={token} budget={view} />
}
