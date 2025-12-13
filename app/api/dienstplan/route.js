import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// Nextcloud-Konfiguration aus Umgebungsvariablen
const NEXTCLOUD_URL = process.env.NEXTCLOUD_URL || 'https://cloud.wukaninchen.net';
const NEXTCLOUD_USER = process.env.NEXTCLOUD_USER || '';
const NEXTCLOUD_PASS = process.env.NEXTCLOUD_PASS || '';
const DIENSTPLAN_PATH = process.env.DIENSTPLAN_PATH || '/03 Kinderbetreuung/Pädagogik/Dienstpläne/';

// Ermittle aktuellen Monat für Dateiname
function getCurrentDienstplanFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `Dienstplan ${year}_${month}.ods`;
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

  if (!response.ok) {
    throw new Error(`Nextcloud error: ${response.status}`);
  }

  return await response.arrayBuffer();
}

// Parse ODS/XLSX Datei und extrahiere Dienstplan-Daten
function parseDienstplan(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  
  const mitarbeiterMap = {};
  const wochen = [];
  
  // Bekannte Mitarbeiter (wird aus den Sheets extrahiert)
  const bekannteNamen = ['Ilai', 'Edu', 'Juli', 'Lucia', 'Myriam', 'Alina', 'Berit', 'Catharina', 'Izabella', 'Olli'];
  
  // Verarbeite jedes Sheet (jede Woche)
  workbook.SheetNames.forEach((sheetName, sheetIdx) => {
    if (!sheetName.startsWith('KW')) return; // Nur KW-Sheets
    
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    // Finde Datumsbereich aus erster Zeile
    const headerRow = data[0] || [];
    const datumMatch = String(headerRow[0] || '').match(/(\d{2}\.\d{2}\.?\s*[-–]\s*\d{2}\.\d{2}\.?\d{0,4})/);
    const zeitraum = datumMatch ? datumMatch[1] : sheetName;
    
    const woche = {
      name: sheetName,
      zeitraum: zeitraum,
      tage: {}
    };
    
    // Suche nach Mitarbeiter-Zeilen
    data.forEach((row, rowIdx) => {
      const name = String(row[0] || '').trim();
      
      if (bekannteNamen.includes(name)) {
        // Extrahiere Tage für diesen Mitarbeiter
        // Typische Struktur: Name, Mo-Von, Mo-Bis, Mo-Std, [leer], Di-Von, Di-Bis, Di-Std, ...
        const tage = [];
        const wochentage = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
        
        // Finde die Spalten für jeden Tag
        // Spalte 1-3: Mo (von, bis, std)
        // Spalte 5-7: Di (von, bis, std)
        // usw.
        const tagSpalten = [1, 5, 9, 13, 17]; // Angenommene Positionen
        
        wochentage.forEach((tagName, tagIdx) => {
          const colStart = tagSpalten[tagIdx];
          if (colStart === undefined || colStart >= row.length) {
            tage.push({ tag: tagName, datum: '', von: null, bis: null, sollStd: 0 });
            return;
          }
          
          const vonRaw = row[colStart];
          const bisRaw = row[colStart + 1];
          const stdRaw = row[colStart + 2];
          
          // Prüfe auf Abwesenheitskürzel
          const vonStr = String(vonRaw || '').trim().toUpperCase();
          if (['K', 'U', 'KS', 'KK', 'S', 'F'].includes(vonStr)) {
            tage.push({
              tag: tagName,
              datum: '',
              von: null,
              bis: null,
              sollStd: 0,
              status: vonStr
            });
            return;
          }
          
          // Parse Uhrzeiten
          let von = null;
          let bis = null;
          let sollStd = 0;
          
          if (vonRaw) {
            // Konvertiere Excel-Zeit zu String
            if (typeof vonRaw === 'number') {
              const hours = Math.floor(vonRaw * 24);
              const mins = Math.round((vonRaw * 24 - hours) * 60);
              von = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
            } else {
              von = String(vonRaw).replace(/:\d{2}$/, ''); // Entferne Sekunden
            }
          }
          
          if (bisRaw) {
            if (typeof bisRaw === 'number') {
              const hours = Math.floor(bisRaw * 24);
              const mins = Math.round((bisRaw * 24 - hours) * 60);
              bis = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
            } else {
              bis = String(bisRaw).replace(/:\d{2}$/, '');
            }
          }
          
          if (stdRaw) {
            sollStd = typeof stdRaw === 'number' ? stdRaw : parseFloat(String(stdRaw).replace(',', '.')) || 0;
          }
          
          tage.push({ tag: tagName, datum: '', von, bis, sollStd });
        });
        
        // Bestimme Bereich
        let bereich = 'Unbekannt';
        // Suche rückwärts nach "Ü3" oder "Nest"
        for (let i = rowIdx - 1; i >= 0; i--) {
          const marker = String(data[i]?.[0] || '').trim();
          if (marker === 'Ü3') { bereich = 'Ü3'; break; }
          if (marker === 'Nest') { bereich = 'Nest'; break; }
        }
        
        woche.tage[name] = tage;
        
        if (!mitarbeiterMap[name]) {
          mitarbeiterMap[name] = { name, bereich };
        }
      }
    });
    
    wochen.push(woche);
  });
  
  // Konvertiere Map zu Array
  const mitarbeiter = Object.values(mitarbeiterMap);
  
  // Ermittle Monat/Jahr aus erstem Sheet
  const firstSheet = workbook.SheetNames[0] || '';
  const now = new Date();
  
  return {
    monat: now.toLocaleString('de-DE', { month: 'long' }),
    jahr: now.getFullYear(),
    mitarbeiter,
    wochen
  };
}

export async function GET() {
  try {
    // Prüfe ob Konfiguration vorhanden
    if (!NEXTCLOUD_USER || !NEXTCLOUD_PASS) {
      // Fallback: Demo-Daten zurückgeben
      return NextResponse.json(getDemoData());
    }
    
    const filename = getCurrentDienstplanFilename();
    const buffer = await fetchFromNextcloud(filename);
    const dienstplan = parseDienstplan(buffer);
    
    return NextResponse.json(dienstplan);
    
  } catch (error) {
    console.error('Fehler beim Laden des Dienstplans:', error);
    
    // Bei Fehler: Demo-Daten zurückgeben
    return NextResponse.json(getDemoData());
  }
}

// Demo-Daten für Tests ohne Nextcloud-Verbindung
function getDemoData() {
  return {
    monat: 'Dezember',
    jahr: 2025,
    mitarbeiter: [
      { name: 'Alina', bereich: 'Nest' },
      { name: 'Berit', bereich: 'Nest' },
      { name: 'Catharina', bereich: 'Nest' },
      { name: 'Izabella', bereich: 'Nest' },
      { name: 'Olli', bereich: 'Nest' },
      { name: 'Ilai', bereich: 'Ü3' },
      { name: 'Juli', bereich: 'Ü3' },
      { name: 'Lucia', bereich: 'Ü3' },
      { name: 'Myriam', bereich: 'Ü3' },
    ],
    wochen: [
      {
        name: 'KW 50',
        zeitraum: '09.12. - 13.12.2025',
        tage: {
          'Alina': [
            { tag: 'Mo', datum: '09.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Di', datum: '10.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Mi', datum: '11.12.', von: null, bis: null, sollStd: 0 },
            { tag: 'Do', datum: '12.12.', von: '11:00', bis: '16:00', sollStd: 5 },
            { tag: 'Fr', datum: '13.12.', von: '09:00', bis: '14:45', sollStd: 5.75 },
          ],
          'Berit': [
            { tag: 'Mo', datum: '09.12.', von: '08:30', bis: '15:30', sollStd: 7 },
            { tag: 'Di', datum: '10.12.', von: '09:00', bis: '12:00', sollStd: 3 },
            { tag: 'Mi', datum: '11.12.', von: '08:30', bis: '15:00', sollStd: 6.5 },
            { tag: 'Do', datum: '12.12.', von: null, bis: null, sollStd: 0 },
            { tag: 'Fr', datum: '13.12.', von: '08:30', bis: '14:30', sollStd: 6 },
          ],
          'Catharina': [
            { tag: 'Mo', datum: '09.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Di', datum: '10.12.', von: '08:30', bis: '16:00', sollStd: 7.5 },
            { tag: 'Mi', datum: '11.12.', von: '09:00', bis: '14:30', sollStd: 5.5 },
            { tag: 'Do', datum: '12.12.', von: '08:30', bis: '15:00', sollStd: 6.5 },
            { tag: 'Fr', datum: '13.12.', von: null, bis: null, sollStd: 0 },
          ],
          'Izabella': [
            { tag: 'Mo', datum: '09.12.', von: '08:20', bis: '14:10', sollStd: 5.83 },
            { tag: 'Di', datum: '10.12.', von: '08:20', bis: '16:00', sollStd: 7.67 },
            { tag: 'Mi', datum: '11.12.', von: '08:20', bis: '14:10', sollStd: 5.83 },
            { tag: 'Do', datum: '12.12.', von: '08:20', bis: '16:00', sollStd: 7.67 },
            { tag: 'Fr', datum: '13.12.', von: '08:20', bis: '14:10', sollStd: 5.83 },
          ],
          'Olli': [
            { tag: 'Mo', datum: '09.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Di', datum: '10.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Mi', datum: '11.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Do', datum: '12.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Fr', datum: '13.12.', von: null, bis: null, sollStd: 0, status: 'K' },
          ],
          'Ilai': [
            { tag: 'Mo', datum: '09.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Di', datum: '10.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Mi', datum: '11.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Do', datum: '12.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Fr', datum: '13.12.', von: null, bis: null, sollStd: 0, status: 'K' },
          ],
          'Juli': [
            { tag: 'Mo', datum: '09.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Di', datum: '10.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Mi', datum: '11.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Do', datum: '12.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Fr', datum: '13.12.', von: null, bis: null, sollStd: 0, status: 'K' },
          ],
          'Lucia': [
            { tag: 'Mo', datum: '09.12.', von: '09:00', bis: '15:30', sollStd: 6.5 },
            { tag: 'Di', datum: '10.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
            { tag: 'Mi', datum: '11.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
            { tag: 'Do', datum: '12.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
            { tag: 'Fr', datum: '13.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
          ],
          'Myriam': [
            { tag: 'Mo', datum: '09.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Di', datum: '10.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Mi', datum: '11.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Do', datum: '12.12.', von: null, bis: null, sollStd: 0, status: 'K' },
            { tag: 'Fr', datum: '13.12.', von: null, bis: null, sollStd: 0, status: 'K' },
          ],
        }
      },
      {
        name: 'KW 51',
        zeitraum: '15.12. - 19.12.2025',
        tage: {
          'Alina': [
            { tag: 'Mo', datum: '15.12.', von: '09:00', bis: '14:30', sollStd: 5.5 },
            { tag: 'Di', datum: '16.12.', von: '09:00', bis: '14:30', sollStd: 5.5 },
            { tag: 'Mi', datum: '17.12.', von: '09:00', bis: '14:30', sollStd: 5.5 },
            { tag: 'Do', datum: '18.12.', von: '09:00', bis: '15:00', sollStd: 6 },
            { tag: 'Fr', datum: '19.12.', von: null, bis: null, sollStd: 0 },
          ],
          'Berit': [
            { tag: 'Mo', datum: '15.12.', von: '08:30', bis: '15:30', sollStd: 7 },
            { tag: 'Di', datum: '16.12.', von: null, bis: null, sollStd: 0 },
            { tag: 'Mi', datum: '17.12.', von: '08:30', bis: '15:00', sollStd: 6.5 },
            { tag: 'Do', datum: '18.12.', von: null, bis: null, sollStd: 0 },
            { tag: 'Fr', datum: '19.12.', von: '08:30', bis: '14:30', sollStd: 6 },
          ],
          'Catharina': [
            { tag: 'Mo', datum: '15.12.', von: null, bis: null, sollStd: 0 },
            { tag: 'Di', datum: '16.12.', von: '08:30', bis: '16:00', sollStd: 7.5 },
            { tag: 'Mi', datum: '17.12.', von: null, bis: null, sollStd: 0 },
            { tag: 'Do', datum: '18.12.', von: '08:30', bis: '11:30', sollStd: 3 },
            { tag: 'Fr', datum: '19.12.', von: '09:00', bis: '15:00', sollStd: 6 },
          ],
          'Izabella': [
            { tag: 'Mo', datum: '15.12.', von: '08:20', bis: '14:10', sollStd: 5.83 },
            { tag: 'Di', datum: '16.12.', von: '08:20', bis: '16:00', sollStd: 7.67 },
            { tag: 'Mi', datum: '17.12.', von: '08:20', bis: '14:10', sollStd: 5.83 },
            { tag: 'Do', datum: '18.12.', von: '08:20', bis: '16:00', sollStd: 7.67 },
            { tag: 'Fr', datum: '19.12.', von: '08:20', bis: '14:10', sollStd: 5.83 },
          ],
          'Olli': [
            { tag: 'Mo', datum: '15.12.', von: '09:30', bis: '13:30', sollStd: 4 },
            { tag: 'Di', datum: '16.12.', von: '09:30', bis: '13:30', sollStd: 4 },
            { tag: 'Mi', datum: '17.12.', von: '09:30', bis: '13:30', sollStd: 4 },
            { tag: 'Do', datum: '18.12.', von: '09:30', bis: '13:30', sollStd: 4 },
            { tag: 'Fr', datum: '19.12.', von: '09:30', bis: '13:30', sollStd: 4 },
          ],
          'Ilai': [
            { tag: 'Mo', datum: '15.12.', von: '08:30', bis: '14:45', sollStd: 6.25 },
            { tag: 'Di', datum: '16.12.', von: '08:30', bis: '14:45', sollStd: 6.25 },
            { tag: 'Mi', datum: '17.12.', von: '08:30', bis: '14:45', sollStd: 6.25 },
            { tag: 'Do', datum: '18.12.', von: '08:30', bis: '16:00', sollStd: 7.5 },
            { tag: 'Fr', datum: '19.12.', von: null, bis: null, sollStd: 0 },
          ],
          'Juli': [
            { tag: 'Mo', datum: '15.12.', von: '09:00', bis: '14:45', sollStd: 5.75 },
            { tag: 'Di', datum: '16.12.', von: '09:00', bis: '14:45', sollStd: 5.75 },
            { tag: 'Mi', datum: '17.12.', von: '09:00', bis: '14:45', sollStd: 5.75 },
            { tag: 'Do', datum: '18.12.', von: null, bis: null, sollStd: 0 },
            { tag: 'Fr', datum: '19.12.', von: '08:30', bis: '15:00', sollStd: 6.5 },
          ],
          'Lucia': [
            { tag: 'Mo', datum: '15.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
            { tag: 'Di', datum: '16.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
            { tag: 'Mi', datum: '17.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
            { tag: 'Do', datum: '18.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
            { tag: 'Fr', datum: '19.12.', von: '08:15', bis: '14:45', sollStd: 6.5 },
          ],
          'Myriam': [
            { tag: 'Mo', datum: '15.12.', von: '09:30', bis: '15:30', sollStd: 6 },
            { tag: 'Di', datum: '16.12.', von: '08:30', bis: '14:30', sollStd: 6 },
            { tag: 'Mi', datum: '17.12.', von: '08:30', bis: '14:30', sollStd: 6 },
            { tag: 'Do', datum: '18.12.', von: '08:30', bis: '14:30', sollStd: 6 },
            { tag: 'Fr', datum: '19.12.', von: '08:30', bis: '14:30', sollStd: 6 },
          ],
        }
      }
    ]
  };
}
