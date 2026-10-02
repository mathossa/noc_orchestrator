import { describe, expect, it } from 'vitest'
import {
  decryptInventorySourceSecret,
  encryptInventorySourceSecret,
} from '@/lib/inventory-source-secret-crypto'

const key = Buffer.alloc(32, 7)

describe('inventory source secret encryption', () => {
  it('round-trips a credential payload without storing plaintext', () => {
    const payload = {
      username: 'service@example.com',
      apiKey: 'super-secret-api-key',
    }
    const envelope = encryptInventorySourceSecret('source-1', payload, key)

    expect(envelope.ciphertext).not.toContain(payload.username)
    expect(envelope.ciphertext).not.toContain(payload.apiKey)
    expect(
      decryptInventorySourceSecret<typeof payload>('source-1', envelope, key),
    ).toEqual(payload)
  })

  it('binds ciphertext to the source id through authenticated data', () => {
    const envelope = encryptInventorySourceSecret(
      'source-1',
      { apiKey: 'secret' },
      key,
    )

    expect(() =>
      decryptInventorySourceSecret('source-2', envelope, key),
    ).toThrow('could not be decrypted')
  })

  it('rejects incorrectly sized keys', () => {
    expect(() =>
      encryptInventorySourceSecret('source-1', {}, Buffer.alloc(16)),
    ).toThrow('exactly 32 bytes')
  })
})
