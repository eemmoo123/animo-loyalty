# Animo — Digital Loyalty Card

A zero-cost "buy 5, get the 6th free" loyalty system: a customer PWA (the wallet
card) and a barista scanner (the till-side tool), backed by a free Supabase
Postgres project. No Apple Developer account, no paid hosting, no paid SaaS.

```
animo/
├── index.html, style.css, app.js, config.js   ← customer PWA (site root)
├── manifest.json, sw.js, icons/               ← "Add to Home Screen" support
├── barista/
│   ├── index.html, style.css, app.js          ← staff scanner (site /barista)
└── supabase/
    └── schema.sql                             ← entire backend, paste-and-run
```

---

## 1. System Architecture Overview

```
┌─────────────────┐        register_customer()        ┌──────────────────┐
│  Customer PWA    │ ─────────────────────────────────▶│                  │
│  (their phone)   │        get_customer_status()      │  Supabase        │
│                  │ ◀─────────────────────────────────│  Postgres        │
│  shows QR = their│                                    │  (free tier)     │
│  own UUID        │                                    │                  │
└─────────────────┘                                    │  RLS: locked     │
                                                          │  Only 3 RPC      │
┌─────────────────┐        add_stamp(id, pin)           │  functions are    │
│  Barista Scanner │ ─────────────────────────────────▶│  callable from    │
│  (shop tablet/   │        {ok, stamps, reward}         │  the client       │
│   phone camera)  │ ◀─────────────────────────────────│                  │
└─────────────────┘                                    └──────────────────┘
```

- **The customer never has an account.** On first visit, the PWA generates a
  random UUID via `register_customer()`, saves it in `localStorage`, and
  renders it as a QR code. That UUID *is* the loyalty card.
- **The barista scans the UUID and calls `add_stamp()`** with the shop's
  shared PIN. The database — not the browser — decides whether that's allowed.
- **Nothing reaches the database except through three named functions.**
  `customers`, `scan_log`, and `security_state` all have Row-Level Security
  enabled with *zero* policies, which means direct reads/writes from the
  public (anon) key are refused outright. The only door in is the three
  `SECURITY DEFINER` functions in `schema.sql`, and each one only does exactly
  what its name says.
- **State lives in one place.** The customer's card polls `get_customer_status`
  every few seconds while the tab is open, so it reflects a stamp added at the
  register within moments — no push infrastructure needed.

---

## 2. Barista Verification: Recommendation & the Riskiest Trade-off

The riskiest piece of this whole system isn't the UI — it's **how the server
decides a stamp request is legitimate**, since that's the one thing standing
between "free coffee loyalty program" and "free coffee generator." Two
approaches were on the table:

### Approach A — Rotating/time-limited QR (TOTP-style)
The customer's app regenerates a new signed code every 15–30 seconds
(like a 2FA app). The barista's scan is only valid for that short window,
so a screenshotted or shared QR code goes stale almost immediately.

- ✅ Strongest resistance to *screenshot sharing* ("here, use my QR, I'm not
  there") and to a code being read off a phone across the counter and reused.
- ❌ Needs the customer's device clock and a shared secret to stay in sync,
  usually via a signed/short-lived JWT — more moving parts, and it fails
  ungracefully offline (bad shop WiFi = a customer who can't get stamped).
- ❌ Meaningfully more code and more failure modes for a first version of a
  single-location shop's loyalty card.

### Approach B — Static per-customer ID + server-side PIN & rate limiting *(chosen)*
The QR encodes a fixed, unguessable UUID (122 bits of entropy — not
brute-forceable). Legitimacy is instead enforced entirely server-side:

- A **staff PIN**, hashed with bcrypt, is required on every single stamp call
  — not just to "unlock" the scanner UI, but re-checked by Postgres on
  *every* request, with a 5-strikes-then-5-minute lockout.
- A **20-second per-customer cooldown**, enforced in the same SQL function,
  makes rapid re-scanning of one QR (double-tap, or a customer trying to
  scan twice in one visit) a no-op instead of two stamps.
- The PIN never has a client-side "correct answer" to extract — the scanner
  page stores whatever the barista types and lets the *server* be the judge,
  so there's nothing meaningful to read out of the page source.

**Verdict: Approach B.** For a single-counter specialty shop, the realistic
threat isn't a customer cryptographically forging a code — it's a customer
double-tapping, sharing a screenshot, or a curious person guessing PINs. All
three are fully covered by a hashed PIN + lockout + cooldown, with none of
Approach A's offline-fragility or added complexity. If Animo later adds
self-serve kiosks or unattended scanning, revisit toward Approach A — the
`add_stamp` function's PIN check could be swapped for a signed-token check
without touching the schema.

**Frictionless-by-design specifics:**
- Barista taps "Unlock," types the PIN *once* per shift/tab (kept only in
  `sessionStorage`, gone when the tab closes) — not once per customer.
- Scanning itself is a single motion: point the camera, the result toast
  appears, done. No manual "confirm" tap needed for the common case.
- A wrong or locked-out PIN immediately forces re-entry, so a bad PIN can't
  silently keep failing in the background.

---

## 3. Step-by-Step Deployment Guide (zero code required)

### Step 1 — Create the free database (Supabase)
1. Go to **supabase.com** → sign up (free) → **New project**.
2. Pick any name/region, set a database password (save it somewhere), wait
   ~2 minutes for it to provision.
3. In the left sidebar, open **SQL Editor** → **New query**.
4. Open `supabase/schema.sql` from this project, copy the *entire file*,
   paste it into the editor, and click **Run**. You should see "Success."
5. Still in SQL Editor, run one more line with your own PIN:
   ```sql
   select set_barista_pin('4471');
   ```
   (Use any 4+ digit PIN you like — this is what staff will type.)
6. Go to **Project Settings → API**. Copy the **Project URL** and the
   **anon public** key — you'll need both next.

### Step 2 — Drop your keys into the code
1. Open `config.js` in this project.
2. Replace `YOUR-PROJECT-REF.supabase.co` and `YOUR-ANON-PUBLIC-KEY` with the
   two values from Step 1.6. Save.
   *(This is the only file you need to edit.)*

### Step 3 — Put the code on GitHub (so Vercel can find it)
1. Go to **github.com** → **New repository** → name it `animo-loyalty` →
   Create.
2. On the new repo page, use **"uploading an existing file"** and drag in
   this entire `animo` folder's contents (keep the folder structure —
   `barista/` and `supabase/` should stay as subfolders).
3. Commit.

### Step 4 — Deploy for free (Vercel)
1. Go to **vercel.com** → sign up with your GitHub account (free).
2. **Add New → Project** → select your `animo-loyalty` repo → **Import**.
3. Framework preset: choose **"Other"** (this is a plain static site, no
   build step needed). Leave build/output settings blank. Click **Deploy**.
4. In ~30 seconds you'll get a live URL like `animo-loyalty.vercel.app`.

You're live:
- `https://animo-loyalty.vercel.app/` → customer card
- `https://animo-loyalty.vercel.app/barista/` → staff scanner

### Step 5 — Put it in customers' and staff's hands
- **Customers:** open the site link on their phone → Safari/Chrome share
  menu → **Add to Home Screen**. It now opens full-screen, like an app.
- **Staff:** open `/barista/` on the shop's phone/tablet, add it to the home
  screen the same way, enter the PIN once per shift.

### Step 6 — Optional: a real domain
Buy a domain (the one paid item, entirely optional — many registrars run
~$10–12/yr) and add it under Vercel → your project → **Settings → Domains**.
Without this, the free `.vercel.app` URL works exactly the same.

### Changing the PIN later
Re-run this in Supabase's SQL Editor any time:
```sql
select set_barista_pin('new-pin-here');
```

---

## 4. Notes on the free tiers (so nothing surprises you)
- **Supabase free tier:** 500MB database, 5GB bandwidth/mo, projects pause
  after 1 week of total inactivity (any visit wakes it back up in seconds).
  Fine for a single-location shop's loyalty data indefinitely.
- **Vercel free (Hobby) tier:** generous bandwidth for a static site like
  this one; intended for exactly this kind of small project.
- **No Apple/Google developer account needed** — this is a PWA, not a native
  App/Play Store app, so there's no $99/yr fee and no app review process.
