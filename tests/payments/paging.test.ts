import { describe, expect, it, vi } from 'vitest'
import { fetchAllPages, PAGE_SIZE } from '@/lib/payments/repo'

const rows = (n: number, start = 0) => Array.from({ length: n }, (_, i) => start + i)

describe('fetchAllPages', () => {
  it('pages in chunks of 1000 until a short page', async () => {
    const page = vi.fn(async (from: number, to: number) => rows(Math.min(to - from + 1, 2500 - from), from))
    const out = await fetchAllPages(page)
    expect(PAGE_SIZE).toBe(1000)
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(out).toHaveLength(2500)
    expect(out[2499]).toBe(2499)
  })

  it('stops after an exactly full last page with one empty request', async () => {
    const page = vi.fn(async (from: number) => (from < 2000 ? rows(1000, from) : []))
    expect(await fetchAllPages(page)).toHaveLength(2000)
    expect(page).toHaveBeenCalledTimes(3)
  })

  it('stops when the deadline is reached, keeping what was read', async () => {
    let calls = 0
    const page = vi.fn(async (from: number) => {
      calls++
      return rows(1000, from)
    })
    const out = await fetchAllPages(page, () => calls < 2)
    expect(page).toHaveBeenCalledTimes(2)
    expect(out).toHaveLength(2000)
  })
})
