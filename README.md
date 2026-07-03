# CREW of ONE

A co-op kaiju brawler for your browser. 2–8 friends join a room with a
4-letter code and jointly pilot **ONE huge, slow, heavy mech** — someone is
the LEGS, someone is the ARMS, someone is the HEAD with the eye laser that
roots the whole mech for 3 seconds while it charges. Goofy giant crabs and an
enormous furious pigeon attack a pastel low-poly city. Coordination is the
game; failing at it is the comedy.

**Modes:** Kaiju Brawl (waves + credits + upgrade shop) · Mech Duel (crew vs
crew) · Training Course (learn the mech without being eaten)

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
