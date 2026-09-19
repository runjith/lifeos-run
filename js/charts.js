/* LifeOS — charts. Plain SVG strings, no chart library, so they load instantly,
   inherit theme colours and stay readable in both themes. */
(function (LX) {
  "use strict";
  var charts = {};
  var W = 340; // viewBox width; SVG scales to the container

  function v(token) { return "var(" + token + ")"; }

  /** 24-hour ribbon. segments: [{minutes, color, name}] — remainder is drawn as untracked. */
  charts.ribbon = function (segments) {
    var total = LX.sum(segments, function (s) { return s.minutes; });
    var html = '<div class="ribbon"><div class="ribbon-track">';
    segments.filter(function (s) { return s.minutes > 0; }).forEach(function (s) {
      var pct = (s.minutes / 1440) * 100;
      html += '<div class="ribbon-seg" style="width:' + pct.toFixed(3) + "%;background:" + v(s.color) + '" ' +
        'title="' + LX.esc(s.name + " · " + LX.fmtDur(s.minutes)) + '"></div>';
    });
    html += "</div>";
    html += '<div class="ribbon-scale"><span>' + LX.fmtDur(total) + ' tracked</span><span>' +
      LX.fmtDur(Math.max(0, 1440 - total)) + " untracked</span></div></div>";
    return html;
  };

  /** Vertical bars with a value axis. opts: {labels, values, goal, color, unit, fmt, height} */
  charts.bars = function (opts) {
    var values = opts.values, labels = opts.labels;
    var H = opts.height || 150, padL = 30, padB = 18, padT = 8;
    var max = Math.max(opts.goal || 0, Math.max.apply(null, values.concat([1])));
    max = niceMax(max);
    var innerW = W - padL - 4, innerH = H - padB - padT;
    var n = values.length;
    var gap = n > 20 ? 1 : (n > 10 ? 2 : 5);
    var bw = Math.max(2, (innerW - gap * (n - 1)) / n);
    var fmt = opts.fmt || function (x) { return LX.num(x); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' +
      LX.esc(opts.aria || "chart") + '">';
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + innerH - innerH * f;
      s += '<line class="grid-line" x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="axis-text" x="0" y="' + (y + 3.5) + '">' + LX.esc(fmt(max * f)) + "</text>";
    });
    values.forEach(function (val, i) {
      var h = Math.max(val > 0 ? 2 : 0, (val / max) * innerH);
      var x = padL + i * (bw + gap);
      var y = padT + innerH - h;
      s += '<rect class="bar-rect" x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + bw.toFixed(2) +
        '" height="' + h.toFixed(2) + '" rx="' + Math.min(3, bw / 2).toFixed(1) + '" fill="' +
        v(opts.color || "--accent") + '"><title>' + LX.esc(labels[i] + ": " + fmt(val)) + "</title></rect>";
      // a full-height invisible strip makes short bars easy to tap on a phone
      if (opts.picks && opts.picks[i]) {
        s += '<rect class="hit" data-pick="' + LX.esc(opts.picks[i]) + '" x="' + (x - gap / 2).toFixed(2) +
          '" y="' + padT + '" width="' + (bw + gap).toFixed(2) + '" height="' + innerH +
          '" fill="transparent"><title>' + LX.esc(labels[i] + ": " + fmt(val)) + "</title></rect>";
      }
    });
    if (opts.goal) {
      var gy = padT + innerH - (opts.goal / max) * innerH;
      s += '<line class="goal-line" x1="' + padL + '" x2="' + W + '" y1="' + gy + '" y2="' + gy + '"/>';
    }
    labels.forEach(function (lab, i) {
      if (n > 12 && i % Math.ceil(n / 7) !== 0) return;
      var x = padL + i * (bw + gap) + bw / 2;
      s += '<text class="axis-text" x="' + x.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' +
        LX.esc(lab) + "</text>";
    });
    return s + "</svg>";
  };

  /** Stacked day columns (time buckets per day). days: [{date, buckets}] */
  charts.stackedDays = function (days, bucketKeys) {
    var H = 168, padB = 18, padT = 6;
    var innerH = H - padB - padT;
    var n = days.length;
    var gap = n > 20 ? 1.5 : 4;
    var bw = Math.max(3, (W - gap * (n - 1)) / n);
    var s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Time by day">';
    days.forEach(function (d, i) {
      var x = i * (bw + gap);
      var y = padT + innerH;
      bucketKeys.forEach(function (k) {
        var mins = d.buckets[k] || 0;
        if (!mins) return;
        var h = (mins / 1440) * innerH;
        y -= h;
        s += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + bw.toFixed(2) +
          '" height="' + h.toFixed(2) + '" fill="' + v(LX.BUCKETS[k].color) + '">' +
          "<title>" + LX.esc(LX.D.short(d.date) + " · " + LX.BUCKETS[k].name + " " + LX.fmtDur(mins)) +
          "</title></rect>";
      });
      s += '<rect class="hit" data-pick="' + d.date + '" x="' + (x - gap / 2).toFixed(2) + '" y="' + padT +
        '" width="' + (bw + gap).toFixed(2) + '" height="' + innerH + '" fill="transparent"><title>' +
        LX.esc(LX.D.short(d.date) + " · " + LX.fmtDur(1440 - (d.buckets.untracked || 0)) + " tracked") + "</title></rect>";
      if (n <= 14 || i % Math.ceil(n / 7) === 0) {
        s += '<text class="axis-text" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 4) +
          '" text-anchor="middle">' + LX.esc(n <= 14 ? LX.D.weekdayLetter(d.date) : LX.D.short(d.date)) + "</text>";
      }
    });
    return s + "</svg>";
  };

  /** Line chart for trends. points: [{label, value}] with nulls allowed (gaps are skipped). */
  charts.line = function (opts) {
    var pts = opts.points.filter(function (p) { return p.value !== null && p.value !== undefined && !isNaN(p.value); });
    var H = opts.height || 160, padL = 34, padB = 18, padT = 10, padR = 6;
    if (pts.length < 2) {
      return '<div class="empty" style="padding:26px"><p style="margin:0">Not enough data yet — two or more entries draw a trend.</p></div>';
    }
    var vals = pts.map(function (p) { return p.value; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var pad = (max - min) * 0.18 || Math.max(1, max * 0.04);
    min = opts.zeroBase ? 0 : min - pad; max = max + pad;
    var innerW = W - padL - padR, innerH = H - padB - padT;
    var fmt = opts.fmt || function (x) { return LX.num(x, 1); };
    var X = function (i) { return padL + (i / (pts.length - 1)) * innerW; };
    var Y = function (val) { return padT + innerH - ((val - min) / (max - min || 1)) * innerH; };
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(2) + " " + Y(p.value).toFixed(2); }).join(" ");
    var area = d + " L" + X(pts.length - 1).toFixed(2) + " " + (padT + innerH) + " L" + padL + " " + (padT + innerH) + " Z";
    var s = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' +
      LX.esc(opts.aria || "trend") + '">';
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + innerH - innerH * f;
      s += '<line class="grid-line" x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="axis-text" x="0" y="' + (y + 3.5) + '">' + LX.esc(fmt(min + (max - min) * f)) + "</text>";
    });
    if (opts.goal && opts.goal >= min && opts.goal <= max) {
      var gy = Y(opts.goal);
      s += '<line class="goal-line" x1="' + padL + '" x2="' + W + '" y1="' + gy.toFixed(2) + '" y2="' + gy.toFixed(2) + '"/>';
    }
    s += '<path class="line-area" d="' + area + '" style="fill:' + v(opts.color || "--accent") + '"/>';
    s += '<path class="line-path" d="' + d + '" style="stroke:' + v(opts.color || "--accent") + '"/>';
    pts.forEach(function (p, i) {
      if (pts.length <= 14 || i === pts.length - 1) {
        s += '<circle class="point" cx="' + X(i).toFixed(2) + '" cy="' + Y(p.value).toFixed(2) +
          '" r="3" style="stroke:' + v(opts.color || "--accent") + '"><title>' +
          LX.esc(p.label + ": " + fmt(p.value)) + "</title></circle>";
      }
    });
    if (opts.picks !== false) {
      pts.forEach(function (p, i) {
        if (!p.pick) return;
        var w = innerW / Math.max(1, pts.length - 1);
        s += '<rect class="hit" data-pick="' + LX.esc(p.pick) + '" x="' + (X(i) - w / 2).toFixed(2) +
          '" y="' + padT + '" width="' + w.toFixed(2) + '" height="' + innerH + '" fill="transparent"><title>' +
          LX.esc(p.label + ": " + fmt(p.value)) + "</title></rect>";
      });
    }
    [0, pts.length - 1].forEach(function (i) {
      s += '<text class="axis-text" x="' + X(i).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="' +
        (i === 0 ? "start" : "end") + '">' + LX.esc(pts[i].label) + "</text>";
    });
    return s + "</svg>";
  };

  /** Draw the same data as bars or as a line, depending on the chosen style.
      opts: {style, labels, values, picks, goal, color, fmt, height, aria} */
  charts.plot = function (opts) {
    if (opts.style === "line") {
      return charts.line({
        points: opts.labels.map(function (l, i) {
          return { label: l, value: opts.values[i], pick: opts.picks && opts.picks[i] };
        }),
        fmt: opts.fmt, color: opts.color, height: opts.height, aria: opts.aria,
        zeroBase: opts.zeroBase !== false, goal: opts.goal
      });
    }
    return charts.bars(opts);
  };

  /** The toggle that switches every chart on a screen between bars and a line. */
  charts.styleToggle = function (current) {
    return '<div class="segmented" style="max-width:190px;margin-left:auto">' +
      ['bar', 'line'].map(function (k) {
        return '<button data-chart-style="' + k + '" aria-pressed="' + (current === k) + '">' +
          (k === "bar" ? "Bars" : "Line") + "</button>";
      }).join("") + "</div>";
  };

  function niceMax(n) {
    if (n <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(n)));
    var r = n / mag;
    var step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
    return step * mag;
  }

  charts.legend = function (items) {
    return '<div class="legend">' + items.map(function (it) {
      return "<span><i style='background:" + v(it.color) + "'></i>" + LX.esc(it.name) +
        (it.value !== undefined ? " <b style='font-weight:560;margin-left:2px'>" + LX.esc(it.value) + "</b>" : "") + "</span>";
    }).join("") + "</div>";
  };

  LX.charts = charts;
})(window.LX);
