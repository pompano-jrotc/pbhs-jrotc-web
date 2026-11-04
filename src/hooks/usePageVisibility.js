// src/hooks/usePageVisibility.js
//
// Reads the settings/pageVisibility doc from Firestore so admins can
// hide nav links for pages that are under construction or not relevant.
// Defaults every page to visible so a missing doc doesn't break the nav.

import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export const DEFAULT_VISIBILITY = {
  about:             true,
  'cadet-info':      true,
  'promotion-board': true,
  'winning-colors':  true,
  uniform:           false,
  documents:         true,
  announcements:     true,
  newsletter:        true,
  teams:             true,
  leadership:        true,
  photos:            true,
  events:            true,
  quizzes:           true,
  leaderboard:       true,
};

export function usePageVisibility() {
  const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'pageVisibility'),
      (snap) => {
        if (snap.exists()) setVisibility({ ...DEFAULT_VISIBILITY, ...snap.data() });
        else setVisibility(DEFAULT_VISIBILITY);
      },
      () => setVisibility(DEFAULT_VISIBILITY)
    );
    return () => unsub();
  }, []);

  return visibility;
}
