import { ExceptionWorkspace } from '@/components/firmware/exception-workspace'
export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; scopeId?: string }>
}) {
  const params = await searchParams
  return (
    <ExceptionWorkspace
      initialScope={params.scope}
      initialScopeId={params.scopeId}
    />
  )
}
