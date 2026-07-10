import * as THREE from 'three';
import { mulberry32, fbm2, lerp } from './util.js';

// Procedural PBR texture authoring. Every surface in the game gets a real
// albedo / normal / roughness set (plus emissive where things glow) painted
// at load into canvases — no downloads, no files, fully deterministic.
// The aim is photographic *material response*: paint chips down to bare
// steel, rain-varnished asphalt with mirror puddles, lit windows scattered
// across dark curtain walls, domed chitin plates with crack boundaries.

let MAX_ANISO = 1;
export function setMaxAnisotropy(a) { MAX_ANISO = a || 1; }

const cache = new Map();
function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function cv2(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d', { willReadFrequently: true })];
}

function tex(cv, { srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  return t;
}

// Sobel a grayscale height canvas into a tangent-space normal map so flat
// geometry shows machined seams / recessed glass / plate domes under light.
export function normalFromHeight(cv, strength = 2.0) {
  const w = cv.width, h = cv.height;
  const src = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const [out, octx] = cv2(w, h);
  const img = octx.createImageData(w, h);
  const hgt = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (hgt(x - 1, y) - hgt(x + 1, y)) * strength;
      const dy = (hgt(x, y - 1) - hgt(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  return t;
}

function hexRgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}
function rgba(r, g, b, a = 1) { return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }

// ===========================================================================
// ARMOR — painted military plate for the mech. Panel seams, rivet rows,
// edge chips down to bare steel, stencil markings, grime streaks.
// ===========================================================================
export function armorSet(colorHex) {
  return memo('armor' + colorHex, () => {
    const S = 512;
    const rng = mulberry32(1234 + (parseInt(colorHex.slice(1), 16) || 0));
    const [aCv, a] = cv2(S, S);   // albedo
    const [hCv, hx] = cv2(S, S);  // height
    const [rCv, rx] = cv2(S, S);  // roughness

    // militarize the crew color: desaturated field paint, bright enough to
    // read under storm light
    const base = new THREE.Color(colorHex);
    const hsl = {}; base.getHSL(hsl);
    base.setHSL(hsl.h, Math.min(0.5, hsl.s * 0.6), Math.max(0.34, Math.min(0.52, hsl.l * 0.85)));
    const [br, bg, bb] = [base.r * 255, base.g * 255, base.b * 255];

    hx.fillStyle = '#808080'; hx.fillRect(0, 0, S, S);
    rx.fillStyle = '#a8a8a8'; rx.fillRect(0, 0, S, S); // paint ~0.66 rough

    // recursive panel split — the paneling IS the read of "engineered plate"
    const panels = [];
    (function split(x, y, w, h, depth) {
      if ((w < 90 && h < 90) || depth > 4 || (depth > 1 && rng() < 0.24)) { panels.push([x, y, w, h]); return; }
      if (w > h) { const c = w * (0.35 + rng() * 0.3); split(x, y, c, h, depth + 1); split(x + c, y, w - c, h, depth + 1); }
      else { const c = h * (0.35 + rng() * 0.3); split(x, y, w, c, depth + 1); split(x, y + c, w, h - c, depth + 1); }
    })(0, 0, S, S, 0);

    // per-panel paint variance + seams + rivets
    for (const [px, py, pw, ph] of panels) {
      const v = 0.9 + rng() * 0.2;
      a.fillStyle = rgba(br * v, bg * v, bb * v);
      a.fillRect(px, py, pw, ph);
      // beveled panel edge: light top-left, dark bottom-right (painted AO)
      a.strokeStyle = 'rgba(255,255,255,0.07)'; a.lineWidth = 2;
      a.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
      a.strokeStyle = 'rgba(0,0,0,0.55)'; a.lineWidth = 2.5;
      a.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      hx.strokeStyle = '#2e2e2e'; hx.lineWidth = 3;
      hx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
      rx.strokeStyle = '#c8c8c8'; rx.lineWidth = 3;
      rx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

      // rivet rows along larger panels
      if (Math.min(pw, ph) > 70 && rng() < 0.75) {
        const inset = 9;
        const run = (x0, y0, x1, y1) => {
          const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 16);
          for (let i = 0; i <= n; i++) {
            const x = lerp(x0, x1, i / Math.max(1, n)), y = lerp(y0, y1, i / Math.max(1, n));
            a.fillStyle = 'rgba(0,0,0,0.5)'; a.beginPath(); a.arc(x + 0.7, y + 0.9, 2.4, 0, 7); a.fill();
            a.fillStyle = rgba(br * 1.25 + 20, bg * 1.25 + 20, bb * 1.25 + 20); a.beginPath(); a.arc(x, y, 2, 0, 7); a.fill();
            hx.fillStyle = '#c4c4c4'; hx.beginPath(); hx.arc(x, y, 2.2, 0, 7); hx.fill();
          }
        };
        if (pw > ph) { run(px + inset, py + inset, px + pw - inset, py + inset); if (rng() < 0.5) run(px + inset, py + ph - inset, px + pw - inset, py + ph - inset); }
        else { run(px + inset, py + inset, px + inset, py + ph - inset); if (rng() < 0.5) run(px + pw - inset, py + inset, px + pw - inset, py + ph - inset); }
      }
      // intake vents on a few panels
      if (pw > 100 && ph > 60 && rng() < 0.16) {
        const vw = Math.min(70, pw * 0.5), vh = Math.min(36, ph * 0.5);
        const vx = px + (pw - vw) / 2, vy = py + (ph - vh) / 2;
        for (let yy = vy; yy < vy + vh; yy += 7) {
          a.fillStyle = 'rgba(6,8,10,0.9)'; a.fillRect(vx, yy, vw, 3.6);
          a.fillStyle = 'rgba(255,255,255,0.09)'; a.fillRect(vx, yy + 3.6, vw, 1.2);
          hx.fillStyle = '#3a3a3a'; hx.fillRect(vx, yy, vw, 3.6);
        }
      }
    }

    // stencil markings — unit numbers, warnings, hazard band
    const stencil = (txt, x, y, size, rot = 0, col = 'rgba(226,228,222,0.62)') => {
      a.save(); a.translate(x, y); a.rotate(rot);
      a.font = `bold ${size}px "Courier New", monospace`;
      a.fillStyle = col; a.textAlign = 'center';
      a.fillText(txt, 0, 0); a.restore();
    };
    stencil('0' + (1 + Math.floor(rng() * 9)), 90 + rng() * 300, 90 + rng() * 120, 46);
    stencil(['NO STEP', 'RESCUE', 'INTAKE', 'LIFT PT'][Math.floor(rng() * 4)], 120 + rng() * 260, 280 + rng() * 120, 17);
    stencil(['CRV-01', 'HYD-7', 'CHK FLUID', 'EXH'][Math.floor(rng() * 4)], 100 + rng() * 300, 420 + rng() * 60, 15, rng() < 0.4 ? -Math.PI / 2 : 0);
    // hazard chevron strip on one panel edge
    {
      const hy = 30 + rng() * 420;
      a.save(); a.beginPath(); a.rect(30, hy, 190, 14); a.clip();
      for (let x = 0; x < 240; x += 24) {
        a.fillStyle = x % 48 ? 'rgba(20,18,10,0.85)' : 'rgba(214,164,32,0.85)';
        a.beginPath(); a.moveTo(30 + x - 12, hy + 14); a.lineTo(30 + x, hy); a.lineTo(30 + x + 12, hy); a.lineTo(30 + x, hy + 14); a.closePath(); a.fill();
      }
      a.restore();
    }

    // wear: chipped paint at edges/corners → bright bare steel, smooth
    for (let i = 0; i < 130; i++) {
      const [px, py, pw, ph] = panels[Math.floor(rng() * panels.length)];
      const edge = Math.floor(rng() * 4);
      const x = edge === 0 ? px : edge === 1 ? px + pw : px + rng() * pw;
      const y = edge < 2 ? py + rng() * ph : edge === 2 ? py : py + ph;
      const r = 1.5 + rng() * 4.5;
      const steel = 145 + rng() * 50;
      a.fillStyle = rgba(steel, steel + 4, steel + 10, 0.9);
      a.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = (k / 6) * Math.PI * 2;
        const rr = r * (0.5 + rng() * 0.8);
        a[k ? 'lineTo' : 'moveTo'](x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
      }
      a.closePath(); a.fill();
      rx.fillStyle = '#3c3c3c'; rx.beginPath(); rx.arc(x, y, r, 0, 7); rx.fill();
      hx.fillStyle = '#6e6e6e'; hx.beginPath(); hx.arc(x, y, r, 0, 7); hx.fill();
    }
    // scratches: thin bright streaks
    for (let i = 0; i < 40; i++) {
      const x = rng() * S, y = rng() * S, ang = rng() * Math.PI, len = 8 + rng() * 36;
      a.strokeStyle = 'rgba(190,196,205,0.35)'; a.lineWidth = 1;
      a.beginPath(); a.moveTo(x, y); a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); a.stroke();
      rx.strokeStyle = 'rgba(70,70,70,0.5)'; rx.lineWidth = 1.2;
      rx.beginPath(); rx.moveTo(x, y); rx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); rx.stroke();
    }
    // grime: vertical rain streaks off seams + oily film pockets
    for (let i = 0; i < 90; i++) {
      const x = rng() * S, y = rng() * S, len = 20 + rng() * 90, w = 2 + rng() * 7;
      const g = a.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, 'rgba(12,12,14,0.32)'); g.addColorStop(1, 'rgba(12,12,14,0)');
      a.fillStyle = g; a.fillRect(x - w / 2, y, w, len);
      const gr = rx.createLinearGradient(x, y, x, y + len);
      gr.addColorStop(0, 'rgba(225,225,225,0.4)'); gr.addColorStop(1, 'rgba(225,225,225,0)');
      rx.fillStyle = gr; rx.fillRect(x - w / 2, y, w, len);
    }
    // fine paint noise
    for (let i = 0; i < 2400; i++) {
      a.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      a.fillRect(rng() * S, rng() * S, 1.6, 1.6);
    }

    return {
      map: tex(aCv),
      normalMap: normalFromHeight(hCv, 2.6),
      roughnessMap: tex(rCv, { srgb: false }),
    };
  });
}

// dark machined steel for joints, hydraulics housings, undersides
export function steelSet() {
  return memo('steel', () => {
    const S = 256;
    const rng = mulberry32(77);
    const [aCv, a] = cv2(S, S);
    const [rCv, rx] = cv2(S, S);
    a.fillStyle = '#61656e'; a.fillRect(0, 0, S, S);
    rx.fillStyle = '#6a6a6a'; rx.fillRect(0, 0, S, S);
    // brushed horizontal grain
    for (let i = 0; i < 700; i++) {
      const y = rng() * S, l = 20 + rng() * 120;
      a.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
      a.fillRect(rng() * S, y, l, 1);
      rx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      rx.fillRect(rng() * S, y, l, 1);
    }
    for (let i = 0; i < 26; i++) { // oil smudges
      const x = rng() * S, y = rng() * S, r = 8 + rng() * 26;
      const g = a.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(6,7,9,0.35)'); g.addColorStop(1, 'rgba(6,7,9,0)');
      a.fillStyle = g; a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
    }
    return { map: tex(aCv), roughnessMap: tex(rCv, { srgb: false }) };
  });
}

// ===========================================================================
// CITY FACADES — three architectural families, each with a matching
// emissive sheet (scattered lit interiors) and relief. Tile = 12m x 24m.
// ===========================================================================
export function facadeSet(variant) {
  return memo('facade' + variant, () => {
    const W = 256, H = 512;                // 8 floors x 8 bays per tile
    const rng = mulberry32(400 + variant);
    const [aCv, a] = cv2(W, H);
    const [eCv, e] = cv2(W, H);
    const [hCv, hx] = cv2(W, H);
    const [rCv, rx] = cv2(W, H);
    e.fillStyle = '#000'; e.fillRect(0, 0, W, H);

    const FLOOR = 64, BAY = 32;
    const conc = variant === 2 ? [126, 116, 108] : variant === 1 ? [88, 96, 108] : [138, 140, 142];
    a.fillStyle = rgba(...conc); a.fillRect(0, 0, W, H);
    hx.fillStyle = '#808080'; hx.fillRect(0, 0, W, H);
    rx.fillStyle = '#c9c9c9'; rx.fillRect(0, 0, W, H);

    // masonry course lines for the industrial variant
    if (variant === 2) {
      for (let y = 0; y < H; y += 8) {
        a.fillStyle = 'rgba(0,0,0,0.13)'; a.fillRect(0, y, W, 1.4);
        for (let x = (y % 16) ? 0 : 12; x < W; x += 24) a.fillRect(x, y, 1.2, 8);
      }
    }
    // concrete mottling + weather streaks (all variants)
    for (let i = 0; i < 420; i++) {
      const v = 0.9 + rng() * 0.2;
      a.fillStyle = rgba(conc[0] * v, conc[1] * v, conc[2] * v, 0.16);
      a.fillRect(rng() * W, rng() * H, 4 + rng() * 16, 4 + rng() * 16);
    }
    for (let i = 0; i < 26; i++) {
      const x = rng() * W, len = 60 + rng() * 260, w = 2 + rng() * 5;
      const g = a.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(16,18,20,0.22)'); g.addColorStop(1, 'rgba(16,18,20,0)');
      a.save(); a.translate(x, rng() * 160); a.fillStyle = g; a.fillRect(-w / 2, 0, w, len); a.restore();
    }

    // window geometry per family
    const win = variant === 1
      ? { x: 3, y: 6, w: BAY - 6, h: FLOOR - 12 }        // curtain wall: nearly all glass
      : variant === 2
        ? { x: 7, y: 14, w: BAY - 14, h: FLOOR - 26 }    // industrial: small openings
        : { x: 5, y: 10, w: BAY - 10, h: FLOOR - 20 };   // office precast

    for (let fy = 0; fy < H; fy += FLOOR) {
      // whole floors go dark / sparse / busy — occupancy clusters read as real
      const litRate = [0, 0.06, 0.14, 0.32][Math.floor(rng() * 4)];
      for (let bx = 0; bx < W; bx += BAY) {
        if (variant === 2 && rng() < 0.16) { // bricked-up opening
          a.fillStyle = rgba(conc[0] * 0.82, conc[1] * 0.8, conc[2] * 0.78);
          a.fillRect(bx + win.x, fy + win.y, win.w, win.h);
          continue;
        }
        const lit = rng() < litRate;
        // glass: dark blue-grey with a vertical sheen gradient
        const g = a.createLinearGradient(0, fy + win.y, 0, fy + win.y + win.h);
        g.addColorStop(0, 'rgba(26,32,44,0.96)');
        g.addColorStop(0.5, 'rgba(38,46,62,0.96)');
        g.addColorStop(1, 'rgba(18,22,32,0.96)');
        a.fillStyle = g;
        a.fillRect(bx + win.x, fy + win.y, win.w, win.h);
        // recessed glass + proud sill in the height field
        hx.fillStyle = '#4e4e4e'; hx.fillRect(bx + win.x, fy + win.y, win.w, win.h);
        hx.fillStyle = '#a2a2a2'; hx.fillRect(bx + win.x - 1, fy + win.y + win.h, win.w + 2, 3);
        // glass is smooth
        rx.fillStyle = '#2e2e2e'; rx.fillRect(bx + win.x, fy + win.y, win.w, win.h);
        // mullions
        a.fillStyle = 'rgba(10,12,16,0.85)';
        a.fillRect(bx + win.x + win.w / 2 - 1, fy + win.y, 2, win.h);
        if (variant !== 1) a.fillRect(bx + win.x, fy + win.y + win.h / 2 - 1, win.w, 2);
        if (lit) {
          const warm = rng() < 0.72;
          const col = warm ? [255, 214, 150] : [186, 214, 255];
          const dim = 0.55 + rng() * 0.45;
          e.fillStyle = rgba(col[0] * dim, col[1] * dim, col[2] * dim);
          e.fillRect(bx + win.x + 1, fy + win.y + 1, win.w - 2, win.h - 2);
          // interior silhouettes: darker verticals — reads as furniture/blinds
          e.fillStyle = 'rgba(0,0,0,0.55)';
          const nSil = 1 + Math.floor(rng() * 3);
          for (let s = 0; s < nSil; s++) {
            const sx = bx + win.x + 2 + rng() * (win.w - 8);
            e.fillRect(sx, fy + win.y + 1 + rng() * win.h * 0.4, 3 + rng() * 5, win.h * (0.3 + rng() * 0.6));
          }
          // faint spill onto the frame in the albedo
          a.fillStyle = rgba(col[0], col[1], col[2], 0.12);
          a.fillRect(bx + win.x - 2, fy + win.y - 2, win.w + 4, win.h + 4);
        }
      }
      // floor slab
      a.fillStyle = variant === 1 ? 'rgba(14,16,22,0.9)' : 'rgba(0,0,0,0.35)';
      a.fillRect(0, fy, W, variant === 1 ? 4 : 6);
      a.fillStyle = 'rgba(255,255,255,0.10)';
      a.fillRect(0, fy + (variant === 1 ? 4 : 6), W, 1.6);
      hx.fillStyle = '#9c9c9c'; hx.fillRect(0, fy, W, 5);
    }

    return {
      map: tex(aCv),
      emissiveMap: tex(eCv),
      normalMap: normalFromHeight(hCv, 2.4),
      roughnessMap: tex(rCv, { srgb: false }),
    };
  });
}

// ===========================================================================
// STREETS — rain-varnished asphalt. Roughness carries the storm: mirror
// puddles pooling in the wheel ruts, grainy dry crowns between them.
// ===========================================================================
export function asphaltSet() {
  return memo('asphalt', () => {
    const S = 512;
    const rng = mulberry32(9021);
    const [aCv, a] = cv2(S, S);
    const [hCv, hx] = cv2(S, S);
    const [rCv, rx] = cv2(S, S);
    a.fillStyle = '#16181e'; a.fillRect(0, 0, S, S);
    hx.fillStyle = '#828282'; hx.fillRect(0, 0, S, S);
    rx.fillStyle = '#8e8e8e'; rx.fillRect(0, 0, S, S);

    // repair patches: subtly darker rectangles with crisp edges
    for (let i = 0; i < 7; i++) {
      const x = rng() * S, y = rng() * S, w = 40 + rng() * 120, h = 30 + rng() * 90;
      a.save(); a.translate(x, y); a.rotate((rng() - 0.5) * 0.4);
      a.fillStyle = rng() < 0.5 ? 'rgba(8,9,12,0.55)' : 'rgba(40,44,52,0.35)';
      a.fillRect(-w / 2, -h / 2, w, h);
      a.restore();
    }
    // aggregate speckle
    for (let i = 0; i < 5200; i++) {
      a.fillStyle = rng() < 0.5 ? 'rgba(210,214,224,0.05)' : 'rgba(0,0,0,0.1)';
      a.fillRect(rng() * S, rng() * S, 1.4, 1.4);
      if (i % 3 === 0) {
        hx.fillStyle = rng() < 0.5 ? '#8c8c8c' : '#787878';
        hx.fillRect(rng() * S, rng() * S, 1.6, 1.6);
      }
    }
    // tar-snake crack seals (dark, glossy) + open cracks (recessed)
    for (let c = 0; c < 12; c++) {
      let x = rng() * S, y = rng() * S;
      const glossy = rng() < 0.5;
      a.strokeStyle = glossy ? 'rgba(4,5,8,0.85)' : 'rgba(6,8,12,0.6)';
      a.lineWidth = glossy ? 3 : 1.4;
      hx.strokeStyle = '#4c4c4c'; hx.lineWidth = 2;
      rx.strokeStyle = glossy ? '#3a3a3a' : '#b0b0b0'; rx.lineWidth = 3;
      a.beginPath(); a.moveTo(x, y);
      hx.beginPath(); hx.moveTo(x, y);
      rx.beginPath(); rx.moveTo(x, y);
      for (let s = 0; s < 8; s++) {
        x += (rng() - 0.5) * 60; y += (rng() - 0.5) * 60;
        a.lineTo(x, y); hx.lineTo(x, y); rx.lineTo(x, y);
      }
      a.stroke(); hx.stroke(); rx.stroke();
    }
    // oil stains: dark, slick discs
    for (let i = 0; i < 9; i++) {
      const x = rng() * S, y = rng() * S, r = 10 + rng() * 26;
      const g = a.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(4,4,7,0.5)'); g.addColorStop(1, 'rgba(4,4,7,0)');
      a.fillStyle = g; a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
      const gr = rx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(40,40,40,0.7)'); gr.addColorStop(1, 'rgba(40,40,40,0)');
      rx.fillStyle = gr; rx.beginPath(); rx.arc(x, y, r, 0, 7); rx.fill();
    }
    // PUDDLES: clustered mirror patches with feathered shores
    for (let p = 0; p < 11; p++) {
      const px = rng() * S, py = rng() * S;
      for (let b = 0; b < 7; b++) {
        const x = px + (rng() - 0.5) * 40, y = py + (rng() - 0.5) * 40;
        const rw = 8 + rng() * 22, rh = 5 + rng() * 14;
        const g = rx.createRadialGradient(x, y, 0, x, y, Math.max(rw, rh));
        g.addColorStop(0, 'rgba(16,16,16,0.92)');
        g.addColorStop(0.75, 'rgba(16,16,16,0.75)');
        g.addColorStop(1, 'rgba(16,16,16,0)');
        rx.save(); rx.translate(x, y); rx.scale(1, rh / rw);
        rx.fillStyle = g; rx.beginPath(); rx.arc(0, 0, rw, 0, 7); rx.fill();
        rx.restore();
        // puddles darken the albedo slightly (wet asphalt is near-black)
        a.save(); a.translate(x, y); a.scale(1, rh / rw);
        a.fillStyle = 'rgba(2,4,8,0.4)'; a.beginPath(); a.arc(0, 0, rw, 0, 7); a.fill();
        a.restore();
      }
    }
    return {
      map: tex(aCv),
      normalMap: normalFromHeight(hCv, 1.5),
      roughnessMap: tex(rCv, { srgb: false }),
    };
  });
}

// pale concrete for sidewalks / plazas / rubble
export function concreteSet() {
  return memo('concrete', () => {
    const S = 256;
    const rng = mulberry32(5150);
    const [aCv, a] = cv2(S, S);
    const [hCv, hx] = cv2(S, S);
    a.fillStyle = '#6d7076'; a.fillRect(0, 0, S, S);
    hx.fillStyle = '#808080'; hx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const v = 0.85 + rng() * 0.3;
      a.fillStyle = rgba(109 * v, 112 * v, 118 * v, 0.3);
      a.fillRect(rng() * S, rng() * S, 3 + rng() * 10, 3 + rng() * 10);
    }
    // expansion joints
    for (let x = 0; x < S; x += 64) {
      a.fillStyle = 'rgba(20,22,26,0.5)'; a.fillRect(x, 0, 2, S); a.fillRect(0, x, S, 2);
      hx.fillStyle = '#585858'; hx.fillRect(x, 0, 2.5, S); hx.fillRect(0, x, S, 2.5);
    }
    for (let i = 0; i < 14; i++) { // stains
      const x = rng() * S, y = rng() * S, r = 8 + rng() * 30;
      const g = a.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(30,30,34,0.28)'); g.addColorStop(1, 'rgba(30,30,34,0)');
      a.fillStyle = g; a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
    }
    return { map: tex(aCv), normalMap: normalFromHeight(hCv, 1.4) };
  });
}

// ===========================================================================
// CREATURE HIDES
// ===========================================================================

// chitin: domed plates split by crack boundaries (Voronoi F2-F1), glossy
// centers, rough seams, pale tubercles
export function chitinSet(shellHex, darkHex) {
  return memo('chitin' + shellHex + darkHex, () => {
    const S = 256;
    const rng = mulberry32(31 + (parseInt(shellHex.slice(1), 16) || 0));
    const [sr, sg, sb] = hexRgb(shellHex);
    const [dr, dg, db] = hexRgb(darkHex);
    const pts = [];
    for (let i = 0; i < 42; i++) pts.push([rng() * S, rng() * S]);
    const [aCv, a] = cv2(S, S);
    const [hCv, hx] = cv2(S, S);
    const [rCv, rx] = cv2(S, S);
    const aImg = a.createImageData(S, S);
    const hImg = hx.createImageData(S, S);
    const rImg = rx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // toroidal distance so the texture tiles
        let f1 = 1e9, f2 = 1e9;
        for (const [px, py] of pts) {
          let dx = Math.abs(x - px); if (dx > S / 2) dx = S - dx;
          let dy = Math.abs(y - py); if (dy > S / 2) dy = S - dy;
          const d = dx * dx + dy * dy;
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        const edge = Math.sqrt(f2) - Math.sqrt(f1);   // 0 at boundary, big at center
        const dome = Math.min(1, edge / 16);          // plate domes
        const n = fbm2(x * 0.05, y * 0.05, 3);
        const t = dome * (0.75 + n * 0.4);
        const i = (y * S + x) * 4;
        aImg.data[i] = lerp(dr, sr, t);
        aImg.data[i + 1] = lerp(dg, sg, t);
        aImg.data[i + 2] = lerp(db, sb, t);
        aImg.data[i + 3] = 255;
        const hv = 60 + dome * 150 + n * 30;
        hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = hv; hImg.data[i + 3] = 255;
        const rv = 200 - dome * 130 + n * 40;         // seams rough, domes glossy
        rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rv; rImg.data[i + 3] = 255;
      }
    }
    a.putImageData(aImg, 0, 0);
    hx.putImageData(hImg, 0, 0);
    rx.putImageData(rImg, 0, 0);
    // tubercles: pale raised studs on plate centers
    for (const [px, py] of pts) {
      if (rng() < 0.5) continue;
      const r = 2 + rng() * 4;
      a.fillStyle = rgba(sr * 1.3 + 24, sg * 1.3 + 24, sb * 1.3 + 24, 0.85);
      a.beginPath(); a.arc(px, py, r, 0, 7); a.fill();
      hx.fillStyle = '#e8e8e8'; hx.beginPath(); hx.arc(px, py, r, 0, 7); hx.fill();
    }
    return {
      map: tex(aCv),
      normalMap: normalFromHeight(hCv, 3.2),
      roughnessMap: tex(rCv, { srgb: false }),
    };
  });
}

// leathery hide: anisotropic wrinkle folds, matte
export function hideSet(baseHex) {
  return memo('hide' + baseHex, () => {
    const S = 256;
    const [br, bg, bb] = hexRgb(baseHex);
    const [aCv, a] = cv2(S, S);
    const [hCv, hx] = cv2(S, S);
    const aImg = a.createImageData(S, S);
    const hImg = hx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // stretched fBm = directional wrinkles; ridged for crease lines
        const w = fbm2(x * 0.012, y * 0.06, 4);
        const crease = Math.abs(w - 0.5) * 2;         // 0 at fold bottoms
        const mottle = fbm2(x * 0.03 + 40, y * 0.03, 3);
        const t = 0.55 + crease * 0.5 + (mottle - 0.5) * 0.35;
        const i = (y * S + x) * 4;
        aImg.data[i] = br * t; aImg.data[i + 1] = bg * t; aImg.data[i + 2] = bb * t; aImg.data[i + 3] = 255;
        const hv = 40 + crease * 170;
        hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = hv; hImg.data[i + 3] = 255;
      }
    }
    a.putImageData(aImg, 0, 0);
    hx.putImageData(hImg, 0, 0);
    return { map: tex(aCv), normalMap: normalFromHeight(hCv, 2.6) };
  });
}

// wet amphibian skin: soft blotches, raised warts, high sheen
export function skinSet(baseHex, blotchHex) {
  return memo('skin' + baseHex, () => {
    const S = 256;
    const rng = mulberry32(606);
    const [br, bg, bb] = hexRgb(baseHex);
    const [xr, xg, xb] = hexRgb(blotchHex);
    const [aCv, a] = cv2(S, S);
    const [hCv, hx] = cv2(S, S);
    const [rCv, rx] = cv2(S, S);
    const aImg = a.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const m = fbm2(x * 0.025, y * 0.025, 4);
        const t = m < 0.45 ? (0.45 - m) / 0.45 : 0;   // blotch mask
        const i = (y * S + x) * 4;
        aImg.data[i] = lerp(br, xr, t) * (0.9 + m * 0.2);
        aImg.data[i + 1] = lerp(bg, xg, t) * (0.9 + m * 0.2);
        aImg.data[i + 2] = lerp(bb, xb, t) * (0.9 + m * 0.2);
        aImg.data[i + 3] = 255;
      }
    }
    a.putImageData(aImg, 0, 0);
    hx.fillStyle = '#787878'; hx.fillRect(0, 0, S, S);
    rx.fillStyle = '#4a4a4a'; rx.fillRect(0, 0, S, S);  // wet = glossy
    for (let i = 0; i < 90; i++) {                       // warts
      const x = rng() * S, y = rng() * S, r = 2 + rng() * 6;
      hx.fillStyle = '#d6d6d6'; hx.beginPath(); hx.arc(x, y, r, 0, 7); hx.fill();
      a.fillStyle = rgba(br * 1.2, bg * 1.2, bb * 1.15, 0.5);
      a.beginPath(); a.arc(x, y, r, 0, 7); a.fill();
      rx.fillStyle = '#8a8a8a'; rx.beginPath(); rx.arc(x, y, r * 0.7, 0, 7); rx.fill();
    }
    return {
      map: tex(aCv),
      normalMap: normalFromHeight(hCv, 2.4),
      roughnessMap: tex(rCv, { srgb: false }),
    };
  });
}

// layered feather rows: scalloped vanes with shafts
export function featherSet(greyHex, liteHex) {
  return memo('feather' + greyHex, () => {
    const W = 256, H = 256;
    const rng = mulberry32(808);
    const [gr, gg, gb] = hexRgb(greyHex);
    const [lr, lg, lb] = hexRgb(liteHex);
    const [aCv, a] = cv2(W, H);
    const [hCv, hx] = cv2(W, H);
    a.fillStyle = rgba(gr * 0.8, gg * 0.8, gb * 0.8); a.fillRect(0, 0, W, H);
    hx.fillStyle = '#707070'; hx.fillRect(0, 0, W, H);
    const ROW = 26, FW = 34;
    for (let y = -ROW; y < H + ROW; y += ROW) {
      const off = ((y / ROW) % 2) * (FW / 2);
      for (let x = -FW; x < W + FW; x += FW) {
        const lite = rng() < 0.4;
        const v = 0.85 + rng() * 0.3;
        a.fillStyle = lite ? rgba(lr * v, lg * v, lb * v) : rgba(gr * v, gg * v, gb * v);
        a.beginPath();
        a.ellipse(x + off + FW / 2, y + ROW * 0.9, FW * 0.52, ROW * 1.05, 0, 0, 7);
        a.fill();
        a.strokeStyle = 'rgba(0,0,0,0.3)'; a.lineWidth = 1.4; a.stroke();
        hx.fillStyle = '#9a9a9a';
        hx.beginPath(); hx.ellipse(x + off + FW / 2, y + ROW * 0.9, FW * 0.52, ROW * 1.05, 0, 0, 7); hx.fill();
        hx.strokeStyle = '#4e4e4e'; hx.lineWidth = 2; hx.stroke();
        // shaft
        a.strokeStyle = 'rgba(255,255,255,0.14)'; a.lineWidth = 1.6;
        a.beginPath(); a.moveTo(x + off + FW / 2, y); a.lineTo(x + off + FW / 2, y + ROW * 1.7); a.stroke();
      }
    }
    return { map: tex(aCv), normalMap: normalFromHeight(hCv, 1.8) };
  });
}

// ===========================================================================
// SKY + FX SPRITES
// ===========================================================================

// storm sky dome: slate cloud deck lit from below by the burning city —
// warm sodium bruise at the horizon fading to a cold black zenith
export function stormSkyTex() {
  return memo('sky', () => {
    const W = 768, H = 384;
    const [cvv, c] = cv2(W, H);
    const img = c.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const t = y / H;                                 // 0 zenith, 1 horizon
      for (let x = 0; x < W; x++) {
        // tiling clouds: sample fBm on a cylinder so x wraps seamlessly
        const ang = (x / W) * Math.PI * 2;
        const n = fbm2(Math.cos(ang) * 2.2 + 4, Math.sin(ang) * 2.2 + t * 5.5, 4);
        const billow = Math.pow(n, 1.6);
        // base gradient: cold zenith -> steel -> warm city bruise
        let r = lerp(7, 26, t) + billow * 18;
        let g = lerp(9, 30, t) + billow * 20;
        let b = lerp(15, 44, t) + billow * 30;
        const glow = Math.pow(Math.max(0, t - 0.55) / 0.45, 2.2);
        r += glow * (58 + billow * 66);
        g += glow * (30 + billow * 34);
        b += glow * (10 + billow * 12);
        const i = (y * W + x) * 4;
        img.data[i] = Math.min(255, r);
        img.data[i + 1] = Math.min(255, g);
        img.data[i + 2] = Math.min(255, b);
        img.data[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    const t = tex(cvv);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

// soft billowing smoke sprite (radial falloff x fBm)
export function smokeSprite() {
  return memo('smoke', () => {
    const S = 128;
    const [cvv, c] = cv2(S, S);
    const img = c.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
        const d = Math.hypot(dx, dy);
        const n = fbm2(x * 0.05, y * 0.05, 4);
        const alpha = Math.max(0, 1 - d * 1.15) * (0.45 + n * 0.75);
        const i = (y * S + x) * 4;
        const v = 150 + n * 80;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 8;
        img.data[i + 3] = Math.min(255, alpha * 255);
      }
    }
    c.putImageData(img, 0, 0);
    return tex(cvv, { wrap: false });
  });
}

// hot radial flare for muzzle flashes / explosions / beam impact
export function flareSprite() {
  return memo('flare', () => {
    const S = 128;
    const [cvv, c] = cv2(S, S);
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,236,190,0.9)');
    g.addColorStop(0.45, 'rgba(255,150,60,0.32)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    return tex(cvv, { wrap: false });
  });
}

// single rain streak: thin vertical bright line, soft ends
export function rainStreakTex() {
  return memo('rain', () => {
    const [cvv, c] = cv2(16, 64);
    const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(190,205,230,0)');
    g.addColorStop(0.35, 'rgba(190,205,230,0.65)');
    g.addColorStop(0.75, 'rgba(190,205,230,0.85)');
    g.addColorStop(1, 'rgba(190,205,230,0)');
    c.fillStyle = g;
    c.fillRect(6.5, 0, 3, 64);
    return tex(cvv, { wrap: false });
  });
}

// ground splash ring for rain / impacts
export function ringSprite() {
  return memo('ring', () => {
    const S = 64;
    const [cvv, c] = cv2(S, S);
    c.strokeStyle = 'rgba(210,222,240,0.9)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = 'rgba(210,222,240,0.35)';
    c.lineWidth = 7;
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2); c.stroke();
    return tex(cvv, { wrap: false });
  });
}

// scorch decal: charred blast mark with feathered edge + radial streaks
export function scorchSprite() {
  return memo('scorch', () => {
    const S = 128;
    const rng = mulberry32(666);
    const [cvv, c] = cv2(S, S);
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(8,6,8,0.92)');
    g.addColorStop(0.55, 'rgba(12,10,12,0.75)');
    g.addColorStop(1, 'rgba(12,10,12,0)');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    // radial soot streaks
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r0 = 18 + rng() * 18, r1 = r0 + 14 + rng() * 26;
      c.strokeStyle = `rgba(10,8,10,${0.3 + rng() * 0.4})`;
      c.lineWidth = 2 + rng() * 4;
      c.beginPath();
      c.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
      c.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
      c.stroke();
    }
    return tex(cvv, { wrap: false });
  });
}
