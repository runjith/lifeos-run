/* LifeOS — More. Account, import, backup, goals, categories, appearance. */
(function (LX) {
  "use strict";
  var ui = LX.ui, db = LX.db, store = LX.store, cloud = LX.cloud, exporter = LX.exporter;
  LX.screens = LX.screens || {};

  LX.screens.more = {
    title: function () { return "Settings"; },
    subtitle: function () { return cloud.statusText(); },
    render: function (el) {
      return Promise.all([exporter.counts(), LX.alerts.list()]).then(function (r0) {
        var counts = r0[0], alerts = r0[1];
        var total = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
        var user = cloud.user();

        el.innerHTML =
          alertsCard(alerts) +
          accountCard(user) +
          group("Your data", [
            row("import", "upload", "Import JSON", "Paste a day from your notes or ChatGPT"),
            row("backup", "download", "Data & backup", total + " records stored on this device"),
            row("review", "book", "Daily review", "Write or edit today's reflection")
          ]) +
          group("Setup", [
            row("goals", "target", "Goals", "Your own targets, not automatic ones"),
            row("foods", "food", "Food values", "What one egg or 100 g of rice counts as"),
            row("categories", "clock", "Time categories", store.categories.length + " categories"),
            row("appearance", "sun", "Appearance", themeLabel()),
            row("home", "grid", "Home screen", "Choose and order what Home shows")
          ]) +
          group("Reference", [
            row("schema", "book", "JSON schema", "The exact shape RunOS accepts"),
            row("about", "user", "About & health check", "Version, sync, backups and storage")
          ]) +
          '<p class="hint" style="text-align:center">RunOS keeps your data on this device first. Nothing leaves it unless you connect an account.</p>';

        LX.on(el, "click", "[data-more]", function (e, t) { open(t.dataset.more); });
        LX.on(el, "click", "[data-alert-dismiss]", function (e, t) {
          LX.alerts.dismiss(t.dataset.alertDismiss).then(function () {
            ui.toast("Hidden for a week");
            LX.app.refresh();
          });
        });
      });
    }
  };

  function themeLabel() {
    var t = store.settings.theme;
    var mode = t === "system" ? "Automatic" : t === "black" ? "Pure black" : t === "dark" ? "Dark" : "Light";
    var th = LX.THEMES.find(function (x) { return x.key === (store.settings.accent || "teal"); }) || LX.THEMES[0];
    return mode + " · " + th.name + " · " + (store.settings.vivid === false ? "Soft" : "Vivid") + " colours";
  }

  /* ---------------- alerts ----------------
     Things that need a look. They live here rather than on Home; a dot on the
     gear at the top shows when there is one. The X hides an alert for a week. */
  var alerts = {};
  alerts.list = function () {
    return Promise.all([exporter.daysSinceBackup(), exporter.counts(), db.getKV("alert_hide_backup", null)])
      .then(function (r) {
        var days = r[0], counts = r[1], hiddenUntil = r[2];
        // only things you logged count — not the starter lists the app comes with
        var starter = ["categories", "exercises", "strength_tests", "weekly_goals", "goals"];
        var mine = Object.keys(counts).reduce(function (a, k) { return starter.indexOf(k) >= 0 ? a : a + counts[k]; }, 0);
        var out = [];
        var hidden = hiddenUntil && hiddenUntil > LX.D.today();
        if (!hidden && mine > 20 && (days === null || days > 7)) {
          out.push({
            key: "backup", icon: "share", action: "backup", actionLabel: "Back up now",
            title: days === null ? "No backup yet" : "Last backup " + days + " days ago",
            text: "Share one to Google Drive — it takes ten seconds."
          });
        }
        return out;
      });
  };
  alerts.dismiss = function (key) {
    return db.setKV("alert_hide_" + key, LX.D.add(LX.D.today(), 7));
  };
  LX.alerts = alerts;

  function alertsCard(list) {
    if (!list.length) return "";
    return '<div><div class="section-title" style="margin-bottom:10px">Alerts</div><div class="card flush"><div class="list">' +
      list.map(function (a) {
        return '<div class="list-row">' + LX.icon(a.icon) +
          '<span class="grow"><span class="primary">' + LX.esc(a.title) + '</span><br><span class="secondary">' +
          LX.esc(a.text) + "</span></span>" +
          '<button class="btn btn-sm btn-primary" data-more="' + a.action + '">' + LX.esc(a.actionLabel) + "</button>" +
          '<button class="icon-btn" data-alert-dismiss="' + a.key + '" aria-label="Hide for a week">' + LX.icon("x") + "</button></div>";
      }).join("") + "</div></div></div>";
  }

  function accountCard(user) {
    var st = cloud.pillState();
    if (!cloud.configured()) {
      return '<div class="card"><div class="card-head"><h2>This device only</h2>' +
        '<span class="sync-pill" data-state="local"><span class="led"></span>Local</span></div>' +
        '<p class="small muted" style="margin-bottom:14px">Cloud sync is switched off because no Supabase project is configured. ' +
        'Everything still works and is saved on this device. Add your project keys in js/config.js to sync across devices.</p>' +
        '<button class="btn btn-block" data-more="backup">' + LX.icon("download") + " Back up your data</button></div>";
    }
    if (!user) {
      return '<div class="card"><div class="card-head"><h2>Sign in to sync</h2>' +
        '<span class="sync-pill" data-state="local"><span class="led"></span>Local</span></div>' +
        '<p class="small muted" style="margin-bottom:14px">Your data is on this device. Sign in to keep it backed up and available on your other devices.</p>' +
        '<button class="btn btn-primary btn-block" data-more="auth">Sign in or create an account</button></div>';
    }
    return '<div class="card"><div class="card-head"><h2>' + LX.esc(user.email || "Signed in") + "</h2>" +
      '<span class="sync-pill" data-state="' + st + '"><span class="led"></span>' + LX.esc(cloud.statusText()) + "</span></div>" +
      '<div class="row" style="gap:10px"><button class="btn grow" data-more="sync">' + LX.icon("refresh") + " Sync now</button>" +
      '<button class="btn grow" data-more="signout">Sign out</button></div></div>';
  }

  function group(title, rows) {
    return '<div><div class="section-title" style="margin-bottom:10px">' + title + "</div>" +
      '<div class="card flush"><div class="list">' + rows.join("") + "</div></div></div>";
  }
  function row(key, icon, title, sub) {
    return '<button class="list-row tap" data-more="' + key + '">' + LX.icon(icon) +
      '<span class="grow"><span class="primary">' + LX.esc(title) + "</span><br>" +
      '<span class="secondary">' + LX.esc(sub) + "</span></span>" + LX.icon("chevron") + "</button>";
  }

  function open(key) {
    var fns = {
      auth: authSheet, signout: signOut, sync: syncNow, import: importSheet, backup: backupSheet,
      goals: goalsSheet, foods: foodValuesSheet, categories: categoriesSheet, appearance: appearanceSheet, home: homeCardsSheet,
      schema: schemaSheet, about: aboutSheet,
      review: function () { LX.forms.dailyReview({ onDone: LX.app.refresh }); }
    };
    if (fns[key]) fns[key]();
  }

  /* ---------------- account ---------------- */
  function authSheet() {
    var mode = "signin";
    ui.sheet({
      title: "Sign in",
      body:
        '<div class="segmented" data-auth-mode><button data-m="signin" aria-pressed="true">Sign in</button>' +
        '<button data-m="signup" aria-pressed="false">Create account</button></div>' +
        ui.field("Email", ui.input("email", { type: "email", placeholder: "you@example.com" })) +
        ui.field("Password", ui.input("password", { type: "password", placeholder: "At least 8 characters" })) +
        '<div class="banner hidden" data-err>' + LX.icon("alert") + "<span></span></div>",
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-go>Continue</button>',
      onMount: function (root, close) {
        var err = root.querySelector("[data-err]");
        LX.on(root, "click", "[data-m]", function (e, t) {
          mode = t.dataset.m;
          LX.$$("[data-m]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
          root.querySelector("[data-go]").textContent = mode === "signin" ? "Sign in" : "Create account";
        });
        root.querySelector("[data-go]").addEventListener("click", function () {
          var v = ui.values(root);
          if (!v.email || !v.password) return showErr("Enter your email and password.");
          var btn = root.querySelector("[data-go]");
          btn.disabled = true; btn.textContent = "Working…";
          var p = mode === "signin" ? cloud.signIn(v.email, v.password) : cloud.signUp(v.email, v.password);
          p.then(function (r) {
            if (r && r.needsConfirmation) {
              close();
              ui.toast("Check your email to confirm the account");
              return;
            }
            if (r && r.accountChanged) {
              close();
              return ui.confirm({
                title: "This device holds another account's data",
                message: "It was last used by " + (r.previousEmail || "a different account") + " and has " +
                  r.localRows + " records saved here. Continuing uploads them to " + v.email +
                  " and merges the two. If that is not what you want, cancel and sign in as " +
                  (r.previousEmail || "the other account") + " instead.",
                confirmText: "Merge and continue", danger: true
              }).then(function (ok) {
                if (!ok) {
                  return cloud.signOut().then(function () {
                    ui.toast("Signed out — nothing was uploaded and your local data is untouched");
                    LX.app.refresh();
                  });
                }
                cloud.confirmAccount();
                ui.toast("Merging with " + v.email);
                return cloud.sync().then(LX.app.refresh);
              });
            }
            close();
            ui.toast("Signed in");
            return cloud.sync().then(LX.app.refresh);
          }).catch(function (e) {
            btn.disabled = false; btn.textContent = "Continue";
            showErr(e.message);
          });
        });
        function showErr(m) {
          err.classList.remove("hidden");
          err.classList.add("danger");
          err.querySelector("span").textContent = m;
        }
      }
    });
  }
  function signOut() {
    ui.confirm({
      title: "Sign out?",
      message: "Your data stays on this device. Anything not yet synced will sync next time you sign in.",
      confirmText: "Sign out"
    }).then(function (ok) {
      if (!ok) return;
      cloud.signOut().then(function () { ui.toast("Signed out"); LX.app.refresh(); });
    });
  }
  function syncNow() {
    cloud.sync().then(function (r) {
      var msg = r.skipped
        ? "Nothing to sync (" + r.skipped + ")"
        : "Synced " + r.pushed + " up, " + r.pulled + " down" +
          (r.adopted ? " · merged " + r.adopted + " duplicate list entries" : "");
      ui.toast(msg);
      LX.app.refresh();
    }).catch(function () {});
  }

  /* ---------------- import ---------------- */
  function importSheet() {
    ui.sheet({
      title: "Import JSON",
      body:
        '<p class="small muted" style="margin:0">Paste a day in the RunOS format. Nothing is saved until you see the preview and tap Import.</p>' +
        '<textarea class="textarea" data-json style="min-height:170px;font-family:ui-monospace,Menlo,monospace;font-size:13px" placeholder=\'{"date":"' + LX.D.today() + '", "food":[…]}\'></textarea>' +
        '<div class="row" style="gap:10px"><button class="btn grow btn-sm" data-sample>Load sample</button>' +
        '<button class="btn grow btn-sm" data-paste>Paste from clipboard</button></div>' +
        '<div data-preview></div>',
      footer: '<button class="btn" data-close>Cancel</button>' +
              '<button class="btn btn-primary" data-validate>Validate</button>',
      onMount: function (root, close) {
        var ta = root.querySelector("[data-json]");
        var preview = root.querySelector("[data-preview]");
        var result = null;

        root.querySelector("[data-sample]").addEventListener("click", function () {
          ta.value = JSON.stringify(LX.importer.SAMPLE, null, 2);
        });
        root.querySelector("[data-paste]").addEventListener("click", function () {
          if (!navigator.clipboard || !navigator.clipboard.readText) return ui.toast("Paste it in manually — your browser blocks clipboard reads", "danger");
          navigator.clipboard.readText().then(function (t) { ta.value = t; }).catch(function () {
            ui.toast("Could not read the clipboard", "danger");
          });
        });

        root.querySelector("[data-validate]").addEventListener("click", function () {
          var btn = root.querySelector("[data-validate]");
          if (btn.dataset.stage === "import" && result && result.ok) {
            btn.disabled = true; btn.textContent = "Importing…";
            LX.importer.apply(result).then(function (n) {
              close();
              ui.toast(n + " records imported");
              document.dispatchEvent(new CustomEvent("lx:data-changed"));
              LX.app.refresh();
            });
            return;
          }
          result = LX.importer.validate(ta.value);
          preview.innerHTML = previewHTML(result);
          if (result.ok) { btn.textContent = "Import " + result.items.length + " entries"; btn.dataset.stage = "import"; }
          else { btn.textContent = "Validate"; btn.dataset.stage = ""; }
        });
      }
    });
  }

  function previewHTML(r) {
    var html = "";
    if (r.errors.length) {
      html += '<div class="banner danger">' + LX.icon("alert") + "<span><b>Fix these first</b><br>" +
        r.errors.map(LX.esc).join("<br>") + "</span></div>";
    }
    if (r.warnings.length) {
      html += '<div class="banner">' + LX.icon("alert") + "<span>" + r.warnings.map(LX.esc).join("<br>") + "</span></div>";
    }
    if (r.items.length) {
      html += '<div class="card flush"><div style="padding:16px 18px 4px"><h2 style="font:var(--t-h2)">Import preview</h2>' +
        '<div class="label">' + r.items.length + " entries across " + r.payloads.length + " day(s)</div></div>" +
        '<div class="list">' + r.items.map(function (i) {
          return '<div class="list-row" style="min-height:44px;padding:9px 18px">' +
            '<span style="color:var(' + (i.missing ? "--warn" : "--ok") + ')">' + LX.icon(i.missing ? "alert" : "check") + "</span>" +
            '<span class="grow"><span class="primary">' + LX.esc(i.kind) + "</span></span>" +
            '<span class="secondary">' + LX.esc(i.text) + "</span></div>";
        }).join("") + "</div></div>";
    }
    return html;
  }

  /* ---------------- backup ---------------- */
  function backupSheet() {
    Promise.all([exporter.counts(), exporter.daysSinceBackup()]).then(function (r0) {
      var counts = r0[0], days = r0[1];
      ui.sheet({
        title: "Data & backup",
        body:
          '<div class="card" style="padding:14px">' + Object.keys(counts).filter(function (k) { return counts[k]; })
            .map(function (k) {
              return '<div class="kv"><span class="muted">' + k.replace(/_/g, " ") + "</span><b>" + counts[k] + "</b></div>";
            }).join("") + "</div>" +
          '<div class="banner' + (days === null || days > 7 ? "" : " ok") + '">' + LX.icon(days === null || days > 7 ? "alert" : "check") +
          "<span>" + (days === null ? "No backup has left this device yet." : "Last backup " +
            (days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago") + ".") + "</span></div>" +
          '<button class="btn btn-primary btn-block" data-share disabled>' + LX.icon("share") + " Share backup — Drive, Files, email\u2026</button>" +
          '<p class="hint" style="margin:0">Opens your phone\u2019s share sheet. Pick Google Drive (or Save to Files \u2192 Google Drive).</p>' +
          '<button class="btn btn-block" data-full>' + LX.icon("download") + " Download full backup (JSON)</button>" +
          '<button class="btn btn-block" data-copy>Copy backup to clipboard</button>' +
          '<button class="btn btn-block" data-csv>' + LX.icon("download") + " Download CSV files</button>" +
          '<div class="section-title" style="font-size:1rem;margin-top:8px">Restore</div>' +
          '<p class="small muted" style="margin:0">Choose a backup file. Merge keeps what is here and adds the file on top; replace wipes this device first.</p>' +
          '<input class="input" type="file" accept="application/json" data-file />' +
          '<div class="row" style="gap:10px"><button class="btn grow" data-restore="merge">Merge</button>' +
          '<button class="btn btn-danger grow" data-restore="replace">Replace everything</button></div>' +
          '<div class="section-title" style="font-size:1rem;margin-top:8px">Danger zone</div>' +
          '<button class="btn btn-danger btn-block" data-wipe>' + LX.icon("trash") + " Delete all local data</button>",
        footer: '<button class="btn btn-block" data-close>Close</button>',
        onMount: function (root, close) {
          // the file is built now, so the share sheet can open the instant you tap
          var prepared = null, shareBtn = root.querySelector("[data-share]");
          exporter.prepareShare().then(function (pf) { prepared = pf; shareBtn.disabled = false; });
          shareBtn.addEventListener("click", function () {
            if (!prepared) return;
            exporter.share(prepared).then(function (res) {
              if (res === "shared") ui.toast("Backup shared");
              else if (res === "downloaded") ui.toast("Backup saved to your downloads");
              else if (res === "failed") ui.toast("Could not share or download here — use copy instead", "danger");
              if (res === "shared" || res === "downloaded") { close(); LX.app.refresh(); }
            });
          });
          root.querySelector("[data-full]").addEventListener("click", function () {
            exporter.buildBackup().then(function (b) {
              var ok = exporter.download(exporter.backupName(), JSON.stringify(b, null, 2));
              if (ok) exporter.markBackup();
              ui.toast(ok ? "Backup downloaded" : "Download blocked here — use copy instead", ok ? "" : "danger");
            });
          });
          root.querySelector("[data-copy]").addEventListener("click", function () {
            exporter.buildBackup().then(function (b) {
              return exporter.copy(JSON.stringify(b));
            }).then(function () { exporter.markBackup(); ui.toast("Backup copied — paste it somewhere safe"); })
              .catch(function () { ui.toast("Could not copy", "danger"); });
          });
          root.querySelector("[data-csv]").addEventListener("click", function () {
            exporter.csvFiles().then(function (files) {
              if (!files.length) return ui.toast("Nothing to export yet", "danger");
              files.forEach(function (f, i) {
                setTimeout(function () { exporter.download("runos-" + f.name, f.text, "text/csv"); }, i * 350);
              });
              ui.toast(files.length + " CSV files downloading");
            });
          });
          LX.on(root, "click", "[data-restore]", function (e, t) {
            var mode = t.dataset.restore;
            var file = root.querySelector("[data-file]").files[0];
            if (!file) return ui.toast("Choose a backup file first", "danger");
            ui.confirm({
              title: mode === "replace" ? "Replace everything?" : "Merge this backup?",
              message: mode === "replace"
                ? "Every record on this device is deleted first, then the file is loaded. This cannot be undone."
                : "Records from the file are added to what is already here.",
              confirmText: mode === "replace" ? "Replace" : "Merge",
              danger: mode === "replace"
            }).then(function (ok) {
              if (!ok) return;
              file.text().then(function (txt) {
                var backup;
                try { backup = JSON.parse(txt); } catch (err) { return ui.toast("That file is not valid JSON", "danger"); }
                exporter.restore(backup, mode).then(function () {
                  close(); ui.toast("Backup restored"); LX.app.refresh();
                }).catch(function (err) { ui.toast(err.message, "danger"); });
              });
            });
          });
          root.querySelector("[data-wipe]").addEventListener("click", function () {
            ui.confirm({
              title: "Delete all local data?",
              message: "Everything on this device goes, including anything not yet synced. Export a backup first if you are unsure.",
              confirmText: "Delete everything", danger: true
            }).then(function (ok) {
              if (!ok) return;
              db.wipeAll().then(function () { return db.setKV("seeded", false); })
                .then(function () { return store.init(); })
                .then(function () { close(); ui.toast("All local data deleted"); LX.app.refresh(); });
            });
          });
        }
      });
    });
  }

  /* ---------------- food values ----------------
     The values imports and the food sheet calculate from. Edit one to match a
     label (whey protein differs from brand to brand). Saved with your settings
     on this device and in backups. Food already logged keeps the values it was
     saved with — changing a food here never rewrites your history. */
  function foodValuesSheet() {
    function per(f) {
      return LX.num(f.kcal, f.kcal % 1 ? 1 : 0) + " kcal · " + LX.num(f.p, 1) + "g protein per " +
        LX.num(f.size, f.size % 1 ? 1 : 0) + " " + f.unit;
    }
    function listHTML() {
      return store.foodList().map(function (f, i) {
        if (f.custom) return "";
        return '<button class="list-row tap" data-food-def="' + i + '">' +
          '<span class="grow"><span class="primary">' + LX.esc(f.name) + "</span><br>" +
          '<span class="secondary">' + LX.esc(per(f)) + "</span></span>" +
          (f.edited ? '<span class="pill-tag">edited</span>' : "") + LX.icon("chevron") + "</button>";
      }).join("");
    }
    ui.sheet({
      title: "Food values",
      body: '<p class="small muted" style="margin:0">Imports and the food sheet work out calories from these. ' +
        "Change one to match a label \u2014 whey protein, for example. Food you already logged keeps the values it was saved with.</p>" +
        '<div class="list card flush" data-food-defs>' + listHTML() + "</div>",
      footer: '<button class="btn btn-block" data-close>Done</button>',
      onMount: function (root) {
        LX.on(root, "click", "[data-food-def]", function (e, t) {
          var f = store.foodList()[Number(t.dataset.foodDef)];
          if (f) foodValueSheet(f, function () { root.querySelector("[data-food-defs]").innerHTML = listHTML(); });
        });
      }
    });
  }

  function foodValueSheet(f, onDone) {
    var extra = Object.keys(f.units || {});
    function box(name, label, value) {
      return ui.field(label, '<input class="input" type="number" inputmode="decimal" min="0" step="any" name="' + name +
        '" value="' + LX.esc(value) + '" />');
    }
    ui.sheet({
      title: f.name,
      body: '<p class="small muted" style="margin:0">Values for the amount below, in ' + LX.esc(f.unit) +
        ". Everything else is scaled from it: " + (f.unit === "piece" && f.size === 1
          ? "7 pieces count as 7 times these values."
          : LX.num(f.size * 2) + " " + LX.esc(f.unit) + " counts as twice these values.") + "</p>" +
        box("size", "Amount (" + f.unit + ")", f.size) +
        '<div class="field-row">' + box("kcal", "Calories", f.kcal) + box("p", "Protein (g)", f.p) + "</div>" +
        '<div class="field-row-3">' + box("c", "Carbs (g)", f.c) + box("f", "Fat (g)", f.f) + box("fib", "Fibre (g)", f.fib) + "</div>" +
        extra.map(function (u) { return box("unit_" + u, "How many " + f.unit + " in one " + u, f.units[u]); }).join(""),
      footer: (f.edited ? '<button class="btn" data-reset>Use built-in</button>' : '<button class="btn" data-close>Cancel</button>') +
        '<button class="btn btn-primary" data-save>Save</button>',
      onMount: function (root, close) {
        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          var bad = ["size", "kcal", "p", "c", "f", "fib"].some(function (k) {
            return v[k] === "" || !isFinite(Number(v[k])) || Number(v[k]) < 0;
          });
          if (bad || !(Number(v.size) > 0)) return ui.toast("Fill in every value with a number", "danger");
          var units = null;
          if (extra.length) {
            units = {};
            extra.forEach(function (u) { units[u] = Number(v["unit_" + u]) > 0 ? Number(v["unit_" + u]) : f.units[u]; });
          }
          store.saveFoodValues(f.name, { size: v.size, kcal: v.kcal, p: v.p, c: v.c, f: v.f, fib: v.fib, units: units })
            .then(function () { close(); ui.toast(f.name + " saved"); if (onDone) onDone(); });
        });
        var reset = root.querySelector("[data-reset]");
        if (reset) reset.addEventListener("click", function () {
          store.resetFoodValues(f.name).then(function () { close(); ui.toast(f.name + " back to built-in values"); if (onDone) onDone(); });
        });
      }
    });
  }

  /* ---------------- goals ---------------- */
  function goalsSheet() {
    var list = LX.DEFAULT_GOALS.map(function (d) {
      var g = store.goals[d.key] || d;
      return { key: d.key, name: d.name, unit: d.unit, target: g.target };
    });
    ui.sheet({
      title: "Goals",
      body: '<p class="small muted" style="margin:0">These are your targets. RunOS never sets them for you and never judges them.</p>' +
        list.map(function (g) {
          return ui.field(g.name + " (" + g.unit + ")",
            '<input class="input" type="number" inputmode="decimal" name="' + g.key + '" value="' + LX.esc(g.target) + '" />');
        }).join(""),
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save goals</button>',
      onMount: function (root, close) {
        root.querySelector("[data-save]").addEventListener("click", function () {
          var v = ui.values(root);
          var chain = Promise.resolve();
          Object.keys(v).forEach(function (k) {
            if (v[k] === "") return;
            chain = chain.then(function () { return store.setGoal(k, Number(v[k])); });
          });
          chain.then(function () { close(); ui.toast("Goals saved"); LX.app.refresh(); });
        });
      }
    });
  }

  /* ---------------- categories ---------------- */
  function categoriesSheet() {
    ui.sheet({
      title: "Time categories",
      body: '<div class="card flush"><div class="list">' + store.categories.map(function (c) {
        return '<div class="list-row"><span class="swatch" style="background:var(' + c.color + ')"></span>' +
          '<span class="grow"><span class="primary">' + LX.esc(c.name) + "</span><br>" +
          '<span class="secondary">counts as ' + LX.BUCKETS[c.bucket].name.toLowerCase() + "</span></span>" +
          (c.is_custom ? '<button class="icon-btn" data-del-cat="' + c.id + '" aria-label="Delete">' + LX.icon("trash") + "</button>" : "") +
          "</div>";
      }).join("") + "</div></div>" +
        '<div class="section-title" style="font-size:1rem">Add your own</div>' +
        ui.field("Name", ui.input("name", { placeholder: "Temple, driving, admin…" })) +
        ui.field("Counts as", ui.select("bucket",
          Object.keys(LX.BUCKETS).filter(function (b) { return b !== "untracked"; })
            .map(function (b) { return { value: b, label: LX.BUCKETS[b].name }; }), "personal")),
      footer: '<button class="btn" data-close>Close</button><button class="btn btn-primary" data-add>Add category</button>',
      onMount: function (root, close) {
        root.querySelector("[data-add]").addEventListener("click", function () {
          var v = ui.values(root);
          if (!v.name) return ui.toast("Give it a name", "danger");
          store.addCategory(v.name, v.bucket, LX.BUCKETS[v.bucket].color).then(function () {
            close(); ui.toast("Category added"); LX.app.refresh();
          });
        });
        LX.on(root, "click", "[data-del-cat]", function (e, t) {
          db.remove("categories", t.dataset.delCat).then(function () {
            store.categories = store.categories.filter(function (c) { return c.id !== t.dataset.delCat; });
            close(); ui.toast("Category removed"); LX.app.refresh();
          });
        });
      }
    });
  }

  /* ---------------- appearance ---------------- */
  function appearanceSheet() {
    ui.sheet({
      title: "Appearance",
      body: '<div class="section-title" style="font-size:1rem;margin:0">Mode</div>' +
        '<div class="segmented" data-theme-seg>' +
        [["system", "Auto"], ["light", "Light"], ["dark", "Dark"], ["black", "Black"]].map(function (t) {
          return '<button data-theme="' + t[0] + '" aria-pressed="' + (store.settings.theme === t[0]) + '">' + t[1] + "</button>";
        }).join("") + "</div>" +
        '<p class="hint">Auto follows your phone\u2019s light and dark setting. Black is dark mode on pure black, easiest on an iPhone screen at night.</p>' +
        '<div class="section-title" style="font-size:1rem;margin:0">Colour theme</div>' +
        '<div class="theme-swatches">' + LX.THEMES.map(function (t) {
          return '<button data-accent="' + t.key + '" aria-pressed="' + ((store.settings.accent || "teal") === t.key) + '">' +
            '<span class="dot" style="background:linear-gradient(135deg,' + t.preview[0] + "," + t.preview[1] + ')"></span>' +
            '<span class="mini-pal">' + t.preview.slice(2).map(function (c) {
              return '<i style="background:' + c + '"></i>';
            }).join("") + "</span>" + t.name + "</button>";
        }).join("") + "</div>" +
        '<div class="section-title" style="font-size:1rem;margin:0">Colour strength</div>' +
        '<div class="segmented">' + [["vivid", "Vivid"], ["soft", "Soft"]].map(function (t) {
          var on = (store.settings.vivid !== false) === (t[0] === "vivid");
          return '<button data-vivid="' + t[0] + '" aria-pressed="' + on + '">' + t[1] + "</button>";
        }).join("") + "</div>" +
        '<p class="hint">A theme recolours everything: bars, charts, the day ribbon, buttons and tabs. Vivid shows those colours at full strength; Soft mutes them.</p>' +
        ui.field("Weight unit", ui.select("weight", ["kg", "lb"], store.settings.units.weight)) +
        ui.field("Measurement unit", ui.select("length", ["cm", "in"], store.settings.units.length)),
      footer: '<button class="btn btn-block" data-close>Done</button>',
      onMount: function (root) {
        LX.on(root, "click", "[data-theme]", function (e, t) {
          LX.$$("[data-theme]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
          store.saveSettings({ theme: t.dataset.theme }).then(function () { LX.app.applyTheme(); LX.app.refresh(); });
        });
        LX.on(root, "click", "[data-accent]", function (e, t) {
          LX.$$("[data-accent]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
          store.saveSettings({ accent: t.dataset.accent }).then(function () { LX.app.applyTheme(); LX.app.refresh(); });
        });
        LX.on(root, "click", "[data-vivid]", function (e, t) {
          LX.$$("[data-vivid]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
          store.saveSettings({ vivid: t.dataset.vivid === "vivid" }).then(function () { LX.app.applyTheme(); LX.app.refresh(); });
        });
        LX.on(root, "change", "select", function () {
          var v = ui.values(root);
          store.saveSettings({ units: { weight: v.weight, length: v.length } });
        });
      }
    });
  }

  /* ---------------- Home screen layout ---------------- */
  function homeCardsSheet() {
    var cards = LX.screens.home.cardOrder();
    function render(root) {
      root.querySelector("[data-cards]").innerHTML = cards.map(function (c, i) {
        var def = LX.HOME_CARDS.find(function (d) { return d.key === c.key; });
        return '<div class="list-row">' +
          '<button class="task-check' + (c.on ? " is-on" : "") + '" data-card-toggle="' + i + '" aria-label="Show or hide">' +
          LX.icon("check") + "</button>" +
          '<span class="grow"><span class="primary">' + LX.esc(def.name) + '</span><br><span class="secondary">' +
          LX.esc(def.hint) + "</span></span>" +
          '<button class="icon-btn" data-card-up="' + i + '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + ">" + LX.icon("up") + "</button>" +
          '<button class="icon-btn" data-card-down="' + i + '" aria-label="Move down"' + (i === cards.length - 1 ? " disabled" : "") + ">" + LX.icon("down") + "</button></div>";
      }).join("");
    }
    function save() {
      return store.saveSettings({ home_cards: cards.map(function (c) { return { key: c.key, on: c.on }; }) });
    }
    ui.sheet({
      title: "Home screen",
      body: '<p class="small muted" style="margin:0">Tick what Home shows and move things into the order you want.</p>' +
        '<div class="card flush"><div class="list" data-cards></div></div>',
      footer: '<button class="btn" data-cards-reset>Reset</button><button class="btn btn-primary" data-close>Done</button>',
      onMount: function (root) {
        render(root);
        LX.on(root, "click", "[data-card-toggle]", function (e, t) {
          var c = cards[Number(t.dataset.cardToggle)]; c.on = !c.on; save(); render(root);
        });
        LX.on(root, "click", "[data-card-up]", function (e, t) {
          var i = Number(t.dataset.cardUp); if (i < 1) return;
          cards.splice(i - 1, 0, cards.splice(i, 1)[0]); save(); render(root);
        });
        LX.on(root, "click", "[data-card-down]", function (e, t) {
          var i = Number(t.dataset.cardDown); if (i >= cards.length - 1) return;
          cards.splice(i + 1, 0, cards.splice(i, 1)[0]); save(); render(root);
        });
        root.querySelector("[data-cards-reset]").addEventListener("click", function () {
          cards = LX.HOME_CARDS.map(function (d) { return { key: d.key, on: true }; });
          store.saveSettings({ home_cards: null }); render(root);
        });
      },
      onClose: function () { LX.app.refresh(); }
    });
  }

  /* ---------------- reference ---------------- */
  function schemaSheet() {
    ui.sheet({
      title: "JSON schema",
      body: '<p class="small muted" style="margin:0">Ask any assistant to convert your day into this shape, then paste it into Import JSON. ' +
        "Every top-level section is optional — food alone is a valid import.</p>" +
        '<pre class="code">' + LX.esc(JSON.stringify(LX.importer.SAMPLE, null, 2)) + "</pre>" +
        '<div class="card" style="padding:14px">' +
        rowKV("date", "YYYY-MM-DD. Defaults to today if left out.") +
        rowKV("sleep", "duration_minutes, or bedtime and wake_time. quality 1–5 optional.") +
        rowKV("activities[]", "category, duration_minutes, optional title, start_time, notes.") +
        rowKV("workout", "type, duration_minutes, exercises[] with name and sets[] of weight_kg and reps.") +
        rowKV("food[]", "name, quantity, unit, meal, and optionally calories, protein, carbs, fat, fiber. " +
          "Values you give are kept as given. Anything left out is calculated from Settings → Food values when the food is " +
          "known (Egg, Rice, Milk, Curd…) and its unit fits — pieces, g or ml. A food that can't be worked out is saved as " +
          "Nutrition missing, never 0 kcal.") +
        rowKV("weight", "a number, or {value, unit, note}.") +
        rowKV("measurements", '{"Chest": 100} or [{name, value, unit}].') +
        rowKV("review", "planned, completed, journal.") +
        "</div>" +
        '<p class="hint">Send several days at once by wrapping them in an array, or in {"days": [ … ]}.</p>',
      footer: '<button class="btn" data-copy-schema>Copy sample</button><button class="btn btn-primary" data-close>Close</button>',
      onMount: function (root) {
        root.querySelector("[data-copy-schema]").addEventListener("click", function () {
          exporter.copy(JSON.stringify(LX.importer.SAMPLE, null, 2)).then(function () { ui.toast("Sample copied"); });
        });
      }
    });
  }
  function rowKV(k, v) {
    return '<div class="kv" style="display:block"><b>' + LX.esc(k) + '</b><div class="muted" style="margin-top:2px">' +
      LX.esc(v) + "</div></div>";
  }

  function aboutSheet() {
    var est = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(function () { return null; }) : Promise.resolve(null);
    var kept = navigator.storage && navigator.storage.persisted ? navigator.storage.persisted().catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([db.getKV("last_sync", null), db.outboxCount(), exporter.daysSinceBackup(), est, kept, exporter.counts()]).then(function (r) {
      var total = Object.keys(r[5]).reduce(function (a, k) { return a + r[5][k]; }, 0);
      var used = r[3] && r[3].usage ? (r[3].usage / 1048576).toFixed(1) + " MB used" : "unknown";
      ui.sheet({
        title: "About RunOS",
        body: '<div class="card" style="padding:14px">' +
          rowKV("Version", LX.VERSION || "1.0") +
          rowKV("Storage", db.storageMode() === "browser-storage"
            ? "Browser storage (the app database is blocked here — opening the file directly does this; the hosted link works normally)"
            : "IndexedDB on this device") +
          rowKV("Cloud", cloud.configured() ? "Supabase configured" : "Not configured — local only") +
          rowKV("Last sync", r[0] ? new Date(r[0]).toLocaleString() : "never") +
          rowKV("Waiting to sync", r[1] + " changes") +
          rowKV("Last backup", r[2] === null ? "never — share one from Data & backup" : r[2] === 0 ? "today" : r[2] + " days ago") +
          rowKV("Kept permanently", r[4] === true ? "yes — the browser will not clear it" : r[4] === false ? "not confirmed by this browser" : "unknown here") +
          rowKV("Space used", used) +
          rowKV("Records", LX.num(total)) +
          "</div>" +
          '<p class="small muted">If something ever looks wrong, this screen tells you which part: sync (last sync and waiting changes), ' +
          "backups (last backup) or the device (storage).</p>" +
          '<p class="small muted">Your data belongs to you. A full JSON backup contains every record and can rebuild the app anywhere.</p>',
        footer: '<button class="btn btn-block" data-close>Close</button>'
      });
    });
  }
})(window.LX);
