/* LifeOS — Health → Insights.
   The gym half of the app answered in one screen: what are my main lifts doing,
   what are my best sets, where is the volume going. Everything here is derived
   from the sets you already log — nothing new to enter. */
(function (LX) {
  "use strict";
  var db = LX.db, store = LX.store, charts = LX.charts, ui = LX.ui;
  var insights = {};

  var RANGES = [{ d: 90, n: "90 days" }, { d: 365, n: "1 year" }, { d: 0, n: "All time" }];
  var days = 90;
  var DEFAULT_LIFTS = ["Back Squat", "Bench Press", "Deadlift"];

  /** Epley: weight × (1 + reps ÷ 30). An estimate, and labelled as one. */
  insights.oneRM = function (weight, reps) {
    if (!weight || !reps) return null;
    return weight * (1 + reps / 30);
  };

  function keyLiftIds() {
    var saved = store.settings.key_lifts;
    if (saved && saved.length) return saved;
    return DEFAULT_LIFTS.map(function (n) {
      var ex = store.findExerciseByName(n);
      return ex ? ex.id : null;
    }).filter(Boolean);
  }

  /** Per-exercise history: one entry per session, plus the best single set. */
  function summarise(sets) {
    var byExercise = {};
    sets.forEach(function (s) {
      if (!s.exercise_id) return;
      (byExercise[s.exercise_id] = byExercise[s.exercise_id] || []).push(s);
    });
    return Object.keys(byExercise).map(function (id) {
      var list = byExercise[id].slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var byDate = {};
      list.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });
      var sessions = Object.keys(byDate).sort().map(function (d) {
        var rows = byDate[d];
        var top = rows.reduce(function (a, b) { return (b.weight_kg || 0) > ((a && a.weight_kg) || 0) ? b : a; }, null);
        return {
          date: d,
          topWeight: top ? top.weight_kg : null,
          topSet: top,
          volume: LX.sum(rows, function (r) { return (r.weight_kg || 0) * (r.reps || 0); }),
          sets: rows.length,
          e1rm: top ? insights.oneRM(top.weight_kg, top.reps) : null
        };
      });
      var best = list.reduce(function (a, b) {
        if (!b.weight_kg) return a;
        if (!a) return b;
        if (b.weight_kg > a.weight_kg) return b;
        if (b.weight_kg === a.weight_kg && (b.reps || 0) > (a.reps || 0)) return b;
        return a;
      }, null);
      var bestE1rm = list.reduce(function (a, b) {
        var v = insights.oneRM(b.weight_kg, b.reps);
        return v && (!a || v > a.value) ? { value: v, set: b } : a;
      }, null);
      var ex = store.exercise(id);
      return {
        id: id,
        name: ex ? ex.name : "Exercise",
        group: ex ? ex.muscle_group : "Other",
        sessions: sessions,
        best: best,
        bestE1rm: bestE1rm,
        latest: sessions[sessions.length - 1],
        previous: sessions.length > 1 ? sessions[sessions.length - 2] : null,
        totalSets: list.length,
        volume: LX.sum(list, function (r) { return (r.weight_kg || 0) * (r.reps || 0); })
      };
    });
  }

  insights.render = function (el, head) {
    var to = LX.D.today();
    var from = days ? LX.D.add(to, -(days - 1)) : "0000-01-01";
    return Promise.all([db.all("workout_sets"), db.all("workouts")]).then(function (r) {
      var allSets = r[0], workouts = r[1];
      var sets = allSets.filter(function (s) { return s.date >= from && s.date <= to; });
      var inRange = workouts.filter(function (w) { return w.date >= from && w.date <= to; });
      var all = summarise(allSets);          // all-time, for personal bests
      var ranged = summarise(sets);          // the chosen window, for volume and trends
      var byId = {}; all.forEach(function (x) { byId[x.id] = x; });

      var style = LX.chartStyle();
      var weeks = weekly(sets, from, to);
      var volume = LX.sum(sets, function (s) { return (s.weight_kg || 0) * (s.reps || 0); });
      var weeksCount = Math.max(1, Math.round((LX.D.parse(to) - LX.D.parse(weeks.first || from)) / 604800000) + 1);

      var lifts = keyLiftIds().map(function (id) { return byId[id]; }).filter(Boolean);
      var bigTotal = lifts.reduce(function (a, l) { return a + ((l.best && l.best.weight_kg) || 0); }, 0);

      var html = (head || "") +
        '<div class="chips">' + RANGES.map(function (x) {
          return '<button class="chip" data-ins-range="' + x.d + '" aria-pressed="' + (days === x.d) + '">' + x.n + "</button>";
        }).join("") + "</div>";

      html += '<div class="stats">' +
        stat("Workouts", inRange.length, LX.num(inRange.length / weeksCount, 1) + " a week") +
        stat("Volume", LX.num(volume / 1000, 1) + "<small>t</small>", "Weight × reps") +
        stat("Sets", sets.length, LX.num(sets.length / Math.max(1, inRange.length), 0) + " per session") +
        stat("Main lifts", bigTotal ? LX.num(bigTotal, 0) + "<small>kg</small>" : "—",
          lifts.length ? "Best singles added up" : "Pick your lifts below") +
        "</div>";

      /* ---- the lifts that matter most ---- */
      html += '<div class="row-between" style="padding:0 2px">' +
        '<div class="section-title">Main lifts</div>' +
        '<button class="btn btn-sm btn-quiet" data-pick-lifts>Choose</button></div>';

      if (!lifts.length) {
        html += ui.empty("No main lifts set",
          "Choose the lifts you want to follow closely — squat, bench and deadlift by default.",
          "Choose lifts", "data-pick-lifts");
      } else {
        lifts.forEach(function (l) {
          var ranged1 = ranged.find(function (x) { return x.id === l.id; });
          var sess = (ranged1 || l).sessions;
          var change = l.previous && l.latest && l.latest.topWeight && l.previous.topWeight
            ? LX.round(l.latest.topWeight - l.previous.topWeight, 1) : null;
          html += '<div class="card"><div class="card-head"><h2>' + LX.esc(l.name) + "</h2>" +
            '<button class="link small" data-progression="' + l.id + '" style="color:var(--accent)">History</button></div>' +
            '<div class="stats" style="grid-template-columns:repeat(2,1fr)">' +
            stat("Best set", l.best ? LX.num(l.best.weight_kg, 1) + "<small>kg</small> × " + l.best.reps : "—",
              l.best ? LX.D.relative(l.best.date) : "No sets logged") +
            stat("Last session", l.latest && l.latest.topWeight ? LX.num(l.latest.topWeight, 1) + "<small>kg</small> × " +
              (l.latest.topSet.reps || "—") : "—", l.latest ? LX.D.relative(l.latest.date) : "—") +
            stat("Change", change === null ? "—" : LX.signed(change) + "<small>kg</small>",
              l.previous ? "On the session before" : "Needs two sessions") +
            stat("Est. 1RM", l.bestE1rm ? LX.num(l.bestE1rm.value, 0) + "<small>kg</small>" : "—", "Estimate, not a tested max") +
            "</div>";
          if (sess.length > 1) {
            html += '<div style="margin-top:14px">' + charts.plot({
              style: style,
              labels: sess.map(function (x) { return LX.D.short(x.date); }),
              values: sess.map(function (x) { return x.topWeight || 0; }),
              picks: sess.map(function (x) { return x.date; }),
              color: "--c-exercise", zeroBase: false,
              fmt: function (x) { return LX.num(x, 0) + "kg"; },
              aria: l.name + " top weight per session"
            }) + "</div><p class="+'"hint"'+">Heaviest set in each session. " + sess.length + " sessions in this window.</p>";
          } else {
            html += '<p class="hint">One session so far — log it again and the trend line starts.</p>';
          }
          html += "</div>";
        });
      }

      /* ---- personal bests across everything ---- */
      var bests = all.filter(function (x) { return x.best; })
        .sort(function (a, b) { return b.best.weight_kg - a.best.weight_kg; }).slice(0, 12);
      if (bests.length) {
        html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Personal bests</h2>' +
          '<div class="label">Heaviest set ever recorded, all exercises</div></div><div class="list">' +
          bests.map(function (x) {
            return '<button class="list-row tap" data-progression="' + x.id + '">' +
              '<span class="grow"><span class="primary">' + LX.esc(x.name) + "</span><br>" +
              '<span class="secondary">' + LX.esc(x.group) + " · " + LX.D.relative(x.best.date) + "</span></span>" +
              '<span class="value">' + LX.num(x.best.weight_kg, 1) + " × " + x.best.reps + "</span>" +
              LX.icon("chevron") + "</button>";
          }).join("") + "</div></div>";
      }

      /* ---- where the work went ---- */
      if (weeks.labels.length) {
        html += '<div class="card"><div class="card-head"><h2>Volume per week</h2>' +
          charts.styleToggle(style) + "</div>" +
          charts.plot({
            style: style, labels: weeks.labels, values: weeks.values,
            color: "--c-work", fmt: function (x) { return LX.num(x / 1000, 1) + "t"; },
            aria: "Volume per week"
          }) + "</div>";
      }

      var groups = {};
      ranged.forEach(function (x) { groups[x.group] = (groups[x.group] || 0) + x.volume; });
      var groupRows = Object.keys(groups).map(function (g) { return { name: g, volume: groups[g] }; })
        .sort(function (a, b) { return b.volume - a.volume; });
      if (groupRows.length) {
        var top = groupRows[0].volume || 1;
        html += '<div class="card"><div class="card-head"><h2>By muscle group</h2>' +
          '<span class="small muted">' + (days ? "last " + days + " days" : "all time") + "</span></div>" +
          groupRows.map(function (g) {
            return '<div style="margin-bottom:12px"><div class="row-between" style="margin-bottom:5px">' +
              '<span class="small">' + LX.esc(g.name) + "</span>" +
              '<span class="small muted">' + LX.num(g.volume / 1000, 1) + " t</span></div>" +
              '<div class="bar"><span style="width:' + ((g.volume / top) * 100).toFixed(1) + '%"></span></div></div>';
          }).join("") +
          '<p class="hint">Volume only counts sets with a weight and reps, so cardio and holds sit outside this.</p></div>';
      }

      if (!allSets.length) {
        html += ui.empty("No sets logged yet",
          "Log a workout with weights and reps and this screen fills itself in — trends, bests, volume, all of it.");
      }

      el.innerHTML = html;
      bind(el);
    });
  };

  function bind(el) {
    LX.on(el, "click", "[data-ins-range]", function (e, t) {
      days = Number(t.dataset.insRange);
      LX.app.refresh();
    });
    LX.bindChartStyle(el);
    LX.on(el, "click", "[data-progression]", function (e, t) {
      LX.screens.health.showProgression(t.dataset.progression);
    });
    LX.on(el, "click", "[data-pick-lifts]", function () { insights.pickLifts(); });
    LX.on(el, "click", "[data-pick]", function (e, t) {
      var d = t.getAttribute("data-pick");
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) LX.daySheet(d);
    });
  }

  /** Choose which lifts get their own card. */
  insights.pickLifts = function () {
    var chosen = keyLiftIds().slice();
    ui.sheet({
      title: "Main lifts",
      body: '<p class="small muted" style="margin:0">Pick up to four lifts to follow closely. Everything else still appears under personal bests.</p>' +
        '<input class="input" data-lift-search placeholder="Search exercises" />' +
        '<div class="card flush" data-lift-list style="max-height:52dvh;overflow:auto"></div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save-lifts>Save</button>',
      onMount: function (root, close) {
        var list = root.querySelector("[data-lift-list]");
        function draw(q) {
          list.innerHTML = store.exercises.filter(function (ex) {
            return !q || ex.name.toLowerCase().indexOf(q) >= 0;
          }).slice(0, 60).map(function (ex) {
            var on = chosen.indexOf(ex.id) >= 0;
            return '<button class="list-row tap" data-lift="' + ex.id + '">' +
              '<span class="grow"><span class="primary">' + LX.esc(ex.name) + "</span><br>" +
              '<span class="secondary">' + LX.esc(ex.muscle_group || "") + "</span></span>" +
              (on ? '<span style="color:var(--accent)">' + LX.icon("check") + "</span>" : "") + "</button>";
          }).join("");
        }
        draw("");
        root.querySelector("[data-lift-search]").addEventListener("input", function (e) {
          draw(e.target.value.toLowerCase());
        });
        LX.on(root, "click", "[data-lift]", function (e, t) {
          var id = t.dataset.lift;
          var i = chosen.indexOf(id);
          if (i >= 0) chosen.splice(i, 1);
          else if (chosen.length >= 4) return ui.toast("Four lifts is the limit — remove one first", "danger");
          else chosen.push(id);
          draw(root.querySelector("[data-lift-search]").value.toLowerCase());
        });
        root.querySelector("[data-save-lifts]").addEventListener("click", function () {
          store.saveSettings({ key_lifts: chosen }).then(function () {
            close(); ui.toast("Main lifts updated"); LX.app.refresh();
          });
        });
      }
    });
  };

  function weekly(sets, from, to) {
    if (!sets.length) return { labels: [], values: [], first: null };
    var start = sets.reduce(function (a, s) { return s.date < a ? s.date : a; }, to);
    if (from !== "0000-01-01") start = from;
    var buckets = {};
    sets.forEach(function (s) {
      var k = weekKey(s.date);
      buckets[k] = (buckets[k] || 0) + (s.weight_kg || 0) * (s.reps || 0);
    });
    var keys = Object.keys(buckets).sort().slice(-26);
    return {
      labels: keys.map(function (k) { return LX.D.short(k); }),
      values: keys.map(function (k) { return buckets[k]; }),
      first: keys[0] || start
    };
  }
  function weekKey(iso) {
    var d = LX.D.parse(iso);
    return LX.D.add(iso, -((d.getDay() + 6) % 7));
  }
  function stat(label, value, foot) {
    return '<div class="stat"><span class="label">' + LX.esc(label) + '</span><span class="metric">' + value +
      '</span><span class="foot">' + LX.esc(foot) + "</span></div>";
  }

  LX.insights = insights;
})(window.LX);
