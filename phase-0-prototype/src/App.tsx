import { useMemo, useState } from 'react';
import { Globe } from './three/Globe';
import { TimeScrubber } from './components/TimeScrubber';
import { SwellPanel } from './components/SwellPanel';
import { Attribution } from './components/Attribution';
import { useFollow } from './hooks/useFollow';
import { buildHelenaPulse } from './data/helena';
import { interpolatePulseAt } from './data/interpolate';
import { SCRUBBER_OFFSETS_HOURS, type ScrubberStop } from './data/types';
import './App.css';

/**
 * Phase 0 — visual-only prototype (MASTER_BUILD_PLAN.md §8).
 * No live data, no backend. One hardcoded swell ("Helena"), a globe,
 * a time scrubber, Follow, and attribution. Nothing else.
 */
export default function App() {
  const [startTime] = useState(() => new Date());
  const pulse = useMemo(() => buildHelenaPulse(startTime), [startTime]);

  const [scrubberStop, setScrubberStop] = useState<ScrubberStop>('now');
  const [panelOpen, setPanelOpen] = useState(false);

  const currentPoint = useMemo(() => {
    const offsetHours = SCRUBBER_OFFSETS_HOURS[scrubberStop];
    const target = new Date(startTime.getTime() + offsetHours * 60 * 60 * 1000);
    return interpolatePulseAt(pulse, target);
  }, [pulse, scrubberStop, startTime]);

  const { isFollowed, toggleFollow } = useFollow(pulse.id);

  return (
    <div className="app">
      <Globe pulse={pulse} currentPoint={currentPoint} onSelectHelena={() => setPanelOpen(true)} />

      <div className="overlay">
        <p className="tagline">The ocean is moving.</p>

        <div className="scrubberDock">
          <TimeScrubber value={scrubberStop} onChange={setScrubberStop} />
        </div>
      </div>

      {panelOpen && (
        <SwellPanel
          pulse={pulse}
          currentPoint={currentPoint}
          isFollowed={isFollowed}
          onToggleFollow={toggleFollow}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <Attribution />
    </div>
  );
}
