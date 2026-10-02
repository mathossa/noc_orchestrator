CREATE TABLE "InventorySourceSecret" (
    "sourceId" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "initializationVector" TEXT NOT NULL,
    "authenticationTag" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySourceSecret_pkey" PRIMARY KEY ("sourceId")
);

ALTER TABLE "InventorySourceSecret"
ADD CONSTRAINT "InventorySourceSecret_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "InventorySource"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
