import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Circle, CheckCircle2, X, PartyPopper } from 'lucide-react';

/**
 * Dismissible "getting started" checklist. State lives in localStorage,
 * not Firestore — a soft onboarding nudge, not a tracked/enforced requirement.
 *
 * State is keyed by `storageKey` so a cadet promoted to staff sees the
 * staff list fresh instead of inheriting the cadet list's state.
 *
 * Checking an item plays a brief CSS fade-out before removing it from the
 * list. The card auto-dismisses 2.5 s after the last item is checked.
 *
 * @param {string}   storageKey  - unique per checklist variant ('cadet', 'staff')
 * @param {string}   title
 * @param {Array}    items       - [{id, label, description, link, linkText}]
 */
const OnboardingChecklist = ({ storageKey, title, items }) => {
  const dismissedKey = `onboarding-${storageKey}-dismissed`;
  const checkedKey   = `onboarding-${storageKey}-checked`;

  // Lazy initialisers read localStorage synchronously on first render —
  // no flash where the card briefly shows before hiding.
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissedKey) === 'true',
  );
  const [checked, setChecked] = useState(() => {
    try { return JSON.parse(localStorage.getItem(checkedKey) || '[]'); }
    catch { return []; }
  });
  // Ids currently fading out (CSS opacity → 0 before removal)
  const [leaving, setLeaving] = useState([]);

  const dismiss = () => {
    localStorage.setItem(dismissedKey, 'true');
    setDismissed(true);
  };

  if (dismissed) return null;

  const remaining = items.filter(item => !checked.includes(item.id));
  const allDone   = remaining.length === 0;

  // Auto-dismiss 2.5 s after all items are checked.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(dismiss, 2500);
    return () => clearTimeout(t);
  }, [allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const completeItem = (id) => {
    if (checked.includes(id) || leaving.includes(id)) return;
    // Start CSS fade-out, then move to checked after transition (200 ms).
    setLeaving(prev => [...prev, id]);
    setTimeout(() => {
      setLeaving(prev => prev.filter(x => x !== id));
      const next = [...checked, id];
      setChecked(next);
      localStorage.setItem(checkedKey, JSON.stringify(next));
    }, 200);
  };

  return (
    <div className="mb-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 shadow-sm relative transition-colors">
      <button
        onClick={dismiss}
        type="button"
        title="Hide this checklist"
        className="absolute top-6 right-6 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
      >
        <X size={18} />
      </button>

      {allDone ? (
        <div className="flex items-center gap-3 animate-[fadeIn_0.3s_ease-out]">
          <PartyPopper className="text-yellow-500 shrink-0" size={24} />
          <div>
            <h3 className="font-black uppercase italic text-lg text-slate-900 dark:text-white">You're all set</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Nice work getting through the checklist. This card won't show again once dismissed.
            </p>
          </div>
        </div>
      ) : (
        <>
          <h3 className="font-black uppercase italic text-lg text-slate-900 dark:text-white mb-1">{title}</h3>
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-6">
            {checked.length} of {items.length} complete
          </p>
          <div className="space-y-3">
            {remaining.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-4 rounded-2xl border bg-slate-50 dark:bg-transparent border-slate-200 dark:border-white/5 transition-opacity duration-200"
                style={{ opacity: leaving.includes(item.id) ? 0 : 1 }}
              >
                <button
                  onClick={() => completeItem(item.id)}
                  type="button"
                  className="shrink-0"
                  title="Mark as done"
                >
                  <Circle
                    className="text-slate-300 dark:text-slate-600 hover:text-yellow-500 transition-colors"
                    size={22}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{item.label}</p>
                  {item.description && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{item.description}</p>
                  )}
                </div>
                {item.link && (
                  <Link
                    to={item.link}
                    className="shrink-0 text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 hover:underline whitespace-nowrap"
                  >
                    {item.linkText || 'Go'} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default OnboardingChecklist;
