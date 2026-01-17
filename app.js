function parseISODate(s) {
  // Erwartet YYYY-MM-DD
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Berechnet die ISO‑Kalenderwoche (KW) für ein Datum im Format YYYY‑MM‑DD.
// Die Kalenderwoche folgt der ISO‑8601 Definition, bei der die erste Woche
// diejenige ist, die den ersten Donnerstag enthält. Gibt eine Zahl zwischen
// 1 und 53 zurück. Bei ungültigen oder leeren Eingaben wird null geliefert.
function getIsoWeek(dateString) {
  if (!dateString) return null;
  // Verwende UTC, um Zeitzonenverschiebungen zu vermeiden
  const [y, m, d] = dateString.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Donnerstag ermitteln
  const day = dt.getUTCDay() || 7; // Sonntag = 0 => 7
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return weekNo;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function fmtDate(iso) {
  return iso; // bewusst schlicht; ISO ist eindeutig
}

function statusToIcon(status, when, effectiveImpossible) {
  if (effectiveImpossible) return "🚫";
  if (status === "success") return (when === "makeup" ? "⏳✅" : "✅");
  if (status === "fail") return (when === "makeup" ? "⏳❌" : "❌");
  return "—"; // open / unknown
}

function pointsFor(status, effectiveImpossible) {
  if (effectiveImpossible) return 0;
  return status === "success" ? 1 : 0;
}

function computeEffectiveImpossible(challenge, status, now) {
  if (status !== "open") return false;
  if (!challenge.removedFrom) return false;
  const removed = parseISODate(challenge.removedFrom);
  return now >= removed; // ab diesem Datum nicht mehr möglich
}

function byNewestFirst(a, b) {
  return parseISODate(b.date) - parseISODate(a.date);
}

function safeText(s) {
  return String(s ?? "");
}

function computeAndRenderAll(data) {
  const now = todayUTC();

  // Header
  document.getElementById("seasonTitle").textContent = data.season?.name ?? "Kletterliga";

  const challengesSorted = [...(data.challenges ?? [])].sort(byNewestFirst);
  const latestDate = challengesSorted[0]?.date ?? null;
  document.getElementById("seasonMeta").textContent =
    latestDate ? `Stand: ${fmtDate(latestDate)}` : "Stand: –";

  const participants = data.participants ?? [];
  const pidToName = Object.fromEntries(participants.map(p => [p.id, p.name]));

  // Aggregation
  const stats = Object.fromEntries(participants.map(p => [
    p.id,
    { id: p.id, name: p.name, points: 0, defined: 0, openPossible: 0, openImpossible: 0 }
  ]));

  for (const ch of challengesSorted) {
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

  // Leaderboard
  const leaderboard = Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.defined !== a.defined) return b.defined - a.defined;
    return a.name.localeCompare(b.name, "de");
  });

  // Rangliste mitsamt Fairness-Hinweis anzeigen. Es gibt keine separate Fairness-Karte mehr.
  renderLeaderboard(leaderboard);
  renderChallenges(challengesSorted, participants, pidToName, now);

  renderAdmin(data, participants);
  updateAdminPreview(data);

  window.__DATA__ = data;
}

async function main() {
  const res = await fetch("data.json", { cache: "no-store" });
  let data = await res.json();

  // Wenn lokale Arbeitskopie existiert, verwende sie (damit nichts verloren geht)
  const local = localStorage.getItem("kletterliga_data_local");
  if (local) {
    try { data = JSON.parse(local); } catch {}
  }

  window.__DATA__ = data;
  computeAndRenderAll(data);
}

function renderLeaderboard(rows) {
  const el = document.getElementById("leaderboard");

  const tableHtml = `
    <table class="table">
      <thead>
        <tr>
          <th style="width:52px;">#</th>
          <th>Name</th>
          <th style="width:80px;">Punkte</th>
          <th style="width:110px;">Definiert</th>
          <th style="width:120px;">Offen</th>
          <th style="width:140px;">Nicht möglich</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, idx) => `
          <tr>
            <td><span class="rank">${idx + 1}</span></td>
            <td>${safeText(r.name)}</td>
            <td><span class="badge badgeAccent">${r.points} P</span></td>
            <td><span class="badge">${r.defined}</span></td>
            <td><span class="badge">${r.openPossible}</span></td>
            <td><span class="badge">${r.openImpossible}</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  const cardsHtml = `
    <div class="leaderCards">
      ${rows.map((r, idx) => `
        <div class="leaderCard">
          <div class="leaderTop">
            <div>
              <div class="leaderName">${idx + 1}) ${safeText(r.name)}</div>
            </div>
            <span class="badge badgeAccent">${r.points} P</span>
          </div>

          <div class="leaderSub">
            <span class="badge">Definiert: ${r.defined}</span>
            <span class="badge">Offen: ${r.openPossible}</span>
            <span class="badge">Nicht möglich: ${r.openImpossible}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  // Berechne Fairness-Hinweis: Wenn die Differenz der Anzahl definierter Routen
  // (maximal definierte minus minimal definierte) grösser als eins ist, wird
  // ein Hinweis ausgegeben. Früher wurde dafür eine separate Fairness-Karte genutzt.
  const definedValues = rows.map(r => r.defined);
  const minDefined = Math.min(...definedValues);
  const maxDefined = Math.max(...definedValues);
  const diffDefined = maxDefined - minDefined;
  let fairnessHtml = "";
  if (diffDefined > 1) {
    const diffText = diffDefined === 1 ? "1 Route" : `${diffDefined} Routen`;
    fairnessHtml = `
      <div class="kv" style="margin-top:10px;">
        <span class="badge badgeAccent">Achtung: ungleich verteilt (Differenz: ${diffText})</span>
      </div>
    `;
  }
  el.innerHTML = tableHtml + cardsHtml + fairnessHtml;
}

function renderChallenges(challenges, participants, pidToName, now) {
  const el = document.getElementById("challenges");

  const cards = challenges.map(ch => {
    const setByName = pidToName[ch.setBy] ?? ch.setBy ?? "—";
    const removed = ch.removedFrom ? `Route entfernt ab: ${fmtDate(ch.removedFrom)}` : "Route entfernt ab: —";

    const top = `
      <div class="challengeTop">
        <div>
          <div class="challengeTitle">${safeText(ch.label ?? "")} · ${fmtDate(ch.date)}</div>
          <div class="challengeMeta">Route: ${safeText(ch.route ?? "—")}</div>
          <div class="challengeMeta">Definiert von: ${safeText(setByName)}</div>
          <div class="challengeMeta">${removed}</div>
          ${ch.notes ? `<div class="challengeMeta">Notiz: ${safeText(ch.notes)}</div>` : ``}
        </div>
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
          <div>
            <div class="personName">${safeText(p.name)}</div>
          </div>
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

main().catch(err => {
  console.error(err);
  document.getElementById("challenges").innerHTML =
    `<p class="muted">Fehler beim Laden von <code>data.json</code>.</p>`;
});

function renderAdmin(data, participants) {
  // Dropdown "Definiert von"
  const setBy = document.getElementById("admSetBy");
  setBy.innerHTML = participants.map(p => `<option value="${p.id}">${safeText(p.name)}</option>`).join("");

  // Default Datum = heute (lokal)
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  document.getElementById("admDate").value = `${yyyy}-${mm}-${dd}`;

  // Ergebnisse initial: open
  const draft = loadDraft(participants) ?? {
    date: document.getElementById("admDate").value,
    label: "",
    route: "",
    setBy: participants[0]?.id ?? "",
    removedFrom: "",
    notes: "",
    results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
  };

  // Wenn kein Label gesetzt ist, die Kalenderwoche der gewählten Challenge automatisch setzen.
  if (!draft.label && draft.date) {
    const week = getIsoWeek(draft.date);
    if (week) {
      const wkStr = String(week).padStart(2, "0");
      draft.label = `KW ${wkStr}`;
    }
  }

  // Draft ins UI
  applyDraftToUi(draft, participants);
  wireAdminHandlers(data, participants);
  updateAdminPreview(data);
}

function wireAdminHandlers(data, participants) {
  const elDate = document.getElementById("admDate");
  const elLabel = document.getElementById("admLabel");
  const elRoute = document.getElementById("admRoute");
  const elSetBy = document.getElementById("admSetBy");
  const elRemoved = document.getElementById("admRemovedFrom");
  const elNotes = document.getElementById("admNotes");
  document.getElementById("admResetLocal").addEventListener("click", () => {
    localStorage.removeItem("kletterliga_data_local");
    clearDraft();
    location.reload(); // lädt wieder die echte data.json von GitHub
  });

  const syncDraft = () => {
    const draft = readDraftFromUi(participants);
    saveDraft(draft);
    updateAdminPreview(data);
  };

  [elDate, elLabel, elRoute, elSetBy, elRemoved, elNotes].forEach(el => {
    el.addEventListener("input", syncDraft);
    el.addEventListener("change", syncDraft);
  });

  // Wenn das Datum geändert wird, automatisch das Label mit der ISO‑Kalenderwoche befüllen.
  const updateLabelForDate = () => {
    const dateVal = elDate.value;
    const week = getIsoWeek(dateVal);
    if (week) {
      const wkStr = String(week).padStart(2, "0");
      elLabel.value = `KW ${wkStr}`;
    }
  };
  elDate.addEventListener("change", () => {
    updateLabelForDate();
    syncDraft();
  });

  document.getElementById("admAdd").addEventListener("click", () => {
    const draft = readDraftFromUi(participants);

    // Minimalvalidierung
    if (!draft.date || !draft.route || !draft.setBy) {
      alert("Bitte mindestens Datum, Route und 'Definiert von' ausfüllen.");
      return;
    }

    // Challenge Objekt bauen
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

    // Challenge einmalig am Anfang einfügen (neueste zuerst)
    data.challenges = data.challenges ?? [];
    data.challenges.unshift(ch);

    // Lokale Arbeitskopie speichern (damit nach Refresh nichts verloren geht)
    localStorage.setItem("kletterliga_data_local", JSON.stringify(data));

    // Draft reset für nächste Eingabe (optional, aber praktisch)
    clearDraft();
    const fresh = {
      date: draft.date,
      label: "",
      route: "",
      setBy: draft.setBy,
      removedFrom: "",
      notes: "",
      results: Object.fromEntries(participants.map(p => [p.id, { status: "open", when: "" }]))
    };
    applyDraftToUi(fresh, participants);
    saveDraft(fresh);

    // UI sofort aktualisieren (ohne Reload)
    computeAndRenderAll(data);
  });

  document.getElementById("admCopy").addEventListener("click", async () => {
    const jsonText = document.getElementById("admJson").value;
    try {
      await navigator.clipboard.writeText(jsonText);
      alert("JSON kopiert. Jetzt in GitHub in data.json einfügen und committen.");
    } catch {
      alert("Kopieren nicht möglich. Bitte Textfeld manuell markieren und kopieren.");
    }
  });

  document.getElementById("admDownload").addEventListener("click", () => {
    const jsonText = document.getElementById("admJson").value;
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
    const icon = (r.status === "success" ? (r.when === "makeup" ? "⏳✅" : "✅")
               : r.status === "fail"    ? (r.when === "makeup" ? "⏳❌" : "❌")
               : "—");
    return `
      <button class="resultBtn" type="button" data-pid="${p.id}">
        <span>${safeText(p.name)}</span>
        <span><small>${icon}</small></span>
      </button>
    `;
  }).join("");

  // Toggle-Handler: — -> ✅ -> ❌ -> —
  box.querySelectorAll(".resultBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-pid");
      const d = readDraftFromUi(participants);

      const cur = d.results[pid] ?? { status: "open", when: "" };

      // cycle status
      const next = (cur.status === "open") ? "success"
                 : (cur.status === "success") ? "fail"
                 : "open";

      d.results[pid] = { status: next, when: cur.when || "" };

      // Wenn status open, dann when leeren
      if (next === "open") d.results[pid].when = "";

      saveDraft(d);
      applyDraftToUi(d, participants); // re-render buttons
      updateAdminPreview(window.__DATA__ ?? null); // fallback
      location.hash = "#"; // iOS: verhindert manchmal stuck focus
    });
  });

  // Kleine Hilfe: data im window halten, damit updateAdminPreview sicher ist
  window.__DATA__ = window.__DATA__ ?? null;
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
  // Wenn data nicht übergeben, versuchen aus window zu lesen
  const el = document.getElementById("admJson");
  if (!el) return;

  // data.json soll "challenges" neueste zuerst enthalten
  // Wir sortieren nicht hart um, weil wir in main sowieso sortieren; fürs File ist neueste zuerst nice.
  const jsonText = JSON.stringify(data, null, 2);
  el.value = jsonText;

  // window cache
  window.__DATA__ = data;
}

function loadDraft(participants) {
  try {
    const raw = localStorage.getItem("kletterliga_admin_draft");
    if (!raw) return null;
    const d = JSON.parse(raw);

    // ensure results for all participants
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
