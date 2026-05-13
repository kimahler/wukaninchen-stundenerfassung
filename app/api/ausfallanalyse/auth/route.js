import { NextResponse } from 'next/server';

export async function POST(request) {
  const { password } = await request.json();
  const expected = process.env.ANALYSE_PASSWORD;

  if (!expected) {
    return NextResponse.json({ error: 'ANALYSE_PASSWORD nicht konfiguriert' }, { status: 500 });
  }

  if (!password || password !== expected) {
    return NextResponse.json({ error: 'Falsches Passwort' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('analyse_auth', expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete('analyse_auth');
  return response;
}
