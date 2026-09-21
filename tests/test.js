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
  "js/ui.js", "js/charts.js", "js/forms.js", "js/day-sheet.js", "js/insights.js", "js/perf.js", "js/weekly.js", "js/timer-ui.js",
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

  // ---------------------------------------------------------------- food quantities
  console.log("\n-- food quantities --");

  // the preset list carries a unit and a normal helping for every food
  const F = n => LX.COMMON_FOODS.find(x => x.name.indexOf(n) === 0);
  assert(LX.COMMON_FOODS.every(f => f.unit && f.size > 0 && f.serve > 0),
    "every food has a unit, a basis size and a helping");
  assert(F("Egg").unit === "piece" && F("Chicken").unit === "g" && F("Milk").unit === "ml",
    "eggs are pieces, chicken is grams, milk is millilitres");
  assert(!!F("Sugar") && !!F("Dates") && !!F("Curry") && !!F("Fruit"),
    "sugar, dates, curry and a generic fruit are in the list");
  assert(F("Curry").custom === true && F("Fruit").custom === true,
    "curry and fruit are marked as enter-your-own");
  assert(F("Sugar").serve === 5, "a tap of sugar adds a teaspoon, not 100g");

  // scaling: the heart of the bug
  const egg1 = LX.store.scaleFood(F("Egg"), 1);
  const egg4 = LX.store.scaleFood(F("Egg"), 4);
  assert(egg4.calories === egg1.calories * 4, "4 eggs is four times 1 egg (" + egg4.calories + " kcal)");
  assert(egg4.protein === LX.round(F("Egg").p * 4, 1), "protein scales with the quantity too");
  const rice250 = LX.store.scaleFood(F("Cooked rice"), 250);
  assert(rice250.calories === LX.round(F("Cooked rice").kcal * 2.5, 0),
    "250g of rice is 2.5x the per-100g values (" + rice250.calories + " kcal)");
  assert(LX.store.scaleFood(F("Egg"), 0).calories === 0, "a quantity of zero is zero, not NaN");

  // the sheet: tapping the same food again adds another helping
  await LX.app.go("home");
  document.querySelector('[data-quick="food"]').click();
  await new Promise(r => setTimeout(r, 80));   // let the recent-foods list settle
  let sheet = document.querySelector(".sheet");
  const qtyOf = () => Number(sheet.querySelector('[name="quantity"]').value);
  const kcalOf = () => Number(sheet.querySelector('[name="calories"]').value);
  const tapFood = name => {
    const box = sheet.querySelector("[data-food-search]");
    box.value = name;
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
    const btn = Array.from(sheet.querySelectorAll("[data-preset]"))
      .find(b => b.textContent.trim().indexOf(name) === 0);
    if (!btn) { console.error("ASSERT FAIL: no row for " + name); process.exitCode = 1; return; }
    btn.click();
  };
  const tapEgg = () => tapFood("Egg (whole)");

  tapEgg();
  assert(qtyOf() === 1 && kcalOf() === 78, "one tap on Egg = 1 egg, 78 kcal");
  tapEgg();
  assert(qtyOf() === 2 && kcalOf() === 156, "tapping again = 2 eggs, 156 kcal (got " + qtyOf() + ", " + kcalOf() + ")");
  tapEgg();
  assert(qtyOf() === 3 && kcalOf() === 234, "and again = 3 eggs, 234 kcal (got " + qtyOf() + ", " + kcalOf() + ")");
  assert(sheet.querySelector('[name="unit"]').value === "piece", "the unit follows the food");

  // typing a quantity recalculates the nutrition
  const qtyBox = sheet.querySelector('[name="quantity"]');
  qtyBox.value = "1";
  qtyBox.dispatchEvent(new window.Event("input", { bubbles: true }));
  const oneEggKcal = kcalOf(), oneEggPro = Number(sheet.querySelector('[name="protein"]').value);
  qtyBox.value = "4";
  qtyBox.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert(kcalOf() === oneEggKcal * 4, "typing 4 gives four eggs' calories (got " + kcalOf() + ")");
  // scaled from the exact per-unit value, not from the rounded figure on screen
  assert(Math.abs(Number(sheet.querySelector('[name="protein"]').value) - oneEggPro * 4) < 0.5,
    "and four eggs' protein (got " + sheet.querySelector('[name="protein"]').value + ")");

  // the +/- stepper moves by one helping
  sheet.querySelector('[data-qty-step="1"]').click();
  assert(qtyOf() === 5 && kcalOf() === oneEggKcal * 5, "the + button adds another egg");
  sheet.querySelector('[data-qty-step="-1"]').click();
  assert(qtyOf() === 4, "the - button takes one away");

  // a gram food steps by its own helping, not by one gram
  tapFood("Chicken breast");
  assert(qtyOf() === 100 && kcalOf() === 165, "chicken starts at 100g (got " + qtyOf() + ", " + kcalOf() + ")");
  tapFood("Chicken breast");
  assert(qtyOf() === 200 && kcalOf() === 330, "tapping chicken again = 200g, 330 kcal");

  // typing your own values stops the app overwriting them
  const proBox = sheet.querySelector('[name="protein"]');
  proBox.value = "99";
  proBox.dispatchEvent(new window.Event("input", { bubbles: true }));
  qtyBox.value = "300";
  qtyBox.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert(Number(proBox.value) === 99, "your own numbers are left alone once you type them");

  LX.ui.closeAllSheets();
  await new Promise(r => setTimeout(r, 320));

  // editing a saved entry rescales it and does not duplicate it
  const eggEntry = await LX.store.addFood({
    date: today, meal: "Breakfast", name: "Egg (whole)", quantity: 1, unit: "piece",
    calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, fiber: 0
  });
  const foodsBefore = (await LX.db.all("food_entries")).length;
  const basis = LX.store.foodBasisFromEntry(eggEntry);
  const four = LX.store.scaleFood(basis, 4);
  assert(four.calories === 312, "an existing 1-egg entry rescales to 312 kcal at 4 eggs");
  await LX.store.addFood(Object.assign({ id: eggEntry.id, created_at: eggEntry.created_at },
    { date: today, meal: "Breakfast", name: "Egg (whole)", quantity: 4, unit: "piece" }, four));
  const foodsAfter = await LX.db.all("food_entries");
  assert(foodsAfter.length === foodsBefore, "editing an entry does not create a second one");
  const edited = foodsAfter.find(f => f.id === eggEntry.id);
  assert(edited.quantity === 4 && edited.calories === 312, "the edited entry holds 4 eggs and their calories");
  assert(edited.created_at === eggEntry.created_at, "an edit keeps the original created_at");

  // foods logged before come back to the top of the list
  const recents = await LX.store.recentFoods(6);
  assert(recents.some(r => r.name === "Egg (whole)"), "a food logged before is offered again");
  assert(recents.every(r => r.size === 1 && r.serve > 0), "recent foods carry a per-unit basis");

  // the Food tab lets you reopen an entry
  LX.screens.health.setTab("nutrition");
  await LX.app.go("health");
  await new Promise(r => setTimeout(r, 40));
  assert(!!document.querySelector("#view [data-edit-food]"), "food entries are tappable for editing");
  assert(document.getElementById("view").innerHTML.indexOf("NaN") === -1, "Food tab output is clean");

  // ---------------------------------------------------------------- weekly goals
  console.log("\n-- weekly goals --");
  const wk = LX.weekly;
  const G = n => wk.goals.find(g => g.name.indexOf(n) === 0);
  assert(!!G("One-arm") && !!G("Handstand"), "the two example goals are seeded");

  // weeks run Monday to Sunday
  const monday = LX.D.weekStart(today);
  assert(LX.D.parse(monday).getDay() === 1, "a week starts on a Monday");
  assert(LX.D.weekEnd(monday) === LX.D.add(monday, 6), "and ends six days later");
  assert(LX.D.weekStart(LX.D.add(monday, 3)) === monday, "any day in the week maps back to that Monday");
  assert(LX.D.weekLabel(monday) === "This week" && LX.D.weekLabel(LX.D.add(monday, -7)) === "Last week",
    "recent weeks are named rather than dated");

  const workoutsPre = (await LX.db.all("workouts")).length;
  const actsPre = (await LX.db.all("activities")).length;
  const testsPre = (await LX.perf.results(null)).length;

  // pending until it is ticked
  const oap = G("One-arm");
  let o = await wk.overview(oap.id);
  assert(!o.thisWeek.complete && o.thisWeek.done === 0, "a new week starts as not completed");

  // a session under the target is recorded but does not tick the week off
  await wk.saveLog(oap, { date: today, value: 6 });
  o = await wk.overview(oap.id);
  assert(o.thisWeek.entries.length === 1, "a short session is still recorded");
  assert(!o.thisWeek.complete, "6 minutes does not complete a 10-minute goal");

  // and one that reaches it does
  const done12 = await wk.saveLog(oap, { date: today, value: 12 });
  o = await wk.overview(oap.id);
  assert(o.thisWeek.complete, "12 minutes completes the week");
  assert(o.thisWeek.latest.value === 12, "the week shows what was actually done");
  assert(!!done12.completed_at && done12.completed_at.length > 10, "completion is stamped with the date and time");
  assert(done12.week_start === monday, "an entry knows which week it belongs to");
  assert(wk.fmtAmount(oap, 12) === "12 min", "durations read in minutes");

  // a missed week stays missed
  const threeWeeksBack = LX.D.add(monday, -21);
  await wk.saveLog(oap, { date: threeWeeksBack, value: 15 });
  o = await wk.overview(oap.id);
  const oldWeek = o.history.find(w => w.weekStart === threeWeeksBack);
  const gapWeek = o.history.find(w => w.weekStart === LX.D.add(monday, -14));
  assert(oldWeek && oldWeek.complete, "an older completed week is kept");
  assert(gapWeek && gapWeek.missed, "a finished week with nothing in it reads as missed");
  assert(o.history.every(w => w.weekStart >= threeWeeksBack), "history starts at the first attempt, not earlier");

  // several times a week
  const cold = await wk.saveGoal({ name: "Cold shower", target_type: "sessions", target_value: 1, target_unit: "sessions", times_per_week: 3 });
  await wk.init();
  await wk.saveLog(wk.goal(cold.id), { date: today });
  await wk.saveLog(wk.goal(cold.id), { date: LX.D.add(today, 0) });
  let oc = await wk.overview(cold.id);
  assert(oc.thisWeek.done === 2 && !oc.thisWeek.complete, "2 of 3 sessions is not complete yet");
  await wk.saveLog(wk.goal(cold.id), { date: today });
  oc = await wk.overview(cold.id);
  assert(oc.thisWeek.complete, "the third session completes the week");
  assert(wk.targetText(wk.goal(cold.id)) === "3× a week", "a sessions goal reads as a frequency");

  // a custom target keeps its own unit
  const walk = await wk.saveGoal({ name: "Long walk", target_type: "custom", target_value: 8, target_unit: "km", times_per_week: 1 });
  await wk.init();
  assert(wk.fmtAmount(wk.goal(walk.id), 8) === "8 km", "a custom goal keeps the unit you chose");

  // editing an entry updates it in place; deleting recalculates
  const entriesBefore = (await wk.logs(oap.id)).length;
  await wk.saveLog(oap, { id: done12.id, date: done12.date, value: 20, created_at: done12.created_at });
  let logs = await wk.logs(oap.id);
  assert(logs.length === entriesBefore, "editing an entry does not add another");
  assert(logs.find(l => l.id === done12.id).value === 20, "the edit took");
  await wk.deleteLog(done12.id);
  o = await wk.overview(oap.id);
  assert(!o.thisWeek.complete, "deleting the qualifying entry reopens the week");

  // changing the target does not rewrite finished weeks
  await wk.saveGoal(Object.assign({}, wk.goal(oap.id), { target_value: 30 }));
  o = await wk.overview(oap.id);
  const stillOld = o.history.find(w => w.weekStart === threeWeeksBack);
  assert(stillOld.entries.length === 1 && stillOld.entries[0].value === 15,
    "an old entry keeps the value it was recorded with");

  // nothing leaked into workouts, activities or performance tests
  assert((await LX.db.all("workouts")).length === workoutsPre, "ticking a goal never writes a workout");
  assert((await LX.db.all("activities")).length === actsPre, "ticking a goal never writes an activity");
  assert((await LX.perf.results(null)).length === testsPre, "ticking a goal never writes a test result");

  // the screens
  LX.screens.health.setTab("weekly");
  await LX.app.go("health");
  await new Promise(r => setTimeout(r, 40));
  let wv = document.getElementById("view").innerHTML;
  assert(wv.indexOf("Handstand") > -1, "the Weekly tab lists the goals");
  assert(wv.indexOf("data-wk-tick") > -1, "each goal has a tick");
  assert(wv.indexOf("NaN") === -1 && wv.indexOf("undefined") === -1, "Weekly tab output is clean");

  await LX.app.go("home");
  await new Promise(r => setTimeout(r, 40));
  let hv = document.getElementById("view").innerHTML;
  assert(hv.indexOf("Weekly goals") > -1, "Home shows the weekly goals card");
  assert(hv.indexOf("NaN") === -1, "Home output still clean");

  // ticking straight from Home
  const beforeTick = (await wk.logs(cold.id)).length;
  document.querySelector('#view [data-wk-tick="' + cold.id + '"]').click();
  await new Promise(r => setTimeout(r, 80));
  assert((await wk.logs(cold.id)).length === beforeTick + 1, "a sessions goal records straight from Home");

  // backups carry the new tables, and older backups still restore
  const b3 = await LX.exporter.buildBackup();
  assert(b3.data.weekly_goals.length >= 4 && b3.data.weekly_goal_logs.length > 3,
    "backup includes weekly goals and their entries");
  const older = JSON.parse(JSON.stringify(b3));
  delete older.data.weekly_goals;
  delete older.data.weekly_goal_logs;
  await LX.exporter.restore(older, "merge");
  assert(true, "a backup made before weekly goals existed restores without error");
  await LX.exporter.restore(b3, "replace");
  await LX.store.init();
  assert(wk.goals.length >= 4, "weekly goals survive an export and restore");
  assert((await wk.logs(null)).length > 3, "so do their entries");

  // every screen still renders afterwards
  for (const key of ["home", "time", "health", "progress", "more"]) {
    await LX.app.go(key);
    await new Promise(r => setTimeout(r, 20));
    const h = document.getElementById("view").innerHTML;
    assert(h.length > 400 && h.indexOf("NaN") === -1, key + " still renders with weekly goals in place");
  }

  console.log(process.exitCode ? "\nFAILURES ABOVE" : "\nAll checks passed");
  process.exit(process.exitCode || 0);
})().catch(e => { console.error("CRASH", e); process.exit(1); });
