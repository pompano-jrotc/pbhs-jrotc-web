// src/pages/AdminAttendance.jsx
// Attendance tracking for events, practices, and meetings (NOT class attendance).

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import AdminPageHeader from '../components/AdminPageHeader';
import { writeLog } from '../lib/writeLog';
import {
  ClipboardList, Plus, ChevronDown, ChevronUp, Check, X,
  Calendar, Users, Loader2, ChevronRight, Minus,
} from 'lucide-react';

const STAFF_REVIEW_LEVEL = 70;
const COMMAND_L = 45;

const EVENT_TYPES = ['Event', 'Practice', 'Meeting', 'PT Session', 'Community Service', 'Other'];

const STATUS_OPTIONS = [
  { value: 'present', label: 'Present', color: 'emerald' },
  { value: 'excused', label: 'Excused', color: 'blue' },
  { value: 'unexcused', label: 'Unexcused', color: 'red' },
  { value: 'late', label: 'Late', color: 'yellow' },
];

const STATUS_STYLES = {
  present:   'bg-emerald-500 text-white',
  excused:   'bg-blue-500 text-white',
  unexcused: 'bg-red-500 text-white',
  late:      'bg-yellow-500 text-slate-950',
  '':        'bg-slate-200 dark:bg-white/10 text-slate-500',
};

const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ── Create Event form ──────────────────────────────────────────────────────────
const CreateEventForm = ({ onDone }) => {
  const [form, setForm] = useState({ title: '', type: 'Meeting', date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const { user } = useAuth();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title || !form.date) { setErr('Title and date are required.'); return; }
    setSaving(true); setErr('');
    try {
      await addDoc(collection(db, 'attendance'), {
        title: form.title.trim(),
        type: form.type,
        date: form.date,
        notes: form.notes.trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        records: {},
      });
      writeLog(`Created attendance session: ${form.title}`);
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">New Attendance Session</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Title <span className="text-red-500">*</span></label>
          <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. Drill Practice" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Type</label>
          <select value={form.type} onChange={e=>set('type',e.target.value)} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500">
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date <span className="text-red-500">*</span></label>
          <input type="date" value={form.date} onChange={e=>set('date',e.target.value)} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Notes</label>
          <input value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button onClick={submit} disabled={saving} className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Create Session
      </button>
    </div>
  );
};

// ── Single session card ────────────────────────────────────────────────────────
const SessionCard = ({ session, canEdit }) => {
  const [expanded, setExpanded] = useState(false);
  const [roster, setRoster] = useState([]);
  const [records, setRecords] = useState(session.records || {});
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!expanded) return;
    getDocs(collection(db, 'roster'))
      .then(snap => setRoster(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.fullName||'').localeCompare(b.fullName||''))))
      .catch(() => {});
  }, [expanded]);

  const setStatus = (rosterDocId, status) => {
    setRecords(r => ({ ...r, [rosterDocId]: status }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'attendance', session.id), { records });
      writeLog(`Updated attendance for: ${session.title}`);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const presentCount = Object.values(records).filter(v => v === 'present').length;
  const totalCount = roster.length || Object.keys(records).length;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={() => setExpanded(e => !e)}>
        <div className="flex flex-col items-center w-10 shrink-0">
          <span className="text-[9px] font-black uppercase text-yellow-600 dark:text-yellow-400">{session.type}</span>
          <span className="text-xs font-black text-slate-800 dark:text-slate-200">{session.date?.split('-')[2] || '—'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{session.title}</p>
          <p className="text-xs text-slate-500">{fmtDate(session.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold text-slate-500">
            {presentCount}/{totalCount} present
          </span>
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-white/5">
          {roster.length === 0 ? (
            <div className="flex justify-center py-6">
              <Loader2 size={18} className="animate-spin text-yellow-500" />
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
                {roster.map(cadet => {
                  const status = records[cadet.id] || '';
                  return (
                    <div key={cadet.id} className="flex items-center gap-3 px-4 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{cadet.fullName}</p>
                        <p className="text-[10px] text-slate-400">{cadet.company} · {cadet.platoon}</p>
                      </div>
                      {canEdit ? (
                        <div className="flex gap-1">
                          {STATUS_OPTIONS.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setStatus(cadet.id, status === opt.value ? '' : opt.value)}
                              className={`text-[9px] font-black px-1.5 py-0.5 rounded transition-colors ${status === opt.value ? STATUS_STYLES[opt.value] : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10'}`}
                            >
                              {opt.label.charAt(0)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded ${STATUS_STYLES[status] || STATUS_STYLES['']}`}>
                          {status || 'Not Marked'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {canEdit && (
                <div className="p-3 bg-slate-50 dark:bg-white/2.5 flex items-center gap-3">
                  <div className="flex gap-2 text-[10px]">
                    {STATUS_OPTIONS.map(o => (
                      <span key={o.value} className="flex items-center gap-1">
                        <span className={`w-3 h-3 rounded ${STATUS_STYLES[o.value]}`}></span>
                        <span className="text-slate-500">{o.label}</span>
                      </span>
                    ))}
                  </div>
                  <button onClick={save} disabled={saving} className="ml-auto flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Save
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AdminAttendance() {
  const { role } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canEdit = userLevel >= COMMAND_L;
  const canCreate = userLevel >= STAFF_REVIEW_LEVEL;

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'attendance'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return sessions;
    return sessions.filter(s => s.type === filter);
  }, [sessions, filter]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Attendance"
        subtitle="Track attendance for events, practices, and meetings"
        icon={ClipboardList}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total Sessions" value={sessions.length} />
        <Stat label="This Month" value={sessions.filter(s => {
          const d = s.createdAt?.toDate?.() || new Date();
          return d.getMonth() === new Date().getMonth();
        }).length} />
        <Stat label="Types" value={EVENT_TYPES.length} accent />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-white/5 rounded-lg p-1 overflow-x-auto">
          <button onClick={() => setFilter('all')} className={`text-xs font-bold px-3 py-1 rounded-md transition-colors ${filter==='all' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>All</button>
          {EVENT_TYPES.map(t => (
            <button key={t} onClick={() => setFilter(t)} className={`text-xs font-bold px-3 py-1 rounded-md transition-colors ${filter===t ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>{t}</button>
          ))}
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(f => !f)} className="ml-auto flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-2 rounded-lg transition-colors">
            <Plus size={13} />
            {showForm ? 'Cancel' : 'New Session'}
          </button>
        )}
      </div>

      {showForm && <CreateEventForm onDone={() => setShowForm(false)} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-yellow-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-600">
          <ClipboardList size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold">No sessions found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <SessionCard key={s.id} session={s} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, value, accent }) => (
  <div className={`rounded-xl p-3 border ${accent ? 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10'}`}>
    <p className={`text-lg font-black ${accent ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</p>
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{label}</p>
  </div>
);
