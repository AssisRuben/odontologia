// Troca da situação direto no registro da aba Tratamentos, com as mesmas regras da janela de edição.
import type { TreatmentStatus } from '@/types'
import { dataValida } from '@/lib/convenios/cadastro'

/** O que a troca precisa antes de gravar. */
export type PassoDaTroca = 'nada' | 'gravar' | 'pedirData' | 'perguntarMaterial'

export function passoDaTroca(atual: TreatmentStatus, novo: TreatmentStatus, materialStatus: string | null | undefined): PassoDaTroca {
  if (novo === atual) return 'nada'
  // Concluir pede a data de execução (base da comissão).
  if (novo === 'completed') return 'pedirData'
  // Sair de concluído com material já baixado: perguntar se ele volta ao estoque.
  if (atual === 'completed' && materialStatus === 'baixado') return 'perguntarMaterial'
  return 'gravar'
}

export function camposDaTroca(novo: TreatmentStatus, executadoEm?: string) {
  return { status: novo, completed_at: novo === 'completed' ? (executadoEm ?? null) : null }
}

/** Data de execução: válida, de 2000 em diante e não no futuro (yyyy-MM-dd). */
export function dataExecucaoValida(ymd: string, hoje: string): boolean {
  return dataValida(ymd) && ymd >= '2000-01-01' && ymd <= hoje
}
