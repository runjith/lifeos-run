/* LifeOS — local database (IndexedDB).
   Every screen reads and writes here first. Cloud sync is a separate layer that
   drains the "outbox" store; the app is fully usable if that layer never runs. */
(function (LX) {
  "use strict";

  var DB_NAME = "lifeos";
  /* Bump this whenever a store is added. Installs opened on an older version are
     upgraded in place — nothing already saved is touched. */
  var DB_VERSION = 3;

  /** store name -> extra indexes */
  var STORES = {
    categories:        ["updated_at"],
    activities:        ["date", "updated_at"],
    exercises:         ["updated_at"],
    workouts:          ["date", "updated_at"],
    workout_exercises: ["workout_id", "updated_at"],
    workout_sets:      ["workout_exercise_id", "updated_at"],
    food_entries:      ["date", "updated_at"],
    sleep_records:     ["date", "updated_at"],
    weight_records:    ["date", "updated_at"],
    body_measurements: ["date", "updated_at"],
    goals:             ["updated_at"],
    daily_reviews:     ["date", "updated_at"],
    profiles:          ["updated_at"],
    strength_tests:    ["updated_at"],
    strength_results:  ["test_id", "date", "updated_at"],
    weekly_goals:      ["updated_at"],
    weekly_goal_logs:  ["goal_id", "week_start", "date", "updated_at"]
  };
  LX.STORES = Object.keys(STORES);

  var dbp = null;
  var memory = null;          // fallback when IndexedDB is unavailable
  var db_fallbackActive = false;

  function expectedStores() {
    return Object.keys(STORES).concat(["outbox", "kv"]);
  }
  /** Which field each store keys its rows by. */
  function expectedKeyPath(name) {
    if (name === "outbox") return "seq";
    if (name === "kv") return "key";
    return "id";
  }

  /* Creates anything missing and repairs anything malformed. A store left over
     from an interrupted upgrade can exist without a key field ("out-of-line
     keys"), and every write to it then fails — which is what used to stop the
     app from starting. Such a store is dropped and rebuilt here. */
  function createMissing(db, transaction) {
    expectedStores().forEach(function (name) {
      var keyPath = expectedKeyPath(name);
      if (db.objectStoreNames.contains(name)) {
        var existing = null;
        try { existing = transaction ? transaction.objectStore(name) : null; } catch (e) {}
        if (existing && String(existing.keyPath || "") === keyPath) return;   // already fine
        if (existing === null) return;                                        // cannot inspect; leave it
        console.warn("LifeOS: rebuilding the '" + name + "' store — it was created incorrectly.");
        db.deleteObjectStore(name);
      }
      var os = name === "outbox"
        ? db.createObjectStore(name, { keyPath: "seq", autoIncrement: true })
        : db.createObjectStore(name, { keyPath: keyPath });
      (STORES[name] || []).forEach(function (ix) { os.createIndex(ix, ix, { unique: false }); });
    });
  }

  /** True when every expected store exists and keys its rows the way we expect. */
  function schemaLooksRight(db) {
    return expectedStores().every(function (name) {
      if (!db.objectStoreNames.contains(name)) return false;
      try {
        return String(db.transaction(name, "readonly").objectStore(name).keyPath || "") === expectedKeyPath(name);
      } catch (e) {
        return false;
      }
    });
  }

  function openAt(version) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME); }
      catch (e) { return resolve(useMemory()); }
      req.onupgradeneeded = function (e) { createMissing(e.target.result, e.target.transaction); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB refused to open")); };
      req.onblocked = function () { reject(new Error("Another tab is holding the database open")); };
    });
  }

  /* Opening a file:// page in Chrome leaves IndexedDB requests hanging forever —
     no success, no error — which used to freeze the app on its splash screen.
     Waiting a moment and then falling back keeps it usable from a saved file. */
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error("The browser did not answer the storage request"));
      }, ms);
      promise.then(function (v) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (done) return;
        done = true; clearTimeout(timer); reject(e);
      });
    });
  }

  function openDB() {
    if (dbp) return dbp;
    dbp = withTimeout(openAt(DB_VERSION), 1500).then(function (db) {
      if (db.__memory) return db;
      // Safety net: a database can be left with a store missing, or with one that
      // was created incorrectly by an interrupted upgrade. Reopen one version
      // higher so the upgrade step can build or rebuild it, rather than letting
      // every write fail.
      if (schemaLooksRight(db)) return db;
      var next = db.version + 1;
      db.close();
      return openAt(next).then(function (fixed) {
        if (fixed.__memory || schemaLooksRight(fixed)) return fixed;
        throw new Error("The local database could not be repaired");
      });
    }).catch(function (e) {
      console.warn("LifeOS: falling back to memory storage —", e && e.message);
      return useMemory();
    });
    return dbp;
  }

  /* Fallback storage. It mirrors itself into localStorage, so a browser that
     blocks IndexedDB (a file:// page, Safari private browsing) still keeps your
     data between reloads instead of losing it when the tab closes. */
  var LS_KEY = "lifeos_fallback";
  var saveTimer = null;
  db_fallbackActive = false;

  function persistMemory() {
    if (!memory) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(memory.data)); }
      catch (e) { console.warn("LifeOS: could not save the fallback copy —", e.message); }
    }, 250);
  }

  function useMemory() {
    if (!memory) {
      memory = { __memory: true, data: {} };
      Object.keys(STORES).concat(["outbox", "kv"]).forEach(function (s) { memory.data[s] = []; });
      try {
        var saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
        if (saved) Object.keys(memory.data).forEach(function (k) {
          if (Array.isArray(saved[k])) memory.data[k] = saved[k];
        });
      } catch (e) {}
      db_fallbackActive = true;
      console.warn("LifeOS: IndexedDB is unavailable here — saving to browser storage instead.");
    }
    return memory;
  }

  function tx(store, mode, fn) {
    return rawTx(store, mode, fn).catch(function (e) {
      // Whatever went wrong with the browser's database, losing the app is worse
      // than losing its speed: switch to browser storage and carry on.
      if (memory && memory.__memory) throw e;
      console.warn("LifeOS: the app database failed (" + (e && e.message) +
        ") — switching to browser storage.");
      useMemory();
      dbp = Promise.resolve(memory);
      return rawTx(store, mode, fn);
    });
  }

  function rawTx(store, mode, fn) {
    return openDB().then(function (db) {
      if (db.__memory) return fn(memoryStore(db, store));
      if (!db.objectStoreNames.contains(store)) {
        console.warn("LifeOS: store '" + store + "' is missing; treating it as empty.");
        return fn(memoryStore(useMemory(), store));
      }
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var res = fn(t.objectStore(store));
        t.oncomplete = function () { resolve(res && res.value !== undefined ? res.value : res); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  /* Minimal in-memory shim with the same surface we use below. */
  function memoryStore(db, name) {
    var arr = db.data[name];
    return {
      __mem: true,
      put: function (rec) {
        if (name === "outbox" && rec.seq === undefined) rec.seq = Date.now() + Math.random();
        var key = name === "outbox" ? "seq" : (name === "kv" ? "key" : "id");
        var i = arr.findIndex(function (r) { return r[key] === rec[key]; });
        if (i >= 0) arr[i] = rec; else arr.push(rec);
        persistMemory();
        return { value: rec, _mem: true };
      },
      get: function (k) {
        var key = name === "outbox" ? "seq" : (name === "kv" ? "key" : "id");
        return { value: arr.find(function (r) { return r[key] === k; }) || null, _mem: true };
      },
      getAll: function () { return { value: arr.slice(), _mem: true }; },
      delete: function (k) {
        var key = name === "outbox" ? "seq" : (name === "kv" ? "key" : "id");
        var i = arr.findIndex(function (r) { return r[key] === k; });
        if (i >= 0) arr.splice(i, 1);
        persistMemory();
        return { _mem: true };
      },
      clear: function () { arr.length = 0; persistMemory(); return { _mem: true }; }
    };
  }

  function req(r) {
    if (r && r._mem) return Promise.resolve(r.value);
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  var db = {};

  /* ---------- key/value settings ---------- */
  db.getKV = function (key, dflt) {
    return tx("kv", "readonly", function (os) { return req(os.get(key)); })
      .then(function (r) { return r && r.value !== undefined ? r.value : dflt; });
  };
  db.setKV = function (key, value) {
    return tx("kv", "readwrite", function (os) { return req(os.put({ key: key, value: value })); });
  };

  /* ---------- raw access ---------- */
  db.all = function (store) {
    return tx(store, "readonly", function (os) { return req(os.getAll()); })
      .then(function (rows) { return (rows || []).filter(function (r) { return !r.deleted_at; }); });
  };
  db.allIncludingDeleted = function (store) {
    return tx(store, "readonly", function (os) { return req(os.getAll()); }).then(function (r) { return r || []; });
  };
  db.get = function (store, id) {
    return tx(store, "readonly", function (os) { return req(os.get(id)); });
  };

  /* ---------- writes ---------- */
  /** Insert or update. Stamps timestamps, marks the row dirty and queues it for sync. */
  db.put = function (store, rec, opts) {
    opts = opts || {};
    var now = LX.now();
    rec.id = rec.id || LX.uuid();
    rec.created_at = rec.created_at || now;
    rec.updated_at = opts.fromCloud ? (rec.updated_at || now) : now;
    if (rec.deleted_at === undefined) rec.deleted_at = null;
    rec._dirty = opts.fromCloud ? 0 : 1;
    return tx(store, "readwrite", function (os) { return req(os.put(rec)); })
      .then(function () {
        if (opts.fromCloud) return rec;
        return db.enqueue(store, rec.id).then(function () { return rec; });
      });
  };

  db.putMany = function (store, recs, opts) {
    return recs.reduce(function (p, r) {
      return p.then(function () { return db.put(store, r, opts); });
    }, Promise.resolve()).then(function () { return recs; });
  };

  /** Soft delete — the row stays so the deletion can be synced and undone. */
  db.remove = function (store, id) {
    return db.get(store, id).then(function (rec) {
      if (!rec) return null;
      rec.deleted_at = LX.now();
      return db.put(store, rec);
    });
  };

  /** Remove a row outright, with no tombstone. Only for rows the cloud has never
      seen — used when a device's own seeded row is replaced by the account's. */
  db.destroy = function (store, id) {
    return tx(store, "readwrite", function (os) { return req(os.delete(id)); })
      .then(function () { return db.outbox(); })
      .then(function (rows) {
        return rows.filter(function (q) { return q.store === store && q.id === id; })
          .reduce(function (p, q) {
            return p.then(function () { return db.dequeue(q.seq); });
          }, Promise.resolve());
      });
  };

  db.clearStore = function (store) {
    return tx(store, "readwrite", function (os) { return req(os.clear()); });
  };
  db.wipeAll = function () {
    return Promise.all(LX.STORES.concat(["outbox"]).map(function (s) { return db.clearStore(s); }));
  };

  /* ---------- outbox ---------- */
  db.enqueue = function (store, id) {
    return tx("outbox", "readwrite", function (os) {
      return req(os.put({ store: store, id: id, queued_at: LX.now() }));
    });
  };
  db.outbox = function () {
    return tx("outbox", "readonly", function (os) { return req(os.getAll()); }).then(function (r) { return r || []; });
  };
  db.outboxCount = function () { return db.outbox().then(function (r) { return r.length; }); };
  db.dequeue = function (seq) {
    return tx("outbox", "readwrite", function (os) { return req(os.delete(seq)); });
  };
  db.clearOutbox = function () { return db.clearStore("outbox"); };
  db.markClean = function (store, id) {
    return db.get(store, id).then(function (rec) {
      if (!rec) return;
      rec._dirty = 0;
      return tx(store, "readwrite", function (os) { return req(os.put(rec)); });
    });
  };

  /* ---------- queries ---------- */
  db.byDate = function (store, date) {
    return db.all(store).then(function (rows) {
      return rows.filter(function (r) { return r.date === date; });
    });
  };
  db.byRange = function (store, fromIso, toIso) {
    return db.all(store).then(function (rows) {
      return rows.filter(function (r) { return r.date >= fromIso && r.date <= toIso; })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    });
  };

  /** "indexeddb" normally, "browser-storage" when the fallback is in use. */
  db.storageMode = function () { return db_fallbackActive ? "browser-storage" : "indexeddb"; };

  LX.db = db;
})(window.LX);
