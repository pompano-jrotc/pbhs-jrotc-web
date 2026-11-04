import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../firebase';
import { collection, doc, onSnapshot, query, orderBy } from 'firebase/firestore';
import {
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  MapPin, Clock, ArrowLeft, Tag, X, CalendarPlus,
} from 'lucide-react';
import { TYPE_COLORS } from './AdminEvents';
import { usePageMeta } from '../hooks/usePageMeta';
import Reveal from '../components/Reveal';

// ── Category → hex ────────────────────────────────────────────────────────────
const TYPE_HEX = {
  Training:            '#3b82f6',
  Competition:         '#eab308',
  Ceremony:            '#a855f7',
  'Field Trip':        '#22c55e',
  Meeting:             '#94a3b8',
  Social:              '#ec4899',
  Fundraiser:          '#10b981',
  'Community Service': '#14b8a6',
  Inspection:          '#f97316',
  'No School':         '#ef4444',
  Other:               '#64748b',
};

function eventCoversDay(ev, dayStr) {
  if (!ev.date) return false;
  const end = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
  return ev.date <= dayStr && end >= dayStr;
}

// ── Blue/Gold ─────────────────────────────────────────────────────────────────
function countSchoolDays(anchorStr, targetStr, noSchoolSet) {
  const [ay, am, ad] = anchorStr.split('-').map(Number);
  const [ty, tm, td] = targetStr.split('-').map(Number);
  const anchor = new Date(ay, am - 1, ad);
  const target = new Date(ty, tm - 1, td);
  if (target < anchor) return -1;
  if (target.getTime() === anchor.getTime()) return 0;
  let count = 0;
  const curr = new Date(anchor);
  while (curr < target) {
    curr.setDate(curr.getDate() + 1);
    const dow = curr.getDay();
    if (dow === 0 || dow === 5 || dow === 6) continue;
    const ds = `${curr.getFullYear()}-${String(curr.getMonth()+1).padStart(2,'0')}-${String(curr.getDate()).padStart(2,'0')}`;
    if (!noSchoolSet.has(ds)) count++;
  }
  return count;
}

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const fmtDate = (str) => {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${MONTHS[parseInt(m,10)-1]} ${parseInt(d,10)}, ${y}`;
};

// ── Subscribe modal ───────────────────────────────────────────────────────────
const SubscribeModal = ({ onClose }) => {
  const icsUrl    = 'https://www.pbhsjrotc.com/api/calendar.ics';
  const webcalUrl = icsUrl.replace('https://', 'webcal://');
  const [copied, setCopied] = useState(false);

  const copy = () => {
    try {
      navigator.clipboard.writeText(icsUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5 border-b border-slate-100 dark:border-white/5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CalendarPlus size={18} className="text-yellow-500" />
              <h3 className="text-lg font-black uppercase italic tracking-tight text-slate-900 dark:text-white">
                Subscribe to Calendar
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Add to iPhone, Google Calendar, or Outlook — events sync automatically.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-7 py-6 space-y-5">
          {/* iPhone / Apple Calendar */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
              iPhone / Apple Calendar
            </p>
            <a
              href={webcalUrl}
              className="flex items-center justify-center gap-2 w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-sm uppercase rounded-xl transition-colors shadow-lg shadow-yellow-500/20"
            >
              <CalendarPlus size={16} /> Add to Apple Calendar
            </a>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 text-center">
              Tap the button — your Calendar app will open and ask to subscribe.
              On Mac/Chrome, if nothing happens: copy the URL below and use <strong>Calendar → File → New Calendar Subscription</strong>.
            </p>
          </div>

          {/* Google Calendar */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
              Google Calendar
            </p>
            <a
              href={`https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(icsUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-black text-sm uppercase rounded-xl transition-colors"
            >
              <CalendarPlus size={16} /> Add to Google Calendar
            </a>
          </div>

          {/* Manual / other */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
              Outlook / Other Apps — Copy URL
            </p>
            <div className="flex gap-2">
              <div className="flex-1 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate select-all">
                {icsUrl}
              </div>
              <button
                onClick={copy}
                className={`px-4 py-2.5 rounded-xl font-black text-xs uppercase transition-all flex-shrink-0 ${
                  copied
                    ? 'bg-green-500 text-white'
                    : 'bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-white/15'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
              In Outlook: File → Account Settings → Internet Calendars → New → paste URL.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
const CalendarPage = () => {
  usePageMeta({
    title: 'Events Calendar',
    description: 'Upcoming PBHS JROTC Tornado Battalion events, meetings, and competitions.',
    path: '/events',
  });

  const [events,        setEvents]        = useState([]);
  const [currentDate,   setCurrentDate]   = useState(new Date());
  const [selectedType,  setSelectedType]  = useState(null);
  const [anchorDate,    setAnchorDate]    = useState('2026-08-03');
  const [blueGoldEnd,   setBlueGoldEnd]   = useState('');
  const [selectedDay,   setSelectedDay]   = useState(null);
  const [showSubscribe, setShowSubscribe] = useState(false);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setSelectedDay(null); setShowSubscribe(false); }};
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('date', 'asc'));
    return onSnapshot(q, snap => setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'blueGoldCalendar'), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.anchorDate) setAnchorDate(d.anchorDate);
      if (d.endDate)    setBlueGoldEnd(d.endDate);
    });
  }, []);

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1));
  const goToday   = () => setCurrentDate(new Date());

  const todayStr = () => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  };
  const TODAY = todayStr();

  const noSchoolDates = useMemo(() => {
    const set = new Set();
    for (const e of events) {
      if (e.type !== 'No School' || !e.date) continue;
      const end = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
      const cur = new Date(e.date + 'T00:00:00');
      const endD = new Date(end + 'T00:00:00');
      while (cur <= endD) {
        set.add(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
    }
    return set;
  },
    [events]
  );

  const blueGoldMap = useMemo(() => {
    const map = new Map();
    for (let day = 1; day <= daysInMonth; day++) {
      const dow = new Date(year, month, day).getDay();
      if (dow === 0 || dow === 5 || dow === 6) continue;
      const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if (blueGoldEnd && ds > blueGoldEnd) continue;
      if (noSchoolDates.has(ds)) continue;
      const n = countSchoolDays(anchorDate, ds, noSchoolDates);
      if (n >= 0) map.set(day, n % 2 === 0 ? 'blue' : 'gold');
    }
    return map;
  }, [anchorDate, blueGoldEnd, year, month, daysInMonth, noSchoolDates]);

  const todayBlueGold = useMemo(() => {
    const t = new Date();
    const dow = t.getDay();
    if (dow === 0 || dow === 5 || dow === 6) return null;
    const ds = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    if (blueGoldEnd && ds > blueGoldEnd) return null;
    if (noSchoolDates.has(ds)) return null;
    const n = countSchoolDays(anchorDate, ds, noSchoolDates);
    return n >= 0 ? (n % 2 === 0 ? 'blue' : 'gold') : null;
  }, [anchorDate, blueGoldEnd, noSchoolDates]);

  const activeTypes = [...new Set(events.map(e => e.type).filter(Boolean))].sort();

  const monthEvents = useMemo(() => {
    const m = String(month + 1).padStart(2, '0');
    const mStart = `${year}-${m}-01`;
    const mEnd   = `${year}-${m}-${String(daysInMonth).padStart(2, '0')}`;
    return events.filter(e => {
      if (!e.date) return false;
      const end = (e.endDate && e.endDate > e.date) ? e.endDate : e.date;
      return e.date <= mEnd && end >= mStart;
    });
  }, [events, year, month, daysInMonth]);

  const visibleEvents = useMemo(
    () => selectedType ? monthEvents.filter(e => e.type === selectedType) : monthEvents,
    [monthEvents, selectedType]
  );

  // Build cells array (null = padding)
  const cells = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white p-4 md:p-10 pt-36 md:pt-44 font-sans transition-colors duration-300">
      <div className="max-w-7xl mx-auto">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <Reveal className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
          <div>
            <Link to="/" className="text-slate-400 dark:text-slate-500 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest mb-2 hover:text-yellow-600 dark:hover:text-yellow-500 transition-all">
              <ArrowLeft size={14} /> Back to Home
            </Link>
            <h1 className="text-4xl font-black uppercase italic tracking-tighter flex items-center gap-3">
              <CalendarIcon className="text-yellow-500" size={32} /> Battalion Schedule
            </h1>
          </div>

          <div className="flex flex-col items-start md:items-end gap-3">
            {todayBlueGold && (
              <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                todayBlueGold === 'blue'
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                  : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20'
              }`}>
                <div className={`w-2 h-2 rounded-full ${todayBlueGold === 'blue' ? 'bg-blue-500' : 'bg-yellow-500'}`} />
                Today is a {todayBlueGold === 'blue' ? 'Blue' : 'Gold'} Day
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {/* Month nav */}
              <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-1 shadow-sm">
                <button onClick={prevMonth} className="p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                  <ChevronLeft size={16} />
                </button>
                <h2 className="text-sm font-black uppercase italic min-w-[140px] text-center tracking-tight text-slate-900 dark:text-white px-1">
                  {MONTHS[month]} {year}
                </h2>
                <button onClick={nextMonth} className="p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                  <ChevronRight size={16} />
                </button>
              </div>

              <button
                onClick={goToday}
                className="px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-yellow-500 text-slate-950 hover:bg-yellow-400 transition-colors shadow-lg shadow-yellow-500/20"
              >
                Today
              </button>

              <button
                onClick={() => setShowSubscribe(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:border-yellow-500/40 hover:text-yellow-600 dark:hover:text-yellow-500 transition-all shadow-sm"
              >
                <CalendarPlus size={13} /> Subscribe
              </button>
            </div>
          </div>
        </Reveal>

        {/* ── CATEGORY FILTER ─────────────────────────────────────────────── */}
        {activeTypes.length > 0 && (
          <Reveal className="mb-6">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSelectedType(null)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                  selectedType === null
                    ? 'bg-yellow-500 text-slate-950 border-yellow-500 shadow-md shadow-yellow-500/20'
                    : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-yellow-500/40'
                }`}
              >
                All
              </button>
              {activeTypes.map(type => (
                <button
                  key={type}
                  onClick={() => setSelectedType(t => t === type ? null : type)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                    selectedType === type
                      ? `${TYPE_COLORS[type] || TYPE_COLORS.Other}`
                      : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </Reveal>
        )}

        {/* ── CALENDAR GRID ────────────────────────────────────────────────── */}
        <Reveal>
          <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/40 shadow-xl shadow-slate-200/30 dark:shadow-none">
            {/* Day-of-week header */}
            <div className="grid grid-cols-7 border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/60">
              {DAYS.map(d => (
                <div key={d} className="py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-white/5">
              {cells.map((day, idx) => {
                if (!day) return <div key={`pad-${idx}`} className="min-h-[100px] bg-white dark:bg-slate-950 opacity-0 pointer-events-none" />;

                const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                const dayEvs   = visibleEvents.filter(e => eventCoversDay(e, ds));
                const isToday  = ds === TODAY;
                const isPast   = ds < TODAY;
                const bg       = isPast ? 'bg-white dark:bg-slate-950 opacity-50' : 'bg-white dark:bg-slate-950';
                const bgLabel  = blueGoldMap.get(day);

                return (
                  <div
                    key={idx}
                    onClick={() => dayEvs.length && setSelectedDay({ dayStr: ds, events: dayEvs })}
                    className={`min-h-[100px] p-1.5 transition-colors ${bg} ${dayEvs.length ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`}
                  >
                    {/* Day number row */}
                    <div className="flex items-center justify-between mb-1">
                      <div className={`text-[11px] font-black w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-yellow-500 text-slate-950' : 'text-slate-500 dark:text-slate-400'
                      }`}>
                        {day}
                      </div>
                      {bgLabel && (
                        <span className={`text-[9px] font-black uppercase leading-none ${bgLabel === 'blue' ? 'text-blue-400' : 'text-yellow-500'}`}>
                          {bgLabel === 'blue' ? 'B' : 'G'}
                        </span>
                      )}
                    </div>

                    {/* Event chips */}
                    <div className="space-y-0.5">
                      {dayEvs.slice(0, 3).map(ev => (
                        <div
                          key={ev.id}
                          className="w-full text-left px-1.5 py-0.5 rounded text-[9px] font-bold truncate"
                          style={{
                            backgroundColor: `${TYPE_HEX[ev.type] || '#64748b'}25`,
                            color: TYPE_HEX[ev.type] || '#64748b',
                          }}
                        >
                          {ev.title}
                        </div>
                      ))}
                      {dayEvs.length > 3 && (
                        <p className="text-[9px] text-slate-400 dark:text-slate-600 font-bold px-1">
                          +{dayEvs.length - 3} more
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>

        {/* ── UPCOMING EVENTS LIST ────────────────────────────────────────── */}
        {visibleEvents.length > 0 && (
          <Reveal className="mt-12">
            <div className="flex items-center gap-4 mb-6">
              <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500">
                {MONTHS[month]} Agenda
              </h3>
              <div className="h-px flex-1 bg-slate-200 dark:bg-white/5" />
              <span className="text-[10px] font-black text-slate-300 dark:text-slate-700">
                {visibleEvents.length} {visibleEvents.length === 1 ? 'event' : 'events'}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {visibleEvents.map((event, idx) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.04, 0.25) }}
                    className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/5 rounded-2xl p-5 relative overflow-hidden hover:border-yellow-500/30 transition-all shadow-sm"
                  >
                    <div
                      className="absolute top-0 left-0 w-1 h-full"
                      style={{ backgroundColor: TYPE_HEX[event.type] || '#64748b' }}
                    />
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <p className="text-[10px] font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-tight">
                        {event.date}{event.endDate && event.endDate !== event.date ? ` – ${event.endDate}` : ''}
                      </p>
                      {event.type && (
                        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${TYPE_COLORS[event.type] || TYPE_COLORS.Other}`}>
                          <Tag size={8} /> {event.type}
                        </span>
                      )}
                    </div>
                    <h4 className="font-black text-sm text-slate-900 dark:text-white mb-2 tracking-tight leading-snug">
                      {event.title}
                    </h4>
                    <div className="space-y-1">
                      {event.location && (
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <MapPin size={11} className="flex-shrink-0" />
                          <span className="text-[10px] font-bold uppercase truncate">{event.location}</span>
                        </div>
                      )}
                      {event.time && (
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <Clock size={11} className="flex-shrink-0" />
                          <span className="text-[10px] font-bold uppercase">{event.time}</span>
                        </div>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed line-clamp-2">
                        {event.description}
                      </p>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </Reveal>
        )}

        {visibleEvents.length === 0 && (
          <Reveal className="mt-8">
            <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl text-slate-400 dark:text-slate-700 text-[10px] font-black uppercase tracking-widest">
              {selectedType ? `No ${selectedType} events this month` : 'No Events This Month'}
            </div>
          </Reveal>
        )}
      </div>

      {/* ── CLICK MODAL ─────────────────────────────────────────────────────── */}
      {selectedDay && createPortal(
        <>
          <div onClick={() => setSelectedDay(null)} className="fixed inset-0 bg-black/70 z-[9998]" />
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 pointer-events-none">
            <div
              onClick={e => e.stopPropagation()}
              className="modal-enter pointer-events-auto w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2rem] shadow-2xl overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4 px-7 pt-7 pb-5 border-b border-slate-100 dark:border-white/5">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
                    {selectedDay.events.length} {selectedDay.events.length === 1 ? 'Event' : 'Events'}
                  </p>
                  <h3 className="text-xl font-black uppercase italic tracking-tight text-slate-900 dark:text-white">
                    {new Date(selectedDay.dayStr + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                    })}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex-shrink-0"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-white/5 max-h-[60vh] overflow-y-auto">
                {selectedDay.events.map(ev => (
                  <div key={ev.id} className="px-7 py-5 flex gap-4">
                    <div className="w-1 rounded-full flex-shrink-0 self-stretch" style={{ backgroundColor: TYPE_HEX[ev.type] || '#64748b' }} />
                    <div className="flex-1 min-w-0">
                      {ev.type && (
                        <span
                          className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border mb-2"
                          style={{ color: TYPE_HEX[ev.type] || '#64748b', borderColor: `${TYPE_HEX[ev.type] || '#64748b'}40`, backgroundColor: `${TYPE_HEX[ev.type] || '#64748b'}15` }}
                        >
                          <Tag size={7} /> {ev.type}
                        </span>
                      )}
                      <h4 className="font-black text-slate-900 dark:text-white tracking-tight leading-snug mb-2">{ev.title}</h4>
                      <p className="text-[10px] font-bold text-yellow-600 dark:text-yellow-500 uppercase tracking-tight mb-2">
                        {ev.date}{ev.endDate && ev.endDate !== ev.date ? ` — ${ev.endDate}` : ''}
                      </p>
                      <div className="space-y-1.5">
                        {ev.time && <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><Clock size={12} className="flex-shrink-0" /><span className="text-[11px] font-bold uppercase">{ev.time}</span></div>}
                        {ev.location && <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><MapPin size={12} className="flex-shrink-0" /><span className="text-[11px] font-bold uppercase">{ev.location}</span></div>}
                      </div>
                      {ev.description && <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">{ev.description}</p>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-7 py-4 border-t border-slate-100 dark:border-white/5 text-center">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-700">
                  Press Esc or click outside to close
                </p>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── SUBSCRIBE MODAL ─────────────────────────────────────────────────── */}
      {showSubscribe && createPortal(
        <SubscribeModal onClose={() => setShowSubscribe(false)} />,
        document.body
      )}
    </div>
  );
};

export default CalendarPage;
