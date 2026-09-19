/* Smoke test: boot LifeOS in jsdom, seed some data, render every screen. */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
require("fake-indexeddb/auto");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.localStorage = window.localStorage;
global.crypto = require("crypto").webcrypto;
window.crypto = global.crypto;
window.indexedDB = indexedDB;
window.IDBKeyRange = IDBKeyRange;
global.indexedDB = indexedDB;
window.matchMedia = window.matchMedia || function () {
  return { matches: false, addEventListener() {}, removeEventListener() {} };
};
window.fetch = () => Promise.reject(new Error("offline in test"));
global.fetch = window.fetch;

const files = [
  "js/config.js", "js/util.js", "js/data/seed.js", "js/db.js", "js/store.js",
  "js/ui.js", "js/charts.js", "js/forms.js", "js/day-sheet.js", "js/insights.js", "js/perf.js", "js/timer-ui.js",
  "js/importer.js", "js/exporter.js", "js/cloud.js",
  "js/screens/home.js", "js/screens/time.js", "js/screens/health.js",
  "js/screens/progress.js", "js/screens/more.js", "js/app.js"
];
for (const f of files) {
  try {
    window.eval(fs.readFileSync(path.join(ROOT, f), "utf8"));
  } catch (e) {
    console.error("LOAD FAIL", f, e.message);
    process.exit(1);
  }
}

const LX = window.LX;

function assert(cond, msg) {
  if (!cond) { console.error("ASSERT FAIL:", msg); process.exitCode = 1; }
  else console.log("  ok:", msg);
}

(async function run() {
  await LX.app.boot();
  console.log("booted; screen =", document.getElementById("app-title").textContent);
  assert(LX.store.categories.length > 10, "categories seeded");
  assert(LX.store.exercises.length > 20, "exercises seeded");

  // seed a realistic couple of days through the public API
  const today = LX.D.today(), yday = LX.D.add(today, -1);
  const cat = n => LX.store.categories.find(c => c.slug === n).id;
  await LX.store.addActivity({ date: today, category_id: cat("work"), duration_minutes: 430, start_time: "09:30", title: "Store accounts" });
  await LX.store.addActivity({ date: today, category_id: cat("exercise"), duration_minutes: 68 });
  await LX.store.addActivity({ date: today, category_id: cat("youtube"), duration_minutes: 56 });
  await LX.store.addActivity({ date: yday, category_id: cat("work"), duration_minutes: 380 });
  await LX.store.saveSleep({ date: today, bedtime: "23:10", wake_time: "06:34", quality: 4 });
  await LX.store.saveSleep({ date: yday, bedtime: "23:40", wake_time: "06:20", quality: 3 });
  await LX.store.addFood({ date: today, meal: "Breakfast", name: "Egg (whole)", quantity: 4, unit: "piece", calories: 312, protein: 25 });
  await LX.store.saveWeight({ date: today, weight: 78.4, unit: "kg" });
  await LX.store.saveWeight({ date: yday, weight: 78.9, unit: "kg" });
  await LX.store.saveMeasurements(today, [{ name: "Chest", value: 100 }, { name: "Waist", value: 81 }]);
  await LX.store.saveMeasurements(yday, [{ name: "Chest", value: 99 }, { name: "Waist", value: 83 }]);
  await LX.store.saveWorkout({
    date: today, type: "Upper", duration_minutes: 65,
    exercises: [{ name: "Bench Press", sets: [{ weight_kg: 70, reps: 8 }, { weight_kg: 70, reps: 7 }] }]
  });

  const s = await LX.store.daySummary(today);
  assert(s.sleepMinutes === 444, "sleep computed across midnight (got " + s.sleepMinutes + ")");
  assert(s.buckets.untracked === 1440 - (430 + 68 + 56 + 444), "untracked = 24h minus tracked (got " + s.buckets.untracked + ")");
  assert(s.nutrition.calories === 312, "calories summed");

  // JSON import round trip
  const res = LX.importer.validate(JSON.stringify(LX.importer.SAMPLE));
  assert(res.ok, "sample JSON validates (" + res.errors.join("; ") + ")");
  assert(res.items.length > 8, "preview lists " + res.items.length + " entries");
  const bad = LX.importer.validate('{"date":"nope","food":[{"quantity":2}]}');
  assert(!bad.ok && bad.errors.length, "bad JSON is rejected with an explanation");
  const written = await LX.importer.apply(res);
  assert(written > 0, "import wrote " + written + " records");

  // backup round trip
  const backup = await LX.exporter.buildBackup();
  assert(backup.data.activities.length > 0, "backup contains activities");
  const csvs = await LX.exporter.csvFiles();
  assert(csvs.length >= 4, "csv export produced " + csvs.length + " files");
  await LX.exporter.restore(backup, "replace");
  const after = await LX.exporter.counts();
  assert(after.activities === backup.data.activities.length, "restore rebuilt activities");

  // render every screen
  for (const key of ["home", "time", "health", "progress", "more"]) {
    await LX.app.go(key);
    await new Promise(r => setTimeout(r, 20));
    const v = document.getElementById("view");
    assert(v.innerHTML.length > 400, key + " renders (" + v.innerHTML.length + " chars)");
    assert(v.innerHTML.indexOf("undefined") === -1, key + " has no 'undefined' in output");
    assert(v.innerHTML.indexOf("NaN") === -1, key + " has no NaN in output");
  }

  // sub-tabs of Health and Progress
  for (const t of ["nutrition", "sleep", "weight", "body"]) {
    document.querySelector('[data-tab="health"]');
    await LX.app.go("health");
    const btn = document.querySelector('#view [data-tab="' + t + '"]');
    btn.click();
    await new Promise(r => setTimeout(r, 40));
    assert(document.getElementById("view").innerHTML.indexOf("NaN") === -1, "health/" + t + " clean");
  }
  for (const sct of ["body", "fitness", "nutrition"]) {
    await LX.app.go("progress");
    document.querySelector('#view [data-section="' + sct + '"]').click();
    await new Promise(r => setTimeout(r, 40));
    assert(document.getElementById("view").innerHTML.indexOf("NaN") === -1, "progress/" + sct + " clean");
  }

  // sheets open and close
  await LX.app.go("home");
  document.querySelector('[data-quick="food"]').click();
  await new Promise(r => setTimeout(r, 30));
  assert(document.querySelector(".sheet"), "log food sheet opens");
  LX.ui.closeAllSheets();

  // timer
  LX.forms.startTimer(cat("coding"));
  assert(LX.forms.timerState().running, "timer starts");
  LX.forms.pauseTimer();
  assert(!LX.forms.timerState().running, "timer pauses");
  LX.forms.discardTimer();

  // ---------------------------------------------------------------- strength & performance
  console.log("\n-- strength & performance tests --");
  const perf = LX.perf;
  const T = name => perf.tests.find(t => t.name === name);
  assert(!!T("Cindy") && !!T("Push-ups") && !!T("Pull-ups") && !!T("Dips") && !!T("Running"), "default tests seeded");

  const workoutsBefore = (await LX.db.all("workouts")).length;
  const actsBefore = (await LX.db.all("activities")).length;

  // Cindy: 17, 18, 19 rounds on consecutive days
  const cindy = T("Cindy");
  const d3 = LX.D.add(today, -4), d2 = LX.D.add(today, -2), d1 = today;
  await perf.saveResult(cindy, { date: d3, rounds: 17 });
  await perf.saveResult(cindy, { date: d2, rounds: 18 });
  await perf.saveResult(cindy, { date: d1, rounds: 19, extra_reps: 4 });
  let a = await perf.analytics(cindy.id);
  assert(a.series.length === 1, "Cindy has one series");
  assert(a.series[0].results.length === 3, "Cindy history shows 3 results");
  assert(a.series[0].latest.rounds === 19, "Cindy latest = 19");
  assert(a.series[0].best.rounds === 19, "Cindy best = 19");
  assert(a.series[0].results.map(r => r.date).join() === [d3, d2, d1].join(), "Cindy chart is chronological");
  assert(a.series[0].improved === true, "Cindy trend reads as improvement");

  // Push-ups at 100 reps, then a different target
  const pu = T("Push-ups");
  await perf.saveResult(pu, { date: d3, target_reps: 100, actual_reps: 100, time_seconds: perf.parseTime("6:42") });
  await perf.saveResult(pu, { date: d2, target_reps: 100, actual_reps: 100, time_seconds: perf.parseTime("6:18") });
  await perf.saveResult(pu, { date: d1, target_reps: 100, actual_reps: 100, time_seconds: perf.parseTime("5:57") });
  a = await perf.analytics(pu.id);
  assert(a.series.length === 1, "push-ups: one series at 100 reps");
  assert(perf.fmtTime(a.series[0].best.time_seconds) === "5:57", "push-ups best = 5:57");
  assert(a.series[0].improved === true, "push-ups trend identifies improvement (lower time)");

  await perf.saveTest(Object.assign({}, pu, { target: 75 }));
  await perf.saveResult(T("Push-ups"), { date: today, target_reps: 75, actual_reps: 75, time_seconds: perf.parseTime("5:10") });
  a = await perf.analytics(pu.id);
  assert(a.series.length === 2, "push-ups now has two separate series");
  const s100 = a.series.find(x => x.key === "reps:100"), s75 = a.series.find(x => x.key === "reps:75");
  assert(s100.results.length === 3 && s75.results.length === 1, "75-rep result is not mixed into the 100-rep trend");
  assert(perf.fmtTime(s100.best.time_seconds) === "5:57", "100-rep best unchanged after target change");

  // Running: 2 km series, then a 5 km result
  const run = T("Running");
  await perf.saveResult(run, { date: d3, distance_km: 2, time_seconds: perf.parseTime("11:00") });
  await perf.saveResult(run, { date: d2, distance_km: 2, time_seconds: perf.parseTime("10:30") });
  await perf.saveResult(run, { date: d1, distance_km: 2, time_seconds: perf.parseTime("9:55") });
  a = await perf.analytics(run.id);
  let s2 = a.series.find(x => x.key === "dist:2");
  assert(perf.fmtTime(s2.latest.time_seconds) === "9:55", "2 km latest = 9:55");
  assert(perf.fmtTime(s2.best.time_seconds) === "9:55", "2 km best = 9:55");
  assert(perf.fmtPace(perf.pace(s2.latest.time_seconds, 2)) === "4:58/km", "pace computed (got " + perf.fmtPace(perf.pace(s2.latest.time_seconds, 2)) + ")");
  assert(perf.fmtPace(perf.pace(perf.parseTime("10:30"), 2)) === "5:15/km", "10:30 over 2 km = 5:15/km");
  await perf.saveResult(run, { date: today, distance_km: 5, time_seconds: perf.parseTime("28:00") });
  a = await perf.analytics(run.id);
  s2 = a.series.find(x => x.key === "dist:2");
  const s5 = a.series.find(x => x.key === "dist:5");
  assert(a.series.length === 2 && s2.results.length === 3 && s5.results.length === 1, "5 km kept separate from 2 km");

  // custom test
  const plank = await perf.saveTest({ name: "Plank", type: "time", target: null, unit: "seconds" });
  await perf.saveResult(perf.test(plank.id), { date: today, time_seconds: perf.parseTime("2:15") });
  a = await perf.analytics(plank.id);
  assert(a.count === 1 && perf.fmtScore(a.test, a.series[0].latest) === "2:15", "custom Plank test records 2:15");

  // editing updates in place
  a = await perf.analytics(cindy.id);
  const target = a.series[0].results[1];               // the 18-round entry
  const countBefore = a.series[0].results.length;
  await perf.saveResult(cindy, { id: target.id, date: target.date, rounds: 21, created_at: target.created_at });
  a = await perf.analytics(cindy.id);
  assert(a.series[0].results.length === countBefore, "editing does not create a duplicate");
  assert(a.series[0].best.rounds === 21, "best recalculates after an edit");
  assert(a.series[0].latest.rounds === 19, "latest still the most recent date");

  // deleting recalculates
  await perf.deleteResult(target.id);
  a = await perf.analytics(cindy.id);
  assert(a.series[0].results.length === countBefore - 1, "deleted result disappears from history");
  assert(a.series[0].best.rounds === 19, "best recalculates after a delete");

  // nothing leaked into workouts or activities
  assert((await LX.db.all("workouts")).length === workoutsBefore, "no performance result became a workout");
  assert((await LX.db.all("activities")).length === actsBefore, "no performance result became an activity");

  // backup carries the new tables; old backups still restore
  const b2 = await LX.exporter.buildBackup();
  assert(b2.data.strength_tests.length >= 6 && b2.data.strength_results.length > 5, "backup includes tests and results");
  const legacy = JSON.parse(JSON.stringify(b2));
  delete legacy.data.strength_tests;
  delete legacy.data.strength_results;
  await LX.exporter.restore(legacy, "merge");
  assert(true, "a backup without the new fields restores without error");
  await LX.exporter.restore(b2, "replace");
  await perf.init();
  a = await perf.analytics(perf.tests.find(t => t.name === "Cindy").id);
  assert(a.count === 2, "results survive an export/import round trip");

  // survives a "restart": re-open the store from the same database
  await LX.store.init();
  assert((await perf.results(null)).length > 5, "performance data still there after re-init");

  // the new screens render
  LX.screens.health.setTab("tests");
  await LX.app.go("health");
  await new Promise(r => setTimeout(r, 30));
  let v = document.getElementById("view").innerHTML;
  assert(v.indexOf("Cindy") > -1, "Tests tab lists the tests");
  assert(v.indexOf("NaN") === -1 && v.indexOf("undefined") === -1, "Tests tab output is clean");
  await LX.app.go("home");
  await new Promise(r => setTimeout(r, 30));
  v = document.getElementById("view").innerHTML;
  assert(v.indexOf("Strength") > -1, "Home shows the strength summary");
  assert(v.indexOf("NaN") === -1, "Home output still clean");

  // existing screens unaffected
  for (const key of ["time", "health", "progress", "more"]) {
    await LX.app.go(key);
    await new Promise(r => setTimeout(r, 20));
    const h = document.getElementById("view").innerHTML;
    assert(h.length > 400 && h.indexOf("NaN") === -1, key + " still renders after the addition");
  }

  // ---------------------------------------------------------------- interaction fixes
  console.log("\n-- sheets, taps and the timer --");
  const wait = (ms = 40) => new Promise(r => setTimeout(r, ms));
  const sheets = () => document.querySelectorAll(".sheet").length;

  await LX.app.go("home");
  for (let i = 0; i < 5; i++) await LX.app.refresh();   // re-render the same screen repeatedly
  await wait();
  document.querySelector('[data-quick="food"]').click();
  await wait();
  assert(sheets() === 1, "one tap opens exactly one sheet after repeated renders (got " + sheets() + ")");

  document.querySelector(".sheet [data-close]").click();
  await wait(320);
  assert(sheets() === 0, "a single tap on Cancel closes the sheet");

  document.querySelector('[data-quick="activity"]').click();
  await wait();
  document.querySelector(".sheet .sheet-head [data-close]").click();
  await wait(320);
  assert(sheets() === 0, "a single tap on the X closes the sheet");

  // stacked sheets close one level at a time, innermost first
  LX.forms.logWorkout({});
  await wait();
  document.querySelector(".sheet [data-add-ex]").click();
  await wait();
  assert(sheets() === 2, "picker opens on top of the workout sheet");
  document.querySelector(".sheet:last-of-type [data-close]").click();
  await wait(320);
  assert(sheets() === 1, "closing the picker leaves the workout sheet open");
  LX.ui.closeAllSheets();
  await wait(320);
  assert(sheets() === 0, "closeAllSheets clears the stack");

  // timer: starts from the picker, shows everywhere, and can be deleted
  await LX.app.go("time");
  await wait();
  document.querySelector("[data-timer-start]").click();
  await wait();
  document.querySelector(".sheet [data-cat]").click();
  await wait(320);
  assert(!!LX.forms.timerState() && LX.forms.timerState().running, "picking a category starts the timer");
  assert(sheets() === 0, "the category sheet closes once the timer starts");
  const barHTML = document.getElementById("timer-bar").innerHTML;
  assert(barHTML.indexOf('data-timer="stop"') > -1, "timer bar shows Save");
  assert(barHTML.indexOf('data-timer="discard"') > -1, "timer bar shows Delete");
  assert(barHTML.indexOf('data-timer="pause"') > -1, "timer bar shows Pause");

  await LX.app.go("progress");
  await wait();
  assert(document.getElementById("timer-bar").innerHTML.indexOf("clock") > -1, "timer stays visible on other screens");

  document.querySelector('#timer-bar [data-timer="discard"]').click();
  await wait();
  assert(sheets() === 1, "Delete asks for confirmation first");
  assert(!!LX.forms.timerState(), "timer is still running while the question is open");
  document.querySelector(".sheet [data-yes]").click();
  await wait(320);
  assert(!LX.forms.timerState(), "confirming Delete discards the timer");
  assert(document.getElementById("timer-bar").innerHTML === "", "timer bar clears itself");

  // saving a timer writes one activity, not several
  await LX.app.go("home");
  const before = (await LX.db.all("activities")).length;
  LX.forms.startTimer(cat("coding"));
  LX.timerUI.mount();
  await wait();
  document.querySelector('#timer-bar [data-timer="stop"]').click();
  await wait(120);
  const actsAfter = (await LX.db.all("activities")).length;
  assert(actsAfter === before + 1, "saving the timer logs exactly one activity (got " + (actsAfter - before) + ")");
  assert(!LX.forms.timerState(), "timer clears after saving");

  // ---------------------------------------------------------------- insights & drill-down
  console.log("\n-- insights, charts and drill-down --");

  // a few sessions of the big three so the trends have something to draw
  const lift = async (name, date, weight, reps) => {
    await LX.store.saveWorkout({
      date, type: "Full Body", duration_minutes: 60,
      exercises: [{ name, sets: [{ weight_kg: weight, reps }, { weight_kg: weight, reps: reps - 1 }] }]
    });
  };
  await lift("Back Squat", LX.D.add(today, -14), 100, 5);
  await lift("Back Squat", LX.D.add(today, -7), 105, 5);
  await lift("Back Squat", today, 110, 5);
  await lift("Bench Press", LX.D.add(today, -7), 75, 6);
  await lift("Bench Press", today, 80, 5);
  await lift("Deadlift", today, 140, 3);

  assert(Math.round(LX.insights.oneRM(100, 5)) === 117, "estimated 1RM uses Epley (100kg x 5 = 117)");

  LX.screens.health.setTab("insights");
  await LX.app.go("health");
  await wait(60);
  let iv = document.getElementById("view").innerHTML;
  assert(iv.indexOf("Back Squat") > -1 && iv.indexOf("Bench Press") > -1 && iv.indexOf("Deadlift") > -1,
    "Insights shows squat, bench and deadlift by default");
  assert(iv.indexOf("Personal bests") > -1, "Insights lists personal bests");
  assert(iv.indexOf("140") > -1, "heaviest deadlift set appears");
  assert(iv.indexOf("Est. 1RM") > -1, "estimated 1RM is shown and labelled");
  assert(iv.indexOf("NaN") === -1 && iv.indexOf("undefined") === -1, "Insights output is clean");

  // opening one lift's full history
  document.querySelector("#view [data-progression]").click();
  await wait(60);
  assert(sheets() === 1 && document.querySelector(".sheet").textContent.indexOf("Top weight") > -1,
    "tapping a lift opens its progression charts");
  LX.ui.closeAllSheets();
  await wait(320);

  // bars <-> line switch, remembered in settings
  assert(LX.chartStyle() === "bar", "charts start as bars");
  await LX.app.go("progress");
  await wait(60);
  document.querySelector('#view [data-chart-style="line"]').click();
  await wait(80);
  assert(LX.chartStyle() === "line", "the Line switch changes the chart style");
  assert(document.getElementById("view").innerHTML.indexOf("line-path") > -1, "a line chart is drawn");
  await LX.store.init();
  assert(LX.chartStyle() === "line", "the choice survives a reload");
  document.querySelector('#view [data-chart-style="bar"]').click();
  await wait(80);
  assert(LX.chartStyle() === "bar", "switching back works");

  // tapping a day in a chart opens that day
  await LX.app.go("progress");
  await wait(60);
  const hit = document.querySelector("#view [data-pick]");
  assert(!!hit, "chart days carry a tap target");
  hit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  assert(sheets() === 1, "tapping a day opens the day detail");
  assert(document.querySelector(".sheet").textContent.indexOf("Untracked") > -1, "day detail shows the day's totals");
  LX.ui.closeAllSheets();
  await wait(320);

  await LX.daySheet(today);        // a day that actually has data in it
  await wait(60);
  const dayText = document.querySelector(".sheet").textContent;
  assert(dayText.indexOf("The 24 hours") > -1, "a day with data shows its 24-hour breakdown");
  assert(dayText.indexOf("Food") > -1, "a day with meals shows the food totals");
  LX.ui.closeAllSheets();
  await wait(320);

  // ranges include a 14-day option now
  await LX.app.go("progress");
  await wait(40);
  assert(document.querySelector('#view [data-days="14"]'), "Progress offers a 14-day range");

  // Time: day-by-day list drills in
  await LX.app.go("time");
  await wait(40);
  document.querySelector('#view [data-mode="week"]').click();
  await wait(80);
  const dayRow = document.querySelector("#view [data-open-day]");
  assert(!!dayRow, "the week view lists each day");
  dayRow.click();
  await wait(80);
  assert(sheets() === 1, "tapping a day in Time opens its detail");
  LX.ui.closeAllSheets();
  await wait(320);

  console.log(process.exitCode ? "\nFAILURES ABOVE" : "\nAll checks passed");
  process.exit(process.exitCode || 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
