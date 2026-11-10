import Link from 'next/link'
import type { InventoryMovement } from '@/types'
import { rotuloTratamento } from '@/lib/kits/baixa'

/** Texto do tratamento da movimentação, com link para o paciente quando houver. */
export function RotuloTratamento({ m, className }: { m: InventoryMovement; className?: string }) {
  const texto = rotuloTratamento(m)
  if (!texto) return null
  const pid = m.treatment?.patient?.id
  return pid
    ? <Link href={`/pacientes/${pid}`} className={`text-petroleo hover:underline ${className ?? ''}`}>{texto}</Link>
    : <span className={className}>{texto}</span>
}
