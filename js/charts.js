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
    /* Each bar's colour says something. With a goal: reached = full colour,
       close (75%+) = lighter, well short = faint; over a limit = red; more than
       10% over a target (calories) = red. Without a goal: the latest bar is
       full strength and the rest a little softer, with a dashed average line. */
    var goal = opts.goal, mode = opts.goalMode || "atLeast";
    var base = v(opts.color || "--accent");
    function paint(val, i) {
      if (goal) {
        var r = val / goal;
        if (mode === "atMost") return val > goal ? { c: v("--danger"), o: 1 } : { c: base, o: 1 };
        if (mode === "target") {
          if (r > 1.1) return { c: v("--danger"), o: 1 };
          if (r >= 0.9) return { c: base, o: 1 };
          return { c: base, o: r >= 0.75 ? 0.6 : 0.32 };
        }
        return { c: base, o: r >= 1 ? 1 : (r >= 0.75 ? 0.6 : 0.32) };
      }
      return { c: base, o: i === n - 1 ? 1 : 0.62 };
    }
    values.forEach(function (val, i) {
      var h = Math.max(val > 0 ? 2 : 0, (val / max) * innerH);
      var x = padL + i * (bw + gap);
      var y = padT + innerH - h;
      var pt = paint(val, i);
      s += '<rect class="bar-rect" x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + bw.toFixed(2) +
        '" height="' + h.toFixed(2) + '" rx="' + Math.min(3, bw / 2).toFixed(1) + '" style="fill:' + pt.c +
        ";fill-opacity:" + pt.o + '"><title>' + LX.esc(labels[i] + ": " + fmt(val)) + "</title></rect>";
      // the latest bar carries its value, so today's number is readable at a glance
      if (i === n - 1 && val > 0) {
        s += '<text class="bar-label" x="' + (x + bw / 2).toFixed(1) + '" y="' + Math.max(9, y - 4).toFixed(1) +
          '" text-anchor="' + (n > 12 ? "end" : "middle") + '">' + LX.esc(fmt(val)) + "</text>";
      }
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
    } else {
      var nz = values.filter(function (x) { return x > 0; });
      if (nz.length >= 3) {
        var avg = LX.sum(nz, function (x) { return x; }) / nz.length;
        var ay = padT + innerH - (avg / max) * innerH;
        s += '<line class="avg-line" x1="' + padL + '" x2="' + W + '" y1="' + ay.toFixed(1) + '" y2="' + ay.toFixed(1) + '"/>' +
          '<text class="axis-text" x="' + (W - 2) + '" y="' + (ay - 3).toFixed(1) + '" text-anchor="end">avg ' + LX.esc(fmt(avg)) + "</text>";
      }
    }
    labels.forEach(function (lab, i) {
      if (n > 12 && i % Math.ceil(n / 7) !== 0) return;
      var x = padL + i * (bw + gap) + bw / 2;
      s += '<text class="axis-text" x="' + x.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' +
        LX.esc(lab) + "</text>";
    });
    return s + "</svg>" + (goal ? key(mode, base) : "");
  };

  /** The little key under a goal chart, so the bar colours explain themselves. */
  function key(mode, base) {
    var dot = function (c, o) { return '<i style="background:' + c + ";opacity:" + o + '"></i>'; };
    var items = mode === "atMost" ? [[base, 1, "Within limit"], [v("--danger"), 1, "Over"]]
      : mode === "target" ? [[base, 1, "On target"], [base, 0.45, "Under"], [v("--danger"), 1, "Over"]]
      : [[base, 1, "Goal reached"], [base, 0.6, "Close"], [base, 0.32, "Short"]];
    return '<div class="chart-key">' + items.map(function (x) {
      return "<span>" + dot(x[0], x[1]) + x[2] + "</span>";
    }).join("") + '<span><i class="goal-dash"></i>Goal</span></div>';
  }

  /** Donut (pie) chart with a legend of shares.
      items: [{name, value, color}] · opts: {center, centerLabel, fmt, aria, empty} */
  charts.donut = function (items, opts) {
    opts = opts || {};
    var list = items.filter(function (i) { return i.value > 0; });
    var total = LX.sum(list, function (i) { return i.value; });
    if (!total) return '<p class="small muted" style="margin:0">' + LX.esc(opts.empty || "Nothing to show yet.") + "</p>";
    var fmt = opts.fmt || function (x) { return LX.num(x); };
    var r = 52, c = 2 * Math.PI * r, off = 0;
    var s = '<div class="donut-wrap"><svg class="donut" viewBox="0 0 140 140" role="img" aria-label="' + LX.esc(opts.aria || "Share") + '">' +
      '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="var(--surface-sunk)" stroke-width="18"/>';
    list.forEach(function (it) {
      var len = (it.value / total) * c;
      var cut = list.length > 1 ? Math.min(2.2, len * 0.3) : 0;     // a hairline gap between slices
      s += '<circle class="donut-seg" cx="70" cy="70" r="' + r + '" fill="none" stroke="' + v(it.color) +
        '" stroke-width="18" stroke-dasharray="' + (len - cut).toFixed(2) + " " + (c - len + cut).toFixed(2) +
        '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"><title>' +
        LX.esc(it.name + ": " + fmt(it.value)) + "</title></circle>";
      off += len;
    });
    if (opts.center) {
      s += '<text x="70" y="' + (opts.centerLabel ? 70 : 76) + '" text-anchor="middle" class="donut-center">' + LX.esc(opts.center) + "</text>";
      if (opts.centerLabel) s += '<text x="70" y="88" text-anchor="middle" class="axis-text">' + LX.esc(opts.centerLabel) + "</text>";
    }
    s += '</svg><div class="donut-legend">' + list.slice().sort(function (a, b) { return b.value - a.value; }).map(function (it) {
      return '<div class="dl-row"><i style="background:' + v(it.color) + '"></i><span class="grow">' + LX.esc(it.name) +
        '</span><b>' + Math.round((it.value / total) * 100) + '%</b><span class="dl-val">' + LX.esc(fmt(it.value)) + "</span></div>";
    }).join("") + "</div></div>";
    return s;
  };

  /** Calendar heatmap: one square per day, weeks as columns, Monday on top.
      Darker = more. days: [{date, value}] oldest first · opts: {color, fmt, unit, aria} */
  charts.heatmap = function (days, opts) {
    opts = opts || {};
    if (!days.length) return "";
    var fmt = opts.fmt || function (x) { return LX.num(x); };
    var start = LX.D.weekStart(days[0].date), today = LX.D.today();
    var byDate = {};
    days.forEach(function (d) { byDate[d.date] = d.value; });
    var last = days[days.length - 1].date;
    var cols = Math.floor((LX.D.parse(last) - LX.D.parse(start)) / 864e5 / 7) + 1;
    var max = Math.max.apply(null, days.map(function (d) { return d.value; }).concat([1]));
    // up to six weeks: a normal month calendar (weekdays across, weeks down);
    // longer: weeks as columns, so months of history fit on a phone
    var cal = cols <= 6;
    var cell = cal ? 30 : 13, g = cal ? 6 : 3, left = cal ? 0 : 14, top = cal ? 16 : 2;
    var Wd = cal ? 7 * (cell + g) - g : left + cols * (cell + g), Hd = cal ? top + cols * (cell + g) : top + 7 * (cell + g);
    var col = v(opts.color || "--accent");
    var s = '<svg class="heatmap' + (cal ? " is-cal" : "") + '" viewBox="0 0 ' + Wd + " " + Hd + '" role="img" aria-label="' + LX.esc(opts.aria || "Calendar") + '">';
    if (cal) {
      ["M", "T", "W", "T", "F", "S", "S"].forEach(function (l, i) {
        s += '<text class="axis-text" x="' + (i * (cell + g) + cell / 2) + '" y="10" text-anchor="middle">' + l + "</text>";
      });
    } else {
      [["M", 0], ["W", 2], ["F", 4]].forEach(function (l) {
        s += '<text class="axis-text" x="0" y="' + (top + l[1] * (cell + g) + 10) + '">' + l[0] + "</text>";
      });
    }
    for (var d = start; d <= last; d = LX.D.add(d, 1)) {
      var i = Math.round((LX.D.parse(d) - LX.D.parse(start)) / 864e5);
      var wk = Math.floor(i / 7), dow = i % 7;
      var x = cal ? dow * (cell + g) : left + wk * (cell + g);
      var y = cal ? top + wk * (cell + g) : top + dow * (cell + g);
      var val = byDate[d] || 0;
      var lvl = val <= 0 ? 0 : Math.min(4, Math.ceil((val / max) * 4));
      var fill = lvl ? col : "var(--surface-sunk)";
      var op = [1, 0.3, 0.52, 0.76, 1][lvl];
      var inRange = byDate[d] !== undefined;
      s += '<rect class="heat-cell" x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="' + (cal ? 7 : 3) + '" style="fill:' +
        fill + ";fill-opacity:" + (inRange ? op : 0.35) + (d === today ? ";stroke:var(--ink);stroke-width:1.5" : "") + '">' +
        "<title>" + LX.esc(LX.D.short(d) + ": " + fmt(val)) + "</title></rect>";
      if (cal && inRange) {
        s += '<text class="heat-day" x="' + (x + cell / 2) + '" y="' + (y + cell / 2 + 3.5) + '" text-anchor="middle">' +
          Number(d.slice(8, 10)) + "</text>";
      }
    }
    s += "</svg>";
    return s + '<div class="chart-key"><span>Less</span>' + [0, 1, 2, 3, 4].map(function (l) {
      return '<i style="background:' + (l ? col : "var(--surface-sunk)") + ";opacity:" + [1, 0.3, 0.52, 0.76, 1][l] + '"></i>';
    }).join("") + "<span>More</span>" + (opts.caption ? '<span class="grow" style="text-align:right">' + LX.esc(opts.caption) + "</span>" : "") + "</div>";
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
