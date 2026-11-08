import { describe, it, expect } from 'vitest'
import { divergencias } from '@/lib/convenios/divergencia'

const item = { code: '81000049', value: 100, teeth: [{ tooth: 16, faces: ['M'] }] }

describe('divergencias', () => {
  it('tratamento nulo → sem divergência', () => {
    expect(divergencias(item, null)).toEqual([])
  })
  it('divergências de dente e valor', () => {
    expect(divergencias(item, { code: '81000049', value: 100, teeth: [{ tooth: 16, faces: ['M', 'O'] }] })).toEqual(['dentes'])
    expect(divergencias(item, { code: '81000049', value: 120, teeth: item.teeth })).toEqual(['valor'])
    expect(divergencias(item, { code: '999', value: 100, teeth: item.teeth })).toEqual(['procedimento'])
  })
  it('ordem diferente não diverge; tolerância de valor', () => {
    const a = { code: 'X', value: 100, teeth: [{ tooth: 26, faces: ['O', 'M'] }, { tooth: 16, faces: ['M'] }] }
    const b = { code: 'X', value: 100.004, teeth: [{ tooth: 16, faces: ['M'] }, { tooth: 26, faces: ['M', 'O'] }] }
    expect(divergencias(a, b)).toEqual([])
  })
  it('várias divergências', () => {
    expect(divergencias(item, { code: null, value: 1, teeth: [] })).toEqual(['procedimento', 'valor', 'dentes'])
  })
})
