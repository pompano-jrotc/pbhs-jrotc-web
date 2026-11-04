// src/pages/AdminLeadershipCalendar.jsx
//
// Month-grid calendar view for leadership — shows events from BOTH the
// public `events` collection and the private `leadershipCalendar` collection.
// Only available to L45+ (COMMAND_LEVEL). Private events filtered by scope.

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, onSnapshot, query, orderBy, doc,
  addDoc, updateDoc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useCompanies } from '../hooks/useCompanies';
import {
  Lock, ChevronLeft, ChevronRight, Calendar,
  MapPin, Clock, Tag, Building2, Globe, X, Download,
  CheckSquare, Square, Plus, AlertCircle, Trash2, Users,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import DatePicker from '../components/DatePicker';
import { ROLE_HIERARCHY, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import { TYPE_COLORS } from './AdminEvents';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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

// ── ICS generation ────────────────────────────────────────────────────────────
const icsEsc  = (s = '') => String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
const icsFold = (line) => {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) { chunks.push(' ' + line.slice(i, i + 74)); i += 74; }
  return chunks.join('\r\n');
};

function generateICS(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PBHS JROTC//Leadership Calendar//EN',
    'X-WR-CALNAME:PBHS JROTC \u2014 Leadership Calendar',
    'X-WR-CALDESC:Private leadership calendar — includes public and command-level events',
    'X-WR-TIMEZONE:America/New_York',
    'X-WR-RELCALID:pbhsjrotc-leadership-calendar',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const ev of events) {
    if (!ev.date) continue;
    const endDateStr = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
    const [ey, em, ed] = endDateStr.split('-').map(Number);
    const nextDay = new Date(ey, em - 1, ed + 1);
    const dtend = `${nextDay.getFullYear()}${String(nextDay.getMonth()+1).padStart(2,'0')}${String(nextDay.getDate()).padStart(2,'0')}`;
    const dtstart = ev.date.replace(/-/g, '');

    const descParts = [];
    if (ev._isPrivate) descParts.push('[LEADERSHIP]');
    if (ev.type)        descParts.push(`Category: ${ev.type}`);
    if (ev.time)        descParts.push(`Time: ${ev.time}`);
    if (ev.description) descParts.push(ev.description);

    lines.push('BEGIN:VEVENT');
    lines.push(icsFold(`UID:ldr-${ev.id}@pbhsjrotc.com`));
    lines.push(icsFold(`DTSTART;VALUE=DATE:${dtstart}`));
    lines.push(icsFold(`DTEND;VALUE=DATE:${dtend}`));
    lines.push(icsFold(`SUMMARY:${ev._isPrivate ? '\uD83D\uDD12 ' : ''}${icsEsc(ev.title)}`));
    if (ev.location)      lines.push(icsFold(`LOCATION:${icsEsc(ev.location)}`));
    if (descParts.length) lines.push(icsFold(`DESCRIPTION:${icsEsc(descParts.join(' | '))}`));
    if (ev.type)          lines.push(icsFold(`CATEGORIES:${icsEsc(ev.type)}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const fmtDate = (str) => {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${MONTHS[parseInt(m,10)-1]} ${parseInt(d,10)}, ${y}`;
};

// Expand a multi-day event into all dates it spans within [startStr, endStr]
const expandEventDates = (ev) => {
  const dates = [];
  const start = new Date(ev.date + 'T00:00:00');
  const end   = ev.endDate && ev.endDate >= ev.date ? new Date(ev.endDate + 'T00:00:00') : start;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  return dates;
};

// ── Subscribe modal ───────────────────────────────────────────────────────────
const ExportModal = ({ events, onClose }) => {
  const [copied,   setCopied]   = useState(false);
  const [dlDone,   setDlDone]   = useState(false);

  const token    = import.meta.env.VITE_LEADERSHIP_CAL_TOKEN || '';
  const icsUrl   = token
    ? `https://www.pbhsjrotc.com/api/leadership-calendar.ics?t=${token}`
    : null;
  const webcalUrl = icsUrl ? icsUrl.replace('https://', 'webcal://') : null;
  const googleUrl = icsUrl
    ? `https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(icsUrl)}`
    : null;

  const copy = () => {
    if (!icsUrl) return;
    navigator.clipboard.writeText(icsUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const download = () => {
    const content = generateICS(events);
    const blob    = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href = url; a.download = 'pbhs-jrotc-leadership.ics';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    setDlDone(true);
    setTimeout(() => setDlDone(false), 2500);
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
              <Calendar size={18} className="text-yellow-500" />
              <h3 className="text-lg font-black uppercase italic tracking-tight text-slate-900 dark:text-white">
                Leadership Calendar
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Private feed — public events + leadership-only events. Auto-syncs every 6 hours.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-7 py-6 space-y-5">
          {token ? (
            <>
              {/* iPhone / Apple Calendar */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
                  iPhone / Apple Calendar
                </p>
                <a
                  href={webcalUrl}
                  className="flex items-center justify-center gap-2 w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-sm uppercase rounded-xl transition-colors shadow-lg shadow-yellow-500/20"
                >
                  <Calendar size={16} /> Add to Apple Calendar
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
                  href={googleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-black text-sm uppercase rounded-xl transition-colors"
                >
                  <Calendar size={16} /> Add to Google Calendar
                </a>
              </div>

              {/* Copy URL */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
                  Outlook / Other Apps — Copy URL
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate select-all">
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
              </div>
            </>
          ) : (
            /* Fallback if env var not configured — offer download */
            <div className="text-center space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Live subscription not configured yet. Download the current events as a file.
              </p>
              <button
                onClick={download}
                className={`flex items-center justify-center gap-2 w-full py-3 font-black text-sm uppercase rounded-xl transition-colors ${
                  dlDone ? 'bg-green-500 text-white' : 'bg-yellow-500 hover:bg-yellow-400 text-slate-950'
                }`}
              >
                <Download size={16} />
                {dlDone ? 'Downloaded!' : `Download .ics (${events.length} events)`}
              </button>
            </div>
          )}

          {/* Fallback download always available */}
          {token && (
            <div className="border-t border-slate-100 dark:border-white/5 pt-4">
              <button
                onClick={download}
                className="flex items-center gap-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <Download size={13} />
                {dlDone ? 'Downloaded!' : `Or download snapshot (${events.length} events)`}
              </button>
            </div>
          )}

          {/* Privacy note */}
          <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-xl px-4 py-3">
            <Lock size={13} className="text-yellow-500 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              This calendar contains private leadership events. Do not share this link outside command staff.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const PRIORITY_STYLES = {
  high:   'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20',
  medium: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
  low:    'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10',
};

// ── Task creation form ────────────────────────────────────────────────────────
const TaskForm = ({ onSave, onClose }) => {
  const today = todayStr();
  const [form, setForm] = useState({ title: '', dueDate: today, description: '', priority: 'medium' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.title.trim() || !form.dueDate) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-black uppercase italic text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <CheckSquare size={15} className="text-violet-500" /> New Task
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Title *</label>
            <input
              autoFocus
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-500/50 dark:focus:border-violet-500/50"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Task title…"
              onKeyDown={e => e.key === 'Enter' && save()}
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Due Date *</label>
            <DatePicker
              value={form.dueDate}
              onChange={v => setForm(f => ({ ...f, dueDate: v }))}
              placeholder="Pick a due date"
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white transition-colors"
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Priority</label>
            <div className="flex gap-2">
              {['high', 'medium', 'low'].map(p => (
                <button
                  key={p}
                  onClick={() => setForm(f => ({ ...f, priority: p }))}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide border transition-all ${
                    form.priority === p ? PRIORITY_STYLES[p] : 'border-slate-200 dark:border-white/10 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Notes</label>
            <textarea
              className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-500/50 resize-none"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional notes…"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl text-xs font-black uppercase bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !form.title.trim() || !form.dueDate}
            className="flex-1 py-2 rounded-xl text-xs font-black uppercase bg-violet-500 text-white hover:bg-violet-400 transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Add Task'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Task detail popover ───────────────────────────────────────────────────────
const TaskDetail = ({ task, isCompleted, onClose, onToggle, onDelete, canDelete, isBattalion, companies, onToggleCompany }) => {
  const today = todayStr();
  const isOverdue = !isCompleted && task.dueDate < today;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <button onClick={() => onToggle(task)} className="mt-0.5 flex-shrink-0 text-violet-500 hover:text-violet-400 transition-colors">
              {isCompleted ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
            <p className={`font-black uppercase italic text-base text-slate-900 dark:text-white leading-tight ${isCompleted ? 'line-through opacity-50' : ''}`}>
              {task.title}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${PRIORITY_STYLES[task.priority || 'medium']}`}>
            {task.priority || 'medium'} priority
          </span>
          {isCompleted && (
            <span className="inline-flex items-center text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20">
              Done
            </span>
          )}
          {task.isAssigned && (
            <span className="inline-flex items-center text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-500/20">
              {Object.values(task.completedByCompany || {}).filter(Boolean).length}/{task.assignedScope === 'company' ? 1 : companies.length} co. done
            </span>
          )}
          {isOverdue && (
            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20">
              <AlertCircle size={8} /> Overdue
            </span>
          )}
        </div>

        <div className="space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Calendar size={12} className="text-violet-500 flex-shrink-0" />
            <span>Due {fmtDate(task.dueDate)}</span>
          </div>
          {task.description && (
            <p className="pt-2 border-t border-slate-100 dark:border-white/5 leading-relaxed">{task.description}</p>
          )}
        </div>

        {task.createdBy && (
          <p className="text-[10px] text-slate-300 dark:text-slate-700 uppercase tracking-widest">Added by {task.createdBy}</p>
        )}

        {/* Per-company breakdown for assigned tasks */}
        {task.isAssigned && (
          <div className="pt-2 border-t border-slate-100 dark:border-white/5">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Company Progress</p>
            <div className="space-y-0.5">
              {(task.assignedScope === 'company' ? [task.assignedCompany] : companies).map(co => {
                const done = task.completedByCompany?.[co] === true;
                return isBattalion ? (
                  <button
                    key={co}
                    type="button"
                    onClick={() => onToggleCompany(task, co)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-all hover:bg-slate-50 dark:hover:bg-white/5 ${
                      done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {done ? <CheckSquare size={12} className="flex-shrink-0" /> : <Square size={12} className="flex-shrink-0" />}
                    <span className={done ? 'font-bold' : ''}>{co}</span>
                    {done && <span className="ml-auto text-[9px] font-black uppercase text-emerald-500">Done</span>}
                  </button>
                ) : (
                  <div
                    key={co}
                    className={`flex items-center gap-2 px-2.5 py-1 text-xs ${
                      done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {done ? <CheckSquare size={12} className="flex-shrink-0" /> : <Square size={12} className="flex-shrink-0" />}
                    <span className={done ? 'font-bold' : ''}>{co}</span>
                    {done && <span className="ml-auto text-[9px] font-black uppercase text-emerald-500">Done</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5 gap-2">
          {/* Hide the single-toggle button for battalion on assigned tasks — they use per-company toggles above */}
          {(!task.isAssigned || !isBattalion) && (
            <button
              onClick={() => { onToggle(task); onClose(); }}
              className={`flex-1 py-2 rounded-xl text-xs font-black uppercase transition-colors ${
                isCompleted
                  ? 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                  : 'bg-violet-500 text-white hover:bg-violet-400'
              }`}
            >
              {isCompleted ? 'Mark Incomplete' : 'Mark Complete'}
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => { onDelete(task.id); onClose(); }}
              className="p-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Event detail popover ──────────────────────────────────────────────────────
const EventDetail = ({ ev, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
    <div
      className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-sm p-5 space-y-3"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-black uppercase italic text-base text-slate-900 dark:text-white leading-tight">
            {ev.title}
          </p>
          {ev._isPrivate && (
            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20">
              <Lock size={8} /> Private
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0">
          <X size={16} />
        </button>
      </div>

      {ev.type && (
        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${TYPE_COLORS[ev.type] || TYPE_COLORS.Other}`}>
          <Tag size={8} /> {ev.type}
        </span>
      )}

      <div className="space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <Calendar size={12} className="text-yellow-500 flex-shrink-0" />
          <span>{fmtDate(ev.date)}{ev.endDate && ev.endDate !== ev.date ? ` – ${fmtDate(ev.endDate)}` : ''}</span>
        </div>
        {ev.time && (
          <div className="flex items-center gap-2">
            <Clock size={12} className="text-yellow-500 flex-shrink-0" />
            <span>{ev.time}</span>
          </div>
        )}
        {ev.location && (
          <div className="flex items-center gap-2">
            <MapPin size={12} className="text-yellow-500 flex-shrink-0" />
            <span>{ev.location}</span>
          </div>
        )}
        {ev._isPrivate && ev.scope === 'company' && ev.company && (
          <div className="flex items-center gap-2">
            <Building2 size={12} className="text-purple-500 flex-shrink-0" />
            <span className="text-purple-600 dark:text-purple-400">{ev.company} Company only</span>
          </div>
        )}
        {ev._isPrivate && ev.scope === 'all' && (
          <div className="flex items-center gap-2">
            <Globe size={12} className="text-slate-400 flex-shrink-0" />
            <span>All Leadership (L45+)</span>
          </div>
        )}
      </div>

      {ev.description && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-white/5 pt-3">
          {ev.description}
        </p>
      )}

      {ev.createdBy && (
        <p className="text-[10px] text-slate-300 dark:text-slate-700 uppercase tracking-widest pt-1">
          Added by {ev.createdBy}
        </p>
      )}
    </div>
  </div>
);

// ── Calendar grid ─────────────────────────────────────────────────────────────
const CalendarGrid = ({ year, month, events, onEventClick, blueGoldMap, tasks, onTaskClick, getTaskDone = (t) => t.completed }) => {
  const today = todayStr();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = {};
  events.forEach(ev => {
    expandEventDates(ev).forEach(dateStr => {
      if (!byDate[dateStr]) byDate[dateStr] = [];
      byDate[dateStr].push(ev);
    });
  });

  const tasksByDate = {};
  (tasks || []).forEach(t => {
    if (!t.dueDate) return;
    if (!tasksByDate[t.dueDate]) tasksByDate[t.dueDate] = [];
    tasksByDate[t.dueDate].push(t);
  });

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/5">
      {/* Weekday header */}
      <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-white/5">
        {DAYS.map(d => (
          <div key={d} className="py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-white/5">
        {cells.map((day, idx) => {
          const dateStr = day
            ? `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
            : null;
          const dayEvents = dateStr ? (byDate[dateStr] || []) : [];
          const dayTasks  = dateStr ? (tasksByDate[dateStr] || []) : [];
          const isToday   = dateStr === today;
          const isPast    = dateStr && dateStr < today;
          const bgLabel   = day ? blueGoldMap?.get(day) : null;
          const totalChips = dayEvents.length + dayTasks.length;

          return (
            <div
              key={idx}
              className={`min-h-[80px] p-1.5 bg-white dark:bg-slate-950 ${!day ? 'opacity-0 pointer-events-none' : ''} ${isPast ? 'opacity-60' : ''}`}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <div className={`text-[11px] font-black w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday
                        ? 'bg-yellow-500 text-slate-950'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}>
                      {day}
                    </div>
                    {bgLabel && (
                      <span className={`text-[9px] font-black uppercase leading-none ${bgLabel === 'blue' ? 'text-blue-400' : 'text-yellow-500'}`}>
                        {bgLabel === 'blue' ? 'B' : 'G'}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 2).map((ev, i) => {
                      const typeColor = ev._isPrivate
                        ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
                        : 'bg-blue-500/15 text-blue-700 dark:text-blue-400';
                      return (
                        <button
                          key={ev.id + i}
                          onClick={() => onEventClick(ev)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[9px] font-bold truncate flex items-center gap-1 ${typeColor} hover:brightness-90 transition-all`}
                        >
                          {ev._isPrivate && <Lock size={7} className="flex-shrink-0" />}
                          <span className="truncate">{ev.title}</span>
                        </button>
                      );
                    })}
                    {dayTasks.slice(0, 2).map((t, i) => {
                      const done = getTaskDone(t);
                      const chipColor = done
                        ? 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600'
                        : dateStr < today
                          ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                          : 'bg-violet-500/15 text-violet-700 dark:text-violet-400';
                      return (
                        <button
                          key={t.id + i}
                          onClick={() => onTaskClick(t)}
                          className={`w-full text-left px-1.5 py-0.5 rounded text-[9px] font-bold truncate flex items-center gap-1 ${chipColor} hover:brightness-90 transition-all`}
                        >
                          {done ? <CheckSquare size={7} className="flex-shrink-0" /> : <Square size={7} className="flex-shrink-0" />}
                          <span className={`truncate ${done ? 'line-through' : ''}`}>{t.title}</span>
                        </button>
                      );
                    })}
                    {totalChips > 4 && (
                      <p className="text-[9px] text-slate-400 dark:text-slate-600 font-bold px-1">
                        +{totalChips - 4} more
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const AdminLeadershipCalendar = ({ hideHeader = false }) => {
  const { user, userData, role } = useAuth();
  const { companies } = useCompanies();
  const userLevel   = ROLE_HIERARCHY[role] || 0;
  const isBattalion = userLevel >= STAFF_LEVEL;
  const myCompany   = userData?.company;

  const [events,      setEvents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [showExport,  setShowExport]  = useState(false);

  // Tasks
  const [tasks,        setTasks]       = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showDone,     setShowDone]    = useState(false);

  // Blue/Gold state
  const [anchorDate,  setAnchorDate]  = useState('2026-08-03');
  const [blueGoldEnd, setBlueGoldEnd] = useState('');

  // Month navigation
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  // ── Load Blue/Gold settings ───────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'blueGoldCalendar'), snap => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.anchorDate) setAnchorDate(d.anchorDate);
      if (d.endDate)    setBlueGoldEnd(d.endDate);
    });
  }, []);

  // ── Load from both collections ────────────────────────────────────────────
  useEffect(() => {
    let pubEvents  = [];
    let privEvents = [];
    let pubDone = false, privDone = false;

    const merge = () => {
      if (!pubDone || !privDone) return;
      setEvents([
        ...pubEvents.map(e  => ({ ...e, _isPrivate: false })),
        ...privEvents.map(e => ({ ...e, _isPrivate: true  })),
      ]);
      setLoading(false);
    };

    const qPub = query(collection(db, 'events'), orderBy('date', 'asc'));
    const unsubPub = onSnapshot(qPub, snap => {
      pubEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      pubDone = true;
      merge();
    });

    const qPriv = query(collection(db, 'leadershipCalendar'), orderBy('date', 'asc'));
    const unsubPriv = onSnapshot(qPriv, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      privEvents = isBattalion
        ? all
        : all.filter(ev =>
            ev.scope === 'all' ||
            (ev.scope === 'company' && ev.company === myCompany)
          );
      privDone = true;
      merge();
    });

    return () => { unsubPub(); unsubPriv(); };
  }, [isBattalion, myCompany]);

  // ── Load tasks ────────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'leadershipTasks'), orderBy('dueDate', 'asc'));
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTasks(all);
      setSelectedTask(prev => prev ? (all.find(t => t.id === prev.id) ?? prev) : null);
    });
  }, []);

  // Visible tasks for the current user
  const visibleTasks = useMemo(() => {
    const uid  = user?.uid;
    const pos  = userData?.position;
    const comp = myCompany;
    return tasks.filter(t => {
      if (!t.isAssigned) return t.createdByUid === uid;  // personal
      if (isBattalion) return true;                       // battalion sees all assigned
      // New schema: assignedCompanies + assignedPositions arrays (both empty = all)
      if (t.assignedCompanies !== undefined) {
        const cos = t.assignedCompanies || [];
        const pos = t.assignedPositions || [];
        const compOk = cos.length === 0 || cos.includes(comp);
        const posOk  = pos.length === 0 || pos.includes(userData?.position);
        return compOk && posOk;
      }
      // Old schema backward compat
      if (t.assignedScope === 'all') return true;
      if (t.assignedScope === 'company') return t.assignedCompany === comp;
      if (t.assignedScope === 'position') return (t.assignedPositions || []).includes(pos);
      return false;
    });
  }, [tasks, user, userData, myCompany, isBattalion]);

  const createTask = async (form) => {
    const displayName = userData?.displayName || userData?.fullName || userData?.email || 'Unknown';
    await addDoc(collection(db, 'leadershipTasks'), {
      title:          form.title.trim(),
      dueDate:        form.dueDate,
      description:    form.description.trim(),
      priority:       form.priority,
      completed:      false,
      isAssigned:     false,
      assignedScope:  'personal',
      createdByUid:   user?.uid || '',
      createdBy:      displayName,
      createdAt:      Timestamp.now(),
    });
  };

  const isCompletedByMe = (t) => t.isAssigned
    ? (t.completedByCompany?.[myCompany] === true)
    : t.completed;

  const toggleTask = async (task) => {
    if (!task.isAssigned) {
      await updateDoc(doc(db, 'leadershipTasks', task.id), {
        completed:   !task.completed,
        completedAt: !task.completed ? Timestamp.now() : null,
      });
    } else if (myCompany && !isBattalion) {
      const done = task.completedByCompany?.[myCompany] === true;
      await updateDoc(doc(db, 'leadershipTasks', task.id), {
        [`completedByCompany.${myCompany}`]: !done,
      });
    }
  };

  const toggleCompanyTask = async (task, company) => {
    const done = task.completedByCompany?.[company] === true;
    await updateDoc(doc(db, 'leadershipTasks', task.id), {
      [`completedByCompany.${company}`]: !done,
    });
  };

  const deleteTask = async (id) => {
    await deleteDoc(doc(db, 'leadershipTasks', id));
  };

  // ── Blue/Gold map for current month ──────────────────────────────────────
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
  }, [events]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();

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

  const todayBG = useMemo(() => {
    const t = new Date();
    const dow = t.getDay();
    if (dow === 0 || dow === 5 || dow === 6) return null;
    const ds = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    if (blueGoldEnd && ds > blueGoldEnd) return null;
    if (noSchoolDates.has(ds)) return null;
    const n = countSchoolDays(anchorDate, ds, noSchoolDates);
    return n >= 0 ? (n % 2 === 0 ? 'blue' : 'gold') : null;
  }, [anchorDate, blueGoldEnd, noSchoolDates]);

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && (
        <AdminPageHeader
          icon={Calendar}
          title="Leadership Calendar"
          meta="Shows all public events + private leadership events for your access level"
        />
      )}

      {/* Today's Blue/Gold banner */}
      {todayBG && (
        <div className={`mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border ${
          todayBG === 'blue'
            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
            : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20'
        }`}>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${todayBG === 'blue' ? 'bg-blue-500' : 'bg-yellow-500'}`} />
          Today is a {todayBG === 'blue' ? 'Blue' : 'Gold'} Day
        </div>
      )}

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 text-slate-500 hover:text-yellow-500 hover:border-yellow-500/30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 dark:text-white min-w-[160px] text-center">
            {MONTHS[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 text-slate-500 hover:text-yellow-500 hover:border-yellow-500/30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 mr-1">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-blue-500/15 flex-shrink-0" /> Public
            </span>
            <span className="flex items-center gap-1.5">
              <Lock size={9} className="text-yellow-500 flex-shrink-0" />
              <span className="w-3 h-3 rounded bg-yellow-500/15 flex-shrink-0" /> Private
            </span>
            <span className="flex items-center gap-1.5">
              <Square size={9} className="text-violet-500 flex-shrink-0" />
              <span className="w-3 h-3 rounded bg-violet-500/15 flex-shrink-0" /> Task
            </span>
            <span className="flex items-center gap-1.5 text-blue-400">
              <span className="font-black">B</span> Blue
            </span>
            <span className="flex items-center gap-1.5 text-yellow-500">
              <span className="font-black">G</span> Gold
            </span>
          </div>
          <button
            onClick={() => setShowTaskForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors border border-violet-500/20"
          >
            <Plus size={12} /> Task
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors border border-slate-200 dark:border-white/5"
          >
            <Download size={12} /> Export
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-yellow-500 text-slate-950 hover:bg-yellow-400 transition-colors"
          >
            Today
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400 dark:text-slate-600 text-xs font-black uppercase tracking-widest animate-pulse">
          Loading calendar…
        </div>
      ) : (
        <CalendarGrid
          year={year}
          month={month}
          events={events}
          onEventClick={setSelected}
          blueGoldMap={blueGoldMap}
          tasks={visibleTasks}
          onTaskClick={setSelectedTask}
          getTaskDone={isCompletedByMe}
        />
      )}

      {/* ── Tasks panel ────────────────────────────────────────────────── */}
      {visibleTasks.length > 0 && (() => {
        const now     = todayStr();
        const overdue   = visibleTasks.filter(t => !isCompletedByMe(t) && t.dueDate < now);
        const upcoming  = visibleTasks.filter(t => !isCompletedByMe(t) && t.dueDate >= now);
        const completed = visibleTasks.filter(t => isCompletedByMe(t));

        const renderTaskRow = (t) => {
          const done = isCompletedByMe(t);
          const canToggle = !t.isAssigned || (!!myCompany && !isBattalion);
          const coCount = t.isAssigned ? Object.values(t.completedByCompany || {}).filter(Boolean).length : null;
          const allDone = coCount !== null && companies.length > 0 && coCount >= companies.length;
          return (
          <div key={t.id} className="flex items-center gap-3 py-2.5 border-b border-slate-100 dark:border-white/5 last:border-0 group">
            {canToggle ? (
              <button onClick={() => toggleTask(t)} className={`flex-shrink-0 transition-colors ${done ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600 hover:text-violet-500'}`}>
                {done ? <CheckSquare size={14} /> : <Square size={14} />}
              </button>
            ) : (
              <span className={`flex-shrink-0 ${allDone ? 'text-emerald-500' : coCount > 0 ? 'text-amber-500' : 'text-violet-400 dark:text-violet-500'}`} title="Assigned task — completion tracked per company">
                <Users size={13} />
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold text-slate-700 dark:text-slate-300 truncate ${done ? 'line-through opacity-40' : ''}`}>{t.title}</p>
              {t.description && <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">{t.description}</p>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {coCount !== null && (
                <span className="text-[9px] font-black tabular-nums text-violet-500 dark:text-violet-400">{coCount}✓</span>
              )}
              <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${PRIORITY_STYLES[t.priority || 'medium']}`}>{t.priority || 'med'}</span>
              <span className={`text-[10px] font-bold tabular-nums ${!done && t.dueDate < now ? 'text-red-500' : 'text-slate-400'}`}>{fmtDate(t.dueDate)}</span>
              {isBattalion && (
                <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
          );
        };

        return (
          <div className="mt-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/5 bg-violet-50/40 dark:bg-violet-500/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 flex items-center gap-2">
                <CheckSquare size={12} /> Tasks
                {overdue.length > 0 && (
                  <span className="ml-1 inline-flex items-center gap-1 text-[9px] bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 px-1.5 py-0.5 rounded">
                    <AlertCircle size={8} /> {overdue.length} overdue
                  </span>
                )}
              </h3>
              <button onClick={() => setShowTaskForm(true)} className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 hover:text-violet-500 transition-colors">
                <Plus size={11} /> New Task
              </button>
            </div>
            <div className="px-5">
              {overdue.length > 0 && (
                <>
                  <p className="text-[9px] font-black uppercase tracking-widest text-red-500 dark:text-red-400 pt-3 pb-1">Overdue</p>
                  {overdue.map(renderTaskRow)}
                </>
              )}
              {upcoming.length > 0 && (
                <>
                  {overdue.length > 0 && <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 pt-3 pb-1">Upcoming</p>}
                  {upcoming.map(renderTaskRow)}
                </>
              )}
              {overdue.length === 0 && upcoming.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-600 text-center py-5">All tasks complete!</p>
              )}
              {completed.length > 0 && (
                <div className="border-t border-slate-100 dark:border-white/5 mt-1">
                  <button onClick={() => setShowDone(d => !d)} className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-400 py-3 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                    <CheckSquare size={10} className="text-emerald-500" />
                    {showDone ? 'Hide' : 'Show'} {completed.length} completed
                  </button>
                  {showDone && completed.map(renderTaskRow)}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {selected     && <EventDetail ev={selected} onClose={() => setSelected(null)} />}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          isCompleted={isCompletedByMe(selectedTask)}
          onClose={() => setSelectedTask(null)}
          onToggle={toggleTask}
          onDelete={deleteTask}
          canDelete={isBattalion}
          isBattalion={isBattalion}
          companies={companies}
          onToggleCompany={toggleCompanyTask}
        />
      )}
      {showExport   && <ExportModal events={events} onClose={() => setShowExport(false)} />}
      {showTaskForm && <TaskForm onSave={createTask} onClose={() => setShowTaskForm(false)} />}
    </div>
  );
};

export default AdminLeadershipCalendar;
