// Validate security-critical production configuration before starting a server
// or background worker. Never print secrets, hashes, or raw invalid values.
const encoded = process.env.INVENTORY_SOURCE_SECRET_KEY ?? ''
const key = Buffer.from(encoded, 'base64')
if (key.length !== 32 || key.toString('base64') !== encoded) {
  console.error('Invalid INVENTORY_SOURCE_SECRET_KEY: expected canonical base64 for 32 bytes.')
  process.exit(1)
}
if (process.argv[2] === 'app') {
  const secret = process.env.BETTER_AUTH_SECRET ?? ''
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    console.error('BETTER_AUTH_SECRET must contain at least 32 bytes.')
    process.exit(1)
  }
  const baseURL = process.env.BETTER_AUTH_URL ?? ''
  if (!baseURL.startsWith('https://')) {
    console.error('BETTER_AUTH_URL must be an HTTPS origin in production.')
    process.exit(1)
  }
}
