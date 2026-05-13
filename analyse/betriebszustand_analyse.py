#!/usr/bin/env python3
"""
Betriebszustands-Analyse Wukaninchen Kita
==========================================
Klassifiziert jeden Arbeitstag von Jan 2025 – Mai 2026 getrennt für
Waldkita (Ü3) und Hauskita/Nest (U3) in einen von 7 Zuständen (A–G) + P.

Zustandsmodell (beide Kitas, unabhängig klassifiziert):
  A = Normalbetrieb        – Vollbesetzung, kein Kranktag
  B = Intern kompensiert   – Ausfall intern ausgeglichen (≥ Komfortgrenze)
  C = Externe Vertretung   – externe/bezahlte Vertretung im Einsatz
  D = Gesetzl. Minimum     – FK-Zahl auf gesetzlichem Minimum (auto)
  E = Eltern gebeten       – Eltern aktiv gebeten, Kinder zu Hause zu lassen (manuell)
  F = Notbetreuung         – formale Notbetreuung (Dienstplan-Header oder manuell)
  G = Vollschließung       – Kita vollständig geschlossen (manuell)
  P = Geplant geschlossen  – Betriebsferien, Klausurtage (statisch)

Datenquellen:
  1. Dienstplan ODS-Dateien (/tmp/dienstplan_YYYY_MM.ods)
  2. Vertretungspool ODS (/tmp/vertretungspool.ods)
  3. Manuelle Annotationen (manuelle_annotationen.json, Feld kita: wald|haus|beide)
"""

import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime, timedelta

# ─── Konfiguration ────────────────────────────────────────────────────────────

ODS_DIR = '/tmp'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

DIENSTPLAN_MONATE = [
    '2025_01', '2025_02', '2025_03', '2025_04', '2025_05',
    '2025_06', '2025_07', '2025_08', '2025_09', '2025_10',
    '2025_11', '2025_12',
    '2026_01', '2026_02', '2026_03', '2026_04', '2026_05',
]

# Fachkräfte pro Kita — bestimmt durch Dienstplan-Sektion (Ü3 / Nest)
FACHKRAEFTE_WALD = {'Ilai', 'Edu', 'Juli', 'Myriam', 'Almuth', 'Johanna'}
FACHKRAEFTE_HAUS = {'Alina', 'Berit', 'Catharina', 'Izabella', 'Olli', 'Karo'}
FACHKRAEFTE = FACHKRAEFTE_WALD | FACHKRAEFTE_HAUS

# Externe Vertretungen (bezahlte Einsätze → Zustand C)
VERTRETUNGSPOOL_EXTERN = {
    'Anne', 'Svea', 'Charlene', 'Lene', 'Jana', 'Sabine',
    'Liu', 'Liu Ness', 'Mariella', 'Bianca', 'Nina', 'Romane',
}

# Schwellenwerte (KitaG Brandenburg §10)
# Wald (Ü3, ~15 Kinder): 1 FK/12 Kinder → Minimum 2; Komfort ≥ 3
FK_KOMFORT_MIN_WALD = 3
FK_GESETZ_MIN_WALD  = 2
# Haus (U3, ~10 Kinder): 1 FK/4-5 Kinder → Minimum 2-3; Komfort ≥ 3
FK_KOMFORT_MIN_HAUS = 3
FK_GESETZ_MIN_HAUS  = 2

# Mi (2) und Fr (4) haben strukturell keine Spätbetreuung → nie flaggen
KEIN_SPAET_WOCHENTAGE = {2, 4}

ZUSTAND_FARBEN = {
    'A': '#27ae60',  # grün
    'B': '#a8d8a8',  # hellgrün
    'C': '#f39c12',  # gelb-orange
    'D': '#e67e22',  # orange
    'E': '#fd79a8',  # rosa (manuell: Eltern gebeten)
    'F': '#e74c3c',  # rot (Notbetreuung)
    'G': '#7b241c',  # dunkelrot (Vollschließung)
    'P': '#b2bec3',  # hell-grau (geplante Schließung)
    'W': '#dfe6e9',  # sehr hell (Wochenende/Feiertag)
    '?': '#95a5a6',  # unbekannt
}

ZUSTAND_NAMEN = {
    'A': 'Normalbetrieb',
    'B': 'Intern kompensiert',
    'C': 'Externe Vertretung',
    'D': 'Gesetzl. Minimum',
    'E': 'Eltern gebeten',
    'F': 'Notbetreuung',
    'G': 'Vollschließung',
    'P': 'Geplant geschlossen',
    'W': 'Wochenende / Feiertag',
    '?': 'Daten fehlen',
}

# Schweregrade für Diagnose-Ausgabe (höherer Wert = kritischer)
SCHWERE = {'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'P': 0, 'W': 0, '?': 0}

# Brandenburg Feiertage 2025/2026
FEIERTAGE = {
    date(2025, 1, 1), date(2025, 4, 18), date(2025, 4, 21),
    date(2025, 5, 1), date(2025, 5, 29), date(2025, 6, 9),
    date(2025, 10, 3), date(2025, 10, 31),
    date(2025, 12, 25), date(2025, 12, 26),
    date(2026, 1, 1), date(2026, 4, 3), date(2026, 4, 6),
    date(2026, 5, 1), date(2026, 5, 14), date(2026, 5, 25),
}

# Geplante Schließzeiten (P) — aus Jahreskalender 2025/26 (Nextcloud)
SCHLIESSZEITEN = {
    date(2025, 1, 2):  'Weihnachtsschließzeit 2024/25',
    date(2025, 1, 3):  'Weihnachtsschließzeit 2024/25',
    # Sommerschließzeit 2025: 18.08.–05.09.2025
    date(2025, 8, 18): 'Sommerschließzeit 2025',
    date(2025, 8, 19): 'Sommerschließzeit 2025',
    date(2025, 8, 20): 'Sommerschließzeit 2025',
    date(2025, 8, 21): 'Sommerschließzeit 2025',
    date(2025, 8, 22): 'Sommerschließzeit 2025',
    date(2025, 8, 25): 'Sommerschließzeit 2025',
    date(2025, 8, 26): 'Sommerschließzeit 2025',
    date(2025, 8, 27): 'Sommerschließzeit 2025',
    date(2025, 8, 28): 'Sommerschließzeit 2025',
    date(2025, 8, 29): 'Sommerschließzeit 2025',
    date(2025, 9, 1):  'Sommerschließzeit 2025',
    date(2025, 9, 2):  'Sommerschließzeit 2025',
    date(2025, 9, 3):  'Sommerschließzeit 2025',
    date(2025, 9, 4):  'Sommerschließzeit 2025',
    date(2025, 9, 5):  'Sommerschließzeit 2025',
    # Klausurtage Oktober 2025
    date(2025, 10, 20): 'Klausurtage Oktober 2025',
    date(2025, 10, 21): 'Klausurtage Oktober 2025',
    # Weihnachtsschließzeit 2025/26: 22.12.2025–02.01.2026
    date(2025, 12, 22): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 23): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 24): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 29): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 30): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 31): 'Weihnachtsschließzeit 2025/26',
    date(2026, 1, 2):  'Weihnachtsschließzeit 2025/26',
    # Klausurtage Februar 2026
    date(2026, 2, 5):  'Klausurtage Februar 2026',
    date(2026, 2, 6):  'Klausurtage Februar 2026',
    # Brückentag nach Christi Himmelfahrt
    date(2026, 5, 15): 'Brückentag (Christi Himmelfahrt)',
}

NS = {
    'table': 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
    'text':  'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
}

# ─── ODS Parsing ──────────────────────────────────────────────────────────────

def ods_sheets(filepath):
    sheets = {}
    with zipfile.ZipFile(filepath) as z:
        tree = ET.parse(z.open('content.xml'))
        root = tree.getroot()
        for sheet in root.findall('.//table:table', NS):
            name = sheet.attrib.get(
                '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}name', '')
            rows = []
            for row in sheet.findall('table:table-row', NS):
                cells = []
                for c in row.findall('table:table-cell', NS):
                    repeat = int(c.attrib.get(
                        '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
                        'number-columns-repeated', 1))
                    txt = c.findtext('text:p', '', NS)
                    cells.extend([txt] * min(repeat, 60))
                rows.append(cells)
            sheets[name] = rows
    return sheets


def cell(row, idx):
    return row[idx].strip() if idx < len(row) else ''


# ─── Dienstplan Analyse ───────────────────────────────────────────────────────

TAG_VON = {'Mo': 1, 'Di': 5, 'Mi': 9, 'Do': 13, 'Fr': 17}
WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr']


def parse_woche_datum(rows):
    """Extrahiert das Montags-Datum der Woche aus dem Sheet-Header."""
    header = cell(rows[0], 0) if rows else ''
    m = re.search(r'(\d{2})\.(\d{2})\.-\d{2}\.\d{2}\.(\d{4})', header)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass
    m2 = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', header)
    if m2:
        try:
            d = date(int(m2.group(3)), int(m2.group(2)), int(m2.group(1)))
            return d - timedelta(days=d.weekday())
        except ValueError:
            pass
    return None


def parse_personal_status(rows):
    """
    Gibt zurück: [{name, gruppe, tage: {Mo: {status, std, bis}, ...}}]
    gruppe: 'Ü3' | 'Nest' | 'Weiteres'
    status: 'work' | 'K' | 'U' | 'FoBi' | 'frei'
    """
    current_gruppe = 'Ü3'
    personal = []
    SKIP = {'von', 'bis', 'Std', 'Summen', 'Ü3', 'Nest', 'Weiteres',
            'Legende', 'S – Seminartag', 'U – Urlaubstag', '', 'Leitungsstunden'}

    for row in rows[4:]:
        name = cell(row, 0)
        if not name or name in SKIP or name.startswith('S –') or name.startswith('U –'):
            if name == 'Nest':
                current_gruppe = 'Nest'
            elif name == 'Weiteres':
                current_gruppe = 'Weiteres'
            continue

        tage = {}
        for tag in WOCHENTAGE:
            von_col = TAG_VON[tag]
            von_val = cell(row, von_col)
            std_val = cell(row, von_col + 2)
            std_num = 0.0
            try:
                std_num = float(std_val.replace(',', '.'))
            except Exception:
                pass

            if von_val in ('K', 'Krank'):
                status = 'K'
            elif von_val in ('U', 'Urlaub'):
                status = 'U'
            elif von_val in ('FoBi', 'S', 'Seminar'):
                status = 'FoBi'
            elif re.match(r'\d+:\d+', von_val) or std_num > 0:
                status = 'work'
            else:
                status = 'frei'

            bis_val = cell(row, von_col + 1)
            tage[tag] = {'status': status, 'std': std_num, 'bis': bis_val}

        personal.append({'name': name, 'gruppe': current_gruppe, 'tage': tage})
    return personal


def analyse_dienstplaene():
    """
    Gibt zurück: {date → {
      'wald': {'fk_da': [...], 'krank': [...], 'vertretung_da': [...]},
      'haus': {'fk_da': [...], 'krank': [...], 'vertretung_da': [...]},
      'notbetreuung_header': bool,
      'monat': str,
      'spaet_workers_wald': [...],
      'spaetbetreuung_ausgefallen': bool,  ← gesetzt nach Post-Processing
    }}
    """
    tage_info = {}

    for monat in DIENSTPLAN_MONATE:
        fp = os.path.join(ODS_DIR, f'dienstplan_{monat}.ods')
        if not os.path.exists(fp):
            continue
        sheets = ods_sheets(fp)

        for sheet_name, rows in sheets.items():
            montag = parse_woche_datum(rows)
            if not montag:
                continue

            header_text = ' '.join(
                cell(rows[i], j)
                for i in range(4)
                for j in range(25)
                if i < len(rows) and j < len(rows[i])
            )
            hat_notbetreuung_header = 'Notbetreuung' in header_text

            personal = parse_personal_status(rows)

            for wt_idx, wt in enumerate(WOCHENTAGE):
                arbeitstag = montag + timedelta(days=wt_idx)
                if arbeitstag in FEIERTAGE:
                    continue

                fk_wald, fk_haus = [], []
                krank_wald, krank_haus = [], []
                vert_wald, vert_haus = [], []
                spaet_wald = []

                for p in personal:
                    name = p['name']
                    gruppe = p['gruppe']
                    t = p['tage'].get(wt, {})
                    status = t.get('status', 'frei')
                    bis = t.get('bis', '')

                    if status == 'work':
                        # FK-Zählung nach Sektion
                        if name in FACHKRAEFTE_WALD and gruppe == 'Ü3':
                            fk_wald.append(name)
                        if name in FACHKRAEFTE_HAUS and gruppe == 'Nest':
                            fk_haus.append(name)
                        # Externe Vertretungen nach Sektion
                        if name in VERTRETUNGSPOOL_EXTERN:
                            if gruppe == 'Ü3':
                                vert_wald.append(name)
                            elif gruppe == 'Nest':
                                vert_haus.append(name)
                        # Spätdienst: nur Wald-FK mit bis ≥ 16:00 und < 18:00
                        if name in FACHKRAEFTE_WALD and gruppe == 'Ü3':
                            if re.match(r'^\d{1,2}:\d{2}$', bis):
                                h_b, m_b = map(int, bis.split(':'))
                                total = h_b * 60 + m_b
                                if 16 * 60 <= total < 18 * 60:
                                    spaet_wald.append(name)

                    elif status == 'K':
                        if name in FACHKRAEFTE_WALD and gruppe == 'Ü3':
                            krank_wald.append(name)
                        if name in FACHKRAEFTE_HAUS and gruppe == 'Nest':
                            krank_haus.append(name)

                tage_info[arbeitstag] = {
                    'wald': {'fk_da': fk_wald, 'krank': krank_wald, 'vertretung_da': vert_wald},
                    'haus': {'fk_da': fk_haus, 'krank': krank_haus, 'vertretung_da': vert_haus},
                    'notbetreuung_header': hat_notbetreuung_header,
                    'monat': monat,
                    'spaet_workers_wald': spaet_wald,
                }

    # ── Wochenbasierte Spätbetreuungs-Auswertung (nur Waldkita) ─────────────
    woche_hat_spaet = defaultdict(bool)
    for d, info in tage_info.items():
        montag_d = d - timedelta(days=d.weekday())
        if info.get('spaet_workers_wald'):
            woche_hat_spaet[montag_d] = True

    for d, info in tage_info.items():
        montag_d = d - timedelta(days=d.weekday())
        hat_coverage = bool(info.get('spaet_workers_wald'))
        woche_aktiv  = woche_hat_spaet.get(montag_d, False)
        info['spaetbetreuung_ausgefallen'] = (
            woche_aktiv and not hat_coverage
            and d.weekday() not in KEIN_SPAET_WOCHENTAGE
            and d not in SCHLIESSZEITEN
        )

    return tage_info


def analyse_vertretungspool_2026():
    """Gibt zurück: {date → [namen]} für Einsatzdaten im Vertretungspool 2026."""
    fp = os.path.join(ODS_DIR, 'vertretungspool.ods')
    if not os.path.exists(fp):
        return {}
    sheets = ods_sheets(fp)

    einsatz_tage = defaultdict(list)

    for name, rows in sheets.items():
        if '2026' not in name or 'Stunden' not in name:
            continue

        person_cols = {}
        if rows:
            for idx, val in enumerate(rows[0]):
                v = val.strip()
                if v in ('Svea', 'Anne', 'Charlene', 'Jana', 'Liu', 'Liu Ness'):
                    person_cols[v] = idx

        for row in rows[2:]:
            for person, col_start in person_cols.items():
                datum_val = cell(row, col_start)
                von_val = cell(row, col_start + 1)
                if not datum_val or not re.match(r'\d{2}\.\d{2}\.', datum_val):
                    continue
                if von_val == 'K':
                    continue
                try:
                    if re.match(r'\d{2}\.\d{2}\.\d{2}$', datum_val):
                        d = datetime.strptime(datum_val, '%d.%m.%y').date()
                    elif re.match(r'\d{2}\.\d{2}\.\d{4}$', datum_val):
                        d = datetime.strptime(datum_val, '%d.%m.%Y').date()
                    else:
                        continue
                except ValueError:
                    continue
                if person in VERTRETUNGSPOOL_EXTERN:
                    einsatz_tage[d].append(person)

    return dict(einsatz_tage)


# ─── Klassifikation ───────────────────────────────────────────────────────────

def klassifiziere_kita(fk_da, krank, vertretung_da, fk_komfort_min, fk_gesetz_min, notbetreuung_header=False):
    """
    Klassifiziert eine einzelne Kita für einen Tag.
    Gibt (zustand, begruendung) zurück.
    """
    n_fk   = len(fk_da)
    n_krank = len(krank)
    hat_ext = len(vertretung_da) > 0

    # Notbetreuung aus Dienstplan-Header (auto-detektiert)
    if notbetreuung_header and n_krank > 0:
        return 'F', f'Notbetreuung laut Dienstplan-Header ({n_fk} FK, {n_krank} krank)'

    # Keine Daten
    if n_fk == 0 and n_krank == 0:
        return '?', 'Keine FK-Daten im Dienstplan'

    # Externe Vertretung (immer C, egal wie viele eigene FK)
    if hat_ext:
        ext_str = ', '.join(vertretung_da)
        return 'C', f'Externe Vertretung: {ext_str} ({n_fk} FK gesamt, {n_krank} krank)'

    # Komfortgrenze erfüllt
    if n_fk >= fk_komfort_min:
        if n_krank == 0:
            return 'A', f'Normalbetrieb: {n_fk} FK anwesend'
        krank_str = ', '.join(krank)
        return 'B', f'Intern kompensiert: {n_fk} FK, {n_krank} krank ({krank_str})'

    # Gesetzliches Minimum erfüllt
    if n_fk >= fk_gesetz_min:
        krank_str = ', '.join(krank)
        return 'D', f'Gesetzl. Minimum: {n_fk} FK, {n_krank} krank ({krank_str})'

    # Unter gesetzlichem Minimum
    if n_fk > 0:
        return 'F', f'Notbetreuung: nur {n_fk} FK (unter Mindestbesetzung), {n_krank} krank'

    # Null FK anwesend
    if n_krank > 0:
        krank_str = ', '.join(krank)
        return 'G', f'Keine FK anwesend ({n_krank} krank: {krank_str})'

    return '?', 'Keine FK-Daten verfügbar'


def klassifiziere_alle(tage_info, ann_wald, ann_haus, pool_2026):
    """
    Gibt {date → {
      'wald': {zustand, begruendung, verifiziert, spaetbetreuung_ausgefallen},
      'haus': {zustand, begruendung, verifiziert, spaetbetreuung_ausgefallen},
    }} zurück.
    """
    ergebnis = {}
    start = date(2025, 1, 1)
    ende  = date(2026, 5, 31)
    aktuell = start

    while aktuell <= ende:
        # Wochenende / Feiertag
        if aktuell.weekday() >= 5 or aktuell in FEIERTAGE:
            sub = {'zustand': 'W', 'begruendung': 'Wochenende / Feiertag',
                   'verifiziert': False, 'spaetbetreuung_ausgefallen': False}
            ergebnis[aktuell] = {'wald': sub.copy(), 'haus': sub.copy()}
            aktuell += timedelta(days=1)
            continue

        # Geplante Schließzeit
        if aktuell in SCHLIESSZEITEN:
            sub = {'zustand': 'P', 'begruendung': SCHLIESSZEITEN[aktuell],
                   'verifiziert': False, 'spaetbetreuung_ausgefallen': False}
            ergebnis[aktuell] = {'wald': sub.copy(), 'haus': sub.copy()}
            aktuell += timedelta(days=1)
            continue

        # Kein Dienstplan-Eintrag
        if aktuell not in tage_info:
            sub = {'zustand': '?', 'begruendung': 'Kein Dienstplan-Eintrag',
                   'verifiziert': False, 'spaetbetreuung_ausgefallen': False}
            ergebnis[aktuell] = {'wald': sub.copy(), 'haus': sub.copy()}
            aktuell += timedelta(days=1)
            continue

        info = tage_info[aktuell]
        spaet_ausgefallen = info.get('spaetbetreuung_ausgefallen', False)
        notbetreuung_hdr  = info.get('notbetreuung_header', False)

        # Vertretungspool 2026 ergänzen (beide Kitas, da Kita unbekannt)
        fk_wald  = list(info['wald']['fk_da'])
        kr_wald  = list(info['wald']['krank'])
        vt_wald  = list(info['wald']['vertretung_da'])
        fk_haus  = list(info['haus']['fk_da'])
        kr_haus  = list(info['haus']['krank'])
        vt_haus  = list(info['haus']['vertretung_da'])

        if aktuell in pool_2026:
            for p in pool_2026[aktuell]:
                if p in VERTRETUNGSPOOL_EXTERN:
                    if p not in vt_wald:
                        vt_wald.append(p)
                    if p not in vt_haus:
                        vt_haus.append(p)

        # Waldkita klassifizieren
        if aktuell in ann_wald and ann_wald[aktuell].get('zustand'):
            ann_w = ann_wald[aktuell]
            z_wald = ann_w['zustand']
            b_wald = ann_w.get('kommentar', f'Manuelle Annotation: {z_wald}')
            v_wald = True
            s_wald = ann_w.get('spaetbetreuung_ausgefallen', spaet_ausgefallen)
        else:
            z_wald, b_wald = klassifiziere_kita(
                fk_wald, kr_wald, vt_wald,
                FK_KOMFORT_MIN_WALD, FK_GESETZ_MIN_WALD, notbetreuung_hdr,
            )
            v_wald = False
            s_wald = spaet_ausgefallen

        # Hauskita klassifizieren
        if aktuell in ann_haus and ann_haus[aktuell].get('zustand'):
            ann_h = ann_haus[aktuell]
            z_haus = ann_h['zustand']
            b_haus = ann_h.get('kommentar', f'Manuelle Annotation: {z_haus}')
            v_haus = True
        else:
            z_haus, b_haus = klassifiziere_kita(
                fk_haus, kr_haus, vt_haus,
                FK_KOMFORT_MIN_HAUS, FK_GESETZ_MIN_HAUS, notbetreuung_hdr,
            )
            v_haus = False

        ergebnis[aktuell] = {
            'wald': {
                'zustand': z_wald,
                'begruendung': b_wald,
                'verifiziert': v_wald,
                'spaetbetreuung_ausgefallen': s_wald,
            },
            'haus': {
                'zustand': z_haus,
                'begruendung': b_haus,
                'verifiziert': v_haus,
                'spaetbetreuung_ausgefallen': False,  # Hauskita hat keine Spätbetreuung
            },
        }
        aktuell += timedelta(days=1)

    return ergebnis


# ─── Statistiken ──────────────────────────────────────────────────────────────

def berechne_statistiken(tage, kita='wald'):
    """Pro Monat und gesamt, für eine Kita."""
    gesamt    = defaultdict(int)
    pro_monat = defaultdict(lambda: defaultdict(int))

    for d, info in tage.items():
        z = info[kita]['zustand']
        gesamt[z] += 1
        monat_key = d.strftime('%Y-%m')
        pro_monat[monat_key][z] += 1

    return dict(gesamt), dict(pro_monat)


# ─── HTML Report ──────────────────────────────────────────────────────────────

MONAT_DE = {
    1: 'Januar', 2: 'Februar', 3: 'März', 4: 'April',
    5: 'Mai', 6: 'Juni', 7: 'Juli', 8: 'August',
    9: 'September', 10: 'Oktober', 11: 'November', 12: 'Dezember',
}
WT_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']


def render_kalender_monat(year, month, tage_flat):
    """Rendert einen Monats-Kalender für eine Kita (tage_flat: {date → kita-sub-dict})."""
    erster = date(year, month, 1)
    letzter = (date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)) - timedelta(days=1)

    html = f'<div class="monat-block"><h3>{MONAT_DE[month]} {year}</h3>'
    html += '<div class="kalender-grid">'
    for wt in ['Mo', 'Di', 'Mi', 'Do', 'Fr']:
        html += f'<div class="wt-header">{wt}</div>'

    # Führende Leerzellen
    wt_erster = erster.weekday()
    for _ in range(min(wt_erster, 5)):
        html += '<div class="tag-zelle leer"></div>'

    aktuell = erster
    while aktuell <= letzter:
        wt = aktuell.weekday()
        if wt >= 5:
            aktuell += timedelta(days=1)
            continue

        info = tage_flat.get(aktuell)
        if info is None:
            info = {'zustand': '?', 'begruendung': 'Kein Eintrag', 'verifiziert': False}

        z     = info.get('zustand', '?')
        farbe = ZUSTAND_FARBEN.get(z, '#ccc')
        name  = ZUSTAND_NAMEN.get(z, z)
        verifiziert = info.get('verifiziert', False)
        spaet = info.get('spaetbetreuung_ausgefallen', False)
        begr  = info.get('begruendung', '')

        tooltip = f'{aktuell.strftime("%d.%m.%Y")} ({WT_KURZ[wt]})&#10;{z}: {name}&#10;{begr}'
        if not verifiziert and z not in ('W', 'P', '?'):
            tooltip += '&#10;⚠ Nicht gegen Signal verifiziert'
        if spaet:
            tooltip += '&#10;⚠ Spätbetreuung ausgefallen'

        # Schraffierung für nicht-verifizierte Tage
        hatch_style = ''
        if not verifiziert and z not in ('W', 'P', '?'):
            hatch_style = (
                f'background-image: repeating-linear-gradient('
                f'45deg, transparent, transparent 3px, rgba(255,255,255,0.45) 3px, rgba(255,255,255,0.45) 5px);'
                f'background-color: {farbe};'
            )
        else:
            hatch_style = f'background: {farbe};'

        text_color = '#fff' if z in ('F', 'G') else 'rgba(0,0,0,0.65)'
        border_class = ' kritisch' if z in ('F', 'G') else ''

        html += (
            f'<div class="tag-zelle{border_class}" style="{hatch_style}" title="{tooltip}">'
            f'<span class="tag-nr" style="color:{text_color}">{aktuell.day}</span>'
            f'<span class="zustand-badge" style="color:{text_color}">{z}</span>'
        )
        if spaet:
            html += '<span class="spaet-dreieck"></span>'
        html += '</div>'
        aktuell += timedelta(days=1)

    html += '</div></div>'
    return html


def render_statistik_tabelle(gesamt, pro_monat, kita_label):
    zustand_reihenfolge = ['A', 'B', 'C', 'D', 'E', 'F', 'G', '?']
    operativ = ['A', 'B', 'C', 'D', 'E', 'F', 'G', '?']
    monate = sorted(pro_monat.keys())

    arbeitstage_gesamt = sum(v for k, v in gesamt.items() if k not in ('W', 'P'))

    html = f'<h3 style="margin-bottom:8px;font-size:14px">{kita_label}</h3>'
    html += '<table class="stats-table"><thead><tr>'
    html += '<th>Monat</th>'
    for z in zustand_reihenfolge:
        farbe = ZUSTAND_FARBEN[z]
        html += f'<th style="background:{farbe};color:{"#fff" if z in ("F","G") else "#222"}">{z}</th>'
    html += '<th>Arbeitstage</th></tr></thead><tbody>'

    for monat_key in monate:
        d_parts = monat_key.split('-')
        monat_label = f'{MONAT_DE[int(d_parts[1])]} {d_parts[0]}'
        html += f'<tr><td class="monat-label">{monat_label}</td>'
        arbeitstage = sum(pro_monat[monat_key].get(z, 0) for z in operativ)
        for z in zustand_reihenfolge:
            n = pro_monat[monat_key].get(z, 0)
            pct = f'{100*n/arbeitstage:.0f}%' if arbeitstage > 0 and n > 0 else ''
            cell_style = f'background:{ZUSTAND_FARBEN[z]}22' if n > 0 else ''
            html += f'<td style="{cell_style}">{n if n > 0 else "–"} <small>{pct}</small></td>'
        html += f'<td>{arbeitstage}</td></tr>'

    html += '<tr class="gesamt-row"><td><strong>Gesamt</strong></td>'
    for z in zustand_reihenfolge:
        n = gesamt.get(z, 0)
        pct = f'{100*n/arbeitstage_gesamt:.0f}%' if arbeitstage_gesamt > 0 and n > 0 else ''
        html += f'<td><strong>{n if n > 0 else "–"}</strong> <small>{pct}</small></td>'
    html += f'<td><strong>{arbeitstage_gesamt}</strong></td></tr>'
    html += '</tbody></table>'
    return html


def render_html(tage, gesamt_wald, pm_wald, gesamt_haus, pm_haus):
    """Rendert den vollständigen HTML-Report mit beiden Kitas."""

    # Flache Dicts für Kalender-Rendering
    tage_wald = {d: info['wald'] for d, info in tage.items()}
    tage_haus = {d: info['haus'] for d, info in tage.items()}

    # Chart-Daten (Wald)
    monate = sorted(pm_wald.keys())
    chart_labels = []
    for m in monate:
        p = m.split('-')
        chart_labels.append(f'{MONAT_DE[int(p[1])][:3]} {p[0][2:]}')

    def make_datasets(pm):
        datasets = []
        for z in ['A', 'B', 'C', 'D', 'E', 'F', 'G']:
            data = [pm.get(m, {}).get(z, 0) for m in monate]
            if any(v > 0 for v in data):
                datasets.append({
                    'label': f'{z} – {ZUSTAND_NAMEN[z]}',
                    'backgroundColor': ZUSTAND_FARBEN[z],
                    'data': data,
                    'stack': 'stack',
                })
        return datasets

    chart_wald_json = json.dumps({'labels': chart_labels, 'datasets': make_datasets(pm_wald)})
    chart_haus_json = json.dumps({'labels': chart_labels, 'datasets': make_datasets(pm_haus)})

    # Kalender-Blöcke
    def render_alle_monate(tage_flat):
        html = ''
        y, m = 2025, 1
        while (y, m) <= (2026, 5):
            html += render_kalender_monat(y, m, tage_flat)
            m += 1
            if m > 12:
                m = 1
                y += 1
        return html

    kalender_wald = render_alle_monate(tage_wald)
    kalender_haus = render_alle_monate(tage_haus)

    # Statistik-Tabellen
    stat_wald = render_statistik_tabelle(gesamt_wald, pm_wald, 'Waldkita (Ü3)')
    stat_haus = render_statistik_tabelle(gesamt_haus, pm_haus, 'Hauskita / Nest (U3)')

    # Legende
    legende_html = ''
    for z, name in ZUSTAND_NAMEN.items():
        if z in ('W',):
            continue
        farbe = ZUSTAND_FARBEN[z]
        text_color = '#fff' if z in ('F', 'G') else '#222'
        legende_html += (
            f'<div class="legende-item">'
            f'<div class="legende-farbe" style="background:{farbe};color:{text_color}">{z}</div>'
            f'<div class="legende-text"><strong>{z} – {name}</strong></div>'
            f'</div>'
        )

    arbeitstage_wald = sum(v for k, v in gesamt_wald.items() if k not in ('W', 'P'))
    arbeitstage_haus = sum(v for k, v in gesamt_haus.items() if k not in ('W', 'P'))

    html = f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Betriebszustands-Analyse — Kita Wukaninchen</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #f8f9fa; color: #2c3e50; font-size: 14px; line-height: 1.5; }}
  .container {{ max-width: 1400px; margin: 0 auto; padding: 24px; }}
  .report-header {{ background: #2c3e50; color: #fff; padding: 24px; border-radius: 8px; margin-bottom: 32px; }}
  .report-header h1 {{ font-size: 22px; font-weight: 600; margin-bottom: 6px; }}
  .report-header .meta {{ font-size: 13px; color: #95a5a6; }}
  h2 {{ font-size: 17px; font-weight: 600; margin: 32px 0 12px; color: #2c3e50; }}
  .kita-section {{ border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; margin-bottom: 32px; background: #fff; }}
  .kita-label {{ font-size: 15px; font-weight: 700; margin-bottom: 16px; color: #2c3e50; }}
  .legende {{ display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 32px; }}
  .legende-item {{ display: flex; align-items: center; gap: 8px; background: #fff;
                   padding: 8px 12px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }}
  .legende-farbe {{ width: 32px; height: 32px; border-radius: 5px;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: 14px; flex-shrink: 0; }}
  .legende-text {{ font-size: 12px; }}
  .kalender-container {{ display: flex; flex-wrap: wrap; gap: 16px; }}
  .monat-block {{ background: #fff; border-radius: 8px; padding: 12px 14px;
                  box-shadow: 0 1px 4px rgba(0,0,0,.08); min-width: 260px; }}
  .monat-block h3 {{ font-size: 12px; font-weight: 600; margin-bottom: 8px;
                     color: #2c3e50; text-transform: uppercase; letter-spacing: .5px; }}
  .kalender-grid {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 2px; }}
  .wt-header {{ text-align: center; font-size: 9px; color: #95a5a6; font-weight: 600; padding: 2px 0; }}
  .tag-zelle {{ border-radius: 3px; padding: 3px 1px; text-align: center;
                cursor: default; position: relative; min-height: 32px;
                display: flex; flex-direction: column; align-items: center;
                justify-content: center; transition: transform .1s; }}
  .tag-zelle:hover {{ transform: scale(1.12); z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,.2); }}
  .tag-zelle.leer {{ background: transparent !important; }}
  .tag-zelle.kritisch {{ box-shadow: inset 0 0 0 2px rgba(0,0,0,.25); }}
  .tag-nr {{ font-size: 10px; font-weight: 600; line-height: 1; }}
  .zustand-badge {{ font-size: 8px; font-weight: 700; }}
  .spaet-dreieck {{ position: absolute; bottom: 1px; right: 1px;
                    width: 0; height: 0;
                    border-left: 8px solid transparent;
                    border-bottom: 8px solid #e74c3c; }}
  .chart-container {{ background: #fff; border-radius: 8px; padding: 16px;
                      box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 24px; }}
  .chart-container h4 {{ font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #555; }}
  .chart-wrapper {{ height: 260px; }}
  .stats-table {{ width: 100%; border-collapse: collapse; font-size: 12px;
                  background: #fff; border-radius: 8px; overflow: hidden;
                  box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 24px; }}
  .stats-table th, .stats-table td {{ padding: 6px 10px; text-align: center; border-bottom: 1px solid #f0f0f0; }}
  .stats-table th {{ background: #2c3e50; color: #fff; font-weight: 600; font-size: 11px; }}
  .stats-table .monat-label {{ text-align: left; font-weight: 500; white-space: nowrap; }}
  .stats-table td small {{ color: #95a5a6; font-size: 10px; }}
  .stats-table .gesamt-row {{ background: #f8f9fa; border-top: 2px solid #2c3e50; }}
  .stats-table tr:hover {{ background: #f8f9fa; }}
  h3 {{ font-size: 14px; font-weight: 600; margin-bottom: 10px; color: #2c3e50; }}
  @media print {{
    body {{ background: white; }}
    .container {{ max-width: none; padding: 12px; }}
    .kita-section {{ break-inside: avoid; }}
    .monat-block {{ break-inside: avoid; }}
  }}
</style>
</head>
<body>
<div class="container">

<div class="report-header">
  <h1>Betriebszustands-Analyse — Kita Wukaninchen</h1>
  <div class="meta">
    Jan 2025 – Mai 2026 ·
    Waldkita: {arbeitstage_wald} Arbeitstage ·
    Hauskita: {arbeitstage_haus} Arbeitstage ·
    Erstellt {date.today().strftime("%d.%m.%Y")}
  </div>
</div>

<h2>Legende — Zustandsmodell</h2>
<div class="legende">{legende_html}
  <div class="legende-item">
    <div class="legende-farbe" style="background: repeating-linear-gradient(45deg, #27ae60, #27ae60 3px, rgba(255,255,255,0.45) 3px, rgba(255,255,255,0.45) 5px); background-color: #27ae60;">A</div>
    <div class="legende-text">Schraffierung = nur auto-klassifiziert (nicht gegen Signal verifiziert)</div>
  </div>
</div>

<div class="kita-section">
  <div class="kita-label">🌳 Waldkita (Ü3, ~15 Kinder)</div>

  <div class="chart-container">
    <h4>Verlauf nach Monat — Waldkita</h4>
    <div class="chart-wrapper"><canvas id="chartWald"></canvas></div>
  </div>

  <h3>Kalender — Waldkita</h3>
  <div class="kalender-container">{kalender_wald}</div>

  <h3>Monatsstatistik — Waldkita</h3>
  {stat_wald}
</div>

<div class="kita-section">
  <div class="kita-label">🏠 Hauskita / Nest (U3, ~10 Kinder)</div>

  <div class="chart-container">
    <h4>Verlauf nach Monat — Hauskita</h4>
    <div class="chart-wrapper"><canvas id="chartHaus"></canvas></div>
  </div>

  <h3>Kalender — Hauskita</h3>
  <div class="kalender-container">{kalender_haus}</div>

  <h3>Monatsstatistik — Hauskita</h3>
  {stat_haus}
</div>

</div><!-- /container -->

<script>
(function() {{
  const optBase = {{
    responsive: true, maintainAspectRatio: false,
    plugins: {{
      legend: {{ position: 'bottom', labels: {{ boxWidth: 12, font: {{ size: 11 }} }} }},
      tooltip: {{ mode: 'index', intersect: false }},
    }},
    scales: {{
      x: {{ stacked: true, ticks: {{ font: {{ size: 10 }} }} }},
      y: {{ stacked: true, title: {{ display: true, text: 'Arbeitstage' }},
             ticks: {{ font: {{ size: 10 }} }} }},
    }},
  }};
  new Chart(document.getElementById('chartWald').getContext('2d'),
    {{ type: 'bar', data: {chart_wald_json}, options: optBase }});
  new Chart(document.getElementById('chartHaus').getContext('2d'),
    {{ type: 'bar', data: {chart_haus_json}, options: optBase }});
}})();
</script>
</body>
</html>"""
    return html


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print('Betriebszustands-Analyse Wukaninchen (Waldkita + Hauskita)')
    print('=' * 60)

    # Annotationen laden
    ann_path = os.path.join(SCRIPT_DIR, 'manuelle_annotationen.json')
    ann_wald = {}
    ann_haus = {}
    if os.path.exists(ann_path):
        with open(ann_path, 'r', encoding='utf-8') as f:
            entries = json.load(f)
        for entry in entries:
            d    = date.fromisoformat(entry['datum'])
            kita = entry.get('kita', 'beide')
            ann  = {
                'zustand': entry.get('zustand'),
                'kommentar': entry.get('kommentar', ''),
                'spaetbetreuung_ausgefallen': entry.get('spaetbetreuung_ausgefallen', False),
            }
            if kita in ('wald', 'beide'):
                ann_wald[d] = ann
            if kita in ('haus', 'beide'):
                ann_haus[d] = ann
        print(f'  → {len(entries)} Annotationen geladen'
              f' ({len(ann_wald)} Wald, {len(ann_haus)} Haus)')
    else:
        print('  → Keine manuelle_annotationen.json gefunden')

    # Dienstpläne
    print('  Analysiere Dienstpläne...')
    tage_info = analyse_dienstplaene()
    print(f'  → {len(tage_info)} Arbeitstage extrahiert')

    # Vertretungspool 2026
    print('  Analysiere Vertretungspool 2026...')
    pool_2026 = analyse_vertretungspool_2026()
    print(f'  → {sum(len(v) for v in pool_2026.values())} Einsätze im Pool')

    # Klassifikation
    print('  Klassifiziere alle Tage (Wald + Haus)...')
    tage = klassifiziere_alle(tage_info, ann_wald, ann_haus, pool_2026)
    print(f'  → {len(tage)} Tage klassifiziert')

    # Statistiken
    gesamt_wald, pm_wald = berechne_statistiken(tage, 'wald')
    gesamt_haus, pm_haus = berechne_statistiken(tage, 'haus')

    print()
    arbeitstage_wald = sum(v for k, v in gesamt_wald.items() if k not in ('W', 'P'))
    arbeitstage_haus = sum(v for k, v in gesamt_haus.items() if k not in ('W', 'P'))

    print(f'Waldkita ({arbeitstage_wald} Arbeitstage):')
    for z in ['A', 'B', 'C', 'D', 'E', 'F', 'G', '?']:
        n = gesamt_wald.get(z, 0)
        if n > 0:
            pct = f'{100*n/arbeitstage_wald:.1f}%' if arbeitstage_wald > 0 else ''
            print(f'  {z} ({ZUSTAND_NAMEN[z]:<22}): {n:>3}  {pct}')

    print(f'\nHauskita ({arbeitstage_haus} Arbeitstage):')
    for z in ['A', 'B', 'C', 'D', 'E', 'F', 'G', '?']:
        n = gesamt_haus.get(z, 0)
        if n > 0:
            pct = f'{100*n/arbeitstage_haus:.1f}%' if arbeitstage_haus > 0 else ''
            print(f'  {z} ({ZUSTAND_NAMEN[z]:<22}): {n:>3}  {pct}')

    # Spätbetreuung-Ausfälle zählen (Wald only)
    spaet_ausfaelle = sum(
        1 for d, info in tage.items()
        if info['wald'].get('spaetbetreuung_ausgefallen')
    )
    if spaet_ausfaelle > 0:
        print(f'\nSpätbetreuung ausgefallen (Wald): {spaet_ausfaelle} Tage')

    # JSON Export (neues Schema: wald/haus nested)
    json_out = os.path.join(SCRIPT_DIR, 'betriebszustand_tage.json')
    with open(json_out, 'w', encoding='utf-8') as f:
        json.dump(
            {
                d.isoformat(): {
                    'wald': {
                        'zustand': v['wald']['zustand'],
                        'begruendung': v['wald']['begruendung'],
                        'verifiziert': v['wald']['verifiziert'],
                        'spaetbetreuung_ausgefallen': v['wald']['spaetbetreuung_ausgefallen'],
                    },
                    'haus': {
                        'zustand': v['haus']['zustand'],
                        'begruendung': v['haus']['begruendung'],
                        'verifiziert': v['haus']['verifiziert'],
                        'spaetbetreuung_ausgefallen': False,
                    },
                }
                for d, v in sorted(tage.items())
            },
            f, ensure_ascii=False, indent=2,
        )
    print(f'\nJSON gespeichert: {json_out}')

    # HTML Report
    html_out = os.path.join(SCRIPT_DIR, 'betriebszustand_report.html')
    html = render_html(tage, gesamt_wald, pm_wald, gesamt_haus, pm_haus)
    with open(html_out, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'HTML Report gespeichert: {html_out}')
    print()
    print('Zum Öffnen: open betriebszustand_report.html')


if __name__ == '__main__':
    main()
