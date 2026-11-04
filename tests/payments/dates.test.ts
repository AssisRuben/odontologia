import { describe, expect, it } from 'vitest'
import { fromDbPaidAt, toDbPaidAt } from '@/lib/payments/dates'

describe('paid_at helpers', () => {
  it('toDbPaidAt accepts ymd or ISO', () => {
    expect(toDbPaidAt('2027-01-10')).toBe('2027-01-10T12:00:00Z')
    expect(toDbPaidAt('2027-01-10T03:00:00.000Z')).toBe('2027-01-10T12:00:00Z')
  })
  it('fromDbPaidAt returns ymd', () => {
    expect(fromDbPaidAt('2027-01-10T12:00:00+00:00')).toBe('2027-01-10')
    expect(fromDbPaidAt(null)).toBeNull()
  })
})
