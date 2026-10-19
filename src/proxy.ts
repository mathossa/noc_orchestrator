import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

// Authentication is defense in depth. Each business API handler also has an
// administrator authorization check and server-rendered pages check in layout.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Deliberate public exceptions: liveness, the sign-in screen and Better Auth.
  // Do not turn all of /api into a public exception.
  if (
    pathname === '/api/v1/health' ||
    pathname === '/sign-in' ||
    pathname === '/api/auth' ||
    pathname.startsWith('/api/auth/')
  ) {
    return NextResponse.next()
  }

  let session: Awaited<ReturnType<typeof auth.api.getSession>>
  try {
    session = await auth.api.getSession({ headers: request.headers })
  } catch {
    // Database/auth provider failures must never permit anonymous access.
    return NextResponse.json(
      { error: { code: 'AUTH_UNAVAILABLE', message: 'Authentication is temporarily unavailable.' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (!session || session.user.role !== 'admin') {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const unauthorized = !session
      return NextResponse.json(
        { error: {
          code: unauthorized ? 'UNAUTHORIZED' : 'FORBIDDEN',
          message: unauthorized ? 'Authentication is required.' : 'Administrator access is required.',
        } },
        { status: unauthorized ? 401 : 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const signInUrl = new URL('/sign-in', request.url)
    if (session) {
      signInUrl.searchParams.set('error', 'forbidden')
    } else {
      // Only return a same-origin relative destination (never a user-supplied URL).
      signInUrl.searchParams.set('next', pathname + request.nextUrl.search)
    }
    return NextResponse.redirect(signInUrl, { headers: { 'Cache-Control': 'no-store' } })
  }

  const response = NextResponse.next()
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  // Match dotted/encoded app paths too. Only Next's known asset URLs and
  // static branding assets bypass proxy; never exclude arbitrary dot paths.
  matcher: ['/((?!_next/static|_next/image|_next/webpack-hmr|brand/|favicon.ico).*)'],
}
