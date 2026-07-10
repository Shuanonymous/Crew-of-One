# Crew of One — Playtest Guide (15-minute checklist)

**Live:** https://crew-of-one.onrender.com — send that link to friends.

Plain language. This walks you through all four modes in ~15 minutes.
The free server naps when idle; the first visitor waits ~30–60 s while it
wakes.

## Setup (1 min)
1. Open the link, type a pilot name, click **CREATE ROOM**.
2. Click **COPY INVITE LINK**, paste it to your crew (or they type the
   4-letter code). You can also solo-test: one person can pilot the whole
   mech.
3. The host picks a mode and clicks **START**. Everyone gets a giant
   "YOU ARE THE …" banner with their controls.

## Controls recap
- **LEGS:** WASD move, SPACE kick, F dash (if bought).
- **ARMS:** mouse aim, L/R click punch (J/K backup), hold right-click / C
  spins the rotary cannon (if bought).
- **HEAD:** mouse aims the mech's face + eye laser (hold click / E),
  tap R to fire rocket pods (if bought).
- **Anyone:** Q pings a target, X pings danger, B opens upgrades
  (Endless), Esc or the ⚙ gear opens settings (pauses the run).

## 1) TRAINING (2 min) — learn the mech
Pick **TRAINING**, START. Walk the three rings (LEGS), punch the two
dummies (ARMS), kick over the crate tower, pop the balloon with the laser
(HEAD). Good for teaching everyone their job with nothing biting back.

## 2) CLASSIC WAVE MODE (4 min) — the friendly fight
Back to lobby (host: BACK TO LOBBY on the summary, or LEAVE + recreate),
pick **CLASSIC WAVE MODE**, START.
- Fight the wave. When it clears, the **safe shop** opens automatically.
- **Click an upgrade** — credits drop and the stat applies immediately
  (watch the credit counter pulse). Buy a repair and some FIST SERVOS.
- Host clicks **READY FOR NEXT WAVE**. Repeat. This is the relaxed mode.

## 3) ENDLESS ESCALATION (4 min) — the pressure cooker
Lobby → **ENDLESS ESCALATION** → START.
- The **danger clock** (top-left) never stops rising. There are **no
  supply beacons** — press **B** or click **UPGRADES** anytime to open the
  shop as an overlay **while the fight continues behind it**. Buying under
  pressure is the point.
- Try the ranged rares if you can afford them: **ROTARY CANNON** (hold
  right-click to spin up, then tracer-hose a pack) and **ROCKET PODS**
  (tap R for homing missiles).
- Use the world: punch/laser an orange **fuel tank** near a crowd for a
  big AoE; stand in a green **repair station** to heal (monsters wreck
  them); smash **credit caches**.
- **Wreck the city**: buildings are destructible. Punch or kick a small
  one a couple of times, rocket a tower, or hold the laser on a facade —
  it crumbles into a rubble mound with dust and a shockwave. Bosses and
  armored tanks bulldoze straight through blocks to reach you.
- Named bosses arrive at danger milestones with a health bar. When the
  mech dies, the **run summary** shows time survived, the map seed, and
  per-pilot damage. Beat the room's best time.

## 4) MECH DUEL (2 min) — crew vs crew
Needs 2+ players. Lobby → **MECH DUEL** → START. Two crews, two mechs,
one plaza, same weapons. Last mech standing wins.

## 5) Settings + pause (1 min) — test the co-op pause
Mid-run, one player presses **Esc** (or the ⚙ gear). The whole room
freezes with a **"PAUSED BY <name>"** banner. Adjust master/music/SFX
volume, camera sensitivity, screen shake, or graphics quality (drop to
**Low** if anything stutters). Close settings — the room resumes for
everyone. Anyone can resume, not just the host.

## What to look for / report back
- Does clicking an upgrade always register and deduct credits? (This was
  the big bug — it's now covered by an automated browser test.)
- Does the mech feel weighty but responsive?
- Are the ranged weapons worth their price?
- Frame rate: if it stutters on a weak laptop, Settings → Graphics → Low.
- Anything that reads as "toy/goofy" rather than "cinematic mech film"?
  (The art is an ongoing cinematic pass — see PROGRESS.md "next
  milestones" for what's still coming: districts, minimap, texture-mapped
  PBR, motion blur.)

## If something breaks
Refresh the page (you land on the title screen; rejoin with the room
code). If the room is gone, make a new one. Support/Discord links are on
the title screen (placeholder URLs to fill in).
