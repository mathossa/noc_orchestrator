ALTER TABLE "FirmwareWorkPlan"
ADD COLUMN "proposedFor" TIMESTAMP(3),
ADD COLUMN "proposedMaintenanceWindowReference" TEXT;

CREATE INDEX "FirmwareWorkPlan_state_proposedFor_idx"
ON "FirmwareWorkPlan"("state", "proposedFor");
