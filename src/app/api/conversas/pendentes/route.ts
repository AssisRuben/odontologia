import { withClinic } from '@/lib/ia/rotas'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('conversas pendentes', async ({ clinicId, admin }) => {
    const { count, error } = await admin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('handler', 'human')
      .eq('unread', true)
    if (error) throw new Error(error.message)
    return { status: 200, body: { total: count ?? 0 } }
  })
}
