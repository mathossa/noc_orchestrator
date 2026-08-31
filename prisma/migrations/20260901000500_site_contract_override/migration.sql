-- A customer contract is the default. A site may override it with another
-- configured contract type when that location is covered differently.
ALTER TABLE "Site"
ADD COLUMN "contractTypeId" TEXT;

CREATE INDEX "Site_contractTypeId_idx" ON "Site"("contractTypeId");

ALTER TABLE "Site"
ADD CONSTRAINT "Site_contractTypeId_fkey"
FOREIGN KEY ("contractTypeId") REFERENCES "ContractType"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
