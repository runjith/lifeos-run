/* RunOS — Home. The one screen that answers "how is today going, and what's next?"
   Home is built from cards. Which cards show, and in what order, is chosen under
   More → Home screen; the list of possible cards is LX.HOME_CARDS in seed.js. */
(function (LX) {
  "use strict";
  var store = LX.store, forms = LX.forms, charts = LX.charts;
  LX.screens = LX.screens || {};

  var date = LX.D.today();

  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }

  /* A stat you can tap: it opens the sheet that logs that thing. */
  function statCard(action, label, value, foot, goal, actual) {
    var pct = goal ? Math.min(100, (actual / goal) * 100) : null;
    return '<button class="stat tap" data-quick="' + action + '" aria-label="Log ' + LX.esc(label) + '">' +
      '<span class="label row-between">' + LX.esc(label) + LX.icon("plus") + "</span>" +
      '<span class="metric">' + value + "</span>" +
      (pct !== null ? '<div class="bar" style="margin-top:10px"><span style="width:' + pct.toFixed(1) + '%"></span></div>' : "") +
      '<span class="foot">' + LX.esc(foot) + "</span></button>";
  }

  function quickBtn(action, icon, label) {
    return '<button data-quick="' + action + '">' + LX.icon(icon) + "<span>" + label + "</span></button>";
  }

  function checkinHTML(review) {
    var row = function (label, key) {
      var cur = review && review[key];
      return '<div class="checkin-row"><span class="label">' + label + '</span><div class="segmented">' +
        [1, 2, 3, 4, 5].map(function (n) {
          return '<button type="button" data-checkin="' + key + '" data-v="' + n + '" aria-pressed="' + (cur === n) + '">' + n + "</button>";
        }).join("") + "</div></div>";
    };
    var done = review && review.mood && review.energy;
    return '<div class="card"><div class="card-head"><h2>How\u2019s today?</h2>' +
      '<span class="small muted">' + (done ? "Saved · tap to change" : "1 low · 5 high") + "</span></div>" +
      row("Mood", "mood") + row("Energy", "energy") + "</div>";
  }

  /** The cards in the order the user chose, with any new ones added at the end. */
  function cardOrder() {
    var saved = store.settings.home_cards;
    var known = LX.HOME_CARDS.map(function (c) { return c.key; });
    if (!Array.isArray(saved) || !saved.length) return known.map(function (k) { return { key: k, on: true }; });
    var out = saved.filter(function (c) { return known.indexOf(c.key) >= 0; })
      .map(function (c) { return { key: c.key, on: c.on !== false }; });
    known.forEach(function (k) {
      if (!out.some(function (c) { return c.key === k; })) out.push({ key: k, on: true });
    });
    return out;
  }

  LX.screens.home = {
    title: function () { return LX.D.isToday(date) ? "Today" : LX.D.relative(date); },
    subtitle: function () { return LX.D.long(date) + " · " + LX.D.clockNow(); },
    cardOrder: cardOrder,

    render: function (el) {
      date = LX.D.today();
      var order = cardOrder();
      var want = function (k) { return order.some(function (c) { return c.key === k && c.on; }); };
      return Promise.all([
        store.daySummary(date),
        want("strength") && LX.perf ? LX.perf.dashboardHTML() : "",
        want("weekly") && LX.weekly ? LX.weekly.dashboardHTML() : "",
        want("tasks") && LX.tasks ? LX.tasks.dashboardHTML() : "",
        LX.db.byDate("daily_reviews", date),
        LX.exporter.daysSinceBackup(),
        LX.exporter.counts(),
        LX.tasks ? LX.tasks.open() : []
      ]).then(function (res) {
        var s = res[0], review = res[4][0] || null, backupDays = res[5];
        // only things you logged count — not the starter lists the app comes with
        var starter = ["categories", "exercises", "strength_tests", "weekly_goals", "goals"];
        var records = Object.keys(res[6]).reduce(function (a, k) {
          return starter.indexOf(k) >= 0 ? a : a + res[6][k];
        }, 0);
        var openTasks = res[7];
        var dueCount = openTasks.filter(function (t) { return t.due_date && t.due_date <= date; }).length;

        var goals = store.goals;
        var sleepGoal = goals.sleep_minutes && goals.sleep_minutes.target;
        var exGoal = goals.exercise_minutes && goals.exercise_minutes.target;
        var kcalGoal = goals.calories_kcal && goals.calories_kcal.target;
        var proGoal = goals.protein_g && goals.protein_g.target;

        var segs = Object.keys(LX.BUCKETS).filter(function (k) { return k !== "untracked"; })
          .map(function (k) {
            return { name: LX.BUCKETS[k].name, color: LX.BUCKETS[k].color, minutes: s.buckets[k] };
          }).filter(function (x) { return x.minutes > 0; });

        /* ---- the line at the top: what matters right now ---- */
        var line = [];
        if (dueCount) line.push(dueCount + (dueCount === 1 ? " task" : " tasks") + " to do");
        if (!s.sleepMinutes) line.push("sleep not logged");
        if (s.tracked) line.push(LX.fmtDur(s.tracked) + " tracked");
        var html = '<div><p class="greeting">' + greeting() + "</p>" +
          (line.length ? '<p class="small muted" style="margin:2px 0 0">' + LX.esc(line.join(" · ")) + "</p>" : "") + "</div>";

        /* ---- a nudge when a backup is overdue ---- */
        if (records > 20 && (backupDays === null || backupDays > 7)) {
          html += '<button class="banner" data-backup-now style="width:100%;text-align:left">' + LX.icon("share") +
            "<span><b>" + (backupDays === null ? "No backup yet" : "Last backup " + backupDays + " days ago") +
            "</b><br>Tap to share one to Google Drive — takes ten seconds.</span></button>";
        }

        var blocks = {
          quick: function () {
            return '<div class="quick">' +
              quickBtn("activity", "plus", "Activity") +
              quickBtn("food", "food", "Food") +
              quickBtn("workout", "dumbbell", "Workout") +
              quickBtn("sleep", "bed", "Sleep") +
              quickBtn("timer", "timer", "Timer") +
              "</div>";
          },
          stats: function () {
            return '<div class="stats">' +
              statCard("sleep", "Sleep", s.sleepMinutes ? LX.fmtDur(s.sleepMinutes) : "—",
                sleepGoal ? "Goal " + LX.fmtDur(sleepGoal) : "Tap to log", sleepGoal, s.sleepMinutes) +
              statCard("workout", "Exercise", s.exerciseMinutes ? LX.fmtDur(s.exerciseMinutes) : "—",
                exGoal ? "Goal " + LX.fmtDur(exGoal) : "Tap to log", exGoal, s.exerciseMinutes) +
              statCard("food", "Calories", s.nutrition.calories ? LX.num(s.nutrition.calories) + "<small>kcal</small>" : "—",
                kcalGoal ? (s.nutrition.calories && kcalGoal > s.nutrition.calories
                  ? LX.num(kcalGoal - s.nutrition.calories) + " kcal left" : "Goal " + LX.num(kcalGoal) + " kcal") : "Tap to log",
                kcalGoal, s.nutrition.calories) +
              statCard("food", "Protein", s.nutrition.protein ? LX.num(s.nutrition.protein) + "<small>g</small>" : "—",
                proGoal ? (s.nutrition.protein && proGoal > s.nutrition.protein
                  ? LX.num(proGoal - s.nutrition.protein) + " g to go" : "Goal " + LX.num(proGoal) + " g") : "Tap to log",
                proGoal, s.nutrition.protein) +
              "</div>";
          },
          tasks: function () { return res[3] || ""; },
          checkin: function () { return checkinHTML(review); },
          weekly: function () { return res[2] || ""; },
          day: function () {
            var out = '<div class="card"><div class="card-head"><h2>Where the day went</h2>' +
              '<span class="small muted">' + LX.fmtDur(s.tracked) + " of 24h</span></div>" +
              charts.ribbon(segs) +
              charts.legend(segs.map(function (x) {
                return { name: x.name, color: x.color, value: LX.fmtDur(x.minutes) };
              }).concat(s.untracked > 0
                ? [{ name: "Untracked", color: "--c-untracked", value: LX.fmtDur(s.untracked) }] : [])) +
              "</div>";
            if (s.categories.length) {
              out += '<div class="card flush"><div style="padding:18px 20px 6px"><h2 style="font:var(--t-h2)">By category</h2></div>' +
                '<div class="list">' + s.categories.map(function (c) {
                  return '<div class="list-row"><span class="swatch" style="background:var(' + c.color + ')"></span>' +
                    '<span class="grow primary">' + LX.esc(c.name) + "</span>" +
                    '<span class="value">' + LX.fmtDur(c.minutes) + "</span></div>";
                }).join("") + "</div></div>";
            }
            return out;
          },
          logged: function () {
            var out = "";
            if (s.activities.length) {
              out += '<div class="card flush"><div style="padding:18px 20px 6px" class="row-between">' +
                '<h2 style="font:var(--t-h2)">Logged today</h2></div><div class="list">' +
                s.activities.map(function (a) {
                  var c = store.cat(a.category_id);
                  return '<div class="list-row"><span class="swatch" style="background:var(' +
                    (c ? c.color : "--c-other") + ')"></span>' +
                    '<span class="grow"><span class="primary">' + LX.esc(a.title || (c ? c.name : "Activity")) + "</span>" +
                    '<br><span class="secondary">' + (a.start_time ? a.start_time + " · " : "") +
                    LX.esc(c ? c.name : "") + "</span></span>" +
                    '<span class="value">' + LX.fmtDur(a.duration_minutes) + "</span>" +
                    '<button class="icon-btn" data-del-act="' + a.id + '" aria-label="Delete">' + LX.icon("trash") + "</button></div>";
                }).join("") + "</div></div>";
            } else {
              out += LX.ui.empty("Nothing logged yet", "Start a timer or tap Activity to record your first block of time.",
                "Start a timer", "data-start-timer");
            }
            if (s.workouts.length) {
              out += '<div class="card"><div class="card-head"><h2>Workout</h2></div>' +
                s.workouts.map(function (w) {
                  return '<div class="row-between"><span>' + LX.esc(w.type) + "</span><span class='muted'>" +
                    LX.fmtDur(w.duration_minutes) + "</span></div>";
                }).join("") + "</div>";
            }
            return out;
          },
          strength: function () { return res[1] || ""; },
          review: function () {
            return '<button class="btn btn-block" data-review>' + LX.icon("book") + " Write today\u2019s review</button>";
          }
        };

        order.forEach(function (c) { if (c.on && blocks[c.key]) html += blocks[c.key](); });
        html += '<button class="link small" data-home-layout style="color:var(--ink-3);align-self:center">' +
          LX.icon("grid") + " Change what Home shows</button>";

        el.innerHTML = html;
        bind(el);
        if (LX.perf) LX.perf.bindDashboard(el);
        if (LX.weekly) LX.weekly.bind(el);
        if (LX.tasks) LX.tasks.bind(el);
      });
    }
  };

  function bind(el) {
    LX.on(el, "click", "[data-quick]", function (e, t) {
      var a = t.dataset.quick;
      var opts = { date: date, onDone: LX.app.refresh };
      if (a === "activity") forms.logActivity(opts);
      if (a === "food") forms.logFood(opts);
      if (a === "workout") forms.logWorkout(opts);
      if (a === "sleep") forms.logSleep(opts);
      if (a === "timer") forms.pickTimerCategory(LX.app.refresh);
    });
    LX.on(el, "click", "[data-start-timer]", function () {
      forms.pickTimerCategory(LX.app.refresh);
    });
    LX.on(el, "click", "[data-review]", function () {
      forms.dailyReview({ date: date, onDone: LX.app.refresh });
    });
    LX.on(el, "click", "[data-checkin]", function (e, t) {
      var patch = {};
      patch[t.dataset.checkin] = Number(t.dataset.v);
      LX.$$('[data-checkin="' + t.dataset.checkin + '"]', el).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
      LX.haptic();
      forms.saveCheckin(date, patch).then(function () {
        document.dispatchEvent(new CustomEvent("lx:data-changed"));
        LX.ui.toast((t.dataset.checkin === "mood" ? "Mood " : "Energy ") + t.dataset.v + " saved");
      });
    });
    LX.on(el, "click", "[data-backup-now]", function () {
      LX.app.go("more").then(function () {
        var b = document.querySelector('[data-more="backup"]');
        if (b) b.click();
      });
    });
    LX.on(el, "click", "[data-home-layout]", function () {
      LX.app.go("more").then(function () {
        var b = document.querySelector('[data-more="home"]');
        if (b) b.click();
      });
    });
    LX.on(el, "click", "[data-del-act]", function (e, t) {
      LX.ui.confirm({
        title: "Delete this activity?", message: "It will be removed from today's totals.",
        confirmText: "Delete", danger: true
      }).then(function (ok) {
        if (!ok) return;
        LX.db.remove("activities", t.dataset.delAct).then(function () {
          LX.ui.toast("Activity deleted");
          LX.app.refresh();
        });
      });
    });
  }
})(window.LX);
