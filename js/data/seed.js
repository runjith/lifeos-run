/* LifeOS — starting data. Seeded once on first run, then fully editable by the user. */
(function (LX) {
  "use strict";

  /* bucket drives the roll-ups on Progress: productive / exercise / personal / chores / entertainment / sleep */
  LX.SEED_CATEGORIES = [
    { slug: "work",          name: "Work",         color: "--c-work",      bucket: "productive" },
    { slug: "business",      name: "Business",     color: "--c-business",  bucket: "productive" },
    { slug: "coding",        name: "Coding",       color: "--c-coding",    bucket: "productive" },
    { slug: "learning",      name: "Learning",     color: "--c-learning",  bucket: "productive" },
    { slug: "reading",       name: "Reading",      color: "--c-reading",   bucket: "productive" },
    { slug: "exercise",      name: "Exercise",     color: "--c-exercise",  bucket: "exercise" },
    { slug: "boxing",        name: "Boxing",       color: "--c-boxing",    bucket: "exercise" },
    { slug: "walking",       name: "Walking",      color: "--c-walking",   bucket: "exercise" },
    { slug: "cooking",       name: "Cooking",      color: "--c-cooking",   bucket: "personal" },
    { slug: "chores",        name: "Chores",       color: "--c-chores",    bucket: "chores" },
    { slug: "family",        name: "Family",       color: "--c-family",    bucket: "personal" },
    { slug: "travel",        name: "Travel",       color: "--c-travel",    bucket: "personal" },
    { slug: "personal",      name: "Personal",     color: "--c-personal",  bucket: "personal" },
    { slug: "entertainment", name: "Entertainment",color: "--c-entertain", bucket: "entertainment" },
    { slug: "youtube",       name: "YouTube",      color: "--c-youtube",   bucket: "entertainment" },
    { slug: "social",        name: "Social media", color: "--c-social",    bucket: "entertainment" },
    { slug: "sleep",         name: "Sleep",        color: "--c-sleep",     bucket: "sleep" },
    { slug: "other",         name: "Other",        color: "--c-other",     bucket: "personal" }
  ];

  LX.BUCKETS = {
    productive:    { name: "Productive",    color: "--c-work" },
    exercise:      { name: "Exercise",      color: "--c-exercise" },
    personal:      { name: "Personal",      color: "--c-personal" },
    chores:        { name: "Chores",        color: "--c-chores" },
    entertainment: { name: "Entertainment", color: "--c-entertain" },
    sleep:         { name: "Sleep",         color: "--c-sleep" },
    untracked:     { name: "Untracked",     color: "--c-untracked" }
  };

  LX.WORKOUT_TYPES = ["Upper", "Lower", "Push", "Pull", "Legs", "Full Body", "Boxing", "Cardio"];

  LX.SEED_EXERCISES = [
    ["Bench Press", "Chest"], ["Incline Dumbbell Press", "Chest"], ["Chest Fly", "Chest"],
    ["Push-up", "Chest"], ["Cable Crossover", "Chest"],
    ["Pull-up", "Back"], ["Lat Pulldown", "Back"], ["Barbell Row", "Back"],
    ["Seated Cable Row", "Back"], ["Deadlift", "Back"], ["Dumbbell Row", "Back"],
    ["Overhead Press", "Shoulders"], ["Lateral Raise", "Shoulders"], ["Rear Delt Fly", "Shoulders"],
    ["Front Raise", "Shoulders"], ["Shrug", "Shoulders"],
    ["Barbell Curl", "Biceps"], ["Dumbbell Curl", "Biceps"], ["Hammer Curl", "Biceps"],
    ["Preacher Curl", "Biceps"],
    ["Triceps Pushdown", "Triceps"], ["Skull Crusher", "Triceps"], ["Overhead Triceps Extension", "Triceps"],
    ["Dips", "Triceps"],
    ["Back Squat", "Legs"], ["Front Squat", "Legs"], ["Leg Press", "Legs"], ["Romanian Deadlift", "Legs"],
    ["Lunge", "Legs"], ["Leg Extension", "Legs"], ["Leg Curl", "Legs"], ["Hip Thrust", "Legs"],
    ["Standing Calf Raise", "Calves"], ["Seated Calf Raise", "Calves"],
    ["Plank", "Core"], ["Hanging Leg Raise", "Core"], ["Cable Crunch", "Core"], ["Russian Twist", "Core"],
    ["Treadmill Run", "Cardio"], ["Cycling", "Cardio"], ["Rowing Machine", "Cardio"],
    ["Skipping", "Cardio"], ["Heavy Bag", "Cardio"], ["Shadow Boxing", "Cardio"], ["Pad Work", "Cardio"]
  ];

  LX.MUSCLE_GROUPS = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Calves", "Core", "Cardio"];

  LX.MEASUREMENT_SITES = [
    "Neck", "Shoulders", "Chest", "Waist", "Hips",
    "Left Biceps", "Right Biceps", "Left Forearm", "Right Forearm",
    "Left Thigh", "Right Thigh", "Left Calf", "Right Calf", "Body Fat %"
  ];

  /* A short list of foods so logging a normal day takes seconds.

       unit    how you measure this food — and the unit the quantity is typed in
       size    the amount the values below describe (100 g, 1 piece, 1 scoop)
       serve   one normal helping. Tapping a food adds this much, and tapping it
               again adds it again, so three taps on Egg gives you 3 eggs.
       custom  true for foods that vary far too much to estimate. The name and
               the unit are filled in and you type the values yourself.
       as      the name written into the entry, when the list needs a longer
               label than the food should be saved under.

     kcal / p / c / f / fib are per `size`, and everything is scaled from there. */
  LX.COMMON_FOODS = [
    { name: "Egg (whole)",        unit: "piece", size: 1,   serve: 1,   kcal: 78,  p: 6.3,  c: 0.6, f: 5.3, fib: 0 },
    { name: "Chicken breast",     unit: "g",     size: 100, serve: 100, kcal: 165, p: 31,   c: 0,   f: 3.6, fib: 0 },
    { name: "Cooked rice",        unit: "g",     size: 100, serve: 150, kcal: 130, p: 2.7,  c: 28,  f: 0.3, fib: 0.4 },
    { name: "Curd / yoghurt",     unit: "g",     size: 100, serve: 100, kcal: 61,  p: 3.5,  c: 4.7, f: 3.3, fib: 0 },
    { name: "Milk (full fat)",    unit: "ml",    size: 100, serve: 200, kcal: 61,  p: 3.2,  c: 4.8, f: 3.3, fib: 0 },
    { name: "Sugar",              unit: "g",     size: 100, serve: 5,   kcal: 387, p: 0,    c: 100, f: 0,   fib: 0 },
    { name: "Dates",              unit: "piece", size: 1,   serve: 2,   kcal: 66,  p: 0.4,  c: 18,  f: 0.1, fib: 1.6 },
    { name: "Oats (dry)",         unit: "g",     size: 100, serve: 40,  kcal: 389, p: 17,   c: 66,  f: 7,   fib: 10.6 },
    { name: "Banana",             unit: "piece", size: 1,   serve: 1,   kcal: 105, p: 1.3,  c: 27,  f: 0.4, fib: 3.1 },
    { name: "Curry (enter your own)", as: "Curry", unit: "g", size: 100, serve: 150, custom: true, kcal: 0, p: 0, c: 0, f: 0, fib: 0 },
    { name: "Fruit (enter your own)", as: "Fruit", unit: "piece", size: 1, serve: 1, custom: true, kcal: 0, p: 0, c: 0, f: 0, fib: 0 },
    { name: "Chapati",            unit: "piece", size: 1,   serve: 2,   kcal: 104, p: 3,    c: 18,  f: 2.5, fib: 2.6 },
    { name: "Dal (cooked)",       unit: "g",     size: 100, serve: 150, kcal: 116, p: 7.6,  c: 20,  f: 0.4, fib: 7.9 },
    { name: "Paneer",             unit: "g",     size: 100, serve: 50,  kcal: 296, p: 20,   c: 3.4, f: 22,  fib: 0 },
    { name: "Fish (rohu)",        unit: "g",     size: 100, serve: 100, kcal: 97,  p: 17,   c: 0,   f: 3,   fib: 0 },
    { name: "Mutton curry",       unit: "g",     size: 100, serve: 150, kcal: 210, p: 18,   c: 3,   f: 14,  fib: 0.4 },
    { name: "Egg white",          unit: "piece", size: 1,   serve: 1,   kcal: 17,  p: 3.6,  c: 0.2, f: 0.1, fib: 0 },
    { name: "Idli",               unit: "piece", size: 1,   serve: 2,   kcal: 58,  p: 2,    c: 12,  f: 0.4, fib: 0.8 },
    { name: "Dosa",               unit: "piece", size: 1,   serve: 1,   kcal: 133, p: 2.7,  c: 22,  f: 3.7, fib: 1 },
    { name: "Whey protein scoop", unit: "scoop", size: 1,   serve: 1,   kcal: 120, p: 24,   c: 3,   f: 1.5, fib: 0 },
    { name: "Ghee",               unit: "g",     size: 100, serve: 5,   kcal: 900, p: 0,    c: 0,   f: 100, fib: 0 },
    { name: "Apple",              unit: "piece", size: 1,   serve: 1,   kcal: 95,  p: 0.5,  c: 25,  f: 0.3, fib: 4.4 },
    { name: "Almonds",            unit: "g",     size: 100, serve: 20,  kcal: 579, p: 21,   c: 22,  f: 50,  fib: 12.5 },
    { name: "Peanut butter",      unit: "g",     size: 100, serve: 15,  kcal: 588, p: 25,   c: 20,  f: 50,  fib: 6 },
    { name: "Mixed vegetables",   unit: "g",     size: 100, serve: 100, kcal: 65,  p: 2.6,  c: 13,  f: 0.5, fib: 4 }
  ];

  LX.DEFAULT_GOALS = [
    { key: "sleep_minutes",        name: "Sleep",              target: 450,  unit: "min/day" },
    { key: "exercise_minutes",     name: "Exercise",           target: 60,   unit: "min/day" },
    { key: "protein_g",            name: "Protein",            target: 140,  unit: "g/day" },
    { key: "calories_kcal",        name: "Calories",           target: 2200, unit: "kcal/day" },
    { key: "productive_minutes",   name: "Productive time",    target: 420,  unit: "min/day" },
    { key: "entertainment_limit",  name: "Entertainment limit",target: 90,   unit: "min/day" },
    { key: "workouts_per_week",    name: "Workouts",           target: 4,    unit: "per week" },
    { key: "body_weight",          name: "Body weight",        target: 78,   unit: "kg" }
  ];
})(window.LX);

/* ---------------------------------------------------------------------------
   Strength & performance tests — standardised efforts you repeat and compare.
   These are separate from normal workouts: a test result is never written into
   workout history, and a workout never appears here.
--------------------------------------------------------------------------- */
(function (LX) {
  "use strict";

  /* Each type says what a result holds and which direction counts as better. */
  LX.TEST_TYPES = {
    rounds:        { name: "Rounds (AMRAP)",  better: "higher", fields: ["rounds", "extra_reps"], hint: "Rounds completed in a fixed time" },
    reps:          { name: "Reps",            better: "higher", fields: ["actual_reps"],          hint: "How many reps in one effort" },
    time:          { name: "Time",            better: "higher_time_hold", fields: ["time_seconds"], hint: "A hold — longer is better" },
    reps_time:     { name: "Reps + time",     better: "lower",  fields: ["actual_reps", "time_seconds"], hint: "A target number of reps, as fast as possible" },
    distance_time: { name: "Distance + time", better: "lower",  fields: ["distance_km", "time_seconds"], hint: "A set distance, as fast as possible" }
  };

  LX.SEED_TESTS = [
    { slug: "cindy",    name: "Cindy",    type: "rounds",        target: null, unit: "rounds", duration_minutes: 20,
      notes: "20 minute AMRAP: 5 pull-ups, 10 push-ups, 15 air squats" },
    { slug: "pushups",  name: "Push-ups", type: "reps_time",     target: 100,  unit: "reps",   duration_minutes: null, notes: "" },
    { slug: "pullups",  name: "Pull-ups", type: "reps_time",     target: 50,   unit: "reps",   duration_minutes: null, notes: "" },
    { slug: "dips",     name: "Dips",     type: "reps_time",     target: 50,   unit: "reps",   duration_minutes: null, notes: "" },
    { slug: "run",      name: "Running",  type: "distance_time", target: 2,    unit: "km",     duration_minutes: null, notes: "" }
  ];

  LX.RUN_DISTANCES = [1, 2, 3, 5, 10];
})(window.LX);

/* ---------------------------------------------------------------------------
   Weekly goals — skills and habits you want to attempt every week, like ten
   minutes of handstand practice. Separate again from both workouts and
   performance tests: ticking one off never writes a workout or a test result.
--------------------------------------------------------------------------- */
(function (LX) {
  "use strict";

  /* Each type says what one attempt is measured in. `unit` is the wording used
     everywhere; `custom` lets you write your own. */
  LX.WEEKLY_GOAL_TYPES = {
    duration: { name: "Duration", unit: "minutes",  hint: "Practise for at least this many minutes" },
    reps:     { name: "Reps",     unit: "reps",     hint: "Do at least this many reps in one go" },
    sessions: { name: "Sessions", unit: "sessions", hint: "Turning up is the whole target — nothing to measure" },
    custom:   { name: "Custom",   unit: "",         hint: "Your own number, in your own unit" }
  };

  LX.SEED_WEEKLY_GOALS = [
    { slug: "one-arm-pushup", name: "One-arm push-up practice", target_type: "duration",
      target_value: 10, target_unit: "minutes", times_per_week: 1, notes: "" },
    { slug: "handstand", name: "Handstand practice", target_type: "duration",
      target_value: 10, target_unit: "minutes", times_per_week: 1, notes: "" }
  ];
})(window.LX);

/* ---------------------------------------------------------------------------
   Tasks, themes, Home layout and sleep shortcuts.
--------------------------------------------------------------------------- */
(function (LX) {
  "use strict";

  /* Three levels on purpose: five-level scales stop getting used. */
  LX.TASK_URGENCY = {
    high:   { name: "High",   rank: 0, color: "--danger" },
    medium: { name: "Medium", rank: 1, color: "--warn" },
    low:    { name: "Low",    rank: 2, color: "--ink-4" }
  };

  /* A repeating task is done once, kept as a finished task, and the next one
     is created with the next date — so every completion stays in the record. */
  LX.TASK_REPEAT = {
    none:     "Does not repeat",
    daily:    "Every day",
    weekdays: "Every weekday (Mon–Fri)",
    weekly:   "Every week",
    monthly:  "Every month"
  };

  /* Each theme recolours the whole app. `preview` is what the picker shows:
     main colour, gradient colour, then three of its category colours. */
  LX.THEMES = [
    { key: "teal", name: "Teal", swatch: "#16665A", preview: ["#16665A", "#2BA58A", "#1F6FB2", "#E4572E", "#4B4FD1"] },
    { key: "ocean", name: "Ocean", swatch: "#1D5FD1", preview: ["#1D5FD1", "#12A4C9", "#22B490", "#2267B4", "#5022B4"] },
    { key: "sunset", name: "Sunset", swatch: "#D4460F", preview: ["#D4460F", "#F2A20C", "#BA1C78", "#BA221C", "#BA861C"] },
    { key: "violet", name: "Violet", swatch: "#6D3FD1", preview: ["#6D3FD1", "#D6336C", "#223FB4", "#7622B4", "#B42281"] },
    { key: "mono", name: "Mono", swatch: "#111111", preview: ["#111111", "#6B6B6B", "#1F1F1F", "#565656", "#8D8D8D"] }
  ];

  /* Everything Home can show, in its default order. Each can be switched off
     or moved under Settings → Home screen. */
  LX.HOME_CARDS = [
    { key: "quick",    name: "Quick actions",         hint: "Log activity, food, workout, sleep, or start a timer" },
    { key: "stats",    name: "Today at a glance",     hint: "Sleep, exercise, calories and protein — tap one to log it" },
    { key: "tasks",    name: "Today's tasks",         hint: "Tick tasks off, or add one in a line" },
    { key: "checkin",  name: "Mood & energy",         hint: "Two taps to record how today feels" },
    { key: "weekly",   name: "Weekly goals",          hint: "What is still pending this week" },
    { key: "day",      name: "Where the day went",    hint: "The 24-hour ribbon and time by category" },
    { key: "logged",   name: "Logged today",          hint: "Every activity and workout recorded today" },
    { key: "strength", name: "Strength & performance", hint: "Your tests and personal bests" },
    { key: "review",   name: "Daily review",          hint: "The button to write today's reflection" }
  ];

  /* Long durations for the Sleep category, instead of 15 minutes to 2 hours. */
  LX.SLEEP_PRESETS = [360, 390, 420, 450, 480];
})(window.LX);
