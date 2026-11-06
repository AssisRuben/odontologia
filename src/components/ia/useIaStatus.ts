'use client'

import { useEffect, useState } from 'react'

export function useIaStatus(): { conectado: boolean; carregando: boolean } {
  const [state, setState] = useState({ conectado: false, carregando: true })

  useEffect(() => {
    let vivo = true
    fetch('/api/ia/conexao')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (vivo) setState({ conectado: !!j?.conectado, carregando: false })
      })
      .catch(() => {
        if (vivo) setState({ conectado: false, carregando: false })
      })
    return () => {
      vivo = false
    }
  }, [])

  return state
}
