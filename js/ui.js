/* LifeOS — UI primitives shared by every screen. */
(function (LX) {
  "use strict";
  var ui = {};
  var openSheets = [];   // innermost sheet last
  var sheetSeq = 0;
  var selfPops = 0;      // history steps this module asked for itself

  /* The phone's back gesture and the browser back button close the top sheet
     instead of leaving the app. Each open sheet pushes one history entry.
     When a sheet is closed by tapping, it also rewinds its own entry — and that
     rewind must not be mistaken for a second back press, or the sheet beneath
     would close too. */
  window.addEventListener("popstate", function () {
    if (selfPops > 0) { selfPops--; return; }
    if (openSheets.length) openSheets[openSheets.length - 1].close({ fromHistory: true });
  });

  /* ---------- toast ---------- */
  ui.toast = function (message, kind) {
    var host = document.getElementById("toasts");
    var el = document.createElement("div");
    el.className = "toast" + (kind === "danger" ? " danger" : "");
    el.setAttribute("role", "status");
    el.innerHTML = LX.icon(kind === "danger" ? "alert" : "check") + "<span>" + LX.esc(message) + "</span>";
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add("is-out");
      setTimeout(function () { el.remove(); }, 200);
    }, kind === "danger" ? 3400 : 2100);
  };

  /* ---------- bottom sheet ---------- */
  /** opts: {title, body (HTML string), footer (HTML), onMount(root, close), size} */
  ui.sheet = function (opts) {
    var scrim = document.createElement("div");
    scrim.className = "scrim";
    var sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", opts.title || "Dialog");
    sheet.innerHTML =
      '<div class="sheet-grab"></div>' +
      '<div class="sheet-head"><h2>' + LX.esc(opts.title || "") + "</h2>" +
      '<button class="icon-btn" data-close aria-label="Close">' + LX.icon("x") + "</button></div>" +
      '<div class="sheet-body">' + (opts.body || "") + "</div>" +
      (opts.footer ? '<div class="sheet-foot">' + opts.footer + "</div>" : "");

    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    document.body.style.overflow = "hidden";

    var closed = false;
    var myId = ++sheetSeq;
    try { history.pushState({ lxSheet: myId }, ""); } catch (e) {}

    function close(o) {
      if (closed) return;
      closed = true;
      // Stop taking taps the instant it starts closing, so a second tap lands on
      // whatever is underneath rather than on a sheet that is already leaving.
      scrim.style.pointerEvents = "none";
      sheet.style.pointerEvents = "none";
      scrim.classList.remove("is-open");
      sheet.classList.remove("is-open");
      openSheets = openSheets.filter(function (s) { return s.id !== myId; });
      if (!openSheets.length) document.body.style.overflow = "";
      setTimeout(function () { scrim.remove(); sheet.remove(); }, 260);
      document.removeEventListener("keydown", onKey);
      if (!(o && o.fromHistory)) {
        try {
          if (history.state && history.state.lxSheet === myId) { selfPops++; history.back(); }
        } catch (e) {}
      }
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    requestAnimationFrame(function () {
      scrim.classList.add("is-open");
      sheet.classList.add("is-open");
      var focusable = sheet.querySelector("input, select, textarea, button:not([data-close])");
      if (focusable && window.matchMedia("(min-width: 720px)").matches) focusable.focus();
    });
    scrim.addEventListener("click", function () { close(); });
    sheet.addEventListener("click", function (e) {
      var hit = e.target.closest("[data-close]");
      if (hit && sheet.contains(hit)) { e.preventDefault(); close(); }
    });
    document.addEventListener("keydown", onKey);
    openSheets.push({ id: myId, close: close });

    /* Drag down on the grab handle to dismiss. Deliberately not on the header:
       a drag that starts on the close button cancels its tap, which is why
       closing used to need several attempts. */
    var startY = null, dy = 0, dragging = false;
    sheet.addEventListener("touchstart", function (e) {
      if (e.target.closest("button, input, select, textarea, a")) return;
      if (!e.target.closest(".sheet-grab") && !e.target.closest(".sheet-head")) return;
      startY = e.touches[0].clientY; dy = 0; dragging = false;
    }, { passive: true });
    sheet.addEventListener("touchmove", function (e) {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      if (!dragging && dy < 10) return;          // a tap is not a drag
      if (!dragging) { dragging = true; sheet.style.transition = "none"; }
      sheet.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    sheet.addEventListener("touchend", function () {
      if (startY === null) return;
      if (dragging) {
        sheet.style.transition = "";
        sheet.style.transform = "";
        if (dy > 110) close();
      }
      startY = null; dragging = false;
    });

    if (opts.onMount) opts.onMount(sheet, close);
    return { el: sheet, close: close };
  };

  ui.closeAllSheets = function () {
    openSheets.slice().reverse().forEach(function (s) { s.close(); });
  };
  ui.sheetCount = function () { return openSheets.length; };

  /* ---------- confirm ---------- */
  ui.confirm = function (opts) {
    return new Promise(function (resolve) {
      var handle = ui.sheet({
        title: opts.title || "Are you sure?",
        body: '<p class="small muted">' + LX.esc(opts.message || "") + "</p>",
        footer: '<button class="btn" data-no>' + LX.esc(opts.cancelText || "Cancel") + "</button>" +
                '<button class="btn ' + (opts.danger ? "btn-danger" : "btn-primary") + '" data-yes>' +
                LX.esc(opts.confirmText || "Confirm") + "</button>",
        onMount: function (root, close) {
          root.querySelector("[data-yes]").addEventListener("click", function () { resolve(true); close(); });
          root.querySelector("[data-no]").addEventListener("click", function () { resolve(false); close(); });
        },
        onClose: function () { resolve(false); }
      });
      void handle;
    });
  };

  /* ---------- form fragments ---------- */
  ui.field = function (label, inner, hint) {
    return '<label class="field"><span class="label">' + LX.esc(label) + "</span>" + inner +
      (hint ? '<span class="hint">' + LX.esc(hint) + "</span>" : "") + "</label>";
  };
  ui.input = function (name, opts) {
    opts = opts || {};
    return '<input class="input" name="' + name + '" type="' + (opts.type || "text") + '"' +
      (opts.value !== undefined && opts.value !== null ? ' value="' + LX.esc(opts.value) + '"' : "") +
      (opts.placeholder ? ' placeholder="' + LX.esc(opts.placeholder) + '"' : "") +
      (opts.step ? ' step="' + opts.step + '"' : "") +
      (opts.min !== undefined ? ' min="' + opts.min + '"' : "") +
      (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : "") +
      (opts.required ? " required" : "") + " />";
  };
  ui.select = function (name, options, value) {
    return '<select class="select" name="' + name + '">' + options.map(function (o) {
      var val = o.value !== undefined ? o.value : o;
      var lab = o.label !== undefined ? o.label : o;
      return '<option value="' + LX.esc(val) + '"' + (String(val) === String(value) ? " selected" : "") + ">" +
        LX.esc(lab) + "</option>";
    }).join("") + "</select>";
  };
  ui.textarea = function (name, value, placeholder) {
    return '<textarea class="textarea" name="' + name + '" placeholder="' + LX.esc(placeholder || "") + '">' +
      LX.esc(value || "") + "</textarea>";
  };
  ui.values = function (root) {
    var out = {};
    LX.$$("input, select, textarea", root).forEach(function (el) {
      if (!el.name) return;
      if (el.type === "checkbox") out[el.name] = el.checked;
      else out[el.name] = el.value;
    });
    return out;
  };

  ui.empty = function (title, text, actionLabel, actionAttr) {
    return '<div class="empty"><h3>' + LX.esc(title) + "</h3><p>" + LX.esc(text) + "</p>" +
      (actionLabel ? '<button class="btn btn-primary btn-sm" ' + (actionAttr || "") + ">" +
        LX.esc(actionLabel) + "</button>" : "") + "</div>";
  };

  ui.skeleton = function (n) {
    var out = "";
    for (var i = 0; i < (n || 3); i++) {
      out += '<div class="card"><div class="skeleton" style="height:14px;width:35%;margin-bottom:12px"></div>' +
        '<div class="skeleton" style="height:28px;width:60%"></div></div>';
    }
    return '<div style="display:flex;flex-direction:column;gap:16px">' + out + "</div>";
  };

  LX.ui = ui;
})(window.LX);
