/* LifeOS — the day drill-down.
   Anywhere a chart shows a day, tapping it opens this: what that one day
   actually looked like, without leaving the screen you were on. */
(function (LX) {
  "use strict";
  var store = LX.store, ui = LX.ui, charts = LX.charts;

  /** Bars or line — remembered in settings so every chart matches. */
  LX.chartStyle = function () {
    return (store.settings && store.settings.chart_style) || "bar";
  };
  LX.setChartStyle = function (style) {
    return store.saveSettings({ chart_style: style });
  };
  /** Wire the Bars/Line toggle on a screen. */
  LX.bindChartStyle = function (el) {
    LX.on(el, "click", "[data-chart-style]", function (e, t) {
      LX.setChartStyle(t.dataset.chartStyle).then(function () { LX.app.refresh(); });
    });
  };

  LX.daySheet = function (date) {
    return store.daySummary(date).then(function (s) {
      var segs = Object.keys(LX.BUCKETS).filter(function (k) { return k !== "untracked"; })
        .map(function (k) { return { name: LX.BUCKETS[k].name, color: LX.BUCKETS[k].color, minutes: s.buckets[k] }; })
        .filter(function (x) { return x.minutes > 0; });

      var body =
        '<div class="stats" style="grid-template-columns:repeat(2,1fr)">' +
        stat("Sleep", s.sleepMinutes ? LX.fmtDur(s.sleepMinutes) : "—", "") +
        stat("Productive", LX.fmtDur(s.productiveMinutes), "") +
        stat("Exercise", LX.fmtDur(s.exerciseMinutes), "") +
        stat("Untracked", LX.fmtDur(s.untracked), "") +
        "</div>";

      if (segs.length) {
        body += '<div class="card"><div class="card-head"><h2>The 24 hours</h2>' +
          '<span class="small muted">' + LX.fmtDur(s.tracked) + " tracked</span></div>" +
          charts.ribbon(segs) +
          charts.legend(segs.map(function (x) {
            return { name: x.name, color: x.color, value: LX.fmtDur(x.minutes) };
          })) + "</div>";
      }

      if (s.activities.length) {
        body += '<div class="card flush"><div style="padding:16px 20px 2px"><h2 style="font:var(--t-h2)">Logged</h2></div>' +
          '<div class="list">' + s.activities.map(function (a) {
            var c = store.cat(a.category_id);
            return '<div class="list-row"><span class="swatch" style="background:var(' +
              (c ? c.color : "--c-other") + ')"></span>' +
              '<span class="grow"><span class="primary">' + LX.esc(a.title || (c ? c.name : "Activity")) + "</span>" +
              (a.start_time ? '<br><span class="secondary">' + a.start_time + "</span>" : "") + "</span>" +
              '<span class="value">' + LX.fmtDur(a.duration_minutes) + "</span></div>";
          }).join("") + "</div></div>";
      }

      if (s.nutrition.calories) {
        body += '<div class="card"><div class="card-head"><h2>Food</h2><span class="small muted">' +
          s.foods.length + " entries</span></div>" +
          kv("Calories", LX.num(s.nutrition.calories) + " kcal") +
          kv("Protein", LX.num(s.nutrition.protein, 1) + " g") +
          kv("Carbs", LX.num(s.nutrition.carbs, 1) + " g") +
          kv("Fat", LX.num(s.nutrition.fat, 1) + " g") + "</div>";
      }

      if (s.workouts.length || s.weight) {
        body += '<div class="card">' +
          s.workouts.map(function (w) {
            return kv(w.type + " workout", LX.fmtDur(w.duration_minutes));
          }).join("") +
          (s.weight ? kv("Weight", LX.num(s.weight.weight, 1) + " " + s.weight.unit) : "") + "</div>";
      }

      if (!s.activities.length && !s.nutrition.calories && !s.sleepMinutes) {
        body += ui.empty("Nothing recorded on this day", "Anything you add for this date will show up here.");
      }

      ui.sheet({
        title: LX.D.relative(date),
        body: body,
        footer: '<button class="btn" data-open-day>Open in Time</button>' +
                '<button class="btn btn-primary" data-close>Close</button>',
        onMount: function (root, close) {
          root.querySelector("[data-open-day]").addEventListener("click", function () {
            close();
            LX.screens.time.setDay(date);
            LX.app.go("time");
          });
        }
      });
    });
  };

  function stat(label, value, foot) {
    return '<div class="stat"><span class="label">' + LX.esc(label) + '</span><span class="metric">' +
      LX.esc(value) + "</span>" + (foot ? '<span class="foot">' + LX.esc(foot) + "</span>" : "") + "</div>";
  }
  function kv(k, v) { return '<div class="kv"><span class="muted">' + LX.esc(k) + "</span><b>" + LX.esc(v) + "</b></div>"; }
})(window.LX);
