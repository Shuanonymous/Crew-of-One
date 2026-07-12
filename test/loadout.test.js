// Server-authoritative loadout validation + collaborative session rules.
import {
  validateBuild, deriveStats, buildCost, DEFAULT_BUILD, DUEL_BUDGET, sanitizePaint,
} from '../shared/loadout.js';
import { LoadoutCrew } from '../server/loadout.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// ---------------- validateBuild ----------------
{
  const v = validateBuild(DEFAULT_BUILD);
  check('default build validates clean', v.ok === true);
}
{
  const v = validateBuild({ ...DEFAULT_BUILD, frame: 'nonsense', armL: 'alsofake' });
  check('unknown parts fall back to defaults', !v.ok && v.build.frame === 'warden' && v.build.armL === 'breaker');
}
{
  // vector legs need vanguard/warden; on bastion they must be rejected
  const v = validateBuild({ ...DEFAULT_BUILD, frame: 'bastion', legs: 'vector' });
  check('frame compatibility enforced', !v.ok && v.build.legs === 'strider', v.reason);
}
{
  const v = validateBuild({ ...DEFAULT_BUILD, paint: { primary: '#000000', secondary: 'red', accent: '#d8a03c' } });
  check('paint clamps unreadable / malformed colours',
    v.build.paint.primary !== '#000000' && /^#[0-9a-f]{6}$/i.test(v.build.paint.secondary));
}
{
  const v = validateBuild({ ...DEFAULT_BUILD, callsign: '<script>alert(1)</script>' });
  check('callsign sanitized', !v.build.callsign.includes('<'), v.build.callsign);
}
{
  const p = sanitizePaint({ finish: 99, weathering: -3 });
  check('paint sliders clamp to 0..1', p.finish === 1 && p.weathering === 0);
}

// ---------------- deriveStats ----------------
{
  const d = deriveStats(validateBuild({ ...DEFAULT_BUILD, frame: 'bastion', armorKit: 'siege' }).build);
  check('bastion + siege stacks armor DR', d.armorDR > 0.15, 'DR=' + d.armorDR.toFixed(2));
  check('heavy frame trades speed', d.speedMul < 1);
}
{
  const d = deriveStats(validateBuild({ ...DEFAULT_BUILD, armR: 'howler', shoulderL: 'hydra', legs: 'vector' }).build);
  check('equipment grants weapon systems', d.grants.cannon && d.grants.pods && d.grants.dash);
  check('cannon arm weakens that fist only', d.meleeMulR < 1 && d.meleeMulL === 1);
}
{
  const cost = buildCost(DEFAULT_BUILD);
  check('default build fits the duel budget', cost <= DUEL_BUDGET, `${cost}/${DUEL_BUDGET}`);
}

// ---------------- LoadoutCrew session rules ----------------
function fakeRoom(playerDefs) {
  const players = new Map();
  for (const p of playerDefs) players.set(p.id, { ...p, ws: { readyState: 1, OPEN: 1, send() {} } });
  return { players, hostId: playerDefs[0].id };
}

{
  // 2-player crew: p1 = LEGS (pilot), p2 = arms+head
  const room = fakeRoom([
    { id: 'p1', name: 'Pilot', nextRoles: ['LEGS'] },
    { id: 'p2', name: 'Gunner', nextRoles: ['ARM_L', 'ARM_R', 'HEAD'] },
  ]);
  const crew = new LoadoutCrew(room);

  // owner edits their own station directly
  let r = crew.handle('p2', { op: 'set', layer: 'armR', value: 'falchion' });
  check('station owner sets their layer directly', r.ok && crew.build.armR === 'falchion');

  // non-owner CANNOT overwrite someone else's station — becomes a proposal
  r = crew.handle('p2', { op: 'set', layer: 'legs', value: 'anchor' });
  check('non-owner set downgrades to proposal (no silent overwrite)',
    r.ok && crew.build.legs === 'strider' && crew.proposals.legs?.value === 'anchor');
  check('proposal carries the proposer name', crew.proposals.legs.byName === 'Gunner');

  // majority vote applies (2 votes of 2 players)
  crew.handle('p1', { op: 'vote', layer: 'legs', value: true });
  check('majority vote auto-applies', crew.build.legs === 'anchor' && !crew.proposals.legs);

  // locks
  crew.handle('p1', { op: 'lock', layer: 'legs' });
  r = crew.handle('p2', { op: 'propose', layer: 'legs', value: 'colossus' });
  check('locked layer rejects proposals', !r.ok && crew.build.legs === 'anchor');
  // note: p1 is also host here; host/locker can unlock
  crew.handle('p1', { op: 'unlock', layer: 'legs' });
  r = crew.handle('p2', { op: 'propose', layer: 'legs', value: 'colossus' });
  check('unlock reopens the layer', r.ok);

  // ready clears on any change
  crew.handle('p1', { op: 'ready', value: true });
  crew.handle('p2', { op: 'ready', value: true });
  check('ready set fills', crew.ready.size === 2);
  crew.handle('p1', { op: 'set', layer: 'legs', value: 'strider' });
  check('any build change re-opens the ready check', crew.ready.size === 0);

  // serialize shape
  const s = crew.serialize();
  check('serialized state carries owners map', s.owners.legs === 'p1' && s.owners.armL === 'p2');
}

{
  // host is the deadlock-breaker on shared layers
  const room = fakeRoom([
    { id: 'h', name: 'Host', nextRoles: ['LEGS'] },
    { id: 'g', name: 'Guest', nextRoles: ['ARM_L', 'ARM_R', 'HEAD'] },
  ]);
  const crew = new LoadoutCrew(room);
  const r = crew.handle('h', { op: 'set', layer: 'frame', value: 'bastion' });
  check('host resolves shared layers directly', r.ok && crew.build.frame === 'bastion');
  // frame change invalidates nothing here, but a dependent part would reset:
  crew.handle('h', { op: 'set', layer: 'legs', value: 'vector' });
  check('dependent part rejected against current frame', crew.build.legs !== 'vector');
}

console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
