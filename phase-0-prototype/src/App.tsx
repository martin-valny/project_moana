import { useMemo, useState } from 'react';
import { Globe } from './three/Globe';
import { Masthead } from './components/Masthead';
import { Timeline } from './components/Timeline';
import { SwellPanel } from './components/SwellPanel';
import { Attribution } from './components/Attribution';
import { useFollow } from './hooks/useFollow';
import { buildHelenaPulse, HELENA_MAX_OFFSET_HOURS, HELENA_MIN_OFFSET_HOURS, shortLabelFor } from './data/helena';
import { interpolatePulseAt } from './data/interpolate';
import './App.css';

const STOPS = [
  { label: 'Now', hours: 0 },
  { label: 'Tomorrow', hours: 24 },
  { label: '3 Days', hours: 72 },
];

/**
 * Phase 0 — visual-only prototype (MASTER_BUILD_PLAN.md §8), restyled
 * per the visual-engine brief: a domain-warped fBm globe, a minimal
 * masthead, a draggable timeline, and a right-side glass panel on
 * selection. No live data, no backend. One hardcoded swell ("Helena").
 */
export default function App() {
  const [startTime] = useState(() => new Date());
  const pulse = useMemo(() => buildHelenaPulse(startTime), [startTime]);

  const [offsetHours, setOffsetHours] = useState(0);
  const [selected, setSelected] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const currentPoint = useMemo(() => {
    const target = new Date(startTime.getTime() + offsetHours * 60 * 60 * 1000);
    return interpolatePulseAt(pulse, target);
  }, [pulse, offsetHours, startTime]);

  const { isFollowed, toggleFollow } = useFollow(pulse.id);

  return (
    <div className="app">
      <Globe pulse={pulse} currentPoint={currentPoint} onSelectHelena={() => setSelected((v) => !v)} />

      <div className="overlay">
        <div className="topLeft">
          <Masthead onOpenInfo={() => setInfoOpen(true)} />
        </div>

        <div className="bottomCenter">
          <Timeline
            hours={offsetHours}
            minHours={HELENA_MIN_OFFSET_HOURS}
            maxHours={HELENA_MAX_OFFSET_HOURS}
            stops={STOPS}
            onChange={setOffsetHours}
          />
        </div>
      </div>

      {selected && (
        <SwellPanel pulse={pulse} shortLabel={shortLabelFor(currentPoint.heading_deg)} isFollowed={isFollowed} onToggleFollow={toggleFollow} />
      )}

      <Attribution open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}
