# Crew of One V2 — Playtest & Deployment Guide

## Put the V2 PREVIEW online (plain English, ~5 minutes)

The V2 rebuild lives on the branch `claude/v2-visual-mech-rebuild-wu5u5g`.
Your current live game (V1, from `main`) is NOT touched by any of this.

**Option A — one-time blueprint sync (recommended):**
1. Log in at https://dashboard.render.com
2. Click **New +** → **Blueprint** → pick the `Crew-of-One` repository.
3. When asked for a branch, choose `claude/v2-visual-mech-rebuild-wu5u5g`.
4. Render reads `render.yaml` on that branch and offers two services:
   your existing `crew-of-one` (leave it alone) and a new
   **`crew-of-one-v2-preview`**. Apply.
5. In a minute you get a URL like
   `https://crew-of-one-v2-preview.onrender.com` — that's the preview.

**Option B — manual service:**
1. Render dashboard → **New +** → **Web Service** → pick the repo.
2. Branch: `claude/v2-visual-mech-rebuild-wu5u5g` · Runtime: Node ·
   Build: `npm ci` · Start: `node server/index.js` · Plan: Free.
3. Create. Done — the preview auto-redeploys whenever this branch updates.

**Promoting V2 to production (ONLY after you approve the preview):**
merge the V2 branch into `main` (open a PR from
`claude/v2-visual-mech-rebuild-wu5u5g` → `main` on GitHub and merge).
Your existing `crew-of-one` service auto-deploys from `main` as always.
To roll back at any time: `main` is untouched today, and the commit
`fc907ec` is the stable V1 (also tagged `v1-stable` locally).

## Game night (15-minute checklist)

1. One person opens the game and clicks **FORM A CREW**, then
   **COPY INVITE LINK** and pastes it in the group chat.
2. Everyone joins → you're all standing in **Hangar Bay 07**.
3. Build the mech together:
   - Each station (locomotion / arms / fire control) directly picks its
     own components; picks on someone else's station become **proposals**
     the crew votes on. The host can settle any argument.
   - Try PAINT → a curated scheme, and ID → a callsign.
   - Hit **READY** — the launch button shows when the whole crew is set.
4. Host picks a mode:
   - First night: **CLASSIC WAVE DEFENCE** (safe refits between waves).
   - Comfortable: **ENDLESS ESCALATION** (refit under fire with **B**).
   - Grudges: **MECH DUEL** (mirror machines — pure piloting).
   - New pilots: **TRAINING** (swap components live, learn every weapon).
5. In the refit shop, **hover an upgrade before buying** — it appears on
   the mech so you can see what you're paying for.
6. Controls are on the settings screen (**ESC**) — opening it pauses the
   whole room, so nobody dies while you argue about sensitivity.

## Controls

- **LOCOMOTION** — WASD walk · SPACE kick · F dash (thruster legs)
- **ARMS** — mouse aim · L/R click (or J/K) punch · hold R-click / C = rotary cannon
- **FIRE CONTROL** — mouse aim · hold click / E = charge beam · R = rockets
- **Everyone** — Q mark target · X danger ping · B refit (Endless) · ESC systems/pause

## Known quirks

- The preview URL sleeps on Render's free plan; first load takes ~30 s.
- Headless/older GPUs: drop Graphics Quality to LOW in settings.
- If a crewmate disconnects mid-run their stations merge into a
  remaining pilot automatically (you'll see the banner).
