'use client';

import { useState, useEffect } from 'react';

// Status-Optionen für Abwesenheit (separate vom numerischen Stepper)
const STATUS_OPTIONEN = [
  { value: "K", label: "Krank", color: "bg-red-100 text-red-700 border-red-300" },
  { value: "U", label: "Urlaub", color: "bg-purple-100 text-purple-700 border-purple-300" },
  { value: "KK", label: "Kind krank", color: "bg-pink-100 text-pink-700 border-pink-300" },
  { value: "F", label: "Fortbildung", color: "bg-teal-100 text-teal-700 border-teal-300" },
];

// Bereich-Mapping für Anzeige
const BEREICH_DISPLAY = {
  'Ü3': 'Wald',
  'Nest': 'Nest'
};

// Stepper Konfiguration
const STEPPER_MIN = -3;
const STEPPER_MAX = 3;
const STEPPER_STEP = 0.25; // 15 Minuten

// Format Stundenzahl für Anzeige
function formatStunden(value) {
  if (value === 0) return "Wie geplant";
  const sign = value > 0 ? "+" : "";
  const hours = Math.floor(Math.abs(value));
  const mins = Math.round((Math.abs(value) - hours) * 60);
  if (hours === 0) return `${sign}${mins} min`;
  if (mins === 0) return `${sign}${hours} Std`;
  return `${sign}${hours}:${String(mins).padStart(2, '0')} Std`;
}

// Pausenabzug berechnen
// Erwachsene: Ab mehr als 6 Stunden = 0.5 Std Pause
// Minderjährige: Ab mehr als 4.5 Stunden = 0.5 Std Pause (Jugendarbeitsschutzgesetz)
function berechnePausenabzug(istStunden, isMinor = false) {
  const grenze = isMinor ? 4.5 : 6;
  return istStunden > grenze ? 0.5 : 0;
}

export default function Home() {
  const [ansicht, setAnsicht] = useState('login');
  const [currentUser, setCurrentUser] = useState(null);
  const [dienstplan, setDienstplan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [eintraege, setEintraege] = useState({});
  const [savedEintraege, setSavedEintraege] = useState({});
  const [approvals, setApprovals] = useState({});
  const [submissions, setSubmissions] = useState({});
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [selectedMitarbeiter, setSelectedMitarbeiter] = useState(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  // PIN Authentication State
  const [pendingUser, setPendingUser] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinResetLoading, setPinResetLoading] = useState(false);
  const [pinResetSent, setPinResetSent] = useState(false);

  // Zusatzzeiten (Prep/Office time)
  const [zusatzzeiten, setZusatzzeiten] = useState({});
  const [savedZusatzzeiten, setSavedZusatzzeiten] = useState({});

  // Admin dashboard state
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminError, setAdminError] = useState(null);

  // Lade Dienstplan und gespeicherte Einträge beim Start
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Parallel laden: Dienstplan und gespeicherte Einträge
      const [dienstplanRes, eintraegeRes] = await Promise.all([
        fetch('/api/dienstplan'),
        fetch('/api/eintraege')
      ]);

      if (!dienstplanRes.ok) throw new Error('Fehler beim Laden des Dienstplans');

      const dienstplanData = await dienstplanRes.json();
      setDienstplan(dienstplanData);

      if (eintraegeRes.ok) {
        const eintraegeData = await eintraegeRes.json();
        // Gespeicherte Einträge in lokales Format konvertieren
        const localEintraege = {};
        Object.entries(eintraegeData.eintraege || {}).forEach(([key, data]) => {
          localEintraege[key] = data.value;
        });
        setSavedEintraege(localEintraege);
        setEintraege(localEintraege);
        setApprovals(eintraegeData.approvals || {});
        setSubmissions(eintraegeData.submissions || {});
        // Load zusatzzeiten
        setZusatzzeiten(eintraegeData.zusatzzeiten || {});
        setSavedZusatzzeiten(eintraegeData.zusatzzeiten || {});
      }

      setError(null);
    } catch (err) {
      setError('Daten konnten nicht geladen werden');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // === LOADING ===
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-100 via-white to-emerald-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🐰</div>
          <p className="text-gray-500">Lade Dienstplan...</p>
        </div>
      </div>
    );
  }

  // === ERROR ===
  if (error && !dienstplan) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-100 via-white to-emerald-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-center">
          <div className="text-5xl mb-4">😕</div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">Verbindungsproblem</h2>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  // === LOGIN SCREEN ===
  if (ansicht === 'login') {
    // Calculate previous month for status display
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonatKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    const prevMonthName = prevMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

    // Check if any user has status for previous month (to decide whether to show legend)
    const hasAnyStatus = dienstplan?.mitarbeiter?.some((ma) => {
      const submissionKey = `${ma.name}-${prevMonatKey}`;
      return submissions[submissionKey] || approvals[submissionKey];
    });

    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-100 via-white to-emerald-50 p-4">
        <div className="max-w-sm mx-auto pt-8">
          <div className="text-center mb-6">
            <div className="text-6xl mb-2">🐰</div>
            <h1 className="text-2xl font-bold text-gray-800">Wukaninchen</h1>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl shadow-xl p-5">
            <div className="grid grid-cols-2 gap-2.5">
              {dienstplan?.mitarbeiter?.map((ma) => {
                const submissionKey = `${ma.name}-${prevMonatKey}`;
                const submission = submissions[submissionKey];
                const approval = approvals[submissionKey];

                let statusBadge = null;
                if (approval?.status === 'genehmigt') {
                  statusBadge = <span className="text-xs text-green-600 font-bold">✓</span>;
                } else if (submission?.status === 'eingereicht') {
                  statusBadge = <span className="text-xs text-amber-500 font-bold">◐</span>;
                }

                return (
                  <button
                    key={ma.name}
                    onClick={() => {
                      setPendingUser(ma);
                      setPinInput('');
                      setPinError(false);
                      setAnsicht('pin');
                    }}
                    className="p-3 bg-gradient-to-br from-sky-50 to-blue-50 hover:from-sky-100 hover:to-blue-100 rounded-xl text-center transition-all active:scale-95 border border-sky-100 relative"
                  >
                    {statusBadge && (
                      <span className="absolute top-2 right-2">{statusBadge}</span>
                    )}
                    <div className="text-xl mb-0.5">👤</div>
                    <div className="font-semibold text-gray-800 text-sm">{ma.name}</div>
                    <div className="text-xs text-gray-400">{BEREICH_DISPLAY[ma.bereich] || ma.bereich}</div>
                  </button>
                );
              })}
            </div>

            {/* Legend for status indicators */}
            {hasAnyStatus && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500 text-center mb-2">{prevMonthName}:</p>
                <div className="flex justify-center gap-4 text-xs text-gray-500">
                  <span><span className="text-green-600 font-bold">✓</span> Genehmigt</span>
                  <span><span className="text-amber-500 font-bold">◐</span> Eingereicht</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === PIN ENTRY SCREEN ===
  if (ansicht === 'pin' && pendingUser) {
    const validatePin = (enteredPin) => {
      // Check if PIN matches user's PIN
      return enteredPin === pendingUser.pin;
    };

    const handlePinDigit = (digit) => {
      if (pinInput.length < 4) {
        const newPin = pinInput + digit;
        setPinInput(newPin);
        setPinError(false);

        // Auto-submit when 4 digits entered
        if (newPin.length === 4) {
          setTimeout(() => {
            const isValid = validatePin(newPin);
            if (isValid) {
              setCurrentUser(pendingUser);
              setPendingUser(null);
              setPinInput('');
              setPinResetSent(false);
              setAnsicht('erfassung');
            } else {
              setPinError(true);
              setPinInput('');
            }
          }, 100);
        }
      }
    };

    const handlePinBackspace = () => {
      setPinInput(prev => prev.slice(0, -1));
      setPinError(false);
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-100 via-white to-emerald-50 p-4">
        <div className="max-w-sm mx-auto pt-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">👤</div>
            <h1 className="text-xl font-bold text-gray-800">Hallo {pendingUser.name}!</h1>
            <p className="text-gray-500 text-sm mt-1">Bitte PIN eingeben</p>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl shadow-xl p-5">
            {/* PIN Display */}
            <div className="flex justify-center gap-3 mb-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold ${
                    pinError
                      ? 'border-red-300 bg-red-50'
                      : pinInput[i]
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  {pinInput[i] ? '●' : ''}
                </div>
              ))}
            </div>

            {pinError && (
              <p className="text-red-500 text-sm text-center mb-4">
                Falsche PIN. Bitte erneut versuchen.
              </p>
            )}

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handlePinDigit(String(digit))}
                  className="p-4 text-xl font-semibold bg-gray-100 hover:bg-gray-200 rounded-xl transition-all active:scale-95"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={handlePinBackspace}
                className="p-4 text-xl bg-gray-100 hover:bg-gray-200 rounded-xl transition-all active:scale-95"
              >
                ←
              </button>
              <button
                onClick={() => handlePinDigit('0')}
                className="p-4 text-xl font-semibold bg-gray-100 hover:bg-gray-200 rounded-xl transition-all active:scale-95"
              >
                0
              </button>
              <div className="p-4"></div>
            </div>

            {/* Back Button */}
            <button
              onClick={() => {
                setPendingUser(null);
                setPinInput('');
                setPinError(false);
                setPinResetSent(false);
                setAnsicht('login');
              }}
              className="w-full mt-4 p-3 text-gray-500 hover:text-gray-700 text-sm transition-all"
            >
              ← Zurück zur Auswahl
            </button>

            {/* PIN Reset - nur für Leitung */}
            {pendingUser.role === 'leitung' && (
              <div className="mt-2 text-center">
                {pinResetSent ? (
                  <p className="text-sm text-green-600">
                    Neue PIN wurde per E-Mail gesendet!
                  </p>
                ) : (
                  <button
                    onClick={async () => {
                      if (pinResetLoading) return;
                      setPinResetLoading(true);
                      try {
                        const response = await fetch('/api/reset-pin', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: pendingUser.name })
                        });
                        const result = await response.json();
                        if (result.success) {
                          setPinResetSent(true);
                          // If in dev mode without email, show PIN directly
                          if (result.pin) {
                            alert(`Neue PIN: ${result.pin}\n\n(E-Mail-Versand nicht konfiguriert)`);
                          }
                        } else {
                          alert(result.error || 'Fehler beim PIN-Reset');
                        }
                      } catch (error) {
                        console.error('PIN reset error:', error);
                        alert('Fehler beim PIN-Reset');
                      } finally {
                        setPinResetLoading(false);
                      }
                    }}
                    disabled={pinResetLoading}
                    className="text-sm text-blue-500 hover:text-blue-700 disabled:text-gray-400"
                  >
                    {pinResetLoading ? 'Sende...' : 'PIN vergessen?'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === ERFASSUNGS-SCREEN ===
  if (ansicht === 'erfassung' && currentUser) {
    const wochen = dienstplan?.wochen || [];
    const aktuelleWoche = wochen[selectedWeek];
    const maTage = aktuelleWoche?.tage?.[currentUser.name] || [];

    const handleAbweichung = (tagIndex, value) => {
      const key = `${currentUser.name}-${selectedWeek}-${tagIndex}`;
      setEintraege(prev => ({ ...prev, [key]: value }));
    };

    const clearEintrag = (tagIndex) => {
      const key = `${currentUser.name}-${selectedWeek}-${tagIndex}`;
      setEintraege(prev => {
        const newEintraege = { ...prev };
        delete newEintraege[key];
        return newEintraege;
      });
    };

    const getEintrag = (tagIndex) => {
      return eintraege[`${currentUser.name}-${selectedWeek}-${tagIndex}`];
    };

    const berechneWochensumme = () => {
      let sollSumme = 0;
      let istSumme = 0;
      let pausenAbzug = 0;

      maTage.forEach((tag, idx) => {
        if (tag.sollStd > 0) {
          sollSumme += tag.sollStd;
          const eintrag = getEintrag(idx);

          // Prüfe ob Tag schon im Dienstplan als abwesend markiert ist
          const istDienstplanAbwesend = ["K", "U", "KK", "F", "S", "KS"].includes(tag.status);

          if (istDienstplanAbwesend) {
            // Bei Abwesenheit lt. Dienstplan: Soll-Stunden = Ist-Stunden, keine Pause
            istSumme += tag.sollStd;
          } else if (["K", "U", "KK", "F"].includes(eintrag)) {
            // Bei manuell eingetragener Abwesenheit: Soll-Stunden zählen, keine Pause
            istSumme += tag.sollStd;
          } else {
            // Normaler Arbeitstag: Abweichung und Pause berechnen
            let tagesStd = tag.sollStd;
            if (eintrag && eintrag !== "0") {
              tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
            }
            const pause = berechnePausenabzug(tagesStd, currentUser.isMinor);
            pausenAbzug += pause;
            istSumme += tagesStd - pause;
          }
        }
      });

      return { sollSumme, istSumme, pausenAbzug };
    };

    const hasUnsavedChanges = () => {
      // Prüfen ob es ungespeicherte Änderungen bei Einträgen gibt
      for (const key of Object.keys(eintraege)) {
        if (key.startsWith(currentUser.name + '-')) {
          if (eintraege[key] !== savedEintraege[key]) {
            return true;
          }
        }
      }
      // Prüfen ob es ungespeicherte Änderungen bei Zusatzzeiten gibt
      const now = new Date();
      const monatKey = `${currentUser.name}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const currentZusatz = zusatzzeiten[monatKey];
      const savedZusatz = savedZusatzzeiten[monatKey];
      if (JSON.stringify(currentZusatz) !== JSON.stringify(savedZusatz)) {
        return true;
      }
      return false;
    };

    const speichern = async () => {
      try {
        setSaving(true);
        setSaveError(null);

        // Nur Einträge für aktuellen Mitarbeiter sammeln
        const mitarbeiterEintraege = {};
        Object.keys(eintraege).forEach(key => {
          if (key.startsWith(currentUser.name + '-')) {
            mitarbeiterEintraege[key] = eintraege[key];
          }
        });

        // Zusatzzeiten für aktuellen Mitarbeiter sammeln
        const mitarbeiterZusatzzeiten = {};
        const now = new Date();
        const monatKey = `${currentUser.name}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        if (zusatzzeiten[monatKey]) {
          mitarbeiterZusatzzeiten[monatKey] = zusatzzeiten[monatKey];
        }

        const response = await fetch('/api/eintraege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mitarbeiter: currentUser.name,
            eintraege: mitarbeiterEintraege,
            zusatzzeiten: mitarbeiterZusatzzeiten
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Speichern fehlgeschlagen');
        }

        // Gespeicherte Einträge aktualisieren
        setSavedEintraege(prev => ({ ...prev, ...mitarbeiterEintraege }));
        setSavedZusatzzeiten(prev => ({ ...prev, ...mitarbeiterZusatzzeiten }));

        // Submission-Status aktualisieren
        setSubmissions(prev => ({
          ...prev,
          [`${currentUser.name}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`]: {
            status: 'eingereicht',
            timestamp: new Date().toISOString()
          }
        }));

        setShowSaveConfirm(true);
        setTimeout(() => setShowSaveConfirm(false), 2000);

      } catch (error) {
        console.error('Fehler beim Speichern:', error);
        setSaveError(error.message);
        setTimeout(() => setSaveError(null), 3000);
      } finally {
        setSaving(false);
      }
    };

    const { sollSumme, istSumme, pausenAbzug } = berechneWochensumme();

    return (
      <div className="min-h-screen bg-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white p-4 sticky top-0 z-20 shadow-lg">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            <button
              onClick={() => {
                if (hasUnsavedChanges()) {
                  if (confirm('Du hast ungespeicherte Änderungen. Wirklich zurück?')) {
                    setAnsicht('login');
                  }
                } else {
                  setAnsicht('login');
                }
              }}
              className="p-2 -ml-2 hover:bg-white/20 rounded-lg transition-all text-lg"
            >
              ←
            </button>
            <div className="text-center">
              <div className="font-bold text-lg">{currentUser.name}</div>
              <div className="text-xs text-blue-100">
                {aktuelleWoche?.name || 'Woche'} • {aktuelleWoche?.zeitraum || ''}
              </div>
            </div>
            <div className="flex gap-1">
              {currentUser.role === 'leitung' && (
                <>
                  <button
                    onClick={() => setAnsicht('uebersicht')}
                    className="p-2 hover:bg-white/20 rounded-lg transition-all text-sm"
                    title="Übersicht"
                  >
                    📊
                  </button>
                  <button
                    onClick={() => setAnsicht('admin')}
                    className="p-2 hover:bg-white/20 rounded-lg transition-all text-sm"
                    title="Admin"
                  >
                    ⚙️
                  </button>
                </>
              )}
              {currentUser.role !== 'leitung' && <div className="w-8"></div>}
            </div>
          </div>
        </div>

        {/* Wochen-Auswahl */}
        <div className="bg-white border-b sticky top-16 z-10">
          <div className="flex overflow-x-auto max-w-lg mx-auto">
            {wochen.map((w, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedWeek(idx)}
                className={`flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-all ${
                  selectedWeek === idx
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {w.name}
              </button>
            ))}
          </div>
        </div>

        {/* Zusatzzeiten (Prep/Office Time) */}
        {currentUser.canTrackPrepTime && (() => {
          const now = new Date();
          const monatKey = `${currentUser.name}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

          // Get current values from state
          const currentZusatz = zusatzzeiten[monatKey] || {};
          const vorbereitungTotal = (currentZusatz.vorbereitung || []).reduce((sum, e) => sum + e.stunden, 0);
          const buerozeitTotal = (currentZusatz.buerozeit || []).reduce((sum, e) => sum + e.stunden, 0);

          const handleZusatzChange = (type, delta) => {
            const today = new Date().toISOString().split('T')[0];
            setZusatzzeiten(prev => {
              const current = prev[monatKey] || {};
              const entries = current[type] || [];

              // Find existing entry for today
              const todayIdx = entries.findIndex(e => e.datum === today);
              let newEntries;

              if (todayIdx >= 0) {
                // Update existing entry
                const newValue = Math.max(0, entries[todayIdx].stunden + delta);
                if (newValue === 0) {
                  // Remove entry if 0
                  newEntries = entries.filter((_, i) => i !== todayIdx);
                } else {
                  newEntries = entries.map((e, i) =>
                    i === todayIdx ? { ...e, stunden: newValue, timestamp: new Date().toISOString() } : e
                  );
                }
              } else if (delta > 0) {
                // Add new entry
                newEntries = [...entries, { stunden: delta, datum: today, timestamp: new Date().toISOString() }];
              } else {
                newEntries = entries;
              }

              return {
                ...prev,
                [monatKey]: {
                  ...current,
                  [type]: newEntries
                }
              };
            });
          };

          return (
            <div className="bg-white border-b p-3 max-w-lg mx-auto">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Zusatzzeiten diesen Monat
              </div>

              {/* Vor-/Nachbereitung */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium text-gray-700">Vor-/Nachbereitung</div>
                  <div className="text-xs text-gray-400">Gesamt: {vorbereitungTotal.toFixed(2)} Std</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleZusatzChange('vorbereitung', -STEPPER_STEP)}
                    className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-lg font-bold text-gray-600 transition-all active:scale-95"
                  >
                    −
                  </button>
                  <div className="min-w-[70px] h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-sm font-semibold text-emerald-700">
                    {vorbereitungTotal.toFixed(2)}
                  </div>
                  <button
                    onClick={() => handleZusatzChange('vorbereitung', STEPPER_STEP)}
                    className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-lg font-bold text-gray-600 transition-all active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Bürozeit - nur für Leitung */}
              {currentUser.role === 'leitung' && (
                <div className="flex items-center justify-between py-2 border-t border-gray-100">
                  <div>
                    <div className="text-sm font-medium text-gray-700">Bürozeit / Leitungszeit</div>
                    <div className="text-xs text-gray-400">Gesamt: {buerozeitTotal.toFixed(2)} Std</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleZusatzChange('buerozeit', -STEPPER_STEP)}
                      className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-lg font-bold text-gray-600 transition-all active:scale-95"
                    >
                      −
                    </button>
                    <div className="min-w-[70px] h-10 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-sm font-semibold text-purple-700">
                      {buerozeitTotal.toFixed(2)}
                    </div>
                    <button
                      onClick={() => handleZusatzChange('buerozeit', STEPPER_STEP)}
                      className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 text-lg font-bold text-gray-600 transition-all active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Tages-Liste */}
        <div className="p-3 max-w-lg mx-auto space-y-2.5 pb-36">
          {maTage.map((tag, idx) => {
            const eintrag = getEintrag(idx);
            const istAbwesend = ["K", "U", "KK", "KS", "F", "S"].includes(tag.status);
            const keinDienst = !tag.sollStd || tag.sollStd === 0;

            // Berechne Ist-Stunden für diesen Tag
            let tagesIst = tag.sollStd || 0;
            if (eintrag && eintrag !== "0" && !["K", "U", "KK", "KS", "F", "S"].includes(eintrag)) {
              tagesIst = tag.sollStd + (parseFloat(eintrag) || 0);
            }
            const tagesPause = berechnePausenabzug(tagesIst, currentUser.isMinor);

            return (
              <div
                key={idx}
                className={`bg-white rounded-xl shadow-sm overflow-hidden ${
                  istAbwesend || keinDienst ? 'opacity-70' : ''
                }`}
              >
                <div className="p-3 border-b border-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-gray-800">{tag.tag}</span>
                      {tag.datum && <span className="text-gray-600 ml-1.5">{tag.datum}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {eintrag && eintrag !== "0" && (
                        <>
                          <button
                            onClick={() => clearEintrag(idx)}
                            className="text-gray-400 hover:text-gray-600 text-xs px-1"
                            title="Zurücksetzen"
                          >
                            ✕
                          </button>
                          {(() => {
                            const statusOption = STATUS_OPTIONEN.find(o => o.value === eintrag);
                            if (statusOption) {
                              return (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusOption.color}`}>
                                  {statusOption.label}
                                </span>
                              );
                            }
                            // Numeric deviation
                            const numValue = parseFloat(eintrag);
                            return (
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                numValue > 0 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                              }`}>
                                {formatStunden(numValue)}
                              </span>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  </div>

                  {istAbwesend ? (
                    <div className={`text-sm mt-1 ${tag.status === "K" ? "text-red-500" : tag.status === "F" || tag.status === "S" ? "text-teal-600" : "text-purple-500"}`}>
                      {tag.status === "K" ? "Krank (lt. Dienstplan)" :
                       tag.status === "U" ? "Urlaub (lt. Dienstplan)" :
                       tag.status === "F" ? "Fortbildung (lt. Dienstplan)" :
                       tag.status === "S" ? "Seminar (lt. Dienstplan)" : "Abwesend"}
                    </div>
                  ) : keinDienst ? (
                    <div className="text-sm text-gray-400 mt-1">— Kein Dienst geplant</div>
                  ) : (
                    <div className="text-sm text-gray-500 mt-1 flex items-center justify-between">
                      <span>
                        {tag.von} – {tag.bis} <span className="text-gray-400">({tag.sollStd} Std)</span>
                      </span>
                      {tagesPause > 0 && (
                        <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          -{tagesPause} Pause
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {!istAbwesend && !keinDienst && (
                  <div className="p-2.5 bg-gray-50 space-y-2">
                    {/* Stepper für Zeitabweichung */}
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => {
                          const currentValue = typeof eintrag === 'string' && !STATUS_OPTIONEN.find(o => o.value === eintrag)
                            ? parseFloat(eintrag) || 0
                            : 0;
                          const newValue = Math.max(STEPPER_MIN, currentValue - STEPPER_STEP);
                          handleAbweichung(idx, newValue.toString());
                        }}
                        className="w-12 h-12 rounded-xl bg-white border-2 border-gray-200 hover:border-gray-300 text-xl font-bold text-gray-600 transition-all active:scale-95 flex items-center justify-center"
                      >
                        −
                      </button>
                      <div
                        className={`min-w-[120px] h-12 rounded-xl border-2 flex items-center justify-center font-semibold text-sm ${
                          !eintrag || eintrag === "0" || STATUS_OPTIONEN.find(o => o.value === eintrag)
                            ? 'bg-gray-100 border-gray-200 text-gray-500'
                            : parseFloat(eintrag) > 0
                            ? 'bg-green-50 border-green-300 text-green-700'
                            : 'bg-orange-50 border-orange-300 text-orange-700'
                        }`}
                      >
                        {(() => {
                          if (!eintrag || STATUS_OPTIONEN.find(o => o.value === eintrag)) {
                            return 'Wie geplant';
                          }
                          return formatStunden(parseFloat(eintrag) || 0);
                        })()}
                      </div>
                      <button
                        onClick={() => {
                          const currentValue = typeof eintrag === 'string' && !STATUS_OPTIONEN.find(o => o.value === eintrag)
                            ? parseFloat(eintrag) || 0
                            : 0;
                          const newValue = Math.min(STEPPER_MAX, currentValue + STEPPER_STEP);
                          handleAbweichung(idx, newValue.toString());
                        }}
                        className="w-12 h-12 rounded-xl bg-white border-2 border-gray-200 hover:border-gray-300 text-xl font-bold text-gray-600 transition-all active:scale-95 flex items-center justify-center"
                      >
                        +
                      </button>
                    </div>

                    {/* Status-Buttons */}
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {STATUS_OPTIONEN.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => handleAbweichung(idx, option.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                            eintrag === option.value
                              ? option.color + ' ring-2 ring-offset-1 ring-blue-400'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-20">
          <div className="max-w-lg mx-auto p-3">
            {/* Stundenübersicht */}
            <div className="flex items-center justify-between mb-3 text-sm">
              <div>
                <span className="text-gray-500">Soll:</span>
                <span className="font-medium text-gray-700 ml-1">{sollSumme.toFixed(1)} Std</span>
              </div>
              {pausenAbzug > 0 && (
                <div className="text-amber-600 text-xs">
                  inkl. {pausenAbzug.toFixed(1)} Std Pause
                </div>
              )}
              <div>
                <span className="text-gray-500">Ist:</span>
                <span className="font-bold text-gray-800 ml-1">{istSumme.toFixed(1)} Std</span>
              </div>
            </div>

            {/* Speichern-Button */}
            <div className="flex items-center gap-3">
              <button
                onClick={speichern}
                disabled={saving}
                className={`flex-1 py-3 rounded-xl font-semibold text-white transition-all ${
                  showSaveConfirm
                    ? 'bg-green-500'
                    : saveError
                    ? 'bg-red-500'
                    : saving
                    ? 'bg-gray-400'
                    : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                }`}
              >
                {showSaveConfirm ? '✓ Gespeichert!' : saveError ? saveError : saving ? 'Speichern...' : 'Speichern'}
              </button>
            </div>

            {hasUnsavedChanges() && !showSaveConfirm && (
              <p className="text-xs text-amber-600 text-center mt-2">
                Ungespeicherte Änderungen
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // === ÜBERSICHT (Leitung) ===
  if (ansicht === 'uebersicht') {
    const wochen = dienstplan?.wochen || [];
    const now = new Date();
    const monatKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const handleApproval = async (mitarbeiter, status) => {
      try {
        const response = await fetch('/api/eintraege', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mitarbeiter: mitarbeiter,
            monat: monatKey,
            status: status
          })
        });

        if (response.ok) {
          setApprovals(prev => ({
            ...prev,
            [`${mitarbeiter}-${monatKey}`]: {
              status: status,
              timestamp: new Date().toISOString()
            }
          }));
          setShowApprovalModal(false);
          setSelectedMitarbeiter(null);
        }
      } catch (error) {
        console.error('Fehler bei Genehmigung:', error);
      }
    };

    const getStatus = (maName) => {
      const approvalKey = `${maName}-${monatKey}`;
      const submissionKey = `${maName}-${monatKey}`;

      if (approvals[approvalKey]?.status === 'genehmigt') {
        return { text: 'Genehmigt', color: 'bg-green-100 text-green-700' };
      }
      if (approvals[approvalKey]?.status === 'abgelehnt') {
        return { text: 'Abgelehnt', color: 'bg-red-100 text-red-700' };
      }
      if (submissions[submissionKey]?.status === 'eingereicht') {
        return { text: 'Eingereicht', color: 'bg-blue-100 text-blue-700' };
      }
      return { text: 'Offen', color: 'bg-gray-100 text-gray-500' };
    };

    const berechneMitarbeiterStunden = (maName) => {
      let sollGesamt = 0;
      let istGesamt = 0;

      // Get employee's isMinor flag from dienstplan
      const maData = dienstplan?.mitarbeiter?.find(m => m.name === maName);
      const isMinor = maData?.isMinor || false;

      wochen.forEach((woche, wochenIdx) => {
        const maTage = woche.tage?.[maName] || [];
        maTage.forEach((tag, tagIdx) => {
          if (tag.sollStd > 0) {
            sollGesamt += tag.sollStd;
            const key = `${maName}-${wochenIdx}-${tagIdx}`;
            const eintrag = eintraege[key];

            // Prüfe ob Tag schon im Dienstplan als abwesend markiert ist
            const istDienstplanAbwesend = ["K", "U", "KK", "F", "S", "KS"].includes(tag.status);

            if (istDienstplanAbwesend) {
              // Bei Abwesenheit lt. Dienstplan: Soll-Stunden = Ist-Stunden, keine Pause
              istGesamt += tag.sollStd;
            } else if (["K", "U", "KK", "F"].includes(eintrag)) {
              // Bei manuell eingetragener Abwesenheit: Soll-Stunden zählen, keine Pause
              istGesamt += tag.sollStd;
            } else {
              // Normaler Arbeitstag: Abweichung und Pause berechnen
              let tagesStd = tag.sollStd;
              if (eintrag && eintrag !== "0") {
                tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
              }
              const pause = berechnePausenabzug(tagesStd, isMinor);
              istGesamt += tagesStd - pause;
            }
          }
        });
      });

      // Zusatzzeiten berechnen
      const zusatzKey = `${maName}-${monatKey}`;
      const maZusatz = zusatzzeiten[zusatzKey] || {};
      const vorbereitungTotal = (maZusatz.vorbereitung || []).reduce((sum, e) => sum + e.stunden, 0);
      const buerozeitTotal = (maZusatz.buerozeit || []).reduce((sum, e) => sum + e.stunden, 0);
      const zusatzTotal = vorbereitungTotal + buerozeitTotal;

      return { sollGesamt, istGesamt, vorbereitungTotal, buerozeitTotal, zusatzTotal };
    };

    return (
      <div className="min-h-screen bg-gray-100">
        <div className="bg-gradient-to-r from-gray-700 to-gray-600 text-white p-4 sticky top-0 z-20">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <button
              onClick={() => setAnsicht('erfassung')}
              className="p-2 -ml-2 hover:bg-white/20 rounded-lg transition-all text-lg"
            >
              ←
            </button>
            <div className="text-center">
              <div className="font-bold">Übersicht</div>
              <div className="text-xs text-gray-300">{dienstplan?.monat} {dienstplan?.jahr}</div>
            </div>
            <button
              onClick={loadData}
              className="p-2 hover:bg-white/20 rounded-lg transition-all text-sm"
            >
              ↻
            </button>
          </div>
        </div>

        {/* Monatsübersicht */}
        <div className="p-3 max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
            <div className="bg-gray-50 p-3 font-semibold text-gray-700 border-b">
              Monatsübersicht
            </div>
            <div className="divide-y">
              {dienstplan?.mitarbeiter?.map((ma) => {
                const status = getStatus(ma.name);
                const { sollGesamt, istGesamt, vorbereitungTotal, buerozeitTotal, zusatzTotal } = berechneMitarbeiterStunden(ma.name);
                const hasSubmission = submissions[`${ma.name}-${monatKey}`];
                const gesamtMitZusatz = istGesamt + zusatzTotal;

                return (
                  <div
                    key={ma.name}
                    className={`p-3 ${hasSubmission ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    onClick={() => {
                      if (hasSubmission) {
                        setSelectedMitarbeiter(ma);
                        setShowApprovalModal(true);
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-800">{ma.name}</div>
                        <div className="text-xs text-gray-400">{BEREICH_DISPLAY[ma.bereich] || ma.bereich}</div>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        <div>
                          <div className="font-semibold text-gray-700">
                            {gesamtMitZusatz.toFixed(1)} / {sollGesamt.toFixed(1)} Std
                          </div>
                          <div className={`text-xs px-2 py-0.5 rounded ${status.color}`}>
                            {status.text}
                          </div>
                        </div>
                        {hasSubmission && (
                          <span className="text-gray-400">›</span>
                        )}
                      </div>
                    </div>
                    {/* Zusatzzeiten Details */}
                    {zusatzTotal > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
                        <div className="flex justify-between">
                          <span>Arbeitszeit (ohne Zusatz):</span>
                          <span>{istGesamt.toFixed(1)} Std</span>
                        </div>
                        {vorbereitungTotal > 0 && (
                          <div className="flex justify-between text-emerald-600">
                            <span>+ Vor-/Nachbereitung:</span>
                            <span>{vorbereitungTotal.toFixed(2)} Std</span>
                          </div>
                        )}
                        {buerozeitTotal > 0 && (
                          <div className="flex justify-between text-purple-600">
                            <span>+ Bürozeit:</span>
                            <span>{buerozeitTotal.toFixed(2)} Std</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Wochendetails */}
          {wochen.map((woche, wochenIdx) => (
            <div key={wochenIdx} className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
              <div className="bg-gray-50 p-3 font-semibold text-gray-700 border-b flex justify-between">
                <span>{woche.name}</span>
                <span className="text-gray-400 font-normal text-sm">{woche.zeitraum}</span>
              </div>
              <div className="divide-y">
                {dienstplan?.mitarbeiter?.map((ma) => {
                  const maTage = woche.tage?.[ma.name] || [];
                  let wochenSoll = 0;
                  let wochenIst = 0;

                  maTage.forEach((tag, tagIdx) => {
                    if (tag.sollStd > 0) {
                      wochenSoll += tag.sollStd;
                      const key = `${ma.name}-${wochenIdx}-${tagIdx}`;
                      const eintrag = eintraege[key];

                      // Prüfe ob Tag schon im Dienstplan als abwesend markiert ist
                      const istDienstplanAbwesend = ["K", "U", "KK", "F", "S", "KS"].includes(tag.status);

                      if (istDienstplanAbwesend) {
                        // Bei Abwesenheit lt. Dienstplan: Soll-Stunden = Ist-Stunden, keine Pause
                        wochenIst += tag.sollStd;
                      } else if (["K", "U", "KK", "F"].includes(eintrag)) {
                        // Bei manuell eingetragener Abwesenheit: Soll-Stunden zählen, keine Pause
                        wochenIst += tag.sollStd;
                      } else {
                        // Normaler Arbeitstag: Abweichung und Pause berechnen
                        let tagesStd = tag.sollStd;
                        if (eintrag && eintrag !== "0") {
                          tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
                        }
                        const pause = berechnePausenabzug(tagesStd, ma.isMinor);
                        wochenIst += tagesStd - pause;
                      }
                    }
                  });

                  return (
                    <div key={ma.name} className="flex items-center justify-between p-3">
                      <div>
                        <div className="font-medium text-gray-800">{ma.name}</div>
                        <div className="text-xs text-gray-400">{BEREICH_DISPLAY[ma.bereich] || ma.bereich}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-gray-700">
                          {wochenIst.toFixed(1)} Std
                        </div>
                        <div className="text-xs text-gray-400">
                          Soll: {wochenSoll.toFixed(1)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Approval Modal */}
        {showApprovalModal && selectedMitarbeiter && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-sm w-full p-5">
              <h3 className="font-bold text-lg mb-4">
                {selectedMitarbeiter.name} - {dienstplan?.monat}
              </h3>

              <div className="space-y-3 mb-5">
                <button
                  onClick={() => handleApproval(selectedMitarbeiter.name, 'genehmigt')}
                  className="w-full p-3 bg-green-100 hover:bg-green-200 text-green-700 rounded-xl font-medium transition-all"
                >
                  ✓ Genehmigen
                </button>
                <button
                  onClick={() => handleApproval(selectedMitarbeiter.name, 'abgelehnt')}
                  className="w-full p-3 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl font-medium transition-all"
                >
                  ✕ Ablehnen
                </button>
              </div>

              <button
                onClick={() => {
                  setShowApprovalModal(false);
                  setSelectedMitarbeiter(null);
                }}
                className="w-full p-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-medium transition-all"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // === ADMIN DASHBOARD ===
  if (ansicht === 'admin' && currentUser?.role === 'leitung') {
    const handleSaveEmployee = async (employee, updates) => {
      try {
        setAdminSaving(true);
        setAdminError(null);

        const response = await fetch('/api/mitarbeiter', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: employee.name, updates })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Speichern fehlgeschlagen');
        }

        // Reload data
        await loadData();
        setEditingEmployee(null);
      } catch (error) {
        setAdminError(error.message);
      } finally {
        setAdminSaving(false);
      }
    };

    const handleAddEmployee = async (newEmployee) => {
      try {
        setAdminSaving(true);
        setAdminError(null);

        const response = await fetch('/api/mitarbeiter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEmployee)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Hinzufügen fehlgeschlagen');
        }

        alert(`Mitarbeiter hinzugefügt!\nPIN: ${data.pin}\n\nBitte PIN notieren!`);
        await loadData();
        setShowAddModal(false);
      } catch (error) {
        setAdminError(error.message);
      } finally {
        setAdminSaving(false);
      }
    };

    const handleDeleteEmployee = async (name) => {
      if (!confirm(`${name} wirklich deaktivieren?`)) return;

      try {
        setAdminSaving(true);
        const response = await fetch(`/api/mitarbeiter?name=${encodeURIComponent(name)}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Löschen fehlgeschlagen');
        }

        await loadData();
        setEditingEmployee(null);
      } catch (error) {
        setAdminError(error.message);
      } finally {
        setAdminSaving(false);
      }
    };

    return (
      <div className="min-h-screen bg-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-500 text-white p-4 sticky top-0 z-20">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <button
              onClick={() => setAnsicht('erfassung')}
              className="p-2 -ml-2 hover:bg-white/20 rounded-lg transition-all text-lg"
            >
              ←
            </button>
            <div className="text-center">
              <div className="font-bold">Admin-Bereich</div>
              <div className="text-xs text-purple-200">Mitarbeiterverwaltung</div>
            </div>
            <div className="w-8"></div>
          </div>
        </div>

        <div className="p-3 max-w-2xl mx-auto">
          {adminError && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-xl text-sm">
              {adminError}
            </div>
          )}

          {/* Employee List */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
            <div className="bg-gray-50 p-3 font-semibold text-gray-700 border-b">
              Mitarbeiter ({dienstplan?.mitarbeiter?.length || 0})
            </div>
            <div className="divide-y">
              {dienstplan?.mitarbeiter?.map((ma) => (
                <div
                  key={ma.name}
                  className="flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setEditingEmployee(ma)}
                >
                  <div>
                    <div className="font-medium text-gray-800">{ma.name}</div>
                    <div className="text-xs text-gray-400">
                      {BEREICH_DISPLAY[ma.bereich] || ma.bereich} • PIN: {ma.pin || '****'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {ma.canTrackPrepTime ? 'Päd. Personal' : 'Freiwillig'}
                      {ma.isMinor && ' • Minderjährig'}
                      {ma.role === 'leitung' && ' • Leitung'}
                    </div>
                  </div>
                  <span className="text-gray-400">›</span>
                </div>
              ))}
            </div>
          </div>

          {/* Add Employee Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full p-4 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
          >
            <span>+</span> Neue/r Mitarbeiter/in
          </button>
        </div>

        {/* Edit Employee Modal */}
        {editingEmployee && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-sm w-full p-5 max-h-[90vh] overflow-y-auto">
              <h3 className="font-bold text-lg mb-4">{editingEmployee.name} bearbeiten</h3>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-600 block mb-1">Bereich</label>
                  <select
                    defaultValue={editingEmployee.bereich}
                    className="w-full p-3 border rounded-xl"
                    id="edit-bereich"
                  >
                    <option value="Nest">Nest</option>
                    <option value="Ü3">Ü3</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm text-gray-600 block mb-1">PIN</label>
                  <input
                    type="text"
                    defaultValue={editingEmployee.pin}
                    maxLength={4}
                    pattern="[0-9]*"
                    className="w-full p-3 border rounded-xl"
                    id="edit-pin"
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-600 block mb-1">Standard-Stunden/Tag</label>
                  <input
                    type="number"
                    step="0.25"
                    defaultValue={editingEmployee.standardStunden}
                    className="w-full p-3 border rounded-xl"
                    id="edit-std"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      defaultChecked={editingEmployee.canTrackPrepTime}
                      id="edit-prep"
                      className="w-5 h-5"
                    />
                    <span className="text-sm">Pädagogisches Personal (Vor-/Nachbereitung)</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      defaultChecked={editingEmployee.isMinor}
                      id="edit-minor"
                      className="w-5 h-5"
                    />
                    <span className="text-sm">Minderjährig (Pause ab 4,5 Std)</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => handleDeleteEmployee(editingEmployee.name)}
                  disabled={adminSaving || editingEmployee.role === 'leitung'}
                  className="p-3 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl font-medium transition-all disabled:opacity-50"
                >
                  Löschen
                </button>
                <button
                  onClick={() => setEditingEmployee(null)}
                  className="flex-1 p-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-medium transition-all"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => {
                    const updates = {
                      bereich: document.getElementById('edit-bereich').value,
                      pin: document.getElementById('edit-pin').value,
                      standardStunden: parseFloat(document.getElementById('edit-std').value),
                      canTrackPrepTime: document.getElementById('edit-prep').checked,
                      isMinor: document.getElementById('edit-minor').checked
                    };
                    handleSaveEmployee(editingEmployee, updates);
                  }}
                  disabled={adminSaving}
                  className="flex-1 p-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium transition-all disabled:opacity-50"
                >
                  {adminSaving ? 'Speichern...' : 'Speichern'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Employee Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-sm w-full p-5">
              <h3 className="font-bold text-lg mb-4">Neue/r Mitarbeiter/in</h3>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-600 block mb-1">Name</label>
                  <input
                    type="text"
                    className="w-full p-3 border rounded-xl"
                    id="new-name"
                    placeholder="Vorname"
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-600 block mb-1">Bereich</label>
                  <select className="w-full p-3 border rounded-xl" id="new-bereich">
                    <option value="Nest">Nest</option>
                    <option value="Ü3">Ü3</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm text-gray-600 block mb-1">Standard-Stunden/Tag</label>
                  <input
                    type="number"
                    step="0.25"
                    defaultValue="6"
                    className="w-full p-3 border rounded-xl"
                    id="new-std"
                  />
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" defaultChecked id="new-prep" className="w-5 h-5" />
                    <span className="text-sm">Pädagogisches Personal</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input type="checkbox" id="new-minor" className="w-5 h-5" />
                    <span className="text-sm">Minderjährig</span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 p-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-medium transition-all"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => {
                    const name = document.getElementById('new-name').value.trim();
                    if (!name) {
                      alert('Bitte Name eingeben');
                      return;
                    }
                    handleAddEmployee({
                      name,
                      bereich: document.getElementById('new-bereich').value,
                      standardStunden: parseFloat(document.getElementById('new-std').value),
                      canTrackPrepTime: document.getElementById('new-prep').checked,
                      isMinor: document.getElementById('new-minor').checked
                    });
                  }}
                  disabled={adminSaving}
                  className="flex-1 p-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium transition-all disabled:opacity-50"
                >
                  {adminSaving ? 'Hinzufügen...' : 'Hinzufügen'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
