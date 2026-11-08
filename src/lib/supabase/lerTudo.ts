const PAGINA = 1000

/** Lê todas as linhas de uma consulta, página a página (o PostgREST corta em 1000). */
export async function lerTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1)
    if (error) throw new Error(error.message)
    const linhas = (data ?? []) as T[]
    todas.push(...linhas)
    if (linhas.length < PAGINA) return todas
  }
}
