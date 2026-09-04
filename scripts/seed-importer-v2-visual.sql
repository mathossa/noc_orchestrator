-- Development-only synthetic Importer v2 reconciliation workspace seed.
-- Safe to rerun: it replaces only the fixed synthetic batch/rule book below.
-- No real customer inventory or canonical Device rows are created.

BEGIN;

DELETE FROM "ImporterV2WorkspaceBatch"
WHERE "id" = 'dev-importer-v2-visual-batch';

DELETE FROM "ImporterV2RuleBook"
WHERE "id" = 'dev-importer-v2-visual-rulebook';

INSERT INTO "ImporterV2RuleBook" (
  "id", "name", "activeRevisionVersion", "createdAt", "updatedAt"
) VALUES (
  'dev-importer-v2-visual-rulebook',
  'DEV synthetic importer visual review',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "ImporterV2RuleRevision" (
  "id", "ruleBookId", "version", "rules", "reason", "createdByUserId", "createdAt"
) VALUES (
  'dev-importer-v2-visual-rulebook-v1',
  'dev-importer-v2-visual-rulebook',
  1,
  '[]'::jsonb,
  'Synthetic empty baseline for Issue #50 visual validation',
  NULL,
  CURRENT_TIMESTAMP
);

INSERT INTO "ImporterV2WorkspaceBatch" (
  "id",
  "name",
  "provider",
  "sourceAdapterId",
  "profileId",
  "profileVersion",
  "ruleBookId",
  "evaluationFingerprint",
  "status",
  "rowCount",
  "createdAt",
  "updatedAt"
) VALUES (
  'dev-importer-v2-visual-batch',
  'Synthetic reconciliation review',
  'Synthetic Source',
  'synthetic-xlsx-adapter',
  'synthetic-network-inventory',
  '1',
  'dev-importer-v2-visual-rulebook',
  'dev-importer-v2-visual-fixture-v1',
  'RECONCILING',
  48,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

WITH rows AS (
  SELECT
    i,
    CASE ((i - 1) % 6)
      WHEN 0 THEN 'Aruba'
      WHEN 1 THEN 'Aruba'
      WHEN 2 THEN 'Cisco'
      WHEN 3 THEN 'Cisco'
      WHEN 4 THEN 'Fortinet'
      ELSE 'Fortinet'
    END AS vendor,
    CASE ((i - 1) % 6)
      WHEN 0 THEN 'AP-515'
      WHEN 1 THEN 'CX6200-24G'
      WHEN 2 THEN 'C9300-24P'
      WHEN 3 THEN 'Meraki MR44'
      WHEN 4 THEN 'FortiGate 100F'
      ELSE 'FortiSwitch 124F'
    END AS normal_model,
    CASE ((i - 1) % 6)
      WHEN 0 THEN 'AOS-10'
      WHEN 1 THEN 'AOS-CX'
      WHEN 2 THEN 'IOS-XE'
      WHEN 3 THEN 'Meraki'
      WHEN 4 THEN 'FortiOS'
      ELSE 'FortiSwitchOS'
    END AS platform,
    CASE ((i - 1) % 6)
      WHEN 0 THEN 'AP500'
      WHEN 1 THEN '6200'
      WHEN 2 THEN 'Catalyst 9300'
      WHEN 3 THEN 'MR'
      WHEN 4 THEN 'FortiGate 100F'
      ELSE 'FortiSwitch 100F'
    END AS family,
    CASE ((i - 1) % 6)
      WHEN 0 THEN 'Access Point'
      WHEN 1 THEN 'Switch'
      WHEN 2 THEN 'Switch'
      WHEN 3 THEN 'Access Point'
      WHEN 4 THEN 'Firewall'
      ELSE 'Switch'
    END AS device_type,
    CASE ((i - 1) % 3)
      WHEN 0 THEN 'Northwind Logistics'
      WHEN 1 THEN 'Contoso Retail'
      ELSE 'Fabrikam Services'
    END AS customer,
    CASE ((i - 1) % 4)
      WHEN 0 THEN 'eCom'
      WHEN 1 THEN 'Open Internet'
      WHEN 2 THEN 'Corporate'
      ELSE NULL
    END AS business_unit,
    CASE ((i - 1) % 5)
      WHEN 0 THEN 'Alkmaar'
      WHEN 1 THEN 'Amersfoort'
      WHEN 2 THEN 'Zaltbommel'
      WHEN 3 THEN 'Rotterdam'
      ELSE 'Utrecht'
    END AS site,
    CASE ((i - 1) % 6)
      WHEN 0 THEN '10.6.0.1'
      WHEN 1 THEN 'FL.10.13.1040'
      WHEN 2 THEN '17.12.05'
      WHEN 3 THEN '31.1.5'
      WHEN 4 THEN 'v7.4.7,build2731,240523 (GA.M)'
      ELSE 'v7.4.4'
    END AS running_version
  FROM generate_series(1, 48) AS source(i)
), shaped AS (
  SELECT
    *,
    CASE WHEN i % 9 = 0 THEN 'Unknown-' || i ELSE normal_model END AS source_model,
    CASE WHEN i % 9 = 0 THEN NULL ELSE normal_model END AS canonical_model,
    CASE
      WHEN i % 13 = 0 THEN NULL
      WHEN vendor = 'Aruba' AND platform = 'AOS-CX' THEN 'FL.10.12.0001'
      WHEN vendor = 'Cisco' AND normal_model = 'C9300-24P' THEN '17.12.05'
      ELSE running_version
    END AS raw_firmware,
    CASE
      WHEN i % 13 = 0 THEN 'unknown / not reported'
      WHEN vendor = 'Aruba' AND platform = 'AOS-CX' THEN running_version
      WHEN vendor = 'Cisco' AND normal_model = 'C9300-24P' THEN '17.12.05'
      ELSE NULL
    END AS raw_software,
    CASE
      WHEN i % 7 = 0 THEN 'NEEDS_REVIEW'
      WHEN i % 11 = 0 OR i % 13 = 0 THEN 'WARNING'
      WHEN i = 48 THEN 'EXCLUDED'
      ELSE 'VALID'
    END AS primary_status,
    CASE
      WHEN i = 48 THEN 'EXCLUDED'
      ELSE 'INCLUDED'
    END AS inclusion,
    CASE
      WHEN i % 7 = 0 THEN 2
      WHEN i % 11 = 0 OR i % 13 = 0 THEN 1
      ELSE 0
    END AS issue_count,
    CASE WHEN i % 7 = 0 THEN true ELSE false END AS has_errors,
    CASE ((i - 1) % 6)
      WHEN 0 THEN 'NEW'
      WHEN 1 THEN 'CHANGED'
      WHEN 2 THEN 'UNCHANGED'
      WHEN 3 THEN 'MOVED'
      WHEN 4 THEN 'RENAMED'
      ELSE 'AMBIGUOUS'
    END AS repeat_classification
  FROM rows
)
INSERT INTO "ImporterV2WorkspaceRow" (
  "id",
  "batchId",
  "rowNumber",
  "sourceFingerprint",
  "inclusion",
  "statuses",
  "primaryStatus",
  "repeatClassification",
  "issueCount",
  "hasErrors",
  "needsReevaluation",
  "reviewRevision",
  "sourceName",
  "hostname",
  "customer",
  "businessUnit",
  "site",
  "vendor",
  "deviceType",
  "sourceModel",
  "canonicalModel",
  "productFamily",
  "softwarePlatform",
  "firmwareEvidencePattern",
  "rawFirmwareVersion",
  "rawSoftwareVersion",
  "interpretedFirmware",
  "confidence",
  "evaluated",
  "identityResolution",
  "alternatives",
  "repeatDiff",
  "createdAt",
  "updatedAt"
)
SELECT
  'dev-importer-row-' || lpad(i::text, 3, '0'),
  'dev-importer-v2-visual-batch',
  i,
  'synthetic-row-' || lpad(i::text, 3, '0'),
  inclusion,
  CASE
    WHEN primary_status = 'VALID' THEN ARRAY['VALID', repeat_classification]::text[]
    WHEN primary_status = 'EXCLUDED' THEN ARRAY['EXCLUDED']::text[]
    ELSE ARRAY[primary_status, 'NEEDS_REVIEW', repeat_classification]::text[]
  END,
  primary_status,
  repeat_classification,
  issue_count,
  has_errors,
  false,
  0,
  'SYN-' || upper(substr(vendor, 1, 2)) || '-' || lpad(i::text, 3, '0'),
  lower(replace(site, ' ', '-')) || '-' || lpad(i::text, 2, '0') || '.example.test',
  customer,
  business_unit,
  site,
  vendor,
  device_type,
  source_model,
  canonical_model,
  family,
  platform,
  CASE
    WHEN i % 13 = 0 THEN 'missing-or-placeholder'
    WHEN raw_firmware IS NOT NULL AND raw_software IS NOT NULL THEN 'firmware+software'
    WHEN raw_firmware IS NOT NULL THEN 'firmware-only'
    ELSE 'software-only'
  END,
  raw_firmware,
  raw_software,
  CASE WHEN i % 13 = 0 THEN NULL ELSE running_version END,
  CASE
    WHEN i % 7 = 0 THEN 'LOW'
    WHEN i % 11 = 0 OR i % 13 = 0 OR i % 9 = 0 THEN 'MEDIUM'
    ELSE 'HIGH'
  END,
  jsonb_build_object(
    'rowNumber', i,
    'sourceFingerprint', 'synthetic-row-' || lpad(i::text, 3, '0'),
    'rawValues', jsonb_build_object(
      'customer', customer,
      'businessUnit', business_unit,
      'site', site,
      'deviceName', 'SYN-' || upper(substr(vendor, 1, 2)) || '-' || lpad(i::text, 3, '0'),
      'hostname', lower(replace(site, ' ', '-')) || '-' || lpad(i::text, 2, '0') || '.example.test',
      'sourceId', 'SRC-' || lpad(i::text, 4, '0'),
      'serialNumber', 'SYNTH' || lpad(i::text, 8, '0'),
      'macAddress', '02:00:00:00:' || lpad(to_hex((i / 256)::int), 2, '0') || ':' || lpad(to_hex((i % 256)::int), 2, '0'),
      'vendor', vendor,
      'productFamily', family,
      'softwarePlatform', platform,
      'model', source_model,
      'deviceType', device_type,
      'managementAddress', '192.0.2.' || ((i % 200) + 1)::text,
      'currentFirmware', CASE WHEN i % 13 = 0 THEN NULL ELSE running_version END,
      'firmwareVersion', raw_firmware,
      'softwareVersion', raw_software,
      'notes', 'Synthetic visual-validation row; no customer data.'
    ),
    'normalizedValues', jsonb_build_object(
      'customer', customer,
      'businessUnit', business_unit,
      'site', site,
      'vendor', vendor,
      'productFamily', family,
      'softwarePlatform', platform,
      'model', source_model,
      'deviceType', device_type,
      'firmwareVersion', raw_firmware,
      'softwareVersion', raw_software
    ),
    'proposedCanonicalValues', jsonb_build_object(
      'customer', jsonb_build_object('id', NULL, 'label', customer),
      'businessUnit', CASE WHEN business_unit IS NULL THEN NULL ELSE jsonb_build_object('id', NULL, 'label', business_unit) END,
      'site', jsonb_build_object('id', NULL, 'label', site),
      'vendor', jsonb_build_object('id', 'vendor-' || lower(vendor), 'label', vendor),
      'productFamily', jsonb_build_object('id', NULL, 'label', family),
      'softwarePlatform', jsonb_build_object('id', NULL, 'label', platform),
      'model', CASE WHEN canonical_model IS NULL THEN NULL ELSE jsonb_build_object('id', 'model-' || lower(replace(canonical_model, ' ', '-')), 'label', canonical_model) END,
      'deviceType', jsonb_build_object('id', NULL, 'label', device_type),
      'currentFirmware', CASE WHEN i % 13 = 0 THEN NULL ELSE jsonb_build_object('id', NULL, 'label', running_version) END
    ),
    'fields', jsonb_build_object(
      'vendor', jsonb_build_object(
        'proposedValue', jsonb_build_object('id', 'vendor-' || lower(vendor), 'label', vendor),
        'decision', jsonb_build_object(
          'source', 'EXACT_CATALOG_MATCH',
          'confidence', 'HIGH',
          'explanation', 'Synthetic exact vendor match.',
          'matchedCatalogValueId', 'vendor-' || lower(vendor),
          'matchedCatalogVersion', 'visual-fixture-v1'
        )
      ),
      'model', jsonb_build_object(
        'proposedValue', CASE WHEN canonical_model IS NULL THEN NULL ELSE jsonb_build_object('id', 'model-' || lower(replace(canonical_model, ' ', '-')), 'label', canonical_model) END,
        'decision', jsonb_build_object(
          'source', CASE WHEN canonical_model IS NULL THEN 'NON_BINDING_SUGGESTION' ELSE 'EXACT_CATALOG_MATCH' END,
          'confidence', CASE WHEN canonical_model IS NULL THEN 'LOW' ELSE 'HIGH' END,
          'explanation', CASE WHEN canonical_model IS NULL THEN 'Synthetic source model is intentionally unknown; review alternatives.' ELSE 'Synthetic exact model match.' END,
          'matchedSuggestionId', CASE WHEN canonical_model IS NULL THEN 'synthetic-model-suggestion' ELSE NULL END,
          'matchedSuggestionVersion', CASE WHEN canonical_model IS NULL THEN '1' ELSE NULL END
        )
      ),
      'currentFirmware', jsonb_build_object(
        'proposedValue', CASE WHEN i % 13 = 0 THEN NULL ELSE jsonb_build_object('id', NULL, 'label', running_version) END,
        'decision', jsonb_build_object(
          'source', CASE WHEN i % 13 = 0 THEN 'UNRESOLVED' ELSE 'DETERMINISTIC_PARSER' END,
          'confidence', CASE WHEN i % 13 = 0 THEN 'LOW' ELSE 'HIGH' END,
          'explanation', CASE WHEN i % 13 = 0 THEN 'Synthetic fixture intentionally has no trustworthy running firmware.' ELSE 'Synthetic deterministic firmware interpretation from raw evidence.' END,
          'matchedParserId', CASE WHEN i % 13 = 0 THEN NULL ELSE 'synthetic-firmware-parser' END,
          'matchedParserVersion', CASE WHEN i % 13 = 0 THEN NULL ELSE '1' END
        )
      )
    ),
    'issues', CASE
      WHEN i % 7 = 0 THEN jsonb_build_array(
        jsonb_build_object('rowNumber', i, 'rowFingerprint', 'synthetic-row-' || lpad(i::text, 3, '0'), 'field', 'model', 'severity', 'ERROR', 'code', 'REQUIRED_FIELD_UNRESOLVED', 'message', 'Synthetic error: canonical model must be confirmed.'),
        jsonb_build_object('rowNumber', i, 'rowFingerprint', 'synthetic-row-' || lpad(i::text, 3, '0'), 'field', 'currentFirmware', 'severity', 'WARNING', 'code', 'OPTIONAL_FIELD_UNRESOLVED', 'message', 'Synthetic warning: firmware evidence needs review.')
      )
      WHEN i % 11 = 0 THEN jsonb_build_array(
        jsonb_build_object('rowNumber', i, 'rowFingerprint', 'synthetic-row-' || lpad(i::text, 3, '0'), 'field', 'model', 'severity', 'WARNING', 'code', 'AMBIGUOUS_DECISION', 'message', 'Synthetic warning: multiple model candidates have similar evidence.')
      )
      WHEN i % 13 = 0 THEN jsonb_build_array(
        jsonb_build_object('rowNumber', i, 'rowFingerprint', 'synthetic-row-' || lpad(i::text, 3, '0'), 'field', 'currentFirmware', 'severity', 'WARNING', 'code', 'OPTIONAL_FIELD_UNRESOLVED', 'message', 'Synthetic warning: running firmware could not be interpreted from the source values.')
      )
      ELSE '[]'::jsonb
    END,
    'statuses', CASE
      WHEN primary_status = 'VALID' THEN to_jsonb(ARRAY['VALID', repeat_classification]::text[])
      WHEN primary_status = 'EXCLUDED' THEN to_jsonb(ARRAY['EXCLUDED']::text[])
      ELSE to_jsonb(ARRAY[primary_status, 'NEEDS_REVIEW', repeat_classification]::text[])
    END,
    'inclusion', inclusion,
    'comparisonRecordId', CASE WHEN repeat_classification IN ('CHANGED', 'UNCHANGED', 'MOVED', 'RENAMED') THEN 'canonical-device-' || lpad(i::text, 3, '0') ELSE NULL END
  ),
  CASE
    WHEN i % 5 = 0 OR i % 7 = 0 THEN jsonb_build_object(
      'status', 'REVIEW_REQUIRED',
      'candidates', jsonb_build_array(
        jsonb_build_object(
          'deviceId', 'canonical-device-' || lpad(i::text, 3, '0'),
          'confidence', CASE WHEN i % 7 = 0 THEN 'MEDIUM' ELSE 'HIGH' END,
          'evidence', jsonb_build_array('serialNumber', 'macAddress'),
          'explanation', 'Synthetic identity candidate using durable identifiers.'
        ),
        jsonb_build_object(
          'deviceId', 'canonical-device-alt-' || lpad(i::text, 3, '0'),
          'confidence', 'LOW',
          'evidence', jsonb_build_array('hostname'),
          'explanation', 'Hostname-only alternative is intentionally non-binding.'
        )
      )
    )
    ELSE NULL
  END,
  CASE
    WHEN canonical_model IS NULL THEN jsonb_build_array(
      jsonb_build_object('field', 'model', 'label', normal_model, 'confidence', 'MEDIUM', 'explanation', 'Synthetic closest model suggestion.'),
      jsonb_build_object('field', 'model', 'label', normal_model || ' variant', 'confidence', 'LOW', 'explanation', 'Synthetic secondary suggestion.')
    )
    ELSE NULL
  END,
  jsonb_build_object(
    'classification', repeat_classification,
    'changes', CASE
      WHEN repeat_classification = 'UNCHANGED' THEN '[]'::jsonb
      WHEN repeat_classification = 'MOVED' THEN jsonb_build_array(jsonb_build_object('field', 'site', 'before', 'Previous Site', 'after', site))
      WHEN repeat_classification = 'RENAMED' THEN jsonb_build_array(jsonb_build_object('field', 'deviceName', 'before', 'OLD-' || i::text, 'after', 'SYN-' || i::text))
      ELSE jsonb_build_array(jsonb_build_object('field', 'firmwareVersion', 'before', 'previous', 'after', raw_firmware))
    END
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM shaped;

COMMIT;
