export function GET() {
  return Response.json({
    status: 'ok',
    service: 'noc-orchestrator',
    version: '0.1.0',
  })
}
