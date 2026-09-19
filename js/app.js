/* LifeOS — app shell: theme, navigation and rendering. */
(function (LX) {
  "use strict";
  var app = {};
  var current = "home";
  var viewEl, titleEl, subEl, pillEl;

  var TABS = [
    { key: "home", label: "Home", icon: "home" },
    { key: "time", label: "Time", icon: "clock" },
    { key: "health", label: "Health", icon: "health" },
    { key: "progress", label: "Progress", icon: "progress" },
    { key: "more", label: "More", icon: "more" }
  ];

  app.applyTheme = function () {
    var pref = (LX.store.settings && LX.store.settings.theme) || "system";
    var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0B0D0C" : "#F3F4F3");
  };

  app.go = function (key) {
    current = key;
    LX.$$("#tabbar button").forEach(function (b) {
      if (b.dataset.tab === key) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + key) history.replaceState(null, "", "#" + key);
    viewEl.scrollTop = 0;
    if (window.scrollTo) try { window.scrollTo(0, 0); } catch (e) {}
    return app.refresh();
  };

  // renders are queued so two quick taps never interleave inside the same element
  var chain = Promise.resolve();
  app.refresh = function () {
    chain = chain.then(renderCurrent, renderCurrent);
    return chain;
  };

  function renderCurrent() {
    var screen = LX.screens[current];
    if (!screen) return Promise.resolve();
    // Screens attach their own click handlers to this element every time they
    // render. Swapping in a clean copy first means those handlers cannot pile
    // up — otherwise one tap would open the same sheet several times over.
    var fresh = viewEl.cloneNode(false);
    viewEl.parentNode.replaceChild(fresh, viewEl);
    viewEl = fresh;
    titleEl.textContent = screen.title();
    subEl.textContent = screen.subtitle ? screen.subtitle() : "";
    var result = screen.render(viewEl);
    return Promise.resolve(result).then(function () {
      viewEl.classList.remove("fade-in");
      void viewEl.offsetWidth;
      viewEl.classList.add("fade-in");
      updatePill();
    }).catch(function (e) {
      console.error(e);
      viewEl.innerHTML = '<div class="banner danger">' + LX.icon("alert") +
        "<span><b>This screen could not load</b><br>" + LX.esc(e.message) +
        "<br>Your data is safe. Reload the app and try again.</span></div>";
    });
  }

  function updatePill() {
    if (!pillEl) return;
    var st = LX.cloud.pillState();
    pillEl.dataset.state = st;
    pillEl.querySelector("span.txt").textContent = LX.cloud.statusText();
    pillEl.classList.toggle("hidden", st === "local" && !LX.cloud.configured());
  }

  var booted = false;
  app.boot = function () {
    if (booted) return Promise.resolve();
    booted = true;
    viewEl = document.getElementById("view");
    titleEl = document.getElementById("app-title");
    subEl = document.getElementById("app-sub");
    pillEl = document.getElementById("sync-pill");

    var bar = document.getElementById("tabbar");
    bar.innerHTML = TABS.map(function (t) {
      return '<button data-tab="' + t.key + '" aria-label="' + t.label + '">' +
        LX.icon(t.icon) + "<span>" + t.label + "</span></button>";
    }).join("");
    LX.on(bar, "click", "[data-tab]", function (e, t) {
      LX.haptic();
      app.go(t.dataset.tab);
    });

    window.addEventListener("hashchange", function () {
      var key = location.hash.replace("#", "");
      if (LX.screens[key] && key !== current) app.go(key);
    });

    // Sticky-header hairline once the page scrolls
    var appbar = document.querySelector(".appbar");
    window.addEventListener("scroll", function () {
      appbar.classList.toggle("is-stuck", window.scrollY > 4);
    }, { passive: true });

    document.addEventListener("lx:sync-state", updatePill);
    if (pillEl) pillEl.addEventListener("click", function () {
      LX.cloud.sync().then(function () { app.refresh(); }).catch(function () {});
    });

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", app.applyTheme);

    return LX.store.init().then(function () {
      app.applyTheme();
      var start = location.hash.replace("#", "");
      current = LX.screens[start] ? start : "home";
      LX.cloud.init();
      return app.go(current);
    }).then(function () {
      var splash = document.getElementById("boot");
      if (splash) splash.remove();
      if (LX.db.storageMode() === "browser-storage") {
        setTimeout(function () {
          LX.ui.toast("This browser blocked the app database — saving to browser storage instead");
        }, 700);
      }
      LX.timerUI.mount();
      // keep Home's clock and any running timer honest when returning to the app
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) app.refresh();
      });
    }).catch(function (e) {
      console.error(e);
      var el = document.getElementById("boot") || document.getElementById("view");
      if (el) el.innerHTML =
        '<div class="banner danger" style="margin:24px">' + LX.icon("alert") +
        "<span><b>LifeOS could not start</b><br>" + LX.esc(e.message) + "</span></div>";
    });
  };

  LX.app = app;

  document.addEventListener("DOMContentLoaded", function () {
    app.boot();
    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  });
})(window.LX);
