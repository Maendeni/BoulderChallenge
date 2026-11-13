/* ============================================================
   Datenbank-Schicht (Supabase)

   Nur aktiv, wenn config.js ausgefüllt ist. Dann gilt:
   - Laufende Saisons: Challenges + Ergebnisse kommen aus der DB.
   - Archivierte Saisons, Teilnehmer, Saison-Metadaten: data.json.
   - Lesen darf jeder, schreiben nur mit dem Gruppen-Passwort.
   - Jede Änderung trägt den Namen aus "Wer bist du?" und landet
     per Trigger im Änderungsprotokoll (change_log).
   ============================================================ */

const BoulderDB = (() => {
  const cfg = window.BOULDER_CONFIG ?? {};
  const konfiguriert = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && cfg.gruppenEmail);
  const aktiv = konfiguriert && !!window.supabase?.createClient;

  const LS_WER = "boulder_wer";
  let client = null;
  let session = null;

  if (aktiv) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }

  async function init() {
    if (!client) return;
    try {
      const { data } = await client.auth.getSession();
      session = data?.session ?? null;
    } catch { session = null; }
    client.auth.onAuthStateChange((_ev, s) => { session = s; });
  }

  /* ---------------- Anmeldung ---------------- */

  function angemeldet() { return !!session; }

  function wer() {
    try { return localStorage.getItem(LS_WER) || ""; } catch { return ""; }
  }

  function setzeWer(id) {
    try { localStorage.setItem(LS_WER, id); } catch {}
  }

  async function anmelden(passwort) {
    const { data, error } = await client.auth.signInWithPassword({
      email: cfg.gruppenEmail,
      password: passwort
    });
    if (error) throw error;
    session = data.session;
  }

  async function abmelden() {
    try { await client.auth.signOut(); } catch {}
    session = null;
  }

  /* ---------------- Mapping DB ↔ data.json-Format ---------------- */

  function zuChallenge(row) {
    return {
      id: row.id,
      date: row.date,
      label: row.label ?? "",
      route: row.route ?? "",
      grade: row.grade ?? null,
      setBy: row.set_by,
      removedFrom: row.removed_from ?? null,
      notes: row.notes ?? "",
      results: {}
    };
  }

  function challengeZeile(seasonId, ch) {
    return {
      season_id: seasonId,
      id: ch.id,
      date: ch.date,
      label: ch.label ?? "",
      route: ch.route,
      grade: ch.grade ?? null,
      set_by: ch.setBy,
      removed_from: ch.removedFrom || null,
      notes: ch.notes ?? "",
      changed_by: wer()
    };
  }

  function ergebnisZeilen(seasonId, ch) {
    return Object.entries(ch.results ?? {}).map(([pid, r]) => ({
      season_id: seasonId,
      challenge_id: ch.id,
      participant_id: pid,
      status: r?.status ?? "open",
      when_type: r?.when ?? "",
      changed_by: wer()
    }));
  }

  /* ---------------- Lesen ---------------- */

  // Liefert { seasonId: [challenges im data.json-Format] }
  async function ladeChallenges(seasonIds) {
    if (!seasonIds.length) return {};

    const [ch, rs] = await Promise.all([
      client.from("challenges").select("*").in("season_id", seasonIds),
      client.from("results").select("*").in("season_id", seasonIds)
    ]);
    if (ch.error) throw ch.error;
    if (rs.error) throw rs.error;

    const proSaison = Object.fromEntries(seasonIds.map(id => [id, []]));
    const nachSchluessel = new Map();

    for (const row of ch.data ?? []) {
      const c = zuChallenge(row);
      (proSaison[row.season_id] ??= []).push(c);
      nachSchluessel.set(`${row.season_id}|${row.id}`, c);
    }
    for (const row of rs.data ?? []) {
      const c = nachSchluessel.get(`${row.season_id}|${row.challenge_id}`);
      if (c) c.results[row.participant_id] = { status: row.status, when: row.when_type ?? "" };
    }
    return proSaison;
  }

  async function ladeVerlauf(limit = 50) {
    const { data, error } = await client
      .from("change_log")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  /* ---------------- Schreiben ---------------- */

  // Schreibzugriffe nacheinander abarbeiten: bei schnellem Antippen
  // eines Chips muss der letzte Stand auch zuletzt ankommen
  let kette = Promise.resolve();
  function inReihe(fn) {
    const lauf = kette.then(fn, fn);
    kette = lauf.catch(() => {});
    return lauf;
  }

  function speichereErgebnis(...args) { return inReihe(() => _speichereErgebnis(...args)); }
  function speichereChallenge(...args) { return inReihe(() => _speichereChallenge(...args)); }
  function importiereSaison(...args) { return inReihe(() => _importiereSaison(...args)); }

  async function _speichereErgebnis(seasonId, chId, pid, res) {
    const { error } = await client.from("results").upsert({
      season_id: seasonId,
      challenge_id: chId,
      participant_id: pid,
      status: res?.status ?? "open",
      when_type: res?.when ?? "",
      changed_by: wer()
    });
    if (error) throw error;
  }

  // alteId gesetzt = bestehende Challenge bearbeiten (auch wenn sich
  // das Datum und damit die id ändert; die Ergebnisse ziehen per
  // ON UPDATE CASCADE mit)
  async function _speichereChallenge(seasonId, ch, alteId = null) {
    const zeile = challengeZeile(seasonId, ch);

    if (alteId) {
      const { data, error } = await client
        .from("challenges")
        .update(zeile)
        .eq("season_id", seasonId)
        .eq("id", alteId)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Die Challenge wurde inzwischen von jemand anderem geändert. Bitte neu laden.");
    } else {
      const { error } = await client.from("challenges").insert(zeile);
      if (error) throw error;
    }

    const ergebnisse = ergebnisZeilen(seasonId, ch);
    if (ergebnisse.length) {
      const { error } = await client.from("results").upsert(ergebnisse);
      if (error) throw error;
    }
  }

  // Einmalige Übernahme einer laufenden Saison aus data.json
  async function _importiereSaison(seasonId, challenges) {
    const zeilen = challenges.map(ch => challengeZeile(seasonId, ch));
    if (!zeilen.length) return;

    const { error } = await client.from("challenges").insert(zeilen);
    if (error) throw error;

    const ergebnisse = challenges.flatMap(ch => ergebnisZeilen(seasonId, ch));
    if (ergebnisse.length) {
      const { error: e2 } = await client.from("results").upsert(ergebnisse);
      if (e2) throw e2;
    }
  }

  // Verständliche Meldung für die häufigsten Fehler
  function fehlerText(err) {
    const code = err?.code ?? "";
    const msg = String(err?.message ?? err ?? "");
    if (code === "23505") return "Für dieses Datum gibt es schon eine Challenge.";
    if (/invalid login credentials/i.test(msg)) return "Passwort falsch.";
    if (code === "42501" || /row-level security|permission denied|JWT/i.test(msg)) {
      return "Keine Berechtigung – bitte neu anmelden.";
    }
    if (/fetch|network|Failed to/i.test(msg)) {
      return "Datenbank nicht erreichbar. Ist das Supabase-Projekt pausiert?";
    }
    return msg || "Unbekannter Fehler.";
  }

  return {
    konfiguriert, aktiv,
    init, angemeldet, wer, setzeWer, anmelden, abmelden,
    ladeChallenges, ladeVerlauf,
    speichereErgebnis, speichereChallenge, importiereSaison,
    fehlerText
  };
})();
