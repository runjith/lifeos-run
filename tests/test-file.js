/* Reproduces the laptop file:// hang: a browser where IndexedDB requests never
   answer at all. The app must still start, and must keep data in browser
   storage so it survives a reload. */
const fs = require("fs"), path = require("path");
const { JSDOM } = require("jsdom");
const ROOT = path.join(__dirname, "..");
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"),
  { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;
global.window = window; global.document = window.document;
global.navigator = window.navigator; global.localStorage = window.localStorage;
global.crypto = require("crypto").webcrypto; window.crypto = global.crypto;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.fetch = () => Promise.reject(new Error("offline"));
// open() returns a request that never fires success or error — exactly what
// Chrome does with a page opened straight from the file system.
window.indexedDB = { open: () => ({}) };

let failed = false;
const assert = (c, m) => { if (!c) { failed = true; console.error("ASSERT FAIL:", m); } else console.log("  ok:", m); };

(async () => {
  console.log("starting file:// test");
  for (const f of ["js/config.js", "js/util.js", "js/data/seed.js", "js/db.js", "js/store.js",
    "js/ui.js", "js/charts.js", "js/forms.js", "js/day-sheet.js", "js/insights.js", "js/perf.js",
    "js/timer-ui.js", "js/importer.js", "js/exporter.js", "js/cloud.js", "js/screens/home.js",
    "js/screens/time.js", "js/screens/health.js", "js/screens/progress.js", "js/screens/more.js", "js/app.js"]) {
    window.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
  }
  const LX = window.LX;
  const t0 = Date.now();
  await LX.app.boot();
  const took = Date.now() - t0;
  assert(!document.getElementById("boot"), "the app gets past the splash screen (" + took + "ms)");
  assert(took < 6000, "it does not hang waiting for the database");
  assert(LX.db.storageMode() === "browser-storage", "it reports the fallback storage mode");
  assert(LX.store.categories.length > 10, "categories still seed");

  await LX.store.addActivity({ date: LX.D.today(), category_id: LX.store.cat("work").id, duration_minutes: 90 });
  await new Promise(r => setTimeout(r, 400));   // the fallback saves shortly after a write
  const saved = JSON.parse(window.localStorage.getItem("lifeos_fallback") || "{}");
  assert(saved.activities && saved.activities.length === 1, "the activity is written to browser storage so it survives a reload");

  await LX.app.go("home");
  await new Promise(r => setTimeout(r, 40));
  assert(document.getElementById("view").innerHTML.indexOf("Where the day went") > -1, "Home renders normally");
  console.log(failed ? "\nFAILURES ABOVE" : "\nfile:// fallback OK");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
