'use client';

import { useState, useEffect } from 'react';

const ABWEICHUNG_OPTIONEN = [
  { value: "0", label: "Wie geplant", color: "bg-green-100 text-green-700 border-green-300" },
  { value: "+0.5", label: "+30 min", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "+1", label: "+1 Std", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "+1.5", label: "+1,5 Std", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "-0.5", label: "-30 min", color: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "-1", label: "-1 Std", color: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "-1.5", label: "-1,5 Std", color: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "K", label: "Krank", color: "bg-red-100 text-red-700 border-red-300" },
  { value: "U", label: "Urlaub", color: "bg-purple-100 text-purple-700 border-purple-300" },
  { value: "KK", label: "Kind krank", color: "bg-pink-100 text-pink-700 border-pink-300" },
];

// Pausenabzug berechnen: Ab 6 Stunden = 0.5 Std Pause
function berechnePausenabzug(istStunden) {
  return istStunden >= 6 ? 0.5 : 0;
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-sky-100 via-white to-emerald-50 p-4">
        <div className="max-w-sm mx-auto pt-8">
          <div className="text-center mb-8">
            <div className="text-6xl mb-3">🐰</div>
            <h1 className="text-2xl font-bold text-gray-800">Wukaninchen</h1>
            <p className="text-gray-500 text-sm">Stundenerfassung</p>
            {dienstplan && (
              <p className="text-xs text-gray-400 mt-1">
                {dienstplan.monat} {dienstplan.jahr}
              </p>
            )}
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl shadow-xl p-5">
            <h2 className="text-base font-semibold mb-4 text-gray-700">Wer bist du?</h2>
            <div className="grid grid-cols-2 gap-2.5">
              {dienstplan?.mitarbeiter?.map((ma) => {
                const now = new Date();
                const monatKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const submissionKey = `${ma.name}-${monatKey}`;
                const submission = submissions[submissionKey];
                const approval = approvals[submissionKey];

                let statusBadge = null;
                if (approval?.status === 'genehmigt') {
                  statusBadge = <span className="text-xs text-green-600">✓</span>;
                } else if (submission?.status === 'eingereicht') {
                  statusBadge = <span className="text-xs text-blue-600">●</span>;
                }

                return (
                  <button
                    key={ma.name}
                    onClick={() => {
                      setCurrentUser(ma);
                      setAnsicht('erfassung');
                    }}
                    className="p-3 bg-gradient-to-br from-sky-50 to-blue-50 hover:from-sky-100 hover:to-blue-100 rounded-xl text-center transition-all active:scale-95 border border-sky-100 relative"
                  >
                    {statusBadge && (
                      <span className="absolute top-2 right-2">{statusBadge}</span>
                    )}
                    <div className="text-xl mb-0.5">👤</div>
                    <div className="font-semibold text-gray-800 text-sm">{ma.name}</div>
                    <div className="text-xs text-gray-400">{ma.bereich}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 pt-4 border-t border-gray-100">
              <button
                onClick={() => setAnsicht('uebersicht')}
                className="w-full p-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-600 font-medium transition-all flex items-center justify-center gap-2"
              >
                <span>📊</span> Übersicht (Leitung)
              </button>
            </div>
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
          let tagesStd = tag.sollStd;

          if (eintrag === "K" || eintrag === "U" || eintrag === "KK") {
            // Bei Abwesenheit: Soll-Stunden zählen
            tagesStd = tag.sollStd;
          } else if (eintrag && eintrag !== "0") {
            tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
          }

          // Pausenabzug berechnen
          const pause = berechnePausenabzug(tagesStd);
          pausenAbzug += pause;
          istSumme += tagesStd - pause;
        }
      });

      return { sollSumme, istSumme, pausenAbzug };
    };

    const hasUnsavedChanges = () => {
      // Prüfen ob es ungespeicherte Änderungen gibt
      for (const key of Object.keys(eintraege)) {
        if (key.startsWith(currentUser.name + '-')) {
          if (eintraege[key] !== savedEintraege[key]) {
            return true;
          }
        }
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

        const response = await fetch('/api/eintraege', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mitarbeiter: currentUser.name,
            eintraege: mitarbeiterEintraege
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Speichern fehlgeschlagen');
        }

        // Gespeicherte Einträge aktualisieren
        setSavedEintraege(prev => ({ ...prev, ...mitarbeiterEintraege }));

        // Submission-Status aktualisieren
        const now = new Date();
        const monatKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        setSubmissions(prev => ({
          ...prev,
          [`${currentUser.name}-${monatKey}`]: {
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
            <div className="w-8"></div>
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

        {/* Tages-Liste */}
        <div className="p-3 max-w-lg mx-auto space-y-2.5 pb-36">
          {maTage.map((tag, idx) => {
            const eintrag = getEintrag(idx);
            const istAbwesend = tag.status === "K" || tag.status === "U";
            const keinDienst = !tag.sollStd || tag.sollStd === 0;

            // Berechne Ist-Stunden für diesen Tag
            let tagesIst = tag.sollStd || 0;
            if (eintrag && eintrag !== "0" && !["K", "U", "KK"].includes(eintrag)) {
              tagesIst = tag.sollStd + (parseFloat(eintrag) || 0);
            }
            const tagesPause = berechnePausenabzug(tagesIst);

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
                      <span className="text-gray-400 ml-1.5">{tag.datum}</span>
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
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            ABWEICHUNG_OPTIONEN.find(o => o.value === eintrag)?.color || 'bg-gray-100'
                          }`}>
                            {ABWEICHUNG_OPTIONEN.find(o => o.value === eintrag)?.label || eintrag}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {istAbwesend ? (
                    <div className="text-sm text-red-500 mt-1">
                      {tag.status === "K" ? "Krank (lt. Dienstplan)" : "Urlaub"}
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
                  <div className="p-2.5 bg-gray-50">
                    <div className="flex flex-wrap gap-1.5">
                      {ABWEICHUNG_OPTIONEN.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => handleAbweichung(idx, option.value)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border ${
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

      wochen.forEach((woche, wochenIdx) => {
        const maTage = woche.tage?.[maName] || [];
        maTage.forEach((tag, tagIdx) => {
          if (tag.sollStd > 0) {
            sollGesamt += tag.sollStd;
            const key = `${maName}-${wochenIdx}-${tagIdx}`;
            const eintrag = eintraege[key];

            let tagesStd = tag.sollStd;
            if (eintrag && eintrag !== "0" && !["K", "U", "KK"].includes(eintrag)) {
              tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
            }

            const pause = berechnePausenabzug(tagesStd);
            istGesamt += tagesStd - pause;
          }
        });
      });

      return { sollGesamt, istGesamt };
    };

    return (
      <div className="min-h-screen bg-gray-100">
        <div className="bg-gradient-to-r from-gray-700 to-gray-600 text-white p-4 sticky top-0 z-20">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <button
              onClick={() => setAnsicht('login')}
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
                const { sollGesamt, istGesamt } = berechneMitarbeiterStunden(ma.name);
                const hasSubmission = submissions[`${ma.name}-${monatKey}`];

                return (
                  <div
                    key={ma.name}
                    className={`flex items-center justify-between p-3 ${hasSubmission ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    onClick={() => {
                      if (hasSubmission) {
                        setSelectedMitarbeiter(ma);
                        setShowApprovalModal(true);
                      }
                    }}
                  >
                    <div>
                      <div className="font-medium text-gray-800">{ma.name}</div>
                      <div className="text-xs text-gray-400">{ma.bereich}</div>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      <div>
                        <div className="font-semibold text-gray-700">
                          {istGesamt.toFixed(1)} / {sollGesamt.toFixed(1)} Std
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

                      let tagesStd = tag.sollStd;
                      if (eintrag && eintrag !== "0" && !["K", "U", "KK"].includes(eintrag)) {
                        tagesStd = tag.sollStd + (parseFloat(eintrag) || 0);
                      }

                      const pause = berechnePausenabzug(tagesStd);
                      wochenIst += tagesStd - pause;
                    }
                  });

                  return (
                    <div key={ma.name} className="flex items-center justify-between p-3">
                      <div>
                        <div className="font-medium text-gray-800">{ma.name}</div>
                        <div className="text-xs text-gray-400">{ma.bereich}</div>
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

  return null;
}
