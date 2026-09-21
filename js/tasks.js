/* RunOS — Tasks.
   A to-do list you visit every day. Ticking a task strikes it through and moves
   it to Finished, where it stays for good: the Finished list is the record of
   everything you have got done, and the trophy numbers are worked out from it.

   One table, `tasks`:
     title, notes, category_id (the same categories as Time), urgency
     (high / medium / low), due_date, due_time, repeat, status (open / done),
     completed_at (the moment it was ticked) and completed_date (that day).

   Repeating tasks: ticking one finishes that occurrence — it goes to Finished
   like any other — and a fresh copy is created with the next date. Every
   completion therefore stays in the record, and `series_id` ties them together.

   Unfinished tasks are never dropped. A task whose date has passed stays under
   Today, marked overdue, until it is done. */
(function (LX) {
  "use strict";
  var db = LX.db, ui = LX.ui, store = LX.store;
  var tasks = {};
  var view = "today";                    // today | upcoming | someday | finished

  /* ================= data ================= */
  tasks.all = function () { return db.all("tasks"); };

  tasks.open = function () {
    return tasks.all().then(function (rows) {
      return rows.filter(function (t) { return t.status !== "done"; }).sort(tasks.compare);
    });
  };
  tasks.finished = function () {
    return tasks.all().then(function (rows) {
      return rows.filter(function (t) { return t.status === "done"; }).sort(function (a, b) {
        return (a.completed_at || "") < (b.completed_at || "") ? 1 : -1;
      });
    });
  };

  /** Overdue first, then by date, then urgency, then time of day. */
  tasks.compare = function (a, b) {
    var da = a.due_date || "9999-99-99", dbb = b.due_date || "9999-99-99";
    if (da !== dbb) return da < dbb ? -1 : 1;
    var ua = (LX.TASK_URGENCY[a.urgency] || LX.TASK_URGENCY.medium).rank;
    var ub = (LX.TASK_URGENCY[b.urgency] || LX.TASK_URGENCY.medium).rank;
    if (ua !== ub) return ua - ub;
    var ta = a.due_time || "99:99", tb = b.due_time || "99:99";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
  };

  /** Split the open list the way the screen shows it. */
  tasks.buckets = function (open, today) {
    today = today || LX.D.today();
    var out = { overdue: [], today: [], upcoming: [], someday: [] };
    open.forEach(function (t) {
      if (!t.due_date) out.someday.push(t);
      else if (t.due_date < today) out.overdue.push(t);
      else if (t.due_date === today) out.today.push(t);
      else out.upcoming.push(t);
    });
    return out;
  };

  tasks.save = function (t) {
    var rec = {
      id: t.id || LX.uuid(),
      title: String(t.title || "").trim(),
      notes: t.notes || "",
      category_id: t.category_id || null,
      urgency: LX.TASK_URGENCY[t.urgency] ? t.urgency : "medium",
      due_date: t.due_date || null,
      due_time: t.due_date && t.due_time ? t.due_time : null,
      repeat: LX.TASK_REPEAT[t.repeat] ? t.repeat : "none",
      series_id: t.series_id || null,
      status: t.status === "done" ? "done" : "open",
      completed_at: t.status === "done" ? (t.completed_at || LX.now()) : null,
      completed_date: t.status === "done" ? (t.completed_date || LX.D.today()) : null
    };
    if (rec.repeat !== "none" && !rec.series_id) rec.series_id = rec.id;
    if (t.created_at) rec.created_at = t.created_at;
    return db.put("tasks", rec).then(function () { return rec; });
  };

  /** The date the next copy of a repeating task is due. Stepped forward from
      its own due date until it is after today, so ticking a daily task that is
      three days overdue gives you tomorrow's, not three more overdue ones. */
  tasks.nextDate = function (t, today) {
    today = today || LX.D.today();
    var d = t.due_date || today;
    var step = function (iso) {
      if (t.repeat === "daily") return LX.D.add(iso, 1);
      if (t.repeat === "weekly") return LX.D.add(iso, 7);
      if (t.repeat === "weekdays") {
        var n = LX.D.add(iso, 1);
        while ([0, 6].indexOf(LX.D.parse(n).getDay()) >= 0) n = LX.D.add(n, 1);
        return n;
      }
      if (t.repeat === "monthly") {
        var p = LX.D.parse(iso), day = Number((t.due_date || iso).slice(8, 10));
        var y = p.getFullYear(), m = p.getMonth() + 1;
        if (m > 11) { m = 0; y++; }
        var last = new Date(y, m + 1, 0).getDate();
        return LX.D.iso(new Date(y, m, Math.min(day, last)));
      }
      return null;
    };
    var next = step(d), guard = 0;
    while (next && next <= today && guard++ < 400) next = step(next);
    return next;
  };

  /** Tick a task off. Returns {task, next} — next is the new copy, if any. */
  tasks.complete = function (id) {
    return db.get("tasks", id).then(function (t) {
      if (!t || t.status === "done") return { task: t, next: null };
      var done = Object.assign({}, t, { status: "done", completed_at: LX.now(), completed_date: LX.D.today() });
      return tasks.save(done).then(function (saved) {
        if (!t.repeat || t.repeat === "none") return { task: saved, next: null };
        var nd = tasks.nextDate(t);
        return tasks.save({
          title: t.title, notes: t.notes, category_id: t.category_id, urgency: t.urgency,
          due_date: nd, due_time: t.due_time, repeat: t.repeat, series_id: t.series_id || t.id
        }).then(function (next) { return { task: saved, next: next }; });
      });
    });
  };

  /** Put a finished task back on the list — for a tick made by mistake. */
  tasks.reopen = function (id) {
    return db.get("tasks", id).then(function (t) {
      if (!t) return null;
      return tasks.save(Object.assign({}, t, { status: "open", completed_at: null, completed_date: null }));
    });
  };

  tasks.remove = function (id) { return db.remove("tasks", id); };

  /** Finished on a given day — used by the daily review. */
  tasks.finishedOn = function (date) {
    return tasks.finished().then(function (rows) {
      return rows.filter(function (t) { return t.completed_date === date; });
    });
  };

  /* ---------- the trophy numbers ---------- */
  tasks.trophies = function (finished, today) {
    today = today || LX.D.today();
    var week = LX.D.weekStart(today), month = today.slice(0, 7);
    var dated = finished.filter(function (t) { return t.due_date; });
    var onTime = dated.filter(function (t) { return t.completed_date <= t.due_date; });

    var days = {};
    finished.forEach(function (t) { if (t.completed_date) days[t.completed_date] = 1; });
    // current run: counts back from today, or from yesterday if nothing is done yet today
    var run = 0, d = days[today] ? today : LX.D.add(today, -1);
    while (days[d]) { run++; d = LX.D.add(d, -1); }
    // best run ever
    var best = 0, keys = Object.keys(days).sort(), cur = 0, prev = null;
    keys.forEach(function (k) {
      cur = prev && LX.D.add(prev, 1) === k ? cur + 1 : 1;
      best = Math.max(best, cur);
      prev = k;
    });

    var weeks = [];
    for (var i = 11; i >= 0; i--) {
      var ws = LX.D.add(week, -7 * i);
      weeks.push({
        start: ws,
        count: finished.filter(function (t) { return t.completed_date && LX.D.weekStart(t.completed_date) === ws; }).length
      });
    }
    return {
      total: finished.length,
      thisWeek: finished.filter(function (t) { return t.completed_date && t.completed_date >= week; }).length,
      thisMonth: finished.filter(function (t) { return (t.completed_date || "").slice(0, 7) === month; }).length,
      onTimeRate: dated.length ? Math.round((onTime.length / dated.length) * 100) : null,
      run: run, best: best, weeks: weeks
    };
  };

  /* ---------- Add to Calendar ---------- */
  function icsText(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  function stamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /** A calendar event with its own alert. Your phone's calendar then does the
      reminding, with nothing for this app to keep running. */
  tasks.ics = function (t) {
    if (!t.due_date) return null;
    var ymd = t.due_date.replace(/-/g, "");
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RunOS//Tasks//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:" + t.id + "@runos",
      "DTSTAMP:" + stamp(new Date())
    ];
    if (t.due_time) {
      var start = t.due_time.replace(":", "") + "00";
      var endMins = LX.D.minsOf(t.due_time) + 30;
      var end = endMins >= 1440 ? "235900" : LX.D.hhmm(endMins).replace(":", "") + "00";
      lines.push("DTSTART:" + ymd + "T" + start, "DTEND:" + ymd + "T" + end);
    } else {
      lines.push("DTSTART;VALUE=DATE:" + ymd, "DTEND;VALUE=DATE:" + LX.D.add(t.due_date, 1).replace(/-/g, ""));
    }
    var rule = { daily: "FREQ=DAILY", weekly: "FREQ=WEEKLY", monthly: "FREQ=MONTHLY",
                 weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }[t.repeat];
    if (rule) lines.push("RRULE:" + rule);
    lines.push("SUMMARY:" + icsText(t.title));
    if (t.notes) lines.push("DESCRIPTION:" + icsText(t.notes));
    lines.push(
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsText(t.title),
      // timed tasks: 15 minutes before. All-day tasks: 9am on the day.
      "TRIGGER:" + (t.due_time ? "-PT15M" : "PT9H"),
      "END:VALARM", "END:VEVENT", "END:VCALENDAR"
    );
    return lines.join("\r\n") + "\r\n";
  };

  tasks.addToCalendar = function (t) {
    var text = tasks.ics(t);
    if (!text) return ui.toast("Give the task a date first", "danger");
    var name = (t.title || "task").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) + ".ics";
    var ok = LX.exporter.download(name, text, "text/calendar");
    ui.toast(ok ? "Open the file to add it to your calendar" : "Your browser blocked the download", ok ? "" : "danger");
  };

  /* ================= shared rendering ================= */
  function metaLine(t, today) {
    var bits = [];
    if (t.status === "done") {
      bits.push("Done " + LX.D.relative(t.completed_date).toLowerCase());
      if (t.due_date && t.completed_date > t.due_date) bits.push("late");
    } else if (t.due_date) {
      if (t.due_date < today) {
        var late = Math.round((LX.D.parse(today) - LX.D.parse(t.due_date)) / 864e5);
        bits.push('<span class="overdue">Overdue ' + late + (late === 1 ? " day" : " days") + "</span>");
      } else if (t.due_date !== today) {
        bits.push(LX.esc(LX.D.relative(t.due_date)));
      }
      if (t.due_time) bits.push(LX.esc(t.due_time));
    }
    var c = t.category_id ? store.cat(t.category_id) : null;
    if (c) bits.push('<span class="swatch" style="background:var(' + c.color + ');display:inline-block;width:8px;height:8px;margin-right:4px"></span>' + LX.esc(c.name));
    if (t.repeat && t.repeat !== "none") bits.push(LX.esc(LX.TASK_REPEAT[t.repeat].replace("Every ", "every ")));
    return bits.join(" · ");
  }

  tasks.rowHTML = function (t, today) {
    today = today || LX.D.today();
    var done = t.status === "done";
    var u = LX.TASK_URGENCY[t.urgency] || LX.TASK_URGENCY.medium;
    var meta = metaLine(t, today);
    return '<div class="list-row task-row' + (done ? " is-done" : "") + '">' +
      '<button class="task-check' + (done ? " is-on" : "") + '" data-task-tick="' + t.id + '" aria-label="' +
      (done ? "Reopen" : "Mark done") + '">' + LX.icon("check") + "</button>" +
      '<button class="grow" data-task-edit="' + t.id + '">' +
      '<span class="primary">' + (done ? "" : '<span class="urg" style="background:var(' + u.color + ')"></span>') +
      LX.esc(t.title) + "</span>" +
      (meta ? '<br><span class="secondary">' + meta + "</span>" : "") + "</button></div>";
  };

  function list(title, rows, foot) {
    if (!rows.length) return "";
    var today = LX.D.today();
    return '<div class="card flush"><div style="padding:16px 20px 4px" class="row-between">' +
      '<h2 style="font:var(--t-h2)">' + title + "</h2>" +
      '<span class="small muted">' + rows.length + "</span></div>" +
      '<div class="list">' + rows.map(function (t) { return tasks.rowHTML(t, today); }).join("") + "</div>" +
      (foot || "") + "</div>";
  }

  function quickAddHTML(placeholder) {
    return '<div class="quick-add"><input class="input" data-task-quick placeholder="' +
      LX.esc(placeholder || "Add a task for today…") + '" enterkeyhint="done" />' +
      '<button class="btn btn-primary" data-task-add aria-label="Add">' + LX.icon("plus") + "</button></div>";
  }

  /** Clicks shared by the Tasks screen and the Home card. */
  tasks.bind = function (el) {
    LX.on(el, "click", "[data-task-tick]", function (e, t) {
      var id = t.dataset.taskTick;
      var wasDone = t.classList.contains("is-on");
      t.classList.toggle("is-on");
      LX.haptic();
      var work = wasDone ? tasks.reopen(id).then(function () { ui.toast("Back on your list"); })
        : tasks.complete(id).then(function (r) {
            ui.toast(r.next ? "Done — next one " + LX.D.relative(r.next.due_date).toLowerCase() : "Done — added to your finished tasks");
          });
      work.then(function () {
        document.dispatchEvent(new CustomEvent("lx:data-changed"));
        setTimeout(LX.app.refresh, 260);        // let the tick animate first
      });
    });
    LX.on(el, "click", "[data-task-edit]", function (e, t) {
      db.get("tasks", t.dataset.taskEdit).then(function (rec) { if (rec) tasks.sheet(rec); });
    });
    function quickAdd() {
      var box = el.querySelector("[data-task-quick]");
      var title = box && box.value.trim();
      if (!title) { if (box) box.focus(); return; }
      tasks.save({ title: title, due_date: LX.D.today(), urgency: "medium" }).then(function () {
        box.value = "";
        ui.toast("Added for today");
        LX.haptic();
        LX.app.refresh();
      });
    }
    LX.on(el, "click", "[data-task-add]", quickAdd);
    LX.on(el, "keydown", "[data-task-quick]", function (e) { if (e.key === "Enter") { e.preventDefault(); quickAdd(); } });
    LX.on(el, "click", "[data-task-new]", function () { tasks.sheet(null); });
    LX.on(el, "click", "[data-task-view]", function (e, t) { view = t.dataset.taskView; LX.app.refresh(); });
    LX.on(el, "click", "[data-task-all]", function () { view = "today"; LX.app.go("tasks"); });
  };

  /* ================= the Tasks screen ================= */
  LX.screens = LX.screens || {};
  LX.screens.tasks = {
    title: function () { return "Tasks"; },
    subtitle: function () { return LX.D.long(LX.D.today()); },
    setView: function (v) { view = v; },
    render: function (el) {
      var today = LX.D.today();
      return Promise.all([tasks.open(), tasks.finished()]).then(function (r) {
        var open = r[0], finished = r[1], b = tasks.buckets(open, today);
        var counts = { today: b.overdue.length + b.today.length, upcoming: b.upcoming.length,
                       someday: b.someday.length, finished: finished.length };
        var tabs = [["today", "Today"], ["upcoming", "Upcoming"], ["someday", "Someday"], ["finished", "Finished"]];

        var html = quickAddHTML(view === "someday" ? "Add a task for today… (or tap + for more)" : null) +
          '<div class="segmented">' + tabs.map(function (t) {
            return '<button data-task-view="' + t[0] + '" aria-pressed="' + (view === t[0]) + '">' + t[1] +
              (counts[t[0]] ? " · " + counts[t[0]] : "") + "</button>";
          }).join("") + "</div>";

        if (view === "today") {
          html += list("Overdue", b.overdue) + list("Today", b.today);
          if (!b.overdue.length && !b.today.length) {
            html += ui.empty(finished.some(function (t) { return t.completed_date === today; }) ? "All done for today" : "Nothing due today",
              "Add something above, or plan ahead with a date.", "New task", "data-task-new");
          }
          var doneToday = finished.filter(function (t) { return t.completed_date === today; });
          html += list("Finished today", doneToday);
        }
        if (view === "upcoming") {
          if (!b.upcoming.length) html += ui.empty("Nothing coming up", "Tasks with a date after today appear here.", "New task", "data-task-new");
          var byDate = {};
          b.upcoming.forEach(function (t) { (byDate[t.due_date] = byDate[t.due_date] || []).push(t); });
          Object.keys(byDate).sort().forEach(function (d) { html += list(LX.esc(LX.D.relative(d)) + " · " + LX.esc(LX.D.short(d)), byDate[d]); });
        }
        if (view === "someday") {
          html += list("Someday", b.someday) ||
            ui.empty("No undated tasks", "Things you want to do without a date — give them one when the time comes.", "New task", "data-task-new");
        }
        if (view === "finished") html += finishedHTML(finished, today);

        html += '<button class="btn btn-block" data-task-new>' + LX.icon("plus") + " New task with date, time and urgency</button>";
        el.innerHTML = html;
        tasks.bind(el);
      });
    }
  };

  function finishedHTML(finished, today) {
    if (!finished.length) {
      return ui.empty("Your trophy case is empty", "Every task you tick off is kept here for good, with the day you finished it.");
    }
    var tr = tasks.trophies(finished, today);
    var stat = function (label, value, foot) {
      return '<div class="stat"><span class="label">' + label + '</span><span class="metric">' + value +
        '</span><span class="foot">' + foot + "</span></div>";
    };
    var html = '<div class="stats">' +
      stat("All time", LX.num(tr.total), tr.total === 1 ? "task finished" : "tasks finished") +
      stat("This week", LX.num(tr.thisWeek), LX.num(tr.thisMonth) + " this month") +
      stat("Day streak", LX.num(tr.run), "best " + tr.best + (tr.best === 1 ? " day" : " days")) +
      stat("On time", tr.onTimeRate === null ? "—" : tr.onTimeRate + "<small>%</small>", "of tasks that had a date") +
      "</div>";
    var perDay = {};
    finished.forEach(function (t) { if (t.completed_date) perDay[t.completed_date] = (perDay[t.completed_date] || 0) + 1; });
    var cal = [];
    for (var d = LX.D.add(today, -111); d <= today; d = LX.D.add(d, 1)) cal.push({ date: d, value: perDay[d] || 0 });
    html += '<div class="card"><div class="card-head"><h2>Your record</h2><span class="small muted">last 16 weeks</span></div>' +
      LX.charts.heatmap(cal, { fmt: function (v) { return v + (v === 1 ? " task" : " tasks"); }, aria: "Tasks finished per day",
        caption: "each square is a day" }) + "</div>";
    html += '<div class="card"><div class="card-head"><h2>Finished per week</h2><span class="small muted">last 12 weeks</span></div>' +
      LX.charts.bars({
        // every third week is labelled so the dates stay readable on a phone
        labels: tr.weeks.map(function (w, i) { return i % 3 === 0 ? LX.D.short(w.start) : ""; }),
        values: tr.weeks.map(function (w) { return w.count; }),
        fmt: function (v) { return String(Math.round(v)); },
        aria: "Tasks finished per week"
      }) + "</div>";

    // grouped by the day they were finished, newest first
    var groups = {}, order = [];
    finished.slice(0, 300).forEach(function (t) {
      var d = t.completed_date || "";
      if (!groups[d]) { groups[d] = []; order.push(d); }
      groups[d].push(t);
    });
    order.forEach(function (d) { html += list(LX.esc(LX.D.relative(d)) + " · " + LX.esc(LX.D.short(d)), groups[d]); });
    if (finished.length > 300) html += '<p class="hint">Showing the latest 300 of ' + finished.length + ". Every one is kept, and all of them are in your backups.</p>";
    return html;
  }

  /* ================= add / edit ================= */
  tasks.sheet = function (existing) {
    var t = existing || { urgency: "medium", due_date: LX.D.today(), repeat: "none" };
    var done = t.status === "done";
    var today = LX.D.today();
    var catOpts = [{ value: "", label: "No category" }].concat(store.categories.map(function (c) {
      return { value: c.id, label: c.name };
    }));
    var dateChips = [["Today", today], ["Tomorrow", LX.D.add(today, 1)], ["Next week", LX.D.add(LX.D.weekStart(today), 7)], ["No date", ""]];

    ui.sheet({
      title: existing ? (done ? "Finished task" : "Edit task") : "New task",
      body:
        ui.field("Task", ui.input("title", { value: t.title || "", placeholder: "Call the bank, renew insurance…" })) +
        '<div class="field"><span class="label">Urgency</span><div class="segmented" data-urg>' +
        Object.keys(LX.TASK_URGENCY).map(function (k) {
          return '<button type="button" data-u="' + k + '" aria-pressed="' + (t.urgency === k) + '">' +
            '<span class="urg" style="background:var(' + LX.TASK_URGENCY[k].color + ')"></span>' + LX.TASK_URGENCY[k].name + "</button>";
        }).join("") + "</div></div>" +
        '<div class="field"><span class="label">When</span><div class="chips" style="margin:0 0 10px;padding-inline:0">' +
        dateChips.map(function (c) {
          return '<button type="button" class="chip' + ((t.due_date || "") === c[1] ? " is-on" : "") + '" data-d="' + c[1] + '">' + c[0] + "</button>";
        }).join("") + "</div>" +
        '<div class="field-row">' + ui.input("due_date", { type: "date", value: t.due_date || "" }) +
        ui.input("due_time", { type: "time", value: t.due_time || "" }) + "</div>" +
        '<span class="hint">Time is optional. With a time, Add to Calendar reminds you 15 minutes before.</span></div>' +
        ui.field("Category", ui.select("category_id", catOpts, t.category_id || "")) +
        ui.field("Repeat", ui.select("repeat", Object.keys(LX.TASK_REPEAT).map(function (k) {
          return { value: k, label: LX.TASK_REPEAT[k] };
        }), t.repeat || "none"), "Ticking a repeating task keeps that one in Finished and adds the next.") +
        ui.field("Notes (optional)", ui.textarea("notes", t.notes, "Details, a phone number, a link")) +
        (done ? '<div class="banner ok">' + LX.icon("trophy") + "<span>Finished " +
          LX.esc(LX.D.relative(t.completed_date).toLowerCase()) +
          (t.completed_at ? " at " + new Date(t.completed_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "") +
          ".</span></div>" : "") +
        (existing && t.due_date ? '<button class="btn btn-block" data-task-cal>' + LX.icon("calendar") + " Add to calendar</button>" : ""),
      footer: (existing
        ? '<button class="btn btn-danger" data-task-del>Delete</button>' +
          (done ? '<button class="btn" data-task-reopen>Reopen</button>' : "")
        : '<button class="btn" data-close>Cancel</button>') +
        '<button class="btn btn-primary" data-task-save>' + (existing ? "Save" : "Add task") + "</button>",
      onMount: function (root, close) {
        var urgency = t.urgency || "medium";
        var dateEl = root.querySelector('[name="due_date"]');
        LX.on(root, "click", "[data-u]", function (e, b) {
          urgency = b.dataset.u;
          LX.$$("[data-u]", root).forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
        });
        LX.on(root, "click", "[data-d]", function (e, b) {
          dateEl.value = b.dataset.d;
          LX.$$("[data-d]", root).forEach(function (x) { x.classList.toggle("is-on", x === b); });
        });
        dateEl.addEventListener("change", function () {
          LX.$$("[data-d]", root).forEach(function (x) { x.classList.toggle("is-on", x.dataset.d === dateEl.value); });
        });
        function collect() {
          var v = ui.values(root);
          return Object.assign({}, existing || {}, {
            title: v.title, notes: v.notes, urgency: urgency, category_id: v.category_id || null,
            due_date: v.due_date || null, due_time: v.due_time || null, repeat: v.repeat
          });
        }
        root.querySelector("[data-task-save]").addEventListener("click", function () {
          var rec = collect();
          if (!String(rec.title || "").trim()) return ui.toast("Give the task a name", "danger");
          tasks.save(rec).then(function () {
            close();
            ui.toast(existing ? "Task saved" : "Task added");
            document.dispatchEvent(new CustomEvent("lx:data-changed"));
            LX.app.refresh();
          });
        });
        var cal = root.querySelector("[data-task-cal]");
        if (cal) cal.addEventListener("click", function () { tasks.addToCalendar(collect()); });
        var reo = root.querySelector("[data-task-reopen]");
        if (reo) reo.addEventListener("click", function () {
          tasks.reopen(existing.id).then(function () { close(); ui.toast("Back on your list"); LX.app.refresh(); });
        });
        var del = root.querySelector("[data-task-del]");
        if (del) del.addEventListener("click", function () {
          ui.confirm({
            title: "Delete this task?",
            message: done ? "Finished tasks are kept for good unless you delete them. This removes it from your record."
                          : "It is removed from your list.",
            confirmText: "Delete", danger: true
          }).then(function (ok) {
            if (!ok) return;
            tasks.remove(existing.id).then(function () { close(); ui.toast("Task deleted"); LX.app.refresh(); });
          });
        });
      }
    });
  };

  /* ================= compact card for Home ================= */
  tasks.dashboardHTML = function () {
    var today = LX.D.today();
    return Promise.all([tasks.open(), tasks.finishedOn(today)]).then(function (r) {
      var b = tasks.buckets(r[0], today), doneToday = r[1];
      var due = b.overdue.concat(b.today);
      var head = '<div style="padding:18px 20px 4px" class="row-between"><div>' +
        '<h2 style="font:var(--t-h2)">Today\u2019s tasks</h2><div class="label">' +
        (due.length ? due.length + " to do" : "Nothing left") +
        (doneToday.length ? " · " + doneToday.length + " done" : "") +
        (b.overdue.length ? ' · <span class="overdue">' + b.overdue.length + " overdue</span>" : "") +
        '</div></div><button class="link small" data-task-all style="color:var(--accent)">All tasks</button></div>';
      var rows = due.slice(0, 6).concat(doneToday.slice(0, 3));
      return '<div class="card flush">' + head +
        (rows.length ? '<div class="list">' + rows.map(function (t) { return tasks.rowHTML(t, today); }).join("") + "</div>" : "") +
        (due.length > 6 ? '<p class="hint" style="padding:0 20px">+ ' + (due.length - 6) + " more on the Tasks tab</p>" : "") +
        '<div style="padding:12px 16px 16px">' + quickAddHTML() + "</div></div>";
    });
  };

  LX.tasks = tasks;
})(window.LX);
