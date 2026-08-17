import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'moana.swellDiary.followedIds';

/**
 * §8 Phase 0: "Follow persisted locally (AsyncStorage)." This prototype
 * is authored on web per §5.2, so localStorage stands in for
 * AsyncStorage here — same "local-first, no backend" contract (§9.2),
 * same key shape, trivial to swap for the real AsyncStorage call when
 * this ports to Expo.
 */
function readFollowed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function writeFollowed(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private browsing, quota) — Follow just won't persist this session.
  }
}

export function useFollow(pulseId: string) {
  const [followedIds, setFollowedIds] = useState<Set<string>>(() => readFollowed());

  useEffect(() => {
    writeFollowed(followedIds);
  }, [followedIds]);

  const isFollowed = followedIds.has(pulseId);

  const toggleFollow = useCallback(() => {
    setFollowedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pulseId)) next.delete(pulseId);
      else next.add(pulseId);
      return next;
    });
  }, [pulseId]);

  return { isFollowed, toggleFollow };
}
