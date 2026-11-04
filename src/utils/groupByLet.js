// src/utils/groupByLet.js
//
// Groups an array of entries into LET-level buckets, each sorted A-Z by name.
// Returns [{ level, entries }] with known levels first (LET 1→4), then Unknown.

const ORDER = ['LET 1', 'LET 2', 'LET 3', 'LET 4'];

/**
 * @param {any[]} entries
 * @param {(entry: any) => string} getLevel  — returns the LET level string (e.g. 'LET 2')
 * @param {(entry: any) => string} getName   — returns the cadet's full name for A-Z sort
 * @returns {{ level: string, entries: any[] }[]}
 */
export function groupByLet(entries, getLevel, getName) {
  const buckets = {};
  for (const entry of entries) {
    const level = (getLevel(entry) || '').trim() || 'Unknown';
    if (!buckets[level]) buckets[level] = [];
    buckets[level].push(entry);
  }

  // Sort within each bucket A-Z by name
  for (const level of Object.keys(buckets)) {
    buckets[level].sort((a, b) =>
      (getName(a) || '').localeCompare(getName(b) || '', undefined, { sensitivity: 'base' })
    );
  }

  // Order: known LET levels first, then everything else alphabetically
  const keys = Object.keys(buckets).sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  return keys.map(level => ({ level, entries: buckets[level] }));
}
