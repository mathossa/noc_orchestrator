import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettierConfig from 'eslint-config-prettier'

const firmwareWorkspaceFiles = [
  'src/components/devices/device-import-firmware-assist.tsx',
  'src/components/devices/device-import-firmware-reconciliation-workspace-v2.tsx',
  'src/components/devices/device-import-firmware-reconciliation-workspace.tsx',
]

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  {
    files: firmwareWorkspaceFiles,
    rules: {
      // These workspaces intentionally reset selection-local inspection state
      // before asynchronously loading raw source rows. The effect is keyed to
      // the selected proposal identity rather than the mutable draft object so
      // editing platform/version fields does not refetch the same evidence.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'src/generated/**', 'next-env.d.ts']),
])
