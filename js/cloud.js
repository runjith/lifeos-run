/* LifeOS — cloud sync.
   Talks to Supabase over plain HTTPS (PostgREST + GoTrue), so there is no SDK to
   load and the app still works with the network switched off.

   How conflicts are settled: every row carries updated_at, set on the device that
   changed it. On pull, a remote row only overwrites a local row if the remote
   updated_at is newer. A local row that is still waiting in the outbox always wins
   locally and is pushed afterwards. Deletes are soft (deleted_at), so a delete on
   one device syncs like any other edit instead of quietly resurrecting rows. */
(function (LX) {
  "use strict";
  var db = LX.db;
  var cloud = { state: "local", lastError: null };
  var SESSION_KEY = "lx_session";
  var syncing = false;

  function cfg() { return LX.CONFIG || {}; }
  cloud.configured = function () { return !!(cfg().SUPABASE_URL && cfg().SUPABASE_ANON_KEY); };

  cloud.session = function () {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  };
  function setSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
    emit();
  }
  cloud.user = function () {
    var s = cloud.session();
    return s && s.user ? s.user : null;
  };

  function emit() {
    document.dispatchEvent(new CustomEvent("lx:sync-state", { detail: { state: cloud.state } }));
  }
  function setState(s) { cloud.state = s; emit(); }

  function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({
      apikey: cfg().SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    }, opts.headers || {});
    var s = cloud.session();
    if (s && s.access_token && !opts.noAuth) headers.Authorization = "Bearer " + s.access_token;
    return fetch(cfg().SUPABASE_URL.replace(/\/$/, "") + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (t) {
        var json = null;
        try { json = t ? JSON.parse(t) : null; } catch (e) { json = null; }
        if (!res.ok) {
          var msg = (json && (json.error_description || json.message || json.msg || json.error)) || ("Request failed (" + res.status + ")");
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  /* ---------- auth ---------- */
  cloud.signUp = function (email, password) {
    return api("/auth/v1/signup", { method: "POST", noAuth: true, body: { email: email, password: password } })
      .then(function (r) {
        if (r && r.access_token) {
          setSession(r);
          return db.setKV("cloud_user", { email: email, id: r.user && r.user.id })
            .then(function () { return { signedIn: true }; });
        }
        return { signedIn: false, needsConfirmation: true };
      });
  };
  /* Signing in tells you whether this device already holds another account's
     data, so the UI can ask before the two are merged. Nothing syncs until the
     question is answered. */
  cloud.signIn = function (email, password) {
    return api("/auth/v1/token?grant_type=password", {
      method: "POST", noAuth: true, body: { email: email, password: password }
    }).then(function (r) {
      var newId = r.user && r.user.id;
      return Promise.all([db.getKV("cloud_user", null), localRecordCount()]).then(function (x) {
        var previous = x[0], localRows = x[1];
        var changed = !!(previous && previous.id && newId && previous.id !== newId && localRows > 0);
        cloud.pendingConfirm = changed;
        setSession(r);
        return db.setKV("cloud_user", { email: email, id: newId }).then(function () {
          return { accountChanged: changed, previousEmail: previous && previous.email, localRows: localRows };
        });
      });
    });
  };

  /** Called by the UI once the person has agreed to merge into another account. */
  cloud.confirmAccount = function () { cloud.pendingConfirm = false; };

  function localRecordCount() {
    return Promise.all(LX.STORES.map(function (s) { return db.all(s); })).then(function (all) {
      // seeded lists do not count as "your data"
      var seeded = ["categories", "exercises", "strength_tests", "weekly_goals"];
      return all.reduce(function (n, rows, i) {
        return n + (seeded.indexOf(LX.STORES[i]) >= 0 ? 0 : rows.length);
      }, 0);
    });
  }
  cloud.signOut = function () {
    var s = cloud.session();
    cloud.pendingConfirm = false;
    setSession(null);
    setState(cloud.configured() ? "signed-out" : "local");
    if (!s) return Promise.resolve();
    return api("/auth/v1/logout", { method: "POST", headers: { Authorization: "Bearer " + s.access_token } })
      .catch(function () {});
  };
  function refreshSession() {
    var s = cloud.session();
    if (!s || !s.refresh_token) return Promise.reject(new Error("Not signed in"));
    return api("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", noAuth: true, body: { refresh_token: s.refresh_token }
    }).then(function (r) { setSession(r); return r; });
  }

  /* ---------- sync ---------- */
  function withAuth(fn) {
    return fn().catch(function (e) {
      if (e.status === 401) return refreshSession().then(fn);
      throw e;
    });
  }

  function cleanForCloud(rec, userId) {
    var out = {};
    Object.keys(rec).forEach(function (k) {
      if (k === "_dirty") return;
      out[k] = rec[k];
    });
    out.user_id = userId;
    return out;
  }

  /* Lists that every device seeds for itself. Two devices would otherwise each
     invent their own "Work" category and their own "Bench Press", and the
     account would end up holding both. On the first sync for an account, the
     cloud's copy wins: local references are pointed at it and the device's own
     seeded row is removed before anything is pushed. */
  var CATALOG = {
    categories:     function (r) { return String(r.slug || r.name || "").toLowerCase(); },
    exercises:      function (r) { return String(r.name || "").toLowerCase(); },
    strength_tests: function (r) { return String(r.slug || r.name || "").toLowerCase(); },
    weekly_goals:   function (r) { return String(r.slug || r.name || "").toLowerCase(); }
  };
  var REFERENCES = {
    categories:     [["activities", "category_id"]],
    exercises:      [["workout_exercises", "exercise_id"], ["workout_sets", "exercise_id"]],
    strength_tests: [["strength_results", "test_id"]],
    weekly_goals:   [["weekly_goal_logs", "goal_id"]]
  };

  function repoint(table, oldId, newId) {
    var chain = Promise.resolve();
    (REFERENCES[table] || []).forEach(function (ref) {
      chain = chain.then(function () {
        return db.all(ref[0]).then(function (rows) {
          return rows.filter(function (r) { return r[ref[1]] === oldId; })
            .reduce(function (p, r) {
              r[ref[1]] = newId;
              return p.then(function () { return db.put(ref[0], r); });
            }, Promise.resolve());
        });
      });
    });
    if (table === "exercises") {
      chain = chain.then(function () {
        var lifts = (LX.store.settings.key_lifts || []).slice();
        var i = lifts.indexOf(oldId);
        if (i < 0) return;
        lifts[i] = newId;
        return LX.store.saveSettings({ key_lifts: lifts });
      });
    }
    if (table === "categories") {
      try {
        var t = JSON.parse(localStorage.getItem("lx_timer") || "null");
        if (t && t.category_id === oldId) {
          t.category_id = newId;
          localStorage.setItem("lx_timer", JSON.stringify(t));
        }
      } catch (e) {}
    }
    return chain;
  }

  /** Runs once per account per device, before the first push. */
  function reconcile(userId) {
    return db.getKV("reconciled:" + userId, false).then(function (done) {
      if (done) return { adopted: 0, added: 0, skipped: true };
      var report = { adopted: 0, added: 0 };
      var chain = Promise.resolve();
      Object.keys(CATALOG).forEach(function (table) {
        chain = chain.then(function () {
          return withAuth(function () {
            return api("/rest/v1/" + table + "?select=*&limit=1000");
          }).then(function (remote) {
            if (!remote || !remote.length) return;
            return db.allIncludingDeleted(table).then(function (local) {
              var byKey = {};
              local.forEach(function (r) { if (!r.deleted_at) byKey[CATALOG[table](r)] = r; });
              return remote.reduce(function (p, rr) {
                if (rr.deleted_at) return p;
                var mine = byKey[CATALOG[table](rr)];
                return p.then(function () {
                  if (!mine) { report.added++; return db.put(table, rr, { fromCloud: true }); }
                  if (mine.id === rr.id) return db.put(table, rr, { fromCloud: true });
                  report.adopted++;
                  return repoint(table, mine.id, rr.id)
                    .then(function () { return db.destroy(table, mine.id); })
                    .then(function () { return db.put(table, rr, { fromCloud: true }); });
                });
              }, Promise.resolve());
            });
          });
        });
      });
      return chain
        .then(function () { return db.setKV("reconciled:" + userId, true); })
        .then(function () { return report; });
    });
  }

  cloud.sync = function (opts) {
    opts = opts || {};
    if (!cloud.configured()) { setState("local"); return Promise.resolve({ skipped: "not configured" }); }
    if (!cloud.session()) { setState("signed-out"); return Promise.resolve({ skipped: "signed out" }); }
    if (!navigator.onLine) { setState("offline"); return Promise.resolve({ skipped: "offline" }); }
    if (syncing) return Promise.resolve({ skipped: "already running" });
    if (cloud.pendingConfirm) return Promise.resolve({ skipped: "waiting for you to confirm the account" });

    syncing = true;
    setState("syncing");
    var userId = (cloud.user() || {}).id;
    var pushed = 0, pulled = 0, adopted = 0;

    return reconcile(userId).then(function (r) {
      adopted = (r && r.adopted) || 0;
      pulled += (r && r.added) || 0;
    }).then(push).then(pull).then(function () {
      syncing = false;
      cloud.lastError = null;
      setState("synced");
      return db.setKV("last_sync", LX.now()).then(function () {
        // pulled rows are in the database but not yet in the in-memory lists
        if (!pulled && !adopted) return { pushed: pushed, pulled: pulled, adopted: adopted };
        return LX.store.init().then(function () {
          return { pushed: pushed, pulled: pulled, adopted: adopted };
        });
      });
    }).catch(function (e) {
      syncing = false;
      cloud.lastError = e.message;
      setState(navigator.onLine ? "error" : "offline");
      if (!opts.quiet) LX.ui.toast("Sync failed: " + e.message, "danger");
      throw e;
    });

    function push() {
      return db.outbox().then(function (queue) {
        if (!queue.length) return;
        // one batch per table, newest state of each row
        var byStore = {};
        queue.forEach(function (q) { (byStore[q.store] = byStore[q.store] || {})[q.id] = q; });
        var chain = Promise.resolve();
        // parents before children, so a foreign key never arrives before its target
        Object.keys(byStore).sort(function (a, b) {
          return LX.STORES.indexOf(a) - LX.STORES.indexOf(b);
        }).forEach(function (storeName) {
          chain = chain.then(function () {
            var ids = Object.keys(byStore[storeName]);
            return Promise.all(ids.map(function (id) { return db.get(storeName, id); })).then(function (rows) {
              var payload = rows.filter(Boolean).map(function (r) { return cleanForCloud(r, userId); });
              if (!payload.length) return;
              return withAuth(function () {
                return api("/rest/v1/" + storeName, {
                  method: "POST",
                  headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
                  body: payload
                });
              }).then(function () {
                pushed += payload.length;
                var c = Promise.resolve();
                ids.forEach(function (id) {
                  c = c.then(function () { return db.markClean(storeName, id); })
                       .then(function () { return db.dequeue(byStore[storeName][id].seq); });
                });
                return c;
              });
            });
          });
        });
        return chain;
      });
    }

    function pull() {
      return db.getKV("last_pull:" + userId, "1970-01-01T00:00:00Z").then(function (since) {
        var chain = Promise.resolve();
        var newest = since;
        LX.STORES.forEach(function (storeName) {
          chain = chain.then(function () {
            return withAuth(function () {
              return api("/rest/v1/" + storeName + "?updated_at=gt." + encodeURIComponent(since) +
                "&order=updated_at.asc&limit=1000");
            }).then(function (rows) {
              if (!rows || !rows.length) return;
              var c = Promise.resolve();
              rows.forEach(function (remote) {
                c = c.then(function () {
                  return db.get(storeName, remote.id).then(function (local) {
                    if (local && local._dirty) return;                       // local edit wins, it is queued
                    if (local && local.updated_at >= remote.updated_at) return; // ours is newer
                    pulled++;
                    if (remote.updated_at > newest) newest = remote.updated_at;
                    return db.put(storeName, remote, { fromCloud: true });
                  });
                });
              });
              return c;
            });
          });
        });
        return chain.then(function () { return db.setKV("last_pull:" + userId, newest); });
      });
    }
  };

  cloud.init = function () {
    if (!cloud.configured()) { setState("local"); return; }
    setState(cloud.session() ? (navigator.onLine ? "synced" : "offline") : "signed-out");
    window.addEventListener("online", function () { cloud.sync({ quiet: true }).then(LX.app.refresh).catch(function () {}); });
    window.addEventListener("offline", function () { setState("offline"); });
    document.addEventListener("lx:data-changed", debounce(function () {
      cloud.sync({ quiet: true }).catch(function () {});
    }, 2500));
    if (cloud.session()) cloud.sync({ quiet: true }).then(function () { LX.app.refresh(); }).catch(function () {});
    setInterval(function () { if (cloud.session()) cloud.sync({ quiet: true }).catch(function () {}); }, 5 * 60 * 1000);
  };

  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  cloud.statusText = function () {
    var map = {
      local: "On this device", "signed-out": "Not signed in", syncing: "Syncing",
      synced: "Synced", offline: "Offline", error: "Sync error"
    };
    return map[cloud.state] || cloud.state;
  };
  cloud.pillState = function () {
    if (cloud.state === "synced") return "synced";
    if (cloud.state === "syncing") return "syncing";
    if (cloud.state === "offline") return "offline";
    if (cloud.state === "error") return "error";
    return "local";
  };

  LX.cloud = cloud;
})(window.LX);
