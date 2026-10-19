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
