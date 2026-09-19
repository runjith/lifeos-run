/* LifeOS — JSON import.
   Parse → validate → preview → write. Nothing reaches the database until the
   user taps Import on a preview they can read. */
(function (LX) {
  "use strict";
  var store = LX.store, db = LX.db;
  var importer = {};

  importer.SAMPLE = {
    date: "2026-09-19",
    sleep: { bedtime: "23:10", wake_time: "06:30", quality: 4 },
    activities: [
      { category: "Work", title: "Store accounts", duration_minutes: 250, start_time: "09:30" },
      { category: "Exercise", title: "Upper body", duration_minutes: 65 },
      { category: "YouTube", duration_minutes: 45 }
    ],
    workout: {
      type: "Upper",
      duration_minutes: 65,
      exercises: [
        { name: "Bench Press", sets: [{ weight_kg: 70, reps: 8 }, { weight_kg: 70, reps: 7 }, { weight_kg: 70, reps: 6 }] },
        { name: "Lat Pulldown", sets: [{ weight_kg: 55, reps: 10 }, { weight_kg: 55, reps: 10 }] }
      ]
    },
    food: [
      { name: "Egg (whole)", quantity: 4, unit: "piece", meal: "Breakfast" },
      { name: "Chicken breast", quantity: 300, unit: "g", meal: "Lunch" },
      { name: "Cooked rice", quantity: 250, unit: "g", meal: "Lunch" }
    ],
    weight: { value: 78.4, unit: "kg" },
    measurements: { Chest: 100, Waist: 81, "Left Biceps": 35, "Right Biceps": 35 },
    review: { planned: "Close August books", completed: "Books closed, payroll pending", journal: "Good focus until 4pm." }
  };

  function num(x) {
    if (x === null || x === undefined || x === "") return null;
    var n = Number(x);
    return isNaN(n) ? null : n;
  }

  /** Returns {ok, errors, warnings, items, days} — items are what would be written. */
  importer.validate = function (text) {
    var out = { ok: false, errors: [], warnings: [], items: [], payloads: [] };
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      out.errors.push("This is not valid JSON. " + e.message);
      return out;
    }
    var days = Array.isArray(parsed) ? parsed : (parsed.days && Array.isArray(parsed.days) ? parsed.days : [parsed]);
    if (!days.length) { out.errors.push("No days found in this JSON."); return out; }

    days.forEach(function (day, di) {
      var where = days.length > 1 ? "Day " + (di + 1) + ": " : "";
      if (typeof day !== "object" || day === null) {
        out.errors.push(where + "expected an object with a date and some entries.");
        return;
      }
      var date = day.date;
      if (!date) {
        date = LX.D.today();
        out.warnings.push(where + 'no "date" given — using today (' + date + ").");
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        out.errors.push(where + 'date "' + date + '" must look like 2026-09-19.');
        return;
      }
      var payload = { date: date, activities: [], food: [], measurements: [], workouts: [] };

      /* sleep */
      if (day.sleep) {
        var s = day.sleep;
        var mins = num(s.duration_minutes);
        if (mins === null && s.bedtime && s.wake_time) mins = store.durationBetween(s.bedtime, s.wake_time);
        if (mins === null) out.errors.push(where + "sleep needs duration_minutes, or bedtime and wake_time.");
        else if (mins <= 0 || mins > 1080) out.warnings.push(where + "sleep of " + LX.fmtDur(mins) + " looks unusual — check it.");
        if (mins !== null) {
          payload.sleep = {
            date: date, duration_minutes: mins, bedtime: s.bedtime || null,
            wake_time: s.wake_time || null, quality: num(s.quality), notes: s.notes || ""
          };
          out.items.push({ kind: "Sleep", text: LX.fmtDur(mins) + (s.bedtime ? " (" + s.bedtime + "–" + s.wake_time + ")" : "") });
        }
      }

      /* activities */
      (day.activities || []).forEach(function (a) {
        var mins = num(a.duration_minutes);
        if (mins === null && a.start_time && a.end_time) mins = store.durationBetween(a.start_time, a.end_time);
        if (!mins) { out.errors.push(where + 'activity "' + (a.name || a.title || a.category) + '" has no duration.'); return; }
        var cat = matchCategory(a.category || a.type || a.name);
        if (!cat) {
          out.warnings.push(where + 'category "' + (a.category || "?") + '" is new — it will be created.');
        }
        payload.activities.push({
          date: date, categoryName: a.category || a.type || "Other", category_id: cat ? cat.id : null,
          duration_minutes: mins, title: a.title || a.name || "", start_time: a.start_time || null, notes: a.notes || ""
        });
        out.items.push({ kind: (cat ? cat.name : a.category || "Activity"), text: (a.title || a.name ? a.title || a.name : "") + (a.title || a.name ? " — " : "") + LX.fmtDur(mins) });
      });

      /* workout(s) */
      var workouts = day.workouts || (day.workout ? [day.workout] : []);
      workouts.forEach(function (w) {
        var exercises = (w.exercises || []).map(function (ex) {
          var sets = (ex.sets || []).map(function (st) {
            return { weight_kg: num(st.weight_kg !== undefined ? st.weight_kg : st.weight), reps: num(st.reps), duration_sec: num(st.duration_sec) };
          });
          if (!ex.name) out.errors.push(where + "an exercise is missing its name.");
          return { name: ex.name, sets: sets };
        });
        payload.workouts.push({
          date: date, type: w.type || "Full Body",
          duration_minutes: num(w.duration_minutes) || 0, notes: w.notes || "", exercises: exercises
        });
        out.items.push({
          kind: "Workout", text: (w.type || "Session") +
            (w.duration_minutes ? " — " + LX.fmtDur(num(w.duration_minutes)) : "") +
            (exercises.length ? " · " + exercises.length + " exercises" : "")
        });
        exercises.forEach(function (ex) {
          if (!ex.sets.length) return;
          out.items.push({
            kind: ex.name,
            text: ex.sets.map(function (s) { return (s.weight_kg ? s.weight_kg + "kg × " : "") + (s.reps || "—"); }).join(", ")
          });
        });
      });

      /* food */
      (day.food || day.foods || []).forEach(function (f) {
        if (!f.name) { out.errors.push(where + "a food entry has no name."); return; }
        var qty = num(f.quantity) || 1;
        var entry = {
          date: date, meal: f.meal || "Snack", name: f.name, quantity: qty, unit: f.unit || "serving",
          calories: num(f.calories), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat), fiber: num(f.fiber)
        };
        if (entry.calories === null) {
          var preset = LX.COMMON_FOODS.find(function (p) { return p.name.toLowerCase() === String(f.name).toLowerCase(); });
          if (preset) {
            var scaled = store.scaleFood(preset, qty);
            entry.calories = scaled.calories; entry.protein = scaled.protein;
            entry.carbs = scaled.carbs; entry.fat = scaled.fat; entry.fiber = scaled.fiber;
            entry.unit = f.unit || preset.unit;
            out.warnings.push(where + '"' + f.name + '" had no calories — filled in from the built-in food list.');
          } else {
            entry.calories = 0;
            out.warnings.push(where + '"' + f.name + '" has no calories and is not in the food list — saved as 0 kcal.');
          }
        }
        ["calories", "protein", "carbs", "fat", "fiber"].forEach(function (k) { entry[k] = entry[k] || 0; });
        payload.food.push(entry);
        out.items.push({ kind: entry.name, text: LX.num(qty, qty % 1 ? 1 : 0) + " " + entry.unit + " · " + LX.num(entry.calories) + " kcal" });
      });

      /* weight */
      var wRaw = day.weight !== undefined ? day.weight : day.weight_kg;
      if (wRaw !== undefined && wRaw !== null) {
        var val = typeof wRaw === "object" ? num(wRaw.value !== undefined ? wRaw.value : wRaw.weight) : num(wRaw);
        var unit = (typeof wRaw === "object" && wRaw.unit) || "kg";
        if (val === null) out.errors.push(where + "weight is not a number.");
        else {
          payload.weight = { date: date, weight: val, unit: unit, note: (typeof wRaw === "object" && wRaw.note) || "" };
          out.items.push({ kind: "Weight", text: val + " " + unit });
        }
      }

      /* measurements */
      var m = day.measurements || day.body_measurements;
      if (m) {
        var list = Array.isArray(m)
          ? m.map(function (x) { return { name: x.name, value: num(x.value), unit: x.unit }; })
          : Object.keys(m).map(function (k) { return { name: k, value: num(m[k]) }; });
        list.forEach(function (x) {
          if (x.value === null) { out.warnings.push(where + 'measurement "' + x.name + '" is not a number — skipped.'); return; }
          payload.measurements.push(x);
          out.items.push({ kind: x.name, text: x.value + " " + (x.unit || (x.name === "Body Fat %" ? "%" : store.settings.units.length)) });
        });
      }

      /* review */
      if (day.review) {
        payload.review = {
          date: date, planned: day.review.planned || "", completed: day.review.completed || "",
          journal: day.review.journal || day.review.notes || ""
        };
        out.items.push({ kind: "Daily review", text: "notes for " + date });
      }

      out.payloads.push(payload);
    });

    out.ok = out.errors.length === 0 && out.items.length > 0;
    if (!out.items.length && !out.errors.length) out.errors.push("Nothing importable found. Check the field names against the schema.");
    return out;
  };

  function matchCategory(name) {
    if (!name) return null;
    var n = String(name).trim().toLowerCase();
    return store.categories.find(function (c) {
      return c.name.toLowerCase() === n || c.slug === n.replace(/\s+/g, "-");
    }) || null;
  }

  /** Writes a validated result. Returns a count of records written. */
  importer.apply = function (result) {
    var written = 0;
    var chain = Promise.resolve();
    result.payloads.forEach(function (p) {
      if (p.sleep) chain = chain.then(function () { written++; return store.saveSleep(p.sleep); });
      p.activities.forEach(function (a) {
        chain = chain.then(function () {
          var found = matchCategory(a.categoryName);
          var ensure = found ? Promise.resolve(found) : store.addCategory(a.categoryName, "personal", "--c-other");
          return ensure.then(function (cat) {
            written++;
            return store.addActivity({
              date: a.date, category_id: cat.id, duration_minutes: a.duration_minutes,
              title: a.title, start_time: a.start_time, notes: a.notes
            });
          });
        });
      });
      p.workouts.forEach(function (w) { chain = chain.then(function () { written++; return store.saveWorkout(w); }); });
      p.food.forEach(function (f) { chain = chain.then(function () { written++; return store.addFood(f); }); });
      if (p.weight) chain = chain.then(function () { written++; return store.saveWeight(p.weight); });
      if (p.measurements.length) {
        chain = chain.then(function () {
          written += p.measurements.length;
          return store.saveMeasurements(p.date, p.measurements);
        });
      }
      if (p.review) {
        chain = chain.then(function () {
          return db.byDate("daily_reviews", p.review.date).then(function (rows) {
            var rec = rows[0] || { id: LX.uuid(), date: p.review.date };
            rec.planned = p.review.planned; rec.completed = p.review.completed; rec.journal = p.review.journal;
            written++;
            return db.put("daily_reviews", rec);
          });
        });
      }
    });
    return chain.then(function () { return written; });
  };

  LX.importer = importer;
})(window.LX);
