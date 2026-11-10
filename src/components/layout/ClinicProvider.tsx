'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

// Descobre a clínica do usuário logado pelo profissional vinculado ao login.
// Nunca cai para outra clínica: sem vínculo, mostra um aviso.
export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { setClinic } = useClinicStore()
  const [problem, setProblem] = useState<'no-clinic' | 'error' | null>(null)

  useEffect(() => {
    async function loadClinic() {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          window.location.href = '/login'
          return
        }

        const { data: professional, error } = await supabase
          .from('professionals')
          .select('id, name, clinic_id, clinic:clinics(name)')
          .eq('user_id', user.id)
          .order('created_at')
          .limit(1)
          .maybeSingle()

        if (error) { setProblem('error'); return }
        if (!professional) { setProblem('no-clinic'); return }

        // O embed pode vir como objeto ou lista, conforme a inferência do cliente.
        const emb = professional.clinic as unknown as { name?: string } | { name?: string }[] | null
        const clinicName = (Array.isArray(emb) ? emb[0]?.name : emb?.name) ?? ''
        setClinic({
          clinicId: professional.clinic_id,
          clinicName,
          professionalId: professional.id,
          professionalName: professional.name,
        })
      } catch {
        setProblem('error')
      }
    }

    loadClinic()
  }, [setClinic])

  if (problem) {
    async function logout() {
      await createClient().auth.signOut()
      window.location.href = '/login'
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-porcelana p-6">
        <div className="bg-white rounded-xl border border-linha p-6 max-w-md text-center space-y-4">
          <p className="text-tinta font-semibold">
            {problem === 'no-clinic' ? 'Sua conta não está vinculada a nenhuma clínica' : 'Não foi possível carregar sua clínica'}
          </p>
          <p className="text-sm text-tinta-3">
            {problem === 'no-clinic'
              ? 'Peça ao responsável pela clínica para vincular seu login a um profissional.'
              : 'Verifique sua conexão e tente novamente.'}
          </p>
          <div className="flex gap-2 justify-center">
            {problem === 'error' && (
              <button onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-petroleo text-white text-sm font-medium hover:bg-petroleo-escuro">
                Tentar de novo
              </button>
            )}
            <button onClick={logout}
              className="px-4 py-2 rounded-lg border border-linha text-sm font-medium text-tinta-2 hover:bg-porcelana-2">
              Sair
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
