// src/components/DatePicker.jsx — calendar popup date picker
import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_HEADS = ['S','M','T','W','T','F','S'];

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const fmtDisplay = (str) => {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${MONTHS[parseInt(m,10)-1]} ${parseInt(d,10)}, ${y}`;
};

const DatePicker = ({ value, onChange, placeholder = 'Pick a date', className }) => {
  const today = new Date();
  const [open,      setOpen]      = useState(false);
  const [viewYear,  setViewYear]  = useState(value ? parseInt(value.split('-')[0], 10) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(value ? parseInt(value.split('-')[1], 10) - 1 : today.getMonth());
  const ref = useRef(null);

  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.split('-')[0], 10));
      setViewMonth(parseInt(value.split('-')[1], 10) - 1);
    }
  }, [value]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const prevMonth = () => viewMonth === 0 ? (setViewYear(y => y - 1), setViewMonth(11)) : setViewMonth(m => m - 1);
  const nextMonth = () => viewMonth === 11 ? (setViewYear(y => y + 1), setViewMonth(0)) : setViewMonth(m => m + 1);

  const firstDow    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectDay = (day) => {
    onChange(`${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
    setOpen(false);
  };

  const now = todayStr();
  const base = className || 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl text-sm font-bold text-slate-900 dark:text-white transition-colors';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${base} flex items-center gap-2 text-left ${open ? '!border-yellow-500' : ''}`}
      >
        <Calendar size={14} className="text-slate-400 flex-shrink-0" />
        <span className={value ? '' : 'text-slate-400 dark:text-slate-600 font-normal'}>
          {value ? fmtDisplay(value) : placeholder}
        </span>
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 z-[300] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-4 w-72">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADS.map((d, i) => (
              <div key={i} className="text-center text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, idx) => {
              const ds = day ? `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
              const isSel   = ds === value;
              const isToday = ds === now;
              return (
                <button
                  key={idx}
                  type="button"
                  disabled={!day}
                  onClick={() => day && selectDay(day)}
                  className={`h-8 w-full rounded-lg text-[11px] font-bold transition-all
                    ${!day ? 'invisible pointer-events-none' : ''}
                    ${isSel
                      ? 'bg-yellow-500 text-slate-950 font-black shadow-sm'
                      : isToday
                        ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-500 font-black'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/8'
                    }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today shortcut */}
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
            <button
              type="button"
              onClick={() => { onChange(now); setOpen(false); }}
              className="w-full text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 hover:text-yellow-400 dark:hover:text-yellow-400 transition-colors py-0.5"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatePicker;
