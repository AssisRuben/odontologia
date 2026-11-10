'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LogoDente } from '@/components/layout/LogoDente'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setError('E-mail não confirmado. Verifique sua caixa de entrada e clique no link de confirmação.')
      } else if (error.message.toLowerCase().includes('invalid login credentials')) {
        setError('E-mail ou senha incorretos.')
      } else {
        setError(error.message)
      }
      setLoading(false)
      return
    }

    router.push('/agenda')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-porcelana flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <LogoDente size={42} />
          <span className="font-display text-[28px] font-bold tracking-tight text-tinta">Dental</span>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-linha shadow-[0_24px_48px_-28px_rgba(23,59,71,0.35)] p-8">
          <h1 className="text-2xl font-semibold text-tinta mb-1">Entrar na sua conta</h1>
          <p className="text-sm text-tinta-3 mb-6">Bem-vindo de volta!</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-tinta mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="w-full h-10 px-3 rounded-lg border border-linha text-sm text-tinta placeholder:text-tinta-4 focus:outline-none focus:ring-2 focus:ring-petroleo focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-tinta mb-1">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full h-10 px-3 pr-10 rounded-lg border border-linha text-sm text-tinta placeholder:text-tinta-4 focus:outline-none focus:ring-2 focus:ring-petroleo focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-tinta-3"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-petroleo text-white rounded-lg text-sm font-medium hover:bg-petroleo-escuro transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-sm text-tinta-3 mt-6">
            Não tem uma conta?{' '}
            <Link href="/register" className="text-petroleo font-medium hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
