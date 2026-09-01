CREATE TABLE "DeviceModelFamily" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceModelFamily_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DeviceModel"
ADD COLUMN "familyId" TEXT;

CREATE UNIQUE INDEX "DeviceModelFamily_vendorId_name_key"
ON "DeviceModelFamily"("vendorId", "name");

CREATE INDEX "DeviceModelFamily_vendorId_idx"
ON "DeviceModelFamily"("vendorId");

CREATE INDEX "DeviceModelFamily_isActive_idx"
ON "DeviceModelFamily"("isActive");

CREATE INDEX "DeviceModel_familyId_idx"
ON "DeviceModel"("familyId");

ALTER TABLE "DeviceModelFamily"
ADD CONSTRAINT "DeviceModelFamily_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceModel"
ADD CONSTRAINT "DeviceModel_familyId_fkey"
FOREIGN KEY ("familyId") REFERENCES "DeviceModelFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
