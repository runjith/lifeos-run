/* Two devices, one account, one fake Supabase.
   Covers: first sign-in, second device sign-in, existing local data, existing
   cloud data, the different-account guard, and offline -> online catch-up. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const FDBFactory = require("fake-indexeddb/lib/FDBFactory");
const FDBKeyRange = require("fake-indexeddb/lib/FDBKeyRange");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const FILES = ["js/config.js", "js/util.js", "js/data/seed.js", "js/db.js", "js/store.js",
  "js/ui.js", "js/charts.js", "js/forms.js", "js/day-sheet.js", "js/insights.js", "js/perf.js", "js/weekly.js",
  "js/timer-ui.js", "js/importer.js", "js/exporter.js", "js/cloud.js", "js/screens/home.js",
  "js/screens/time.js", "js/screens/health.js", "js/screens/progress.js", "js/screens/more.js",
  "js/app.js"].map(f => ({ f, src: fs.readFileSync(path.join(ROOT, f), "utf8") }));

let failed = false;
const assert = (c, m) => { if (!c) { failed = true; console.error("  FAIL:", m); } else console.log("  ok:", m); };
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ server */
function makeServer() {
  const tables = {};                      // table -> { id: row }
  const users = {};                       // email -> { id, password }
  let nextId = 1;

  function bearerUser(headers) {
    const auth = (headers || {}).Authorization || "";
    return auth.replace("Bearer tok_", "") || null;
  }
  function reply(status, body) {
    return Promise.resolve({
      ok: status < 400, status,
      text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body))
    });
  }

  const server = {
    tables,
    rows(table) { return Object.values(tables[table] || {}); },
    count(table, userId) {
      return server.rows(table).filter(r => !r.deleted_at && (!userId || r.user_id === userId)).length;
    },
    userId(email) { return users[email] && users[email].id; },
    fetch(url, opts) {
      opts = opts || {};
      const body = opts.body ? JSON.parse(opts.body) : null;
      const u = new URL(url);
      const p = u.pathname;

      if (p === "/auth/v1/signup" || p === "/auth/v1/token") {
        if (p.endsWith("signup")) {
          if (users[body.email]) return reply(400, { msg: "User already registered" });
          users[body.email] = { id: "user" + nextId++, password: body.password };
        }
        const grant = u.searchParams.get("grant_type");
        if (grant === "refresh_token") {
          const id = String(body.refresh_token).replace("ref_", "");
          return reply(200, { access_token: "tok_" + id, refresh_token: "ref_" + id, user: { id } });
        }
        const acct = users[body.email];
        if (!acct || (body.password && acct.password !== body.password)) {
          return reply(400, { error_description: "Invalid login credentials" });
        }
        return reply(200, {
          access_token: "tok_" + acct.id, refresh_token: "ref_" + acct.id,
          user: { id: acct.id, email: body.email }
        });
      }
      if (p === "/auth/v1/logout") return reply(204);

      if (p.indexOf("/rest/v1/") === 0) {
        const table = p.replace("/rest/v1/", "");
        const uid = bearerUser(opts.headers);
        if (!uid) return reply(401, { message: "JWT expired" });
        tables[table] = tables[table] || {};
        if ((opts.method || "GET") === "POST") {
          body.forEach(row => {
            if (row.user_id !== uid) throw new Error("row for the wrong account reached the server");
            tables[table][row.id] = Object.assign({}, row);
          });
          return reply(201);
        }
        let rows = Object.values(tables[table]).filter(r => r.user_id === uid);
        const gt = u.searchParams.get("updated_at");
        if (gt && gt.indexOf("gt.") === 0) {
          const since = gt.slice(3);
          rows = rows.filter(r => r.updated_at > since);
        }
        rows.sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
        return reply(200, rows);
      }
      return reply(404, { message: "not found" });
    }
  };
  return server;
}

/* ------------------------------------------------------------------ device */
async function makeDevice(name, server) {
  const dom = new JSDOM(HTML, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  const idb = new FDBFactory();
  window.indexedDB = idb; window.IDBKeyRange = FDBKeyRange;
  window.crypto = require("crypto").webcrypto;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

  let online = true;
  Object.defineProperty(window.navigator, "onLine", { get: () => online, configurable: true });
  window.fetch = (url, opts) => (online
    ? server.fetch(url, opts)
    : Promise.reject(new TypeError("Failed to fetch")));

  // the app's modules read these as bare globals
  global.window = window; global.document = window.document;
  global.navigator = window.navigator; global.localStorage = window.localStorage;
  global.crypto = window.crypto; global.indexedDB = idb; global.IDBKeyRange = FDBKeyRange;
  global.fetch = window.fetch;

  FILES.forEach(({ src }) => window.eval(src));
  const LX = window.LX;
  LX.CONFIG.SUPABASE_URL = "https://cloud.test";
  LX.CONFIG.SUPABASE_ANON_KEY = "anon-key";

  const device = {
    name, window, LX,
    activate() {                       // jsdom globals are shared, so re-point them
      global.window = window; global.document = window.document;
      global.navigator = window.navigator; global.localStorage = window.localStorage;
      global.crypto = window.crypto; global.indexedDB = idb; global.IDBKeyRange = FDBKeyRange;
      global.fetch = window.fetch;
    },
    setOnline(v) { online = v; },
    count: (store) => LX.db.all(store).then(r => r.length),
    names: (store) => LX.db.all(store).then(r => r.map(x => x.name).sort())
  };
  await LX.app.boot();
  return device;
}

/* ------------------------------------------------------------------- run */
(async () => {
  const server = makeServer();

  // ---------------------------------------------------------------- device A
  console.log("\n-- device A: existing local data, then first sign-in --");
  const A = await makeDevice("A", server);
  const LXA = A.LX;
  const today = LXA.D.today();
  const workA = LXA.store.cat("work").id;
  await LXA.store.addActivity({ date: today, category_id: workA, duration_minutes: 120, title: "Store accounts" });
  await LXA.store.saveWorkout({
    date: today, type: "Upper", duration_minutes: 60,
    exercises: [{ name: "Bench Press", sets: [{ weight_kg: 80, reps: 5 }] }]
  });
  await LXA.perf.saveResult(LXA.perf.tests.find(t => t.name === "Cindy"), { date: today, rounds: 18 });
  await LXA.weekly.saveLog(LXA.weekly.goals.find(g => g.name.indexOf("Handstand") === 0), { date: today, value: 11 });
  const localActivitiesBefore = await A.count("activities");

  const signUp = await LXA.cloud.signUp("me@example.com", "password123");
  assert(signUp.signedIn, "device A creates an account and is signed in");
  const uid = server.userId("me@example.com");

  let r = await LXA.cloud.sync();
  assert(!r.skipped, "device A's first sync runs");
  assert(server.count("categories", uid) === LXA.store.categories.length, "all categories reached the cloud");
  assert(server.count("activities", uid) === localActivitiesBefore, "activities reached the cloud");
  assert(server.count("workout_sets", uid) === 1, "workout sets reached the cloud");
  assert(server.count("strength_results", uid) === 1, "the Cindy result reached the cloud");
  assert(server.count("weekly_goal_logs", uid) === 1, "the weekly goal entry reached the cloud");
  assert(await A.count("activities") === localActivitiesBefore, "nothing local was deleted by signing in");
  assert((await LXA.db.outbox()).length === 0, "the outbox is empty after a successful sync");

  // ---------------------------------------------------------------- device B
  console.log("\n-- device B: fresh device with its own offline data --");
  const B = await makeDevice("B", server);
  const LXB = B.LX;
  const workB = LXB.store.cat("work").id;
  assert(workB !== workA, "device B seeded its own separate 'Work' category");
  B.setOnline(false);
  await LXB.store.addActivity({ date: today, category_id: workB, duration_minutes: 45, title: "Offline note" });
  await LXB.store.addFood({ date: today, meal: "Lunch", name: "Chicken breast", quantity: 200, unit: "g", calories: 330, protein: 62 });
  const offlineSync = await LXB.cloud.sync({ quiet: true });
  assert(offlineSync.skipped === "signed out", "a not-yet-signed-in device simply skips syncing");
  assert(await B.count("activities") === 1, "the offline entry is saved locally anyway");

  B.setOnline(true);
  const signIn = await LXB.cloud.signIn("me@example.com", "password123");
  assert(!signIn.accountChanged, "signing into the same account asks no questions");
  r = await LXB.cloud.sync();
  assert(r.adopted > 0, "device B adopted the account's existing lists (" + r.adopted + " entries)");

  const catsB = await LXB.db.all("categories");
  const dupCats = catsB.filter(c => c.slug === "work");
  assert(dupCats.length === 1, "device B has exactly one 'Work' category (got " + dupCats.length + ")");
  assert(dupCats[0].id === workA, "and it is the account's one, not the device's own");
  const exB = await LXB.db.all("exercises");
  assert(exB.filter(e => e.name === "Bench Press").length === 1, "exactly one 'Bench Press' exercise");
  const testsB = await LXB.db.all("strength_tests");
  assert(testsB.filter(t => t.name === "Cindy").length === 1, "exactly one 'Cindy' test");
  const wgB = await LXB.db.all("weekly_goals");
  assert(wgB.filter(g => g.name.indexOf("Handstand") === 0).length === 1,
    "exactly one 'Handstand practice' weekly goal, not one per device");
  assert(catsB.length === LXA.store.categories.length, "category list is the same size on both devices");

  const offlineRow = (await LXB.db.all("activities")).find(a => a.title === "Offline note");
  assert(offlineRow.category_id === workA, "the offline entry was re-pointed at the account's category");

  const bActs = await LXB.db.all("activities");
  assert(bActs.some(a => a.title === "Store accounts"), "device B pulled device A's activity");
  assert((await LXB.db.all("workout_sets")).length === 1, "device B pulled the workout sets");
  assert((await LXB.db.all("strength_results")).length === 1, "device B pulled the Cindy result");
  const wlB = await LXB.db.all("weekly_goal_logs");
  assert(wlB.length === 1 && wlB[0].value === 11, "device B pulled the weekly goal entry");
  assert(wgB.some(g => g.id === wlB[0].goal_id), "and it points at the account's own goal");
  assert(server.count("categories", uid) === catsB.length, "no duplicate categories were pushed to the cloud");
  assert(server.count("exercises", uid) === exB.length, "no duplicate exercises were pushed to the cloud");

  // reconciliation is a one-off
  r = await LXB.cloud.sync();
  assert(!r.adopted, "reconciliation does not run again on later syncs");

  // ------------------------------------------------------- back to device A
  console.log("\n-- device A picks up device B's work --");
  A.activate();
  r = await LXA.cloud.sync();
  const aActs = await LXA.db.all("activities");
  assert(aActs.some(a => a.title === "Offline note"), "device A sees the entry device B made offline");
  assert((await LXA.db.all("food_entries")).length === 1, "device A sees device B's food entry");
  assert(aActs.some(a => a.title === "Store accounts"), "device A's own data is still there");
  assert((await LXA.db.all("categories")).length === catsB.length, "device A gained no duplicates either");

  // ------------------------------------------------- offline -> online again
  console.log("\n-- offline changes catch up when the connection returns --");
  B.activate();
  B.setOnline(false);
  const whileOffline = await LXB.cloud.sync({ quiet: true });
  assert(whileOffline.skipped === "offline", "a signed-in device with no connection skips instead of failing");
  await LXB.store.saveSleep({ date: today, bedtime: "23:00", wake_time: "06:30" });
  await LXB.store.saveWeight({ date: today, weight: 78.4, unit: "kg" });
  assert((await LXB.db.outbox()).length >= 2, "offline changes wait in the outbox");
  B.setOnline(true);
  r = await LXB.cloud.sync();
  assert(r.pushed >= 2, "they are pushed once the connection is back");
  assert(server.count("sleep_records", uid) === 1 && server.count("weight_records", uid) === 1,
    "the cloud now holds the offline sleep and weight");
  A.activate();
  await LXA.cloud.sync();
  assert((await LXA.db.all("sleep_records")).length === 1, "device A receives them too");

  // --------------------------------------------------- different account guard
  console.log("\n-- a different account on the same device --");
  A.activate();
  await LXA.cloud.signOut();
  assert(await A.count("activities") === aActs.length, "signing out keeps every local record");
  await LXA.cloud.signUp("someone.else@example.com", "password123");   // a second account exists
  await LXA.cloud.signOut();
  await LXA.cloud.signIn("me@example.com", "password123");             // back to the owner, no warning
  await LXA.cloud.sync();

  const other = await LXA.cloud.signIn("someone.else@example.com", "password123");
  assert(other.accountChanged === true, "signing into another account is flagged");
  assert(other.localRows > 0, "and it reports how many local records are at stake (" + other.localRows + ")");
  const blocked = await LXA.cloud.sync();
  assert(blocked.skipped && blocked.skipped.indexOf("confirm") > -1, "nothing syncs until the question is answered");
  const otherUid = server.userId("someone.else@example.com");
  assert(server.count("activities", otherUid) === 0, "no data leaked into the other account");
  await LXA.cloud.signOut();
  assert(await A.count("activities") === aActs.length, "declining leaves local data untouched");
  assert(server.count("activities", uid) === aActs.length, "and the original account's cloud data is untouched");

  // ------------------------------------------------- sign in again after a wipe
  console.log("\n-- signing in again on a cleared device --");
  const C = await makeDevice("C", server);
  await C.LX.cloud.signIn("me@example.com", "password123");
  await C.LX.cloud.sync();
  assert((await C.LX.db.all("activities")).length === aActs.length, "a cleared device restores every activity");
  assert((await C.LX.db.all("categories")).length === catsB.length, "with no duplicate categories");
  assert((await C.LX.db.all("strength_results")).length === 1, "and the performance results");
  assert((await C.LX.db.all("weekly_goal_logs")).length === 1, "and the weekly goal record");

  console.log(failed ? "\nFAILURES ABOVE" : "\nCloud sync OK");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
