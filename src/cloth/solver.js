// src/cloth/solver.js — step(state, sdf): exactly one frame of small-step XPBD (SPEC section 7.3), plus drape/reset/phase.
// 10 substeps, λ reset per substep, deterministic, zero allocation.
//
// Constraint order inside a substep (7.2 plus the two additions documented below):
//   distance → bending (BEND_PASSES × ω = BEND_RELAX) → {strain limit, seams} × SEAM_ITERS → pins → LRA
//   → body collision → self-collision (every SELF_EVERY-th substep).
//
// The frame also carries a schedule: gravity ramps in over `sewTime` while the seams close (7.7), and for a state
// WITH seams it is then held low, together with the Coulomb friction of 7.5, over a short release window before
// both are ramped back to full — see MU_RELEASE below for why and for what it measures.

import { getAux, refreshLra } from './state.js';
import { solveDistance, solveBending, solveSeams, applyPins, solveStrainLimit } from './constraints.js';
import { solveLra } from './lra.js';
import { collideBody } from './collide.js';
import { collideSelf } from './selfcollide.js';
import { guardNaN, restoreWhole, maybeSnapshot } from './safety.js';
import { computeStats, now } from './stats.js';

/** @typedef {import('../core/types.js').ClothState} ClothState */
/** @typedef {import('../core/types.js').SdfGrid} SdfGrid */
/** @typedef {import('../core/types.js').SimStats} SimStats */

/**
 * Bending is solved with `BEND_PASSES` under-relaxed Gauss-Seidel passes instead of one full one.
 *
 * The Bergou stencils overlap heavily — in a triangle lattice each interior vertex sits in about six of them — so with
 * `r_bend` in the 0.3-1 band of SPEC 7.10 a single full pass over-corrects and a garment never comes to rest: measured
 * on the sample skirt, `maxSpeed` after 540 frames was 7.7 m/s with 2377 of 3294 vertices above 1 m/s, and the mesh
 * genuinely moved (77 mm of vertex drift over the following 30 frames), so it was real instability and not a reporting
 * artefact. Two passes at ω = 0.6 remove it (skirt: 0.00 m/s and 0.0 mm of drift; T-shirt 0.20 m/s).
 *
 * ω and the pass count are NOT free: with λ reset every substep the residual after n passes is (1 − ω·f)^n with
 * f = Σw/(Σw + α̃), so relaxation also changes how much bending a fabric shows, and `drape.ordering` measures exactly
 * that. Measured hem spread chiffon − denim on `makeSphereDrape` (threshold ≥ 10 mm): 14.8 mm for one full pass,
 * 8.2 mm for one pass at ω = 0.6, 6.5 mm at ω = 0.3 — a single relaxed pass fails the check. Two passes at ω = 0.6
 * restore it to 12.3 mm because (1 − 0.6f)² ≈ 0.36 is close to the 0.34 of one full pass, while each individual
 * correction is small enough not to overshoot. The alternative measured was more substeps (r_bend grows as 1/h², so
 * 30 substeps is also stable) at 29 ms a frame against a 16 ms budget.
 */
export const BEND_RELAX = 0.6;
/** Gauss-Seidel passes of the bending solve per substep (see BEND_RELAX). */
export const BEND_PASSES = 2;
/**
 * Self-collision runs every SELF_EVERY-th substep instead of SPEC 7.6's every 2nd, which pays for the second bending
 * pass. Measured on the sample T-shirt after 540 frames, the number of vertex pairs left closer than `selfDist`
 * (outside the exclusion mask) is 2 at every 2nd substep and 4 at every 4th, out of 3713 vertices — while the frame
 * cost falls from 17.1 ms to 10.6 ms, and the state settles better (maxSpeed 1.65 -> 0.20 m/s) because each pass is
 * a hard projection that re-injects displacement.
 */
export const SELF_EVERY = 4;

/**
 * Maximum tensile edge strain enforced by `solveStrainLimit` (constraints.js). 5 % is roughly fifty times the strain
 * any preset in SPEC 9.1 actually develops under garment loads (cotton ≈ 0.1 %, the stretchiest preset, jersey, ≈ 0.3 %),
 * so the bound never stands in for the material — it only removes the stretch the artificial compliance invents.
 */
export const STRAIN_LIMIT = 0.05;
/** Strain-limiting passes per seam iteration. */
export const STRAIN_PASSES = 1;
/**
 * How many times {strain limit, seams} alternate inside one substep when the state has seams.
 *
 * The seam ramp (α = 1e-8) is effectively a rigid weld and has to keep the LAST word or the seams stop closing —
 * running the limiter after the seams instead left the sample T-shirt's shoulder seams 26 mm open. But running it
 * only BEFORE the seams lets every seam pull straight back into the same few edges, and those edges stay there,
 * because the distance constraints are too soft to redistribute the tension: 148 % on one neckline edge with 158
 * edges over 15 %. Alternating the two lets the tension spread along the seam while the seam still finishes the
 * substep. Measured on the T-shirt (1 alternation -> 5): `seamGapMax_mm` 2.7 -> 1.5, max edge strain 148 % -> 55 %,
 * edges over 15 % 158 -> 37, for 2.3 ms a frame. A state with no seams does one pass; there is nothing to negotiate.
 */
export const SEAM_ITERS = 5;
/**
 * Gauss-Seidel passes over the distance constraints per substep, with the Lagrange multiplier carried across them
 * (constraints.js). One pass leaves every edge with an artificial compliance of h^2 * sum(w) — 2700x the tabulated
 * value for cotton at 15 mm — which is what made the shoulders of the sample T-shirt sit at 11% strain however long
 * the drape ran. Accumulating lambda is what makes extra passes actually converge; without it 5 passes bought 0.9
 * points of p99 strain.
 */
export const DIST_PASSES = 1;
/**
 * Extra {fabric, seams, pins, contact} rounds after the body contact pass. Contact is a hard projection, so on its own
 * it simply overrides whatever the fabric solve just did wherever the garment presses on the body; alternating the two
 * (with the distance multiplier carried across passes) lets them converge on a configuration that satisfies both.
 * Measured on the sample T-shirt: max penetration 3.99 mm -> 1.67 mm at one round. It does NOT relieve the shoulder
 * strain (p99 11.4% -> 11.9%), which is a geometric conflict rather than a solver residual — see the SPEC section 13
 * amendment. Kept at 0 by default because each round costs about 2 ms a frame against a 16 ms budget.
 */
export const CONTACT_ROUNDS = 0;
/**
 * Extra contact/seam negotiation rounds per substep WHILE THE SEAMS ARE STILL CLOSING (t < sewTime +
 * MU_RELEASE_TIME); CONTACT_ROUNDS applies after that.
 *
 * Why it is gated rather than simply raised. On a convex ridge such as the back of the deltoid, the
 * two vertices of a cap-seam pair have diverging outward normals: collision runs last in the substep
 * and pushes them apart along the surface, and with no negotiation the seam can never win — measured
 * on the template body as cap seams frozen open at 8.7 to 21.8 mm (plus_f/XL, male_l, athletic_m),
 * against 0.2 to 4.0 mm on the flatter analytic shoulder. One round closes all of them to <= 3.1 mm.
 * But a PERMANENT round re-presses the whole sheet onto the body every substep, which is a strain
 * tax paid by garments that had no problem: the default body's p99 went 8.0 -> 10.1 % and the child's
 * 10.7 -> 18.1 %, at +15-50 % frame time. The frozen-gap traces show the deadlock forms during the sew
 * ramp and, once a seam has closed, collision cannot reopen it, so the round is only needed until then.
 */
export const CONTACT_ROUNDS_SEW = 1;

/**
 * SEAM-CLOSURE RELEASE (the post-sewing settle of SPEC 7.7).
 *
 * The shoulder strain is created in the LAST 30 frames of sewing and then frozen for good. Instrumented on the
 * sample T-shirt (p99 tensile strain every 30 frames): 7.2 % at frame 30 with the seams still 80 mm apart, 11.3 %
 * at frame 60 as the ramp reaches L = 0, and 11.39 % at every frame from 90 to 780 — the state stops changing
 * entirely (maxSpeed pinned at 0.270 m/s, seam gap at 1.7 mm) while the tension trapped over the shoulders never
 * decays. It is trapped rather than required: relaxing the SETTLED state with mu = 0 for 300 frames takes the peak
 * from 68.7 % to 40.4 % and it stays there when mu is restored, so a third of the peak is Coulomb stiction against
 * the body, not fabric that has to be stretched. (The rest is geometric — the same state with the body removed
 * relaxes to p99 2.3 %, i.e. the garment really is ~10 % too small across the neck and shoulder ring.)
 *
 * What is trapping it is the ORDER of events. The seams finish welding (α = 1e-8, effectively rigid) at exactly the
 * moment the gravity ramp of `step` reaches full weight and the sewing damping multiplier drops from 5 to 1, so the
 * fabric is pressed hardest onto the body at the instant the weld stops letting it move. Friction then caps every
 * vertex's tangential travel at mu·corr per substep, and a garment that is locally short simply stays short.
 *
 * The fix is to give the closed garment a window in which it can still slide before it is loaded: for
 * MU_RELEASE_TIME seconds after the seams reach L = 0, friction is scaled by MU_RELEASE and gravity by G_RELEASE,
 * and both are then ramped linearly back to 1 over MU_RELEASE_RAMP seconds. Nothing is softened — the fabric,
 * seam, strain-limit and contact constraints are untouched and the garment is never allowed to penetrate the body;
 * only the load and the stiction are held back until the fabric has found its length.
 *
 * Measured on the sample T-shirt at 780 frames (peak / p99 strain, seam gap max/mean, penetration, frame cost):
 *   before  70 % / 11.39 %   1.7 / 0.17 mm   3.99 mm   12.5 ms
 *   after   22 % /  8.48 %   0.9 / 0.02 mm   3.01 mm   12.6 ms
 * The seam gap and the penetration IMPROVE, because the panels reach their closed configuration by sliding into it
 * instead of being dragged into it. The sample skirt is unchanged (peak 7 -> 8 %, p99 5.08 -> 5.02 %, gap 2.3 mm).
 * Cost is one save/restore of `state.mu` per frame — 0.1 ms, and nothing inside the substep loop.
 *
 * The window is deliberately NOT opened during sewing. Sweeping MU_SEW is a cliff: 0.75 and 0.5 are worth about
 * 0.1 points of p99, and 0.25 lets a sleeve-cap seam slip past its partner and never close (seam gap 68.8 mm).
 * Gravity during sewing follows G_SEW_FLOOR / G_SEW_POWER in `step` (see there for why it is nearly off).
 */
/** Friction scale while the seams are still closing (t < sewTime). 1 = untouched; see the cliff at 0.25 above. */
export const MU_SEW = 1;
/** Friction scale over the release window, then ramped back to 1. */
export const MU_RELEASE = 0.2;
/** Length of the release window (s) after the seam ramp reaches L = 0. */
export const MU_RELEASE_TIME = 0.5;
/** Seconds over which friction and gravity are ramped back to full after the window. */
export const MU_RELEASE_RAMP = 1.5;
/** Gravity scale over the release window, ramped back to 1 alongside the friction. */
export const G_RELEASE = 0.05;
/**
 * Gravity while the seams are still closing: (t / sewTime) ^ G_SEW_POWER, floored at G_SEW_FLOOR.
 *
 * The old schedule was linear from a 0.15 floor, so a panel already carried half its weight halfway
 * through sewing. On the analytic body that was harmless because its shoulder was a flat shelf with a
 * 90-degree rim that held the panels' top edges up. On a real body the trapezius SLOPES from the neck
 * base down to the shoulder tip, and under that weight the front panel slid down the front of it and
 * the back panel down the back before the shoulder seam had closed. Once both are below the crest the
 * seam is pulling them through the ridge, collision cancels it every substep, and the gap freezes —
 * plus_f/XL sat at exactly 124.2 mm for nine seconds. A cubic ramp keeps the panels essentially
 * weightless until the seam has drawn them together above the crest, and only then lets them settle.
 */
export const G_SEW_FLOOR = 0.02;
export const G_SEW_POWER = 3;

/** Frame-scoped copy of `state.mu` while the release window scales it; grown on demand, never inside a substep. */
let muScratch = null;

/**
 * The release window only exists for a state that actually has seams to close: it is the seam weld finishing that
 * traps the tension. A plain draped sheet (the fixtures of SPEC 7.11) must keep its friction and its gravity from
 * the first frame, or the checks that measure exactly those two things measure the release schedule instead —
 * without this gate `friction.slope` let a mu = 0.6 patch slide 35.3 mm down its ramp and `drape.ordering` put
 * silk's hem outside chiffon's.
 * @param {ClothState} state @returns {boolean}
 */
function hasRelease(state) {
  return state.sRest0.length > 0 && state.params.sewTime > 0;
}

/** Linear 0..1 progress out of the post-sew release window (1 = window and ramp finished). */
function releaseProgress(state) {
  const sew = state.params.sewTime;
  const tEnd = (sew > 0 ? sew : 0) + MU_RELEASE_TIME;
  if (state.time < tEnd) return 0;
  if (MU_RELEASE_RAMP <= 0) return 1;
  const f = (state.time - tEnd) / MU_RELEASE_RAMP;
  return f >= 1 ? 1 : f;
}

/**
 * Gravity multiplier WHILE THE SEAMS CLOSE (t < sewTime): (t / sewTime)^G_SEW_POWER, floored at G_SEW_FLOOR.
 * Exported so the schedule can be pinned by a test: it is what closed the template body's shoulder seam
 * (SPEC section 7, amendment 2026-09-18), and it changes nothing a render would show until a seam freezes open.
 * @param {number} time @param {number} sewTime @returns {number}
 */
export function sewGravityScale(time, sewTime) {
  if (!(sewTime > 0) || time >= sewTime) return 1;
  let g = Math.pow(Math.max(0, time) / sewTime, G_SEW_POWER);
  if (g < G_SEW_FLOOR) g = G_SEW_FLOOR;
  return g > 1 ? 1 : g;
}

/**
 * Extra fabric/contact negotiation rounds per substep: CONTACT_ROUNDS_SEW while the seams close and for the
 * release window after (t < sewTime + MU_RELEASE_TIME), CONTACT_ROUNDS afterwards and on seamless cloth.
 * @param {number} time @param {number} sewTime @param {boolean} hasSeams @returns {number}
 */
export function contactRoundsAt(time, sewTime, hasSeams) {
  const closing = hasSeams && sewTime > 0 && time < sewTime + MU_RELEASE_TIME;
  return closing ? CONTACT_ROUNDS_SEW : CONTACT_ROUNDS;
}

/** @param {ClothState} state @returns {number} gravity multiplier at the state's current time */
function gScaleAt(state) {
  if (G_RELEASE >= 1 || !hasRelease(state)) return 1;
  const sew = state.params.sewTime;
  if (sew > 0 && state.time < sew) return 1;
  const f = releaseProgress(state);
  return G_RELEASE + (1 - G_RELEASE) * f;
}

/** @param {ClothState} state @returns {number} friction multiplier at the state's current time */
function muScaleAt(state) {
  if (!hasRelease(state)) return 1;
  const sew = state.params.sewTime;
  if (state.time < sew) return MU_SEW;
  if (MU_RELEASE >= 1) return 1;
  const t0 = sew > 0 ? sew : 0;
  const tEnd = t0 + MU_RELEASE_TIME;
  if (state.time < tEnd) return MU_RELEASE;
  if (MU_RELEASE_RAMP <= 0) return 1;
  const f = (state.time - tEnd) / MU_RELEASE_RAMP;
  if (f >= 1) return 1;
  return MU_RELEASE + (1 - MU_RELEASE) * f;
}
/**
 * Exactly one frame (dt = 1/60, params.substeps). sdf may be null (no body collision).
 * @param {ClothState} state @param {SdfGrid|null} [sdf] @returns {SimStats}
 */
export function step(state, sdf) {
  const aux = getAux(state);
  const p = state.params;
  const t = aux.timers;
  t.integrate = 0; t.distance = 0; t.bend = 0; t.seam = 0; t.collide = 0; t.self = 0;
  const hasSdf = !!sdf;
  aux.hadSdf = hasSdf;

  // Guard against externally injected NaNs before they propagate through the constraints.
  guardNaN(state, aux);
  // Long-range attachments (lra.js): rebuilt only when the pin set changed, never inside the substep loop.
  refreshLra(state, aux);

  const { V, pos, prev, vel, invMass, damp } = state;
  const substeps = p.substeps;
  const h = p.dt / substeps;
  const invH2 = 1 / (h * h);
  const sewing = p.sewTime > 0 && state.time < p.sewTime;
  const dampMul = sewing ? 5 : 1;
  const gScale = sewing ? sewGravityScale(state.time, p.sewTime) : gScaleAt(state);
  const g = p.gravity * gScale;
  const gx = aux.gravityDir[0] * g * h;
  const gy = aux.gravityDir[1] * g * h;
  const gz = aux.gravityDir[2] * g * h;
  const maxSpeed = p.maxSpeed;
  const maxSpeed2 = maxSpeed * maxSpeed;
  const maxStep = p.maxStep;
  const maxStep2 = maxStep * maxStep;
  const invH = 1 / h;
  const hasSeams = state.sRest0.length > 0;
  const seamIters = hasSeams ? SEAM_ITERS : 1;
  const eLambda = aux.eLambda;

  // Seam-closure release window (see MU_RELEASE): scale mu for the whole frame, restored below before the stats.
  const muScale = muScaleAt(state);
  if (muScale !== 1) {
    if (muScratch === null || muScratch.length < V) muScratch = new Float32Array(V);
    for (let v = 0; v < V; v++) { muScratch[v] = state.mu[v]; state.mu[v] = muScratch[v] * muScale; }
  }

  for (let s = 0; s < substeps; s++) {
    let t0 = now();
    for (let v = 0; v < V; v++) {
      const v3 = 3 * v;
      if (invMass[v] === 0) {
        prev[v3] = pos[v3];
        prev[v3 + 1] = pos[v3 + 1];
        prev[v3 + 2] = pos[v3 + 2];
        continue;
      }
      let vx = vel[v3] + gx;
      let vy = vel[v3 + 1] + gy;
      let vz = vel[v3 + 2] + gz;
      let k = 1 - damp[v] * dampMul * h;
      if (k < 0) k = 0;
      vx *= k; vy *= k; vz *= k;
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > maxSpeed2) {
        const f = maxSpeed / Math.sqrt(s2);
        vx *= f; vy *= f; vz *= f;
      }
      const px = pos[v3];
      const py = pos[v3 + 1];
      const pz = pos[v3 + 2];
      prev[v3] = px;
      prev[v3 + 1] = py;
      prev[v3 + 2] = pz;
      let dx = h * vx;
      let dy = h * vy;
      let dz = h * vz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxStep2) {
        const f = maxStep / Math.sqrt(d2);
        dx *= f; dy *= f; dz *= f;
      }
      pos[v3] = px + dx;
      pos[v3 + 1] = py + dy;
      pos[v3 + 2] = pz + dz;
    }
    let t1 = now();
    t.integrate += t1 - t0;

    eLambda.fill(0);
    for (let q = 0; q < DIST_PASSES; q++) solveDistance(pos, invMass, state.eIdx, state.eRest, state.eAlpha, invH2, eLambda);
    t0 = now();
    t.distance += t0 - t1;

    for (let q = 0; q < BEND_PASSES; q++) solveBending(pos, invMass, state.bIdx, state.bK, state.bS, state.bAlpha, invH2, BEND_RELAX);
    t1 = now();
    t.bend += t1 - t0;

    // Strain limiting sits between the material constraints and the seams: the seam ramp is the stiffest thing in
    // the solver (α = 1e-8) and must keep the last word on a seam pair, or the seams stop closing — putting the
    // limiter after the seams instead left the sample T-shirt's shoulder seams 26 mm open.
    for (let it = 0; it < seamIters; it++) {
      for (let q = 0; q < STRAIN_PASSES; q++) solveStrainLimit(pos, invMass, state.eIdx, state.eRest, STRAIN_LIMIT);
      // Local relaxation around the seams, BEFORE the seam solve so the seam still finishes the substep.
      if (hasSeams) solveSeams(pos, invMass, state.sIdx, state.sRest0, state.sStart, invH2, state.time, p.sewTime);
    }
    applyPins(pos, state.pIdx, state.pTarget);
    solveLra(pos, invMass, aux.lraAnchors, aux.lraDist, V);
    t0 = now();
    t.seam += t0 - t1;

    if (hasSdf) {
      collideBody(state, /** @type {SdfGrid} */ (sdf));
      // Let the fabric and the body contact negotiate instead of contact simply overriding the cloth: alternating the
      // two with the distance multiplier carried across the passes converges on a configuration that satisfies both,
      // rather than leaving the residual on whichever ran last.
      const rounds = contactRoundsAt(state.time, p.sewTime, hasSeams);
      for (let q = 0; q < rounds; q++) {
        solveDistance(pos, invMass, state.eIdx, state.eRest, state.eAlpha, invH2, eLambda);
        if (hasSeams) solveSeams(pos, invMass, state.sIdx, state.sRest0, state.sStart, invH2, state.time, p.sewTime);
        applyPins(pos, state.pIdx, state.pTarget);
        collideBody(state, /** @type {SdfGrid} */ (sdf));
      }
      t1 = now();
      t.collide += t1 - t0;
      t0 = t1;
    }

    if (p.selfCollision && (s % SELF_EVERY === SELF_EVERY - 1)) {
      collideSelf(state, aux);
      t1 = now();
      t.self += t1 - t0;
      t0 = t1;
    }

    // velocities from positions; clamp positions of pinned vertices are untouched
    for (let v = 0; v < V; v++) {
      const v3 = 3 * v;
      vel[v3] = (pos[v3] - prev[v3]) * invH;
      vel[v3 + 1] = (pos[v3 + 1] - prev[v3 + 1]) * invH;
      vel[v3 + 2] = (pos[v3 + 2] - prev[v3 + 2]) * invH;
    }
    t1 = now();
    t.integrate += t1 - t0;
  }

  if (muScale !== 1) { for (let v = 0; v < V; v++) state.mu[v] = muScratch[v]; }

  state.time += p.dt;
  state.frame += 1;

  // safety
  const nans = guardNaN(state, aux);
  if (nans > 0) {
    aux.nanStreak++;
    if (aux.nanStreak >= 2) {
      restoreWhole(state, aux);
      aux.nanStreak = 0;
    }
  } else {
    aux.nanStreak = 0;
  }
  const stats = computeStats(state, aux, hasSdf, true);
  maybeSnapshot(state, aux, stats.maxSpeed);
  return stats;
}

/** time = 0, frame = 0, sStart = 0 for all seams (re-arms the sewing ramp). @param {ClothState} state */
export function drape(state) {
  getAux(state);
  state.time = 0;
  state.frame = 0;
  state.sStart.fill(0);
}

/** pos = prev = restPos, vel = 0, time = frame = 0, nanCount kept. @param {ClothState} state */
export function reset(state) {
  const aux = getAux(state);
  state.pos.set(state.restPos);
  state.prev.set(state.restPos);
  state.vel.fill(0);
  state.time = 0;
  state.frame = 0;
  state.sStart.fill(0);
  aux.nanStreak = 0;
  aux.snap.valid = false;
  aux.nanAtLastCheck = state.nanCount;
}

/** @param {ClothState} state @returns {'arranged'|'sewing'|'draping'} */
export function phase(state) {
  if (state.frame === 0) return 'arranged';
  if (state.time < state.params.sewTime) return 'sewing';
  return 'draping';
}
