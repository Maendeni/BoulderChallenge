# Datenbank für die Boulder-Challenge (Supabase)

Mit der Datenbank erfassen alle Teilnehmer ihre Resultate direkt in der App. Das Kopieren von JSON in `data.json` fällt weg. Jede Änderung wird mit Namen protokolliert.

Solange `config.js` leer ist, läuft die App genau wie bisher.

## Was wo liegt

| Daten | Ort |
|---|---|
| Challenges + Resultate der **laufenden** Saison | Supabase |
| Saisons, Teilnehmer, **archivierte** Saisons | `data.json` (wie bisher) |
| Änderungsprotokoll (wer hat was wann geändert) | Supabase, Tabelle `change_log`, sichtbar im Admin-Tab |

- **Lesen** (Rangliste, Challenges) kann jeder, ohne Anmeldung.
- **Schreiben** geht nur mit dem gemeinsamen Gruppen-Passwort. Bei der Anmeldung wählt jeder seinen Namen. Dieser Name steht bei jeder Änderung im Protokoll.
- **Löschen** ist absichtlich gar nicht möglich, auch nicht mit dem Passwort.

> Hinweis: Weil alle dasselbe Passwort nutzen, ist der Name eine Selbstangabe. Unter Freunden reicht das, um nachzuvollziehen, wer was geändert hat. Gegen Fälschung schützt es nicht.

## Einrichtung (einmalig, ca. 15 Minuten)

1. **Projekt anlegen:** Auf [supabase.com](https://supabase.com) ein Konto erstellen und ein neues Projekt anlegen, z.B. `boulder-challenge`. Als Region eine europäische wählen (Zürich, falls angeboten, sonst Frankfurt). Das Datenbank-Passwort sicher ablegen. Die App braucht es nicht.
2. **Tabellen anlegen:** Im Projekt den **SQL Editor** öffnen, den Inhalt von [`setup.sql`](setup.sql) einfügen und **Run** klicken. Das Skript darf später erneut laufen.
3. **Registrierung sperren (wichtig!):** Unter **Authentication → Sign In / Providers** die Option *Allow new users to sign up* ausschalten. Sonst könnte sich jeder ein eigenes Konto machen und Resultate ändern.
4. **Gruppen-Konto anlegen:** Unter **Authentication → Users → Add user → Create new user**:
   - E-Mail: eine beliebige Adresse, z.B. Deine eigene mit Zusatz (`du+boulder@…`). Es werden keine Mails verschickt.
   - Passwort: das **Gruppen-Passwort**, das Du den anderen gibst.
   - *Auto Confirm User* aktivieren.
5. **App verbinden:** Unter **Project Settings → API Keys** (bzw. *Data API*) die **Project URL** und den **anon / publishable** Key kopieren und in [`config.js`](../config.js) eintragen, dazu die E-Mail des Gruppen-Kontos. Committen.
   - Der anon/publishable Key darf öffentlich sein. Den **service_role / secret** Key **nie** eintragen.
6. **Laufende Saison übernehmen:** App öffnen → **Admin** → anmelden → **Übernehmen**. Damit wird die Saison aus `data.json` einmalig in die Datenbank kopiert. Am besten auf dem Gerät, auf dem zuletzt erfasst wurde: Lokale, noch nicht committete Änderungen werden mit übernommen.
7. **Wach halten:** Gratis-Projekte pausieren nach 7 Tagen ohne Zugriff. Der Workflow [`supabase-wach-halten.yml`](../.github/workflows/supabase-wach-halten.yml) fragt die Datenbank zweimal pro Woche an. Unter **Actions** einmal manuell starten (*Run workflow*) und prüfen, ob er grün wird.
   - GitHub schaltet geplante Workflows ab, wenn ein Repo 60 Tage keine Commits hat. Dann kommt eine Mail, und der Workflow lässt sich mit einem Klick wieder einschalten.
   - Falls das Projekt doch pausiert: Im Supabase-Dashboard auf *Restore* klicken. Die Daten bleiben erhalten. Die App zeigt in der Zwischenzeit den Stand aus `data.json` an, und Erfassen ist gesperrt.

## Saisonwechsel

1. **Admin → JSON kopieren.** Das enthält die laufende Saison aus der Datenbank.
2. In GitHub `data.json` damit ersetzen. Bei der alten Saison `"archived": true` setzen, die neue Saison mit Teilnehmern ergänzen und `currentSeasonId` umstellen. Committen.
3. Fertig: Die neue Saison startet leer in der Datenbank. Die archivierte Saison kommt ab jetzt aus `data.json`.

## Protokoll ansehen

- In der App: **Admin → Änderungsprotokoll** (nur angemeldet, letzte 50 Einträge).
- Vollständig: Supabase → **Table Editor → change_log**. Dort steht pro Änderung der alte und der neue Wert als JSON.
