/* LifeOS — data layer.
   Screens never touch IndexedDB directly; they ask the store for meaningful shapes
   like "today's summary" or "this exercise's history". */
(function (LX) {
  "use strict";

  var db = LX.db;
  var store = { categories: [], exercises: [], goals: {}, settings: {} };

  var DEFAULT_SETTINGS = {
    theme: "system",          // system | light | dark | black
    accent: "teal",           // one of LX.THEMES
    vivid: true,              // stronger category and chart colours
    home_cards: null,         // null = the default order in LX.HOME_CARDS
    units: { weight: "kg", length: "cm" },
    name: ""
  };

  /* ---------- boot ---------- */
  store.init = function () {
    return db.getKV("seeded", false).then(function (seeded) {
      if (seeded) return;
      var cats = LX.SEED_CATEGORIES.map(function (c, i) {
        return { id: LX.uuid(), slug: c.slug, name: c.name, color: c.color, bucket: c.bucket, sort: i, is_custom: 0 };
      });
      var exs = LX.SEED_EXERCISES.map(function (e) {
        return { id: LX.uuid(), name: e[0], muscle_group: e[1], is_custom: 0 };
      });
      var goals = LX.DEFAULT_GOALS.map(function (g) {
        return { id: LX.uuid(), key: g.key, name: g.name, target: g.target, unit: g.unit, active: 1 };
      });
      return db.putMany("categories", cats)
        .then(function () { return db.putMany("exercises", exs); })
        .then(function () { return db.putMany("goals", goals); })
        .then(function () { return db.setKV("seeded", true); });
    }).then(function () {
      return Promise.all([
        db.all("categories"), db.all("exercises"), db.all("goals"),
        db.getKV("settings", DEFAULT_SETTINGS)
      ]);
    }).then(function (r) {
      store.categories = r[0].sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
      store.exercises = r[1].sort(function (a, b) { return a.name.localeCompare(b.name); });
      store.goals = {};
      r[2].forEach(function (g) { store.goals[g.key] = g; });
      store.settings = Object.assign({}, DEFAULT_SETTINGS, r[3] || {});
    }).then(function () {
      // strength & performance tests keep their own tables; seeded separately so
      // existing installs pick up the defaults without their data being touched
      return LX.perf ? LX.perf.init() : null;
    }).then(function () {
      // weekly goals do the same
      return LX.weekly ? LX.weekly.init() : null;
    });
  };

  store.saveSettings = function (patch) {
    store.settings = Object.assign({}, store.settings, patch);
    return db.setKV("settings", store.settings);
  };

  /* ---------- categories ---------- */
  store.cat = function (id) {
    return store.categories.find(function (c) { return c.id === id; }) ||
           store.categories.find(function (c) { return c.slug === id; }) || null;
  };
  store.catColor = function (id) {
    var c = store.cat(id);
    return "var(" + (c ? c.color : "--c-other") + ")";
  };
  store.addCategory = function (name, bucket, color) {
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    var rec = {
      id: LX.uuid(), slug: slug, name: name, bucket: bucket || "personal",
      color: color || "--c-other", sort: 100 + store.categories.length, is_custom: 1
    };
    return db.put("categories", rec).then(function () {
      store.categories.push(rec);
      return rec;
    });
  };

  /* ---------- exercises ---------- */
  store.exercise = function (id) { return store.exercises.find(function (e) { return e.id === id; }) || null; };
  store.findExerciseByName = function (name) {
    var n = String(name || "").trim().toLowerCase();
    return store.exercises.find(function (e) { return e.name.toLowerCase() === n; }) || null;
  };
  store.ensureExercise = function (name, group) {
    var found = store.findExerciseByName(name);
    if (found) return Promise.resolve(found);
    var rec = { id: LX.uuid(), name: String(name).trim(), muscle_group: group || "Other", is_custom: 1 };
    return db.put("exercises", rec).then(function () {
      store.exercises.push(rec);
      store.exercises.sort(function (a, b) { return a.name.localeCompare(b.name); });
      return rec;
    });
  };

  /* ---------- activities ---------- */
  store.addActivity = function (a) {
    var rec = {
      id: a.id || LX.uuid(),
      date: a.date || LX.D.today(),
      category_id: a.category_id,
      start_time: a.start_time || null,
      end_time: a.end_time || null,
      duration_minutes: Math.max(0, Math.round(a.duration_minutes || 0)),
      title: a.title || "",
      notes: a.notes || ""
    };
    return db.put("activities", rec);
  };

  /* ---------- sleep / weight / measurements ---------- */
  store.saveSleep = function (s) {
    return db.byDate("sleep_records", s.date).then(function (rows) {
      var rec = rows[0] || { id: LX.uuid(), date: s.date };
      rec.bedtime = s.bedtime || rec.bedtime || null;
      rec.wake_time = s.wake_time || rec.wake_time || null;
      var mins = Number(s.duration_minutes) || 0;
      if (!mins && rec.bedtime && rec.wake_time) mins = store.durationBetween(rec.bedtime, rec.wake_time);
      rec.duration_minutes = Math.round(mins);
      rec.quality = s.quality === undefined ? (rec.quality || null) : s.quality;
      rec.notes = s.notes || rec.notes || "";
      return db.put("sleep_records", rec);
    });
  };
  store.durationBetween = function (bed, wake) {
    var b = LX.D.minsOf(bed), w = LX.D.minsOf(wake);
    if (b === null || w === null) return 0;
    return w >= b ? w - b : 1440 - b + w;
  };

  store.saveWeight = function (w) {
    return db.byDate("weight_records", w.date).then(function (rows) {
      var rec = rows[0] || { id: LX.uuid(), date: w.date };
      rec.weight = Number(w.weight);
      rec.unit = w.unit || store.settings.units.weight;
      rec.note = w.note || "";
      return db.put("weight_records", rec);
    });
  };

  store.saveMeasurements = function (date, entries, note) {
    // entries: [{name, value}] — one row per site so each has its own history
    return db.byDate("body_measurements", date).then(function (existing) {
      var chain = Promise.resolve();
      entries.forEach(function (e) {
        if (e.value === "" || e.value === null || isNaN(Number(e.value))) return;
        var prev = existing.find(function (r) { return r.name === e.name; });
        var rec = prev || { id: LX.uuid(), date: date, name: e.name };
        rec.value = Number(e.value);
        rec.unit = e.name === "Body Fat %" ? "%" : (e.unit || store.settings.units.length);
        rec.note = note || "";
        chain = chain.then(function () { return db.put("body_measurements", rec); });
      });
      return chain;
    });
  };

  /** latest value per site plus the value before it */
  store.measurementSnapshot = function () {
    return db.all("body_measurements").then(function (rows) {
      var bySite = {};
      rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      rows.forEach(function (r) {
        bySite[r.name] = bySite[r.name] || [];
        bySite[r.name].push(r);
      });
      return Object.keys(bySite).map(function (site) {
        var list = bySite[site];
        var cur = list[list.length - 1], prev = list.length > 1 ? list[list.length - 2] : null;
        return {
          name: site, unit: cur.unit, current: cur.value, date: cur.date,
          previous: prev ? prev.value : null, change: prev ? LX.round(cur.value - prev.value, 1) : null,
          history: list
        };
      }).sort(function (a, b) {
        return LX.MEASUREMENT_SITES.indexOf(a.name) - LX.MEASUREMENT_SITES.indexOf(b.name);
      });
    });
  };

  /* ---------- food ---------- */
  /** Create an entry, or update one: passing an existing id edits that same row
      rather than adding a second one, so correcting a quantity later is an edit
      and the day's totals simply recalculate. */
  store.addFood = function (f) {
    var rec = {
      id: f.id || LX.uuid(),
      date: f.date || LX.D.today(),
      meal: f.meal || "Snack",
      name: f.name,
      quantity: Number(f.quantity) || 1,
      unit: f.unit || "serving",
      calories: LX.round(f.calories || 0, 1),
      protein: LX.round(f.protein || 0, 1),
      carbs: LX.round(f.carbs || 0, 1),
      fat: LX.round(f.fat || 0, 1),
      fiber: LX.round(f.fiber || 0, 1)
    };
    if (f.created_at) rec.created_at = f.created_at;
    return db.put("food_entries", rec);
  };

  /** Scale a preset from LX.COMMON_FOODS to the quantity actually entered.
      `size` is the amount the preset's numbers describe, so 4 eggs is four
      times one egg and 250 g of rice is two and a half times 100 g. */
  store.scaleFood = function (preset, qty) {
    var q = Number(qty);
    if (!isFinite(q) || q < 0) q = 0;
    var factor = preset.size ? q / preset.size : q;
    return {
      name: preset.name, quantity: q, unit: preset.unit,
      calories: LX.round((preset.kcal || 0) * factor, 0),
      protein: LX.round((preset.p || 0) * factor, 1),
      carbs: LX.round((preset.c || 0) * factor, 1),
      fat: LX.round((preset.f || 0) * factor, 1),
      fiber: LX.round((preset.fib || 0) * factor, 1)
    };
  };

  /** The same thing for a food the app has no preset for: read its values back
      out of an entry already saved, per single unit, so the entry can be
      rescaled when its quantity is edited. */
  store.foodBasisFromEntry = function (entry) {
    var q = Number(entry.quantity) || 1;
    return {
      name: entry.name, unit: entry.unit || "serving", size: 1, serve: q || 1,
      kcal: (Number(entry.calories) || 0) / q,
      p: (Number(entry.protein) || 0) / q,
      c: (Number(entry.carbs) || 0) / q,
      f: (Number(entry.fat) || 0) / q,
      fib: (Number(entry.fiber) || 0) / q
    };
  };

  /** Foods logged before, newest first, one per name — so the list of foods
      grows from what is actually eaten instead of only what is built in. */
  store.recentFoods = function (limit) {
    return db.all("food_entries").then(function (rows) {
      rows.sort(function (a, b) {
        return (a.date + (a.created_at || "")) < (b.date + (b.created_at || "")) ? 1 : -1;
      });
      var seen = {}, out = [];
      rows.forEach(function (r) {
        var key = String(r.name || "").trim().toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = 1;
        var basis = store.foodBasisFromEntry(r);
        // step by the normal helping where the app knows one, so tapping Egg
        // three times still means three eggs rather than three of whatever was
        // logged last time
        var preset = LX.COMMON_FOODS.find(function (f) {
          return f.name.toLowerCase() === key && f.unit === basis.unit;
        });
        if (preset) basis.serve = preset.serve;
        out.push(basis);
      });
      return out.slice(0, limit || 8);
    });
  };

  /* ---------- workouts ---------- */
  /** payload: {date, type, duration_minutes, notes, exercises:[{name, sets:[{weight_kg, reps, duration_sec, notes}]}]} */
  store.saveWorkout = function (payload) {
    var workout = {
      id: payload.id || LX.uuid(),
      date: payload.date || LX.D.today(),
      type: payload.type || "Full Body",
      duration_minutes: Math.round(payload.duration_minutes || 0),
      notes: payload.notes || ""
    };
    return db.put("workouts", workout).then(function () {
      var chain = Promise.resolve();
      (payload.exercises || []).forEach(function (ex, i) {
        chain = chain.then(function () {
          return store.ensureExercise(ex.name, ex.muscle_group).then(function (exRec) {
            var we = { id: LX.uuid(), workout_id: workout.id, exercise_id: exRec.id, name: exRec.name, position: i };
            return db.put("workout_exercises", we).then(function () {
              var c2 = Promise.resolve();
              (ex.sets || []).forEach(function (s, j) {
                c2 = c2.then(function () {
                  return db.put("workout_sets", {
                    id: LX.uuid(), workout_exercise_id: we.id, exercise_id: exRec.id,
                    workout_id: workout.id, date: workout.date, position: j,
                    weight_kg: s.weight_kg === "" || s.weight_kg === undefined ? null : Number(s.weight_kg),
                    reps: s.reps === "" || s.reps === undefined ? null : Number(s.reps),
                    duration_sec: s.duration_sec ? Number(s.duration_sec) : null,
                    notes: s.notes || ""
                  });
                });
              });
              return c2;
            });
          });
        });
      });
      return chain.then(function () { return workout; });
    });
  };

  store.workoutDetail = function (id) {
    return Promise.all([db.get("workouts", id), db.all("workout_exercises"), db.all("workout_sets")])
      .then(function (r) {
        var w = r[0];
        if (!w) return null;
        var wes = r[1].filter(function (x) { return x.workout_id === id; })
          .sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
        wes.forEach(function (we) {
          we.sets = r[2].filter(function (s) { return s.workout_exercise_id === we.id; })
            .sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
        });
        w.exercises = wes;
        w.volume = LX.sum(r[2].filter(function (s) { return s.workout_id === id; }),
          function (s) { return (s.weight_kg || 0) * (s.reps || 0); });
        return w;
      });
  };

  /** last session and best set for one exercise */
  store.exerciseHistory = function (exerciseId) {
    return db.all("workout_sets").then(function (sets) {
      var mine = sets.filter(function (s) { return s.exercise_id === exerciseId; });
      if (!mine.length) return { last: null, best: null, sessions: [] };
      var byDate = {};
      mine.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });
      var dates = Object.keys(byDate).sort();
      var lastDate = dates[dates.length - 1];
      var best = mine.reduce(function (a, b) {
        var wa = (a && a.weight_kg) || 0, wb = b.weight_kg || 0;
        if (wb > wa) return b;
        if (wb === wa && (b.reps || 0) > ((a && a.reps) || 0)) return b;
        return a;
      }, null);
      return {
        last: { date: lastDate, sets: byDate[lastDate].sort(function (a, b) { return a.position - b.position; }) },
        best: best,
        sessions: dates.map(function (d) {
          return {
            date: d,
            volume: LX.sum(byDate[d], function (s) { return (s.weight_kg || 0) * (s.reps || 0); }),
            topWeight: Math.max.apply(null, byDate[d].map(function (s) { return s.weight_kg || 0; }))
          };
        })
      };
    });
  };

  /* ---------- daily summary ---------- */
  /** Sleep is counted once: from the sleep record if one exists, otherwise from
      any activity logged under a sleep-bucket category. */
  store.daySummary = function (date) {
    return Promise.all([
      db.byDate("activities", date),
      db.byDate("sleep_records", date),
      db.byDate("food_entries", date),
      db.byDate("workouts", date),
      db.byDate("weight_records", date)
    ]).then(function (r) {
      var acts = r[0], sleepRec = r[1][0] || null, foods = r[2], workouts = r[3];

      var byCat = {}, byBucket = {};
      Object.keys(LX.BUCKETS).forEach(function (b) { byBucket[b] = 0; });

      var sleepFromActivities = 0;
      acts.forEach(function (a) {
        var c = store.cat(a.category_id);
        var bucket = c ? c.bucket : "personal";
        if (bucket === "sleep") { sleepFromActivities += a.duration_minutes; if (sleepRec) return; }
        var key = c ? c.id : "other";
        byCat[key] = (byCat[key] || 0) + a.duration_minutes;
        byBucket[bucket] += a.duration_minutes;
      });

      var sleepMin = sleepRec ? (sleepRec.duration_minutes || 0) : sleepFromActivities;
      if (sleepRec) byBucket.sleep = sleepMin;

      var trackedMin = Object.keys(byBucket).reduce(function (a, k) {
        return k === "untracked" ? a : a + byBucket[k];
      }, 0);
      byBucket.untracked = Math.max(0, 1440 - trackedMin);

      var nutrition = {
        calories: LX.sum(foods, function (f) { return f.calories; }),
        protein: LX.sum(foods, function (f) { return f.protein; }),
        carbs: LX.sum(foods, function (f) { return f.carbs; }),
        fat: LX.sum(foods, function (f) { return f.fat; }),
        fiber: LX.sum(foods, function (f) { return f.fiber; })
      };

      var catRows = Object.keys(byCat).map(function (id) {
        var c = store.cat(id);
        return {
          id: id, name: c ? c.name : "Other", color: c ? c.color : "--c-other",
          bucket: c ? c.bucket : "personal", minutes: byCat[id]
        };
      }).sort(function (a, b) { return b.minutes - a.minutes; });

      return {
        date: date,
        activities: acts.sort(function (a, b) {
          return (a.start_time || "zz") < (b.start_time || "zz") ? -1 : 1;
        }),
        categories: catRows,
        buckets: byBucket,
        tracked: trackedMin,
        untracked: byBucket.untracked,
        sleep: sleepRec ? sleepRec : (sleepMin ? { duration_minutes: sleepMin } : null),
        sleepMinutes: sleepMin,
        exerciseMinutes: byBucket.exercise,
        productiveMinutes: byBucket.productive,
        entertainmentMinutes: byBucket.entertainment,
        nutrition: nutrition,
        foods: foods,
        workouts: workouts,
        weight: r[4][0] || null
      };
    });
  };

  /** per-day summaries across a range, plus totals — used by Progress */
  store.rangeSummary = function (fromIso, toIso) {
    var days = [];
    for (var d = fromIso; d <= toIso; d = LX.D.add(d, 1)) days.push(d);
    return Promise.all([
      db.byRange("activities", fromIso, toIso),
      db.byRange("sleep_records", fromIso, toIso),
      db.byRange("food_entries", fromIso, toIso),
      db.byRange("workouts", fromIso, toIso),
      db.byRange("weight_records", fromIso, toIso),
      db.all("workout_sets")
    ]).then(function (r) {
      var acts = r[0], sleeps = r[1], foods = r[2], workouts = r[3], weights = r[4];
      var sets = r[5].filter(function (s) { return s.date >= fromIso && s.date <= toIso; });

      var perDay = days.map(function (day) {
        var b = {}; Object.keys(LX.BUCKETS).forEach(function (k) { b[k] = 0; });
        var sleepRec = sleeps.find(function (s) { return s.date === day; });
        var sleepFromActs = 0;
        acts.filter(function (a) { return a.date === day; }).forEach(function (a) {
          var c = store.cat(a.category_id);
          var bucket = c ? c.bucket : "personal";
          if (bucket === "sleep") { sleepFromActs += a.duration_minutes; if (sleepRec) return; }
          b[bucket] += a.duration_minutes;
        });
        if (sleepRec) b.sleep = sleepRec.duration_minutes || 0;
        var tracked = Object.keys(b).reduce(function (a2, k) { return k === "untracked" ? a2 : a2 + b[k]; }, 0);
        b.untracked = Math.max(0, 1440 - tracked);
        var dayFoods = foods.filter(function (f) { return f.date === day; });
        return {
          date: day, buckets: b, tracked: tracked,
          sleep: sleepRec ? sleepRec.duration_minutes : sleepFromActs,
          calories: LX.sum(dayFoods, function (f) { return f.calories; }),
          protein: LX.sum(dayFoods, function (f) { return f.protein; }),
          carbs: LX.sum(dayFoods, function (f) { return f.carbs || 0; }),
          fat: LX.sum(dayFoods, function (f) { return f.fat || 0; }),
          hasFood: dayFoods.length > 0,
          workouts: workouts.filter(function (w) { return w.date === day; }).length,
          weight: (weights.find(function (w) { return w.date === day; }) || {}).weight || null
        };
      });

      var foodDays = perDay.filter(function (d2) { return d2.hasFood; });
      return {
        days: perDay,
        totals: {
          productive: LX.sum(perDay, function (d2) { return d2.buckets.productive; }),
          exercise: LX.sum(perDay, function (d2) { return d2.buckets.exercise; }),
          entertainment: LX.sum(perDay, function (d2) { return d2.buckets.entertainment; }),
          personal: LX.sum(perDay, function (d2) { return d2.buckets.personal; }),
          chores: LX.sum(perDay, function (d2) { return d2.buckets.chores; }),
          sleep: LX.sum(perDay, function (d2) { return d2.buckets.sleep; }),
          untracked: LX.sum(perDay, function (d2) { return d2.buckets.untracked; }),
          workouts: workouts.length,
          volume: LX.sum(sets, function (s) { return (s.weight_kg || 0) * (s.reps || 0); })
        },
        averages: {
          sleep: LX.avg(perDay.filter(function (d2) { return d2.sleep > 0; }), function (d2) { return d2.sleep; }),
          calories: LX.avg(foodDays, function (d2) { return d2.calories; }),
          protein: LX.avg(foodDays, function (d2) { return d2.protein; }),
          productive: LX.avg(perDay, function (d2) { return d2.buckets.productive; })
        },
        weights: weights
      };
    });
  };

  store.goal = function (key) {
    var g = store.goals[key];
    return g ? g.target : null;
  };
  store.setGoal = function (key, target) {
    var g = store.goals[key];
    if (g) { g.target = Number(target); return db.put("goals", g); }
    var def = LX.DEFAULT_GOALS.find(function (d) { return d.key === key; }) || { name: key, unit: "" };
    var rec = { id: LX.uuid(), key: key, name: def.name, target: Number(target), unit: def.unit, active: 1 };
    store.goals[key] = rec;
    return db.put("goals", rec);
  };

  LX.store = store;
})(window.LX);
