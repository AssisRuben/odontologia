import { create } from 'zustand'

interface ClinicState {
  clinicId: string | null
  clinicName: string | null
  professionalId: string | null
  professionalName: string | null
  loading: boolean
  setClinic: (data: {
    clinicId: string
    clinicName: string
    professionalId: string
    professionalName: string
  }) => void
  setLoading: (v: boolean) => void
}

export const useClinicStore = create<ClinicState>((set) => ({
  clinicId: null,
  clinicName: null,
  professionalId: null,
  professionalName: null,
  loading: true,
  setClinic: (data) => set({ ...data, loading: false }),
  setLoading: (v) => set({ loading: v }),
}))
