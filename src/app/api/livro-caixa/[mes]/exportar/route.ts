import { NextResponse } from 'next/server'
import { getCurrentClinic } from '@/lib/auth/currentClinic'
import { createClient } from '@/lib/supabase/server'
import { parseMonth } from '@/lib/livro-caixa/mes'
import { buildLedger } from '@/lib/livro-caixa/apuracao'
import {
  SKIPPED_NOTE,
  attachmentFileName,
  selectAttachments,
  toCsv,
  toPdf,
  toZip,
} from '@/lib/livro-caixa/exportacao'
import { downloadAttachment, loadClinicName, loadLedgerInput } from '@/lib/livro-caixa/repo'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: RouteContext<'/api/livro-caixa/[mes]/exportar'>) {
  const { mes } = await ctx.params
  if (!parseMonth(mes)) return NextResponse.json({ error: 'Mês inválido' }, { status: 400 })

  try {
    const current = await getCurrentClinic()
    if (!current) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

    const supabase = await createClient()
    const [input, clinicName] = await Promise.all([
      loadLedgerInput(supabase, current.clinicId, mes),
      loadClinicName(supabase, current.clinicId),
    ])
    const ledger = buildLedger(input)

    const encoder = new TextEncoder()
    const files: Record<string, Uint8Array> = {
      'resumo.pdf': await toPdf(ledger, clinicName),
      'lancamentos.csv': encoder.encode(toCsv(ledger)),
    }

    const { included, skipped } = selectAttachments(ledger.rows)
    const notes: string[] = []
    if (skipped) notes.push(SKIPPED_NOTE)
    for (const row of included) {
      const name = attachmentFileName(row)
      try {
        files[name] = await downloadAttachment(supabase, row.attachmentPath as string)
      } catch (e) {
        console.error('[livro-caixa] comprovante não incluído:', name, (e as Error).message)
        notes.push(`Não foi possível incluir: ${name}`)
      }
    }
    if (notes.length > 0) files['LEIA-ME.txt'] = encoder.encode(notes.join('\r\n') + '\r\n')

    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="livro-caixa-${mes}.zip"`,
    }
    if (skipped) headers['X-Comprovantes-Omitidos'] = '1'
    return new Response(toZip(files) as BodyInit, { status: 200, headers })
  } catch (e) {
    console.error('[livro-caixa] falha ao gerar o pacote:', (e as Error).message)
    return NextResponse.json({ error: 'Não foi possível gerar o pacote. Tente novamente.' }, { status: 500 })
  }
}
