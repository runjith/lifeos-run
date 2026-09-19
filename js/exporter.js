/* LifeOS — export and restore. The user owns the data: everything in the local
   database can leave in one file, and that same file can rebuild the app. */
(function (LX) {
  "use strict";
  var db = LX.db;
  var exporter = {};

  exporter.BACKUP_VERSION = 1;

  exporter.buildBackup = function () {
    return Promise.all([
      Promise.all(LX.STORES.map(function (s) { return db.allIncludingDeleted(s); })),
      db.getKV("settings", {}),
      db.getKV("cloud_user", null)
    ]).then(function (r) {
      var data = {};
      LX.STORES.forEach(function (s, i) { data[s] = r[0][i]; });
      return {
        app: "LifeOS",
        backup_version: exporter.BACKUP_VERSION,
        exported_at: LX.now(),
        settings: r[1],
        account: r[2] ? { email: r[2].email } : null,
        data: data
      };
    });
  };

  exporter.download = function (filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      return true;
    } catch (e) {
      return false;
    }
  };

  exporter.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); resolve(); } catch (e) { reject(e); }
      ta.remove();
    });
  };

  /* ---------- CSV ---------- */
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  exporter.toCSV = function (rows) {
    if (!rows.length) return "";
    var cols = Object.keys(rows.reduce(function (acc, r) {
      Object.keys(r).forEach(function (k) { acc[k] = 1; });
      return acc;
    }, {}));
    return cols.join(",") + "\n" + rows.map(function (r) {
      return cols.map(function (c) { return csvCell(r[c]); }).join(",");
    }).join("\n");
  };

  /** Readable CSVs, with ids resolved to names where that helps a spreadsheet. */
  exporter.csvFiles = function () {
    return Promise.all(LX.STORES.map(function (s) { return db.all(s); })).then(function (all) {
      var map = {};
      LX.STORES.forEach(function (s, i) { map[s] = all[i]; });
      var files = [];
      files.push({
        name: "activities.csv",
        text: exporter.toCSV(map.activities.map(function (a) {
          var c = LX.store.cat(a.category_id);
          return {
            date: a.date, category: c ? c.name : "", bucket: c ? c.bucket : "",
            start_time: a.start_time, end_time: a.end_time, duration_minutes: a.duration_minutes,
            title: a.title, notes: a.notes
          };
        }))
      });
      files.push({ name: "food_entries.csv", text: exporter.toCSV(map.food_entries.map(strip)) });
      files.push({ name: "sleep_records.csv", text: exporter.toCSV(map.sleep_records.map(strip)) });
      files.push({ name: "weight_records.csv", text: exporter.toCSV(map.weight_records.map(strip)) });
      files.push({ name: "body_measurements.csv", text: exporter.toCSV(map.body_measurements.map(strip)) });
      files.push({
        name: "workout_sets.csv",
        text: exporter.toCSV(map.workout_sets.map(function (s) {
          var ex = LX.store.exercise(s.exercise_id);
          var w = map.workouts.find(function (x) { return x.id === s.workout_id; });
          return {
            date: s.date, workout_type: w ? w.type : "", exercise: ex ? ex.name : "",
            set_number: (s.position || 0) + 1, weight_kg: s.weight_kg, reps: s.reps,
            duration_sec: s.duration_sec, notes: s.notes
          };
        }))
      });
      files.push({ name: "daily_reviews.csv", text: exporter.toCSV(map.daily_reviews.map(strip)) });
      return files.filter(function (f) { return f.text; });
    });
    function strip(r) {
      var o = {};
      Object.keys(r).forEach(function (k) {
        if (k === "_dirty" || k === "deleted_at" || k.indexOf("_id") > 0 || k === "id") return;
        o[k] = r[k];
      });
      return o;
    }
  };

  /* ---------- restore ---------- */
  /** mode "replace" wipes local data first; "merge" keeps whatever is already there. */
  exporter.restore = function (backup, mode) {
    if (!backup || !backup.data) return Promise.reject(new Error("This file does not look like a LifeOS backup."));
    var wipe = mode === "replace" ? db.wipeAll() : Promise.resolve();
    return wipe.then(function () {
      var chain = Promise.resolve();
      LX.STORES.forEach(function (s) {
        (backup.data[s] || []).forEach(function (rec) {
          chain = chain.then(function () {
            var copy = Object.assign({}, rec);
            delete copy._dirty;
            return db.put(s, copy);
          });
        });
      });
      if (backup.settings) chain = chain.then(function () { return db.setKV("settings", backup.settings); });
      return chain.then(function () { return db.setKV("seeded", true); });
    }).then(function () { return LX.store.init(); });
  };

  exporter.counts = function () {
    return Promise.all(LX.STORES.map(function (s) { return db.all(s); })).then(function (all) {
      var out = {};
      LX.STORES.forEach(function (s, i) { out[s] = all[i].length; });
      return out;
    });
  };

  LX.exporter = exporter;
})(window.LX);
