/* Reproduces the laptop failure: a database created by the older build (version 1,
   without the strength stores) must upgrade in place instead of throwing
   "One of the specified object stores was not found". */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
require("fake-indexeddb/auto");

const ROOT = path.join(__dirname, "..");
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"),
  { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;
global.window = window; global.document = window.document;
global.navigator = window.navigator; global.localStorage = window.localStorage;
global.crypto = require("crypto").webcrypto; window.crypto = global.crypto;
window.indexedDB = indexedDB; window.IDBKeyRange = IDBKeyRange;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.fetch = () => Promise.reject(new Error("offline"));

const OLD_STORES = ["categories", "activities", "exercises", "workouts", "workout_exercises",
  "workout_sets", "food_entries", "sleep_records", "weight_records", "body_measurements",
  "goals", "daily_reviews", "profiles"];

function openOldDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("lifeos", 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      OLD_STORES.forEach(n => {
        const os = db.createObjectStore(n, { keyPath: "id" });
        os.createIndex("updated_at", "updated_at", { unique: false });
      });
      db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      db.createObjectStore("kv", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function put(db, store, rec) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).put(rec);
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}

let failed = false;
function assert(c, m) { if (!c) { failed = true; console.error("ASSERT FAIL:", m); } else console.log("  ok:", m); }

(async () => {
  // an existing install with some real data in it
  const old = await openOldDatabase();
  await put(old, "weight_records", { id: "w1", date: "2026-09-01", weight: 79.2, unit: "kg", updated_at: "2026-09-01T06:00:00Z", deleted_at: null });
  await put(old, "kv", { key: "seeded", value: true });
  old.close();
  console.log("created a version-1 database with 1 weight record");

  for (const f of ["js/config.js", "js/util.js", "js/data/seed.js", "js/db.js", "js/store.js",
    "js/ui.js", "js/charts.js", "js/forms.js", "js/perf.js", "js/weekly.js", "js/timer-ui.js",
    "js/importer.js", "js/exporter.js", "js/cloud.js", "js/screens/home.js", "js/screens/time.js",
    "js/screens/health.js", "js/screens/progress.js", "js/screens/more.js", "js/app.js"]) {
    window.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
  }
  const LX = window.LX;

  await LX.app.boot();
  const boot = document.getElementById("boot");
  assert(!boot, "the app starts instead of showing a start-up error");
  assert(document.getElementById("view").innerHTML.indexOf("could not start") === -1, "no 'could not start' banner");

  const weights = await LX.db.all("weight_records");
  assert(weights.length === 1 && weights[0].weight === 79.2, "the existing weight record survived the upgrade");

  const tests = await LX.db.all("strength_tests");
  assert(tests.length >= 5, "the new strength stores were created and seeded (" + tests.length + " tests)");

  const goals = await LX.db.all("weekly_goals");
  assert(goals.length >= 2, "the weekly goal stores were created and seeded (" + goals.length + " goals)");
  const hand = goals.find(g => g.name.indexOf("Handstand") === 0);
  await LX.weekly.saveLog(hand, { date: LX.D.today(), value: 12 });
  const wlogs = await LX.weekly.logs(hand.id);
  assert(wlogs.length === 1 && wlogs[0].week_start === LX.D.weekStart(LX.D.today()),
    "weekly entries can be written to the upgraded database");

  const cindy = LX.perf.tests.find(t => t.name === "Cindy");
  await LX.perf.saveResult(cindy, { date: LX.D.today(), rounds: 16 });
  assert((await LX.perf.results(cindy.id)).length === 1, "results can be written to the upgraded database");

  await LX.app.go("home");
  await new Promise(r => setTimeout(r, 30));
  assert(document.getElementById("view").innerHTML.length > 400, "Home renders on the upgraded database");

  console.log(failed ? "\nFAILURES ABOVE" : "\nUpgrade path OK");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
