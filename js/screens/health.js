/* LifeOS — Health. Five related logs behind one segmented control. */
(function (LX) {
  "use strict";
  var store = LX.store, db = LX.db, charts = LX.charts, forms = LX.forms, ui = LX.ui;
  LX.screens = LX.screens || {};

  var TABS = [
    { key: "workout", name: "Workout" },
    { key: "insights", name: "Insights" },
    { key: "tests", name: "Tests" },
    { key: "weekly", name: "Weekly" },
    { key: "nutrition", name: "Food" },
    { key: "sleep", name: "Sleep" },
    { key: "weight", name: "Weight" },
    { key: "body", name: "Body" }
  ];
  var tab = "workout";

  LX.screens.health = {
    title: function () { return "Health"; },
    subtitle: function () { return (TABS.find(function (t) { return t.key === tab; }) || {}).name; },
    setTab: function (key) { tab = key; },
    /** Open one exercise's full progression from anywhere in the app. */
    showProgression: function (exerciseId) {
      var ex = store.exercise(exerciseId);
      if (ex) showProgression(ex);
    },
    render: function (el) {
      var head = '<div class="segmented scroll">' + TABS.map(function (t) {
        return '<button data-tab="' + t.key + '" aria-pressed="' + (tab === t.key) + '">' + t.name + "</button>";
      }).join("") + "</div>";

      var fn = {
        workout: workoutView, insights: insightsView, tests: testsView, weekly: weeklyView,
        nutrition: nutritionView, sleep: sleepView, weight: weightView, body: bodyView
      }[tab];
      return fn(el, head).then(function () {
        LX.on(el, "click", "[data-tab]", function (e, t) { tab = t.dataset.tab; LX.app.refresh(); });
      });
    }
  };

  /* ---------------- Workout ---------------- */
  function workoutView(el, head) {
    var to = LX.D.today(), from = LX.D.add(to, -27);
    return Promise.all([db.all("workouts"), db.all("workout_sets"), store.rangeSummary(from, to)])
      .then(function (r) {
        var workouts = r[0].sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        var sets = r[1];
        var last7 = workouts.filter(function (w) { return w.date >= LX.D.add(to, -6); }).length;
        var volume28 = LX.sum(sets.filter(function (s) { return s.date >= from; }),
          function (s) { return (s.weight_kg || 0) * (s.reps || 0); });

        var weeks = [0, 0, 0, 0];
        workouts.forEach(function (w) {
          var idx = Math.floor((LX.D.parse(to) - LX.D.parse(w.date)) / 86400000 / 7);
          if (idx >= 0 && idx < 4) weeks[3 - idx]++;
        });

        var html = head +
          '<button class="btn btn-primary btn-block" data-new-workout>' + LX.icon("dumbbell") + " Log a workout</button>" +
          '<div class="stats">' +
          stat("This week", last7 + '<small>sessions</small>', "Last 7 days") +
          stat("Volume", LX.num(Math.round(volume28 / 1000), 1) + "<small>t</small>", "Last 28 days, weight × reps") +
          "</div>" +
          '<div class="card"><div class="card-head"><h2>Sessions per week</h2></div>' +
          charts.bars({ labels: ["4 wks ago", "3", "2", "This week"], values: weeks, color: "--c-exercise",
            fmt: function (x) { return LX.num(x); }, height: 120, goal: store.goal("workouts_per_week"), aria: "Workouts per week" }) +
          '<p class="hint">Dashed line is your goal of ' + LX.num(store.goal("workouts_per_week") || 0) + " a week.</p></div>";

        html += '<div class="card"><div class="card-head"><h2>Exercise progression</h2></div>' +
          '<button class="btn btn-block" data-progression>' + LX.icon("search") + " Look up an exercise</button></div>";

        if (workouts.length) {
          html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Recent workouts</h2></div>' +
            '<div class="list">' + workouts.slice(0, 12).map(function (w) {
              var vol = LX.sum(sets.filter(function (s) { return s.workout_id === w.id; }),
                function (s) { return (s.weight_kg || 0) * (s.reps || 0); });
              return '<button class="list-row tap" data-workout="' + w.id + '">' +
                '<span class="grow"><span class="primary">' + LX.esc(w.type) + "</span><br>" +
                '<span class="secondary">' + LX.D.relative(w.date) + " · " + LX.fmtDur(w.duration_minutes) +
                (vol ? " · " + LX.num(vol) + " kg volume" : "") + "</span></span>" + LX.icon("chevron") + "</button>";
            }).join("") + "</div></div>";
        } else {
          html += ui.empty("No workouts yet", "Log your first session and LifeOS will start tracking your progression.");
        }

        el.innerHTML = html;
        LX.on(el, "click", "[data-new-workout]", function () { forms.logWorkout({ onDone: LX.app.refresh }); });
        LX.on(el, "click", "[data-workout]", function (e, t) { showWorkout(t.dataset.workout); });
        LX.on(el, "click", "[data-progression]", function () {
          forms.pickExercise(function (ex) { showProgression(ex); });
        });
      });
  }

  function showWorkout(id) {
    store.workoutDetail(id).then(function (w) {
      if (!w) return;
      ui.sheet({
        title: w.type + " · " + LX.D.relative(w.date),
        body: '<div class="card" style="padding:14px">' +
          kv("Duration", LX.fmtDur(w.duration_minutes)) +
          kv("Total volume", LX.num(w.volume) + " kg") +
          (w.notes ? kv("Notes", w.notes) : "") + "</div>" +
          w.exercises.map(function (ex) {
            return '<div class="card" style="padding:14px"><div class="primary" style="font-weight:600;margin-bottom:6px">' +
              LX.esc(ex.name) + "</div>" +
              '<div class="small muted">' + ex.sets.map(function (s) {
                return (s.weight_kg ? s.weight_kg + " kg × " : "") + (s.reps || "—");
              }).join(" · ") + "</div></div>";
          }).join(""),
        footer: '<button class="btn btn-danger" data-del>Delete workout</button><button class="btn" data-close>Close</button>',
        onMount: function (root, close) {
          root.querySelector("[data-del]").addEventListener("click", function () {
            ui.confirm({ title: "Delete this workout?", message: "Its sets are removed too.", confirmText: "Delete", danger: true })
              .then(function (ok) {
                if (!ok) return;
                var chain = db.remove("workouts", id);
                w.exercises.forEach(function (ex) {
                  chain = chain.then(function () { return db.remove("workout_exercises", ex.id); });
                  ex.sets.forEach(function (s) { chain = chain.then(function () { return db.remove("workout_sets", s.id); }); });
                });
                chain.then(function () { close(); ui.toast("Workout deleted"); LX.app.refresh(); });
              });
          });
        }
      });
    });
  }

  function showProgression(ex) {
    store.exerciseHistory(ex.id).then(function (h) {
      var body;
      if (!h.sessions.length) {
        body = '<div class="empty"><p style="margin:0">No sets logged for ' + LX.esc(ex.name) + " yet.</p></div>";
      } else {
        var e1rm = h.best && h.best.weight_kg ? LX.insights.oneRM(h.best.weight_kg, h.best.reps) : null;
        body = '<div class="card" style="padding:14px">' +
          kv("Last session", LX.D.short(h.last.date) + " · " + h.last.sets.map(function (s) {
            return (s.weight_kg ? s.weight_kg + "kg × " : "") + s.reps;
          }).join(", ")) +
          kv("Best set", h.best && h.best.weight_kg ? h.best.weight_kg + " kg × " + h.best.reps : "—") +
          kv("Estimated 1RM", e1rm ? LX.num(e1rm, 0) + " kg (estimate)" : "—") +
          kv("Sessions", h.sessions.length) + "</div>" +
          '<div class="card"><div class="card-head"><h2>Top weight</h2></div>' +
          charts.line({
            points: h.sessions.map(function (s) { return { label: LX.D.short(s.date), value: s.topWeight }; }),
            fmt: function (x) { return LX.num(x, 0) + "kg"; }, aria: "Top weight over time"
          }) + "</div>" +
          '<div class="card"><div class="card-head"><h2>Volume per session</h2></div>' +
          charts.plot({
            style: LX.chartStyle(),
            labels: h.sessions.map(function (s) { return LX.D.short(s.date); }),
            values: h.sessions.map(function (s) { return s.volume; }),
            color: "--c-exercise", fmt: function (x) { return LX.num(x); }, aria: "Volume per session"
          }) + "</div>";
      }
      ui.sheet({ title: ex.name, body: body, footer: '<button class="btn btn-block" data-close>Close</button>' });
    });
  }

  /* ---------------- Insights ---------------- */
  function insightsView(el, head) {
    return LX.insights.render(el, head);
  }

  /* ---------------- Strength & performance tests ---------------- */
  function testsView(el, head) {
    return LX.perf.renderSection(el, head);
  }

  /* ---------------- Weekly goals ---------------- */
  function weeklyView(el, head) {
    return LX.weekly.renderSection(el, head);
  }

  /* ---------------- Nutrition ---------------- */
  function nutritionView(el, head) {
    var today = LX.D.today();
    return Promise.all([store.daySummary(today), store.rangeSummary(LX.D.add(today, -6), today)])
      .then(function (r) {
        var s = r[0], week = r[1];
        var n = s.nutrition;
        var kcalGoal = store.goal("calories_kcal"), proGoal = store.goal("protein_g");
        var meals = ["Breakfast", "Lunch", "Dinner", "Snack"];

        var html = head +
          '<button class="btn btn-primary btn-block" data-add-food>' + LX.icon("food") + " Log food</button>" +
          '<div class="card"><div class="card-head"><h2>Today</h2><span class="small muted">' +
          LX.esc(LX.D.short(today)) + "</span></div>" +
          macroRow("Calories", n.calories, kcalGoal, "kcal") +
          macroRow("Protein", n.protein, proGoal, "g") +
          '<div class="legend" style="margin-top:14px">' +
          ["carbs", "fat", "fiber"].map(function (k) {
            return "<span>" + k.charAt(0).toUpperCase() + k.slice(1) + " <b style='font-weight:600;margin-left:3px'>" +
              LX.num(n[k], 0) + "g</b></span>";
          }).join("") + "</div></div>";

        html += '<div class="card"><div class="card-head"><h2>Last 7 days</h2></div>' +
          charts.bars({
            labels: week.days.map(function (d) { return LX.D.weekdayLetter(d.date); }),
            values: week.days.map(function (d) { return d.calories; }),
            goal: kcalGoal, color: "--c-cooking", fmt: function (x) { return LX.num(x); }, aria: "Calories per day"
          }) +
          '<p class="hint">Average ' + LX.num(week.averages.calories) + " kcal and " +
          LX.num(week.averages.protein) + "g protein on days you logged food.</p></div>";

        if (s.foods.length) {
          html += meals.map(function (m) {
            var items = s.foods.filter(function (f) { return f.meal === m; });
            if (!items.length) return "";
            return '<div class="card flush"><div style="padding:16px 20px 2px" class="row-between">' +
              '<h2 style="font:var(--t-h2)">' + m + "</h2><span class='small muted'>" +
              LX.num(LX.sum(items, function (f) { return f.calories; })) + " kcal</span></div><div class='list'>" +
              items.map(function (f) {
                return '<div class="list-row">' +
                  '<button class="grow" data-edit-food="' + f.id + '" style="background:none;border:0;padding:0;' +
                  'text-align:left;min-width:0;color:inherit;font:inherit">' +
                  '<span class="primary">' + LX.esc(f.name) + "</span><br>" +
                  '<span class="secondary">' + LX.num(f.quantity, f.quantity % 1 ? 1 : 0) + " " + LX.esc(f.unit) +
                  " · " + LX.num(f.protein, 1) + "g protein</span></button>" +
                  '<span class="value">' + LX.num(f.calories) + "</span>" +
                  '<button class="icon-btn" data-del-food="' + f.id + '" aria-label="Delete">' + LX.icon("trash") + "</button></div>";
              }).join("") + "</div>" +
              (items.length > 1 ? '<div style="padding:4px 16px 14px"><button class="btn btn-sm" data-save-meal="' + m + '">' +
                LX.icon("plus") + " Save as meal</button></div>" : "") + "</div>";
          }).join("");
        } else {
          html += ui.empty("Nothing logged today", "Log a meal, or paste a day from your notes under More → Import JSON.");
        }
        if (s.foods.length) html += '<p class="hint">Tap any entry to correct it — change 1 egg to 4 and the calories and macros follow. ' +
          "Save a meal you eat often and it becomes one tap in the food sheet.</p>";
        html += '<button class="btn btn-block" data-my-meals>' + LX.icon("food") + " My saved meals</button>";

        el.innerHTML = html;
        LX.on(el, "click", "[data-add-food]", function () { forms.logFood({ onDone: LX.app.refresh }); });
        LX.on(el, "click", "[data-edit-food]", function (e, t) {
          db.get("food_entries", t.dataset.editFood).then(function (rec) {
            if (rec) forms.logFood({ entry: rec, onDone: LX.app.refresh });
          });
        });
        LX.on(el, "click", "[data-del-food]", function (e, t) {
          db.remove("food_entries", t.dataset.delFood).then(function () { ui.toast("Entry deleted"); LX.app.refresh(); });
        });
        LX.on(el, "click", "[data-save-meal]", function (e, t) {
          var m = t.dataset.saveMeal;
          LX.meals.saveSheet(s.foods.filter(function (f) { return f.meal === m; }), m, LX.app.refresh);
        });
        LX.on(el, "click", "[data-my-meals]", function () { LX.meals.manageSheet(LX.app.refresh); });
      });
  }

  function macroRow(label, value, goal, unit) {
    var pct = goal ? Math.min(100, (value / goal) * 100) : 0;
    return '<div style="margin-bottom:14px"><div class="row-between" style="margin-bottom:6px">' +
      '<span class="label">' + label + "</span>" +
      '<span class="small"><b>' + LX.num(value) + "</b> " + (goal ? "of " + LX.num(goal) : "") + " " + unit + "</span></div>" +
      '<div class="bar"><span style="width:' + pct.toFixed(1) + '%"></span></div></div>';
  }

  /* ---------------- Sleep ---------------- */
  function sleepView(el, head) {
    var to = LX.D.today(), from = LX.D.add(to, -29);
    return Promise.all([db.byRange("sleep_records", from, to), db.all("sleep_records")])
      .then(function (r) {
        var recent = r[0], all = r[1].sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        var last14 = LX.D.range(to, 14).map(function (d) {
          var rec = recent.find(function (x) { return x.date === d; });
          return { date: d, mins: rec ? rec.duration_minutes : 0 };
        });
        var avg7 = avgOf(recent, LX.D.add(to, -6), to);
        var avg30 = avgOf(recent, from, to);
        var last = all[0];
        var goal = store.goal("sleep_minutes");

        var html = head +
          '<button class="btn btn-primary btn-block" data-add-sleep>' + LX.icon("bed") + " Log sleep</button>" +
          '<div class="stats">' +
          stat("Last night", last ? LX.fmtDur(last.duration_minutes) : "—", last ? LX.D.relative(last.date) : "Not logged") +
          stat("7-day average", avg7 ? LX.fmtDur(avg7) : "—", "Nights logged only") +
          stat("30-day average", avg30 ? LX.fmtDur(avg30) : "—", "Nights logged only") +
          stat("Goal", goal ? LX.fmtDur(goal) : "—", "Set under More → Goals") +
          "</div>" +
          '<div class="card"><div class="card-head"><h2>Last 14 nights</h2></div>' +
          charts.bars({
            labels: last14.map(function (d) { return LX.D.weekdayLetter(d.date); }),
            values: last14.map(function (d) { return d.mins / 60; }),
            goal: goal ? goal / 60 : null, color: "--c-sleep",
            fmt: function (x) { return LX.num(x, 1) + "h"; }, aria: "Sleep hours"
          }) +
          '<p class="hint">Bars at zero are nights with nothing logged, not nights without sleep.</p></div>';

        if (all.length) {
          html += '<div class="card flush"><div class="list">' + all.slice(0, 14).map(function (s) {
            return '<div class="list-row"><span class="grow"><span class="primary">' + LX.D.relative(s.date) + "</span><br>" +
              '<span class="secondary">' + (s.bedtime ? s.bedtime + " – " + s.wake_time : "") +
              (s.quality ? " · felt " + s.quality + "/5" : "") + "</span></span>" +
              '<span class="value">' + LX.fmtDur(s.duration_minutes) + "</span>" +
              '<button class="icon-btn" data-del-sleep="' + s.id + '" aria-label="Delete">' + LX.icon("trash") + "</button></div>";
          }).join("") + "</div></div>";
        } else {
          html += ui.empty("No sleep logged", "Add last night and the averages will start filling in.");
        }

        el.innerHTML = html;
        LX.on(el, "click", "[data-add-sleep]", function () { forms.logSleep({ onDone: LX.app.refresh }); });
        LX.on(el, "click", "[data-del-sleep]", function (e, t) {
          db.remove("sleep_records", t.dataset.delSleep).then(function () { ui.toast("Deleted"); LX.app.refresh(); });
        });
      });
  }
  function avgOf(rows, from, to) {
    var xs = rows.filter(function (r) { return r.date >= from && r.date <= to && r.duration_minutes; });
    return xs.length ? LX.avg(xs, function (r) { return r.duration_minutes; }) : 0;
  }

  /* ---------------- Weight ---------------- */
  function weightView(el, head) {
    return db.all("weight_records").then(function (rows) {
      rows.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var latest = rows[rows.length - 1], prev = rows[rows.length - 2];
      var unit = latest ? latest.unit : store.settings.units.weight;
      var last7 = rows.filter(function (r) { return r.date >= LX.D.add(LX.D.today(), -6); });
      var last30 = rows.filter(function (r) { return r.date >= LX.D.add(LX.D.today(), -29); });
      var change = latest && prev ? LX.round(latest.weight - prev.weight, 1) : null;

      var html = head +
        '<button class="btn btn-primary btn-block" data-add-weight>' + LX.icon("scale") + " Log weight</button>" +
        '<div class="stats">' +
        stat("Current", latest ? LX.num(latest.weight, 1) + "<small>" + unit + "</small>" : "—",
          latest ? LX.D.relative(latest.date) : "Not logged") +
        stat("Change", change === null ? "—" : LX.signed(change) + "<small>" + unit + "</small>",
          prev ? "Since " + LX.D.short(prev.date) : "Needs two entries") +
        stat("7-day average", last7.length ? LX.num(LX.avg(last7, function (r) { return r.weight; }), 1) + "<small>" + unit + "</small>" : "—",
          last7.length + " entries") +
        stat("30-day entries", last30.length, "Weigh-ins recorded") +
        "</div>";

      html += '<div class="card"><div class="card-head"><h2>Trend</h2><span class="small muted">All entries</span></div>' +
        charts.line({
          points: rows.map(function (r) { return { label: LX.D.short(r.date), value: r.weight }; }),
          fmt: function (x) { return LX.num(x, 1); }, aria: "Weight trend"
        }) +
        '<p class="hint">The scale starts near your own range, so small moves look large. Judge the direction, not the slope.</p></div>';

      if (rows.length) {
        html += '<div class="card flush"><div class="list">' + rows.slice().reverse().slice(0, 14).map(function (r) {
          return '<div class="list-row"><span class="grow"><span class="primary">' + LX.D.relative(r.date) + "</span>" +
            (r.note ? '<br><span class="secondary">' + LX.esc(r.note) + "</span>" : "") + "</span>" +
            '<span class="value">' + LX.num(r.weight, 1) + " " + r.unit + "</span>" +
            '<button class="icon-btn" data-del-weight="' + r.id + '" aria-label="Delete">' + LX.icon("trash") + "</button></div>";
        }).join("") + "</div></div>";
      } else {
        html += ui.empty("No weigh-ins yet", "Log today's weight to start the chart.");
      }

      el.innerHTML = html;
      LX.on(el, "click", "[data-add-weight]", function () { forms.logWeight({ onDone: LX.app.refresh }); });
      LX.on(el, "click", "[data-del-weight]", function (e, t) {
        db.remove("weight_records", t.dataset.delWeight).then(function () { ui.toast("Deleted"); LX.app.refresh(); });
      });
    });
  }

  /* ---------------- Body measurements ---------------- */
  function bodyView(el, head) {
    return store.measurementSnapshot().then(function (snap) {
      var html = head +
        '<button class="btn btn-primary btn-block" data-add-measure>' + LX.icon("ruler") + " Record measurements</button>";

      if (!snap.length) {
        html += ui.empty("No measurements yet", "Record a first set and every later entry will show the change.");
      } else {
        html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Current</h2>' +
          '<div class="label">Taken ' + LX.D.relative(snap[0].date) + "</div></div><div class='list'>" +
          snap.map(function (m) {
            var chg = m.change === null ? "" :
              '<span class="pill-tag">' + (m.change > 0 ? "+" : "") + LX.num(m.change, 1) + " " + m.unit + "</span>";
            return '<button class="list-row tap" data-site="' + LX.esc(m.name) + '">' +
              '<span class="grow"><span class="primary">' + LX.esc(m.name) + "</span>" +
              (m.previous !== null ? '<br><span class="secondary">' + LX.num(m.previous, 1) + " → " +
                LX.num(m.current, 1) + " " + m.unit + "</span>" : "") + "</span>" +
              chg + '<span class="value">' + LX.num(m.current, 1) + " " + m.unit + "</span>" + LX.icon("chevron") + "</button>";
          }).join("") + "</div></div>" +
          '<p class="hint" style="padding:0 4px">Up or down is not good or bad on its own — read it against what you were training for.</p>';
      }

      el.innerHTML = html;
      LX.on(el, "click", "[data-add-measure]", function () { forms.logMeasurements({ onDone: LX.app.refresh }); });
      LX.on(el, "click", "[data-site]", function (e, t) {
        var m = snap.find(function (x) { return x.name === t.dataset.site; });
        ui.sheet({
          title: m.name,
          body: '<div class="card"><div class="card-head"><h2>History</h2><span class="small muted">' +
            m.history.length + " entries</span></div>" +
            charts.line({
              points: m.history.map(function (h) { return { label: LX.D.short(h.date), value: h.value }; }),
              fmt: function (x) { return LX.num(x, 1); }, aria: m.name + " history"
            }) + "</div>" +
            '<div class="card flush"><div class="list">' + m.history.slice().reverse().map(function (h) {
              return '<div class="list-row"><span class="grow primary">' + LX.D.relative(h.date) + "</span>" +
                '<span class="value">' + LX.num(h.value, 1) + " " + h.unit + "</span></div>";
            }).join("") + "</div></div>",
          footer: '<button class="btn btn-block" data-close>Close</button>'
        });
      });
    });
  }

  /* ---------------- helpers ---------------- */
  function stat(label, value, foot) {
    return '<div class="stat"><span class="label">' + LX.esc(label) + '</span><span class="metric">' + value +
      '</span><span class="foot">' + LX.esc(foot) + "</span></div>";
  }
  function kv(k, v) { return '<div class="kv"><span class="muted">' + LX.esc(k) + "</span><b>" + LX.esc(v) + "</b></div>"; }
})(window.LX);
