#!/usr/bin/env python3
"""
Betriebszustands-Analyse Wukaninchen Kita
==========================================
Klassifiziert jeden Arbeitstag von Jan 2025 – Mai 2026 in einen von 6 Zuständen (A–F).

Zustandsmodell:
  A = Normalbetrieb          – alle Kernteam-FK anwesend
  B = Intern kompensiert     – 1-2 K-Tage, aber FK ≥ Komfortgrenze, kein externer Einsatz
  C = Kostenintensiv/Grauzone – externe Vertretung bezahlt ODER FK auf gesetzlichem Minimum
  D = Eltern gebeten         – Bedarf-1/2-System aktiv (manuelle Annotation)
  E = Notbetreuung           – Formale Notbetreuung (manuelle Annotation)
  F = Vollschließung         – Kita zu (manuelle Annotation)

Datenquellen:
  1. Dienstplan ODS-Dateien (/tmp/dienstplan_YYYY_MM.ods)
  2. Vertretungspool ODS (/tmp/vertretungspool.ods)
  3. Manuelle Annotationen (manuelle_annotationen.json)
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

# Qualifizierte Fachkräfte (können allein betreuen)
FACHKRAEFTE = {
    'Ilai', 'Edu', 'Juli', 'Myriam', 'Johanna',   # Ü3 Kernteam
    'Alina', 'Berit', 'Catharina', 'Karo',          # Nest Kernteam
    'Anne', 'Svea', 'Romane',                        # Qualifizierte Vertretungen
}

# Kernteam (ohne Elternzeit-Personal für Ausfallzählung)
KERNTEAM_AKTIV = {'Ilai', 'Edu', 'Juli', 'Myriam', 'Alina', 'Berit', 'Catharina'}

# Vertretungspool (externe, bezahlte Einsätze → C)
VERTRETUNGSPOOL_EXTERN = {'Anne', 'Svea', 'Charlene', 'Lene', 'Jana', 'Sabine', 'Liu', 'Liu Ness', 'Mariella', 'Bianca', 'Nina'}

# Schwellenwerte (konfigurierbar)
FK_KOMFORT_MIN = 4    # B: mind. 4 FK arbeitend → intern kompensierbar
FK_GESETZ_MIN  = 3    # C: nur 3 FK → gesetzliches Minimum gerade erfüllt (Grauzone)
                       # < 3 FK → ohne D/E/F-Override: C mit Warnung

# Farbkodierung
ZUSTAND_FARBEN = {
    'A': '#27ae60',  # grün
    'B': '#a8d8a8',  # hellgrün
    'C': '#f39c12',  # gelb-orange
    'D': '#e67e22',  # orange
    'E': '#e74c3c',  # rot
    'F': '#7b241c',  # dunkelrot
    'G': '#b2bec3',  # hell-grau (geplante Schließung)
    'W': '#dfe6e9',  # Wochenende/Feiertag
    '?': '#95a5a6',  # unbekannt/fehlende Daten
}

ZUSTAND_NAMEN = {
    'A': 'Normalbetrieb',
    'B': 'Intern kompensiert',
    'C': 'Kostenintensiv / Grauzone',
    'D': 'Eltern gebeten',
    'E': 'Notbetreuung',
    'F': 'Vollschließung',
    'G': 'Geplante Schließung',
    'W': 'Wochenende / Feiertag',
    '?': 'Daten fehlen',
}

# Brandenburg Feiertage 2025/2026
FEIERTAGE = {
    date(2025, 1, 1), date(2025, 4, 18), date(2025, 4, 21),
    date(2025, 5, 1), date(2025, 5, 29), date(2025, 6, 9),
    date(2025, 10, 3), date(2025, 10, 31),
    date(2025, 12, 25), date(2025, 12, 26),
    date(2026, 1, 1), date(2026, 4, 3), date(2026, 4, 6),
    date(2026, 5, 1), date(2026, 5, 14), date(2026, 5, 25),  # Christi Himmelfahrt + Pfingstmontag
}

# Geplante Schließzeiten laut Jahreskalender 2025/26 (aus Nextcloud)
# Quelle: 03 Kinderbetreuung/Elternvertretung/Jahreskalender 2025-26 Vorschlag CR.ods
SCHLIESSZEITEN = {
    # Weihnachtsschließzeit 2024/25 (inferred — kein separater Jahreskalender vorhanden)
    date(2025, 1, 2): 'Weihnachtsschließzeit 2024/25',
    date(2025, 1, 3): 'Weihnachtsschließzeit 2024/25',
    # Sommerschließzeit 2025: 18.08.–05.09.2025 (15 Arbeitstage)
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
    # Klausurtage Oktober 2025: 20.–21.10.2025 (Kita zu)
    date(2025, 10, 20): 'Klausurtage Oktober 2025',
    date(2025, 10, 21): 'Klausurtage Oktober 2025',
    # Weihnachtsschließzeit 2025/26: 22.12.2025–02.01.2026 (7 Arbeitstage; 25/26 Dez + 1 Jan = Feiertage)
    date(2025, 12, 22): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 23): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 24): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 29): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 30): 'Weihnachtsschließzeit 2025/26',
    date(2025, 12, 31): 'Weihnachtsschließzeit 2025/26',
    date(2026, 1, 2):  'Weihnachtsschließzeit 2025/26',
    # Klausurtage Februar 2026: 05.–06.02.2026 (Kita zu)
    date(2026, 2, 5): 'Klausurtage Februar 2026',
    date(2026, 2, 6): 'Klausurtage Februar 2026',
    # Brückentag nach Christi Himmelfahrt: 15.05.2026
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
    # Format: "Dienstplan 06.01.-10.01.2025" oder "Dienstplan 02.01.-06.01.2025"
    m = re.search(r'(\d{2})\.(\d{2})\.-\d{2}\.\d{2}\.(\d{4})', header)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass
    # Fallback: suche nach einzelnem Datum
    m2 = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', header)
    if m2:
        try:
            d = date(int(m2.group(3)), int(m2.group(2)), int(m2.group(1)))
            # Auf Montag zurücksetzen
            return d - timedelta(days=d.weekday())
        except ValueError:
            pass
    return None


def parse_personal_status(rows):
    """
    Gibt zurück: Liste von {name, gruppe, tage: {Mo: {status, std}, ...}}
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
    Gibt zurück: {date → {fk_arbeitend: [namen], kernteam_krank: [namen],
                           vertretung_da: [namen], notbetreuung_header: bool}}
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

            # Prüfe ob "Notbetreuung" im Header vorkommt
            header_text = ' '.join(cell(rows[i], j)
                                   for i in range(4)
                                   for j in range(25)
                                   if i < len(rows) and j < len(rows[i]))
            hat_notbetreuung_header = 'Notbetreuung' in header_text

            personal = parse_personal_status(rows)

            for wt_idx, wt in enumerate(WOCHENTAGE):
                arbeitstag = montag + timedelta(days=wt_idx)
                if arbeitstag in FEIERTAGE:
                    continue

                fk_da = []
                kern_krank = []
                vertretung_da = []

                for p in personal:
                    name = p['name']
                    status = p['tage'].get(wt, {}).get('status', 'frei')

                    if status == 'work' and name in FACHKRAEFTE:
                        fk_da.append(name)
                    if status == 'work' and name in VERTRETUNGSPOOL_EXTERN:
                        vertretung_da.append(name)
                    if status == 'K' and name in KERNTEAM_AKTIV:
                        kern_krank.append(name)

                # Spätdienst: Personen mit bis-Zeit >= 16:00 und < 18:00
                spaet_workers = []
                for p in personal:
                    bis = p['tage'].get(wt, {}).get('bis', '')
                    if re.match(r'^\d{1,2}:\d{2}$', bis):
                        h_b, m_b = map(int, bis.split(':'))
                        total = h_b * 60 + m_b
                        if 16 * 60 <= total < 18 * 60:
                            spaet_workers.append(p['name'])

                tage_info[arbeitstag] = {
                    'fk_arbeitend': fk_da,
                    'kernteam_krank': kern_krank,
                    'vertretung_da': vertretung_da,
                    'notbetreuung_header': hat_notbetreuung_header,
                    'monat': monat,
                    'spaet_workers': spaet_workers,
                }

    # ── Wochenbasierte Spätbetreuungs-Auswertung ─────────────────────────────
    # Mi (2) und Fr (4) haben strukturell keine Spätbetreuung → nie flaggen
    KEIN_SPAET_WOCHENTAGE = {2, 4}
    woche_hat_spaet = defaultdict(bool)
    for d, info in tage_info.items():
        montag_d = d - timedelta(days=d.weekday())
        if info.get('spaet_workers'):
            woche_hat_spaet[montag_d] = True

    for d, info in tage_info.items():
        montag_d = d - timedelta(days=d.weekday())
        hat_coverage = bool(info.get('spaet_workers'))
        woche_aktiv  = woche_hat_spaet.get(montag_d, False)
        info['spaetbetreuung_ausgefallen'] = (
            woche_aktiv and not hat_coverage and
            d.weekday() not in KEIN_SPAET_WOCHENTAGE and
            d not in SCHLIESSZEITEN  # Klausurtage / Betriebsferien nicht flaggen
        )

    return tage_info


def analyse_vertretungspool_2026():
    """Gibt zurück: {date → [namen]} für konkrete Einsatzdaten in 2026."""
    fp = os.path.join(ODS_DIR, 'vertretungspool.ods')
    if not os.path.exists(fp):
        return {}
    sheets = ods_sheets(fp)

    einsatz_tage = defaultdict(list)

    for name, rows in sheets.items():
        if '2026' not in name or 'Stunden' not in name:
            continue

        # Person-Spalten: Svea=0, Charlene=5, Anne=10, Jana=15
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
                if person in FACHKRAEFTE or person in VERTRETUNGSPOOL_EXTERN:
                    einsatz_tage[d].append(person)

    return dict(einsatz_tage)


# ─── Klassifikation ───────────────────────────────────────────────────────────

def klassifiziere_tag(tag, info, annotationen, pool_2026):
    """Gibt (zustand, begruendung) zurück."""
    # 1. Manuelle Override: F > E > D
    if tag in annotationen:
        ann = annotationen[tag]
        return ann['zustand'], ann['kommentar']

    # 2. Notbetreuung im Dienstplan-Header
    if info.get('notbetreuung_header') and info.get('kernteam_krank'):
        return 'E', 'Notbetreuung laut Dienstplan-Header'

    fk_da = info.get('fk_arbeitend', [])
    kern_krank = info.get('kernteam_krank', [])
    vertretung_da = info.get('vertretung_da', [])

    # Vertretungspool 2026 ergänzen
    if tag in pool_2026:
        for p in pool_2026[tag]:
            if p not in fk_da and p in FACHKRAEFTE:
                fk_da = fk_da + [p]
            if p not in vertretung_da and p in VERTRETUNGSPOOL_EXTERN:
                vertretung_da = vertretung_da + [p]

    n_fk = len(fk_da)
    n_krank = len(kern_krank)
    hat_externe = len(vertretung_da) > 0

    # 3. Klassifikation nach Fachkraft-Anzahl und externem Einsatz
    if n_krank == 0 and n_fk >= FK_KOMFORT_MIN:
        return 'A', f'Vollbesetzung: {n_fk} FK anwesend'

    if hat_externe:
        return 'C', f'Externe Vertretung: {", ".join(vertretung_da)} ({n_fk} FK gesamt, {n_krank} krank)'

    if n_fk >= FK_KOMFORT_MIN:
        return 'B', f'Intern kompensiert: {n_fk} FK anwesend, {n_krank} krank ({", ".join(kern_krank)})'

    if n_fk >= FK_GESETZ_MIN:
        return 'C', f'Grauzone: nur {n_fk} FK (gesetzl. Minimum), {n_krank} krank ({", ".join(kern_krank)})'

    if n_fk > 0:
        return 'C', f'Kritisch: nur {n_fk} FK anwesend, {n_krank} krank ({", ".join(kern_krank)}) — mglw. unter Fachkraftschlüssel!'

    if n_krank > 0:
        return 'C', f'Keine FK-Daten, aber {n_krank} Kernteam-Mitglieder krank'

    return 'A', 'Keine Auffälligkeiten in Daten'


def klassifiziere_alle(tage_info, annotationen, pool_2026):
    """Gibt {date → {zustand, begruendung, details}} zurück."""
    ergebnis = {}

    # Zeitraum: Jan 2025 – Mai 2026
    start = date(2025, 1, 1)
    ende = date(2026, 5, 31)
    aktuell = start

    while aktuell <= ende:
        spaet_ann  = annotationen.get(aktuell, {}).get('spaetbetreuung_ausgefallen', False)
        spaet_plan = tage_info.get(aktuell, {}).get('spaetbetreuung_ausgefallen', False)
        spaet = spaet_ann or spaet_plan
        if aktuell.weekday() >= 5 or aktuell in FEIERTAGE:
            ergebnis[aktuell] = {'zustand': 'W', 'begruendung': 'Wochenende / Feiertag', 'spaetbetreuung_ausgefallen': spaet, 'details': {}}
        elif aktuell in SCHLIESSZEITEN:
            ergebnis[aktuell] = {'zustand': 'G', 'begruendung': SCHLIESSZEITEN[aktuell], 'spaetbetreuung_ausgefallen': spaet, 'details': {}}
        elif aktuell not in tage_info:
            ergebnis[aktuell] = {'zustand': '?', 'begruendung': 'Kein Dienstplan-Eintrag', 'spaetbetreuung_ausgefallen': spaet, 'details': {}}
        else:
            info = tage_info[aktuell]
            zustand, begruendung = klassifiziere_tag(aktuell, info, annotationen, pool_2026)
            ergebnis[aktuell] = {
                'zustand': zustand,
                'begruendung': begruendung,
                'spaetbetreuung_ausgefallen': spaet,
                'details': info,
            }
        aktuell += timedelta(days=1)

    return ergebnis


# ─── Statistiken ──────────────────────────────────────────────────────────────

def berechne_statistiken(tage):
    """Pro Monat und gesamt."""
    gesamt = defaultdict(int)
    pro_monat = defaultdict(lambda: defaultdict(int))

    for d, info in tage.items():
        z = info['zustand']
        gesamt[z] += 1
        monat_key = d.strftime('%Y-%m')
        pro_monat[monat_key][z] += 1

    return dict(gesamt), dict(pro_monat)


# ─── HTML Report ──────────────────────────────────────────────────────────────

MONAT_DE = {
    1: 'Januar', 2: 'Februar', 3: 'März', 4: 'April',
    5: 'Mai', 6: 'Juni', 7: 'Juli', 8: 'August',
    9: 'September', 10: 'Oktober', 11: 'November', 12: 'Dezember'
}

WT_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']


def render_kalender_monat(year, month, tage):
    """Rendert einen Monats-Kalender als HTML-Grid."""
    erster = date(year, month, 1)
    if month == 12:
        letzter = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        letzter = date(year, month + 1, 1) - timedelta(days=1)

    # Wochentag-Header (nur Mo–Fr)
    html = f'<div class="monat-block"><h3>{MONAT_DE[month]} {year}</h3>'
    html += '<div class="kalender-grid">'
    for wt in ['Mo', 'Di', 'Mi', 'Do', 'Fr']:
        html += f'<div class="wt-header">{wt}</div>'

    # Leere Felder vor dem ersten Tag
    wt_erster = erster.weekday()  # 0=Mo
    # Führende Leerzellen (nur wenn erster Tag nicht Montag ist)
    fuer_ferien = min(wt_erster, 5)
    for _ in range(fuer_ferien):
        html += '<div class="tag-zelle leer"></div>'

    aktuell = erster
    while aktuell <= letzter:
        wt = aktuell.weekday()
        if wt >= 5:  # Sa/So überspringen im Grid
            aktuell += timedelta(days=1)
            continue

        info = tage.get(aktuell, {'zustand': '?', 'begruendung': 'Kein Eintrag'})
        z = info['zustand']
        farbe = ZUSTAND_FARBEN.get(z, '#ccc')
        name = ZUSTAND_NAMEN.get(z, z)

        details = info.get('details', {})
        fk_namen = ', '.join(details.get('fk_arbeitend', [])) or '–'
        krank_namen = ', '.join(details.get('kernteam_krank', [])) or '–'
        vertretung_namen = ', '.join(details.get('vertretung_da', [])) or '–'
        begruendung = info.get('begruendung', '')

        tooltip_lines = [
            f'{aktuell.strftime("%d.%m.%Y")} ({WT_KURZ[wt]})',
            f'Zustand {z}: {name}',
            f'→ {begruendung}',
        ]
        if fk_namen != '–':
            tooltip_lines.append(f'FK anwesend: {fk_namen}')
        if krank_namen != '–':
            tooltip_lines.append(f'Krank: {krank_namen}')
        if vertretung_namen != '–':
            tooltip_lines.append(f'Vertretung: {vertretung_namen}')
        tooltip = '&#10;'.join(tooltip_lines)

        border_class = ' kritisch' if z in ('E', 'F') else ''
        html += (
            f'<div class="tag-zelle{border_class}" '
            f'style="background:{farbe}" '
            f'title="{tooltip}" '
            f'data-zustand="{z}">'
            f'<span class="tag-nr">{aktuell.day}</span>'
            f'<span class="zustand-badge">{z}</span>'
            f'</div>'
        )
        aktuell += timedelta(days=1)

    html += '</div></div>'
    return html


def render_statistik_tabelle(gesamt, pro_monat):
    zustand_reihenfolge = ['A', 'B', 'C', 'D', 'E', 'F', 'G', '?']
    operativ = ['A', 'B', 'C', 'D', 'E', 'F', '?']  # für Arbeitstage-Nenner (ohne G/W)
    monate = sorted(pro_monat.keys())

    # Operative Arbeitstage gesamt (ohne W und G)
    arbeitstage_gesamt = sum(v for k, v in gesamt.items() if k in operativ)

    html = '<table class="stats-table"><thead><tr>'
    html += '<th>Monat</th>'
    for z in zustand_reihenfolge:
        farbe = ZUSTAND_FARBEN[z]
        html += f'<th style="background:{farbe};color:{"#fff" if z in ("E","F") else "#222"}">{z}</th>'
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


def render_html(tage, gesamt, pro_monat):
    """Rendert den vollständigen HTML-Report."""

    # Chart.js Daten
    monate = sorted(pro_monat.keys())
    chart_labels = []
    for m in monate:
        p = m.split('-')
        chart_labels.append(f'{MONAT_DE[int(p[1])][:3]} {p[0][2:]}')

    datasets = []
    for z in ['A', 'B', 'C', 'D', 'E', 'F', 'G']:
        farbe = ZUSTAND_FARBEN[z]
        data = [pro_monat[m].get(z, 0) for m in monate]
        datasets.append({
            'label': f'{z} – {ZUSTAND_NAMEN[z]}',
            'backgroundColor': farbe,
            'data': data,
        })

    chart_data_json = json.dumps({
        'labels': chart_labels,
        'datasets': datasets,
    })

    # Kalender-Blöcke
    kalender_html = ''
    monate_liste = []
    aktuell = date(2025, 1, 1)
    while aktuell <= date(2026, 5, 31):
        if (aktuell.year, aktuell.month) not in [(d.year, d.month) for d in [aktuell]
                                                  if d not in monate_liste]:
            monate_liste.append((aktuell.year, aktuell.month))
        aktuell = (aktuell.replace(day=1) + timedelta(days=32)).replace(day=1)

    # Neu: Iteriere chronologisch durch Monate
    y, m = 2025, 1
    while (y, m) <= (2026, 5):
        kalender_html += render_kalender_monat(y, m, tage)
        m += 1
        if m > 12:
            m = 1
            y += 1

    legende_html = ''
    for z, name in ZUSTAND_NAMEN.items():
        farbe = ZUSTAND_FARBEN[z]
        text_color = '#fff' if z in ('E', 'F') else '#222'
        legende_html += (
            f'<div class="legende-item">'
            f'<div class="legende-farbe" style="background:{farbe};color:{text_color}">{z}</div>'
            f'<div class="legende-text"><strong>Zustand {z}</strong><br>{name}</div>'
            f'</div>'
        )

    stat_tabelle = render_statistik_tabelle(gesamt, pro_monat)

    arbeitstage_gesamt = sum(v for k, v in gesamt.items() if k != 'W')
    n_e_f = gesamt.get('E', 0) + gesamt.get('F', 0)
    n_d = gesamt.get('D', 0)
    n_c = gesamt.get('C', 0)
    n_b = gesamt.get('B', 0)
    n_a = gesamt.get('A', 0)

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

  /* Header */
  .report-header {{ background: #2c3e50; color: #fff; padding: 24px; border-radius: 8px;
                    margin-bottom: 32px; }}
  .report-header h1 {{ font-size: 22px; font-weight: 600; margin-bottom: 6px; }}
  .report-header .meta {{ font-size: 13px; color: #95a5a6; }}

  /* Summary Cards */
  .summary-cards {{ display: flex; gap: 12px; margin-bottom: 32px; flex-wrap: wrap; }}
  .card {{ background: #fff; border-radius: 8px; padding: 16px 20px;
           box-shadow: 0 1px 4px rgba(0,0,0,.08); flex: 1; min-width: 140px; }}
  .card .val {{ font-size: 32px; font-weight: 700; }}
  .card .lbl {{ font-size: 12px; color: #7f8c8d; margin-top: 2px; }}
  .card.red {{ border-left: 4px solid {ZUSTAND_FARBEN['F']}; }}
  .card.orange {{ border-left: 4px solid {ZUSTAND_FARBEN['E']}; }}
  .card.yellow {{ border-left: 4px solid {ZUSTAND_FARBEN['C']}; }}
  .card.green {{ border-left: 4px solid {ZUSTAND_FARBEN['A']}; }}

  /* Legende */
  .legende {{ display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 32px; }}
  .legende-item {{ display: flex; align-items: center; gap: 10px; background: #fff;
                   padding: 10px 14px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }}
  .legende-farbe {{ width: 36px; height: 36px; border-radius: 6px;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 700; font-size: 16px; flex-shrink: 0; }}
  .legende-text {{ font-size: 12px; }}
  .legende-text strong {{ font-size: 13px; }}

  /* Kalender */
  h2 {{ font-size: 17px; font-weight: 600; margin-bottom: 16px; color: #2c3e50; }}
  .kalender-container {{ display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 40px; }}
  .monat-block {{ background: #fff; border-radius: 8px; padding: 14px 16px;
                  box-shadow: 0 1px 4px rgba(0,0,0,.08); min-width: 280px; }}
  .monat-block h3 {{ font-size: 13px; font-weight: 600; margin-bottom: 10px;
                     color: #2c3e50; text-transform: uppercase; letter-spacing: .5px; }}
  .kalender-grid {{ display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px; }}
  .wt-header {{ text-align: center; font-size: 10px; color: #95a5a6;
                font-weight: 600; padding: 2px 0; }}
  .tag-zelle {{ border-radius: 4px; padding: 4px 2px; text-align: center;
                cursor: default; position: relative; min-height: 34px;
                display: flex; flex-direction: column; align-items: center;
                justify-content: center; transition: transform .1s; }}
  .tag-zelle:hover {{ transform: scale(1.1); z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,.2); }}
  .tag-zelle.leer {{ background: transparent !important; }}
  .tag-zelle.kritisch {{ box-shadow: inset 0 0 0 2px rgba(0,0,0,.3); }}
  .tag-nr {{ font-size: 11px; font-weight: 600; color: rgba(0,0,0,.6); line-height: 1; }}
  .zustand-badge {{ font-size: 9px; font-weight: 700; color: rgba(0,0,0,.45); }}

  /* Chart */
  .chart-container {{ background: #fff; border-radius: 8px; padding: 20px;
                      box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 40px; }}
  .chart-wrapper {{ max-height: 320px; }}

  /* Tabelle */
  .stats-table {{ width: 100%; border-collapse: collapse; font-size: 13px;
                  background: #fff; border-radius: 8px; overflow: hidden;
                  box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 40px; }}
  .stats-table th, .stats-table td {{ padding: 8px 12px; text-align: center; border-bottom: 1px solid #f0f0f0; }}
  .stats-table th {{ background: #2c3e50; color: #fff; font-weight: 600; font-size: 12px; }}
  .stats-table .monat-label {{ text-align: left; font-weight: 500; white-space: nowrap; }}
  .stats-table td small {{ color: #95a5a6; font-size: 11px; }}
  .stats-table .gesamt-row {{ background: #f8f9fa; border-top: 2px solid #2c3e50; }}
  .stats-table tr:hover {{ background: #f8f9fa; }}

  /* Erklärung */
  .erklaerung {{ background: #fff; border-radius: 8px; padding: 20px 24px;
                 box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 32px; }}
  .erklaerung h3 {{ font-size: 14px; margin-bottom: 12px; }}
  .erklaerung ul {{ list-style: none; }}
  .erklaerung li {{ padding: 6px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; }}
  .erklaerung li:last-child {{ border: none; }}
  .badge {{ display: inline-block; width: 22px; height: 22px; border-radius: 4px;
            text-align: center; line-height: 22px; font-weight: 700; font-size: 12px;
            margin-right: 8px; }}

  @media print {{
    body {{ background: white; }}
    .container {{ max-width: none; padding: 12px; }}
    .chart-container {{ break-inside: avoid; }}
    .monat-block {{ break-inside: avoid; }}
  }}
</style>
</head>
<body>
<div class="container">

<div class="report-header">
  <h1>Betriebszustands-Analyse — Kita Wukaninchen</h1>
  <div class="meta">Jan 2025 – Mai 2026 · {arbeitstage_gesamt} analysierte Arbeitstage · Erstellt {date.today().strftime("%d.%m.%Y")}</div>
</div>

<div class="summary-cards">
  <div class="card green">
    <div class="val">{n_a}</div>
    <div class="lbl">Normalbetrieb (A)</div>
  </div>
  <div class="card">
    <div class="val">{n_b}</div>
    <div class="lbl">Intern kompensiert (B)</div>
  </div>
  <div class="card yellow">
    <div class="val">{n_c}</div>
    <div class="lbl">Externe Kosten / Grauzone (C)</div>
  </div>
  <div class="card orange">
    <div class="val">{n_d}</div>
    <div class="lbl">Eltern gebeten (D)</div>
  </div>
  <div class="card orange">
    <div class="val">{gesamt.get("E", 0)}</div>
    <div class="lbl">Notbetreuung (E)</div>
  </div>
  <div class="card red">
    <div class="val">{gesamt.get("F", 0)}</div>
    <div class="lbl">Vollschließung (F)</div>
  </div>
</div>

<h2>Legende — Zustandsmodell</h2>
<div class="legende">{legende_html}</div>

<h2>Verlauf Jan 2025 – Mai 2026</h2>
<div class="chart-container">
  <div class="chart-wrapper">
    <canvas id="verlaufChart"></canvas>
  </div>
</div>

<h2>Kalender-Übersicht</h2>
<div class="kalender-container">{kalender_html}</div>

<h2>Monatsstatistik</h2>
{stat_tabelle}

<div class="erklaerung">
  <h3>Wie wird klassifiziert?</h3>
  <ul>
    <li><span class="badge" style="background:{ZUSTAND_FARBEN['A']}">A</span><strong>Normalbetrieb:</strong> Alle geplanten Kernteam-Fachkräfte anwesend. Fachkraftschlüssel weit überfüllt.</li>
    <li><span class="badge" style="background:{ZUSTAND_FARBEN['B']}">B</span><strong>Intern kompensiert:</strong> 1–2 Krankmeldungen, aber ≥{FK_KOMFORT_MIN} Fachkräfte anwesend. Keine externen Kosten.</li>
    <li><span class="badge" style="background:{ZUSTAND_FARBEN['C']}">C</span><strong>Kostenintensiv / Grauzone:</strong> Externe Vertretung bezahlt (Anne/Svea/andere), ODER Fachkraft-Zahl auf gesetzlichem Minimum (Überstunden-Risiko).</li>
    <li><span class="badge" style="background:{ZUSTAND_FARBEN['D']}">D</span><strong>Eltern gebeten:</strong> Eltern aktiv gebeten, Kinder zu Hause zu lassen (Bedarf-1/2-System aktiv). Quelle: Signal-Nachrichten.</li>
    <li><span class="badge" style="background:{ZUSTAND_FARBEN['E']};color:#fff">E</span><strong>Notbetreuung:</strong> Formale Notbetreuung — Gruppen zusammengelegt, Kapazitätsgrenzen. Quelle: Signal-Nachrichten.</li>
    <li><span class="badge" style="background:{ZUSTAND_FARBEN['F']};color:#fff">F</span><strong>Vollschließung:</strong> Kita komplett geschlossen. Quelle: Signal-Nachrichten (Catharina, Apr 2026).</li>
    <li><span class="badge" style="background:{ZUSTAND_FARBEN['G']}">G</span><strong>Geplante Schließung:</strong> Betriebsferien, Klausurtage oder Brückentage laut Jahreskalender 2025/26. Kein Operationsbetrieb — zählt nicht zu den Arbeitstagen.</li>
  </ul>
  <p style="margin-top:12px;font-size:12px;color:#7f8c8d">
    Datenbasis: {len(DIENSTPLAN_MONATE)} Dienstplan-ODS-Dateien (alle Monate Jan 2025–Mai 2026),
    Vertretungspool-ODS (Stundenauflistungen 2026 täglich; 2025 nur Monatsübersichten),
    Signal-Chat-Exporte (manuelle Annotationen für D/E/F),
    Jahreskalender 2025/26 (Nextcloud: Schließzeiten + Klausurtage + Brückentag).
    Externer Benchmark: Bertelsmann 2024 (Erzieher Ostdeutschland: 34 Kranktage/Jahr).
  </p>
</div>

</div><!-- /container -->

<script>
const data = {chart_data_json};
const ctx = document.getElementById('verlaufChart').getContext('2d');
new Chart(ctx, {{
  type: 'bar',
  data: data,
  options: {{
    responsive: true,
    maintainAspectRatio: true,
    plugins: {{
      legend: {{ position: 'bottom', labels: {{ boxWidth: 14, font: {{ size: 12 }} }} }},
      tooltip: {{ mode: 'index', intersect: false }},
    }},
    scales: {{
      x: {{ stacked: true, ticks: {{ font: {{ size: 11 }} }} }},
      y: {{ stacked: true, title: {{ display: true, text: 'Arbeitstage' }},
             ticks: {{ font: {{ size: 11 }} }} }},
    }},
  }},
}});
</script>
</body>
</html>"""
    return html


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print('Betriebszustands-Analyse Wukaninchen')
    print('=' * 40)

    # Annotationen laden
    ann_path = os.path.join(SCRIPT_DIR, 'manuelle_annotationen.json')
    annotationen = {}
    if os.path.exists(ann_path):
        with open(ann_path, 'r', encoding='utf-8') as f:
            for entry in json.load(f):
                d = date.fromisoformat(entry['datum'])
                annotationen[d] = {
                    'zustand': entry['zustand'],
                    'kommentar': entry['kommentar'],
                    'spaetbetreuung_ausgefallen': entry.get('spaetbetreuung_ausgefallen', False),
                }
        print(f'  → {len(annotationen)} manuelle Annotationen geladen')

    # Dienstpläne
    print('  Analysiere Dienstpläne...')
    tage_info = analyse_dienstplaene()
    print(f'  → {len(tage_info)} Arbeitstage aus Dienstplänen extrahiert')

    # Vertretungspool 2026
    print('  Analysiere Vertretungspool 2026...')
    pool_2026 = analyse_vertretungspool_2026()
    print(f'  → {sum(len(v) for v in pool_2026.values())} Vertretungs-Einsätze auf Tagesdaten gemappt')

    # Klassifikation
    print('  Klassifiziere alle Tage...')
    tage = klassifiziere_alle(tage_info, annotationen, pool_2026)
    print(f'  → {len(tage)} Tage klassifiziert')

    # Statistiken
    gesamt, pro_monat = berechne_statistiken(tage)

    print()
    print('Zustandsverteilung (Arbeitstage):')
    arbeitstage = sum(v for k, v in gesamt.items() if k != 'W')
    for z in ['A', 'B', 'C', 'D', 'E', 'F', 'G', '?']:
        n = gesamt.get(z, 0)
        pct = f'{100*n/arbeitstage:.1f}%' if arbeitstage > 0 and z not in ('G',) else ''
        print(f'  {z} ({ZUSTAND_NAMEN[z]:<25}): {n:>3} Tage  {pct}')
    print(f'  Operative Arbeitstage (A-F+?): {arbeitstage}')
    print(f'  Geplante Schließtage (G):       {gesamt.get("G", 0)}')

    # JSON Export
    json_out = os.path.join(SCRIPT_DIR, 'betriebszustand_tage.json')
    with open(json_out, 'w', encoding='utf-8') as f:
        json.dump(
            {d.isoformat(): {
                'zustand': v['zustand'],
                'begruendung': v['begruendung'],
                'spaetbetreuung_ausgefallen': v.get('spaetbetreuung_ausgefallen', False),
             } for d, v in tage.items()},
            f, ensure_ascii=False, indent=2
        )
    print(f'\nJSON gespeichert: {json_out}')

    # HTML Report
    html_out = os.path.join(SCRIPT_DIR, 'betriebszustand_report.html')
    html = render_html(tage, gesamt, pro_monat)
    with open(html_out, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'HTML Report gespeichert: {html_out}')
    print()
    print('Zum Öffnen: open betriebszustand_report.html')


if __name__ == '__main__':
    main()
