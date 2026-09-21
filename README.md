# RunOS

A personal app for one question: **where did my time go, and how is my health progressing?**

Plain HTML, CSS and JavaScript. No framework, no build step, no Python at runtime.
Everything you record is saved on your device first; the cloud is optional.

---

## 1. Run it right now

Open `index.html` in a browser. That is the whole setup. It seeds your time
categories, an exercise library and default goals, and you can start logging.

To use it properly on your iPhone you want it on a web address, because iOS only
allows "Add to Home Screen" and offline storage on real `https://` pages.

### Put it online (5 minutes, free)

1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page.
3. You get a link like `https://something.netlify.app`.
4. Open that link in **Safari** on your iPhone → Share → **Add to Home Screen**.

It now opens full-screen like a normal app, works with no signal, and keeps its
data between launches.

Any static host works the same way: Netlify, Vercel, Cloudflare Pages, GitHub Pages.

### One-file version

`python3 build.py` writes `dist/lifeos.html` — the entire app inlined into one
file you can email to yourself or open from Files. It cannot install as a PWA
(no service worker), but everything else is identical.

---

## 2. Turn on cloud sync (optional)

Skip this if one device is enough. The app never asks you to sign in and never
sends anything anywhere until you do this.

1. Create a free project at https://supabase.com
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, press Run.
   This creates the tables and the security rules.
3. Open **Project Settings → API** and copy the **Project URL** and the
   **anon / publishable** key.
4. Paste both into `js/config.js`:

```js
window.LX.CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

5. Re-upload the folder. In the app: **More → Sign in or create an account**.

Two warnings worth taking seriously:

- Use the **anon** key only. The `service_role` key bypasses every security rule;
  it must never appear in a web page.
- Keep email confirmation on in Supabase (**Authentication → Providers → Email**)
  unless you have a reason not to.

Row Level Security is switched on for every table, and each policy checks
`auth.uid() = user_id`. Even with the anon key in public, another account cannot
read your rows.

---

## 3. How the app is put together

```
index.html            the shell: header, view, tab bar
css/tokens.css        colours, type scale, spacing, dark mode
css/base.css          layout, navigation, safe areas
css/components.css    cards, buttons, sheets, forms, charts, toasts
js/config.js          your Supabase keys (the only file you edit)
js/util.js            dates, durations, formatting, icons
js/data/seed.js       starting categories, exercises, foods, goals
js/db.js              IndexedDB: reads, writes, soft deletes, outbox
js/store.js           meaning: day summaries, ranges, PRs, goals
js/ui.js              sheets, toasts, confirms, form fragments
js/charts.js          SVG ribbon, bars, stacked days, trend lines
js/forms.js           every logging sheet + the timer
js/perf.js            strength & performance tests: data, analytics, sheets
js/weekly.js          weekly goals: data, week-by-week record, sheets
js/tasks.js           tasks: the to-do list, trophies, Add to Calendar, the Tasks tab
js/meals.js           saved meals: log a whole meal in one tap
js/insights.js        gym analytics: main lifts, personal bests, volume
js/day-sheet.js       the day drill-down + the bars/line preference
bump.py               raise the version before deploying (see DEPLOY.md)
version.txt           the current version number
js/timer-ui.js        the running-timer bar
js/importer.js        JSON validate → preview → write
js/exporter.js        backup, CSV, restore
js/cloud.js           Supabase auth and two-way sync
js/screens/*.js       Home, Time, Health, Progress, More
js/app.js             theme, navigation, rendering
sw.js                 offline cache of the app shell
supabase/schema.sql   tables, indexes, RLS policies
```

Screens never touch the database directly. They ask `store` for a shape like
"today's summary" and render it. That is why adding a screen does not risk
breaking the data.

### Screen map

- **Home** — today's sleep, exercise, calories, protein; the 24-hour ribbon;
  category breakdown; everything logged today; weekly goals; quick actions;
  daily review.
- **Time** — day / week / month / custom. Timer, manual entry, per-day stacked
  columns, totals with daily averages.
- **Health** — Workout, Insights, Tests, Weekly, Food, Sleep, Weight, Body. Each
  with its own log, history and charts.
- **Progress** — 7 / 30 / 90 / 365 days across Time, Body, Fitness, Nutrition.
- **More** — account and sync, JSON import, data and backup, goals, categories,
  appearance, schema reference.

### The 24-hour rule

Tracked time plus untracked time always equals 24 hours. Untracked time is drawn
in grey and labelled "untracked", never as free time — it is missing data, not a
finding. Sleep is counted once: from your sleep record if there is one, otherwise
from any activity in a sleep category.

---

## 4. Data storage

### Local (always)

IndexedDB, database `lifeos`. One object store per table, matching the Supabase
schema. Every record carries:

| field | meaning |
|---|---|
| `id` | UUID generated on the device, so offline records never collide |
| `created_at` / `updated_at` | ISO timestamps |
| `deleted_at` | set instead of deleting, so a delete can sync |
| `_dirty` | 1 while the record is still waiting to be pushed |

`localStorage` holds only the theme, the session token and any running timer.

### Cloud (optional)

The same tables in Supabase PostgreSQL, each with `user_id` and RLS.

### Signing in on a second device

Each device seeds its own categories, exercises and performance tests on first
run. On the first sync for an account, LifeOS reconciles them: the account's
copies win, anything you logged locally is re-pointed at them, and the device's
own seeded rows are dropped before anything is pushed. So a second device does
not end up with two "Work" categories or two "Bench Press" entries, and no
duplicates reach the cloud. This runs once per account per device.

Sync markers are stored per account. If you sign into a *different* account on a
device that already holds data, LifeOS stops and asks first — cancel and nothing
is uploaded and nothing local is touched.

### Sync

```
you log something
   ↓
IndexedDB (instant, works offline)
   ↓
outbox queue
   ↓  when online and signed in
Supabase  ← pull anything changed on other devices
   ↓
✓ Synced
```

Sync runs when the app opens, a few seconds after you change something, every
five minutes, when the network comes back, and when you tap the status pill.

**Conflict resolution.** Every row carries `updated_at`, written by the device
that made the change. On pull, a cloud row replaces the local one only if its
`updated_at` is newer. A local row still sitting in the outbox always wins
locally and is pushed afterwards. This is last-write-wins per record, which is
the right trade for a single-person app: it is predictable, needs no merge
interface, and the only thing it can lose is the older of two edits to the same
record on two devices while both were offline. Records are small and rarely
edited twice, so that case is close to theoretical — and because deletes are
soft, nothing ever comes back from the dead.

The status pill in the header shows `Synced`, `Syncing`, `Offline`, `Sync error`
or nothing at all when you are running local-only.

---

## 4a. Insights (the gym analytics)

**Health → Insights.** Built entirely from the sets you already log.

- **Main lifts** — squat, bench and deadlift by default, each with best set,
  last session, change since the session before, an estimated 1RM (Epley,
  labelled as an estimate) and a chart of the heaviest set per session. Tap
  "Choose" to follow different lifts — up to four.
- **Personal bests** — the heaviest set ever recorded for every exercise, sorted.
  Tap any of them for the full progression.
- **Volume per week** and **by muscle group**, over 90 days, a year, or all time.

Charts switch between bars and a line with the toggle in any chart header, and
that choice is remembered everywhere.

**Drill-down.** Tap a day in any daily chart — on Time, on Progress — and that
day opens: the 24-hour breakdown, what was logged, food totals, workouts and
weight. Time's week and month views also list every day, tappable.

---

## 4b. Strength & performance tests

**Health → Tests.** Standardised efforts you repeat and compare: Cindy, 100
push-ups for time, a 2 km run. These are deliberately separate from normal
workouts — a test result is stored in its own table, never appears in workout
history, and never counts as a workout session.

Five tests are there from the start: **Cindy** (20-minute AMRAP, rounds),
**Push-ups** (target 100, for time), **Pull-ups** (target 50), **Dips**
(target 50) and **Running** (2 km by default). All of them are editable, and you
can add your own.

**Test types**

| type | you record | better means |
|---|---|---|
| Rounds (AMRAP) | rounds, optional extra reps | higher |
| Reps | reps | higher |
| Time | a held time, e.g. a plank | longer |
| Reps + time | target reps, reps done, completion time | lower time |
| Distance + time | distance, completion time | lower time |

**Targets are configurable and history is never rewritten.** Each result stores
the target or distance it was done at, and results are grouped into a series per
target. Change the push-up target from 100 to 75 and the 75-rep result starts its
own trend; the 100-rep chart keeps its own three results, untouched. Running
works the same way: 2 km and 5 km are separate series and are never compared.

**Per series you get** latest, best (with its date), previous, the change from
previous in plain words, the full history, and a date-vs-result chart in the same
chart style as the rest of the app. Running also shows pace per km, calculated
from the time and distance.

**Editing and deleting.** Tap any result in the history — or in Recent results —
to edit it. An edit updates that same record rather than adding another one, and
latest / best / previous / the chart / the Home summary all recalculate. Deleting
asks first.

**On Home** a compact "Strength & performance" card appears once you have at
least one result: latest, best and date per test, plus pace for running. It stays
hidden until there is something to show.

**Data model.** Two tables, matching the `state.strengthTests` /
`state.strengthResults` split:

- `strength_tests` — name, type, target, unit, fixed duration, notes
- `strength_results` — id, `test_id`, date, the result values, `config_key`
  (the series it belongs to), notes, `created_at`, `updated_at`

Both sit in the same IndexedDB database and sync to Supabase like everything
else, and both are included in JSON backups. Backups made before this feature
existed restore normally — the missing sections are simply treated as empty.

---

---

## 4c. Weekly goals

**Health → Weekly.** Skills and habits you want to attempt every week rather
than measure in a workout: ten minutes of handstand practice, a one-arm push-up
session, three cold showers. They are separate from both workouts and
performance tests — ticking one off never writes a workout or a test result, and
neither of those ever ticks one off.

Two examples are there from the start (one-arm push-up practice and handstand
practice, ten minutes once a week). Both are editable, and you can add as many
of your own as you like.

**Target types**

| type | you set | one attempt counts when |
|---|---|---|
| Duration | minutes per attempt | you record at least that many minutes |
| Reps | reps per attempt | you record at least that many reps |
| Sessions | nothing to reach | every attempt counts |
| Custom | a number and your own unit | you record at least that number |

Every goal also carries **times per week**. The week is complete once that many
qualifying attempts are in it.

**Weeks run Monday to Sunday.** While the week is open a goal shows as *not
completed*; once the target is met it shows as completed, with what you actually
did and when. A week that ends without the target being reached is recorded as
**missed** rather than quietly forgotten, so the history is honest.

**A shorter attempt is still recorded.** Six minutes against a ten-minute target
is saved and shown — it just does not tick the week off. Nothing is thrown away
for falling short.

**History is never rewritten.** Each entry stores the week it belongs to and the
value it was recorded with, so raising a target from ten minutes to thirty does
not turn last month's completed weeks into failures.

Per goal you get this week's progress, the run of consecutive completed weeks,
how many of the finished weeks were completed, every attempt (tap one to edit or
delete it) and the week-by-week record. **On Home** a compact "Weekly goals" card
shows what is still pending, and you can tick a goal off from there.

**Data model.** Two tables: `weekly_goals` (name, target type, target, times per
week) and `weekly_goal_logs` (goal, date, the Monday of its week, value, notes,
and the time it was ticked off). Both sync and both appear in backups. Backups
made before this feature existed restore normally.


---

## 4d. Tasks

**The Tasks tab.** A to-do list you visit every day. Tick a task and it is
struck through and moved to **Finished**, where it stays for good with the day
and time you finished it. Finished tasks are only removed if you delete one on
purpose; a tick made by mistake can be undone with **Reopen**.

Each task can have a date, a time, an urgency (High, Medium, Low) and a
category — the same categories as Time. Views: **Today** (with anything
overdue at the top), **Upcoming**, **Someday** (no date) and **Finished**.

- **Overdue tasks never disappear.** They stay under Today, marked in red with
  how many days late, until they are done.
- **Repeating tasks** (every day, every weekday, weekly, monthly). Ticking one
  keeps that occurrence in Finished and creates the next, dated after today —
  so a daily task that is three days overdue gives you tomorrow's, not three
  more overdue copies. Monthly tasks on the 31st land on the last day of short
  months.
- **Trophies** on the Finished view: all-time count, this week and month, the
  day streak (days in a row with at least one task done), the on-time rate,
  and a chart of tasks finished per week.
- **Add to Calendar** on any dated task creates a calendar event with its own
  alert — 15 minutes before for a timed task, 9am for an all-day one. Your
  phone's calendar does the reminding, with nothing for this app to keep running.
- **Quick add**: type a task on Home or at the top of Tasks and press Enter; it
  is added for today.
- The **daily review** fills "What actually got done?" from the tasks you
  finished that day, ready to edit.

---

## 4e. Home, themes, meals and backups

**Home is made of cards** you choose and order under **More → Home screen**:
quick actions, today at a glance (tap a tile to log it), today's tasks, mood &
energy, weekly goals, where the day went, logged today, strength, and the daily
review. A line at the top says what matters right now.

**Mood and energy**, 1 to 5, can be tapped straight from Home or set in the
daily review. Both are stored with that day's review.

**Appearance** has four modes (Auto, Light, Dark, and Black for OLED phone
screens), five colour themes (Teal, Ocean, Sunset, Violet, Mono) and a colour
strength switch: **Vivid** (stronger category, chart and progress colours) or
**Soft** (the original calmer look). The phone's status bar follows the choice.

**Saved meals.** On the Food tab, "Save as meal" under any meal with two or more
foods stores it. The food sheet then offers it as one tap, along with "Same
breakfast as yesterday". Logging a saved meal writes ordinary food entries, so
editing and totals work exactly as usual.

**Sleep shortcuts.** The sleep sheet has 6h to 8h buttons that keep your wake
time and work the bedtime back from it. Logging the Sleep category as an
activity offers the same long durations instead of 15 minutes to 2 hours.

**Backups.** More → Data & backup → **Share backup** opens the phone's share
sheet, so a backup can go straight to Google Drive, Files or email. The app
remembers when a backup last left the device, and Home shows a reminder once it
has been more than a week. The Supabase free plan keeps no backups of its own,
so these files are the real safety net.

**About & health check** shows version, last sync, changes waiting to sync, last
backup, whether the browser has agreed to keep the data permanently, space used
and record count. On start the app asks the browser to keep its data even when
the device is short of space.

**The name.** The app shows as RunOS. Internal names — the local database, the
cache, the backup format — deliberately stayed the same, so nothing stored was
touched by the rename, and backups from before it restore normally.


## 5. Import a day as JSON

**More → Import JSON.** Paste, tap Validate, read the preview, tap Import.
Nothing is written until you confirm. Errors say what is wrong; warnings say what
the app will do about it (for example filling in calories for a food it knows).

Minimal example — every section is optional, food alone is valid:

```json
{
  "date": "2026-09-19",
  "food": [{ "name": "Chicken breast", "quantity": 300, "unit": "g", "meal": "Lunch" }]
}
```

Full example: see `sample-import.json`.

| key | shape |
|---|---|
| `date` | `YYYY-MM-DD`. Defaults to today. |
| `sleep` | `duration_minutes`, or `bedtime` + `wake_time`. Optional `quality` 1–5, `notes`. |
| `activities[]` | `category`, `duration_minutes`, optional `title`, `start_time`, `notes`. Unknown categories are created. |
| `workout` or `workouts[]` | `type`, `duration_minutes`, `notes`, `exercises[]` → `name`, `sets[]` → `weight_kg`, `reps`, `duration_sec`. |
| `food[]` | `name`, `quantity`, `unit`, `meal`, `calories`, `protein`, `carbs`, `fat`, `fiber`. Known foods fill their own macros. |
| `weight` | a number, or `{ "value": 78.4, "unit": "kg", "note": "" }`. |
| `measurements` | `{ "Chest": 100 }` or `[{ "name": "Chest", "value": 100, "unit": "cm" }]`. |
| `review` | `planned`, `completed`, `journal`. |

Several days at once: send an array, or `{ "days": [ … ] }`.

A prompt that works with any assistant:

> Convert this into LifeOS import JSON. Use the schema with date, sleep,
> activities, workout, food, weight, measurements, review. Durations in minutes,
> weights in kg. Reply with JSON only.

---

## 6. Backup and restore

**More → Data & backup.**

- **Download full backup (JSON)** — every record, including performance tests and
  their results, deleted rows, and your settings. This file alone can rebuild the app anywhere.
- **Copy backup to clipboard** — same content, for when downloads are awkward on
  a phone.
- **Download CSV files** — activities, food, sleep, weight, measurements, workout
  sets and reviews, as separate spreadsheet-ready files with ids resolved to names.
- **Restore** — choose a backup file, then **Merge** (adds to what is here) or
  **Replace everything** (wipes this device first). Both ask for confirmation.

Back up before you replace anything. Restore is the one operation that can lose
data, which is why it takes two deliberate taps.

The backup format is documented by its own contents: `data` holds one array per
table with plain column names. Moving to a different backend later means reading
that file, not extracting anything from this app.

---

## 7. Notes and deliberate limits

- Sleep quality is your own 1–5 rating and is labelled as such. It is not a
  measurement and the app never treats it as one.
- Measurement changes are shown as `99 → 100 cm, +1`. Whether that is good
  depends on what you were training for, so the app does not colour it.
- Days with no food logged show as zero in charts, and the app says so under the
  chart rather than letting a zero look like a fast.
- Food is logged in the unit you actually measure it in: eggs and bananas in
  pieces, rice and chicken in grams, milk in millilitres. Tapping a food adds one
  normal helping, and tapping it again adds another — three taps on Egg means
  three eggs. Changing the quantity, by typing or with the − and + buttons,
  recalculates the calories and macros; typing over a value yourself stops the
  app recalculating and your own numbers stand. Tap any entry in Health → Food to
  correct it afterwards. Foods you have logged before appear at the top of the
  search with the values you saved, so the list grows from what you actually eat.
- Weight charts do not start at zero (small changes would be invisible), and the
  chart says to read the direction rather than the slope.
- No stock, finance, or social features, by design.

## 7a. Hosting and updates

See **DEPLOY.md** for the GitHub Pages walkthrough, how to publish an update
(`python3 bump.py`, then push), and how to hand the project to an AI assistant
later. The short version: the app and your data are separate, so redeploying
never risks what you have recorded.

## 8. Troubleshooting

**Opening the saved HTML file stays on "LifeOS opening…" (laptop).** Browsers
block the app database on pages opened straight from the file system. LifeOS now
notices within a second and saves to ordinary browser storage instead, so it
starts and keeps your data between reloads. The hosted link is still the better
way to run it — that gets the real database, installs as an app and syncs.

**"The object store uses out-of-line keys…" or "One of the specified object
stores was not found."** Both mean the browser's copy of the database is missing
a table or has one built wrongly, usually after an interrupted upgrade. LifeOS
now checks the shape of every table when it opens and rebuilds anything faulty,
keeping the tables that are fine — so this repairs itself on the next open. If
a rebuild is still not possible, the app falls back to browser storage and keeps
working rather than refusing to start.

**"One of the specified object stores was not found."** An older copy of the app
created the database before some tables existed. The current build upgrades it
automatically on next open — and if a store is ever missing it rebuilds it rather
than refusing to start. Nothing already saved is lost. If you still see it,
close every other tab that has LifeOS open and reload.


**Nothing saves in Safari private browsing.** IndexedDB is blocked there; the app
falls back to memory for that session and warns in the console. Use a normal tab.

**Sign-in says "Email not confirmed".** Confirm via the Supabase email, or turn
confirmation off in Authentication → Providers → Email.

**Sync error 42501 or "permission denied".** The SQL from `supabase/schema.sql`
did not run completely — run it again; it is safe to repeat.

**Sheets, the timer and the back button.** Sheets close on one tap, and the
phone's back gesture closes the top sheet rather than leaving the app. The timer
bar floats above the tab bar on every screen and carries Pause/Resume, Delete
(with a confirmation) and Save.

**Changed a file but the app looks the same.** The service worker cached the old
shell. Bump `CACHE` in `sw.js` (`lifeos-v1` → `lifeos-v2`) and reload twice.
