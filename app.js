function parseISODate(s) {
  // Erwartet YYYY-MM-DD
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
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

async function main() {
  const res = await fetch("data.json", { cache: "no-store" });
  const data = await res.json();

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
      const when = r.when ?? "";
      const effectiveImpossible = computeEffectiveImpossible(ch, status, now);

      stats[p.id].points += pointsFor(status, effectiveImpossible);

      if (status === "open") {
        if (effectiveImpossible) stats[p.id].openImpossible += 1;
        else stats[p.id].openPossible += 1;
      }
    }
  }

  // Leaderboard sort: Punkte desc, defined desc (optional), Name
  const leaderboard = Object.values(stats).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.defined !== a.defined) return b.defined - a.defined;
    return a.name.localeCompare(b.name, "de");
  });

  renderLeaderboard(leaderboard);
  renderFairness(leaderboard);
  renderChallenges(challengesSorted, participants, pidToName, now);
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

  el.innerHTML = tableHtml + cardsHtml;
}


function renderFairness(rows) {
  const el = document.getElementById("fairness");

  const byName = rows
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const definedValues = byName.map(r => r.defined);
  const min = Math.min(...definedValues, 0);
  const max = Math.max(...definedValues, 0);
  const diff = max - min;

  const line = byName.map(r => `${r.name}: ${r.defined}`).join(" · ");

  const warning = diff >= 2
    ? `<div class="kv"><span class="badge badgeAccent">Achtung: ungleich verteilt</span></div>`
    : ``;

  el.innerHTML = `
    ${warning}
    <p class="muted" style="margin-top:${warning ? "10px" : "0"};">${safeText(line)}</p>
  `;
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