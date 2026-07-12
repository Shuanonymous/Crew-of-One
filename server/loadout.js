import {
  LAYERS, LAYER_OWNER, DEFAULT_BUILD, PAINT_PRESETS,
  validateBuild, sanitizePaint, findPart, DECALS,
} from '../shared/loadout.js';

// Collaborative pre-run mech customization — server-authoritative.
//
// Rules (griefing-proof by construction):
//  - every layer has an OWNER role (see shared/loadout.js). The player who
//    will pilot that role edits it directly; nobody else can overwrite it.
//  - non-owners (and everyone, for SHARED layers) file PROPOSALS. A proposal
//    carries the proposer's name, collects votes, and auto-applies on a
//    strict majority. The owner (or host) can accept or dismiss it directly.
//  - a locked layer rejects all changes until its locker (or host) unlocks.
//  - the host is the deadlock-breaker: host set/accept always lands.
//  - the build starts as a sensible default, so a crew can just hit LAUNCH.

export class LoadoutCrew {
  constructor(room) {
    this.room = room;
    this.build = structuredClone(DEFAULT_BUILD);
    this.locks = {};        // layer -> playerId
    this.proposals = {};    // layer -> { value, by, byName, votes: [playerId] }
    this.ready = new Set(); // playerIds that clicked READY
    this.rev = 0;
  }

  // ---- ownership -----------------------------------------------------
  ownerOf(layer) {
    const role = LAYER_OWNER[layer];
    if (!role || role === 'SHARED') return null;
    for (const p of this.room.players.values()) {
      if ((p.nextRoles || []).includes(role)) return p.id;
    }
    return null;
  }

  canEdit(playerId, layer) {
    if (playerId === this.room.hostId) return true;              // host resolves
    const owner = this.ownerOf(layer);
    if (owner) return owner === playerId;
    return this.room.players.size === 1;                          // solo owns all
  }

  isLockedAgainst(playerId, layer) {
    const locker = this.locks[layer];
    return locker && locker !== playerId && playerId !== this.room.hostId;
  }

  // ---- value application ----------------------------------------------
  applyValue(layer, value) {
    const draft = structuredClone(this.build);
    if (layer === 'paint') draft.paint = sanitizePaint(value);
    else if (layer === 'callsign') draft.callsign = value;
    else if (layer === 'decal') draft.decal = value;
    else draft[layer] = value;
    const v = validateBuild(draft);
    this.build = v.build;
    // frame changes can invalidate dependent parts; validateBuild already
    // reset them, so drop now-stale proposals for corrected layers
    for (const l of Object.keys(this.proposals)) {
      const p = this.proposals[l];
      if (l !== 'paint' && l !== 'callsign' && this.build[l] === p.value) delete this.proposals[l];
    }
    this.ready.clear();       // any change re-opens the ready check
    this.rev++;
    return v;
  }

  // ---- message handling -------------------------------------------------
  // msg: { op, layer, value, ready }
  handle(playerId, msg) {
    const p = this.room.players.get(playerId);
    if (!p) return { ok: false, reason: 'not in room' };
    const layer = LAYERS.includes(msg.layer) ? msg.layer : null;
    const op = String(msg.op || '');

    switch (op) {
      case 'set': {
        if (!layer) return { ok: false, reason: 'bad layer' };
        if (this.isLockedAgainst(playerId, layer)) return { ok: false, reason: 'layer is locked' };
        if (!this.canEdit(playerId, layer)) {
          // silently downgrade to a proposal — nobody overwrites someone else's station
          return this.handle(playerId, { ...msg, op: 'propose' });
        }
        delete this.proposals[layer];
        const v = this.applyValue(layer, msg.value);
        return { ok: true, corrected: !v.ok, reason: v.reason };
      }
      case 'propose': {
        if (!layer) return { ok: false, reason: 'bad layer' };
        if (this.isLockedAgainst(playerId, layer)) return { ok: false, reason: 'layer is locked' };
        if (!this.valueLooksValid(layer, msg.value)) return { ok: false, reason: 'unknown part' };
        this.proposals[layer] = { value: msg.value, by: playerId, byName: p.name, votes: [playerId] };
        this.rev++;
        this.maybeAutoApply(layer);
        return { ok: true };
      }
      case 'vote': {
        const prop = layer && this.proposals[layer];
        if (!prop) return { ok: false, reason: 'nothing proposed' };
        if (msg.value === false) prop.votes = prop.votes.filter((v) => v !== playerId);
        else if (!prop.votes.includes(playerId)) prop.votes.push(playerId);
        this.rev++;
        this.maybeAutoApply(layer);
        return { ok: true };
      }
      case 'accept': {
        const prop = layer && this.proposals[layer];
        if (!prop) return { ok: false, reason: 'nothing proposed' };
        if (!this.canEdit(playerId, layer)) return { ok: false, reason: 'not your station' };
        delete this.proposals[layer];
        this.applyValue(layer, prop.value);
        return { ok: true };
      }
      case 'dismiss': {
        const prop = layer && this.proposals[layer];
        if (!prop) return { ok: false, reason: 'nothing proposed' };
        if (!this.canEdit(playerId, layer) && prop.by !== playerId) return { ok: false, reason: 'not your station' };
        delete this.proposals[layer];
        this.rev++;
        return { ok: true };
      }
      case 'lock': {
        if (!layer) return { ok: false, reason: 'bad layer' };
        if (!this.canEdit(playerId, layer)) return { ok: false, reason: 'not your station' };
        this.locks[layer] = playerId;
        this.rev++;
        return { ok: true };
      }
      case 'unlock': {
        if (!layer) return { ok: false, reason: 'bad layer' };
        const locker = this.locks[layer];
        if (locker && locker !== playerId && playerId !== this.room.hostId) {
          return { ok: false, reason: 'locked by someone else' };
        }
        delete this.locks[layer];
        this.rev++;
        return { ok: true };
      }
      case 'ready': {
        if (msg.value === false) this.ready.delete(playerId);
        else this.ready.add(playerId);
        this.rev++;
        return { ok: true };
      }
      case 'preset': {
        // full-build preset load: host applies everything; others apply the
        // layers they own and propose the frame (shared) if it differs.
        const v = validateBuild(msg.value);
        if (playerId === this.room.hostId || this.room.players.size === 1) {
          this.build = v.build;
          this.proposals = {};
          this.ready.clear();
          this.rev++;
          return { ok: true, corrected: !v.ok, reason: v.reason };
        }
        let applied = 0;
        for (const layer of LAYERS) {
          if (!this.canEdit(playerId, layer) || this.isLockedAgainst(playerId, layer)) continue;
          this.applyValue(layer, layer === 'paint' ? v.build.paint : v.build[layer]);
          applied++;
        }
        return { ok: true, reason: applied ? null : 'you own no stations; propose parts instead' };
      }
      default:
        return { ok: false, reason: 'unknown op' };
    }
  }

  valueLooksValid(layer, value) {
    if (layer === 'paint') return typeof value === 'object' && value;
    if (layer === 'callsign') return typeof value === 'string' && value.trim().length > 0;
    if (layer === 'decal') return DECALS.some((d) => d.id === value);
    return !!findPart(layer, value);
  }

  maybeAutoApply(layer) {
    const prop = this.proposals[layer];
    if (!prop) return;
    const voters = prop.votes.filter((v) => this.room.players.has(v));
    if (voters.length > this.room.players.size / 2) {
      delete this.proposals[layer];
      this.applyValue(layer, prop.value);
    }
  }

  removePlayer(id) {
    this.ready.delete(id);
    for (const l of Object.keys(this.locks)) if (this.locks[l] === id) delete this.locks[l];
    for (const l of Object.keys(this.proposals)) {
      const p = this.proposals[l];
      p.votes = p.votes.filter((v) => v !== id);
      if (p.by === id && p.votes.length === 0) delete this.proposals[l];
    }
    this.rev++;
  }

  serialize() {
    const owners = {};
    for (const layer of LAYERS) owners[layer] = this.ownerOf(layer);
    return {
      rev: this.rev,
      build: this.build,
      locks: this.locks,
      owners,
      proposals: Object.fromEntries(Object.entries(this.proposals).map(([l, p]) => [
        l, { value: p.value, by: p.by, byName: p.byName, votes: p.votes },
      ])),
      ready: [...this.ready],
    };
  }
}
