# OSS reuse map

Use this as the default starting point for future implementation issues. The project-specific domain logic stays in NOC Orchestrator; generic infrastructure should be reused where practical.

| Area | Preferred OSS / source | Direction |
|---|---|---|
| Real PostgreSQL integration tests | Testcontainers | Reuse directly |
| Browser/E2E tests | Playwright | Reuse directly |
| PDF report rendering | Playwright | Render existing HTML/print views |
| Durable background jobs | pg-boss | Prefer before adding Redis/RabbitMQ/Temporal |
| Large tables/virtualization | TanStack Table/Virtual | Adopt incrementally where current UI needs it |
| Fuzzy importer suggestions | Fuse.js | Candidate ranking only; never auto-approve |
| Generic rule expressions | JSON Logic/json-rules-engine | Use only for narrow expression execution; keep NOC rule scope/evidence/precedence custom |
| Upgrade dependency/path graph | Graphlib or equivalent | Reuse graph algorithms; keep vendor constraints as NOC data |
| Vendor API clients | Official SDK first; OpenAPI-generated client second | Avoid handcrafted REST clients |
| Cisco/network SSH | Scrapli | Reuse transport/session handling |
| CLI parsing | NTC Templates/TextFSM | Reuse known command parsers where suitable |
| Cross-vendor facts | NAPALM | Optional where its abstraction fits |
| Agent PKI | step-ca | Preferred candidate for machine identity/enrollment |
| Secrets backend | OpenBao behind provider abstraction | Do not build a vault |
| Firmware artifact transport/cache | OCI/ORAS | Evaluate before custom binary repository |
| Lifecycle/reference concepts | Nautobot Device Lifecycle Management | Reference/integration source, not replacement for NOC domain |

Do not introduce an OSS dependency just because it exists. Verify maintenance, license, security, runtime fit, and actual reduction in custom code. If a preferred project is rejected, document why in the implementing PR.