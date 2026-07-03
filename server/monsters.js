import * as CANNON from 'cannon-es';
import { MONSTERS } from '../shared/constants.js';

// Goofy kaiju. Never scary: slow, loudly telegraphed, and they die funny.
// AI is a plain state machine: spawn -> walk -> telegraph -> attack ->
// recover -> walk... with 'dead' at the end (they stick around briefly
// so the client can play the flop animation).

let nextId = 1;

export class Monster {
  constructor(world, type, pos, wave) {
    const def = MONSTERS[type];
    this.world = world;
    this.def = def;
    this.type = type;
    this.id = 'm' + nextId++;
    this.wave = wave;

    this.maxHp = Math.round(def.hp + def.hpPerWave * (wave - 1));
    this.hp = this.maxHp;
    this.damage = def.damage + def.damagePerWave * (wave - 1);
    this.radius = def.radius;
    this.credits = def.credits;

    this.body = new CANNON.Body({
      mass: def.mass,
      shape: new CANNON.Sphere(def.radius),
      position: new CANNON.Vec3(pos.x, def.radius + 0.5, pos.z),
      linearDamping: 0.6,
      angularDamping: 0.9,
    });
    this.body.allowSleep = false;
    world.addBody(this.body);

    this.state = 'spawn';
    this.t = 0;
    this.yaw = 0;
    this.attackKind = 'hit';  // pigeons sometimes 'gust' instead
    this.deadT = 0;
    this.removed = false;
    this.staggerT = 0;
    this.events = [{ what: 'roar' }];
  }

  get alive() { return this.hp > 0; }

  // target: { body, takeHit(dmg, fromPos, kb), isRagdoll }
  update(dt, target) {
    const b = this.body;
    this.t += dt;

    if (!this.alive) {
      this.state = 'dead';
      this.deadT += dt;
      if (this.deadT > 2.6 && !this.removed) {
        this.removed = true;
        this.world.removeBody(b);
      }
      return;
    }

    if (this.staggerT > 0) { this.staggerT -= dt; return; }
    if (!target) return;

    const toT = target.body.position.vsub(b.position);
    toT.y = 0;
    const dist = toT.length();
    if (dist > 0.01) {
      const wantYaw = Math.atan2(-toT.x, -toT.z);
      let d = wantYaw - this.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, d));
    }

    switch (this.state) {
      case 'spawn':
        if (this.t > 1.4) this.setState('walk');
        break;

      case 'walk': {
        if (dist > this.def.attackRange) {
          toT.normalize();
          const speed = this.def.speed;
          const v = b.velocity;
          const hSpeed = Math.hypot(v.x, v.z);
          if (hSpeed < speed) {
            b.applyForce(toT.scale(this.def.mass * 9));
          }
        } else {
          this.setState('telegraph');
          // pigeons open with a wing gust 35% of the time
          this.attackKind = this.type === 'pigeon' && Math.random() < 0.35 ? 'gust' : 'hit';
          this.events.push({ what: 'telegraph', kind: this.attackKind });
        }
        break;
      }

      case 'telegraph':
        if (this.t > this.def.telegraph) {
          this.setState('attack');
          this.events.push({ what: 'attack', kind: this.attackKind });
          // the strike lands at the midpoint of the attack animation
          this.strikeDone = false;
        }
        break;

      case 'attack':
        if (!this.strikeDone && this.t > this.def.attackDur * 0.5) {
          this.strikeDone = true;
          if (this.attackKind === 'gust') {
            // no damage, but a mighty shove
            if (dist < this.def.attackRange * 2.2) {
              target.takeHit(0, b.position, this.def.knockback * 1.8);
              this.events.push({ what: 'gustHit' });
            }
          } else if (dist < this.def.attackRange * 1.25) {
            target.takeHit(this.damage, b.position, this.def.knockback);
            this.events.push({ what: 'strikeHit' });
          }
        }
        if (this.t > this.def.attackDur) this.setState('recover');
        break;

      case 'recover':
        if (this.t > this.def.recover) this.setState('walk');
        break;
    }
  }

  setState(s) {
    this.state = s;
    this.t = 0;
  }

  takeHit(dmg, fromPos, knockback = 0) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - dmg);
    if (dmg >= 5) {
      this.events.push({ what: 'hit' });
      this.staggerT = Math.max(this.staggerT, 0.35);
    }
    if (knockback && fromPos) {
      const dir = this.body.position.vsub(fromPos);
      dir.y = 0;
      if (dir.length() > 0.01) dir.normalize();
      dir.y = 0.5;
      this.body.applyImpulse(dir.scale(knockback));
    }
    if (this.hp <= 0) {
      this.events.push({ what: 'die' });
      this.setState('dead');
    }
  }

  snapshot() {
    const b = this.body;
    const snap = {
      id: this.id,
      type: this.type,
      p: [rnd(b.position.x), rnd(b.position.y), rnd(b.position.z)],
      yaw: rnd(this.yaw),
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      state: this.state,
      t: rnd(this.t),
      kind: this.attackKind,
      ev: this.events,
    };
    this.events = [];
    return snap;
  }
}

function rnd(n) { return Math.round(n * 1000) / 1000; }
