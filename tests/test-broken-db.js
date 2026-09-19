/* Reproduces the laptop error:
   "Failed to execute 'put' on 'IDBObjectStore': The object store uses
    out-of-line keys and has no key generator and the key parameter was not
    provided."
   It happens when a database is left holding a store that was created without a
   key field. The app must repair it and start. */
const fs = require("fs"), path = require("path");
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
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch = () => Promise.reject(new Error("offline"));

let failed = false;
const assert = (c, m) => { if (!c) { failed = true; console.error("  FAIL:", m); } else console.log("  ok:", m); };

/* A database in exactly the broken shape: kv and outbox created with no key
   field at all, and one data store likewise. */
function makeBrokenDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("lifeos", 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      db.createObjectStore("kv");                                  // no keyPath — the fault
      db.createObjectStore("outbox");                              // no keyPath, no generator
      db.createObjectStore("categories");                          // no keyPath
      const ok = db.createObjectStore("weight_records", { keyPath: "id" });
      ok.createIndex("date", "date", { unique: false });
    };
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction("weight_records", "readwrite");
      t.objectStore("weight_records").put({
        id: "w1", date: "2026-09-01", weight: 79.2, unit: "kg",
        updated_at: "2026-09-01T06:00:00Z", deleted_at: null
      });
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
}

(async () => {
  await makeBrokenDatabase();
  console.log("created a database with malformed stores");

  for (const f of ["js/config.js", "js/util.js", "js/data/seed.js", "js/db.js", "js/store.js",
    "js/ui.js", "js/charts.js", "js/forms.js", "js/day-sheet.js", "js/insights.js", "js/perf.js",
    "js/timer-ui.js", "js/importer.js", "js/exporter.js", "js/cloud.js", "js/screens/home.js",
    "js/screens/time.js", "js/screens/health.js", "js/screens/progress.js", "js/screens/more.js",
    "js/app.js"]) {
    window.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
  }
  const LX = window.LX;

  await LX.app.boot();
  assert(!document.getElementById("boot"), "the app starts instead of showing 'LifeOS could not start'");
  const view = document.getElementById("view").innerHTML;
  assert(view.indexOf("could not start") === -1, "no start-up error banner");
  assert(view.indexOf("out-of-line") === -1, "the IndexedDB error is gone");

  assert(LX.store.categories.length > 10, "categories seeded into the repaired store");
  assert(LX.store.exercises.length > 20, "exercises seeded");

  // the well-formed store was left alone, so real data survived the repair
  const weights = await LX.db.all("weight_records");
  assert(weights.length === 1 && weights[0].weight === 79.2, "data in healthy stores survived the repair");

  // and the app works normally afterwards
  await LX.store.addActivity({ date: LX.D.today(), category_id: LX.store.cat("work").id, duration_minutes: 60 });
  assert((await LX.db.all("activities")).length === 1, "new entries save after the repair");
  await LX.db.setKV("probe", 42);
  assert(await LX.db.getKV("probe", null) === 42, "settings storage works after the repair");
  assert((await LX.db.outbox()).length > 0, "the sync queue works after the repair");

  await LX.app.go("home");
  await new Promise(r => setTimeout(r, 40));
  assert(document.getElementById("view").innerHTML.indexOf("Where the day went") > -1, "Home renders");

  console.log(failed ? "\nFAILURES ABOVE" : "\nBroken-database repair OK");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
