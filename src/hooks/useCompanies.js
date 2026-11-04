// src/hooks/useCompanies.js
//
// Single source of truth for the battalion's company names.
// Reads `settings/companies` in Firestore in real-time so every page
// reflects a change made in AdminCompanies instantly, with no redeploy.
//
// Shape of the Firestore doc:
//   settings/companies  →  { names: ["Alpha", "Bravo", "Charlie", "Delta"] }
//
// "Battalion" is NOT a company — it is a separate designation for battalion
// staff / leadership and is never stored in this list. Pages that need to
// present Battalion as an option (roster tabs, account forms, etc.) inject
// it manually.
//
// Falls back to the four default names while loading or when the doc
// doesn't exist yet (first-run / offline), so every caller is safe to
// destructure without guarding for undefined.

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

const DEFAULT_COMPANIES = ["Alpha", "Bravo", "Charlie", "Delta"];

export function useCompanies() {
  const [companies, setCompanies] = useState(DEFAULT_COMPANIES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'companies'),
      (snap) => {
        if (snap.exists()) {
          const names = snap.data()?.names;
          if (Array.isArray(names) && names.length > 0) {
            setCompanies(names);
          } else {
            setCompanies(DEFAULT_COMPANIES);
          }
        } else {
          // Doc hasn't been written yet - keep defaults
          setCompanies(DEFAULT_COMPANIES);
        }
        setLoading(false);
      },
      () => {
        // Firestore offline / permission error - keep defaults
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  // companiesWithBattalion always includes 'Battalion' at the end.
  // Use this anywhere a dropdown or list must offer Battalion as an option.
  const companiesWithBattalion = [...companies, 'Battalion'];

  return { companies, companiesWithBattalion, loading };
}
