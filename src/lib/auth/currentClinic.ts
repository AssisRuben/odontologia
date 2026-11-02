import { createClient } from '@/lib/supabase/server'

// Usuário logado e sua clínica (profissional mais antigo vinculado ao usuário).
export async function getCurrentClinic(): Promise<{ userId: string; clinicId: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('professionals')
    .select('clinic_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data?.clinic_id) return null
  return { userId: user.id, clinicId: data.clinic_id as string }
}
