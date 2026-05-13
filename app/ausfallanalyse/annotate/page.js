'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const FARBEN = {
  D: '#e67e22', E: '#e74c3c', F: '#7b241c',
};
const ZUSTAENDE = [
  { value: '',  label: 'Kein Override (automatisch)' },
  { value: 'D', label: 'D – Eltern gebeten' },
  { value: 'E', label: 'E – Notbetreuung' },
  { value: 'F', label: 'F – Vollschließung' },
];

export default function AnnotatePage() {
  const [list, setList]           = useState([]);
  const [datum, setDatum]         = useState('');
  const [zustand, setZustand]     = useState('');
  const [spaet, setSpaet]         = useState(false);
  const [kommentar, setKommentar] = useState('');
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState('');

  async function loadList() {
    const data = await fetch('/api/ausfallanalyse/annotate').then(r => r.json());
    setList(Array.isArray(data) ? data : []);
  }

  useEffect(() => { loadList(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');

    const res = await fetch('/api/ausfallanalyse/annotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ datum, zustand, spaetbetreuung_ausgefallen: spaet, kommentar }),
    });

    setSaving(false);
    if (res.ok) {
      setMsg('Gespeichert ✓');
      await loadList();
      setDatum(''); setZustand(''); setSpaet(false); setKommentar('');
      setTimeout(() => setMsg(''), 3000);
    } else {
      const err = await res.json();
      setMsg(`Fehler: ${err.error}`);
    }
  }

  function loadIntoForm(a) {
    setDatum(a.datum);
    setZustand(a.zustand || '');
    setSpaet(a.spaetbetreuung_ausgefallen || false);
    setKommentar(a.kommentar || '');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-10 shadow">
        <Link href="/ausfallanalyse" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Zurück
        </Link>
        <div className="font-semibold text-sm">Annotation hinzufügen</div>
      </div>

      <div className="max-w-xl mx-auto p-4 space-y-4">
        {/* Formular */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Datum</label>
              <input
                type="date"
                value={datum}
                onChange={e => setDatum(e.target.value)}
                required
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Betriebszustand</label>
              <select
                value={zustand}
                onChange={e => setZustand(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white"
              >
                {ZUSTAENDE.map(z => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={spaet}
                onChange={e => setSpaet(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500"
              />
              <span className="text-sm text-gray-700 flex items-center gap-1.5">
                Spätbetreuung ausgefallen
                <span style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderBottom: '6px solid #e67e22', display: 'inline-block' }} />
              </span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Kommentar</label>
              <textarea
                value={kommentar}
                onChange={e => setKommentar(e.target.value)}
                placeholder="Signal-Nachricht, Beschreibung…"
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={saving || !datum || (!zustand && !spaet && !kommentar)}
              className="w-full bg-gray-800 text-white py-2.5 rounded-xl font-medium text-sm hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Speichere…' : 'Speichern'}
            </button>

            {msg && (
              <p className={`text-sm text-center ${msg.startsWith('Fehler') ? 'text-red-500' : 'text-green-600'}`}>
                {msg}
              </p>
            )}
          </form>
        </div>

        {/* Bestehende Annotationen */}
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Vorhandene Annotationen ({list.length})
          </div>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {list.length === 0 && (
              <p className="text-sm text-gray-400">Noch keine Annotationen</p>
            )}
            {[...list].reverse().map(a => (
              <button
                key={a.datum}
                onClick={() => loadIntoForm(a)}
                className="w-full flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 text-left transition-colors"
              >
                <span className="text-xs font-mono text-gray-400 whitespace-nowrap pt-0.5 w-24 shrink-0">
                  {a.datum}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {a.zustand && (
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ background: FARBEN[a.zustand] || '#ccc', color: '#fff' }}
                      >
                        {a.zustand}
                      </span>
                    )}
                    {a.spaetbetreuung_ausgefallen && (
                      <span className="text-xs text-orange-500 font-medium">▲ Spätbetreuung</span>
                    )}
                  </div>
                  {a.kommentar && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{a.kommentar}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center px-4">
          Tipp: Klick auf einen Eintrag lädt ihn ins Formular zum Bearbeiten.
          Nach dem Speichern wird die Analyse beim nächsten Öffnen sofort aktualisiert.
          A/B/C-Klassifikation folgt beim nächsten GitHub-Action-Lauf.
        </p>
      </div>
    </div>
  );
}
