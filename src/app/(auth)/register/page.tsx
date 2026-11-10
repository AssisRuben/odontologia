'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LogoDente } from '@/components/layout/LogoDente'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [clinicName, setClinicName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, clinic_name: clinicName },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    router.push('/agenda')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-porcelana flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <LogoDente size={42} />
          <span className="font-display text-[28px] font-bold tracking-tight text-tinta">Dental</span>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-linha shadow-[0_24px_48px_-28px_rgba(23,59,71,0.35)] p-8">
          <h1 className="text-2xl font-semibold text-tinta mb-1">Criar sua conta</h1>
          <p className="text-sm text-tinta-3 mb-6">Comece a gerenciar sua clínica</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Nome completo</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. João Silva"
                required
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Nome da clínica</label>
              <input
                type="text"
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="Clínica Dental Saúde"
                required
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-tinta mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm focus:outline-none focus:ring-2 focus:ring-petroleo"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors disabled:opacity-50"
            >
              {loading ? 'Criando conta...' : 'Criar conta'}
            </button>
          </form>

          <p className="text-center text-sm text-tinta-3 mt-6">
            Já tem uma conta?{' '}
            <Link href="/login" className="text-petroleo font-medium hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
