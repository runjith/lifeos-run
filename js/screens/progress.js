/* LifeOS — Progress. Longer horizons: what is actually changing. */
(function (LX) {
  "use strict";
  var store = LX.store, db = LX.db, charts = LX.charts;
  LX.screens = LX.screens || {};

  var RANGES = [
    { d: 7, n: "7 days" }, { d: 14, n: "14 days" }, { d: 30, n: "30 days" },
    { d: 90, n: "90 days" }, { d: 365, n: "1 year" }
  ];
  var days = 30;
  var section = "time";
  var SECTIONS = [
    { key: "time", name: "Time" }, { key: "body", name: "Body" },
    { key: "fitness", name: "Fitness" }, { key: "nutrition", name: "Nutrition" }
  ];

  LX.screens.progress = {
    title: function () { return "Progress"; },
    subtitle: function () { return "Last " + days + " days"; },
    render: function (el) {
      var to = LX.D.today(), from = LX.D.add(to, -(days - 1));
      var head =
        '<div class="chips">' + RANGES.map(function (r) {
          return '<button class="chip" data-days="' + r.d + '" aria-pressed="' + (days === r.d) + '">' + r.n + "</button>";
        }).join("") + "</div>" +
        '<div class="segmented">' + SECTIONS.map(function (s) {
          return '<button data-section="' + s.key + '" aria-pressed="' + (section === s.key) + '">' + s.name + "</button>";
        }).join("") + "</div>";

      return Promise.all([store.rangeSummary(from, to), db.all("workout_sets"), store.measurementSnapshot()])
        .then(function (r) {
          var sum = r[0];
          var sets = r[1].filter(function (s) { return s.date >= from && s.date <= to; });
          var snap = r[2];
          var body = { time: timeSection, body: bodySection, fitness: fitnessSection, nutrition: nutritionSection }[section];
          el.innerHTML = head + body(sum, sets, snap, from, to);
          LX.on(el, "click", "[data-days]", function (e, t) { days = Number(t.dataset.days); LX.app.refresh(); });
          LX.on(el, "click", "[data-section]", function (e, t) { section = t.dataset.section; LX.app.refresh(); });
          LX.bindChartStyle(el);
          LX.on(el, "click", "[data-pick]", function (e, t) {
            var d = t.getAttribute("data-pick");
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) LX.daySheet(d);
          });
        });
    }
  };

  function hrs(mins) { return LX.num(mins / 60, 1) + "<small>h</small>"; }

  function timeSection(sum) {
    var t = sum.totals, n = sum.days.length;
    var keys = ["sleep", "productive", "exercise", "personal", "chores", "entertainment", "untracked"];
    return '<div class="stats">' +
      stat("Productive", hrs(t.productive), LX.fmtDur(t.productive / n) + " a day") +
      stat("Exercise", hrs(t.exercise), LX.fmtDur(t.exercise / n) + " a day") +
      stat("Entertainment", hrs(t.entertainment), LX.fmtDur(t.entertainment / n) + " a day") +
      stat("Untracked", hrs(t.untracked), Math.round((t.untracked / (1440 * n)) * 100) + "% of the period") +
      "</div>" +
      '<div class="card"><div class="card-head"><h2>Every day, stacked</h2></div>' +
      charts.stackedDays(sum.days, keys) +
      charts.legend(keys.map(function (k) { return { name: LX.BUCKETS[k].name, color: LX.BUCKETS[k].color }; })) +
      '<p class="hint">Each column is a full 24 hours. The grey part is time you did not record — it is missing data, not free time. Tap a column to open that day.</p></div>' +
      '<div class="card"><div class="card-head"><h2>Productive hours a day</h2>' +
      charts.styleToggle(LX.chartStyle()) + "</div>" +
      charts.plot({
        style: LX.chartStyle(),
        labels: sum.days.map(function (d) { return LX.D.short(d.date); }),
        values: sum.days.map(function (d) { return d.buckets.productive / 60; }),
        picks: sum.days.map(function (d) { return d.date; }),
        goal: store.goal("productive_minutes") ? store.goal("productive_minutes") / 60 : null,
        color: "--c-work", fmt: function (x) { return LX.num(x, 1) + "h"; }, aria: "Productive hours per day"
      }) + '<p class="hint">Tap any day to open it.</p></div>' +
      '<div class="card"><div class="card-head"><h2>Sleep a night</h2></div>' +
      charts.plot({
        style: LX.chartStyle(),
        labels: sum.days.map(function (d) { return LX.D.short(d.date); }),
        values: sum.days.map(function (d) { return d.sleep / 60; }),
        picks: sum.days.map(function (d) { return d.date; }),
        goal: store.goal("sleep_minutes") ? store.goal("sleep_minutes") / 60 : null,
        color: "--c-sleep", fmt: function (x) { return LX.num(x, 1) + "h"; }, aria: "Sleep per night"
      }) + "</div>";
  }

  function bodySection(sum, sets, snap) {
    var weights = sum.weights;
    var first = weights[0], last = weights[weights.length - 1];
    var bf = snap.find(function (m) { return m.name === "Body Fat %"; });
    var html = '<div class="stats">' +
      stat("Weight now", last ? LX.num(last.weight, 1) + "<small>" + last.unit + "</small>" : "—",
        last ? LX.D.relative(last.date) : "Not logged in this range") +
      stat("Change", first && last && first !== last ? LX.signed(last.weight - first.weight) + "<small>" + last.unit + "</small>" : "—",
        first && last ? "Since " + LX.D.short(first.date) : "Needs two weigh-ins") +
      stat("Body fat", bf ? LX.num(bf.current, 1) + "<small>%</small>" : "—", bf ? LX.D.relative(bf.date) : "Not recorded") +
      stat("Weigh-ins", weights.length, "In this range") +
      "</div>" +
      '<div class="card"><div class="card-head"><h2>Weight</h2></div>' +
      charts.line({
        points: weights.map(function (w) { return { label: LX.D.short(w.date), value: w.weight }; }),
        fmt: function (x) { return LX.num(x, 1); }, aria: "Weight"
      }) + "</div>";

    if (snap.length) {
      html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Measurements</h2>' +
        '<div class="label">Latest against the entry before it</div></div><div class="list">' +
        snap.filter(function (m) { return m.name !== "Body Fat %"; }).map(function (m) {
          return '<div class="list-row"><span class="grow"><span class="primary">' + LX.esc(m.name) + "</span>" +
            (m.previous !== null ? '<br><span class="secondary">' + LX.num(m.previous, 1) + " → " +
              LX.num(m.current, 1) + " " + m.unit + "</span>" : "") + "</span>" +
            '<span class="value">' + (m.change === null ? "—" : (m.change > 0 ? "+" : "") + LX.num(m.change, 1)) + "</span></div>";
        }).join("") + "</div></div>";
    }
    return html;
  }

  function fitnessSection(sum, sets) {
    var n = sum.days.length;
    var byDate = {};
    sets.forEach(function (s) {
      byDate[s.date] = (byDate[s.date] || 0) + (s.weight_kg || 0) * (s.reps || 0);
    });
    var weekly = {};
    sum.days.forEach(function (d) {
      var wk = weekKey(d.date);
      weekly[wk] = weekly[wk] || { vol: 0, sessions: 0 };
      weekly[wk].vol += byDate[d.date] || 0;
      weekly[wk].sessions += d.workouts;
    });
    var wkKeys = Object.keys(weekly).sort();
    var prs = {};
    sets.forEach(function (s) {
      if (!s.weight_kg || !s.reps) return;
      var cur = prs[s.exercise_id];
      if (!cur || s.weight_kg > cur.weight_kg) prs[s.exercise_id] = s;
    });
    var prRows = Object.keys(prs).map(function (id) {
      var ex = store.exercise(id);
      return { name: ex ? ex.name : "Exercise", set: prs[id] };
    }).sort(function (a, b) { return b.set.weight_kg - a.set.weight_kg; }).slice(0, 10);

    return '<div class="stats">' +
      stat("Workouts", sum.totals.workouts, LX.num(sum.totals.workouts / (n / 7), 1) + " a week") +
      stat("Volume", LX.num(sum.totals.volume / 1000, 1) + "<small>t</small>", "Weight × reps, all sets") +
      stat("Exercise time", hrs(sum.totals.exercise), LX.fmtDur(sum.totals.exercise / n) + " a day") +
      stat("Sets logged", sets.length, "In this range") +
      "</div>" +
      '<div class="card"><div class="card-head"><h2>Volume per week</h2>' + charts.styleToggle(LX.chartStyle()) + "</div>" +
      charts.plot({
        style: LX.chartStyle(),
        labels: wkKeys.map(function (k) { return LX.D.short(k); }),
        values: wkKeys.map(function (k) { return weekly[k].vol; }),
        color: "--c-exercise", fmt: function (x) { return LX.num(x / 1000, 1) + "t"; }, aria: "Weekly volume"
      }) + "</div>" +
      '<div class="card"><div class="card-head"><h2>Sessions per week</h2></div>' +
      charts.plot({
        style: LX.chartStyle(),
        labels: wkKeys.map(function (k) { return LX.D.short(k); }),
        values: wkKeys.map(function (k) { return weekly[k].sessions; }),
        goal: store.goal("workouts_per_week"), color: "--c-walking",
        fmt: function (x) { return LX.num(x); }, aria: "Sessions per week"
      }) + "</div>" +
      (prRows.length
        ? '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Heaviest sets</h2></div><div class="list">' +
          prRows.map(function (p) {
            return '<div class="list-row"><span class="grow"><span class="primary">' + LX.esc(p.name) + "</span><br>" +
              '<span class="secondary">' + LX.D.short(p.set.date) + "</span></span>" +
              '<span class="value">' + LX.num(p.set.weight_kg, 1) + " kg × " + p.set.reps + "</span></div>";
          }).join("") + "</div></div>"
        : LX.ui.empty("No sets in this range", "Log a workout with weights and reps to see personal records."));
  }

  function nutritionSection(sum) {
    var logged = sum.days.filter(function (d) { return d.hasFood; });
    return '<div class="stats">' +
      stat("Average calories", logged.length ? LX.num(sum.averages.calories) : "—", logged.length + " days logged") +
      stat("Average protein", logged.length ? LX.num(sum.averages.protein) + "<small>g</small>" : "—",
        "Goal " + LX.num(store.goal("protein_g") || 0) + "g") +
      "</div>" +
      '<div class="card"><div class="card-head"><h2>Calories</h2>' + charts.styleToggle(LX.chartStyle()) + "</div>" +
      charts.plot({
        style: LX.chartStyle(),
        labels: sum.days.map(function (d) { return LX.D.short(d.date); }),
        values: sum.days.map(function (d) { return d.calories; }),
        picks: sum.days.map(function (d) { return d.date; }),
        goal: store.goal("calories_kcal"), color: "--c-cooking",
        fmt: function (x) { return LX.num(x); }, aria: "Calories per day"
      }) +
      '<p class="hint">Days with no food logged show as zero. Tap a day to see the meals.</p></div>' +
      '<div class="card"><div class="card-head"><h2>Protein</h2></div>' +
      charts.plot({
        style: LX.chartStyle(),
        labels: sum.days.map(function (d) { return LX.D.short(d.date); }),
        values: sum.days.map(function (d) { return d.protein; }),
        picks: sum.days.map(function (d) { return d.date; }),
        goal: store.goal("protein_g"), color: "--c-personal",
        fmt: function (x) { return LX.num(x) + "g"; }, aria: "Protein per day"
      }) + "</div>";
  }

  function weekKey(iso) {
    var d = LX.D.parse(iso);
    var day = (d.getDay() + 6) % 7; // Monday start
    return LX.D.add(iso, -day);
  }
  function stat(label, value, foot) {
    return '<div class="stat"><span class="label">' + LX.esc(label) + '</span><span class="metric">' + value +
      '</span><span class="foot">' + LX.esc(foot) + "</span></div>";
  }
})(window.LX);
