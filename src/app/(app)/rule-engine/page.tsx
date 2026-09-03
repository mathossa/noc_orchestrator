import { Suspense } from 'react'
import { RuleEngineWorkspaceV2 } from '@/components/devices/rule-engine-workspace-v2'

export default function RuleEnginePage() {
  return <Suspense fallback={<div className="text-sm text-[var(--muted)]">Loading rule engine…</div>}><RuleEngineWorkspaceV2 /></Suspense>
}
