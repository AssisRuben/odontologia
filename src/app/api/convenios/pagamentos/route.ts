import { withClinic } from '@/lib/ia/rotas'
import { createConveniosRepo } from '@/lib/convenios/repo'
import { todayYmd } from '@/lib/messaging/time'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withClinic('convenios pagamentos GET', async ({ clinicId, admin }) => {
    const dados = await createConveniosRepo(admin).pagamentos(clinicId, todayYmd(new Date(), 'America/Sao_Paulo'))
    return { status: 200, body: dados }
  })
}
