import { NextResponse } from 'next/server';

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Login-Seite und Auth-API immer durchlassen
  if (
    pathname === '/ausfallanalyse/login' ||
    pathname.startsWith('/api/ausfallanalyse/auth')
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/ausfallanalyse')) {
    const expected = process.env.ANALYSE_PASSWORD;
    const cookie   = request.cookies.get('analyse_auth');

    if (!expected || !cookie || cookie.value !== expected) {
      return NextResponse.redirect(new URL('/ausfallanalyse/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/ausfallanalyse/:path*'],
};
