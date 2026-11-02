import { describe, it, expect } from 'vitest'
import { normalizePhone } from '@/lib/messaging/phone'

describe('normalizePhone', () => {
  it.each([
    ['(11) 98765-4321', '5511987654321'],
    ['11987654321', '5511987654321'],
    ['5511987654321', '5511987654321'],
    ['+55 11 98765-4321', '5511987654321'],
    ['011987654321', '5511987654321'],
    ['1187654321', '5511987654321'], // celular sem o 9
    ['551187654321', '5511987654321'], // JID antigo do WhatsApp, sem o 9
  ])('%s → %s', (raw, out) => expect(normalizePhone(raw)).toBe(out))
  it.each([['1133334444'], ['551133334444'], ['123'], [''], [null], [undefined], ['abc']])(
    'rejeita %s',
    (raw) => expect(normalizePhone(raw as any)).toBeNull(),
  )
})
