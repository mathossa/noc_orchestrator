import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from 'node:crypto'

export const INVENTORY_SOURCE_SECRET_ALGORITHM = 'aes-256-gcm'
export const INVENTORY_SOURCE_SECRET_KEY_VERSION = 1

export type InventorySourceSecretEnvelope = {
  algorithm: typeof INVENTORY_SOURCE_SECRET_ALGORITHM
  keyVersion: typeof INVENTORY_SOURCE_SECRET_KEY_VERSION
  initializationVector: string
  authenticationTag: string
  ciphertext: string
}

function encryptionKey(explicitKey?: Buffer) {
  if (explicitKey) {
    if (explicitKey.byteLength !== 32) {
      throw new Error('Inventory source secret key must be exactly 32 bytes.')
    }
    return explicitKey
  }

  const encoded = process.env.INVENTORY_SOURCE_SECRET_KEY?.trim()
  if (!encoded) {
    throw new Error(
      'INVENTORY_SOURCE_SECRET_KEY is required to store integration credentials.',
    )
  }

  const key = Buffer.from(encoded, 'base64')
  if (key.byteLength !== 32 || key.toString('base64') !== encoded.replace(/\s+/g, '')) {
    throw new Error(
      'INVENTORY_SOURCE_SECRET_KEY must be a base64-encoded 32-byte key.',
    )
  }
  return key
}

function aad(sourceId: string) {
  const normalized = sourceId.normalize('NFKC').trim()
  if (!normalized) throw new Error('Inventory source ID is required.')
  return Buffer.from(`inventory-source:${normalized}`, 'utf8')
}

export function encryptInventorySourceSecret(
  sourceId: string,
  payload: unknown,
  explicitKey?: Buffer,
): InventorySourceSecretEnvelope {
  const key = encryptionKey(explicitKey)
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv(
    INVENTORY_SOURCE_SECRET_ALGORITHM as CipherGCMTypes,
    key,
    initializationVector,
  )
  cipher.setAAD(aad(sourceId))
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authenticationTag = cipher.getAuthTag()

  return {
    algorithm: INVENTORY_SOURCE_SECRET_ALGORITHM,
    keyVersion: INVENTORY_SOURCE_SECRET_KEY_VERSION,
    initializationVector: initializationVector.toString('base64'),
    authenticationTag: authenticationTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptInventorySourceSecret<T>(
  sourceId: string,
  envelope: InventorySourceSecretEnvelope,
  explicitKey?: Buffer,
): T {
  if (envelope.algorithm !== INVENTORY_SOURCE_SECRET_ALGORITHM) {
    throw new Error('Unsupported inventory source secret algorithm.')
  }
  if (envelope.keyVersion !== INVENTORY_SOURCE_SECRET_KEY_VERSION) {
    throw new Error('Unsupported inventory source secret key version.')
  }

  const key = encryptionKey(explicitKey)
  const decipher = createDecipheriv(
    INVENTORY_SOURCE_SECRET_ALGORITHM as CipherGCMTypes,
    key,
    Buffer.from(envelope.initializationVector, 'base64'),
  )
  decipher.setAAD(aad(sourceId))
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'))

  let plaintext: Buffer
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ])
  } catch {
    throw new Error('Inventory source credentials could not be decrypted.')
  }

  try {
    return JSON.parse(plaintext.toString('utf8')) as T
  } catch {
    throw new Error('Inventory source credentials contain invalid JSON.')
  }
}
