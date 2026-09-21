/* LifeOS — Weekly goals.
   Skills and habits you want to attempt every week: ten minutes of handstand
   practice, a one-arm push-up session, three cold showers. Kept deliberately
   apart from both workouts and performance tests — ticking one off never writes
   a workout or a test result, and neither of those ever ticks one off.

   Two tables:
     weekly_goals      what you are trying to do, and how often per week
     weekly_goal_logs  one row each time you do it, with the date and the time

   A week runs Monday to Sunday. Every entry stores the week it belongs to, so a
   finished week keeps its verdict even if the goal is changed afterwards. */
(function (LX) {
  "use strict";
  var db = LX.db, ui = LX.ui;
  var weekly = { goals: [] };

  /* ---------------- setup ---------------- */
  weekly.init = function () {
    return db.getKV("seeded_weekly", false).then(function (done) {
      if (done) return;
      var rows = LX.SEED_WEEKLY_GOALS.map(function (g, i) {
        return {
          id: LX.uuid(), slug: g.slug, name: g.name,
          target_type: g.target_type, target_value: g.target_value,
          target_unit: g.target_unit, times_per_week: g.times_per_week,
          notes: g.notes || "", sort: i, active: 1, is_default: 1
        };
      });
      return db.putMany("weekly_goals", rows).then(function () {
        return db.setKV("seeded_weekly", true);
      });
    }).then(function () {
      return db.all("weekly_goals");
    }).then(function (rows) {
      weekly.goals = rows.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    });
  };

  weekly.goal = function (id) {
    return weekly.goals.find(function (g) { return g.id === id; }) || null;
  };
  weekly.typeOf = function (g) {
    return LX.WEEKLY_GOAL_TYPES[g && g.target_type] || LX.WEEKLY_GOAL_TYPES.sessions;
  };
  /** The unit one attempt is measured in. */
  weekly.unitOf = function (g) {
    if (g.target_type === "custom") return g.target_unit || "";
    return weekly.typeOf(g).unit;
  };
  weekly.fmtAmount = function (g, value) {
    var v = Number(value) || 0;
    var n = LX.num(v, v % 1 ? 1 : 0);
    if (g.target_type === "duration") return n + " min";
    if (g.target_type === "sessions") return n + (v === 1 ? " session" : " sessions");
    var u = weekly.unitOf(g);
    return n + (u ? " " + u : "");
  };
  /** "10 min, once a week" / "3× a week" */
  weekly.targetText = function (g) {
    var times = Math.max(1, Number(g.times_per_week) || 1);
    var per = times > 1 ? times + "× a week" : "once a week";
    if (g.target_type === "sessions") return per;
    return weekly.fmtAmount(g, g.target_value) + ", " + per;
  };

  /* ---------------- goals ---------------- */
  weekly.saveGoal = function (rec) {
    rec.id = rec.id || LX.uuid();
    if (rec.sort === undefined) rec.sort = weekly.goals.length;
    if (rec.active === undefined) rec.active = 1;
    if (rec.is_default === undefined) rec.is_default = 0;
    return db.put("weekly_goals", rec).then(function () { return weekly.init(); })
      .then(function () { return rec; });
  };
  weekly.deleteGoal = function (id) {
    return db.remove("weekly_goals", id)
      .then(function () { return weekly.logs(id); })
      .then(function (rows) {
        return rows.reduce(function (p, r) {
          return p.then(function () { return db.remove("weekly_goal_logs", r.id); });
        }, Promise.resolve());
      })
      .then(function () { return weekly.init(); });
  };

  /* ---------------- entries ---------------- */
  weekly.logs = function (goalId) {
    return db.all("weekly_goal_logs").then(function (rows) {
      return rows.filter(function (r) { return !goalId || r.goal_id === goalId; })
        .sort(function (a, b) {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
        });
    });
  };

  /** Create or update. Editing an entry updates the same row, never a second. */
  weekly.saveLog = function (goal, data) {
    data = data || {};
    var date = data.date || LX.D.today();
    var value = data.value;
    if (value === "" || value === null || value === undefined) value = null;
    var rec = {
      id: data.id || LX.uuid(),
      goal_id: goal.id,
      date: date,
      week_start: LX.D.weekStart(date),
      value: value === null ? (goal.target_type === "sessions" ? 1 : Number(goal.target_value) || 1) : Number(value),
      unit: weekly.unitOf(goal),
      notes: data.notes || "",
      completed_at: data.completed_at || LX.now()
    };
    if (data.created_at) rec.created_at = data.created_at;
    return db.put("weekly_goal_logs", rec).then(function () { return rec; });
  };
  weekly.deleteLog = function (id) { return db.remove("weekly_goal_logs", id); };

  /* ---------------- how a week is judged ---------------- */
  /** One entry counts towards the week when it reaches the goal's own target.
      Sessions goals have nothing to reach, so every entry counts. */
  weekly.counts = function (goal, log) {
    if (goal.target_type === "sessions") return true;
    var target = Number(goal.target_value) || 0;
    if (!target) return true;
    return (Number(log.value) || 0) >= target;
  };

  weekly.weekStatus = function (goal, logs, weekStart) {
    var inWeek = logs.filter(function (l) {
      return (l.week_start || LX.D.weekStart(l.date)) === weekStart;
    });
    var done = inWeek.filter(function (l) { return weekly.counts(goal, l); });
    var need = Math.max(1, Number(goal.times_per_week) || 1);
    var current = weekStart === LX.D.weekStart(LX.D.today());
    return {
      weekStart: weekStart,
      label: LX.D.weekLabel(weekStart),
      entries: inWeek,
      done: done.length,
      need: need,
      total: LX.sum(inWeek, function (l) { return Number(l.value) || 0; }),
      complete: done.length >= need,
      current: current,
      /* the week you are in is still open, so it is pending rather than missed */
      missed: !current && done.length < need,
      latest: inWeek.length ? inWeek[inWeek.length - 1] : null
    };
  };

  /** This week plus the weeks behind it, with a streak and a hit rate. */
  weekly.overview = function (goalId, weeks) {
    weeks = weeks || 12;
    var goal = weekly.goal(goalId);
    if (!goal) return Promise.resolve(null);
    return weekly.logs(goalId).then(function (logs) {
      var here = LX.D.weekStart(LX.D.today());
      var all = [];
      for (var i = 0; i < weeks; i++) all.push(weekly.weekStatus(goal, logs, LX.D.add(here, -7 * i)));

      // don't invent empty weeks from before the goal was ever attempted
      var first = logs.length ? (logs[0].week_start || LX.D.weekStart(logs[0].date)) : here;
      var history = all.filter(function (w) { return w.weekStart === here || w.weekStart >= first; });

      var streak = 0;
      for (var j = 0; j < all.length; j++) {
        if (all[j].complete) { streak++; continue; }
        if (j === 0) continue;                 // this week is not over yet
        break;
      }
      var finished = history.filter(function (w) { return !w.current; });
      return {
        goal: goal,
        thisWeek: all[0],
        history: history,
        streak: streak,
        finished: finished.length,
        hits: finished.filter(function (w) { return w.complete; }).length,
        entries: logs.length
      };
    });
  };

  /** Every goal's status for the current week, in one pass. */
  weekly.thisWeek = function () {
    return weekly.logs(null).then(function (logs) {
      var here = LX.D.weekStart(LX.D.today());
      return weekly.goals.filter(function (g) { return g.active !== 0; }).map(function (g) {
        var mine = logs.filter(function (l) { return l.goal_id === g.id; });
        var st = weekly.weekStatus(g, mine, here);
        st.goal = g;
        return st;
      });
    });
  };

  /* ---------------- shared bits of UI ---------------- */
  function statusLine(st) {
    var g = st.goal;
    if (st.complete) {
      var last = st.latest;
      return "Completed" + (last ? " · " + weekly.fmtAmount(g, last.value) + " · " + LX.D.short(last.date) : "") +
        (st.need > 1 ? " · " + st.done + " of " + st.need : "");
    }
    if (st.done || st.entries.length) {
      return st.done + " of " + st.need + " done · " + weekly.targetText(g);
    }
    return "Not completed · " + weekly.targetText(g);
  }
  function goalRow(st, attr) {
    var g = st.goal;
    return '<div class="list-row">' +
      '<button class="grow" data-' + attr + '="' + g.id + '" style="background:none;border:0;padding:0;' +
      'text-align:left;min-width:0;color:inherit;font:inherit">' +
      '<span class="primary">' + LX.esc(g.name) + "</span><br>" +
      '<span class="secondary">' + LX.esc(statusLine(st)) + "</span></button>" +
      (st.complete ? '<span class="pill-tag">done</span>' : "") +
      '<button class="icon-btn" data-wk-tick="' + g.id + '" aria-label="' +
      (st.complete ? "Add another" : "Mark completed") + '"' +
      (st.complete ? ' style="color:var(--accent)"' : "") + ">" +
      LX.icon(st.complete ? "check" : "stop") + "</button></div>";
  }

  /* ---------------- the Weekly tab ---------------- */
  weekly.renderSection = function (el, head) {
    return weekly.init().then(weekly.thisWeek).then(function (list) {
      var html = (head || "") +
        '<button class="btn btn-primary btn-block" data-wk-new>' + LX.icon("plus") + " New weekly goal</button>";

      if (!list.length) {
        html += ui.empty("No weekly goals yet",
          "Add a skill you want to practise every week — handstands, one-arm push-ups, anything you keep meaning to do.");
        el.innerHTML = html;
        weekly.bind(el);
        return;
      }

      var doneCount = list.filter(function (s) { return s.complete; }).length;
      var ends = LX.D.weekEnd(LX.D.today());
      html += '<div class="card flush"><div style="padding:18px 20px 4px" class="row-between">' +
        '<div><h2 style="font:var(--t-h2)">This week</h2>' +
        '<div class="label">' + doneCount + " of " + list.length + " done · ends " + LX.esc(LX.D.short(ends)) + "</div></div>" +
        '<span class="pill-tag">' + doneCount + "/" + list.length + "</span></div>" +
        '<div class="list">' + list.map(function (st) { return goalRow(st, "wk-open"); }).join("") + "</div></div>";

      html += '<p class="hint">Tap a goal for its history. Weeks run Monday to Sunday, and a week that ends ' +
        "without the target being reached is recorded as missed rather than quietly forgotten.</p>";

      el.innerHTML = html;
      weekly.bind(el);
    });
  };

  weekly.bind = function (el) {
    LX.on(el, "click", "[data-wk-new]", function () { weekly.goalSheet(null); });
    LX.on(el, "click", "[data-wk-open]", function (e, t) { weekly.detailSheet(t.dataset.wkOpen); });
    LX.on(el, "click", "[data-wk-tick]", function (e, t) { weekly.tick(t.dataset.wkTick); });
    LX.on(el, "click", "[data-wk-all]", function () {
      LX.screens.health.setTab("weekly");
      LX.app.go("health");
    });
  };

  /** The tick. Sessions goals need no number, so they record straight away;
      anything with an amount opens the sheet with the target already filled in. */
  weekly.tick = function (goalId) {
    var g = weekly.goal(goalId);
    if (!g) return;
    if (g.target_type === "sessions") {
      return weekly.saveLog(g, { date: LX.D.today(), value: 1 }).then(function () {
        ui.toast(g.name + " · marked done");
        LX.haptic();
        document.dispatchEvent(new CustomEvent("lx:data-changed"));
        LX.app.refresh();
      });
    }
    weekly.logSheet(goalId, null);
  };

  /* ---------------- record / edit one attempt ---------------- */
  weekly.logSheet = function (goalId, existing) {
    var g = weekly.goal(goalId);
    if (!g) return;
    var r = existing || {};
    var unit = weekly.unitOf(g);
    var value = r.value !== undefined && r.value !== null ? r.value : g.target_value;

    ui.sheet({
      title: (existing ? "Edit · " : "Completed · ") + g.name,
      body:
        ui.field("Date", ui.input("date", { type: "date", value: r.date || LX.D.today() })) +
        (g.target_type === "sessions"
          ? '<p class="hint" style="margin:0">This goal counts sessions, so nothing else to fill in.</p>'
          : ui.field(g.target_type === "duration" ? "Minutes" : (unit ? unit.charAt(0).toUpperCase() + unit.slice(1) : "Amount"),
              ui.input("value", { type: "number", step: "0.1", inputmode: "decimal", value: value }),
              "Target is " + weekly.fmtAmount(g, g.target_value) + ". Less than that is still recorded — it just does not tick the week off.")) +
        ui.field("Notes (optional)", ui.textarea("notes", r.notes, "How it went, what to try next time")),
      footer: (existing ? '<button class="btn btn-danger" data-wk-del>Delete</button>'
                        : '<button class="btn" data-close>Cancel</button>') +
        '<button class="btn btn-primary" data-wk-save>' + (existing ? "Save changes" : "Mark completed") + "</button>",
      onMount: function (root, close) {
        root.querySelector("[data-wk-save]").addEventListener("click", function () {
          var v = ui.values(root);
          if (g.target_type !== "sessions" && v.value !== "" && !isFinite(Number(v.value))) {
            return ui.toast("Enter a number", "danger");
          }
          weekly.saveLog(g, {
            id: existing ? existing.id : null,
            created_at: existing ? existing.created_at : null,
            completed_at: existing ? existing.completed_at : null,
            date: v.date, value: v.value, notes: v.notes
          }).then(function () {
            close();
            ui.toast(existing ? "Entry updated" : g.name + " · marked done");
            LX.haptic();
            document.dispatchEvent(new CustomEvent("lx:data-changed"));
            LX.app.refresh();
          });
        });
        var del = root.querySelector("[data-wk-del]");
        if (del) del.addEventListener("click", function () {
          ui.confirm({
            title: "Delete this entry?", message: "The week is recalculated without it.",
            confirmText: "Delete", danger: true
          }).then(function (ok) {
            if (!ok) return;
            weekly.deleteLog(existing.id).then(function () {
              close(); ui.toast("Entry deleted"); LX.app.refresh();
            });
          });
        });
      }
    });
  };

  /* ---------------- one goal: this week and every week before ---------------- */
  weekly.detailSheet = function (goalId) {
    weekly.overview(goalId).then(function (o) {
      if (!o) return;
      var g = o.goal;
      var body =
        '<div class="stats" style="grid-template-columns:repeat(2,1fr)">' +
        stat("This week", o.thisWeek.done + " of " + o.thisWeek.need,
          o.thisWeek.complete ? "Completed" : "Still open until " + LX.D.short(LX.D.weekEnd(LX.D.today()))) +
        stat("Target", weekly.fmtAmount(g, g.target_value), weekly.targetText(g)) +
        stat("Run of weeks", String(o.streak), o.streak === 1 ? "week in a row" : "weeks in a row") +
        stat("Weeks completed", o.finished ? o.hits + " of " + o.finished : "—",
          o.finished ? "of the weeks that have ended" : "no completed week yet") +
        "</div>";

      if (g.notes) body += '<p class="hint" style="margin:0">' + LX.esc(g.notes) + "</p>";

      if (o.thisWeek.entries.length) {
        body += '<div class="card flush"><div style="padding:16px 20px 2px"><h2 style="font:var(--t-h2)">This week</h2></div>' +
          '<div class="list">' + o.thisWeek.entries.slice().reverse().map(function (l) {
            return entryRow(g, l);
          }).join("") + "</div></div>";
      }

      var past = o.history.filter(function (w) { return !w.current; });
      if (past.length) {
        body += '<div class="card flush"><div style="padding:16px 20px 2px"><h2 style="font:var(--t-h2)">Week by week</h2>' +
          '<div class="label">Oldest at the bottom</div></div><div class="list">' +
          past.map(function (w) {
            var detail = w.entries.length
              ? w.entries.map(function (l) { return weekly.fmtAmount(g, l.value); }).join(", ")
              : "Nothing recorded";
            return '<div class="list-row"><span class="grow">' +
              '<span class="primary">' + LX.esc(w.label) + "</span><br>" +
              '<span class="secondary">' + LX.esc(detail) + "</span></span>" +
              '<span class="value" style="color:var(' + (w.complete ? "--accent" : "--ink-3") + ')">' +
              (w.complete ? "Completed" : "Missed") + "</span></div>";
          }).join("") + "</div></div>";
      } else if (!o.entries) {
        body += ui.empty("Nothing recorded yet", "Tick it off once and the weekly record starts building.");
      }

      ui.sheet({
        title: g.name,
        body: body,
        footer: '<button class="btn" data-wk-config>' + LX.icon("edit") + " Settings</button>" +
                '<button class="btn btn-primary" data-wk-now>Mark completed</button>',
        onMount: function (root, close) {
          root.querySelector("[data-wk-now]").addEventListener("click", function () {
            close();
            weekly.tick(goalId);
          });
          root.querySelector("[data-wk-config]").addEventListener("click", function () {
            close(); weekly.goalSheet(g);
          });
          LX.on(root, "click", "[data-wk-entry]", function (e, t) {
            LX.db.get("weekly_goal_logs", t.dataset.wkEntry).then(function (rec) {
              if (!rec) return;
              close();
              weekly.logSheet(goalId, rec);
            });
          });
        }
      });
    });
  };

  function entryRow(g, l) {
    var when = LX.D.relative(l.date);
    var time = l.completed_at ? new Date(l.completed_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
    var short = weekly.counts(g, l) ? "" : " · under the target";
    return '<button class="list-row tap" data-wk-entry="' + l.id + '">' +
      '<span class="grow"><span class="primary">' + LX.esc(when) + "</span><br>" +
      '<span class="secondary">' + LX.esc([time, l.notes].filter(Boolean).join(" · ") || "Recorded") +
      LX.esc(short) + "</span></span>" +
      '<span class="value">' + LX.esc(weekly.fmtAmount(g, l.value)) + "</span>" + LX.icon("edit") + "</button>";
  }
  function stat(label, value, foot) {
    return '<div class="stat"><span class="label">' + LX.esc(label) + '</span><span class="metric">' +
      LX.esc(value) + '</span><span class="foot">' + LX.esc(foot) + "</span></div>";
  }

  /* ---------------- goal configuration ---------------- */
  weekly.goalSheet = function (goal) {
    var g = goal || { target_type: "duration", target_value: 10, target_unit: "minutes", times_per_week: 1 };
    ui.sheet({
      title: goal ? "Edit " + goal.name : "New weekly goal",
      body:
        ui.field("Name", ui.input("name", { value: g.name || "", placeholder: "Handstand practice, cold shower, long walk" })) +
        ui.field("Target type", ui.select("target_type", Object.keys(LX.WEEKLY_GOAL_TYPES).map(function (k) {
          return { value: k, label: LX.WEEKLY_GOAL_TYPES[k].name };
        }), g.target_type)) +
        '<p class="hint" data-wk-hint style="margin:0">' + LX.esc(weekly.typeOf(g).hint) + "</p>" +
        '<div class="field-row">' +
        ui.field("Target", ui.input("target_value", {
          type: "number", step: "0.1", inputmode: "decimal",
          value: g.target_value === null || g.target_value === undefined ? "" : g.target_value
        })) +
        ui.field("Times per week", ui.input("times_per_week", {
          type: "number", min: 1, inputmode: "numeric", value: g.times_per_week || 1
        })) +
        "</div>" +
        ui.field("Unit (custom targets only)", ui.input("target_unit", {
          value: g.target_unit || "", placeholder: "km, pages, rounds"
        }), "Duration is in minutes and reps are reps; this is for anything else.") +
        ui.field("Notes (optional)", ui.textarea("notes", g.notes, "What the practice involves")) +
        (goal ? '<div class="banner">' + LX.icon("alert") +
          "<span>Changing the target does not rewrite weeks you have already finished. Each entry keeps the week it was recorded in.</span></div>" : ""),
      footer: (goal ? '<button class="btn btn-danger" data-wk-delgoal>Delete goal</button>'
                    : '<button class="btn" data-close>Cancel</button>') +
        '<button class="btn btn-primary" data-wk-savegoal>' + (goal ? "Save goal" : "Create goal") + "</button>",
      onMount: function (root, close) {
        var sel = root.querySelector('[name="target_type"]');
        sel.addEventListener("change", function () {
          root.querySelector("[data-wk-hint]").textContent = LX.WEEKLY_GOAL_TYPES[sel.value].hint;
        });
        root.querySelector("[data-wk-savegoal]").addEventListener("click", function () {
          var v = ui.values(root);
          if (!v.name) return ui.toast("Give the goal a name", "danger");
          var times = Math.max(1, Math.round(Number(v.times_per_week) || 1));
          var rec = Object.assign({}, goal || {}, {
            name: v.name,
            target_type: v.target_type,
            target_value: v.target_value === "" ? (v.target_type === "sessions" ? times : 1) : Number(v.target_value),
            target_unit: v.target_type === "custom" ? (v.target_unit || "") : LX.WEEKLY_GOAL_TYPES[v.target_type].unit,
            times_per_week: times,
            notes: v.notes
          });
          weekly.saveGoal(rec).then(function () {
            close();
            ui.toast(goal ? "Goal saved" : "Goal created");
            document.dispatchEvent(new CustomEvent("lx:data-changed"));
            LX.app.refresh();
          });
        });
        var del = root.querySelector("[data-wk-delgoal]");
        if (del) del.addEventListener("click", function () {
          ui.confirm({
            title: "Delete " + goal.name + "?",
            message: "The goal and its whole weekly record are removed.",
            confirmText: "Delete", danger: true
          }).then(function (ok) {
            if (!ok) return;
            weekly.deleteGoal(goal.id).then(function () {
              close(); ui.toast("Goal deleted"); LX.app.refresh();
            });
          });
        });
      }
    });
  };

  /* ---------------- compact card for Home ---------------- */
  /** "" when there are no goals, so Home stays uncluttered. */
  weekly.dashboardHTML = function () {
    if (!weekly.goals.length) return Promise.resolve("");
    return weekly.thisWeek().then(function (list) {
      if (!list.length) return "";
      var doneCount = list.filter(function (s) { return s.complete; }).length;
      return '<div class="card flush"><div style="padding:18px 20px 4px" class="row-between">' +
        '<div><h2 style="font:var(--t-h2)">Weekly goals</h2>' +
        '<div class="label">' + doneCount + " of " + list.length + " done this week</div></div>" +
        '<button class="link small" data-wk-all style="color:var(--accent)">All goals</button></div>' +
        '<div class="list">' + list.slice(0, 4).map(function (st) {
          return goalRow(st, "wk-open");
        }).join("") + "</div></div>";
    });
  };

  LX.weekly = weekly;
})(window.LX);
