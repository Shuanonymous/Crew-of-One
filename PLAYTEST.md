# Crew of One — Playtest Guide

Plain language, no jargon. This is everything you need to put the game in
front of friends.

## 1. The game is LIVE

**https://crew-of-one.onrender.com** — send that link to anyone.

It runs on Render's free tier under your account, deployed from this
repository's `claude/crew-of-one-game-uv7dmi` branch. Every push to that
branch redeploys automatically.

Notes about the free tier:
- After ~15 minutes with nobody playing, the server naps. The first person to
  open the link waits ~30–60 seconds while it wakes up. Fine for game nights.
- It comfortably handles a few dozen simultaneous players (several rooms).
- Every time this repository's main branch is updated, Render redeploys
  automatically.

(Want to move hosts later? The repo also contains `railway.json`, `fly.toml`
and a `Dockerfile` — connect the repo on either platform and it deploys the
same way.)

## 2. How a game night works

1. One person opens **https://crew-of-one.onrender.com**, types a name,
   clicks **CREATE ROOM**.
2. They click **COPY INVITE LINK** and paste it in the group chat
   (or friends type the 4-letter code on the title screen).
3. Everyone appears in the lobby. The host picks a mode and hits **START**.
4. Each player gets a giant banner: **YOU ARE THE LEGS** (or arms, or head).
   The controls are written on the banner and on the click-to-start card.
5. Play. Yell. Lose. Click **ONE MORE RUN** — roles shuffle every round.

**Best first session:** run TRAINING once (teaches everyone their job in ~2
minutes), then KAIJU BRAWL. Try MECH DUEL when you have 4+ people.

## 3. What everyone's job actually is

- **THE LEGS** — WASD walks (relative to *your* camera), SPACE kicks. The kick
  is huge but you're on one leg — mid-kick the mech balances like a shopping
  cart. Don't kick while the head is charging the laser. You will anyway.
- **THE ARMS** — mouse aims, left/right click = left/right fist (J/K also
  work). Punches wind up for half a second, so swing *before* the crab is in
  your face. Punches go where YOUR camera looks — but the body faces where the
  HEAD looks, so talk to each other.
- **THE HEAD** — you steer the mech's facing with your mouse and you own the
  eye laser: hold the button, the whole mech stops for 3 seconds, then ZAP.
  Charging at the wrong moment is the single funniest thing in the game.

## 4. Know your enemy (new roster)

- **SCUTTLERS** — fast little packs. If your crew is slow, they will humble you.
- **LOOGIE LOUIE** — lobs glowing globs from across the plaza and waddles away
  if you approach. Sidestep the glob (it aims where you WERE), then laser him.
- **SIR CLANKSALOT** — armored tank. Punches bounce off (25% damage). This is
  what the laser is for.
- **DIVE-BOMB DAVE** — circles overhead, screeches, then dives at where you're
  standing. Move. Or punch him out of the air mid-dive if you're brave.
- **GRABLINS** — dozens of tiny gremlins that climb the mech and chew.
  The LEGS player kicks to shake them ALL off at once.
- **BOSSES every 5th wave** — named, huge, health bar across the top.
  Watch for the long slam telegraph and get OUT of the ring.

The sky changes as you survive: sunset → dusk → neon night → dawn.

## 5. Things to try (comedy checklist)

- Kick a car into a crab.
- Kick a SCUTTLER mid-sprint and watch it clear a building.
- Buy ROCKET PUNCH and miss on purpose — the fist launches like a missile.
- Get hit by PIGEONZILLA's wing gust while charging the laser.
- Sweep the fully-charged laser across an entire scuttler pack.
- Two players sharing the legs in a 5+ crew: WASD tug-of-war.
- In the shop, let the person who never fights spend all the credits.

## 6. Known quirks (all intentional or acceptable for v1)

- Desktop keyboard + mouse only. Phones/tablets show the page but can't play.
- The free server naps when idle — first visitor wakes it (30–60 s).
- The camera can clip through buildings if you press it against a wall.
- Monsters occasionally shove each other around while pathing — they're crabs,
  they don't queue nicely.
- If everyone leaves a room, it evaporates (nothing is saved — by design,
  every run is self-contained).

## 7. If something breaks

- Refresh the page — you'll land on the title screen; rejoin with the room code.
- If the room is gone, make a new one (30 seconds).
- Server-side surgery: the game restarts cleanly on redeploy (Render:
  "Manual Deploy" button).
