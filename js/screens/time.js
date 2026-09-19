/* LifeOS — Time. Where the 24 hours went, for a day or a span of days. */
(function (LX) {
  "use strict";
  var store = LX.store, charts = LX.charts, forms = LX.forms;
  LX.screens = LX.screens || {};

  var state = { mode: "day", date: LX.D.today(), from: LX.D.add(LX.D.today(), -6), to: LX.D.today() };

  LX.screens.time = {
    title: function () { return "Time"; },
    /** Jump straight to one day (used by the drill-down sheets). */
    setDay: function (iso) { state.mode = "day"; state.date = iso; },
    subtitle: function () {
      if (state.mode === "day") return LX.D.relative(state.date);
      return LX.D.short(state.from) + " – " + LX.D.short(state.to);
    },
    render: function (el) {
      var head =
        '<div class="segmented">' +
        ["day", "week", "month", "custom"].map(function (m) {
          return '<button data-mode="' + m + '" aria-pressed="' + (state.mode === m) + '">' +
            m.charAt(0).toUpperCase() + m.slice(1) + "</button>";
        }).join("") + "</div>";

      var actions =
        '<div class="row" style="gap:10px">' +
        '<button class="btn btn-primary grow" data-timer-start>' + LX.icon("timer") + " Start timer</button>" +
        '<button class="btn grow" data-add>' + LX.icon("plus") + " Add entry</button></div>";

      if (state.mode === "day") return renderDay(el, head, actions);
      return renderRange(el, head, actions);
    }
  };

  function renderDay(el, head, actions) {
    return store.daySummary(state.date).then(function (s) {
      var segs = Object.keys(LX.BUCKETS).filter(function (k) { return k !== "untracked"; })
        .map(function (k) { return { name: LX.BUCKETS[k].name, color: LX.BUCKETS[k].color, minutes: s.buckets[k] }; })
        .filter(function (x) { return x.minutes > 0; });

      var nav = '<div class="row-between card" style="padding:10px 14px">' +
        '<button class="icon-btn" data-day="-1" aria-label="Previous day">' + LX.icon("back") + "</button>" +
        '<div style="text-align:center"><div style="font:var(--t-h3)">' + LX.esc(LX.D.relative(state.date)) + "</div>" +
        '<div class="label">' + LX.esc(LX.D.short(state.date)) + "</div></div>" +
        '<button class="icon-btn" data-day="1" aria-label="Next day"' +
        (state.date >= LX.D.today() ? " disabled style='opacity:.35'" : "") + ">" + LX.icon("chevron") + "</button></div>";

      var html = head + nav + actions +
        '<div class="card"><div class="card-head"><h2>24 hours</h2><span class="small muted">' +
        LX.fmtDur(s.untracked) + " untracked</span></div>" +
        charts.ribbon(segs) +
        charts.legend(segs.map(function (x) { return { name: x.name, color: x.color, value: LX.fmtDur(x.minutes) }; })
          .concat(s.untracked ? [{ name: "Untracked", color: "--c-untracked", value: LX.fmtDur(s.untracked) }] : [])) +
        "</div>";

      if (s.activities.length) {
        html += '<div class="card flush"><div class="list">' + s.activities.map(function (a) {
          var c = store.cat(a.category_id);
          return '<div class="list-row"><span class="swatch" style="background:var(' + (c ? c.color : "--c-other") + ')"></span>' +
            '<span class="grow"><span class="primary">' + LX.esc(a.title || (c ? c.name : "Activity")) + "</span><br>" +
            '<span class="secondary">' + (a.start_time ? a.start_time + (a.end_time ? "–" + a.end_time : "") + " · " : "") +
            LX.esc(c ? c.name : "") + "</span></span>" +
            '<span class="value">' + LX.fmtDur(a.duration_minutes) + "</span>" +
            '<button class="icon-btn" data-del="' + a.id + '" aria-label="Delete entry">' + LX.icon("trash") + "</button></div>";
        }).join("") + "</div></div>";
      } else {
        html += LX.ui.empty("No entries for this day", "Add an entry or start a timer to fill in the gap.");
      }

      el.innerHTML = html;
      bind(el);
    });
  }

  function renderRange(el, head, actions) {
    if (state.mode === "week") { state.to = LX.D.today(); state.from = LX.D.add(state.to, -6); }
    if (state.mode === "month") { state.to = LX.D.today(); state.from = LX.D.add(state.to, -29); }

    return store.rangeSummary(state.from, state.to).then(function (r) {
      var keys = ["sleep", "productive", "exercise", "personal", "chores", "entertainment", "untracked"];
      var days = r.days.length || 1;
      var totalRows = keys.map(function (k) {
        return { key: k, name: LX.BUCKETS[k].name, color: LX.BUCKETS[k].color, minutes: r.totals[k] || 0 };
      }).sort(function (a, b) { return b.minutes - a.minutes; });

      var custom = state.mode === "custom"
        ? '<div class="card"><div class="field-row">' +
          LX.ui.field("From", LX.ui.input("from", { type: "date", value: state.from })) +
          LX.ui.field("To", LX.ui.input("to", { type: "date", value: state.to })) +
          "</div></div>"
        : "";

      var html = head + custom + actions +
        '<div class="card"><div class="card-head"><h2>Each day</h2><span class="small muted">' +
        days + " days · tap a day</span></div>" +
        charts.stackedDays(r.days, keys) +
        charts.legend(keys.map(function (k) { return { name: LX.BUCKETS[k].name, color: LX.BUCKETS[k].color }; })) +
        "</div>";

      html += '<div class="card"><div class="card-head"><h2>Productive hours</h2>' +
        charts.styleToggle(LX.chartStyle()) + "</div>" +
        charts.plot({
          style: LX.chartStyle(),
          labels: r.days.map(function (d) { return days <= 14 ? LX.D.weekdayLetter(d.date) : LX.D.short(d.date); }),
          values: r.days.map(function (d) { return d.buckets.productive / 60; }),
          picks: r.days.map(function (d) { return d.date; }),
          goal: store.goal("productive_minutes") ? store.goal("productive_minutes") / 60 : null,
          color: "--c-work", fmt: function (x) { return LX.num(x, 1) + "h"; },
          aria: "Productive hours per day"
        }) + "</div>";

      html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Totals</h2></div><div class="list">' +
        totalRows.map(function (t) {
          return '<div class="list-row"><span class="swatch" style="background:var(' + t.color + ')"></span>' +
            '<span class="grow"><span class="primary">' + t.name + "</span><br>" +
            '<span class="secondary">' + LX.fmtDur(t.minutes / days) + " a day on average</span></span>" +
            '<span class="value">' + LX.fmtDur(t.minutes) + "</span></div>";
        }).join("") + "</div></div>";

      html += '<div class="card flush"><div style="padding:18px 20px 4px"><h2 style="font:var(--t-h2)">Day by day</h2>' +
        '<div class="label">Tap any day to see what it was made of</div></div><div class="list">' +
        r.days.slice().reverse().map(function (d) {
          var tracked = 1440 - d.buckets.untracked;
          return '<button class="list-row tap" data-open-day="' + d.date + '">' +
            '<span class="grow"><span class="primary">' + LX.esc(LX.D.relative(d.date)) + "</span><br>" +
            '<span class="secondary">' + LX.fmtDur(d.buckets.productive) + " productive · " +
            (d.sleep ? LX.fmtDur(d.sleep) + " sleep" : "no sleep logged") + "</span></span>" +
            '<span class="value">' + LX.fmtDur(tracked) + "</span>" + LX.icon("chevron") + "</button>";
        }).join("") + "</div></div>";

      el.innerHTML = html;
      bind(el);
    });
  }

  function bind(el) {
    LX.bindChartStyle(el);
    LX.on(el, "click", "[data-open-day]", function (e, t) { LX.daySheet(t.dataset.openDay); });
    LX.on(el, "click", "[data-pick]", function (e, t) {
      var d = t.getAttribute("data-pick");
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) LX.daySheet(d);
    });
    LX.on(el, "click", "[data-mode]", function (e, t) {
      state.mode = t.dataset.mode;
      LX.app.refresh();
    });
    LX.on(el, "click", "[data-day]", function (e, t) {
      state.date = LX.D.add(state.date, Number(t.dataset.day));
      if (state.date > LX.D.today()) state.date = LX.D.today();
      LX.app.refresh();
    });
    LX.on(el, "change", '[name="from"], [name="to"]', function () {
      var v = LX.ui.values(el);
      state.from = v.from; state.to = v.to;
      LX.app.refresh();
    });
    LX.on(el, "click", "[data-timer-start]", function () { forms.pickTimerCategory(LX.app.refresh); });
    LX.on(el, "click", "[data-add]", function () {
      forms.logActivity({ date: state.mode === "day" ? state.date : LX.D.today(), onDone: LX.app.refresh });
    });
    LX.on(el, "click", "[data-del]", function (e, t) {
      LX.ui.confirm({ title: "Delete this entry?", message: "This removes it from your totals.", confirmText: "Delete", danger: true })
        .then(function (ok) {
          if (!ok) return;
          LX.db.remove("activities", t.dataset.del).then(function () { LX.ui.toast("Entry deleted"); LX.app.refresh(); });
        });
    });
  }
})(window.LX);
