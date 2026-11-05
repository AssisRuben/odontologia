import { NextResponse } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createClient } from '@/lib/supabase/server'
import { parseMonth } from '@/lib/livro-caixa/mes'
import { buildLedger } from '@/lib/livro-caixa/apuracao'
import { loadLedgerInput } from '@/lib/livro-caixa/repo'

export const dynamic = 'force-dynamic'

const INTERNAL = { error: 'Erro interno. Tente novamente.' }

export async function GET(_req: Request, ctx: RouteContext<'/api/livro-caixa/[mes]'>) {
  const { mes } = await ctx.params
  if (!parseMonth(mes)) return NextResponse.json({ error: 'Mês inválido' }, { status: 400 })

  try {
    const current = await getCurrentClinic()
    if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
    const supabase = await createClient()
    const input = await loadLedgerInput(supabase, current.clinicId, mes)
    return NextResponse.json(buildLedger(input))
  } catch (e) {
    console.error('[livro-caixa] falha ao montar o livro-caixa:', (e as Error).message)
    return NextResponse.json(INTERNAL, { status: 500 })
  }
}
