import { prisma } from '@/lib/prisma'
import {
  decryptInventorySourceSecret,
  encryptInventorySourceSecret,
  INVENTORY_SOURCE_SECRET_ALGORITHM,
  INVENTORY_SOURCE_SECRET_KEY_VERSION,
} from '@/lib/inventory-source-secret-crypto'

export async function saveInventorySourceSecret(
  sourceId: string,
  payload: unknown,
) {
  const envelope = encryptInventorySourceSecret(sourceId, payload)
  await prisma.inventorySourceSecret.upsert({
    where: { sourceId },
    create: {
      sourceId,
      ...envelope,
    },
    update: {
      ...envelope,
    },
  })
}

export async function loadInventorySourceSecret<T>(sourceId: string) {
  const record = await prisma.inventorySourceSecret.findUnique({
    where: { sourceId },
    select: {
      algorithm: true,
      keyVersion: true,
      initializationVector: true,
      authenticationTag: true,
      ciphertext: true,
    },
  })
  if (!record) return null
  if (record.algorithm !== INVENTORY_SOURCE_SECRET_ALGORITHM) {
    throw new Error('Unsupported inventory source secret algorithm.')
  }
  if (record.keyVersion !== INVENTORY_SOURCE_SECRET_KEY_VERSION) {
    throw new Error('Unsupported inventory source secret key version.')
  }
  return decryptInventorySourceSecret<T>(sourceId, {
    algorithm: INVENTORY_SOURCE_SECRET_ALGORITHM,
    keyVersion: INVENTORY_SOURCE_SECRET_KEY_VERSION,
    initializationVector: record.initializationVector,
    authenticationTag: record.authenticationTag,
    ciphertext: record.ciphertext,
  })
}

export async function inventorySourceHasSecret(sourceId: string) {
  const count = await prisma.inventorySourceSecret.count({
    where: { sourceId },
  })
  return count > 0
}

export async function deleteInventorySourceSecret(sourceId: string) {
  await prisma.inventorySourceSecret.deleteMany({ where: { sourceId } })
}
