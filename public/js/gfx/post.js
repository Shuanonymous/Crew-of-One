import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The film look, in one final pass: teal–orange split-tone grade, gentle
// S-curve contrast, edge chromatic aberration, animated fine grain, and a
// breathing vignette. Runs before OutputPass (so pre tone-map, linear HDR).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.65 },
    uGrain: { value: 0.026 },
    uCA: { value: 0.00035 },
    uSat: { value: 1.06 },
    uLift: { value: new THREE.Vector3(0.012, 0.014, 0.021) },  // cool shadows
    uGain: { value: new THREE.Vector3(1.05, 1.00, 0.94) },     // warm highlights
    uHurt: { value: 0 },                                        // red pulse when the hull is critical
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uCA, uSat, uHurt;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 917.0) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 fromC = uv - 0.5;
      float r2 = dot(fromC, fromC);

      // chromatic aberration grows toward the frame edge
      vec2 caOff = fromC * r2 * uCA * 60.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv - caOff).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + caOff).b;

      // lift/gain split-tone + soft S-curve
      col = col * uGain + uLift;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);

      // saturation
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSat);

      // hull-critical red bleed at the edges
      col = mix(col, vec3(luma * 1.1, luma * 0.22, luma * 0.2), uHurt * min(1.0, r2 * 3.2));

      // vignette
      float vig = 1.0 - uVignette * smoothstep(0.24, 0.78, r2);
      col *= vig;

      // animated fine grain, stronger in the shadows
      float g = (hash(uv * vec2(1920.0, 1080.0)) - 0.5) * uGrain;
      col += g * (1.0 - luma * 0.75);

      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Build the full chain. GTAO is created lazily (only when a tier wants it)
// because its render targets are the priciest part of the pipeline.
// `software` = no-GPU rasterizer (SwiftShader/llvmpipe): skip MSAA and the
// bloom mip chain entirely — they multiply per-pixel CPU cost several-fold.
export function buildPost(renderer, scene, camera, software = false) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = software
    ? new EffectComposer(renderer)
    : new EffectComposer(renderer,
      new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));

  const post = {
    composer,
    software,
    gtao: null,
    bloom: new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.42, 0.88),
    grade: new ShaderPass(GradeShader),
    out: new OutputPass(),
    _scene: scene,
    _camera: camera,

    ensureGtao(on) {
      if (this.software) on = false;
      if (on && !this.gtao) {
        this.gtao = new GTAOPass(scene, camera, size.x, size.y);
        this.gtao.output = GTAOPass.OUTPUT.Default;
        this.gtao.blendIntensity = 0.9;
        // world-scale AO: the mech is ~14m tall, streets ~18m wide
        this.gtao.updateGtaoMaterial({
          radius: 1.8, distanceExponent: 1.6, thickness: 1.2,
          scale: 1.4, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false,
        });
        composer.insertPass(this.gtao, 1);
      }
      if (this.gtao) this.gtao.enabled = on;
    },

    setSize(w, h) {
      composer.setSize(w, h);
      this.gtao?.setSize(w, h);
    },

    step(dt) {
      this.grade.uniforms.uTime.value = (performance.now() % 4000) / 4000;
    },

    // software: draw straight to screen (tone mapping still applies) —
    // the composer round-trip costs a full extra screen blit on CPU
    render() {
      if (this.software) renderer.render(scene, camera);
      else composer.render();
    },
  };

  if (!software) {
    composer.addPass(post.bloom);
    composer.addPass(post.grade);
  }
  composer.addPass(post.out);
  return post;
}
