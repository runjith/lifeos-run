# Deploying LifeOS

Two things live in two different places, and they never interfere with each other:

- **The app** — these files, hosted on GitHub Pages. Replacing them is safe.
- **Your data** — in your browser, and in Supabase if you signed in. Deploying a
  new version of the app never touches it.

---

## 1. Put it on GitHub Pages (once)

1. Create a repository at https://github.com/new — call it `lifeos`, public,
   don't add a README.
2. Upload this folder: on the new repo's page choose **uploading an existing
   file**, drag everything in (keep the `css`, `js`, `supabase` folders intact),
   and commit.
3. Open **Settings → Pages**. Under *Build and deployment* set Source to
   **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
4. Wait about a minute. Your app is at
   `https://<your-username>.github.io/lifeos/`.
5. Open that link in Safari on your iPhone → Share → **Add to Home Screen**.

The app uses only relative paths, so the `/lifeos/` subfolder works with no
changes.

### About the repository being public

Free GitHub Pages needs a public repo, which means anyone can read your code —
including `js/config.js` with your Supabase URL and **anon** key. That is fine
and intended: the anon key is designed to be public, and Row Level Security in
`supabase/schema.sql` is what actually protects your rows. Two rules:

- Never put the Supabase **service_role** key anywhere in this project.
- Make sure you ran the whole of `supabase/schema.sql`, so RLS is on.

Your health data itself is never in the repository — only the app that reads it.

If you would rather keep the code private, Cloudflare Pages and Netlify both
host private repos for free. Everything below works the same way there.

---

## 2. Connect Supabase (once, optional)

Only needed if you want the same data on more than one device.

1. Create a project at https://supabase.com.
2. **SQL Editor → New query** → paste all of `supabase/schema.sql` → Run.
   Safe to run again later; it only creates what is missing.
3. **Project Settings → API** → copy *Project URL* and the *anon / publishable*
   key into `js/config.js`.
4. Commit and push. In the app: **More → Sign in or create an account**.

Before the very first sign-in on a device that already has data, take a backup:
**More → Data & backup → Download full backup**. Signing in never deletes
anything, but ten seconds of insurance costs nothing.

A free Supabase project pauses after about a week with no traffic. If sync
suddenly fails, open the Supabase dashboard and click Resume.

---

## 3. Publishing an update

Every time you change the app:

```
python3 bump.py        # 1.1.0 -> 1.1.1
```

Then commit and push (or drag the changed files into GitHub's web editor).
Pages redeploys in about a minute.

**Do not skip the bump.** Browsers keep serving the cached copy of LifeOS until
the cache name changes, and `bump.py` is what changes it. It updates
`version.txt`, the version shown in **More → About**, and the cache name in
`sw.js`.

To check an update actually landed: open the app, go to **More → About**, and
look at the version. On iPhone, if it still shows the old one, close the app
from the app switcher and reopen it.

`python3 build.py` is separate and optional — it writes `dist/lifeos.html`, the
whole app squeezed into one file you can email to yourself. Hosting does not
need it.

---

## 4. Changing it later, with Claude

The project is deliberately small and plain: no build step, no framework, 22
files that each do one thing, with `README.md` explaining the architecture.

A future session looks like this:

1. Download the repo (**Code → Download ZIP**) or give Claude the GitHub link.
2. Upload it along with `README.md` and this file, and say what you want:
   fix a bug, change a screen, add a small feature.
3. Get the changed files back, drop them into the repo, run `python3 bump.py`,
   commit.

Worth saying in that conversation: *don't rewrite what already works, keep the
existing UI, and don't change the database schema unless the feature needs it*.
That keeps changes small enough to review.

**Your cloud data is unaffected by any of this.** Adding a new *table* would need
a matching `create table` in Supabase (and a version bump in `js/db.js`), which
adds storage without touching what is already there. Existing tables are only at
risk if someone deliberately drops them.

Tests live outside the app folder (`test.js`, `test-cloud.js`, `test-upgrade.js`,
`test-file.js`). They boot the whole app in Node and check it — worth running,
or asking Claude to run, after any substantial change.

---

## 5. If something goes wrong

| What you see | What to do |
|---|---|
| Update doesn't appear | You skipped `bump.py`; bump, push, then close and reopen the app |
| Blank page on the Pages URL | Check Settings → Pages says branch `main`, folder `/ (root)`; confirm `index.html` is at the top level of the repo |
| Sync fails, everything else fine | Supabase project paused — open the dashboard and Resume |
| "permission denied" when syncing | `supabase/schema.sql` didn't finish; run it again |
| Stuck on "LifeOS opening…" | You opened the file from disk rather than the hosted link. It now falls back to browser storage, but use the hosted URL for the real thing |
| You want to start over on a device | More → Data & backup → export first, then Delete all local data. Your cloud copy stays |
