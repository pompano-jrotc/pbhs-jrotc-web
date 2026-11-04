// src/components/CadetSearch.jsx
//
// Typeahead cadet picker — type 2+ characters to search by name.
// Props:
//   cadets       — array of { uid, fullName } (already scoped to the right company)
//   value        — currently selected cadet uid ('' = none)
//   onChange     — fn(uid, fullName) called when a cadet is picked or cleared
//   disabled     — bool, locks the field (e.g. while editing an existing record)
//   placeholder  — string (default "Search cadet…")
//   required     — bool
//   inputClass   — Tailwind class string for the input (matches the form's ic style)

import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

const CadetSearch = ({
  cadets       = [],
  value        = '',
  onChange,
  disabled     = false,
  placeholder  = 'Search cadet…',
  required     = false,
  inputClass   = '',
  showCompany  = false,
}) => {
  const selected    = cadets.find(c => c.uid === value) || null;
  const [query,    setQuery]    = useState('');
  const [open,     setOpen]     = useState(false);
  const [focused,  setFocused]  = useState(false);
  const containerRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = e => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const trimmed = query.trim().toLowerCase();
  const filtered = trimmed.length >= 2
    ? cadets.filter(c => c.fullName.toLowerCase().includes(trimmed))
    : [];

  const pick = cadet => {
    onChange(cadet.uid, cadet.fullName);
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    onChange('', '');
    setQuery('');
    setOpen(false);
  };

  // If a cadet is selected, show them as a pill; otherwise show the search input
  if (selected && !disabled) {
    return (
      <div className={`${inputClass} flex items-center justify-between gap-2`}>
        <span className="font-bold text-slate-900 dark:text-white truncate">{selected.fullName}</span>
        <button
          type="button"
          onClick={clear}
          className="shrink-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          aria-label="Clear"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (disabled && selected) {
    return (
      <div className={`${inputClass} text-slate-900 dark:text-white font-bold`}>
        {selected.fullName}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className={`${inputClass} flex items-center gap-2 ${focused ? 'border-yellow-500' : ''}`}>
        <Search size={13} className="shrink-0 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          required={required && !value}
          className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 placeholder:font-normal"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(''); setOpen(false); }}
            className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={12} />
          </button>
        )}
      </div>

      {open && trimmed.length >= 2 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400 italic">No cadets match "{query}"</p>
          ) : (
            filtered.map(c => (
              <button
                key={c.uid}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(c); }}
                className="w-full text-left px-4 py-2.5 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-colors"
              >
                <span className="text-sm font-bold text-slate-800 dark:text-slate-200 hover:text-yellow-700 dark:hover:text-yellow-400">{c.fullName}</span>
                {showCompany && c.company && (
                  <span className="ml-2 text-[10px] font-black uppercase tracking-wider text-slate-400">{c.company}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* Hidden native select so browser form validation / required works */}
      {required && (
        <select
          tabIndex={-1}
          aria-hidden
          value={value}
          onChange={() => {}}
          required
          className="absolute opacity-0 w-0 h-0 pointer-events-none"
        >
          <option value="" />
          {cadets.map(c => <option key={c.uid} value={c.uid}>{c.fullName}</option>)}
        </select>
      )}
    </div>
  );
};

export default CadetSearch;
