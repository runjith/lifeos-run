/* LifeOS — configuration.
   Leave these empty and the app runs entirely on your phone/computer with no account.
   Fill them in to turn on cloud sync across devices.

   SUPABASE_URL      Project Settings → API → Project URL
   SUPABASE_ANON_KEY Project Settings → API → Project API keys → anon / publishable

   The anon key is safe in frontend code: it only works together with Row Level
   Security, which is set up in supabase/schema.sql. NEVER paste the service_role
   key here — that one bypasses every security rule. */
window.LX = window.LX || {};

/* Set by bump.py — shown under More -> About and used to name the offline cache. */
window.LX.VERSION = "1.3.1";

window.LX.CONFIG = {
  SUPABASE_URL: "https://yutwpnqvqhjmvgbsyigy.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_AhyOp7g93hMgGOTozfOLdg_5sBRKPyo"
};
