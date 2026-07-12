# AGENTS.md — Crew of One Codex Instructions

These instructions apply to the whole repository.

## Project safety
- Preserve the existing working multiplayer flow: room codes, no-account joining, WebSocket state sync, role assignment/merge, invite links, and browser deployment path.
- Do not push directly to `main`. Work on feature branches and open pull requests.
- Preserve the existing Render/GitHub deployment setup unless the user explicitly asks to change hosting.
- Do not hardcode secrets, API keys, passwords, tokens, or private Render/GitHub values in code or docs.
- Do not add copyrighted names, logos, assets, characters, music, or protected IP. Use original mech/kaiju designs and generated/code-based assets only.

## Before changing gameplay
- Inspect the repo and identify where the relevant mode, client UI, server game logic, networking, and shared constants live.
- Prefer small, reversible milestones over large rewrites.
- Avoid changes that risk breaking existing live multiplayer unless covered by tests or clearly isolated.

## Required checks before PR
- Run `npm test` before opening a PR.
- If a runnable client/web change is perceptible, also run a build/start smoke check where practical and capture a screenshot when the environment supports it.
- If a check cannot run due to environment limits, explain that plainly in the PR/final notes.

## Documentation duties
- Document meaningful changes in `PROGRESS.md`.
- Update `PLAYTEST.md` when player-facing controls, modes, deployment steps, known quirks, or playtest guidance changes.
- Explain any manual Render/deployment steps in simple, non-developer language.
- If Render is already connected to GitHub, assume merging the PR to the linked deploy branch triggers deployment unless repo evidence says otherwise.

## V2 additions (claude/v2-visual-mech-rebuild-wu5u5g)
- The customization catalog and ALL gameplay stat derivation live in
  `shared/loadout.js`; never let a client send stats. Server-side session
  rules live in `server/loadout.js` (ownership/proposals/votes/locks).
- Visible model changes belong in the fab modules (`mechfab.js`,
  `monsterfab.js`, `cityfab.js`) — no raw primitives on gameplay models;
  use the plate/lathe/vent/hide helpers and merge via the Kit buckets.
- Keep `npm test` green (includes the 35-check Playwright gate) and
  refresh `npm run visual` when the look changes. Update PROGRESS.md's
  honesty ledger — never mark unreviewed work as verified.
