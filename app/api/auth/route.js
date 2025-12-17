import { NextResponse } from 'next/server';

// POST: Validate PIN
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, pin, userPin } = body;

    if (!name || !pin) {
      return NextResponse.json({ valid: false, error: 'Name und PIN erforderlich' }, { status: 400 });
    }

    // Check if PIN matches user's PIN
    if (pin === userPin) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false });

  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ valid: false, error: 'Authentifizierung fehlgeschlagen' }, { status: 500 });
  }
}
