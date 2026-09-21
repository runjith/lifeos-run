# RunOS — brief for a new conversation

Paste the block below into a new chat and attach `lifeos.zip` (or give the
GitHub link). That is everything an assistant needs to pick the project up.

---

I have a working personal web app called **RunOS** (formerly LifeOS) that tracks time, health,
fitness, nutrition, sleep, body measurements and strength tests. It is already
live and I use it daily. I want to make a change to it — not rebuild it.

**Stack:** plain HTML, CSS and vanilla JavaScript. No framework, no build step,
no TypeScript. Everything hangs off one global object, `LX`, and files load in
plain `<script>` order.

**Storage:** IndexedDB on the device (local-first, works fully offline), with an
optional sync layer to Supabase. Changes queue in an "outbox" and push when
online; conflicts resolve per record by newest `updated_at`; deletes are soft.

**Hosting:** GitHub Pages, deployed by committing to the repo. `python3 bump.py`
raises the version and the service-worker cache name before each deploy.

**Screens:** Home, Tasks, Time, Health (Workout / Insights / Tests / Weekly /
Food / Sleep / Weight / Body), Progress, More.

**Internal names stay "lifeos"** (the IndexedDB database, cache prefix, backup
format). Renaming them would make existing data invisible — change only what
the user sees.

**File map:**
- `index.html` — the shell and the script order
- `css/tokens.css` — colours, type, spacing, dark mode
- `css/base.css`, `css/components.css` — layout and components
- `js/config.js` — my Supabase keys and the version
- `js/util.js` — dates, durations, formatting, icons
- `js/data/seed.js` — starting categories, exercises, foods, goals, tests
- `js/db.js` — IndexedDB: reads, writes, soft deletes, outbox, repair
- `js/store.js` — day summaries, ranges, workout history, goals
- `js/ui.js` — bottom sheets, toasts, confirms, form pieces
- `js/charts.js` — hand-built SVG charts (ribbon, bars, stacked, line)
- `js/forms.js` — every logging sheet and the timer
- `js/perf.js` — strength and performance tests
- `js/weekly.js` — weekly goals: the week-by-week record
- `js/tasks.js` — the Tasks tab: to-do list, trophies, Add to Calendar
- `js/meals.js` — saved meals
- `js/insights.js` — gym analytics (main lifts, personal bests, volume)
- `js/day-sheet.js` — the day drill-down and the bars/line preference
- `js/importer.js`, `js/exporter.js` — JSON import, backups, CSV
- `js/cloud.js` — Supabase auth and two-way sync
- `js/screens/*.js` — one file per screen
- `js/app.js` — theme, navigation, rendering
- `sw.js`, `manifest.webmanifest` — offline cache and install
- `supabase/schema.sql` — tables, indexes, row level security
- `tests/` — Node scripts that boot the whole app and check it

**Please follow these rules:**
1. Do not rewrite the app or introduce new technologies.
2. Do not remove existing features or change the visual style.
3. Keep the local-first design: screens read and write IndexedDB through
   `store`, never the cloud directly.
4. If a change needs a new table, add it to `js/db.js`, bump `DB_VERSION` there,
   and add matching SQL to `supabase/schema.sql` — never drop existing tables.
5. Explain what you changed in plain language. I am not a programmer.
6. Run the tests in `tests/` after the change, and add a test for anything new.
7. Give me back the complete changed files, and bump the version.

**Important context:** `README.md` explains the architecture and `DEPLOY.md`
explains hosting and updates. Read them before changing anything.

**My data lives in Supabase and in my browser — never in the repo.** Changing
the app must not touch it.

Here is what I want to change:
[describe it here]

---

## Before you start a change

Take a backup: **Settings → Data & backup → Download full backup**. Ten seconds,
and it makes any mistake reversible.

## After you get the changed files

1. In GitHub, open each changed file → pencil icon → paste the new version →
   **Commit changes**.
2. Make sure the version was bumped (`js/config.js`, `sw.js`, `version.txt`) —
   ask the assistant to do it if it didn't.
3. Wait a minute, open the app, hard refresh (Ctrl+Shift+R), and check
   **Settings → About** shows the new version number.
