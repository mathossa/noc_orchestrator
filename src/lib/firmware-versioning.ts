export type FirmwareVersionOrder = 'LESS' | 'EQUAL' | 'GREATER' | 'NOT_COMPARABLE'

export type FirmwareReleaseIdentity = {
  exactVersion: string
  logicalVersion: string
  variant: string | null
  imageCode: string | null
  parserId: 'aruba-image-dotted-v1' | 'cisco-ios-train-v1' | 'numeric-dotted-v1' | 'opaque-v1'
}

export type FirmwareVersionComparison = {
  result: FirmwareVersionOrder
  comparatorId: string
  reason: string
}

type NumericDottedIdentity = FirmwareReleaseIdentity & {
  numericParts: number[]
}

type CiscoIdentity = FirmwareReleaseIdentity & {
  major: number
  minor: number
  maintenance: number
  train: string
  build: number
}

function clean(value: string) {
  return value.normalize('NFKC').trim()
}

function normalizedDomain(value: string) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function numericParts(value: string) {
  const parts = value.split('.')
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) return null
  return parts.map((part) => Number.parseInt(part, 10))
}

function compareNumbers(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    if (leftValue < rightValue) return 'LESS' as const
    if (leftValue > rightValue) return 'GREATER' as const
  }
  return 'EQUAL' as const
}

function parseArubaImageDotted(version: string): NumericDottedIdentity | null {
  const match = /^([A-Za-z]{1,8})\.(\d+(?:\.\d+){2,})([A-Za-z][A-Za-z0-9._-]*)?$/.exec(version)
  if (!match) return null
  const parts = numericParts(match[2])
  if (!parts) return null
  return {
    exactVersion: version,
    logicalVersion: match[2],
    variant: match[3] ?? null,
    imageCode: match[1].toUpperCase(),
    parserId: 'aruba-image-dotted-v1',
    numericParts: parts,
  }
}

function parseCiscoIosTrain(version: string): CiscoIdentity | null {
  const match = /^(\d+)\.(\d+)\((\d+)\)([A-Za-z]+)(\d+)([A-Za-z]+)?$/.exec(version)
  if (!match) return null
  const variant = match[6] ?? null
  return {
    exactVersion: version,
    logicalVersion: `${match[1]}.${match[2]}(${match[3]})${match[4]}${match[5]}`,
    variant,
    imageCode: null,
    parserId: 'cisco-ios-train-v1',
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    maintenance: Number.parseInt(match[3], 10),
    train: match[4].toUpperCase(),
    build: Number.parseInt(match[5], 10),
  }
}

function parseNumericDotted(version: string): NumericDottedIdentity | null {
  const match = /^(?:v)?(\d+(?:\.\d+)+)([A-Za-z][A-Za-z0-9._-]*)?$/.exec(version)
  if (!match) return null
  const parts = numericParts(match[1])
  if (!parts) return null
  return {
    exactVersion: version,
    logicalVersion: match[1],
    variant: match[2] ?? null,
    imageCode: null,
    parserId: 'numeric-dotted-v1',
    numericParts: parts,
  }
}

export function deriveFirmwareReleaseIdentity(input: {
  vendorKey?: string | null
  platform?: string | null
  version: string
}): FirmwareReleaseIdentity {
  const version = clean(input.version)
  return (
    parseArubaImageDotted(version) ??
    parseCiscoIosTrain(version) ??
    parseNumericDotted(version) ?? {
      exactVersion: version,
      logicalVersion: version,
      variant: null,
      imageCode: null,
      parserId: 'opaque-v1',
    }
  )
}

function notComparable(reason: string, comparatorId = 'unsupported-v1'): FirmwareVersionComparison {
  return { result: 'NOT_COMPARABLE', comparatorId, reason }
}

export function compareFirmwareVersions(input: {
  vendorKey: string
  platform: string
  leftVersion: string
  rightVersion: string
}): FirmwareVersionComparison {
  const leftExact = clean(input.leftVersion)
  const rightExact = clean(input.rightVersion)
  if (leftExact === rightExact) {
    return { result: 'EQUAL', comparatorId: 'exact-v1', reason: 'The exact vendor version strings are equal.' }
  }

  if (!normalizedDomain(input.vendorKey) || !normalizedDomain(input.platform)) {
    return notComparable('Vendor and platform are required to establish a safe firmware ordering domain.')
  }

  const left = deriveFirmwareReleaseIdentity({ vendorKey: input.vendorKey, platform: input.platform, version: leftExact })
  const right = deriveFirmwareReleaseIdentity({ vendorKey: input.vendorKey, platform: input.platform, version: rightExact })

  if (left.parserId !== right.parserId || left.parserId === 'opaque-v1') {
    return notComparable('The versions do not share a supported deterministic vendor-version grammar.')
  }

  if (left.parserId === 'cisco-ios-train-v1' && right.parserId === 'cisco-ios-train-v1') {
    const leftCisco = left as CiscoIdentity
    const rightCisco = right as CiscoIdentity
    if (leftCisco.train !== rightCisco.train) {
      return notComparable('Cisco IOS train letters differ, so ordering is not inferred.', 'cisco-ios-train-v1')
    }
    const order = compareNumbers(
      [leftCisco.major, leftCisco.minor, leftCisco.maintenance, leftCisco.build],
      [rightCisco.major, rightCisco.minor, rightCisco.maintenance, rightCisco.build],
    )
    if (order === 'EQUAL' && leftCisco.variant !== rightCisco.variant) {
      return notComparable('The Cisco base release is equal but rebuild suffixes differ; suffix ordering is not assumed.', 'cisco-ios-train-v1')
    }
    return { result: order, comparatorId: 'cisco-ios-train-v1', reason: 'Compared numeric components inside the same Cisco IOS train.' }
  }

  const leftDotted = left as NumericDottedIdentity
  const rightDotted = right as NumericDottedIdentity
  const order = compareNumbers(leftDotted.numericParts, rightDotted.numericParts)
  if (order === 'EQUAL' && leftDotted.variant !== rightDotted.variant) {
    return notComparable('The numeric base release is equal but variant suffixes differ; suffix ordering is not assumed.', left.parserId)
  }
  return {
    result: order,
    comparatorId: left.parserId,
    reason:
      left.parserId === 'aruba-image-dotted-v1'
        ? 'Compared the shared numeric release while treating the image code as an artifact identity, not an ordering component.'
        : 'Compared deterministic numeric dotted release components.',
  }
}
