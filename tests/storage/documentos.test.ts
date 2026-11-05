import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { documentPath, signedUrls } from '@/lib/storage/documentos'

describe('documentPath', () => {
  it('extracts storage path from legacy public url', () => {
    expect(
      documentPath('https://x.supabase.co/storage/v1/object/public/anneOdonto/c1/p1/a%20b.pdf?t=1'),
    ).toBe('c1/p1/a b.pdf')
  })

  it('falls back to the undecoded path on malformed percent sequences', () => {
    expect(
      documentPath('https://x.supabase.co/storage/v1/object/public/anneOdonto/c1/p1/100%.pdf'),
    ).toBe('c1/p1/100%.pdf')
  })

  it('keeps plain path', () => {
    expect(documentPath('c1/p1/a.pdf')).toBe('c1/p1/a.pdf')
  })
})

describe('signedUrls', () => {
  it('maps paths', async () => {
    const calls: unknown[][] = []
    const fake = {
      storage: {
        from: (bucket: string) => ({
          createSignedUrls: async (paths: string[], ttl: number) => {
            calls.push([bucket, paths, ttl])
            return {
              data: [
                { path: 'a', signedUrl: 'https://s/a', error: null },
                { path: 'b', signedUrl: null, error: 'Object not found' },
              ],
              error: null,
            }
          },
        }),
      },
    } as unknown as SupabaseClient

    const map = await signedUrls(fake, 'anneOdonto', ['a', 'b'])
    expect(map).toEqual({ a: 'https://s/a' })
    expect(calls).toEqual([['anneOdonto', ['a', 'b'], 3600]])
  })
})
