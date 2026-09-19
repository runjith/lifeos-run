/* LifeOS — Home. The one screen that answers "how is today going?" */
(function (LX) {
  "use strict";
  var store = LX.store, forms = LX.forms, charts = LX.charts;
  LX.screens = LX.screens || {};

  var date = LX.D.today();

  function statCard(label, value, foot, goal, actual) {
    var pct = goal ? Math.min(100, (actual / goal) * 100) : null;
    return '<div class="stat"><span class="label">' + LX.esc(label) + "</span>" +
      '<span class="metric">' + value + "</span>" +
      (pct !== null
        ? '<div class="bar" style="margin-top:10px"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
          '<span class="foot">' + LX.esc(foot) + "</span>"
        : '<span class="foot">' + LX.esc(foot) + "</span>") +
      "</div>";
  }

  LX.screens.home = {
    title: function () { return LX.D.isToday(date) ? "Today" : LX.D.relative(date); },
    subtitle: function () { return LX.D.long(date) + " · " + LX.D.clockNow(); },

    render: function (el) {
      date = LX.D.today();
      return Promise.all([store.daySummary(date), LX.perf ? LX.perf.dashboardHTML() : ""]).then(function (res) {
        var s = res[0], perfHTML = res[1];
        var goals = store.goals;
        var sleepGoal = goals.sleep_minutes && goals.sleep_minutes.target;
        var exGoal = goals.exercise_minutes && goals.exercise_minutes.target;
        var kcalGoal = goals.calories_kcal && goals.calories_kcal.target;
        var proGoal = goals.protein_g && goals.protein_g.target;

        var segs = Object.keys(LX.BUCKETS).filter(function (k) { return k !== "untracked"; })
          .map(function (k) {
            return { name: LX.BUCKETS[k].name, color: LX.BUCKETS[k].color, minutes: s.buckets[k] };
          }).filter(function (x) { return x.minutes > 0; });

        var html = "";

        html += '<div class="quick">' +
          quickBtn("activity", "plus", "Activity") +
          quickBtn("food", "food", "Food") +
          quickBtn("workout", "dumbbell", "Workout") +
          quickBtn("sleep", "bed", "Sleep") +
          quickBtn("measure", "ruler", "Measure") +
          "</div>";

        html += '<div class="stats">' +
          statCard("Sleep", s.sleepMinutes ? LX.fmtDur(s.sleepMinutes) : "—",
            sleepGoal ? "Goal " + LX.fmtDur(sleepGoal) : "Not logged", sleepGoal, s.sleepMinutes) +
          statCard("Exercise", s.exerciseMinutes ? LX.fmtDur(s.exerciseMinutes) : "—",
            exGoal ? "Goal " + LX.fmtDur(exGoal) : "Not logged", exGoal, s.exerciseMinutes) +
          statCard("Calories", s.nutrition.calories ? LX.num(s.nutrition.calories) + '<small>kcal</small>' : "—",
            kcalGoal ? "Goal " + LX.num(kcalGoal) + " kcal" : "Not logged", kcalGoal, s.nutrition.calories) +
          statCard("Protein", s.nutrition.protein ? LX.num(s.nutrition.protein) + '<small>g</small>' : "—",
            proGoal ? "Goal " + LX.num(proGoal) + " g" : "Not logged", proGoal, s.nutrition.protein) +
          "</div>";

        html += '<div class="card"><div class="card-head"><h2>Where the day went</h2>' +
          '<span class="small muted">' + LX.fmtDur(s.tracked) + " of 24h</span></div>" +
          charts.ribbon(segs) +
          charts.legend(segs.map(function (x) {
            return { name: x.name, color: x.color, value: LX.fmtDur(x.minutes) };
          }).concat(s.untracked > 0
            ? [{ name: "Untracked", color: "--c-untracked", value: LX.fmtDur(s.untracked) }] : [])) +
          "</div>";

        if (s.categories.length) {
          html += '<div class="card flush"><div style="padding:18px 20px 6px"><h2 style="font:var(--t-h2)">By category</h2></div>' +
            '<div class="list">' + s.categories.map(function (c) {
              return '<div class="list-row"><span class="swatch" style="background:var(' + c.color + ')"></span>' +
                '<span class="grow primary">' + LX.esc(c.name) + "</span>" +
                '<span class="value">' + LX.fmtDur(c.minutes) + "</span></div>";
            }).join("") + "</div></div>";
        }

        if (s.activities.length) {
          html += '<div class="card flush"><div style="padding:18px 20px 6px" class="row-between">' +
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
          html += LX.ui.empty("Nothing logged yet", "Start a timer or tap Activity to record your first block of time.",
            "Start a timer", 'data-start-timer');
        }

        if (s.workouts.length) {
          html += '<div class="card"><div class="card-head"><h2>Workout</h2></div>' +
            s.workouts.map(function (w) {
              return '<div class="row-between"><span>' + LX.esc(w.type) + "</span><span class='muted'>" +
                LX.fmtDur(w.duration_minutes) + "</span></div>";
            }).join("") + "</div>";
        }

        if (perfHTML) html += perfHTML;

        html += '<button class="btn btn-block" data-review>' + LX.icon("book") + " Write today\u2019s review</button>";

        el.innerHTML = html;
        bind(el);
        if (LX.perf) LX.perf.bindDashboard(el);
      });
    }
  };

  function quickBtn(action, icon, label) {
    return '<button data-quick="' + action + '">' + LX.icon(icon) + "<span>" + label + "</span></button>";
  }

  function bind(el) {
    LX.on(el, "click", "[data-quick]", function (e, t) {
      var a = t.dataset.quick;
      var opts = { date: date, onDone: LX.app.refresh };
      if (a === "activity") forms.logActivity(opts);
      if (a === "food") forms.logFood(opts);
      if (a === "workout") forms.logWorkout(opts);
      if (a === "sleep") forms.logSleep(opts);
      if (a === "measure") forms.logMeasurements(opts);
    });
    LX.on(el, "click", "[data-start-timer]", function () {
      forms.pickTimerCategory(LX.app.refresh);
    });
    LX.on(el, "click", "[data-review]", function () {
      forms.dailyReview({ date: date, onDone: LX.app.refresh });
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
