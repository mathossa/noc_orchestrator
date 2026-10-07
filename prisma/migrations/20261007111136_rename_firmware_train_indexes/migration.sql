-- RenameIndex
ALTER INDEX "FirmwareTrain_minimum_release_idx" RENAME TO "FirmwareTrain_minimumAcceptableFirmwareReleaseId_idx";

-- RenameIndex
ALTER INDEX "FirmwareTrain_preferred_release_idx" RENAME TO "FirmwareTrain_preferredFirmwareReleaseId_idx";
