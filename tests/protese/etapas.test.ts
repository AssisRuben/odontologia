import { describe, it, expect } from 'vitest'
import { ETAPAS, etapa, proximaEtapa, acaoProxima, ehEtapa } from '@/lib/protese/etapas'

describe('etapas', () => {
  it('lista as quatro etapas em ordem', () => {
    expect(ETAPAS.map(e => e.id)).toEqual(['requested', 'sent_to_lab', 'returned', 'installed'])
    expect(ETAPAS.map(e => e.curto)).toEqual(['Solicitação', 'Enviado', 'Retornado', 'Instalado'])
    expect(etapa('sent_to_lab').rotulo).toBe('Enviado ao Laboratório')
    expect(etapa('installed').cor).toBe('#10B981')
  })
  it('proximaEtapa e acaoProxima', () => {
    expect(proximaEtapa('requested')).toBe('sent_to_lab')
    expect(proximaEtapa('returned')).toBe('installed')
    expect(proximaEtapa('installed')).toBeNull()
    expect(acaoProxima('requested')).toBe('Enviar ao lab')
    expect(acaoProxima('sent_to_lab')).toBe('Registrar retorno')
    expect(acaoProxima('returned')).toBe('Instalar')
    expect(acaoProxima('installed')).toBeNull()
  })
  it('ehEtapa', () => {
    expect(ehEtapa('returned')).toBe(true)
    expect(ehEtapa('foo')).toBe(false)
    expect(ehEtapa(null)).toBe(false)
  })
})
