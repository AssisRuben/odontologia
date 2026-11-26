// Geometria do odontograma: lado de cada face e o desenho do dente em pé (coroa e raízes).

export type TipoDente = 'central' | 'lateral' | 'canino' | 'premolar' | 'molar' | 'siso'

/** Quadrante FDI do dente (1–4 permanentes, 5–8 decíduos). */
export const quadrante = (n: number) => Math.floor(n / 10)

/** Dente da arcada superior (quadrantes 1, 2, 5 e 6). */
export const ehSuperior = (n: number) => [1, 2, 5, 6].includes(quadrante(n))

/**
 * A mesial fica do lado do meio da boca. No gráfico, o lado direito do paciente aparece à esquerda
 * da tela, então nos quadrantes 1, 4, 5 e 8 a mesial fica à direita do dente.
 */
export const mesialADireita = (n: number) => [1, 4, 5, 8].includes(quadrante(n))

export function tipoDoDente(n: number): TipoDente {
  const u = n % 10
  if (quadrante(n) >= 5) return u === 1 ? 'central' : u === 2 ? 'lateral' : u === 3 ? 'canino' : 'molar'
  return u === 1 ? 'central' : u === 2 ? 'lateral' : u === 3 ? 'canino' : u <= 5 ? 'premolar' : u === 8 ? 'siso' : 'molar'
}

// Desenhado como dente superior: raiz para cima, coroa para baixo. O inferior é espelhado na vertical.
export const LARGURA = 30
export const ALTURA = 66
/** Altura do colo (onde a coroa encontra a raiz). */
export const COLO = 34
const CX = 15

const MEDIDAS: Record<TipoDente, { cw: number; mw: number; B: number }> = {
  central: { cw: 6, mw: 8, B: 60 },
  lateral: { cw: 5, mw: 6.5, B: 58 },
  canino: { cw: 5.5, mw: 7.5, B: 61 },
  premolar: { cw: 5, mw: 7, B: 58 },
  molar: { cw: 8.5, mw: 11, B: 57 },
  siso: { cw: 7.5, mw: 9.5, B: 56 },
}

export interface Coroa {
  /** Contorno da coroa. */
  d: string
  /** Meia largura máxima da coroa. */
  meiaLargura: number
  /** Altura da borda oclusal/incisal. */
  borda: number
}

export function coroa(tipo: TipoDente, deciduo: boolean): Coroa {
  const k = deciduo ? 0.86 : 1
  const g = MEDIDAS[tipo]
  const cw = g.cw * k, mw = g.mw * k, B = COLO + (g.B - COLO) * k
  const C = COLO
  const lado = `M${CX - cw},${C} C${CX - mw},${C + 8} ${CX - mw},${B - 9} ${CX - mw},${B - 6}`
  const volta = `C${CX + mw},${B - 9} ${CX + mw},${C + 8} ${CX + cw},${C} Q${CX},${C - 4.5} ${CX - cw},${C} Z`
  let borda: string
  if (tipo === 'central' || tipo === 'lateral') {
    borda = `Q${CX - mw},${B} ${CX - mw + 2},${B} L${CX + mw - 2},${B} Q${CX + mw},${B} ${CX + mw},${B - 6}`
  } else if (tipo === 'canino' || tipo === 'premolar') {
    borda = `Q${CX - mw + 0.5},${B - 2} ${CX - 3},${B - 0.8} Q${CX},${B + 1} ${CX + 3},${B - 0.8} Q${CX + mw - 0.5},${B - 2} ${CX + mw},${B - 6}`
  } else {
    // molares: duas cúspides vestibulares
    borda = `Q${CX - mw},${B} ${CX - mw / 2},${B} Q${CX - 0.5},${B} ${CX},${B - 2.2} Q${CX + 0.5},${B} ${CX + mw / 2},${B} Q${CX + mw},${B} ${CX + mw},${B - 6}`
  }
  return { d: `${lado} ${borda} ${volta}`, meiaLargura: mw, borda: B }
}

function raiz(x0: number, x1: number, ax: number, ay: number) {
  const C = COLO
  const m = ay + (C - ay) * 0.3
  return `M${x0},${C + 3} L${x0},${C} C${x0},${m} ${ax - 2.6},${ay} ${ax},${ay} C${ax + 2.6},${ay} ${x1},${m} ${x1},${C} L${x1},${C + 3} Z`
}

/** Raízes do dente; `fundo` é a raiz palatina dos molares superiores, que aparece atrás das outras. */
export function raizes(tipo: TipoDente, superior: boolean, deciduo: boolean): { d: string; fundo?: boolean }[] {
  const curta = deciduo ? 10 : 0
  switch (tipo) {
    case 'central': return [{ d: raiz(CX - 5.5, CX + 5.5, CX, 6 + curta) }]
    case 'lateral': return [{ d: raiz(CX - 4.5, CX + 4.5, CX, 8 + curta) }]
    case 'canino': return [{ d: raiz(CX - 5, CX + 5, CX, 1 + curta) }]
    case 'premolar': return [{ d: raiz(CX - 4.5, CX + 4.5, CX, 6 + curta) }]
    case 'siso': return [{ d: raiz(CX - 6.5, CX + 6, CX + 0.5, 12 + curta) }]
    case 'molar': {
      const apice = deciduo ? 12 : 6
      const abre = deciduo ? 2 : 0 // molares de leite têm as raízes mais abertas
      const vestibulares = [
        { d: raiz(CX - 8.5, CX - 1, CX - 7 - abre, apice) },
        { d: raiz(CX + 1, CX + 8.5, CX + 7 + abre, apice + 2) },
      ]
      return superior ? [{ d: raiz(CX - 3, CX + 3, CX, apice - 3), fundo: true }, ...vestibulares] : vestibulares
    }
  }
}

/** Faixas da coroa em pé: mesial e distal nas laterais, oclusal/incisal na borda, vestibular no resto. */
export function faixasDaCoroa(c: Coroa, mesialDireita: boolean) {
  const largura = c.meiaLargura * 0.55
  const direita = CX + c.meiaLargura - largura
  const esquerda = CX - c.meiaLargura - 1
  return {
    largura: largura + 1,
    xMesial: mesialDireita ? direita : esquerda,
    xDistal: mesialDireita ? esquerda : direita,
    yOclusal: c.borda - 5.5,
  }
}

/** Contorno da gengiva, com a papila subindo entre os dentes; passa um pouco das bordas para emendar com o vizinho. */
export const GENGIVA = `M-3,${COLO - 18} H${LARGURA + 3} V${COLO + 3.2} L${LARGURA},${COLO + 3.5} Q${CX},${COLO - 5.5} 0,${COLO + 3.5} L-3,${COLO + 3.2} Z`
export const LINHA_GENGIVA = `M0,${COLO + 3.5} Q${CX},${COLO - 5.5} ${LARGURA},${COLO + 3.5}`
