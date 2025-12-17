import { NextResponse } from 'next/server';
import { Resend } from 'resend';

// Nextcloud-Konfiguration aus Umgebungsvariablen
const NEXTCLOUD_URL = process.env.NEXTCLOUD_URL || 'https://cloud.wukaninchen.net';
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || '';
const NEXTCLOUD_PASS = process.env.NEXTCLOUD_PASS || '';
const DIENSTPLAN_PATH = process.env.DIENSTPLAN_PATH || '/03 Kinderbetreuung/Pädagogik/Dienstpläne/';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const LEITUNG_EMAIL = 'catharina.rafoth@wukaninchen.net';
const STAMMDATEN_FILENAME = 'Mitarbeiter_Stammdaten.json';

// Generiere zufällige 4-stellige PIN
function generatePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Lade Datei von Nextcloud via WebDAV
async function fetchFromNextcloud(filename) {
  const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${DIENSTPLAN_PATH}${encodeURIComponent(filename)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASS}`).toString('base64'),
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Nextcloud error: ${response.status}`);
  }

  return await response.json();
}

// Speichere Datei auf Nextcloud via WebDAV
async function saveToNextcloud(filename, data) {
  const url = `${NEXTCLOUD_URL}/remote.php/dav/files/${NEXTCLOUD_USER}${DIENSTPLAN_PATH}${encodeURIComponent(filename)}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${NEXTCLOUD_USER}:${NEXTCLOUD_PASS}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data, null, 2),
  });

  if (!response.ok) {
    throw new Error(`Nextcloud save error: ${response.status}`);
  }

  return true;
}

// POST: PIN zurücksetzen und per E-Mail senden
export async function POST(request) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name erforderlich' }, { status: 400 });
    }

    // Prüfe ob Nextcloud konfiguriert ist
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return NextResponse.json({ error: 'Nextcloud nicht konfiguriert' }, { status: 500 });
    }

    // Lade aktuelle Stammdaten
    const stammdaten = await fetchFromNextcloud(STAMMDATEN_FILENAME);
    if (!stammdaten || !stammdaten.mitarbeiter[name]) {
      return NextResponse.json({ error: 'Mitarbeiter nicht gefunden' }, { status: 404 });
    }

    const mitarbeiter = stammdaten.mitarbeiter[name];

    // Nur für Leitung-Benutzer erlauben
    if (mitarbeiter.role !== 'leitung') {
      return NextResponse.json({ error: 'PIN-Reset nur für Leitung verfügbar' }, { status: 403 });
    }

    // Generiere neue PIN
    const newPin = generatePin();

    // Aktualisiere PIN in Stammdaten
    stammdaten.mitarbeiter[name].pin = newPin;
    stammdaten.lastUpdated = new Date().toISOString();

    // Speichere auf Nextcloud
    await saveToNextcloud(STAMMDATEN_FILENAME, stammdaten);

    // Sende E-Mail mit neuer PIN
    if (RESEND_API_KEY) {
      const resend = new Resend(RESEND_API_KEY);

      await resend.emails.send({
        from: 'Wukaninchen Stundenerfassung <noreply@resend.dev>',
        to: [LEITUNG_EMAIL],
        subject: 'Deine neue PIN für die Stundenerfassung',
        html: `
          <h2>Hallo ${name}!</h2>
          <p>Du hast eine neue PIN für die Wukaninchen Stundenerfassung angefordert.</p>
          <p style="font-size: 24px; font-weight: bold; background: #f0f0f0; padding: 20px; text-align: center; letter-spacing: 8px;">
            ${newPin}
          </p>
          <p>Bitte bewahre diese PIN sicher auf.</p>
          <p>Liebe Grüße,<br>Dein Wukaninchen-System</p>
        `,
      });

      return NextResponse.json({
        success: true,
        message: `Neue PIN wurde an ${LEITUNG_EMAIL} gesendet`
      });
    } else {
      // Wenn kein Resend-API-Key, gib PIN direkt zurück (nur für Entwicklung)
      console.warn('RESEND_API_KEY nicht konfiguriert - PIN wird direkt zurückgegeben');
      return NextResponse.json({
        success: true,
        pin: newPin,
        message: 'E-Mail-Versand nicht konfiguriert - PIN direkt zurückgegeben (nur Entwicklung)'
      });
    }

  } catch (error) {
    console.error('PIN-Reset Fehler:', error);
    return NextResponse.json({ error: 'PIN-Reset fehlgeschlagen' }, { status: 500 });
  }
}
