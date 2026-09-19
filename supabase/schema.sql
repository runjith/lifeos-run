-- LifeOS — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- It creates every table the app syncs, plus Row Level Security so each account
-- can only ever read and write its own rows.
--
-- Notes on the design:
--   * Primary keys are UUIDs generated on the phone, so a record created offline
--     keeps the same id forever and syncing can never duplicate it.
--   * updated_at is set by the client and is what conflict resolution compares.
--   * Deletes are soft (deleted_at) so a deletion syncs like any other change.
--   * Times of day (bedtime, start_time) are stored as plain 'HH:MM' text to keep
--     them identical on every device regardless of time zone.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- -------------------------------------------------------------- categories
create table if not exists public.categories (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  slug        text not null,
  name        text not null,
  color       text,
  bucket      text not null default 'personal',
  sort        integer default 0,
  is_custom   integer default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- -------------------------------------------------------------- activities
create table if not exists public.activities (
  id               uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  date             date not null,
  category_id      uuid references public.categories(id) on delete set null,
  start_time       text,
  end_time         text,
  duration_minutes integer not null default 0,
  title            text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- --------------------------------------------------------------- exercises
create table if not exists public.exercises (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  muscle_group  text,
  is_custom     integer default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- ---------------------------------------------------------------- workouts
create table if not exists public.workouts (
  id               uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  date             date not null,
  type             text,
  duration_minutes integer default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create table if not exists public.workout_exercises (
  id           uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  workout_id   uuid not null references public.workouts(id) on delete cascade,
  exercise_id  uuid references public.exercises(id) on delete set null,
  name         text,
  position     integer default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create table if not exists public.workout_sets (
  id                    uuid primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  workout_exercise_id   uuid not null references public.workout_exercises(id) on delete cascade,
  workout_id            uuid references public.workouts(id) on delete cascade,
  exercise_id           uuid references public.exercises(id) on delete set null,
  date                  date,
  position              integer default 0,
  weight_kg             numeric,
  reps                  integer,
  duration_sec          integer,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

-- ------------------------------------------------------------ food entries
create table if not exists public.food_entries (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  meal        text,
  name        text not null,
  quantity    numeric default 1,
  unit        text,
  calories    numeric default 0,
  protein     numeric default 0,
  carbs       numeric default 0,
  fat         numeric default 0,
  fiber       numeric default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ----------------------------------------------------------------- sleep
create table if not exists public.sleep_records (
  id               uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  date             date not null,
  bedtime          text,
  wake_time        text,
  duration_minutes integer default 0,
  quality          integer,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- ---------------------------------------------------------------- weight
create table if not exists public.weight_records (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  weight      numeric not null,
  unit        text default 'kg',
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------- body measurements
create table if not exists public.body_measurements (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  name        text not null,
  value       numeric not null,
  unit        text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ----------------------------------------------------------------- goals
create table if not exists public.goals (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null,
  name        text,
  target      numeric,
  unit        text,
  active      integer default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- --------------------------------------------------------- daily reviews
create table if not exists public.daily_reviews (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  date        date not null,
  planned     text,
  completed   text,
  journal     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ------------------------------------- strength & performance tests
-- Configuration and results are kept apart, and each result stores the target
-- or distance it was done at, so changing a target later never rewrites history.
create table if not exists public.strength_tests (
  id               uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  slug             text,
  name             text not null,
  type             text not null,          -- rounds | reps | time | reps_time | distance_time
  target           numeric,
  unit             text,
  duration_minutes integer,
  notes            text,
  is_default       integer default 0,
  sort             integer default 0,
  archived         integer default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create table if not exists public.strength_results (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  test_id       uuid not null references public.strength_tests(id) on delete cascade,
  date          date not null,
  config_key    text,                      -- the series this result belongs to
  rounds        numeric,
  extra_reps    numeric,
  target_reps   numeric,
  actual_reps   numeric,
  time_seconds  numeric,
  distance_km   numeric,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- ------------------------------------------------------------- indexes
create index if not exists activities_user_date_idx        on public.activities (user_id, date);
create index if not exists activities_updated_idx          on public.activities (user_id, updated_at);
create index if not exists food_user_date_idx              on public.food_entries (user_id, date);
create index if not exists food_updated_idx                on public.food_entries (user_id, updated_at);
create index if not exists sleep_user_date_idx             on public.sleep_records (user_id, date);
create index if not exists weight_user_date_idx            on public.weight_records (user_id, date);
create index if not exists measurements_user_date_idx      on public.body_measurements (user_id, date, name);
create index if not exists workouts_user_date_idx          on public.workouts (user_id, date);
create index if not exists sets_user_exercise_idx          on public.workout_sets (user_id, exercise_id, date);
create index if not exists categories_updated_idx          on public.categories (user_id, updated_at);
create index if not exists exercises_updated_idx           on public.exercises (user_id, updated_at);
create index if not exists reviews_user_date_idx           on public.daily_reviews (user_id, date);
create index if not exists strength_results_series_idx    on public.strength_results (user_id, test_id, config_key, date);
create index if not exists strength_results_updated_idx   on public.strength_results (user_id, updated_at);
create index if not exists strength_tests_updated_idx     on public.strength_tests (user_id, updated_at);

-- --------------------------------------------------- row level security
-- Every table: you can only see and change rows where user_id is your own id.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','categories','activities','exercises','workouts','workout_exercises',
    'workout_sets','food_entries','sleep_records','weight_records','body_measurements',
    'goals','daily_reviews','strength_tests','strength_results'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('create policy "own rows select" on public.%I for select using (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('create policy "own rows update" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);

    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format('create policy "own rows delete" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- Optional: a profile row is created automatically for each new account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, user_id, name)
  values (new.id, new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
