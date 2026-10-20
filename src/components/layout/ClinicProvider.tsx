'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useClinicStore } from '@/store/clinicStore'

const FALLBACK_CLINIC_ID = '76fdeef2-2347-4ac2-9d3f-fc4456ef57a9'

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { setClinic, setLoading } = useClinicStore()

  useEffect(() => {
    async function loadClinic() {
      try {
        const supabase = createClient()

        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          setClinic({ clinicId: FALLBACK_CLINIC_ID, clinicName: '', professionalId: '', professionalName: '' })
          return
        }

        // Try to find a professional linked to this user
        const { data: professional } = await supabase
          .from('professionals')
          .select('id, name, clinic_id')
          .eq('user_id', user.id)
          .maybeSingle()

        if (professional) {
          setClinic({
            clinicId: professional.clinic_id,
            clinicName: '',
            professionalId: professional.id,
            professionalName: professional.name,
          })
          return
        }

        // Fallback: use first professional's clinic_id or the known default
        const { data: anyProfessional } = await supabase
          .from('professionals')
          .select('id, name, clinic_id')
          .order('created_at')
          .limit(1)
          .maybeSingle()

        if (anyProfessional) {
          setClinic({
            clinicId: anyProfessional.clinic_id,
            clinicName: '',
            professionalId: anyProfessional.id,
            professionalName: user.email ?? '',
          })
          return
        }

        // Last resort: use the hardcoded clinic
        setClinic({
          clinicId: FALLBACK_CLINIC_ID,
          clinicName: '',
          professionalId: '',
          professionalName: user.email ?? '',
        })
      } catch {
        // Always unblock the UI even on error
        setClinic({ clinicId: FALLBACK_CLINIC_ID, clinicName: '', professionalId: '', professionalName: '' })
      }
    }

    loadClinic()
  }, [setClinic, setLoading])

  return <>{children}</>
}
