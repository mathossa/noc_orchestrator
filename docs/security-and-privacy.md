# Protecting customer data in public GitHub content

This repository is public. **Use synthetic fixtures only** in source code, GitHub issues,
PR descriptions, screenshots, comments, test output and documentation.

## Never publish

- Customer, partner, employee or site identities obtained from live environments
- Auvik/Aruba/Meraki tenant IDs, provider source IDs or customer-specific domain prefixes
- Actual hardware serials, MACs, asset tags, hostnames, management IPs or postcode/site codes
- Live config backups, tickets, spreadsheets, network diagrams or unredacted screenshots
- Tokens, passwords, cookies, API keys, private keys or connection strings with real secrets

## Safe reproduction examples

- Customer: `Northwind Logistics`; business unit: `Operations`; site: `Site Alpha`
- Device: `lab-stack-sw01`; serial: `SYNTH00001`; source ID: `synthetic-device-01`
- Documentation IP: `192.0.2.15`, `198.51.100.20`, `203.0.113.30` (RFC 5737)
- Example DNS name: `switch01.example.test`
- Example MAC: `02:00:00:00:00:01` (locally administered)

When reporting a production bug, rewrite the *entire* source/expected example
with made-up data. Keep the relevant hierarchy, separators, firmware version,
object type and error condition. Do not merely replace the customer name while
leaving their site code, tenant ID or device serial intact.

## Review checklist

1. Search the entire PR **including removed diff lines**, commit messages and attachments.
2. Review issue and PR body text, comments, screenshots, CI logs and upload artifacts.
3. Check for literals copied into tests, sample JSON, SQL seeds and diagnostic snapshots.
4. Run the secret scanner on the repository's complete local Git history.
5. Do not paste suspected secrets or unredacted hits into another public issue/PR.

The CI Gitleaks workflow catches common credential signatures. It **cannot
guarantee** discovery of customer names, actual site IDs or every secret;
human privacy review is still mandatory.

## If sensitive information was published

- Revoke and rotate any potentially exposed credentials **immediately**.
- Restrict access to exposed customer data and follow your organization's
  security/privacy incident process.
- Replace identifiable material in **current** editable notes and source files.
- GitHub edit history, prior commits, old PR diffs, forks, clones, notifications
  and caches can remain accessible. Do **not** assume a replacement commit
  removed them.
- For repository history remediation, coordinate an agreed cutover with all
  collaborators: take protected backups, identify affected refs/forks,
  prepare `git filter-repo` or GitHub's sensitive-data-removal process,
  review rewritten refs, force-update only during the agreed freeze,
  re-clone dependent worktrees, and ask GitHub Support about retained PR
  references/caches as applicable.

Avoid publishing exact sensitive matches in remediation issue comments.

## Production authentication and credential encryption

- Every business API operation requires a valid Better Auth session with
  `user.role === 'admin'`; customer data and mutations must never rely solely
  on the Next.js proxy. Public paths are limited to the health check, Better Auth
  and the sign-in UI. Microsoft Entra ID remains optional when all three
  Microsoft provider environment variables are configured.
- Provision administrator identities deliberately; do not allow public sign-up.
  Run `npm run auth:create-admin` in an authorized administration environment.
  Enforce HTTPS, strong admin credentials and a restricted deployment network.
- Generate independent production secrets, for example
  `openssl rand -base64 48` for `BETTER_AUTH_SECRET` and
  `openssl rand -base64 32` for `INVENTORY_SOURCE_SECRET_KEY`.
  The inventory key must decode to **exactly 32 bytes** and be canonical base64.
  Never commit values to source control, CI logs, screenshots or issue comments.
- Supply both secrets to the application process. Supply the *same* inventory
  encryption key to every app replica and background worker. The production
  Compose file requires this value for both services and their container
  entrypoints reject invalid values before starting.
- Back up the inventory encryption key securely and separately from the DB,
  using access-controlled secret storage with recoverable historical versions.
  **Losing the key makes existing saved integration credentials unreadable.**
  The key is not a password that can simply be reset. Restore tests must verify
  access to encrypted credentials without exposing them.
- Rotation of `INVENTORY_SOURCE_SECRET_KEY` requires a coordinated decrypt/
  re-encrypt migration of saved credentials while the previous key is still
  available, with a verified rollback and backups. Do not simply replace it
  with a new key; automated re-encryption tooling is not implemented yet.
- Treat any suspected disclosure of a credential, session secret or encryption
  key as a security incident. Rotate affected upstream API credentials and
  invalidate sessions as needed. The repository's historical privacy review
  remains tracked in issue #147.
