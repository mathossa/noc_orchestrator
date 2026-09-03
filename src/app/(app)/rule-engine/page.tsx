import { Suspense } from 'react'
import { RuleEngineWorkspace } from '@/components/devices/rule-engine-workspace'

export default function RuleEnginePage() {
  return <Suspense fallback={<div className="text-sm text-[var(--muted)]">Loading rule engine…</div>}><RuleEngineWorkspace /></Suspense>
}
