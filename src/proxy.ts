import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

// Protect all application pages and /api/v1 endpoints from anonymous access.
// Every protected endpoint is admin-only until an explicit RBAC policy exists.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Liveness probe must work without the database or an authenticated cookie.
  if (pathname === '/api/v1/health') {
    return NextResponse.next()
  }

  const session = await auth.api.getSession({ headers: request.headers })

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const signInUrl = new URL('/sign-in', request.url)
    return NextResponse.redirect(signInUrl)
  }

  if (session.user.role !== 'admin') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.redirect(new URL('/sign-in?error=forbidden', request.url))
  }

  const response = NextResponse.next()
  // The content includes operational and cross-customer network inventory.
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: [
    '/api/v1/:path*',
    '/((?!api/|_next/|sign-in|brand/|favicon.ico|.*\\..*).*)',
  ],
}
