-- Current-firmware identity is an observed inventory fact. Older importer runs could
-- persist currentFirmwareRawVersion/currentFirmwareNormalizedVersion while leaving
-- currentFirmwareReleaseId NULL when compatibility had not yet been confirmed.
--
-- Backfill only when vendor + observed version + supported model platform identify
-- exactly one catalog release. Compatibility/policy state is deliberately not part
-- of this identity repair.
WITH observed_candidates AS (
  SELECT
    d.id AS device_id,
    fr.id AS release_id,
    COUNT(*) OVER (PARTITION BY d.id) AS candidate_count
  FROM "Device" d
  JOIN "DeviceModel" dm
    ON dm.id = d."deviceModelId"
  JOIN "FirmwareRelease" fr
    ON fr."vendorId" = dm."vendorId"
   AND LOWER(BTRIM(fr.version)) = LOWER(
     BTRIM(
       COALESCE(
         NULLIF(d."currentFirmwareNormalizedVersion", ''),
         NULLIF(d."currentFirmwareRawVersion", '')
       )
     )
   )
  WHERE d."currentFirmwareReleaseId" IS NULL
    AND COALESCE(
      NULLIF(BTRIM(d."currentFirmwareNormalizedVersion"), ''),
      NULLIF(BTRIM(d."currentFirmwareRawVersion"), '')
    ) IS NOT NULL
    AND (
      dm.platform IS NULL
      OR BTRIM(dm.platform) = ''
      OR EXISTS (
        SELECT 1
        FROM unnest(string_to_array(dm.platform, ',')) AS supported(platform)
        WHERE LOWER(BTRIM(supported.platform)) = LOWER(BTRIM(fr.platform))
      )
    )
), unique_matches AS (
  SELECT device_id, release_id
  FROM observed_candidates
  WHERE candidate_count = 1
)
UPDATE "Device" d
SET
  "currentFirmwareReleaseId" = match.release_id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM unique_matches match
WHERE d.id = match.device_id
  AND d."currentFirmwareReleaseId" IS NULL;
