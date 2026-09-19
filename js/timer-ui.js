/* LifeOS — the running-timer bar.
   It lives in the app shell rather than inside a screen, so it stays visible
   wherever you navigate, and it survives reloads because the timer is stored as
   timestamps in localStorage rather than as a ticking counter. */
(function (LX) {
  "use strict";
  var tick = null, bound = false, lastKey = "";

  function bar() { return document.getElementById("timer-bar"); }

  var timerUI = {
    mount: function () {
      var el = bar();
      if (!el) return;
      if (!bound) {
        // bound once, not on every render, so one tap never fires twice
        LX.on(el, "click", "[data-timer]", function (e, btn) {
          var a = btn.dataset.timer;
          if (a === "pause") { LX.forms.pauseTimer(); LX.haptic(); }
          if (a === "resume") { LX.forms.resumeTimer(); LX.haptic(); }
          if (a === "stop") { LX.forms.stopTimer(LX.app.refresh); }
          if (a === "discard") {
            var t = LX.forms.timerState();
            if (!t) return;
            var cat = LX.store.cat(t.category_id);
            LX.ui.confirm({
              title: "Delete this timer?",
              message: "The " + LX.fmtClock(LX.forms.timerElapsed(t)) + " tracked" +
                (cat ? " under " + cat.name : "") + " is discarded and nothing is saved.",
              confirmText: "Delete", danger: true
            }).then(function (ok) {
              if (!ok) return;
              LX.forms.discardTimer();
              LX.ui.toast("Timer deleted");
              timerUI.render();
              LX.app.refresh();
            });
            return;
          }
          timerUI.render();
        });
        bound = true;
      }
      timerUI.render();
      if (!tick) tick = setInterval(timerUI.render, 1000);
    },

    render: function () {
      var el = bar();
      if (!el) return;
      var t = LX.forms.timerState();
      if (!t) {
        if (el.innerHTML) { el.innerHTML = ""; lastKey = ""; }
        document.body.classList.remove("has-timer");
        return;
      }
      document.body.classList.add("has-timer");
      var cat = LX.store.cat(t.category_id);
      var secs = LX.forms.timerElapsed(t);
      var key = t.category_id + "|" + t.running;
      if (key === lastKey) {
        var clock = el.querySelector(".clock");
        if (clock) { clock.textContent = LX.fmtClock(secs); return; }
      }
      lastKey = key;
      el.innerHTML =
        '<div class="timer-live">' +
        '<span class="tl-dot" style="background:var(' + (cat ? cat.color : "--c-other") + ')"></span>' +
        '<span class="grow">' +
        '<span class="tl-cat">' + LX.esc(cat ? cat.name : "Activity") + (t.running ? "" : " · paused") + "</span>" +
        '<span class="clock">' + LX.fmtClock(secs) + "</span></span>" +
        '<button class="tl-btn" data-timer="discard" aria-label="Delete timer">' + LX.icon("trash") + "</button>" +
        '<button class="tl-btn" data-timer="' + (t.running ? "pause" : "resume") + '" aria-label="' +
        (t.running ? "Pause timer" : "Resume timer") + '">' + LX.icon(t.running ? "pause" : "play") + "</button>" +
        '<button class="tl-btn tl-save" data-timer="stop">Save</button>' +
        "</div>";
    }
  };

  document.addEventListener("lx:timer-changed", function () { timerUI.render(); });
  LX.timerUI = timerUI;
})(window.LX);
