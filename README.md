# CREW of ONE

**PLAY IT: https://crew-of-one.onrender.com**

A cinematic co-op kaiju brawler for your browser. 2–8 friends join a room with a
4-letter code and jointly pilot **ONE huge, heavy mech** — someone drives
the legs, someone controls the arms, and someone aims the head-mounted beam.
Original monsters attack a neon city while the crew coordinates movement,
melee, rockets, cannon fire, and laser timing.

**Modes:** Classic Wave Mode (waves + safe between-wave upgrade shop) · Endless Escalation (danger clock + field supply beacons) · Mech Duel (crew vs crew) · Training Course (learn the mech without being eaten)

## Run it

```
npm install
npm start        # open http://localhost:3000
npm test         # game-logic + websocket test suites
```

No accounts, no database, no build step. One Node service serves the files
and the websockets.

## Deploy it (free)

The repo is deploy-ready for Render (`render.yaml` — recommended), Railway
(`railway.json`), Fly.io (`fly.toml`), or any container host (`Dockerfile`).
Click-by-click instructions: see **PLAYTEST.md**.

## Docs

- **PLAYTEST.md** — plain-language guide: putting it online + running a game night
- **PROGRESS.md** — everything built, every design decision, testing evidence
