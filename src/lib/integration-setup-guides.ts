/**
 * Operator-facing credential provisioning instructions for inventory integrations.
 * Content is intentionally static and contains no secret material.
 * Add future providers only when their connection flow is implemented.
 */
export const integrationSetupGuides = {
  auvik: {
    title: 'Auvik Network Management',
    subtitle: 'Device API v2 · API username and API key',
    reviewedOn: '8 October 2026',
    intro:
      'Create a dedicated Auvik service account rather than using an engineer\'s personal login. NOC Orchestrator only reads observed inventory and does not need administrative device changes.',
    requirements: [
      'An Auvik administrator able to invite a user and assign site/tenant permissions.',
      'A dedicated service-account email address and access to sign in as that user to generate its own key.',
      'The Auvik API region where the account is hosted (for example eu1), and access to the intended sites.',
    ],
    sections: [
      {
        title: '1. Create the API account',
        steps: [
          'In your Auvik MSP or multi-site dashboard, open Manage Users and invite a dedicated integration user. Complete its activation/sign-in flow.',
          'Authorize that user for the parent account and every tenant/site you intend to import, not unrelated customer locations.',
          'Assign the API Access Only role or a more restricted custom API role. For this adapter, the role needs permission to verify credentials, list tenants and read Device API v2 inventory (API – Tenants and API – Device info). Validate your customized role against those endpoints.',
          'API Access Only defaults include additional rights, including Access and Edit for the Tenants API; narrow the role through a custom role if your security policy requires read-only API permissions.',
        ],
      },
      {
        title: '2. Generate the key',
        steps: [
          'Sign in as the dedicated Auvik user. Open the username menu in the side navigation and go to the user profile.',
          'Select Generate API Key, copy the complete key when shown and store it securely. The full key is only displayed at generation time.',
          'In NOC Orchestrator select Add Auvik connection; enter the service user email in Auvik username, paste its API key, and enter the correct Region.',
        ],
      },
      {
        title: '3. Verify and select inventory scope',
        steps: [
          'Save the connection, open its details and choose Test connection. A new connection remains disabled until the test succeeds.',
          'If a different Auvik region is suggested, verify the region independently and update the configuration; do not share credentials with an untrusted host.',
          'Use Sync tenants & sites to discover available scopes. Enable only intended tenants, set customer/site mappings, then Save settings.',
          'Enable the connection and run Sync now. Review any ambiguous or unresolved inventory rows in Importer v2; do not bypass reconciliation.',
        ],
      },
    ],
    troubleshooting: [
      '401 / failed verification: confirm the Auvik username, its saved API key and whether the key has been regenerated or revoked.',
      '403 or missing tenants/devices: verify the API endpoint permissions and tenant/site authorizations, including the parent multi-site.',
      '308 / wrong region: check the selected region against the Auvik account region before retrying.',
      'After key rotation, update the saved integration credentials and rerun Test connection before enabling sync.',
    ],
    sources: [
      { label: 'Auvik – user profile and API key management', url: 'https://support.auvik.com/hc/en-us/articles/204309114-How-do-I-update-my-user-profile' },
      { label: 'Auvik – API Access Only role and service accounts', url: 'https://support.auvik.com/hc/en-us/articles/48529381648660-API-Access-Only-Role-and-Service-Account-Configuration-in-Auvik' },
      { label: 'Auvik – API integration guide and regional URLs', url: 'https://support.auvik.com/hc/en-us/articles/360031007111-Auvik-API-Integration-Guide' },
    ],
    addConnectionHref: '/settings/integrations/auvik/new',
  },
  meraki: {
    title: 'Cisco Meraki Dashboard',
    subtitle: 'Dashboard API v1 · administrator-scoped API key',
    reviewedOn: '8 October 2026',
    intro:
      'Meraki Dashboard API keys belong to a Dashboard administrator identity and inherit that identity\'s permissions. Prefer a dedicated integration administrator with read-only access to only the organizations and networks needed.',
    requirements: [
      'An organization administrator able to enable Dashboard API access and invite a dedicated administrator.',
      'A dedicated Meraki Dashboard login with read-only access to the organizations/networks you want to import.',
      'The correct Dashboard API environment (Global, Canada, China, India or FedRAMP).',
    ],
    sections: [
      {
        title: '1. Enable API access and create the account',
        steps: [
          'In Meraki Dashboard, ensure Dashboard API access is enabled for each target organization (Organization > Settings > Dashboard API access, where available).',
          'Invite a dedicated Dashboard administrator for the required organization(s) and grant read-only organization or appropriately scoped network access. Do not grant full admin only for this read-only inventory integration.',
          'Sign in as that dedicated administrator to manage its personal API keys. A different user cannot safely create a personal API key on behalf of this identity.',
        ],
      },
      {
        title: '2. Generate the API key',
        steps: [
          'In Dashboard, open Organization > API & Webhooks > API keys and access, and generate a new personal API key for the dedicated administrator.',
          'Copy the secret when it is displayed and store it securely. Meraki API keys inherit the administrator\'s accessible organizations and role permissions.',
          'In NOC Orchestrator open Add Meraki connection, choose the matching API environment and paste the key into Dashboard API key.',
        ],
      },
      {
        title: '3. Verify and select inventory scope',
        steps: [
          'Save, open the connection and click Test connection. If authentication succeeds, click Sync organizations & sites.',
          'Review discovered organizations and networks, enable only those you want to import, fill customer/site mappings, and click Save settings.',
          'Enable the connection and run Sync now. API sync only supplies observed inventory; preferred firmware and exceptions remain NOC-owned.',
        ],
      },
    ],
    troubleshooting: [
      '401 Unauthorized: regenerate/verify the key and API environment; the Dashboard v1 adapter authenticates with Authorization: Bearer, not a pasted username/password.',
      '403 Forbidden or missing organizations: verify the dedicated administrator has access to the requested organization and sufficient read permissions.',
      'Empty scopes: first confirm organization API access is enabled, then use Sync organizations & sites and explicitly enable intended networks.',
      'If the administrator is removed or the key is revoked, update the connection with a new key and retest; changes to privileges take effect for the key owner.',
    ],
    sources: [
      { label: 'Cisco Meraki – Dashboard API authorization and API-key creation', url: 'https://developer.cisco.com/meraki/api-v1/authorization/' },
      { label: 'Cisco Meraki – getting started and regional API endpoints', url: 'https://developer.cisco.com/meraki/api-v1/getting-started/' },
      { label: 'Cisco Meraki – enable Dashboard API access', url: 'https://developer.cisco.com/meraki/build/meraki-postman-collection-getting-started/getting-started/' },
    ],
    addConnectionHref: '/settings/integrations/meraki/new',
  },
} as const

export type IntegrationSetupProvider = keyof typeof integrationSetupGuides

export function isIntegrationSetupProvider(value: string): value is IntegrationSetupProvider {
  return Object.prototype.hasOwnProperty.call(integrationSetupGuides, value)
}
