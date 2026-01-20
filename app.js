function parseISODate(s) {
  // Erwartet YYYY-MM-DD
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ISO-Kalenderwoche (KW) für Datum YYYY-MM-DD (UTC, um TZ-Probleme zu vermeiden)
function getIsoWeek(dateString) {
  if (!dateString) return null;
  const [y, m, d] = dateString.split("-").map(Number);
  if (!y || !m || !d) return null;

  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7; // Sonntag=0 -> 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // Donnerstag der Woche
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function fmtDate(iso) {
  return iso; // ISO bleibt am klarsten
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

function byNewestFirst(a, b) {
  return parseISODate(b.date) - parseISODate(a.date);
}

function byOldestFirst(a, b) {
  return parseISODate(a.date) - parseISODate(b.date);
}

function safeText(s) {
  return String(s ?? "");
}

/* ---------------- Rangliste (Matrix) ---------------- */

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

function renderLeaderboardMatrix(leaderboardRows, challengesAsc, participants, pidToName, now) {
  const el = document.getElementById("leaderboard");

  if (!challengesAsc.length) {
    el.innerHTML = `<p class="muted">Noch keine Challenges erfasst.</p>`;
    return;
  }

  const latestId = challengesAsc[challengesAsc.length - 1]?.id;

  const headerCells = challengesAsc.map(ch => {
    const label = getWeekLabel(ch);
    const initial = getSetterInitial(ch, pidToName);
    const cls = (ch.id === latestId) ? "weekCell weekCellLatest" : "weekCell";
    const title = `${fmtDate(ch.date)} · ${safeText(ch.route ?? "")}`;
    return `<div class="${cls}" title="${safeText(title)}">${safeText(label)} ${safeText(initial)}</div>`;
  }).join("");

  const playersHtml = leaderboardRows.map(r => {
    const iconCells = challengesAsc.map(ch => {
      const res = (ch.results ?? {})[r.id] ?? { status: "open", when: "" };
      const status = res.status ?? "open";
      const when = res.when ?? "";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const icon = statusToIcon(status, when, effectiveImpossible);
      const cls = (ch.id === latestId) ? "iconCell weekCellLatest" : "iconCell";
      return `<div class="${cls}">${icon}</div>`;
    }).join("");

    return `
      <div class="playerBlock">
        <div class="playerNameRow">
          <div class="playerName">${safeText(r.name)}</div>
          <div class="playerBadges">
            <span class="badge badgeAccent">${r.points} P</span>
            <span class="badge">Def.: ${r.defined}</span>
            <span class="badge">Offen: ${r.openPossible}</span>
            <span class="badge">🚫: ${r.openImpossible}</span>
          </div>
        </div>

        <div class="playerRow">
          <div class="matrixNameCol"></div>
          <div class="matrixScroll" data-matrix-scroll="1">
            <div class="iconRow">
              ${iconCells}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  el.innerHTML = `
    <div class="matrix">
      <div class="matrixHeaderRow">
        <div class="matrixNameCol">Teilnehmer</div>
        <div class="matrixScroll" data-matrix-scroll="1">
          <div class="weekRow">
            ${headerCells}
          </div>
        </div>
      </div>

      <div class="matrixBody">
        ${playersHtml}
      </div>
    </div>
  `;

  wireMatrixScrollSync();
  wireJumpButtons();
}

function wireMatrixScrollSync() {
  const scrollers = Array.from(document.querySelectorAll('.matrixScroll[data-matrix-scroll="1"]'));
  window.__matrixScrollEls = scrollers;

  let syncing = false;

  scrollers.forEach(sc => {
    sc.addEventListener("scroll", () => {
      if (syncing) return;
      syncing = true;
      const x = sc.scrollLeft;
      scrollers.forEach(other => {
        if (other !== sc) other.scrollLeft = x;
      });
      syncing = false;
    }, { passive: true });
  });
}

function wireJumpButtons() {
  // Nur einmal binden
  if (window.__jumpWired) return;
  window.__jumpWired = true;

  const btnStart = document.getElementById("jumpStart");
  const btnLatest = document.getElementById("jumpLatest");

  if (btnStart) {
    btnStart.addEventListener("click", () => {
      const els = window.__matrixScrollEls ?? [];
      els.forEach(el => { el.scrollLeft = 0; });
    });
  }

  if (btnLatest) {
    btnLatest.addEventListener("click", () => {
      const els = window.__matrixScrollEls ?? [];
      const ref = els[0];
      const max = ref ? (ref.scrollWidth - ref.clientWidth) : 0;
      els.forEach(el => { el.scrollLeft = max; });
    });
  }
}

/* ---------------- Gesamtrender ---------------- */

function computeAndRenderAll(data) {
  const now = todayUTC();

  document.getElementById("seasonTitle").textContent = data.season?.name ?? "Boulder-Challenge";

  const allChallenges = data.challenges ?? [];
  const challengesDesc = [...allChallenges].sort(byNewestFirst);
  const challengesAsc = [...allChallenges].sort(byOldestFirst);

  const latestDate = challengesDesc[0]?.date ?? null;
  document.getElementById("seasonMeta").textContent =
    latestDate ? `Stand: ${fmtDate(latestDate)}` : "Stand: –";

  const participants = data.participants ?? [];
  const pidToName = Object.fromEntries(participants.map(p => [p.id, p.name]));

  const stats = Object.fromEntries(participants.map(p => [
    p.id,
    { id: p.id, name: p.name, points: 0, defined: 0, openPossible: 0, openImpossible: 0 }
  ]));

  for (const ch of allChallenges) {
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
    }
  }

  const leaderboard = Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name, "de");
  });

  renderLeaderboardMatrix(leaderboard, challengesAsc, participants, pidToName, now);
  renderChallenges(challengesDesc, participants, pidToName, now);
  renderAdmin(data, participants);

  window.__DATA__ = data;
}

/* ---------------- Challenges (Karten) ---------------- */

function renderChallenges(challenges, participants, pidToName, now) {
  const el = document.getElementById("challenges");

  const cards = challenges.map(ch => {
    const setByName = pidToName[ch.setBy] ?? ch.setBy ?? "—";
    const removed = ch.removedFrom ? `Route entfernt ab: ${fmtDate(ch.removedFrom)}` : "Route entfernt ab: —";

    const top = `
      <div>
        <div class="challengeTitle">${safeText(ch.label ?? "")} · ${fmtDate(ch.date)}</div>
        <div class="challengeMeta">Route: ${safeText(ch.route ?? "—")}</div>
        <div class="challengeMeta">Definiert von: ${safeText(setByName)}</div>
        <div class="challengeMeta">${removed}</div>
        ${ch.notes ? `<div class="challengeMeta">Notiz: ${safeText(ch.notes)}</div>` : ``}
      </div>
    `;

    const results = ch.results ?? {};
    const chips = participants.map(p => {
      const r = results[p.id] ?? { status: "open", when: "" };
      const status = r.status ?? "open";
      const when = r.when ?? "";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);
      const icon = statusToIcon(status, when, effectiveImpossible);

      return `
        <div class="personChip">
          <div class="personName">${safeText(p.name)}</div>
          <div class="personStatus" aria-label="Status">${icon}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="challengeCard">
        ${top}
        <div class="grid5">${chips}</div>
      </div>
    `;
  }).join("");

  el.innerHTML = cards || `<p class="muted">Noch keine Challenges erfasst.</p>`;
}

/* ---------------- Admin ---------------- */

function renderAdmin(data, participants) {
  window.__DATA__ = data;

  const setBy = document.getElementById("admSetBy");
  if (setBy) setBy.innerHTML = participants.map(p => `<option value="${p.id}">${safeText(p.name)}</option>`).join("");

  const draft = loadDraft(participants) ?? (() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const date = `${yyyy}-${mm}-${dd}`;

    const week = getIsoWeek(date);
    const label = week ? `KW ${String(week).padStart(2, "0")}` : "";

    return {
      date,
      label,
      route: "",
      setBy: participants[0]?.id ?? "",
      removedFrom: "",
      notes: "",
      results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
    };
  })();

  applyDraftToUi(draft, participants);

  // Bugfix: Handler nur einmal binden (sonst doppelte Popups)
  if (!window.__adminWired) {
    wireAdminHandlers(participants);
    window.__adminWired = true;
  }

  updateAdminPreview(window.__DATA__);
}

function wireAdminHandlers(participants) {
  const elDate = document.getElementById("admDate");
  const elLabel = document.getElementById("admLabel");
  const elRoute = document.getElementById("admRoute");
  const elSetBy = document.getElementById("admSetBy");
  const elRemoved = document.getElementById("admRemovedFrom");
  const elNotes = document.getElementById("admNotes");

  const btnAdd = document.getElementById("admAdd");
  const btnCopy = document.getElementById("admCopy");
  const btnDownload = document.getElementById("admDownload");
  const btnReset = document.getElementById("admResetLocal");

  const syncDraft = () => {
    const draft = readDraftFromUi(participants);
    saveDraft(draft);
    updateAdminPreview(window.__DATA__);
  };

  [elDate, elLabel, elRoute, elSetBy, elRemoved, elNotes].forEach(el => {
    if (!el) return;
    el.addEventListener("input", syncDraft);
    el.addEventListener("change", syncDraft);
  });

  // Datum geändert -> Label automatisch setzen (KW)
  if (elDate && elLabel) {
    elDate.addEventListener("change", () => {
      const week = getIsoWeek(elDate.value);
      if (week) elLabel.value = `KW ${String(week).padStart(2, "0")}`;
      syncDraft();
    });
  }

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      localStorage.removeItem("kletterliga_data_local");
      clearDraft();
      location.reload();
    });
  }

  if (btnAdd) {
    btnAdd.addEventListener("click", () => {
      const data = window.__DATA__;
      if (!data) return;

      const draft = readDraftFromUi(participants);

      if (!draft.date || !draft.route || !draft.setBy) {
        alert("Bitte mindestens Datum, Route und 'Definiert von' ausfüllen.");
        return;
      }

      const ch = {
        id: draft.date,
        date: draft.date,
        label: draft.label || "",
        route: draft.route,
        setBy: draft.setBy,
        removedFrom: draft.removedFrom || null,
        notes: draft.notes || "",
        results: draft.results
      };

      data.challenges = data.challenges ?? [];
      data.challenges.unshift(ch);

      localStorage.setItem("kletterliga_data_local", JSON.stringify(data));

      const week = getIsoWeek(draft.date);
      const nextLabel = week ? `KW ${String(week).padStart(2, "0")}` : "";
      const fresh = {
        date: draft.date,
        label: nextLabel,
        route: "",
        setBy: draft.setBy,
        removedFrom: "",
        notes: "",
        results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
      };
      saveDraft(fresh);
      applyDraftToUi(fresh, participants);

      computeAndRenderAll(data);
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

function applyDraftToUi(draft, participants) {
  document.getElementById("admDate").value = draft.date || "";
  document.getElementById("admLabel").value = draft.label || "";
  document.getElementById("admRoute").value = draft.route || "";
  document.getElementById("admSetBy").value = draft.setBy || (participants[0]?.id ?? "");
  document.getElementById("admRemovedFrom").value = draft.removedFrom || "";
  document.getElementById("admNotes").value = draft.notes || "";

  const box = document.getElementById("admResults");
  box.innerHTML = participants.map(p => {
    const r = draft.results?.[p.id] ?? { status: "open", when: "" };
    const icon = (r.status === "success" ? (r.when === "makeup" ? "✅⏳" : "✅")
               : r.status === "fail"    ? (r.when === "makeup" ? "❌⏳" : "❌")
               : "—");
    return `
      <button class="resultBtn" type="button" data-pid="${p.id}">
        <span>${safeText(p.name)}</span>
        <span><small>${icon}</small></span>
      </button>
    `;
  }).join("");

  // Toggle: — -> ✅ -> ❌ -> —
  box.querySelectorAll(".resultBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-pid");
      const d = readDraftFromUi(participants);

      const cur = d.results[pid] ?? { status: "open", when: "" };
      const next = (cur.status === "open") ? "success"
                 : (cur.status === "success") ? "fail"
                 : "open";

      d.results[pid] = { status: next, when: cur.when || "" };
      if (next === "open") d.results[pid].when = "";

      saveDraft(d);
      applyDraftToUi(d, participants);
      updateAdminPreview(window.__DATA__);
      location.hash = "#";
    });
  });
}

function readDraftFromUi(participants) {
  const date = document.getElementById("admDate").value;
  const label = document.getElementById("admLabel").value.trim();
  const route = document.getElementById("admRoute").value.trim();
  const setBy = document.getElementById("admSetBy").value;
  const removedFrom = document.getElementById("admRemovedFrom").value;
  const notes = document.getElementById("admNotes").value.trim();

  const saved = loadDraft(participants);
  const results = saved?.results ?? Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]));
  return { date, label, route, setBy, removedFrom, notes, results };
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
  } catch {
    return null;
  }
}

function saveDraft(draft) {
  localStorage.setItem("kletterliga_admin_draft", JSON.stringify(draft));
}

function clearDraft() {
  localStorage.removeItem("kletterliga_admin_draft");
}

/* ---------------- Boot ---------------- */

async function main() {
  const res = await fetch("data.json", { cache: "no-store" });
  let data = await res.json();

  // lokale Arbeitskopie verwenden (damit Änderungen nach Refresh bleiben)
  const local = localStorage.getItem("kletterliga_data_local");
  if (local) {
    try { data = JSON.parse(local); } catch {}
  }

  window.__DATA__ = data;
  computeAndRenderAll(data);
}

main().catch(err => {
  console.error(err);
  const el = document.getElementById("challenges");
  if (el) el.innerHTML = `<p class="muted">Fehler beim Laden von <code>data.json</code>.</p>`;
});
