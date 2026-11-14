/* ============================================================
   Datenbank-Anbindung (Supabase)
   Leer lassen = App läuft wie bisher nur mit data.json und
   JSON-Copy-Paste. Einrichtung: siehe supabase/README.md

   Der "anon"/"publishable" Key ist für den Browser gedacht und
   darf öffentlich im Repo stehen – geschützt wird über die
   Rechte in supabase/setup.sql. Den "service_role"/"secret" Key
   NIE hier eintragen.
   ============================================================ */

window.BOULDER_CONFIG = {
  supabaseUrl: "",       // z.B. "https://abcdefgh.supabase.co"
  supabaseAnonKey: "",   // Project Settings → API Keys → anon / publishable
  gruppenEmail: ""       // E-Mail des gemeinsamen Gruppen-Kontos
};
