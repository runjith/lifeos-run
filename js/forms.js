/* LifeOS — the logging sheets. Every "add" action in the app opens one of these. */
(function (LX) {
  "use strict";
  var ui = LX.ui, store = LX.store, forms = {};

  function catOptions() {
    return store.categories.map(function (c) { return { value: c.id, label: c.name }; });
  }
  function done(msg, cb) {
    ui.toast(msg);
    LX.haptic();
    document.dispatchEvent(new CustomEvent("lx:data-changed"));
    if (cb) cb();
  }

  /* ---------------- Activity ---------------- */
  forms.logActivity = function (opts) {
    opts = opts || {};
    var date = opts.date || LX.D.today();
    var presets = [15, 30, 45, 60, 90, 120];
    ui.sheet({
      title: "Log activity",
      body:
        ui.field("Category", ui.select("category_id", catOptions(), opts.category_id || store.categories[0].id)) +
        '<div class="field"><span class="label">Duration</span>' +
        '<div class="chips" style="margin:0 0 10px;padding-inline:0">' +
        presets.map(function (m) {
          return '<button type="button" class="chip" data-mins="' + m + '">' + LX.fmtDur(m) + "</button>";
        }).join("") + "</div>" +
        '<div class="stepper"><button type="button" data-step="-5">−</button>' +
        ui.input("duration_minutes", { type: "number", value: opts.minutes || 30, inputmode: "numeric", min: 0 }) +
        '<button type="button" data-step="5">+</button></div>' +
        '<span class="hint">Minutes</span></div>' +
        '<div class="field-row">' +
        ui.field("Date", ui.input("date", { type: "date", value: date })) +
        ui.field("Started at (optional)", ui.input("start_time", { type: "time", value: opts.start_time || "" })) +
        "</div>" +
        ui.field("Title (optional)", ui.input("title", { placeholder: "Store accounts, evening walk…", value: opts.title || "" })) +
        ui.field("Notes (optional)", ui.textarea("notes", "", "Anything worth remembering")),
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save activity</button>',
      onMount: function (root, close) {
        var input = root.querySelector('[name="duration_minutes"]');
        LX.on(root, "click", "[data-mins]", function (e, t) {
          input.value = t.dataset.mins;
          LX.$$("[data-mins]", root).forEach(function (b) { b.classList.remove("is-on"); });
          t.classList.add("is-on");
        });
        LX.on(root, "click", "[data-step]", function (e, t) {
          input.value = Math.max(0, (Number(input.value) || 0) + Number(t.dataset.step));
        });
        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          if (!Number(v.duration_minutes)) return ui.toast("Enter a duration first", "danger");
          var start = v.start_time || null;
          var end = null;
          if (start) end = LX.D.hhmm(LX.D.minsOf(start) + Number(v.duration_minutes));
          store.addActivity({
            date: v.date, category_id: v.category_id, duration_minutes: Number(v.duration_minutes),
            start_time: start, end_time: end, title: v.title, notes: v.notes
          }).then(function () { close(); done("Activity saved", opts.onDone); });
        });
      }
    });
  };

  /* ---------------- Timer ---------------- */
  var TIMER_KEY = "lx_timer";
  forms.timerState = function () {
    try { return JSON.parse(localStorage.getItem(TIMER_KEY) || "null"); } catch (e) { return null; }
  };
  function saveTimer(t) {
    if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t));
    else localStorage.removeItem(TIMER_KEY);
    document.dispatchEvent(new CustomEvent("lx:timer-changed"));
  }
  forms.timerElapsed = function (t) {
    if (!t) return 0;
    var extra = t.running ? (Date.now() - t.since) / 1000 : 0;
    return Math.floor(t.accumulated + extra);
  };
  forms.startTimer = function (categoryId) {
    saveTimer({ category_id: categoryId, accumulated: 0, since: Date.now(), running: true, started_at: LX.now() });
  };
  forms.pauseTimer = function () {
    var t = forms.timerState();
    if (!t || !t.running) return;
    t.accumulated = forms.timerElapsed(t); t.running = false; t.since = null;
    saveTimer(t);
  };
  forms.resumeTimer = function () {
    var t = forms.timerState();
    if (!t || t.running) return;
    t.running = true; t.since = Date.now();
    saveTimer(t);
  };
  forms.discardTimer = function () { saveTimer(null); };
  forms.stopTimer = function (cb) {
    var t = forms.timerState();
    if (!t) return;
    var mins = Math.max(1, Math.round(forms.timerElapsed(t) / 60));
    var started = new Date(t.started_at);
    store.addActivity({
      date: LX.D.iso(started),
      category_id: t.category_id,
      duration_minutes: mins,
      start_time: LX.D.hhmm(started.getHours() * 60 + started.getMinutes()),
      end_time: LX.D.hhmm(new Date().getHours() * 60 + new Date().getMinutes()),
      title: ""
    }).then(function () {
      saveTimer(null);
      done("Saved " + LX.fmtDur(mins), cb);
    });
  };
  forms.pickTimerCategory = function (onDone) {
    ui.sheet({
      title: "Start a timer",
      body: '<div class="list card flush">' + store.categories.map(function (c) {
        return '<button class="list-row tap" data-cat="' + c.id + '">' +
          '<span class="swatch" style="background:var(' + c.color + ')"></span>' +
          '<span class="grow primary">' + LX.esc(c.name) + "</span>" +
          LX.icon("play", "") + "</button>";
      }).join("") + "</div>",
      onMount: function (root, close) {
        LX.on(root, "click", "[data-cat]", function (e, t) {
          forms.startTimer(t.dataset.cat);
          close();
          LX.haptic();
          LX.timerUI.mount();
          var cat = store.cat(t.dataset.cat);
          ui.toast("Timer started" + (cat ? " · " + cat.name : ""));
          if (onDone) onDone();
        });
      }
    });
  };

  /* ---------------- Food ---------------- */
  forms.logFood = function (opts) {
    opts = opts || {};
    var date = opts.date || LX.D.today();
    var meals = ["Breakfast", "Lunch", "Dinner", "Snack"];
    var guessMeal = (function () {
      var h = new Date().getHours();
      return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 21 ? "Dinner" : "Snack";
    })();
    ui.sheet({
      title: "Log food",
      body:
        '<div class="segmented" data-meal-seg>' + meals.map(function (m) {
          return '<button type="button" data-meal="' + m + '" aria-pressed="' + (m === guessMeal) + '">' + m + "</button>";
        }).join("") + "</div>" +
        ui.field("Search common foods", '<input class="input" data-food-search placeholder="Egg, chicken, rice…" />') +
        '<div data-food-results class="list card flush" style="max-height:210px;overflow:auto"></div>' +
        '<div class="section-title" style="font-size:.95rem">Or enter it yourself</div>' +
        ui.field("Food", ui.input("name", { placeholder: "Name" })) +
        '<div class="field-row">' +
        ui.field("Quantity", ui.input("quantity", { type: "number", value: 1, step: "0.1", inputmode: "decimal" })) +
        ui.field("Unit", ui.select("unit", ["g", "ml", "piece", "serving", "scoop", "cup"], "g")) +
        "</div>" +
        '<div class="field-row-3">' +
        ui.field("Calories", ui.input("calories", { type: "number", inputmode: "numeric", placeholder: "kcal" })) +
        ui.field("Protein", ui.input("protein", { type: "number", inputmode: "decimal", placeholder: "g" })) +
        ui.field("Carbs", ui.input("carbs", { type: "number", inputmode: "decimal", placeholder: "g" })) +
        "</div>" +
        '<div class="field-row">' +
        ui.field("Fat", ui.input("fat", { type: "number", inputmode: "decimal", placeholder: "g" })) +
        ui.field("Fibre", ui.input("fiber", { type: "number", inputmode: "decimal", placeholder: "g" })) +
        "</div>" +
        ui.field("Date", ui.input("date", { type: "date", value: date })),
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save food</button>',
      onMount: function (root, close) {
        var meal = guessMeal;
        LX.on(root, "click", "[data-meal]", function (e, t) {
          meal = t.dataset.meal;
          LX.$$("[data-meal]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
        });
        var results = root.querySelector("[data-food-results]");
        var search = root.querySelector("[data-food-search]");
        function renderResults(q) {
          var list = LX.COMMON_FOODS.filter(function (f) {
            return !q || f.name.toLowerCase().indexOf(q.toLowerCase()) >= 0;
          }).slice(0, 8);
          results.innerHTML = list.map(function (f, i) {
            return '<button class="list-row tap" data-preset="' + LX.COMMON_FOODS.indexOf(f) + '">' +
              '<span class="grow"><span class="primary">' + LX.esc(f.name) + "</span><br>" +
              '<span class="secondary">' + f.kcal + " kcal · " + f.p + "g protein per " + f.size + " " + f.unit + "</span></span>" +
              LX.icon("plus") + "</button>";
          }).join("") || '<div style="padding:14px" class="small muted">No match — type the values yourself below.</div>';
        }
        renderResults("");
        search.addEventListener("input", function () { renderResults(search.value); });
        LX.on(root, "click", "[data-preset]", function (e, t) {
          var p = LX.COMMON_FOODS[Number(t.dataset.preset)];
          var qtyEl = root.querySelector('[name="quantity"]');
          var qty = Number(qtyEl.value) || p.size;
          if (Number(qtyEl.value) === 1 && p.unit === "g") qty = p.size;
          var scaled = store.scaleFood(p, qty);
          root.querySelector('[name="name"]').value = scaled.name;
          qtyEl.value = qty;
          root.querySelector('[name="unit"]').value = p.unit;
          ["calories", "protein", "carbs", "fat", "fiber"].forEach(function (k) {
            root.querySelector('[name="' + k + '"]').value = scaled[k];
          });
          ui.toast(p.name + " filled in");
        });
        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          if (!v.name) return ui.toast("Give the food a name", "danger");
          store.addFood({
            date: v.date, meal: meal, name: v.name, quantity: Number(v.quantity) || 1, unit: v.unit,
            calories: Number(v.calories) || 0, protein: Number(v.protein) || 0, carbs: Number(v.carbs) || 0,
            fat: Number(v.fat) || 0, fiber: Number(v.fiber) || 0
          }).then(function () { close(); done("Food saved", opts.onDone); });
        });
      }
    });
  };

  /* ---------------- Workout ---------------- */
  forms.logWorkout = function (opts) {
    opts = opts || {};
    var date = opts.date || LX.D.today();
    var state = { exercises: [] };

    function exerciseHTML(ex, i) {
      return '<div class="card" style="padding:14px" data-ex="' + i + '">' +
        '<div class="row-between" style="margin-bottom:8px">' +
        '<div><div class="primary" style="font-weight:600">' + LX.esc(ex.name) + "</div>" +
        '<div class="secondary small muted" data-prev>' + (ex.prevText || "") + "</div></div>" +
        '<button class="icon-btn" data-rm-ex="' + i + '" aria-label="Remove exercise">' + LX.icon("trash") + "</button></div>" +
        ex.sets.map(function (s, j) {
          return '<div class="field-row-3" style="margin-bottom:6px;align-items:center">' +
            '<input class="input" inputmode="decimal" placeholder="kg" value="' + (s.weight_kg === null ? "" : s.weight_kg) +
            '" data-set="' + i + "," + j + ',weight_kg" />' +
            '<input class="input" inputmode="numeric" placeholder="reps" value="' + (s.reps === null ? "" : s.reps) +
            '" data-set="' + i + "," + j + ',reps" />' +
            '<button class="btn btn-sm" data-rm-set="' + i + "," + j + '">Remove</button>' +
            "</div>";
        }).join("") +
        '<button class="btn btn-sm btn-quiet" data-add-set="' + i + '">' + LX.icon("plus") + " Add set</button>" +
        "</div>";
    }

    ui.sheet({
      title: "Log workout",
      body:
        '<div class="field-row">' +
        ui.field("Type", ui.select("type", LX.WORKOUT_TYPES, opts.type || "Upper")) +
        ui.field("Date", ui.input("date", { type: "date", value: date })) +
        "</div>" +
        ui.field("Duration (minutes)", ui.input("duration_minutes", { type: "number", value: opts.duration || 60, inputmode: "numeric" })) +
        '<div data-ex-list style="display:flex;flex-direction:column;gap:12px"></div>' +
        '<button class="btn btn-block" data-add-ex>' + LX.icon("plus") + " Add exercise</button>" +
        ui.field("Notes (optional)", ui.textarea("notes", "", "How it felt, what to change next time")),
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save workout</button>',
      onMount: function (root, close) {
        var list = root.querySelector("[data-ex-list]");
        function render() {
          list.innerHTML = state.exercises.map(exerciseHTML).join("");
          if (!state.exercises.length) {
            list.innerHTML = '<div class="empty" style="padding:22px"><p style="margin:0">No exercises yet. Add one to record your sets.</p></div>';
          }
        }
        render();

        function addExercise(exRec) {
          var item = { id: exRec.id, name: exRec.name, sets: [{ weight_kg: "", reps: "" }], prevText: "Loading…" };
          state.exercises.push(item);
          render();
          store.exerciseHistory(exRec.id).then(function (h) {
            if (!h.last) item.prevText = "First time logging this";
            else {
              var sets = h.last.sets.map(function (s) { return s.reps; }).join(", ");
              var w = h.last.sets[0] && h.last.sets[0].weight_kg;
              item.prevText = "Last " + LX.D.short(h.last.date) + ": " + (w ? w + " kg × " : "") + sets +
                (h.best && h.best.weight_kg ? "  ·  Best " + h.best.weight_kg + " kg × " + h.best.reps : "");
              if (w) {
                item.sets[0].weight_kg = w;
                render();
              }
            }
            var el = list.querySelector('[data-ex="' + state.exercises.indexOf(item) + '"] [data-prev]');
            if (el) el.textContent = item.prevText;
          });
        }

        root.querySelector("[data-add-ex]").addEventListener("click", function () {
          forms.pickExercise(addExercise);
        });
        LX.on(root, "click", "[data-add-set]", function (e, t) {
          var ex = state.exercises[Number(t.dataset.addSet)];
          var lastSet = ex.sets[ex.sets.length - 1];
          ex.sets.push({ weight_kg: lastSet ? lastSet.weight_kg : "", reps: "" });
          render();
        });
        LX.on(root, "click", "[data-rm-set]", function (e, t) {
          var p = t.dataset.rmSet.split(",");
          state.exercises[+p[0]].sets.splice(+p[1], 1);
          render();
        });
        LX.on(root, "click", "[data-rm-ex]", function (e, t) {
          state.exercises.splice(Number(t.dataset.rmEx), 1);
          render();
        });
        LX.on(root, "input", "[data-set]", function (e, t) {
          var p = t.dataset.set.split(",");
          state.exercises[+p[0]].sets[+p[1]][p[2]] = t.value;
        });

        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          var payload = {
            date: v.date, type: v.type, duration_minutes: Number(v.duration_minutes) || 0, notes: v.notes,
            exercises: state.exercises.map(function (ex) {
              return {
                name: ex.name,
                sets: ex.sets.filter(function (s) { return s.reps !== "" || s.weight_kg !== ""; })
                  .map(function (s) { return { weight_kg: s.weight_kg, reps: s.reps }; })
              };
            })
          };
          store.saveWorkout(payload).then(function () {
            // a workout is also time spent, so log it under Exercise unless told otherwise
            var exCat = store.cat("exercise");
            var add = payload.duration_minutes && exCat
              ? store.addActivity({ date: payload.date, category_id: exCat.id, duration_minutes: payload.duration_minutes, title: payload.type })
              : Promise.resolve();
            return add;
          }).then(function () { close(); done("Workout saved", opts.onDone); });
        });
      }
    });
  };

  forms.pickExercise = function (onPick) {
    var groups = {};
    store.exercises.forEach(function (e) { (groups[e.muscle_group] = groups[e.muscle_group] || []).push(e); });
    function listHTML(q) {
      var out = "";
      Object.keys(groups).sort().forEach(function (g) {
        var items = groups[g].filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) >= 0; });
        if (!items.length) return;
        out += '<div class="label" style="padding:12px 18px 6px">' + LX.esc(g) + "</div>";
        out += items.map(function (e) {
          return '<button class="list-row tap" data-pick="' + e.id + '"><span class="grow primary">' +
            LX.esc(e.name) + "</span>" + LX.icon("plus") + "</button>";
        }).join("");
      });
      return out || '<div style="padding:18px" class="small muted">No match. Type a name and add it as a new exercise.</div>';
    }
    ui.sheet({
      title: "Choose exercise",
      body: '<input class="input" data-ex-search placeholder="Search or type a new exercise" />' +
        '<div class="card flush" data-ex-results style="max-height:50dvh;overflow:auto"></div>' +
        '<button class="btn btn-block" data-new-ex>' + LX.icon("plus") + " Add as new exercise</button>",
      onMount: function (root, close) {
        var results = root.querySelector("[data-ex-results]");
        var search = root.querySelector("[data-ex-search]");
        results.innerHTML = listHTML("");
        search.addEventListener("input", function () { results.innerHTML = listHTML(search.value.toLowerCase()); });
        LX.on(root, "click", "[data-pick]", function (e, t) {
          var ex = store.exercise(t.dataset.pick);
          close(); onPick(ex);
        });
        root.querySelector("[data-new-ex]").addEventListener("click", function () {
          var name = search.value.trim();
          if (!name) return ui.toast("Type a name first", "danger");
          store.ensureExercise(name, "Other").then(function (ex) { close(); onPick(ex); });
        });
      }
    });
  };

  /* ---------------- Sleep ---------------- */
  forms.logSleep = function (opts) {
    opts = opts || {};
    var date = opts.date || LX.D.today();
    ui.sheet({
      title: "Log sleep",
      body:
        ui.field("Night of", ui.input("date", { type: "date", value: date }), "Sleep is filed against the day you woke up.") +
        '<div class="field-row">' +
        ui.field("Bedtime", ui.input("bedtime", { type: "time", value: opts.bedtime || "23:00" })) +
        ui.field("Wake time", ui.input("wake_time", { type: "time", value: opts.wake_time || "06:30" })) +
        "</div>" +
        '<div class="banner ok" data-dur>' + LX.icon("bed") + "<span>7h 30m</span></div>" +
        ui.field("How did it feel?", '<div class="segmented" data-quality>' +
          [1, 2, 3, 4, 5].map(function (q) {
            return '<button type="button" data-q="' + q + '" aria-pressed="' + (q === 3) + '">' + q + "</button>";
          }).join("") + "</div>", "Your own rating from 1 to 5. It is a note to yourself, not a measurement.") +
        ui.field("Notes (optional)", ui.textarea("notes", "", "Woke up twice, late dinner…")),
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save sleep</button>',
      onMount: function (root, close) {
        var quality = 3;
        function refresh() {
          var v = ui.values(root);
          root.querySelector("[data-dur] span").textContent =
            LX.fmtDur(store.durationBetween(v.bedtime, v.wake_time)) + " in bed";
        }
        refresh();
        LX.$$('[name="bedtime"], [name="wake_time"]', root).forEach(function (el) {
          el.addEventListener("change", refresh);
        });
        LX.on(root, "click", "[data-q]", function (e, t) {
          quality = Number(t.dataset.q);
          LX.$$("[data-q]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
        });
        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          var mins = store.durationBetween(v.bedtime, v.wake_time);
          if (!mins) return ui.toast("Set a bedtime and wake time", "danger");
          store.saveSleep({
            date: v.date, bedtime: v.bedtime, wake_time: v.wake_time,
            duration_minutes: mins, quality: quality, notes: v.notes
          }).then(function () { close(); done("Sleep saved", opts.onDone); });
        });
      }
    });
  };

  /* ---------------- Weight ---------------- */
  forms.logWeight = function (opts) {
    opts = opts || {};
    ui.sheet({
      title: "Log weight",
      body:
        '<div class="field-row">' +
        ui.field("Weight", ui.input("weight", { type: "number", step: "0.1", inputmode: "decimal", value: opts.value || "" })) +
        ui.field("Unit", ui.select("unit", ["kg", "lb"], store.settings.units.weight)) +
        "</div>" +
        ui.field("Date", ui.input("date", { type: "date", value: opts.date || LX.D.today() })) +
        ui.field("Note (optional)", ui.input("note", { placeholder: "Morning, after workout…" })),
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save weight</button>',
      onMount: function (root, close) {
        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          if (!Number(v.weight)) return ui.toast("Enter a weight", "danger");
          store.saveWeight({ date: v.date, weight: Number(v.weight), unit: v.unit, note: v.note })
            .then(function () { close(); done("Weight saved", opts.onDone); });
        });
      }
    });
  };

  /* ---------------- Measurements ---------------- */
  forms.logMeasurements = function (opts) {
    opts = opts || {};
    var date = opts.date || LX.D.today();
    store.measurementSnapshot().then(function (snap) {
      var byName = {};
      snap.forEach(function (s) { byName[s.name] = s; });
      ui.sheet({
        title: "Body measurements",
        body:
          ui.field("Date", ui.input("date", { type: "date", value: date })) +
          '<p class="hint" style="margin:0">Fill in only what you measured. Blank fields are left untouched.</p>' +
          LX.MEASUREMENT_SITES.map(function (site) {
            var prev = byName[site];
            var unit = site === "Body Fat %" ? "%" : store.settings.units.length;
            return '<label class="field"><span class="label">' + LX.esc(site) +
              (prev ? ' · last ' + prev.current + " " + prev.unit : "") + "</span>" +
              '<input class="input" type="number" step="0.1" inputmode="decimal" name="m_' + LX.esc(site) +
              '" placeholder="' + unit + '" /></label>';
          }).join("") +
          ui.field("Note (optional)", ui.input("note", { placeholder: "Measured after training" })),
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save measurements</button>',
        onMount: function (root, close) {
          root.querySelector("[data-save]").addEventListener("click", function () {
            var v = ui.values(root);
            var entries = LX.MEASUREMENT_SITES.map(function (site) {
              return { name: site, value: v["m_" + site] };
            }).filter(function (e) { return e.value !== ""; });
            if (!entries.length) return ui.toast("Nothing to save yet", "danger");
            store.saveMeasurements(v.date, entries, v.note)
              .then(function () { close(); done(entries.length + " measurements saved", opts.onDone); });
          });
        }
      });
    });
  };

  /* ---------------- Daily review ---------------- */
  forms.dailyReview = function (opts) {
    opts = opts || {};
    var date = opts.date || LX.D.today();
    Promise.all([LX.db.byDate("daily_reviews", date), store.daySummary(date)]).then(function (r) {
      var rec = r[0][0] || {}, s = r[1];
      ui.sheet({
        title: "Daily review · " + LX.D.relative(date),
        body:
          '<div class="card" style="padding:14px">' +
          kv("Productive", LX.fmtDur(s.productiveMinutes)) +
          kv("Exercise", LX.fmtDur(s.exerciseMinutes)) +
          kv("Entertainment", LX.fmtDur(s.entertainmentMinutes)) +
          kv("Sleep", s.sleepMinutes ? LX.fmtDur(s.sleepMinutes) : "not logged") +
          kv("Calories", s.nutrition.calories ? LX.num(s.nutrition.calories) + " kcal" : "not logged") +
          kv("Untracked", LX.fmtDur(s.untracked)) +
          "</div>" +
          ui.field("What did you plan to do?", ui.textarea("planned", rec.planned, "Three things that mattered today")) +
          ui.field("What actually got done?", ui.textarea("completed", rec.completed, "")) +
          ui.field("Reflection", ui.textarea("journal", rec.journal, "One honest paragraph is enough")),
        footer: '<button class="btn" data-close>Close</button><button class="btn btn-primary" data-save>Save review</button>',
        onMount: function (root, close) {
          root.querySelector("[data-save]").addEventListener("click", function () {
            var v = ui.values(root);
            var out = Object.assign({ id: rec.id || LX.uuid(), date: date }, rec, v);
            LX.db.put("daily_reviews", out).then(function () { close(); done("Review saved", opts.onDone); });
          });
        }
      });
    });
    function kv(k, v2) { return '<div class="kv"><span class="muted">' + k + "</span><b>" + LX.esc(v2) + "</b></div>"; }
  };

  LX.forms = forms;
})(window.LX);
