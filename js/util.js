/* LifeOS — utilities. Everything hangs off one global, LX, so files load in plain
   <script> order with no build step. */
window.LX = window.LX || {};

(function (LX) {
  "use strict";

  /* ---------- ids ---------- */
  LX.uuid = function () {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
  LX.now = function () { return new Date().toISOString(); };

  /* ---------- dates (all stored as YYYY-MM-DD in local time) ---------- */
  var D = {};
  D.iso = function (d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  D.today = function () { return D.iso(new Date()); };
  D.parse = function (iso) { var p = String(iso).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  D.add = function (iso, days) { var d = D.parse(iso); d.setDate(d.getDate() + days); return D.iso(d); };
  D.range = function (endIso, days) {
    var out = [];
    for (var i = days - 1; i >= 0; i--) out.push(D.add(endIso, -i));
    return out;
  };
  D.long = function (iso) {
    return D.parse(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  };
  D.short = function (iso) {
    return D.parse(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  D.weekdayLetter = function (iso) {
    return D.parse(iso).toLocaleDateString(undefined, { weekday: "narrow" });
  };
  D.isToday = function (iso) { return iso === D.today(); };
  /* Weeks run Monday to Sunday. Weekly goals are judged on a whole calendar
     week, which is why this is a fixed Monday and not "the last seven days". */
  D.weekStart = function (iso) {
    var d = D.parse(iso || D.today());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return D.iso(d);
  };
  D.weekEnd = function (iso) { return D.add(D.weekStart(iso), 6); };
  D.weekLabel = function (startIso) {
    var here = D.weekStart(D.today());
    if (startIso === here) return "This week";
    if (startIso === D.add(here, -7)) return "Last week";
    return D.short(startIso) + " – " + D.short(D.add(startIso, 6));
  };
  D.relative = function (iso) {
    if (D.isToday(iso)) return "Today";
    if (iso === D.add(D.today(), -1)) return "Yesterday";
    if (iso === D.add(D.today(), 1)) return "Tomorrow";
    return D.long(iso);
  };
  /** minutes since midnight from "HH:MM" */
  D.minsOf = function (hhmm) {
    if (!hhmm) return null;
    var p = String(hhmm).split(":");
    return (+p[0]) * 60 + (+p[1] || 0);
  };
  D.hhmm = function (mins) {
    mins = ((Math.round(mins) % 1440) + 1440) % 1440;
    return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  };
  D.clockNow = function () {
    return new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  LX.D = D;

  /* ---------- numbers ---------- */
  LX.fmtDur = function (mins, style) {
    mins = Math.max(0, Math.round(mins || 0));
    var h = Math.floor(mins / 60), m = mins % 60;
    if (style === "compact") return h ? h + "h " + (m ? m + "m" : "") : m + "m";
    if (!h) return m + "m";
    return h + "h " + String(m).padStart(2, "0") + "m";
  };
  LX.fmtClock = function (secs) {
    secs = Math.max(0, Math.floor(secs));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    var mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
    return h ? h + ":" + mm + ":" + ss : mm + ":" + ss;
  };
  LX.num = function (n, dp) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    dp = dp === undefined ? 0 : dp;
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };
  LX.signed = function (n, dp) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return (n > 0 ? "+" : "") + LX.num(n, dp === undefined ? 1 : dp);
  };
  LX.round = function (n, dp) { var f = Math.pow(10, dp || 0); return Math.round(n * f) / f; };
  LX.sum = function (arr, pick) { return arr.reduce(function (a, b) { return a + (pick ? (pick(b) || 0) : (b || 0)); }, 0); };
  LX.avg = function (arr, pick) { return arr.length ? LX.sum(arr, pick) / arr.length : 0; };

  /* ---------- DOM ---------- */
  LX.esc = function (s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  LX.$ = function (sel, root) { return (root || document).querySelector(sel); };
  LX.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  LX.on = function (root, evt, sel, fn) {
    root.addEventListener(evt, function (e) {
      var t = e.target.closest(sel);
      if (t && root.contains(t)) fn(e, t);
    });
  };
  LX.debounce = function (fn, ms) {
    var t; return function () {
      var a = arguments, self = this;
      clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 200);
    };
  };
  LX.haptic = function () { if (navigator.vibrate) try { navigator.vibrate(8); } catch (e) {} };

  /* ---------- icons (24px stroke, drawn inline so there is no icon dependency) ---------- */
  var P = {
    home: '<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"/><path d="M9.5 20.5v-6h5v6"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    health: '<path d="M3.5 12.5h4l1.8-4.5 3 9 2.2-6 1.5 3h4.5"/>',
    progress: '<path d="M4 19.5V9"/><path d="M10 19.5V4.5"/><path d="M16 19.5v-7"/><path d="M21 19.5H3"/>',
    more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    play: '<path d="M7.5 5.5 18 12 7.5 18.5z"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    alert: '<path d="M12 8v5"/><circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8.5"/>',
    chevron: '<path d="M9 5.5 15.5 12 9 18.5"/>',
    chevronDown: '<path d="M5.5 9 12 15.5 18.5 9"/>',
    back: '<path d="M15 5.5 8.5 12 15 18.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5"/>',
    bed: '<path d="M3.5 18V8"/><path d="M3.5 12.5h17V18"/><path d="M7.5 12.5V10h5v2.5"/>',
    dumbbell: '<path d="M6.5 8.5v7M3.5 10v4M17.5 8.5v7M20.5 10v4M6.5 12h11"/>',
    food: '<path d="M6.5 3.5v8a2 2 0 0 0 4 0v-8"/><path d="M8.5 11.5v9"/><path d="M17.5 3.5c-1.5 1.2-2 3-2 5s.6 3 2 3.2v8.8"/>',
    ruler: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7.5 8v3M11 8v4M14.5 8v3M18 8v4"/>',
    timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.5 1.5M9.5 3.5h5"/>',
    download: '<path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M4.5 19.5h15"/>',
    upload: '<path d="M12 15.5v-11"/><path d="M7.5 9 12 4.5 16.5 9"/><path d="M4.5 19.5h15"/>',
    trash: '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.5h6v2"/><path d="M6.5 6.5 7.5 20h9l1-13.5"/>',
    edit: '<path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 16.5z"/>',
    cloud: '<path d="M7 18.5a4 4 0 0 1 .4-8A5.2 5.2 0 0 1 17.4 11a3.8 3.8 0 0 1-.4 7.5z"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    book: '<path d="M5 4.5h9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H5z"/><path d="M5 4.5v12.5"/>',
    scale: '<path d="M12 5v14"/><circle cx="12" cy="12" r="8"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    refresh: '<path d="M19 8.5A7.5 7.5 0 1 0 20 13"/><path d="M20 4.5V9h-4.5"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>'
  };
  LX.icon = function (name, cls) {
    var body = P[name] || "";
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
  };
})(window.LX);
