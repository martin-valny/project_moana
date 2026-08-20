import { useEffect, useRef, useState } from 'react';

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
 */
export function useDampedValue(target: number, frequencyHz = 5): number {
  const [value, setValue] = useState(target);
  const stateRef = useRef({ position: target, velocity: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const snap = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (snap) {
      stateRef.current = { position: target, velocity: 0 };
      setValue(target);
      return;
    }

    let raf = 0;
    let last = performance.now();

    const step = (now: number) => {
      // Clamped so a backgrounded tab returning after seconds does not
      // integrate one enormous step and fling the value past its target.
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;

      const omega = 2 * Math.PI * frequencyHz;
      const s = stateRef.current;
      const displacement = s.position - targetRef.current;
      // Semi-implicit Euler: velocity first, then position from the NEW
      // velocity. Explicit Euler is unstable at these stiffnesses and would
      // oscillate rather than settle.
      s.velocity += (-omega * omega * displacement - 2 * omega * s.velocity) * dt;
      s.position += s.velocity * dt;

      // Settle exactly, so the value lands on the timeline's labelled stops
      // rather than creeping toward them forever.
      if (Math.abs(s.position - targetRef.current) < 1e-3 && Math.abs(s.velocity) < 1e-3) {
        s.position = targetRef.current;
        s.velocity = 0;
        setValue(s.position);
        raf = 0;
        return;
      }

      setValue(s.position);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, frequencyHz]);

  return value;
}
