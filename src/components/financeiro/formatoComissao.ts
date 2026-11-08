export const brl = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** 'YYYY-MM-DD' (ou timestamp ISO) -> 'dd/mm/aaaa' */
export const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`

export const pct = (n: number) => `${String(n).replace('.', ',')}%`
