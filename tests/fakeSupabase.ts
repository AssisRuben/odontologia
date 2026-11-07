import type { SupabaseClient } from '@supabase/supabase-js'

export type Call = [string, ...unknown[]]
export type Query = { table: string; calls: Call[] }

/**
 * Cliente Supabase falso: grava cada chamada encadeada (`eq`, `in`, `order`…) e,
 * ao ser aguardado, devolve `resolve(query, índice)`.
 */
export function fakeAdmin(resolve: (q: Query, index: number) => unknown = () => ({ data: null, error: null })) {
  const queries: Query[] = []
  const admin = {
    from(table: string) {
      const q: Query = { table, calls: [] }
      const index = queries.length
      queries.push(q)
      const chain: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
                Promise.resolve().then(() => resolve(q, index)).then(ok, err)
            }
            return (...args: unknown[]) => {
              q.calls.push([String(prop), ...args])
              return chain
            }
          },
        },
      )
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, queries }
}
