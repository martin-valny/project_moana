import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Follows `target` with critically-damped spring motion.
 *
 * Round 14, mechanism 4. The ocean's filaments now advect with the scrubber
 * (`uScrubHours` in `GlobeSphere.tsx`), which is what makes dragging the
 * timeline read as pulling the water along rather than re-drawing it. Driving
 * that straight off the pointer value undoes the effect: the field teleports
 * between positions instead of being dragged, and a fast flick reads as a
 * jump cut.
 *
 * Critically damped (`zeta = 1`) rather than under-damped on purpose — the
 * scrubber should feel weighted, never springy or bouncy. It settles as fast
 * as possible without overshooting the value the user actually chose, which
 * matters because the timeline's labelled stops are exact positions (§8's
 * Now / Tomorrow / 3 Days) and overshoot would visibly slide past them.
 *
 * Honours `prefers-reduced-motion` by snapping instead — this is decorative
 * easing, exactly the class of motion that preference is about, and it also
 * keeps the Playwright checks deterministic (they all set reducedMotion).
 *
 * **The integration step itself was numerically unstable at its own
 * documented worst case, not just under some rare race.** Found live (a
 * user dragging the actual running app, not a screenshot): a slow drag near
 * the timeline's own start made `scrubHours` reach -103,339 within a
 * handful of real frames — reproduced directly, then root-caused by logging
 * every step: semi-implicit Euler on this critically-damped spring is only
 * stable while `omega * dt` stays under ~0.83 (`omega = 2*pi*frequencyHz`).
 * At the default `frequencyHz = 5`, `omega ≈ 31.4`, and the step's own
 * existing ceiling — `dt` clamped to `1/30`, added specifically so a
 * backgrounded tab returning after seconds wouldn't integrate one huge step
 * — gives `omega * dt ≈ 1.05`, past the stability line. Checked numerically
 * (eigenvalues of the discrete update matrix): `dt = 1/30` has a max
 * eigenvalue of **1.80** (unconditionally diverging), `dt = 1/60` has
 * **0.74** (stable). A single frame at the clamped ceiling barely nudges
 * the value; several *consecutive* ones — exactly what a heavily loaded
 * WebGL frame under real interaction produces, and what this project's own
 * software-rendered sandbox produces on nearly every frame — compound the
 * instability into the divergence actually observed.
 *
 * Fixed by never taking a single physics step longer than `MAX_STABLE_DT`
 * (chosen with real margin below the ~0.83 line, not sitting on it): a
 * frame whose real elapsed time is longer is *sub-stepped* — integrated as
 * several `MAX_STABLE_DT`-sized steps back to back — rather than clamped
 * and taken as one too-large step. This keeps the simulation both stable
 * and accurate at any real frame rate, from 120fps down to the handful of
 * fps this sandbox's software renderer manages, instead of only being
 * correct in the narrow band this hook happened to be tuned and tested
 * against before.
 *
 * **The animation loop also must not be torn down and rebuilt on every
 * `target` change** (a drag fires many pointermove events per second) —
 * `step` already reads the live value through `targetRef`, not a captured
 * `target`, so restarting the whole loop per change was always unnecessary,
 * and — before the stability fix above — restarting it repeatedly is also
 * what produced the sustained run of large steps that exposed the
 * instability in the first place. `startLoop` is a stable function, a
 * no-op whenever a loop is already running (`rafIdRef` doubles as "is one
 * scheduled" and the id to cancel); calling it on every pointermove now
 * costs nothing beyond that one check.
 */

/**
 * The largest single step `step()` will ever integrate, chosen with real
 * margin under the ~0.83 `omega * dt` stability line derived above for the
 * default `frequencyHz = 5` (`omega ≈ 31.4`): `31.4 * (1/60) ≈ 0.52`.
 * Anything slower than one `1/60`s tick sub-steps instead of taking one
 * larger, unstable step.
 */
const MAX_STABLE_DT = 1 / 60;

export function useDampedValue(target: number, frequencyHz = 5): number {
  // Read once at mount rather than on every `target` change — the
  // preference realistically never flips mid-session.
  const prefersReducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  const [value, setValue] = useState(target);
  const stateRef = useRef({ position: target, velocity: 0 });
  const targetRef = useRef(target);
  const rafIdRef = useRef(0);
  const lastRef = useRef(0);
  targetRef.current = target;

  const startLoop = useMemo(() => {
    const step = (now: number) => {
      // Upper-bounded so a backgrounded tab returning after seconds doesn't
      // sub-step for a very long time trying to "catch up" — one second of
      // silently-skipped motion is not perceptible, so there's nothing to
      // reconstruct. Lower-bounded at 0: `now` is not guaranteed to be >=
      // this closure's own `lastRef.current` on every call (two scheduled
      // frames landing out of order is possible under React's own
      // scheduling), and a negative elapsed time has no valid meaning for a
      // forward integrator — treat it as "no time passed" rather than
      // running the physics backward, which flips every damping term into
      // an energy-injecting one.
      const elapsed = Math.max(0, Math.min((now - lastRef.current) / 1000, 1));
      lastRef.current = now;

      const omega = 2 * Math.PI * frequencyHz;
      const s = stateRef.current;

      // Sub-step rather than clamp-and-take-one-step — see the module
      // comment for why a single step at this hook's old `1/30` ceiling is
      // numerically unstable at this `omega`, not merely imprecise.
      let remaining = elapsed;
      while (remaining > 0) {
        const dt = Math.min(remaining, MAX_STABLE_DT);
        remaining -= dt;

        const displacement = s.position - targetRef.current;
        // Semi-implicit Euler: velocity first, then position from the NEW
        // velocity. Explicit Euler is unstable at these stiffnesses and
        // would oscillate rather than settle.
        s.velocity += (-omega * omega * displacement - 2 * omega * s.velocity) * dt;
        s.position += s.velocity * dt;
      }

      // Settle exactly, so the value lands on the timeline's labelled stops
      // rather than creeping toward them forever.
      if (Math.abs(s.position - targetRef.current) < 1e-3 && Math.abs(s.velocity) < 1e-3) {
        s.position = targetRef.current;
        s.velocity = 0;
        setValue(s.position);
        rafIdRef.current = 0;
        return;
      }

      setValue(s.position);
      rafIdRef.current = requestAnimationFrame(step);
    };

    return () => {
      if (rafIdRef.current) return; // already running — targetRef is enough
      lastRef.current = performance.now();
      rafIdRef.current = requestAnimationFrame(step);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stateRef/targetRef/rafIdRef/lastRef are refs, stable by construction.
  }, [frequencyHz]);

  useEffect(() => {
    if (prefersReducedMotion) {
      stateRef.current = { position: target, velocity: 0 };
      setValue(target);
      return;
    }
    startLoop();
  }, [target, startLoop, prefersReducedMotion]);

  // Unmount only: cancel whatever frame is in flight. Must reset
  // `rafIdRef` back to 0 after cancelling, not just call
  // `cancelAnimationFrame` — React StrictMode double-invokes every effect
  // in dev (mount, cleanup, mount again) specifically to catch missing
  // cleanup like this. Without the reset, this cleanup's cancel leaves
  // `rafIdRef.current` holding a stale, already-cancelled id that is still
  // truthy, so `startLoop`'s "already running" guard treats the (dead) loop
  // as active forever and silently never reschedules a frame again — found
  // by testing this exact fix in dev mode: `offsetHours` kept updating
  // correctly but `scrubHours` froze at its initial value permanently, in
  // dev only (`npm run build` / `npm run preview`, which don't
  // double-invoke, never showed it).
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, []);

  return value;
}
