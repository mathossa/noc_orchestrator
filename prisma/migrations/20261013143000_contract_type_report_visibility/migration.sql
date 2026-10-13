-- Add explicit reporting visibility to contract types.
-- Existing contracts remain opt-in; report inclusion is configured deliberately.
ALTER TABLE "ContractType"
ADD COLUMN "showInReport" BOOLEAN NOT NULL DEFAULT false;
