/* LifeOS — More. Account, import, backup, goals, categories, appearance. */
(function (LX) {
  "use strict";
  var ui = LX.ui, db = LX.db, store = LX.store, cloud = LX.cloud, exporter = LX.exporter;
  LX.screens = LX.screens || {};

  LX.screens.more = {
    title: function () { return "More"; },
    subtitle: function () { return cloud.statusText(); },
    render: function (el) {
      return exporter.counts().then(function (counts) {
        var total = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);
        var user = cloud.user();

        el.innerHTML =
          accountCard(user) +
          group("Your data", [
            row("import", "upload", "Import JSON", "Paste a day from your notes or ChatGPT"),
            row("backup", "download", "Data & backup", total + " records stored on this device"),
            row("review", "book", "Daily review", "Write or edit today's reflection")
          ]) +
          group("Setup", [
            row("goals", "target", "Goals", "Your own targets, not automatic ones"),
            row("categories", "clock", "Time categories", store.categories.length + " categories"),
            row("appearance", "sun", "Appearance", themeLabel())
          ]) +
          group("Reference", [
            row("schema", "book", "JSON schema", "The exact shape LifeOS accepts"),
            row("about", "user", "About LifeOS", "Version and storage details")
          ]) +
          '<p class="hint" style="text-align:center">LifeOS keeps your data on this device first. Nothing leaves it unless you connect an account.</p>';

        LX.on(el, "click", "[data-more]", function (e, t) { open(t.dataset.more); });
      });
    }
  };

  function themeLabel() {
    var t = store.settings.theme;
    return t === "system" ? "Following your phone" : (t === "dark" ? "Dark" : "Light");
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
      goals: goalsSheet, categories: categoriesSheet, appearance: appearanceSheet,
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
        '<p class="small muted" style="margin:0">Paste a day in the LifeOS format. Nothing is saved until you see the preview and tap Import.</p>' +
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
            '<span style="color:var(--ok)">' + LX.icon("check") + "</span>" +
            '<span class="grow"><span class="primary">' + LX.esc(i.kind) + "</span></span>" +
            '<span class="secondary">' + LX.esc(i.text) + "</span></div>";
        }).join("") + "</div></div>";
    }
    return html;
  }

  /* ---------------- backup ---------------- */
  function backupSheet() {
    exporter.counts().then(function (counts) {
      ui.sheet({
        title: "Data & backup",
        body:
          '<div class="card" style="padding:14px">' + Object.keys(counts).filter(function (k) { return counts[k]; })
            .map(function (k) {
              return '<div class="kv"><span class="muted">' + k.replace(/_/g, " ") + "</span><b>" + counts[k] + "</b></div>";
            }).join("") + "</div>" +
          '<button class="btn btn-primary btn-block" data-full>' + LX.icon("download") + " Download full backup (JSON)</button>" +
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
          root.querySelector("[data-full]").addEventListener("click", function () {
            exporter.buildBackup().then(function (b) {
              var name = "lifeos-backup-" + LX.D.today() + ".json";
              var ok = exporter.download(name, JSON.stringify(b, null, 2));
              ui.toast(ok ? "Backup downloaded" : "Download blocked here — use copy instead", ok ? "" : "danger");
            });
          });
          root.querySelector("[data-copy]").addEventListener("click", function () {
            exporter.buildBackup().then(function (b) {
              return exporter.copy(JSON.stringify(b));
            }).then(function () { ui.toast("Backup copied — paste it somewhere safe"); })
              .catch(function () { ui.toast("Could not copy", "danger"); });
          });
          root.querySelector("[data-csv]").addEventListener("click", function () {
            exporter.csvFiles().then(function (files) {
              if (!files.length) return ui.toast("Nothing to export yet", "danger");
              files.forEach(function (f, i) {
                setTimeout(function () { exporter.download("lifeos-" + f.name, f.text, "text/csv"); }, i * 350);
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

  /* ---------------- goals ---------------- */
  function goalsSheet() {
    var list = LX.DEFAULT_GOALS.map(function (d) {
      var g = store.goals[d.key] || d;
      return { key: d.key, name: d.name, unit: d.unit, target: g.target };
    });
    ui.sheet({
      title: "Goals",
      body: '<p class="small muted" style="margin:0">These are your targets. LifeOS never sets them for you and never judges them.</p>' +
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
      body: '<div class="segmented" data-theme-seg>' +
        [["system", "Automatic"], ["light", "Light"], ["dark", "Dark"]].map(function (t) {
          return '<button data-theme="' + t[0] + '" aria-pressed="' + (store.settings.theme === t[0]) + '">' + t[1] + "</button>";
        }).join("") + "</div>" +
        '<p class="hint">Automatic follows your phone\u2019s light and dark setting.</p>' +
        ui.field("Weight unit", ui.select("weight", ["kg", "lb"], store.settings.units.weight)) +
        ui.field("Measurement unit", ui.select("length", ["cm", "in"], store.settings.units.length)),
      footer: '<button class="btn btn-block" data-close>Done</button>',
      onMount: function (root) {
        LX.on(root, "click", "[data-theme]", function (e, t) {
          LX.$$("[data-theme]", root).forEach(function (b) { b.setAttribute("aria-pressed", b === t); });
          store.saveSettings({ theme: t.dataset.theme }).then(function () { LX.app.applyTheme(); LX.app.refresh(); });
        });
        LX.on(root, "change", "select", function () {
          var v = ui.values(root);
          store.saveSettings({ units: { weight: v.weight, length: v.length } });
        });
      }
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
        rowKV("food[]", "name, quantity, unit, meal, and macros. Known foods fill their own macros.") +
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
    Promise.all([db.getKV("last_sync", null), db.outboxCount()]).then(function (r) {
      ui.sheet({
        title: "About LifeOS",
        body: '<div class="card" style="padding:14px">' +
          rowKV("Version", LX.VERSION || "1.0") +
          rowKV("Storage", db.storageMode() === "browser-storage"
            ? "Browser storage (the app database is blocked here — opening the file directly does this; the hosted link works normally)"
            : "IndexedDB on this device") +
          rowKV("Cloud", cloud.configured() ? "Supabase configured" : "Not configured — local only") +
          rowKV("Last sync", r[0] ? new Date(r[0]).toLocaleString() : "never") +
          rowKV("Waiting to sync", r[1] + " changes") +
          "</div>" +
          '<p class="small muted">Your data belongs to you. A full JSON backup contains every record and can rebuild the app anywhere.</p>',
        footer: '<button class="btn btn-block" data-close>Close</button>'
      });
    });
  }
})(window.LX);
