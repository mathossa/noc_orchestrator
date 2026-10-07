import { auth } from '@/lib/auth'

export class AdminAccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message)
    this.name = 'AdminAccessError'
  }
}

export async function requireAdminRequest(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    throw new AdminAccessError('Authentication is required.', 401)
  }
  if (session.user.role !== 'admin') {
    throw new AdminAccessError('Administrator access is required.', 403)
  }
  return session
}
