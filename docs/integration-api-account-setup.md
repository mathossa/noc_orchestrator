# Integration API account setup guides

Issue: [#130](https://github.com/mathossa/noc_orchestrator/issues/130)

Engineers can open provider-specific API credential provisioning instructions from
the `?` on the **Integrations** overview, **Add connection**, or a saved
connection detail page. The help is rendered inside the application at:

- `/settings/integrations/help/auvik`
- `/settings/integrations/help/meraki`

The guides cover how to provision a vendor-side service account and obtain
credentials. They are not firmware release notes (see separate #103) and do not
store or display actual secrets.

## Editing and adding a guide

1. Verify the provider's **official** authentication, user-role and API endpoint
   documentation. Prefer a read-only or minimal-permission account; do not assume
   a product's different portal/API generations have the same credential model.
2. Add a typed guide to `src/lib/integration-setup-guides.ts`; put checked
   official links and a review date in its `sources` / `reviewedOn` fields.
   The content is the single source for the in-app help screen.
3. Add `<IntegrationSetupHelpLink provider="..."/>` in its new-connection,
   saved-connection and Integrations overview views. This builds a labelled
   keyboard-operable `?` link to the guide without new dependencies.
4. Add Playwright smoke coverage for the help entry points and essential steps.
5. Update these instructions when the vendor changes its UI, required roles,
   API authentication or credential-rotation procedure.

Auvik's current adapter uses an API username and API key (Basic over HTTPS).
The account needs access to target tenant(s), tenant discovery and Device API v2.
Meraki's current adapter uses a Dashboard admin-scoped API key (Bearer).
That key inherits its administrator's organization/network permissions.
Both integrations are **observed-inventory only**.

### Pending Aruba integration (#116 / PR #128)

Wait for the active Aruba implementation to settle before wiring its help entry
points. Create **distinct** guides for:
- **Classic Central:** application/client credentials, OAuth refresh tokens and
  regional API Gateway; storage/rotation steps must match the merged adapter.
- **New Central:** HPE GreenLake / New Central OAuth application, access/scopes
  and its separate endpoints.

Do not edit Aruba's in-flight branch from this issue or quietly reuse Classic
steps for New Central. Confirm the merged settings forms first.

## Security

- Never paste real API keys, passwords, client secrets, access/refresh tokens, or
  tenant-specific sensitive details into guide text, screenshots, tests or links.
- Authentication material is entered in the existing connection form and kept
  by the server's encrypted secret store; help pages are static, read-only text.
- Recommend a dedicated service identity, least privilege, access scoped to
  intended customers/sites, and rotation with a retest.
- The guide UI does not change sync permissions, importer behavior, or domain state.
