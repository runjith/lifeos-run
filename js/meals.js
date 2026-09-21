/* RunOS — Meal templates.
   "My usual breakfast" = 3 eggs, oats, milk and a banana, logged in one tap.
   A template is a saved list of food entries; logging it writes each one as an
   ordinary food entry, so totals, charts and editing all work exactly as if
   you had logged them one by one.

   One table, `meal_templates`: name, meal (the default meal it goes into) and
   items (the list of foods with their quantities and values). */
(function (LX) {
  "use strict";
  var db = LX.db, ui = LX.ui, store = LX.store;
  var meals = {};
  var FIELDS = ["name", "quantity", "unit", "calories", "protein", "carbs", "fat", "fiber"];

  function clean(f) {
    var out = {};
    FIELDS.forEach(function (k) { out[k] = f[k] === undefined ? (k === "name" || k === "unit" ? "" : 0) : f[k]; });
    return out;
  }

  meals.all = function () {
    return db.all("meal_templates").then(function (rows) {
      return rows.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    });
  };

  meals.save = function (name, items, meal, id) {
    var rec = {
      id: id || LX.uuid(),
      name: String(name || "").trim() || "My meal",
      meal: meal || "",
      items: (items || []).map(clean)
    };
    return db.put("meal_templates", rec).then(function () { return rec; });
  };

  meals.remove = function (id) { return db.remove("meal_templates", id); };

  meals.totals = function (items) {
    return {
      calories: LX.sum(items, function (i) { return Number(i.calories) || 0; }),
      protein: LX.sum(items, function (i) { return Number(i.protein) || 0; })
    };
  };

  /** Write every item as a normal food entry. */
  meals.log = function (items, date, meal) {
    return items.reduce(function (p, it) {
      return p.then(function () {
        return store.addFood(Object.assign(clean(it), { date: date, meal: meal }));
      });
    }, Promise.resolve()).then(function () { return items.length; });
  };

  /** What was eaten for this meal on another day — for "same as yesterday". */
  meals.entriesFor = function (date, meal) {
    return db.byDate("food_entries", date).then(function (rows) {
      return rows.filter(function (f) { return f.meal === meal; });
    });
  };

  /** A short line such as "3 eggs, oats, milk". */
  meals.describe = function (items) {
    var names = items.map(function (i) { return i.name; });
    return names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
  };

  /** Ask for a name, then save the given foods as a template. */
  meals.saveSheet = function (items, meal, onDone) {
    if (!items.length) return ui.toast("Log some food for this meal first", "danger");
    var t = meals.totals(items);
    ui.sheet({
      title: "Save as a meal",
      body:
        '<p class="small muted" style="margin:0">' + items.length + " foods · " + LX.num(t.calories) + " kcal · " +
        LX.num(t.protein, 1) + "g protein. Next time, log all of them with one tap from the food sheet.</p>" +
        ui.field("Name", ui.input("name", { placeholder: "My usual " + (meal || "meal").toLowerCase(), value: "My usual " + (meal || "meal").toLowerCase() })),
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-meal-save>Save meal</button>',
      onMount: function (root, close) {
        root.querySelector("[data-meal-save]").addEventListener("click", function () {
          var v = ui.values(root);
          meals.save(v.name, items, meal).then(function () {
            close();
            ui.toast("Meal saved");
            if (onDone) onDone();
          });
        });
      }
    });
  };

  /** Everything saved, with delete. */
  meals.manageSheet = function (onDone) {
    meals.all().then(function (rows) {
      ui.sheet({
        title: "My meals",
        body: rows.length
          ? '<div class="card flush"><div class="list">' + rows.map(function (m) {
              var t = meals.totals(m.items || []);
              return '<div class="list-row"><span class="grow"><span class="primary">' + LX.esc(m.name) + "</span><br>" +
                '<span class="secondary">' + LX.esc(meals.describe(m.items || [])) + " · " + LX.num(t.calories) + " kcal</span></span>" +
                '<button class="icon-btn" data-meal-del="' + m.id + '" aria-label="Delete">' + LX.icon("trash") + "</button></div>";
            }).join("") + "</div></div>"
          : ui.empty("No saved meals yet", "On the Food tab, tap \u201cSave as meal\u201d under any meal you have logged."),
        footer: '<button class="btn btn-block" data-close>Done</button>',
        onMount: function (root, close) {
          LX.on(root, "click", "[data-meal-del]", function (e, t) {
            ui.confirm({ title: "Delete this saved meal?", message: "Food you already logged with it is not touched.",
              confirmText: "Delete", danger: true }).then(function (ok) {
              if (!ok) return;
              meals.remove(t.dataset.mealDel).then(function () { close(); ui.toast("Meal deleted"); meals.manageSheet(onDone); });
            });
          });
        }
      });
    });
  };

  LX.meals = meals;
})(window.LX);
