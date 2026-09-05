/* ============================================================
   Boulder-Challenge Frontend
   ============================================================ */

/* ---------------- Datums-Helfer ---------------- */

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function getIsoWeek(dateString) {
  if (!dateString) return null;
  const [y, m, d] = dateString.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function fmtDate(iso) { return iso; }

function fmtDateDE(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y ? `${d}.${m}.${y}` : iso;
}

function statusToIcon(status, when, effectiveImpossible) {
  if (effectiveImpossible) return "🚫";
  if (status === "success") return (when === "makeup" ? "✅⏳" : "✅");
  if (status === "fail") return (when === "makeup" ? "❌⏳" : "❌");
  return "—";
}

function pointsFor(status, effectiveImpossible) {
  if (effectiveImpossible) return 0;
  return status === "success" ? 1 : 0;
}

function computeEffectiveImpossible(challenge, status, now) {
  if (status !== "open") return false;
  if (!challenge.removedFrom) return false;
  const removed = parseISODate(challenge.removedFrom);
  return now >= removed;
}

function byNewestFirst(a, b) { return parseISODate(b.date) - parseISODate(a.date); }
function byOldestFirst(a, b) { return parseISODate(a.date) - parseISODate(b.date); }

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escaped für HTML-Text und Attribute (Routennamen dürfen " und & enthalten)
function safeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

function getWeekLabel(ch) {
  if (ch.label && String(ch.label).trim()) return String(ch.label).trim();
  const week = getIsoWeek(ch.date);
  if (!week) return "";
  return `KW ${String(week).padStart(2, "0")}`;
}

function getSetterInitial(ch, pidToName) {
  const name = pidToName[ch.setBy] ?? ch.setBy ?? "";
  const c = String(name).trim().charAt(0);
  return c ? c.toUpperCase() : "";
}

/* ---------------- Saisons ---------------- */

const LS_DATA = "kletterliga_data_v2";
const LS_DATA_LEGACY = "kletterliga_data_local";
const SS_SEASON = "kletterliga_season";

function seasonIdFromName(name, start) {
  const m = String(name ?? "").match(/(\d{2})\s*\/\s*(\d{2})/);
  if (m) return `20${m[1]}-${m[2]}`;
  const year = String(start ?? "").slice(0, 4);
  return year || "saison";
}

function shortNameFromName(name) {
  const m = String(name ?? "").match(/\d{2}\s*\/\s*\d{2}/);
  return m ? m[0].replace(/\s+/g, "") : String(name ?? "Saison");
}

// Altes Format (eine Saison direkt auf oberster Ebene) → seasons[].
// Greift für data.json genauso wie für alte localStorage-Stände.
function migrateData(raw) {
  if (!raw || typeof raw !== "object") return { schemaVersion: 2, currentSeasonId: null, seasons: [] };
  if (Array.isArray(raw.seasons)) return raw;

  const legacy = raw.season ?? {};
  const name = legacy.name ?? "Boulder-Challenge";
  const id = seasonIdFromName(name, legacy.start);

  return {
    schemaVersion: 2,
    currentSeasonId: id,
    seasons: [{
      id,
      name,
      shortName: shortNameFromName(name),
      start: legacy.start ?? null,
      totalChallenges: legacy.totalChallenges ?? 0,
      archived: false,
      participants: raw.participants ?? [],
      challenges: raw.challenges ?? []
    }]
  };
}

// Lokaler Stand gewinnt für die Inhalte (Teilnehmer/Challenges),
// data.json gewinnt für die Metadaten (Name, Archiv-Flag, aktuelle Saison).
// So taucht eine neu veröffentlichte Saison auch bei Leuten auf,
// die schon einen lokalen Stand im Browser haben.
// Archivierte Saisons sind abgeschlossen: dort gilt immer data.json.
function mergeLocalIntoRemote(remote, local) {
  if (!local || !Array.isArray(local.seasons)) return remote;

  const localById = new Map(local.seasons.map(s => [s.id, s]));
  const seasons = (remote.seasons ?? []).map(s => {
    const l = localById.get(s.id);
    localById.delete(s.id);
    if (!l || s.archived) return s;
    return {
      ...s,
      participants: l.participants ?? s.participants,
      challenges: l.challenges ?? s.challenges
    };
  });

  // Saisons, die es nur lokal gibt (noch nicht committet), bleiben erhalten
  for (const l of localById.values()) seasons.push(l);

  return { ...remote, seasons };
}

// Neueste zuerst
function getSeasons(doc) {
  return [...(doc?.seasons ?? [])].sort(
    (a, b) => String(b.start ?? b.id).localeCompare(String(a.start ?? a.id))
  );
}

function getActiveSeason(doc) {
  const seasons = doc?.seasons ?? [];
  return seasons.find(s => s.id === window.__SEASON_ID__)
      ?? seasons.find(s => s.id === doc?.currentSeasonId)
      ?? seasons[0]
      ?? null;
}

function activeParticipants() {
  return window.__SEASON__?.participants ?? [];
}

function isArchived() {
  return !!window.__SEASON__?.archived;
}

// URL-Parameter > Auswahl in diesem Tab > aktuelle Saison aus data.json
function resolveInitialSeasonId(doc) {
  const ids = new Set((doc?.seasons ?? []).map(s => s.id));

  const fromUrl = new URLSearchParams(location.search).get("season");
  if (fromUrl && ids.has(fromUrl)) return fromUrl;

  try {
    const fromSession = sessionStorage.getItem(SS_SEASON);
    if (fromSession && ids.has(fromSession)) return fromSession;
  } catch {}

  if (doc?.currentSeasonId && ids.has(doc.currentSeasonId)) return doc.currentSeasonId;
  return (doc?.seasons ?? [])[0]?.id ?? null;
}

function setSeason(id) {
  const doc = window.__DATA__;
  if (!doc || !(doc.seasons ?? []).some(s => s.id === id)) return;

  window.__SEASON_ID__ = id;
  window.__editingChallengeId = null;
  clearDraft();

  try { sessionStorage.setItem(SS_SEASON, id); } catch {}

  // Teilbare Links auf die Archiv-Saison
  const url = new URL(location.href);
  if (id === doc.currentSeasonId) url.searchParams.delete("season");
  else url.searchParams.set("season", id);
  history.replaceState(null, "", url);

  computeAndRenderAll(doc);
}

function renderSeasonSwitcher(doc, activeSeason) {
  const sel = document.getElementById("seasonSelect");
  if (!sel) return;

  const seasons = getSeasons(doc);
  sel.hidden = seasons.length < 2;

  sel.innerHTML = seasons.map(s => {
    const label = `${s.shortName ?? s.name}${s.archived ? " · Archiv" : ""}`;
    const selected = s.id === activeSeason?.id ? " selected" : "";
    return `<option value="${safeText(s.id)}"${selected}>${safeText(label)}</option>`;
  }).join("");

  if (!sel.dataset.wired) {
    sel.dataset.wired = "1";
    sel.addEventListener("change", () => setSeason(sel.value));
  }
}

/* ---------------- Lokaler Speicher ---------------- */

function saveLocal(doc) {
  try { localStorage.setItem(LS_DATA, JSON.stringify(doc)); } catch {}
}

function loadLocalDoc() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) return migrateData(JSON.parse(raw));

    // Einmalige Übernahme eines Standes aus der Zeit vor den Saisons
    const legacy = localStorage.getItem(LS_DATA_LEGACY);
    if (legacy) {
      const migrated = migrateData(JSON.parse(legacy));
      saveLocal(migrated);
      localStorage.removeItem(LS_DATA_LEGACY);
      return migrated;
    }
  } catch {}
  return null;
}

function clearLocal() {
  try {
    localStorage.removeItem(LS_DATA);
    localStorage.removeItem(LS_DATA_LEGACY);
  } catch {}
}

/* ---------------- Personen-Farben ---------------- */

// Feste Palette in aesthetisch stimmiger Reihenfolge, von Claude für die
// aktuellen Teilnehmer gewählt (sky/violet/pink/cyan/amber – harmonieren
// gut miteinander und bleiben auf dunklem Grund lesbar).
const PERSON_COLOR_PALETTE = [
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#fbbf24", // amber
  "#4ade80", // green (Reserve)
  "#fb7185", // rose (Reserve)
  "#2dd4bf", // teal (Reserve)
  "#fb923c", // orange (Reserve)
];

// Farben werden über alle Saisons hinweg vergeben (älteste zuerst),
// damit dieselbe Person in Archiv und aktueller Saison gleich aussieht.
function buildPersonColorMap(doc) {
  const oldestFirst = [...(doc?.seasons ?? [])].sort(
    (a, b) => String(a.start ?? a.id).localeCompare(String(b.start ?? b.id))
  );

  const map = {};
  let idx = 0;
  for (const season of oldestFirst) {
    for (const p of (season.participants ?? [])) {
      if (map[p.id] === undefined) {
        map[p.id] = PERSON_COLOR_PALETTE[idx % PERSON_COLOR_PALETTE.length];
        idx += 1;
      }
    }
  }
  return map;
}

/* ---------------- Rangliste (Zeilen + Matrix) ---------------- */

function plural(n, one, many) { return n === 1 ? one : many; }

// ▲/▼ gegenüber dem Stand vor der jüngsten Challenge
function renderRankDelta(delta) {
  if (delta === null || delta === undefined) {
    return `<div class="lbDelta lbDeltaEmpty" aria-hidden="true"></div>`;
  }
  if (delta > 0) {
    const t = `${delta} ${plural(delta, "Platz", "Plätze")} gut gemacht`;
    return `<div class="lbDelta lbDeltaUp" title="${safeText(t)}">▲${delta}</div>`;
  }
  if (delta < 0) {
    const n = -delta;
    const t = `${n} ${plural(n, "Platz", "Plätze")} verloren`;
    return `<div class="lbDelta lbDeltaDown" title="${safeText(t)}">▼${n}</div>`;
  }
  return `<div class="lbDelta lbDeltaSame" title="Rang unverändert">–</div>`;
}

// Formkurve: die letzten Challenges als Punkte, jüngste rechts
function renderForm(form) {
  if (!form || !form.length) return `<div class="lbForm"></div>`;

  const dots = form.map((f, idx) => {
    let cls = "lbFormDot";
    if (f.impossible) cls += " dotImpossible";
    else if (f.status === "success") cls += " dotSuccess";
    else if (f.status === "fail") cls += " dotFail";
    else cls += " dotOpen";
    if (f.when === "makeup") cls += " dotMakeup";
    if (idx === form.length - 1) cls += " dotLatest";

    const icon = statusToIcon(f.status, f.when, f.impossible);
    const setter = f.isSetter ? " · selbst definiert" : "";
    const title = `${f.label || fmtDateDE(f.date)}: ${icon}${setter}`;
    return `<span class="${cls}" title="${safeText(title)}"></span>`;
  }).join("");

  return `<div class="lbForm" title="Letzte ${form.length} ${plural(form.length, "Challenge", "Challenges")}">${dots}</div>`;
}

function renderLeaderboardMatrix(leaderboardRows, challengesAsc, participants, pidToName, pidToColor, now) {
  const el = document.getElementById("leaderboard");

  if (!leaderboardRows.length) {
    el.innerHTML = `<p class="muted">Für diese Saison sind noch keine Teilnehmer erfasst.</p>`;
    return;
  }

  const maxPts = Math.max(...leaderboardRows.map(r => r.points), 1);
  const latestId = challengesAsc[challengesAsc.length - 1]?.id;

  // ---- Zeilen-Rangliste ----
  const rowsHtml = leaderboardRows.map((r, idx) => {
    const pct = Math.round((r.points / maxPts) * 100);
    const isFirst = idx === 0;
    const color = pidToColor[r.id] ?? "#38bdf8";
    const initial = String(r.name).trim().charAt(0).toUpperCase();
    return `
      <div class="lbRow${isFirst ? " lbRowFirst" : ""}" style="--pColor:${color}">
        <div class="lbRank">${idx + 1}</div>
        ${renderRankDelta(r.rankDelta)}
        <div class="lbAvatar">${safeText(initial)}</div>
        <div class="lbName">${safeText(r.name)}</div>
        ${renderForm(r.form)}
        <div class="lbBarWrap"><div class="lbBar" style="width:${pct}%"></div></div>
        <div class="lbPts">${r.points} P</div>
        <div class="lbRate" title="${r.successes} von ${r.attempts} Versuchen">${r.successRate !== null ? r.successRate + "\u202f%" : "\u2014"}</div>
        <div class="lbDefined" title="Definierte Challenges">${r.defined}\u00a0def.</div>
      </div>
    `;
  }).join("");

  // ---- Matrix-Header ----
  const headerCells = challengesAsc.map((ch, idx) => {
    const seq = String(idx + 1).padStart(2, "0");
    const initial = getSetterInitial(ch, pidToName);
    const display = `${seq}${initial}`;
    const cls = (ch.id === latestId) ? "weekCell weekCellLatest" : "weekCell";
    const title = `${fmtDate(ch.date)} · ${safeText(ch.route ?? "")}`;
    return `<div class="${cls}" title="${safeText(title)}">${safeText(display)}</div>`;
  }).join("");

  // ---- Matrix-Spielerzeilen ----
  const playersHtml = leaderboardRows.map(r => {
    const color = pidToColor[r.id] ?? "#38bdf8";
    const iconCells = challengesAsc.map(ch => {
      const res = (ch.results ?? {})[r.id] ?? { status: "open", when: "" };
      const status = res.status ?? "open";
      const when = res.when ?? "";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const icon = statusToIcon(status, when, effectiveImpossible);
      const isSetter = (ch.setBy === r.id);
      let cls = (ch.id === latestId) ? "iconCell weekCellLatest" : "iconCell";
      if (isSetter) cls += " setterIcon";
      return `<div class="${cls}" title="${isSetter ? "Hat diese Challenge definiert" : ""}">${icon}</div>`;
    }).join("");

    return `
      <div class="playerBlock" style="--pColor:${color}">
        <div class="playerNameRow">
          <div class="playerName">${safeText(r.name)}</div>
          <div class="playerBadges">
            <span class="badge badgeAccent">${r.points} P</span>
            <span class="badge" title="${r.successes} von ${r.attempts} Versuchen">✓ ${r.successRate !== null ? r.successRate + " %" : "—"}</span>
            <span class="badge">Def.: ${r.defined}</span>
            <span class="badge">Offen: ${r.openPossible}</span>
            <span class="badge">🚫: ${r.openImpossible}</span>
          </div>
        </div>
        <div class="playerRow">
          <div class="matrixNameCol"></div>
          <div class="matrixScroll" data-matrix-scroll="1">
            <div class="iconRow">${iconCells}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Saisonstart: Teilnehmer stehen schon, Challenges noch nicht
  if (!challengesAsc.length) {
    el.innerHTML = `
      <div class="lbList">${rowsHtml}</div>
      <p class="muted lbEmptyHint">Noch keine Challenges erfasst – die Saison kann losgehen. 🧗</p>
    `;
    return;
  }

  el.innerHTML = `
    <div class="lbList">${rowsHtml}</div>

    <div style="margin-top:14px;">
      <button class="matrixToggle" id="matrixToggleBtn" type="button" aria-expanded="false" aria-controls="matrixWrap">
        <span>Detail-Matrix</span>
        <span class="mtArrow">▾</span>
      </button>
    </div>

    <div class="matrixWrap" id="matrixWrap" hidden>
      <details class="legendDetails">
        <summary>Legende</summary>
        <div class="legend">
          <span>✅ 1P</span><span>❌ 0P</span><span>⏳ nachgeholt</span><span>— offen</span><span>🚫 nicht möglich</span>
          <span class="legendSetter"><span class="legendSwatch"></span> hat Challenge definiert</span>
        </div>
      </details>
      <div class="matrix">
        <div class="matrixHeaderRow">
          <div class="matrixNameCol">Wer</div>
          <div class="matrixScroll" data-matrix-scroll="1">
            <div class="weekRow">${headerCells}</div>
          </div>
        </div>
        <div class="matrixBody">${playersHtml}</div>
      </div>
    </div>
  `;

  const toggleBtn = document.getElementById("matrixToggleBtn");
  const matrixWrap = document.getElementById("matrixWrap");
  toggleBtn.addEventListener("click", () => {
    const isOpen = !matrixWrap.hidden;
    matrixWrap.hidden = isOpen;
    toggleBtn.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) wireMatrixScrollSync();
  });
}

function wireMatrixScrollSync() {
  const scrollers = Array.from(document.querySelectorAll('.matrixScroll[data-matrix-scroll="1"]'));
  let syncing = false;
  scrollers.forEach(sc => {
    sc.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      const x = sc.scrollLeft;
      scrollers.forEach(other => { if (other !== sc) other.scrollLeft = x; });
      syncing = false;
    }, { passive: true });
  });
}

/* ---------------- Challenge Editing (Admin) ---------------- */

window.__editingChallengeId = null;

function startEditChallenge(chId) {
  try {
    const season = window.__SEASON__;
    if (!season || isArchived()) return;
    const participants = season.participants ?? [];
    const ch = (season.challenges ?? []).find(c => c.id === chId);
    if (!ch) return;
    window.__editingChallengeId = chId;
    const draft = {
      date: ch.date || "",
      label: ch.label || "",
      route: ch.route || "",
      grade: ch.grade == null ? "" : String(ch.grade),
      setBy: ch.setBy || (participants[0]?.id ?? ""),
      removedFrom: ch.removedFrom || "",
      notes: ch.notes || "",
      results: JSON.parse(JSON.stringify(ch.results || {}))
    };
    for (const p of participants) {
      if (!draft.results[p.id]) draft.results[p.id] = { status: "open", when: "" };
    }
    applyDraftToUi(draft, participants);
    saveDraft(draft);
    const btnAdd = document.getElementById("admAdd");
    if (btnAdd) btnAdd.textContent = "Challenge aktualisieren";
    switchTab("admin");
  } catch (err) {
    console.error(err);
  }
}

function wireChallengeEdit() {
  document.querySelectorAll('.challengeEditBtn').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const chid = btn.getAttribute('data-chid');
      if (chid) startEditChallenge(chid);
    });
  });
}

/* ---------------- Tap-Zyklus auf Ergebnis-Chips ---------------- */

// Zyklus: open → success → success+makeup → fail → fail+makeup → open
function nextStatus(status, when) {
  status = status ?? "open";
  when = when ?? "";
  if (status === "open") return { status: "success", when: "" };
  if (status === "success" && when !== "makeup") return { status: "success", when: "makeup" };
  if (status === "success" && when === "makeup") return { status: "fail", when: "" };
  if (status === "fail" && when !== "makeup") return { status: "fail", when: "makeup" };
  return { status: "open", when: "" };
}

function wireChipTap() {
  document.querySelectorAll('.resultChip[data-chid]').forEach(chip => {
    chip.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const chId = chip.getAttribute('data-chid');
      const pid = chip.getAttribute('data-pid');
      cycleChallengeStatus(chId, pid);
    });
  });
}

function cycleChallengeStatus(chId, pid) {
  const doc = window.__DATA__;
  const season = window.__SEASON__;
  if (!doc || !season || isArchived()) return;
  const ch = (season.challenges ?? []).find(c => c.id === chId);
  if (!ch) return;
  ch.results = ch.results ?? {};
  const prev = ch.results[pid] ?? { status: "open", when: "" };

  // Für Undo merken
  window.__lastChipChange = {
    chId, pid,
    prev: { status: prev.status ?? "open", when: prev.when ?? "" }
  };

  const next = nextStatus(prev.status, prev.when);
  ch.results[pid] = next;

  // Persistieren und neu rendern
  saveLocal(doc);

  // Feedback
  if (navigator.vibrate) { try { navigator.vibrate(8); } catch {} }
  const participants = season.participants ?? [];
  const pname = (participants.find(p => p.id === pid) || {}).name ?? pid;
  const icon = statusToIcon(next.status, next.when, false);
  showToast(`${pname}: ${icon}`, () => {
    // Undo
    const d = window.__DATA__;
    const s = getActiveSeason(d);
    const c = (s?.challenges ?? []).find(x => x.id === chId);
    if (!c) return;
    c.results[pid] = window.__lastChipChange.prev;
    saveLocal(d);
    computeAndRenderAll(d);
  });

  computeAndRenderAll(doc);
}

/* ---------------- Toast ---------------- */

let toastTimer = null;

function showToast(msg, undoHandler) {
  const toast = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  const toastUndo = document.getElementById("toastUndo");
  if (!toast || !toastMsg || !toastUndo) return;

  toastMsg.textContent = msg;
  toast.hidden = false;

  // Undo handler frisch setzen (alte Listener entfernen)
  const newBtn = toastUndo.cloneNode(true);
  toastUndo.parentNode.replaceChild(newBtn, toastUndo);
  newBtn.addEventListener("click", () => {
    if (typeof undoHandler === "function") undoHandler();
    hideToast();
  });

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3500);
}

function hideToast() {
  const toast = document.getElementById("toast");
  if (toast) toast.hidden = true;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

/* ---------------- Saison-Fortschritt + Stats ---------------- */

function renderSeasonHeader(season, allChallenges, leaderboardRows, now) {
  const title = season?.name ?? "Boulder-Challenge";
  document.getElementById("seasonTitle").textContent = title;
  document.title = title;

  const badge = document.getElementById("archiveBadge");
  if (badge) badge.hidden = !season?.archived;

  const totalChallenges = season?.totalChallenges ?? 0;
  const doneChallenges = allChallenges.length;
  const openChallenges = Math.max(0, totalChallenges - doneChallenges);

  const latestDate = [...allChallenges].sort(byNewestFirst)[0]?.date ?? null;
  const seasonMeta = document.getElementById("seasonMeta");

  // Fortschrittsbalken: durchgeführte / geplante Challenges
  const pct = totalChallenges > 0
    ? Math.min(100, Math.round((doneChallenges / totalChallenges) * 100))
    : 0;

  const progressLabel = totalChallenges > 0
    ? `${doneChallenges} von ${totalChallenges} Challenges`
    : `${doneChallenges} Challenges`;

  seasonMeta.textContent = latestDate
    ? `${progressLabel} · Letzte ${fmtDateDE(latestDate)}`
    : progressLabel;

  const fill = document.getElementById("seasonBarFill");
  if (fill) fill.style.width = `${pct}%`;

  // Stat-Strip
  const stripEl = document.getElementById("statStrip");
  if (stripEl) {
    // Erfolgsrate: erfolgreiche / abgeschlossene Versuche
    // (offene und "nicht möglich"-Einträge zählen nicht)
    let successes = 0;
    let attempts = 0;
    for (const ch of allChallenges) {
      const results = ch.results ?? {};
      for (const r of Object.values(results)) {
        const status = r?.status ?? "open";
        if (status === "success") { successes += 1; attempts += 1; }
        else if (status === "fail") { attempts += 1; }
      }
    }
    const rate = attempts > 0 ? Math.round((successes / attempts) * 100) : 0;
    const rateLabel = attempts > 0 ? `${rate}\u00a0%` : "–";

    stripEl.innerHTML = `
      <div class="statCell">
        <div class="statV statAccent">${doneChallenges}</div>
        <div class="statL">Challenges</div>
      </div>
      <div class="statCell">
        <div class="statV" title="${successes} von ${attempts} Versuchen">${rateLabel}</div>
        <div class="statL">Erfolgsrate</div>
      </div>
      <div class="statCell">
        <div class="statV">${openChallenges}</div>
        <div class="statL">Offen</div>
      </div>
    `;
  }
}

/* ---------------- Rangliste berechnen ---------------- */

// Liefert die sortierte Rangliste für eine Menge von Challenges.
// Wird zweimal aufgerufen: einmal für den aktuellen Stand und einmal
// für den Stand vor der jüngsten Challenge (→ Rangveränderung).
function computeStandings(challenges, participants, now) {
  const stats = Object.fromEntries(participants.map(p => [
    p.id,
    { id: p.id, name: p.name, points: 0, defined: 0, openPossible: 0, openImpossible: 0, successes: 0, attempts: 0 }
  ]));

  for (const ch of challenges) {
    if (ch.setBy && stats[ch.setBy]) stats[ch.setBy].defined += 1;
    const results = ch.results ?? {};
    for (const p of participants) {
      const r = results[p.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      stats[p.id].points += pointsFor(status, effectiveImpossible);
      if (status === "open") {
        if (effectiveImpossible) stats[p.id].openImpossible += 1;
        else stats[p.id].openPossible += 1;
      }
      if (status === "success") { stats[p.id].successes += 1; stats[p.id].attempts += 1; }
      else if (status === "fail") { stats[p.id].attempts += 1; }
    }
  }

  for (const s of Object.values(stats)) {
    s.successRate = s.attempts > 0 ? Math.round((s.successes / s.attempts) * 100) : null;
  }

  return Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    // Bei Gleichstand: höhere Erfolgsrate vorn (null = noch keine Versuche = 0)
    const rateA = a.successRate ?? 0;
    const rateB = b.successRate ?? 0;
    if (rateB !== rateA) return rateB - rateA;
    return a.name.localeCompare(b.name, "de");
  });
}

// Wie viele Challenges die Formkurve zeigt
const FORM_LENGTH = 5;

// Ergänzt jede Zeile um rankDelta (Plätze gut/schlecht seit der
// vorletzten Challenge) und form (die letzten Ergebnisse).
function addTrendInfo(rows, challengesAsc, participants, now) {
  const prevRank = {};
  if (challengesAsc.length >= 2) {
    computeStandings(challengesAsc.slice(0, -1), participants, now)
      .forEach((r, idx) => { prevRank[r.id] = idx + 1; });
  }

  const recent = challengesAsc.slice(-FORM_LENGTH);

  rows.forEach((row, idx) => {
    const before = prevRank[row.id];
    row.rankDelta = before ? before - (idx + 1) : null;

    row.form = recent.map(ch => {
      const r = (ch.results ?? {})[row.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      return {
        status,
        when: r.when ?? "",
        impossible: computeEffectiveImpossible(ch, status, now),
        isSetter: ch.setBy === row.id,
        label: getWeekLabel(ch),
        date: ch.date
      };
    });
  });

  return rows;
}

/* ---------------- Gesamtrender ---------------- */

function computeAndRenderAll(doc) {
  const now = todayUTC();

  const season = getActiveSeason(doc);
  window.__DATA__ = doc;
  window.__SEASON__ = season;
  window.__SEASON_ID__ = season?.id ?? null;

  const allChallenges = season?.challenges ?? [];
  const challengesDesc = [...allChallenges].sort(byNewestFirst);
  const challengesAsc = [...allChallenges].sort(byOldestFirst);

  const participants = season?.participants ?? [];
  const pidToName = Object.fromEntries(participants.map(p => [p.id, p.name]));
  const pidToColor = buildPersonColorMap(doc);
  window.__pidToColor = pidToColor;

  const leaderboard = addTrendInfo(
    computeStandings(allChallenges, participants, now),
    challengesAsc,
    participants,
    now
  );

  const readOnly = !!season?.archived;

  renderSeasonSwitcher(doc, season);
  renderSeasonHeader(season, allChallenges, leaderboard, now);
  renderLeaderboardMatrix(leaderboard, challengesAsc, participants, pidToName, pidToColor, now);
  renderChallenges(challengesDesc, participants, pidToName, pidToColor, now, readOnly);
  renderAdmin(doc, season, participants);
}

/* ---------------- Challenges (Karten) ---------------- */

// Schwierigkeitsgrad (hallen-eigene Skala 4–9); ohne Angabe wird nichts gezeigt
function renderGrade(grade) {
  if (grade == null || grade === "") return "";
  return `<span class="chGrade" title="Schwierigkeitsgrad ${safeText(grade)} (Hallenskala)">${safeText(grade)}</span> `;
}

function renderChallenges(challenges, participants, pidToName, pidToColor, now, readOnly = false) {
  const el = document.getElementById("challenges");

  const asc = [...challenges].sort(byOldestFirst);
  const seqMap = {};
  asc.forEach((c, idx) => { seqMap[c.id] = idx + 1; });

  const cards = challenges.map((ch, idx) => {
    const setByName = pidToName[ch.setBy] ?? ch.setBy ?? "—";
    const setterColor = pidToColor[ch.setBy] ?? "#38bdf8";
    const seq = String(seqMap[ch.id]).padStart(2, "0");
    const kwLabel = ch.label ? safeText(ch.label) : `Nr. ${seq}`;
    const dateFmt = fmtDateDE(ch.date);

    // Tags
    const tags = [];
    if (ch.removedFrom) {
      tags.push(`<span class="chTag">Route entfernt ab ${fmtDateDE(ch.removedFrom)}</span>`);
    }
    if (ch.notes) {
      tags.push(`<span class="chTag chTagAccent">${safeText(ch.notes)}</span>`);
    }
    const tagsHtml = tags.length ? `<div class="chTags">${tags.join("")}</div>` : "";

    const editBtn = readOnly
      ? ""
      : `<button class="challengeEditBtn" data-chid="${safeText(ch.id)}" type="button" title="Bearbeiten">✏️ bearbeiten</button>`;

    // Ergebnis-Chips (tap-fähig)
    const results = ch.results ?? {};
    const chips = participants.map(p => {
      const r = results[p.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      const when = r.when ?? "";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const icon = statusToIcon(status, when, effectiveImpossible);
      const isSetter = (ch.setBy === p.id);

      let chipCls = "resultChip";
      if (isSetter) chipCls += " rcSetter";
      if (effectiveImpossible) chipCls += " rcImpossible";
      else if (status === "open") chipCls += " rcOpen";
      if (readOnly) chipCls += " rcStatic";

      const setterHint = isSetter ? `${p.name} hat diese Challenge definiert` : p.name;
      const title = readOnly ? setterHint : `${setterHint} – tippen zum Umschalten`;

      // Archivierte Saison: Chips nur noch anzeigen, nicht mehr umschaltbar
      if (readOnly) {
        return `
          <span class="${chipCls}" title="${safeText(title)}">
            <span class="rcIcon">${icon}</span>
            <span class="rcName">${safeText(p.name)}</span>
          </span>
        `;
      }

      return `
        <button type="button" class="${chipCls}" data-chid="${safeText(ch.id)}" data-pid="${safeText(p.id)}" title="${safeText(title)}">
          <span class="rcIcon">${icon}</span>
          <span class="rcName">${safeText(p.name)}</span>
        </button>
      `;
    }).join("");

    // Mini-Dots (eingeklappt)
    const miniDots = participants.map(p => {
      const r = results[p.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const isSetter = (ch.setBy === p.id);
      let dotCls = "chMiniDot";
      if (effectiveImpossible) dotCls += " dotImpossible";
      else if (status === "success") dotCls += " dotSuccess";
      else if (status === "fail") dotCls += " dotFail";
      else dotCls += " dotOpen";
      if (isSetter) dotCls += " dotSetter";
      return `<span class="${dotCls}" title="${safeText(p.name)}"></span>`;
    }).join("");

    const isOpen = (idx === 0) ? " open" : "";

    return `
      <details class="challengeCard" data-chid="${safeText(ch.id)}" style="--pColor:${setterColor}"${isOpen}>
        <summary class="challengeSummary">
          <div class="challengeKw">${kwLabel}</div>
          <div class="challengeSummaryBody">
            <div class="challengeTitle">${safeText(ch.route ?? "—")}</div>
            <div class="challengeMeta">${renderGrade(ch.grade)}von <span class="setterName">${safeText(setByName)}</span> · ${dateFmt}</div>
          </div>
          <div class="chMiniDots" aria-hidden="true">${miniDots}</div>
          <span class="chChevron" aria-hidden="true">▾</span>
        </summary>
        <div class="challengeBody">
          ${editBtn}
          ${tagsHtml}
          <div class="resultChips">${chips}</div>
        </div>
      </details>
    `;
  }).join("");

  el.innerHTML = cards || `<p class="muted">Noch keine Challenges erfasst.</p>`;
  wireChallengeEdit();
  wireChipTap();
}

/* ---------------- Admin ---------------- */

function emptyDraft(participants) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const week = getIsoWeek(date);
  const label = week ? `KW ${String(week).padStart(2, "0")}` : "";
  return {
    date, label, route: "", grade: "",
    setBy: participants[0]?.id ?? "",
    removedFrom: "", notes: "",
    results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
  };
}

const ADMIN_FIELD_IDS = ["admDate", "admLabel", "admRoute", "admGrade", "admSetBy", "admRemovedFrom", "admNotes", "admAdd"];

function renderAdmin(doc, season, participants) {
  const archived = !!season?.archived;

  const note = document.getElementById("admArchivedNote");
  if (note) {
    note.hidden = !archived;
    note.textContent = archived
      ? `„${season?.name ?? "Diese Saison"}“ ist archiviert – Bearbeiten ist deaktiviert. Oben auf die laufende Saison wechseln, um Challenges zu erfassen.`
      : "";
  }

  const setBy = document.getElementById("admSetBy");
  if (setBy) setBy.innerHTML = participants.map(p => `<option value="${safeText(p.id)}">${safeText(p.name)}</option>`).join("");

  const draft = loadDraft(participants) ?? emptyDraft(participants);
  applyDraftToUi(draft, participants, archived);

  ADMIN_FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = archived;
  });

  if (!window.__adminWired) {
    wireAdminHandlers();
    window.__adminWired = true;
  }

  updateAdminPreview(doc);
}

function wireAdminHandlers() {
  const elDate = document.getElementById("admDate");
  const elLabel = document.getElementById("admLabel");
  const elRoute = document.getElementById("admRoute");
  const elGrade = document.getElementById("admGrade");
  const elSetBy = document.getElementById("admSetBy");
  const elRemoved = document.getElementById("admRemovedFrom");
  const elNotes = document.getElementById("admNotes");

  const btnAdd = document.getElementById("admAdd");
  const btnCopy = document.getElementById("admCopy");
  const btnDownload = document.getElementById("admDownload");
  const btnReset = document.getElementById("admResetLocal");

  const syncDraft = () => {
    const draft = readDraftFromUi(activeParticipants());
    saveDraft(draft);
    updateAdminPreview(window.__DATA__);
  };

  [elDate, elLabel, elRoute, elGrade, elSetBy, elRemoved, elNotes].forEach(el => {
    if (!el) return;
    el.addEventListener("input", syncDraft);
    el.addEventListener("change", syncDraft);
  });

  if (elDate && elLabel) {
    elDate.addEventListener("change", () => {
      const week = getIsoWeek(elDate.value);
      if (week) elLabel.value = `KW ${String(week).padStart(2, "0")}`;
      syncDraft();
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      clearLocal();
      clearDraft();
      location.reload();
    });
  }

  if (btnAdd) {
    btnAdd.addEventListener("click", () => {
      const doc = window.__DATA__;
      const season = window.__SEASON__;
      if (!doc || !season || isArchived()) return;

      const participants = activeParticipants();
      const draft = readDraftFromUi(participants);

      if (!draft.date || !draft.route || !draft.setBy) {
        alert("Bitte mindestens Datum, Route und 'Definiert von' ausfüllen.");
        return;
      }

      const updatedChallenge = {
        id: draft.date,
        date: draft.date,
        label: draft.label || "",
        route: draft.route,
        grade: draft.grade === "" || draft.grade == null ? null : Number(draft.grade),
        setBy: draft.setBy,
        removedFrom: draft.removedFrom || null,
        notes: draft.notes || "",
        results: draft.results
      };

      season.challenges = season.challenges ?? [];

      if (window.__editingChallengeId) {
        const idx = season.challenges.findIndex(c => c.id === window.__editingChallengeId);
        if (idx !== -1) season.challenges.splice(idx, 1);
        season.challenges.unshift(updatedChallenge);
        window.__editingChallengeId = null;
        btnAdd.textContent = "Challenge hinzufügen";
      } else {
        season.challenges.unshift(updatedChallenge);
      }

      saveLocal(doc);

      const week = getIsoWeek(draft.date);
      const nextLabel = week ? `KW ${String(week).padStart(2, "0")}` : "";
      const fresh = {
        date: draft.date,
        label: nextLabel,
        route: "",
        grade: "",
        setBy: draft.setBy,
        removedFrom: "",
        notes: "",
        results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
      };
      saveDraft(fresh);
      applyDraftToUi(fresh, participants);

      computeAndRenderAll(doc);
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      const jsonText = document.getElementById("admJson")?.value ?? "";
      try {
        await navigator.clipboard.writeText(jsonText);
        alert("JSON kopiert. Jetzt in GitHub in data.json einfügen und committen.");
      } catch {
        alert("Kopieren nicht möglich. Bitte Textfeld manuell markieren und kopieren.");
      }
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener("click", () => {
      const jsonText = document.getElementById("admJson")?.value ?? "";
      const blob = new Blob([jsonText], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    });
  }
}

function applyDraftToUi(draft, participants, disabled = false) {
  document.getElementById("admDate").value = draft.date || "";
  document.getElementById("admLabel").value = draft.label || "";
  document.getElementById("admRoute").value = draft.route || "";
  document.getElementById("admGrade").value = draft.grade ?? "";
  document.getElementById("admSetBy").value = draft.setBy || (participants[0]?.id ?? "");
  document.getElementById("admRemovedFrom").value = draft.removedFrom || "";
  document.getElementById("admNotes").value = draft.notes || "";

  const box = document.getElementById("admResults");
  box.innerHTML = participants.map(p => {
    const r = draft.results?.[p.id] ?? { status: "open", when: "" };
    const icon = statusToIcon(r.status, r.when, false);
    return `
      <button class="resultBtn" type="button" data-pid="${safeText(p.id)}"${disabled ? " disabled" : ""}>
        <span>${safeText(p.name)}</span>
        <small>${icon}</small>
      </button>
    `;
  }).join("");

  if (disabled) return;

  box.querySelectorAll(".resultBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-pid");
      const d = readDraftFromUi(participants);
      const cur = d.results[pid] ?? { status: "open", when: "" };
      const nxt = nextStatus(cur.status, cur.when);
      d.results[pid] = nxt;
      saveDraft(d);
      applyDraftToUi(d, participants);
      updateAdminPreview(window.__DATA__);
    });
  });
}

function readDraftFromUi(participants) {
  const date = document.getElementById("admDate").value;
  const label = document.getElementById("admLabel").value.trim();
  const route = document.getElementById("admRoute").value.trim();
  const grade = document.getElementById("admGrade").value;
  const setBy = document.getElementById("admSetBy").value;
  const removedFrom = document.getElementById("admRemovedFrom").value;
  const notes = document.getElementById("admNotes").value.trim();

  const saved = loadDraft(participants);
  const results = saved?.results ?? Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]));
  return { date, label, route, grade, setBy, removedFrom, notes, results };
}

function updateAdminPreview(data) {
  const el = document.getElementById("admJson");
  if (!el) return;
  const d = data ?? window.__DATA__;
  if (!d) return;
  el.value = JSON.stringify(d, null, 2);
}

function loadDraft(participants) {
  try {
    const raw = localStorage.getItem("kletterliga_admin_draft");
    if (!raw) return null;
    const d = JSON.parse(raw);
    d.results = d.results ?? {};
    for (const p of participants) {
      if (!d.results[p.id]) d.results[p.id] = { status: "open", when: "" };
    }
    return d;
  } catch { return null; }
}

function saveDraft(draft) {
  localStorage.setItem("kletterliga_admin_draft", JSON.stringify(draft));
}

function clearDraft() {
  localStorage.removeItem("kletterliga_admin_draft");
}

/* ---------------- Tabs ---------------- */

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tabPanel").forEach(p => {
    p.hidden = (p.id !== `tab-${name}`);
  });
  // Nach oben scrollen innerhalb des Tabs
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  });
}

/* ---------------- Boot ---------------- */

async function main() {
  wireTabs();

  const res = await fetch(`data.json?v=${Date.now()}`, { cache: "no-store" });
  const remote = migrateData(await res.json());
  const doc = mergeLocalIntoRemote(remote, loadLocalDoc());

  window.__SEASON_ID__ = resolveInitialSeasonId(doc);
  computeAndRenderAll(doc);
}

main().catch(err => {
  console.error(err);
  const el = document.getElementById("challenges");
  if (el) el.innerHTML = `<p class="muted">Fehler beim Laden von <code>data.json</code>.</p>`;
});
