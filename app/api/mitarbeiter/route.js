import { NextResponse } from 'next/server';

// Nextcloud-Konfiguration aus Umgebungsvariablen
const NEXTCLOUD_URL = process.env.NEXTCLOUD_URL || 'https://cloud.wukaninchen.net';
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || '';
const NEXTCLOUD_PASS = process.env.NEXTCLOUD_PASS || '';
const DIENSTPLAN_PATH = process.env.DIENSTPLAN_PATH || '/03 Kinderbetreuung/Pädagogik/Dienstpläne/';

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
    return null; // Datei existiert noch nicht
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

// Initiale Mitarbeiterdaten mit zufälligen PINs
function getInitialStammdaten() {
  return {
    mitarbeiter: {
      'Alina': {
        name: 'Alina',
        bereich: 'Nest',
        pin: generatePin(),
        isMinor: false,
        role: 'mitarbeiter',
        standardStunden: 5.5,
        canTrackPrepTime: true,
        active: true
      },
      'Berit': {
        name: 'Berit',
        bereich: 'Nest',
        pin: generatePin(),
        isMinor: false,
        role: 'mitarbeiter',
        standardStunden: 6.5,
        canTrackPrepTime: true,
        active: true
      },
      'Catharina': {
        name: 'Catharina',
        bereich: 'Nest',
        pin: generatePin(),
        isMinor: false,
        role: 'leitung',
        standardStunden: 7.5,
        canTrackPrepTime: true,
        active: true
      },
      'Izabella': {
        name: 'Izabella',
        bereich: 'Nest',
        pin: generatePin(),
        isMinor: true,
        role: 'mitarbeiter',
        standardStunden: 5.83,
        canTrackPrepTime: false,
        active: true
      },
      'Olli': {
        name: 'Olli',
        bereich: 'Nest',
        pin: generatePin(),
        isMinor: false,
        role: 'mitarbeiter',
        standardStunden: 4,
        canTrackPrepTime: false,
        active: true
      },
      'Ilai': {
        name: 'Ilai',
        bereich: 'Ü3',
        pin: generatePin(),
        isMinor: false,
        role: 'mitarbeiter',
        standardStunden: 6.25,
        canTrackPrepTime: true,
        active: true
      },
      'Edu': {
        name: 'Edu',
        bereich: 'Ü3',
        pin: generatePin(),
        isMinor: false,
        role: 'mitarbeiter',
        standardStunden: 6,
        canTrackPrepTime: true,
        active: true
      },
      'Juli': {
        name: 'Juli',
        bereich: 'Ü3',
        pin: generatePin(),
        isMinor: false,
        role: 'mitarbeiter',
        standardStunden: 5.75,
        canTrackPrepTime: true,
        active: true
      },
      'Lucia': {
        name: 'Lucia',
        bereich: 'Ü3',
        pin: generatePin(),
        isMinor: true,
        role: 'mitarbeiter',
        standardStunden: 6.5,
        canTrackPrepTime: false,
        active: true
      },
      'Myriam': {
        name: 'Myriam',
        bereich: 'Ü3',
        pin: generatePin(),
        isMinor: false,
        role: 'mitarbeiter',
        standardStunden: 6,
        canTrackPrepTime: true,
        active: true
      }
    },
    lastUpdated: new Date().toISOString(),
    initialized: true
  };
}

// Demo-Daten für Tests ohne Nextcloud-Verbindung
function getDemoStammdaten() {
  return {
    mitarbeiter: {
      'Alina': { name: 'Alina', bereich: 'Nest', pin: '1111', isMinor: false, role: 'mitarbeiter', standardStunden: 5.5, canTrackPrepTime: true, active: true },
      'Berit': { name: 'Berit', bereich: 'Nest', pin: '2222', isMinor: false, role: 'mitarbeiter', standardStunden: 6.5, canTrackPrepTime: true, active: true },
      'Catharina': { name: 'Catharina', bereich: 'Nest', pin: '0000', isMinor: false, role: 'leitung', standardStunden: 7.5, canTrackPrepTime: true, active: true },
      'Izabella': { name: 'Izabella', bereich: 'Nest', pin: '3333', isMinor: true, role: 'mitarbeiter', standardStunden: 5.83, canTrackPrepTime: false, active: true },
      'Olli': { name: 'Olli', bereich: 'Nest', pin: '4444', isMinor: false, role: 'mitarbeiter', standardStunden: 4, canTrackPrepTime: false, active: true },
      'Ilai': { name: 'Ilai', bereich: 'Ü3', pin: '5555', isMinor: false, role: 'mitarbeiter', standardStunden: 6.25, canTrackPrepTime: true, active: true },
      'Edu': { name: 'Edu', bereich: 'Ü3', pin: '6666', isMinor: false, role: 'mitarbeiter', standardStunden: 6, canTrackPrepTime: true, active: true },
      'Juli': { name: 'Juli', bereich: 'Ü3', pin: '7777', isMinor: false, role: 'mitarbeiter', standardStunden: 5.75, canTrackPrepTime: true, active: true },
      'Lucia': { name: 'Lucia', bereich: 'Ü3', pin: '8888', isMinor: true, role: 'mitarbeiter', standardStunden: 6.5, canTrackPrepTime: false, active: true },
      'Myriam': { name: 'Myriam', bereich: 'Ü3', pin: '9999', isMinor: false, role: 'mitarbeiter', standardStunden: 6, canTrackPrepTime: true, active: true }
    },
    lastUpdated: new Date().toISOString(),
    demo: true
  };
}

// GET: Lade Mitarbeiter-Stammdaten
export async function GET(request) {
  try {
    // Prüfe ob Nextcloud konfiguriert ist
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return NextResponse.json(getDemoStammdaten());
    }

    // Versuche Stammdaten von Nextcloud zu laden
    let stammdaten = await fetchFromNextcloud(STAMMDATEN_FILENAME);

    // Falls Datei nicht existiert, erstelle initiale Daten
    if (!stammdaten) {
      stammdaten = getInitialStammdaten();
      await saveToNextcloud(STAMMDATEN_FILENAME, stammdaten);
      // Markiere als neu erstellt für die Anzeige der initialen PINs
      stammdaten.newlyCreated = true;
    }

    return NextResponse.json(stammdaten);

  } catch (error) {
    console.error('Fehler beim Laden der Stammdaten:', error);
    return NextResponse.json(getDemoStammdaten());
  }
}

// POST: Neuen Mitarbeiter hinzufügen
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, bereich, isMinor, canTrackPrepTime, standardStunden } = body;

    if (!name || !bereich) {
      return NextResponse.json({ error: 'Name und Bereich erforderlich' }, { status: 400 });
    }

    // Prüfe ob Nextcloud konfiguriert ist
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return NextResponse.json({ error: 'Nextcloud nicht konfiguriert' }, { status: 500 });
    }

    // Lade aktuelle Daten
    let stammdaten = await fetchFromNextcloud(STAMMDATEN_FILENAME);
    if (!stammdaten) {
      stammdaten = getInitialStammdaten();
    }

    // Prüfe ob Name bereits existiert
    if (stammdaten.mitarbeiter[name]) {
      return NextResponse.json({ error: 'Mitarbeiter existiert bereits' }, { status: 400 });
    }

    // Generiere neue PIN
    const newPin = generatePin();

    // Füge neuen Mitarbeiter hinzu
    stammdaten.mitarbeiter[name] = {
      name,
      bereich,
      pin: newPin,
      isMinor: isMinor || false,
      role: 'mitarbeiter',
      standardStunden: standardStunden || 6,
      canTrackPrepTime: canTrackPrepTime !== false,
      active: true
    };
    stammdaten.lastUpdated = new Date().toISOString();

    // Speichere auf Nextcloud
    await saveToNextcloud(STAMMDATEN_FILENAME, stammdaten);

    return NextResponse.json({
      success: true,
      pin: newPin,
      message: `Mitarbeiter ${name} hinzugefügt. PIN: ${newPin}`
    });

  } catch (error) {
    console.error('Fehler beim Hinzufügen:', error);
    return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 });
  }
}

// PUT: Mitarbeiter aktualisieren
export async function PUT(request) {
  try {
    const body = await request.json();
    const { name, updates } = body;

    if (!name || !updates) {
      return NextResponse.json({ error: 'Name und Updates erforderlich' }, { status: 400 });
    }

    // Prüfe ob Nextcloud konfiguriert ist
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return NextResponse.json({ error: 'Nextcloud nicht konfiguriert' }, { status: 500 });
    }

    // Lade aktuelle Daten
    let stammdaten = await fetchFromNextcloud(STAMMDATEN_FILENAME);
    if (!stammdaten || !stammdaten.mitarbeiter[name]) {
      return NextResponse.json({ error: 'Mitarbeiter nicht gefunden' }, { status: 404 });
    }

    // Aktualisiere erlaubte Felder
    const allowedFields = ['bereich', 'pin', 'isMinor', 'standardStunden', 'canTrackPrepTime', 'active'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        stammdaten.mitarbeiter[name][field] = updates[field];
      }
    }
    stammdaten.lastUpdated = new Date().toISOString();

    // Speichere auf Nextcloud
    await saveToNextcloud(STAMMDATEN_FILENAME, stammdaten);

    return NextResponse.json({ success: true, message: `Mitarbeiter ${name} aktualisiert` });

  } catch (error) {
    console.error('Fehler beim Aktualisieren:', error);
    return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 });
  }
}

// DELETE: Mitarbeiter deaktivieren (soft delete)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    if (!name) {
      return NextResponse.json({ error: 'Name erforderlich' }, { status: 400 });
    }

    // Prüfe ob Nextcloud konfiguriert ist
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      return NextResponse.json({ error: 'Nextcloud nicht konfiguriert' }, { status: 500 });
    }

    // Lade aktuelle Daten
    let stammdaten = await fetchFromNextcloud(STAMMDATEN_FILENAME);
    if (!stammdaten || !stammdaten.mitarbeiter[name]) {
      return NextResponse.json({ error: 'Mitarbeiter nicht gefunden' }, { status: 404 });
    }

    // Verhindere Löschen des letzten Leitung-Users
    const leitungUsers = Object.values(stammdaten.mitarbeiter).filter(m => m.role === 'leitung' && m.active);
    if (stammdaten.mitarbeiter[name].role === 'leitung' && leitungUsers.length <= 1) {
      return NextResponse.json({ error: 'Kann letzten Admin nicht löschen' }, { status: 400 });
    }

    // Soft delete: Setze active auf false
    stammdaten.mitarbeiter[name].active = false;
    stammdaten.lastUpdated = new Date().toISOString();

    // Speichere auf Nextcloud
    await saveToNextcloud(STAMMDATEN_FILENAME, stammdaten);

    return NextResponse.json({ success: true, message: `Mitarbeiter ${name} deaktiviert` });

  } catch (error) {
    console.error('Fehler beim Löschen:', error);
    return NextResponse.json({ error: 'Löschen fehlgeschlagen' }, { status: 500 });
  }
}
