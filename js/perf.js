/* LifeOS — Strength & performance tests.
   Standardised efforts you repeat: Cindy, 100 push-ups for time, a 2 km run.
   Kept deliberately apart from normal workouts — a test result is stored in its
   own table and is never written into workout history.

   Two tables:
     strength_tests    the configuration (name, type, target, distance)
     strength_results  one row per attempt, carrying the target it was done at

   Because each result remembers its own target, changing a target later never
   rewrites history: results are grouped into a series per target/distance, and
   only results in the same series are ever compared. */
(function (LX) {
  "use strict";
  var db = LX.db, ui = LX.ui, charts = LX.charts;
  var perf = { tests: [] };

  /* ---------------- time helpers ---------------- */
  /** "6:20" → 380, "1:02:30" → 3750, "95" → 95 */
  perf.parseTime = function (txt) {
    if (txt === null || txt === undefined) return null;
    var s = String(txt).trim();
    if (!s) return null;
    if (s.indexOf(":") < 0) {
      var n = Number(s);
      return isNaN(n) ? null : Math.round(n);
    }
    var parts = s.split(":").map(function (p) { return Number(p) || 0; });
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };
  perf.fmtTime = function (secs) {
    if (secs === null || secs === undefined || isNaN(secs)) return "—";
    secs = Math.round(secs);
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
  };
  perf.pace = function (secs, km) {
    if (!secs || !km) return null;
    return secs / km;
  };
  perf.fmtPace = function (secsPerKm) {
    return secsPerKm ? perf.fmtTime(secsPerKm) + "/km" : "—";
  };

  /* ---------------- setup ---------------- */
  perf.init = function () {
    return db.getKV("seeded_tests", false).then(function (done) {
      if (done) return;
      var rows = LX.SEED_TESTS.map(function (t, i) {
        return {
          id: LX.uuid(), slug: t.slug, name: t.name, type: t.type, target: t.target,
          unit: t.unit, duration_minutes: t.duration_minutes, notes: t.notes,
          is_default: 1, sort: i, archived: 0
        };
      });
      return db.putMany("strength_tests", rows).then(function () {
        return db.setKV("seeded_tests", true);
      });
    }).then(function () {
      return db.all("strength_tests");
    }).then(function (rows) {
      perf.tests = rows.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    });
  };

  perf.test = function (id) {
    return perf.tests.find(function (t) { return t.id === id; }) || null;
  };
  perf.typeOf = function (test) { return LX.TEST_TYPES[test.type] || LX.TEST_TYPES.reps; };

  perf.saveTest = function (rec) {
    rec.id = rec.id || LX.uuid();
    if (rec.sort === undefined) rec.sort = perf.tests.length;
    if (rec.is_default === undefined) rec.is_default = 0;
    if (rec.archived === undefined) rec.archived = 0;
    return db.put("strength_tests", rec).then(function () { return perf.init(); }).then(function () { return rec; });
  };
  perf.deleteTest = function (id) {
    return db.remove("strength_tests", id)
      .then(function () { return perf.results(id); })
      .then(function (rows) {
        return rows.reduce(function (p, r) {
          return p.then(function () { return db.remove("strength_results", r.id); });
        }, Promise.resolve());
      })
      .then(function () { return perf.init(); });
  };

  /* ---------------- results ---------------- */
  /** The series a result belongs to. Same target / same distance = same series. */
  perf.configKey = function (test, r) {
    if (test.type === "reps_time") return "reps:" + (r.target_reps || 0);
    if (test.type === "distance_time") return "dist:" + (r.distance_km || 0);
    return "default";
  };
  perf.seriesLabel = function (test, key) {
    if (key.indexOf("reps:") === 0) return key.slice(5) + " reps";
    if (key.indexOf("dist:") === 0) return LX.num(Number(key.slice(5)), Number(key.slice(5)) % 1 ? 1 : 0) + " km";
    return test.duration_minutes ? test.duration_minutes + " minutes" : "All results";
  };

  /** Create or update. An edit always updates the same row — never a duplicate. */
  perf.saveResult = function (test, data) {
    var rec = {
      id: data.id || LX.uuid(),
      test_id: test.id,
      date: data.date || LX.D.today(),
      rounds: num(data.rounds),
      extra_reps: num(data.extra_reps),
      target_reps: num(data.target_reps),
      actual_reps: num(data.actual_reps),
      time_seconds: num(data.time_seconds),
      distance_km: num(data.distance_km),
      notes: data.notes || ""
    };
    rec.config_key = perf.configKey(test, rec);
    if (data.created_at) rec.created_at = data.created_at;
    return db.put("strength_results", rec).then(function () { return rec; });
  };
  perf.deleteResult = function (id) { return db.remove("strength_results", id); };
  perf.results = function (testId) {
    return db.all("strength_results").then(function (rows) {
      return rows.filter(function (r) { return !testId || r.test_id === testId; })
        .sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : (a.created_at < b.created_at ? -1 : 1)); });
    });
  };
  function num(x) {
    if (x === "" || x === null || x === undefined) return null;
    var n = Number(x);
    return isNaN(n) ? null : n;
  }

  /* ---------------- analytics ---------------- */
  /** The single number a result is judged on, and whether higher is better. */
  perf.score = function (test, r) {
    if (test.type === "rounds") return (r.rounds || 0) + (r.extra_reps || 0) / 1000;
    if (test.type === "reps") return r.actual_reps;
    return r.time_seconds;
  };
  perf.higherIsBetter = function (test) {
    return test.type === "rounds" || test.type === "reps" || test.type === "time";
  };
  perf.fmtScore = function (test, r) {
    if (!r) return "—";
    if (test.type === "rounds") {
      return (r.rounds || 0) + " rounds" + (r.extra_reps ? " + " + r.extra_reps : "");
    }
    if (test.type === "reps") return LX.num(r.actual_reps) + " reps";
    return perf.fmtTime(r.time_seconds);
  };
  perf.fmtDetail = function (test, r) {
    if (test.type === "reps_time") {
      var missed = r.actual_reps !== null && r.target_reps !== null && r.actual_reps < r.target_reps;
      return (r.actual_reps !== null ? r.actual_reps : r.target_reps) + " of " + r.target_reps + " reps" +
        (missed ? " (target not reached)" : "");
    }
    if (test.type === "distance_time") {
      return LX.num(r.distance_km, r.distance_km % 1 ? 1 : 0) + " km · " +
        perf.fmtPace(perf.pace(r.time_seconds, r.distance_km));
    }
    if (test.type === "rounds" && test.duration_minutes) return test.duration_minutes + " minute AMRAP";
    return "";
  };

  /** Everything the UI needs for one test, split into comparable series. */
  perf.analytics = function (testId) {
    var test = perf.test(testId);
    return perf.results(testId).then(function (rows) {
      var groups = {};
      rows.forEach(function (r) {
        var key = r.config_key || perf.configKey(test, r);
        (groups[key] = groups[key] || []).push(r);
      });
      var series = Object.keys(groups).map(function (key) {
        var list = groups[key];
        var latest = list[list.length - 1];
        var previous = list.length > 1 ? list[list.length - 2] : null;
        var higher = perf.higherIsBetter(test);
        var best = list.reduce(function (a, b) {
          if (!a) return b;
          var sa = perf.score(test, a), sb = perf.score(test, b);
          if (sa === null) return b;
          if (sb === null) return a;
          return (higher ? sb > sa : sb < sa) ? b : a;
        }, null);
        var change = null;
        if (previous && perf.score(test, latest) !== null && perf.score(test, previous) !== null) {
          change = perf.score(test, latest) - perf.score(test, previous);
        }
        return {
          key: key,
          label: perf.seriesLabel(test, key),
          results: list,
          latest: latest, previous: previous, best: best,
          change: change,
          improved: change === null ? null : (higher ? change > 0 : change < 0),
          isBest: best && latest && best.id === latest.id,
          lastDate: latest ? latest.date : null
        };
      }).sort(function (a, b) {
        return (b.lastDate || "") < (a.lastDate || "") ? -1 : 1;
      });
      return { test: test, series: series, count: rows.length };
    });
  };

  /** How a change reads in words, without calling it good or bad for the person. */
  perf.changeText = function (test, s) {
    if (s.change === null || s.change === undefined) return "First result in this series";
    if (s.change === 0) return "Same as last time";
    var higher = perf.higherIsBetter(test);
    var mag;
    if (test.type === "rounds") mag = LX.num(Math.abs(s.change), Math.abs(s.change) % 1 ? 1 : 0) + " rounds";
    else if (test.type === "reps") mag = LX.num(Math.abs(s.change)) + " reps";
    else mag = perf.fmtTime(Math.abs(s.change));
    var dir = s.change > 0 ? "up" : "down";
    return mag + " " + dir + " on last time" + (s.improved ? " — an improvement" : "");
  };

  /* ---------------- views ---------------- */
  perf.renderSection = function (el, head) {
    return Promise.all([perf.results(null), db.all("strength_tests")]).then(function (r) {
      var all = r[0];
      perf.tests = r[1].sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
      var byTest = {};
      all.forEach(function (x) { (byTest[x.test_id] = byTest[x.test_id] || []).push(x); });

      var html = (head || "") +
        '<div class="row" style="gap:10px">' +
        '<button class="btn btn-primary grow" data-perf-log>' + LX.icon("timer") + " Record a test</button>" +
        '<button class="btn grow" data-perf-new>' + LX.icon("plus") + " New test</button></div>";

      if (!perf.tests.length) {
        html += ui.empty("No tests yet", "Create a test to start measuring the same effort over time.");
        el.innerHTML = html;
        bindSection(el);
        return;
      }

      html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Your tests</h2>' +
        '<div class="label">Tap one for history and charts</div></div><div class="list">' +
        perf.tests.map(function (t) {
          var list = (byTest[t.id] || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
          var latest = list[list.length - 1];
          var sub = latest
            ? perf.fmtScore(t, latest) + " · " + LX.D.relative(latest.date)
            : "No results yet";
          return '<button class="list-row tap" data-perf-test="' + t.id + '">' +
            '<span class="grow"><span class="primary">' + LX.esc(t.name) + "</span><br>" +
            '<span class="secondary">' + LX.esc(perf.typeOf(t).name + " · " + sub) + "</span></span>" +
            (list.length ? '<span class="pill-tag">' + list.length + "</span>" : "") +
            LX.icon("chevron") + "</button>";
        }).join("") + "</div></div>";

      var recent = all.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 8);
      if (recent.length) {
        html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Recent results</h2></div>' +
          '<div class="list">' + recent.map(function (x) {
            var t = perf.test(x.test_id);
            if (!t) return "";
            return '<button class="list-row tap" data-perf-edit="' + x.id + '">' +
              '<span class="grow"><span class="primary">' + LX.esc(t.name) + "</span><br>" +
              '<span class="secondary">' + LX.D.relative(x.date) +
              (perf.fmtDetail(t, x) ? " · " + LX.esc(perf.fmtDetail(t, x)) : "") + "</span></span>" +
              '<span class="value">' + LX.esc(perf.fmtScore(t, x)) + "</span>" + LX.icon("chevron") + "</button>";
          }).join("") + "</div></div>";
      } else {
        html += ui.empty("Nothing recorded yet",
          "Record Cindy, a set of push-ups for time, or a 2 km run, and the trend starts building.");
      }

      el.innerHTML = html;
      bindSection(el);
    });
  };

  function bindSection(el) {
    LX.on(el, "click", "[data-perf-log]", function () { perf.pickTest(); });
    LX.on(el, "click", "[data-perf-new]", function () { perf.testSheet(null); });
    LX.on(el, "click", "[data-perf-test]", function (e, t) { perf.detailSheet(t.dataset.perfTest); });
    LX.on(el, "click", "[data-perf-edit]", function (e, t) {
      db.get("strength_results", t.dataset.perfEdit).then(function (rec) {
        if (rec) perf.logSheet(rec.test_id, rec);
      });
    });
  }

  /* ---------------- pick a test ---------------- */
  perf.pickTest = function () {
    ui.sheet({
      title: "Which test?",
      body: '<div class="card flush"><div class="list">' + perf.tests.map(function (t) {
        return '<button class="list-row tap" data-pick-test="' + t.id + '">' +
          '<span class="grow"><span class="primary">' + LX.esc(t.name) + "</span><br>" +
          '<span class="secondary">' + LX.esc(perf.typeOf(t).name) +
          (t.type === "reps_time" && t.target ? " · target " + t.target + " reps" : "") +
          (t.type === "distance_time" && t.target ? " · " + t.target + " km" : "") + "</span></span>" +
          LX.icon("chevron") + "</button>";
      }).join("") + "</div></div>" +
        '<button class="btn btn-block" data-new-test>' + LX.icon("plus") + " Create a new test</button>",
      onMount: function (root, close) {
        LX.on(root, "click", "[data-pick-test]", function (e, t) {
          close();
          perf.logSheet(t.dataset.pickTest, null);
        });
        root.querySelector("[data-new-test]").addEventListener("click", function () {
          close(); perf.testSheet(null);
        });
      }
    });
  };

  /* ---------------- record / edit a result ---------------- */
  perf.logSheet = function (testId, existing) {
    var test = perf.test(testId);
    if (!test) return;
    var r = existing || {};
    var body = ui.field("Date", ui.input("date", { type: "date", value: r.date || LX.D.today() }));

    if (test.type === "rounds") {
      body += '<div class="field-row">' +
        ui.field("Rounds", ui.input("rounds", { type: "number", inputmode: "numeric", value: r.rounds })) +
        ui.field("Extra reps", ui.input("extra_reps", { type: "number", inputmode: "numeric", value: r.extra_reps })) +
        "</div>" +
        (test.duration_minutes ? '<p class="hint" style="margin:0">' + test.duration_minutes + " minute AMRAP.</p>" : "");
    }
    if (test.type === "reps") {
      body += ui.field("Reps", ui.input("actual_reps", { type: "number", inputmode: "numeric", value: r.actual_reps }));
    }
    if (test.type === "time") {
      body += ui.field("Time held", ui.input("time_seconds", { value: r.time_seconds ? perf.fmtTime(r.time_seconds) : "", placeholder: "2:15" }), "Minutes:seconds");
    }
    if (test.type === "reps_time") {
      body += '<div class="field-row">' +
        ui.field("Target reps", ui.input("target_reps", { type: "number", inputmode: "numeric", value: r.target_reps !== undefined && r.target_reps !== null ? r.target_reps : test.target })) +
        ui.field("Reps done", ui.input("actual_reps", { type: "number", inputmode: "numeric", value: r.actual_reps !== undefined && r.actual_reps !== null ? r.actual_reps : (r.target_reps || test.target) })) +
        "</div>" +
        ui.field("Completion time", ui.input("time_seconds", { value: r.time_seconds ? perf.fmtTime(r.time_seconds) : "", placeholder: "6:20" }), "Minutes:seconds") +
        '<p class="hint" style="margin:0">Results are grouped by target, so 75 reps never mixes into your 100-rep trend.</p>';
    }
    if (test.type === "distance_time") {
      var dist = r.distance_km !== undefined && r.distance_km !== null ? r.distance_km : test.target;
      body += ui.field("Distance (km)",
        '<div class="chips" style="margin:0 0 10px;padding-inline:0">' +
        LX.RUN_DISTANCES.map(function (d) {
          return '<button type="button" class="chip" data-dist="' + d + '"' + (Number(dist) === d ? ' aria-pressed="true"' : "") + ">" + d + " km</button>";
        }).join("") + "</div>" +
        ui.input("distance_km", { type: "number", step: "0.1", inputmode: "decimal", value: dist })) +
        ui.field("Completion time", ui.input("time_seconds", { value: r.time_seconds ? perf.fmtTime(r.time_seconds) : "", placeholder: "10:30" }), "Minutes:seconds") +
        '<div class="banner ok" data-pace>' + LX.icon("health") + "<span>Pace appears once you enter a time</span></div>" +
        '<p class="hint" style="margin:0">Each distance keeps its own trend — 2 km and 5 km are never compared.</p>';
    }
    body += ui.field("Notes (optional)", ui.textarea("notes", r.notes, "How it felt, conditions, anything to remember"));

    ui.sheet({
      title: (existing ? "Edit " : "Record ") + test.name,
      body: body,
      footer: (existing ? '<button class="btn btn-danger" data-del>Delete</button>' : '<button class="btn" data-close>Cancel</button>') +
        '<button class="btn btn-primary" data-save>' + (existing ? "Save changes" : "Save result") + "</button>",
      onMount: function (root, close) {
        LX.on(root, "click", "[data-dist]", function (e, t) {
          root.querySelector('[name="distance_km"]').value = t.dataset.dist;
          LX.$$("[data-dist]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
          refreshPace();
        });
        LX.$$('[name="time_seconds"], [name="distance_km"]', root).forEach(function (elx) {
          elx.addEventListener("input", refreshPace);
        });
        function refreshPace() {
          var box = root.querySelector("[data-pace]");
          if (!box) return;
          var v = ui.values(root);
          var secs = perf.parseTime(v.time_seconds), km = Number(v.distance_km);
          box.querySelector("span").textContent = secs && km
            ? perf.fmtTime(secs) + " for " + LX.num(km, km % 1 ? 1 : 0) + " km · " + perf.fmtPace(perf.pace(secs, km))
            : "Pace appears once you enter a time";
        }
        refreshPace();

        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          var data = {
            id: existing ? existing.id : null,
            created_at: existing ? existing.created_at : null,
            date: v.date, notes: v.notes,
            rounds: v.rounds, extra_reps: v.extra_reps,
            target_reps: v.target_reps, actual_reps: v.actual_reps,
            distance_km: v.distance_km,
            time_seconds: v.time_seconds === undefined ? null : perf.parseTime(v.time_seconds)
          };
          if (test.type === "rounds" && !Number(data.rounds)) return ui.toast("Enter the rounds completed", "danger");
          if (test.type === "reps" && !Number(data.actual_reps)) return ui.toast("Enter the reps", "danger");
          if ((test.type === "time" || test.type === "reps_time" || test.type === "distance_time") && !data.time_seconds) {
            return ui.toast("Enter a time like 6:20", "danger");
          }
          if (test.type === "distance_time" && !Number(data.distance_km)) return ui.toast("Enter the distance", "danger");
          perf.saveResult(test, data).then(function () {
            close();
            ui.toast(existing ? "Result updated" : "Result saved");
            LX.haptic();
            document.dispatchEvent(new CustomEvent("lx:data-changed"));
            LX.app.refresh();
          });
        });
        var del = root.querySelector("[data-del]");
        if (del) del.addEventListener("click", function () {
          ui.confirm({
            title: "Delete this result?",
            message: "It is removed from the history and the averages recalculate.",
            confirmText: "Delete", danger: true
          }).then(function (ok) {
            if (!ok) return;
            perf.deleteResult(existing.id).then(function () {
              close(); ui.toast("Result deleted"); LX.app.refresh();
            });
          });
        });
      }
    });
  };

  /* ---------------- test configuration ---------------- */
  perf.testSheet = function (test) {
    var t = test || { type: "reps_time", target: 50, unit: "reps" };
    ui.sheet({
      title: test ? "Edit " + test.name : "New test",
      body:
        ui.field("Name", ui.input("name", { value: t.name || "", placeholder: "Burpees, wall sit, 5 km run" })) +
        ui.field("Type", ui.select("type", Object.keys(LX.TEST_TYPES).map(function (k) {
          return { value: k, label: LX.TEST_TYPES[k].name };
        }), t.type)) +
        '<p class="hint" data-type-hint style="margin:0">' + LX.esc(LX.TEST_TYPES[t.type].hint) + "</p>" +
        '<div class="field-row">' +
        ui.field("Target", ui.input("target", { type: "number", step: "0.1", inputmode: "decimal", value: t.target === null || t.target === undefined ? "" : t.target })) +
        ui.field("Unit", ui.input("unit", { value: t.unit || "reps", placeholder: "reps, km, seconds" })) +
        "</div>" +
        ui.field("Fixed duration (minutes, optional)",
          ui.input("duration_minutes", { type: "number", inputmode: "numeric", value: t.duration_minutes || "" }),
          "For AMRAP tests like Cindy") +
        ui.field("Notes (optional)", ui.textarea("notes", t.notes, "What the test involves")) +
        (test ? '<div class="banner">' + LX.icon("alert") +
          "<span>Changing the target does not touch results you already saved. Older results keep their own target and stay in their own trend.</span></div>" : ""),
      footer: (test && !test.is_default ? '<button class="btn btn-danger" data-del-test>Delete test</button>' : '<button class="btn" data-close>Cancel</button>') +
        '<button class="btn btn-primary" data-save-test>' + (test ? "Save test" : "Create test") + "</button>",
      onMount: function (root, close) {
        var sel = root.querySelector('[name="type"]');
        sel.addEventListener("change", function () {
          root.querySelector("[data-type-hint]").textContent = LX.TEST_TYPES[sel.value].hint;
        });
        root.querySelector("[data-save-test]").addEventListener("click", function () {
          var v = ui.values(root);
          if (!v.name) return ui.toast("Give the test a name", "danger");
          var rec = Object.assign({}, test || {}, {
            name: v.name, type: v.type,
            target: v.target === "" ? null : Number(v.target),
            unit: v.unit || "reps",
            duration_minutes: v.duration_minutes === "" ? null : Number(v.duration_minutes),
            notes: v.notes
          });
          perf.saveTest(rec).then(function () {
            close(); ui.toast(test ? "Test saved" : "Test created"); LX.app.refresh();
          });
        });
        var del = root.querySelector("[data-del-test]");
        if (del) del.addEventListener("click", function () {
          ui.confirm({
            title: "Delete " + test.name + "?",
            message: "The test and all of its results are removed.",
            confirmText: "Delete", danger: true
          }).then(function (ok) {
            if (!ok) return;
            perf.deleteTest(test.id).then(function () { close(); ui.toast("Test deleted"); LX.app.refresh(); });
          });
        });
      }
    });
  };

  /* ---------------- one test: analytics, charts, history ---------------- */
  perf.detailSheet = function (testId) {
    perf.analytics(testId).then(function (a) {
      var test = a.test;
      var body = "";

      if (!a.count) {
        body += ui.empty("No results yet", "Record your first " + test.name + " result to start the trend.",
          "Record result", 'data-log-now');
      }

      a.series.forEach(function (s) {
        var higher = perf.higherIsBetter(test);
        body += '<div class="card"><div class="card-head"><h2>' + LX.esc(s.label) + "</h2>" +
          (s.isBest && s.results.length > 1 ? '<span class="pill-tag">best so far</span>' : "") + "</div>" +
          '<div class="stats" style="grid-template-columns:repeat(2,1fr)">' +
          statBox("Latest", perf.fmtScore(test, s.latest), LX.D.relative(s.latest.date)) +
          statBox("Best", perf.fmtScore(test, s.best), s.best ? LX.D.relative(s.best.date) : "—") +
          statBox("Previous", perf.fmtScore(test, s.previous), s.previous ? LX.D.relative(s.previous.date) : "No earlier result") +
          statBox("Change", s.change === null ? "—" :
            (test.type === "rounds" || test.type === "reps"
              ? (s.change > 0 ? "+" : "") + LX.num(s.change, s.change % 1 ? 1 : 0)
              : (s.change > 0 ? "+" : "−") + perf.fmtTime(Math.abs(s.change))),
            perf.changeText(test, s)) +
          "</div>";

        if (s.results.length > 1) {
          body += '<div style="margin-top:14px">' + charts.line({
            points: s.results.map(function (r) {
              return { label: LX.D.short(r.date), value: perf.score(test, r) };
            }),
            fmt: function (x) {
              return (test.type === "rounds" || test.type === "reps") ? LX.num(x, 0) : perf.fmtTime(x);
            },
            color: chartColor(test),
            aria: test.name + " " + s.label
          }) + "</div>" +
          '<p class="hint">' + (higher ? "Higher is better in this test." : "Lower is better in this test.") +
          " Only results at " + LX.esc(s.label.toLowerCase()) + " appear here.</p>";
        }

        if (test.type === "distance_time" && s.latest) {
          body += '<div class="kv"><span class="muted">Pace, latest</span><b>' +
            perf.fmtPace(perf.pace(s.latest.time_seconds, s.latest.distance_km)) + "</b></div>" +
            '<div class="kv"><span class="muted">Pace, best</span><b>' +
            perf.fmtPace(perf.pace(s.best.time_seconds, s.best.distance_km)) + "</b></div>";
        }
        body += "</div>";

        body += '<div class="card flush"><div style="padding:16px 20px 2px"><h2 style="font:var(--t-h2)">History · ' +
          LX.esc(s.label) + "</h2></div><div class='list'>" +
          s.results.slice().reverse().map(function (r) {
            return '<button class="list-row tap" data-edit-result="' + r.id + '">' +
              '<span class="grow"><span class="primary">' + LX.D.relative(r.date) + "</span>" +
              (perf.fmtDetail(test, r) || r.notes ? '<br><span class="secondary">' +
                LX.esc([perf.fmtDetail(test, r), r.notes].filter(Boolean).join(" · ")) + "</span>" : "") + "</span>" +
              '<span class="value">' + LX.esc(perf.fmtScore(test, r)) + "</span>" +
              LX.icon("edit") + "</button>";
          }).join("") + "</div></div>";
      });

      ui.sheet({
        title: test.name,
        body: body,
        footer: '<button class="btn" data-config>' + LX.icon("edit") + " Settings</button>" +
                '<button class="btn btn-primary" data-log-now>Record result</button>',
        onMount: function (root, close) {
          LX.on(root, "click", "[data-log-now]", function () { close(); perf.logSheet(testId, null); });
          LX.on(root, "click", "[data-config]", function () { close(); perf.testSheet(test); });
          LX.on(root, "click", "[data-edit-result]", function (e, t) {
            db.get("strength_results", t.dataset.editResult).then(function (rec) {
              close();
              perf.logSheet(testId, rec);
            });
          });
        }
      });
    });
  };

  function chartColor(test) {
    if (test.type === "distance_time") return "--c-walking";
    if (test.type === "rounds") return "--c-boxing";
    return "--c-exercise";
  }
  function statBox(label, value, foot) {
    return '<div class="stat"><span class="label">' + LX.esc(label) + '</span><span class="metric">' +
      LX.esc(value) + '</span><span class="foot">' + LX.esc(foot) + "</span></div>";
  }

  /* ---------------- compact dashboard card ---------------- */
  /** Returns "" when there is nothing to show, so Home stays uncluttered. */
  perf.dashboardHTML = function () {
    return perf.results(null).then(function (all) {
      if (!all.length) return "";
      var byTest = {};
      all.forEach(function (r) { (byTest[r.test_id] = byTest[r.test_id] || []).push(r); });

      var cards = perf.tests.map(function (t) {
        var list = (byTest[t.id] || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        if (!list.length) return null;
        // the most recently used series for this test
        var latest = list[list.length - 1];
        var key = latest.config_key || perf.configKey(t, latest);
        var series = list.filter(function (r) { return (r.config_key || perf.configKey(t, r)) === key; });
        var higher = perf.higherIsBetter(t);
        var best = series.reduce(function (a, b) {
          if (!a) return b;
          return (higher ? perf.score(t, b) > perf.score(t, a) : perf.score(t, b) < perf.score(t, a)) ? b : a;
        }, null);
        var sub = perf.seriesLabel(t, key);
        var extra = t.type === "distance_time"
          ? perf.fmtPace(perf.pace(latest.time_seconds, latest.distance_km))
          : "best " + perf.fmtScore(t, best);
        return '<button class="list-row tap" data-perf-test="' + t.id + '">' +
          '<span class="grow"><span class="primary">' + LX.esc(t.name) + "</span><br>" +
          '<span class="secondary">' + LX.esc(sub + " · " + extra + " · " + LX.D.relative(latest.date)) + "</span></span>" +
          '<span class="value">' + LX.esc(perf.fmtScore(t, latest)) + "</span></button>";
      }).filter(Boolean);

      if (!cards.length) return "";
      return '<div class="card flush"><div style="padding:18px 20px 4px" class="row-between">' +
        '<h2 style="font:var(--t-h2)">Strength &amp; performance</h2>' +
        '<button class="link small" data-perf-open style="color:var(--accent)">All tests</button></div>' +
        '<div class="list">' + cards.join("") + "</div></div>";
    });
  };

  perf.bindDashboard = function (el) {
    LX.on(el, "click", "[data-perf-test]", function (e, t) { perf.detailSheet(t.dataset.perfTest); });
    LX.on(el, "click", "[data-perf-open]", function () {
      LX.screens.health.setTab("tests");
      LX.app.go("health");
    });
  };

  LX.perf = perf;
})(window.LX);
