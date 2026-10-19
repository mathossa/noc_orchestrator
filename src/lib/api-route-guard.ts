import { AdminAccessError, requireAdminRequest } from '@/lib/api-admin'

// A server-side, fail-closed authorization boundary for route handlers.
// Unlike Next's proxy this also applies when handlers are called internally.
export function withAdmin<T extends (...args: never[]) => Response | Promise<Response>>(handler: T): T {
  const protectedHandler = async (...args: Parameters<T>): Promise<Response> => {
    const request = args[0] as Request | undefined
    try {
      if (!request?.headers) {
        throw new AdminAccessError('Authentication is required.', 401)
      }
      await requireAdminRequest(request)
    } catch (error) {
      if (error instanceof AdminAccessError) {
        return Response.json(
          { error: { code: error.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: error.message } },
          { status: error.status, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      return Response.json(
        { error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const response = await handler(...args)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
  return protectedHandler as T
}
