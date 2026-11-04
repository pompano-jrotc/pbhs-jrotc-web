// src/pages/AdminEvents.jsx
//
// Calendar events management — open to all authenticated staff.
// Events appear on the public /events calendar page.
// Schema: { title, date (YYYY-MM-DD), type, location, time, description, createdAt, updatedAt }
// Past events are shown in a collapsible Archived section.

import React, { useState, useEffect } from 'react';
import {
  collection, onSnapshot, query, orderBy,
  addDoc, updateDoc, deleteDoc, doc, setDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useCompanies } from '../hooks/useCompanies';
import { writeLog } from '../lib/writeLog';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  Calendar, Plus, Edit3, Trash2, Save, X, Loader2,
  MapPin, Clock, Info, Tag, Check, Archive, ChevronDown, ChevronRight,
  Lock, Building2, Globe, CheckSquare, Square, AlertCircle,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import DatePicker from '../components/DatePicker';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, COMMAND_LEVEL, JROTC_POSITIONS } from '../constants';

const inputClass =
  'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-colors';
const labelClass =
  'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1';

export const EVENT_TYPES = [
  'Training',
  'Competition',
  'Ceremony',
  'Field Trip',
  'Meeting',
  'Social',
  'Fundraiser',
  'Community Service',
  'Inspection',
  'No School',
  'Other',
];

export const TYPE_COLORS = {
  Training:            'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  Competition:         'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20',
  Ceremony:            'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  'Field Trip':        'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
  Meeting:             'bg-slate-400/10 text-slate-600 dark:text-slate-400 border-slate-400/20',
  Social:              'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20',
  Fundraiser:          'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'Community Service': 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
  Inspection:          'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  'No School':         'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  Other:               'bg-slate-500/10 text-slate-500 dark:text-slate-500 border-slate-500/20',
};

const TypeBadge = ({ type }) => {
  if (!type) return null;
  const colors = TYPE_COLORS[type] || TYPE_COLORS.Other;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${colors}`}>
      <Tag size={8} /> {type}
    </span>
  );
};

const BLANK = { title: '', date: '', endDate: '', type: '', location: '', time: '', description: '', isPrivate: false, scope: 'all', company: '' };

// Returns today's date string as YYYY-MM-DD in local time
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// An event is past when its end date (or start date for single-day) is before today
const isPast = (ev) => {
  const today = todayStr();
  const last = ev.endDate && ev.endDate >= ev.date ? ev.endDate : ev.date;
  return last < today;
};

// ── EventForm is defined at MODULE level so React never unmounts/remounts it
// on parent re-renders (which would steal focus on every keystroke).
const EventForm = ({ editingEvent, setField, saving, handleSave, setEditingEvent, isNew = false, companies = [], canSetPrivate = false }) => (
  <div className={`bg-white dark:bg-slate-900/40 border rounded-2xl p-5 space-y-3 ${
    isNew ? 'border-yellow-500/30' : 'border-slate-200 dark:border-white/5'
  }`}>
    {isNew && (
      <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">
        New Event
      </h3>
    )}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className={labelClass}>Title *</label>
        <input
          className={inputClass}
          value={editingEvent.title}
          onChange={e => setField('title', e.target.value)}
          placeholder="e.g. Military Ball 2025–2026"
          autoFocus={isNew}
          onKeyDown={e => e.stopPropagation()}
        />
      </div>
      <div>
        <label className={labelClass}>Start Date *</label>
        <DatePicker
          value={editingEvent.date}
          onChange={v => setField('date', v)}
          placeholder="Pick a start date"
          className={inputClass}
        />
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className={labelClass}>End Date <span className="normal-case font-medium text-slate-300 dark:text-slate-600">(optional — for multi-day events)</span></label>
        <DatePicker
          value={editingEvent.endDate || ''}
          onChange={v => setField('endDate', v)}
          placeholder="Pick an end date"
          className={inputClass}
        />
      </div>
      <div /> {/* spacer */}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <label className={labelClass}>Category</label>
        <select
          className={inputClass}
          value={editingEvent.type}
          onChange={e => setField('type', e.target.value)}
          onKeyDown={e => e.stopPropagation()}
        >
          <option value="">— Select —</option>
          {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className={labelClass}>Location</label>
        <input
          className={inputClass}
          value={editingEvent.location}
          onChange={e => setField('location', e.target.value)}
          placeholder="e.g. PBHS Gymnasium"
          onKeyDown={e => e.stopPropagation()}
        />
      </div>
      <div>
        <label className={labelClass}>Time</label>
        <input
          className={inputClass}
          value={editingEvent.time}
          onChange={e => setField('time', e.target.value)}
          placeholder="e.g. 6:00 PM"
          onKeyDown={e => e.stopPropagation()}
        />
      </div>
    </div>
    <div>
      <label className={labelClass}>Description</label>
      <textarea
        className={`${inputClass} resize-none`}
        rows={3}
        value={editingEvent.description}
        onChange={e => setField('description', e.target.value)}
        placeholder="Optional details — dress code, what to bring, special instructions, etc."
      />
    </div>

    {/* Private event toggle — only for L45+ staff */}
    {canSetPrivate && (
      <div className={`rounded-xl border p-3 transition-colors ${editingEvent.isPrivate ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-slate-200 dark:border-white/5'}`}>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            onClick={() => setField('isPrivate', !editingEvent.isPrivate)}
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${editingEvent.isPrivate ? 'bg-yellow-500' : 'bg-slate-200 dark:bg-white/10'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${editingEvent.isPrivate ? 'left-4' : 'left-0.5'}`} />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Lock size={11} className={editingEvent.isPrivate ? 'text-yellow-500' : 'text-slate-400'} />
              Private Event
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
              {editingEvent.isPrivate ? 'Visible to battalion and company leadership only (L45+)' : 'Visible to everyone on the public calendar'}
            </p>
          </div>
        </label>

        {editingEvent.isPrivate && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-yellow-500/20">
            <div>
              <label className={labelClass}>Audience</label>
              <select
                className={inputClass}
                value={editingEvent.scope || 'all'}
                onChange={e => setField('scope', e.target.value)}
                onKeyDown={e => e.stopPropagation()}
              >
                <option value="all">All Leadership (L45+)</option>
                <option value="company">Specific Company Only</option>
              </select>
            </div>
            {editingEvent.scope === 'company' && (
              <div>
                <label className={labelClass}>Company</label>
                <select
                  className={inputClass}
                  value={editingEvent.company || ''}
                  onChange={e => setField('company', e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                >
                  <option value="">— Select —</option>
                  {companies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    )}

    <div className="flex gap-2 pt-1">
      <button
        disabled={saving || !editingEvent.title || !editingEvent.date || (editingEvent.isPrivate && editingEvent.scope === 'company' && !editingEvent.company)}
        onClick={handleSave}
        className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 text-slate-950 font-black text-xs uppercase rounded-xl hover:bg-yellow-400 disabled:opacity-50 transition-all shadow-lg shadow-yellow-500/20"
      >
        {saving
          ? <Loader2 size={14} className="animate-spin" />
          : <Save size={14} />}
        {isNew ? 'Add Event' : 'Save'}
      </button>
      <button
        onClick={() => setEditingEvent(null)}
        className="flex items-center gap-2 px-5 py-2.5 bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400 font-black text-xs uppercase rounded-xl hover:opacity-70 transition-all"
      >
        <X size={14} /> Cancel
      </button>
    </div>
  </div>
);

// ── EventRow — single event card (shared between upcoming + archived) ─────────
const EventRow = ({ ev, editingEvent, formProps, onEdit, onDelete, archived = false, showEdit = true, showDelete = true }) => (
  <div className={`bg-white dark:bg-slate-900/40 border rounded-2xl overflow-hidden transition-opacity ${
    archived
      ? 'border-slate-100 dark:border-white/[0.03] opacity-60 hover:opacity-80'
      : 'border-slate-200 dark:border-white/5'
  }`}>
    {editingEvent?.id === ev.id ? (
      <div className="p-5"><EventForm {...formProps} /></div>
    ) : (
      <div className="flex items-center gap-4 p-5">
        {/* Date badge */}
        <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
          archived
            ? 'bg-slate-100 dark:bg-white/5'
            : 'bg-yellow-500/10 border border-yellow-500/20'
        }`}>
          {archived
            ? <Archive size={18} className="text-slate-400 dark:text-slate-600" />
            : <Calendar size={20} className="text-yellow-600 dark:text-yellow-500" />
          }
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className={`font-black uppercase italic text-sm truncate ${
              archived ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white'
            }`}>
              {ev.title}
            </p>
            <TypeBadge type={ev.type} />
            {ev._isPrivate && (
              <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20">
                <Lock size={8} /> Private
              </span>
            )}
          </div>
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
              {ev.date}{ev.endDate && ev.endDate !== ev.date ? ` – ${ev.endDate}` : ''}
            </span>
            {ev.location && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                <MapPin size={10} /> {ev.location}
              </span>
            )}
            {ev.time && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                <Clock size={10} /> {ev.time}
              </span>
            )}
            {ev.createdBy && (
              <span className="text-[10px] font-bold text-slate-300 dark:text-slate-700 uppercase tracking-widest">
                by {ev.createdBy}
              </span>
            )}
          </div>
          {ev.description && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed line-clamp-2">
              {ev.description}
            </p>
          )}
        </div>

        {/* Actions */}
        {(showEdit || showDelete) && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {showEdit && (
              <button
                onClick={onEdit}
                className="p-2 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-yellow-500/10 transition-all"
                title="Edit"
              >
                <Edit3 size={15} />
              </button>
            )}
            {showDelete && (
              <button
                onClick={onDelete}
                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-all"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    )}
  </div>
);

const AdminEvents = ({ hideHeader = false }) => {
  const { user, userData, role } = useAuth();
  const confirm = useConfirm();
  const { companies } = useCompanies();
  const userLevel     = ROLE_HIERARCHY[role] || 0;
  const canEditAny    = userLevel >= ADMIN_LEVEL;
  const canSetPrivate = userLevel >= COMMAND_LEVEL;
  const isBattalion   = userLevel >= STAFF_LEVEL;
  const myCompany     = userData?.company;

  const [events, setEvents]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [editingEvent, setEditingEvent] = useState(null); // null=none, BLANK=new, {id,...}=edit
  const [saving, setSaving]             = useState(false);
  const [archiveOpen, setArchiveOpen]   = useState(false);

  // ── Battalion tasks ───────────────────────────────────────────────────────
  const BLANK_TASK = { title: '', dueDate: '', description: '', priority: 'medium', assignedCompanies: [], assignedPositions: [] };
  const [tasks,         setTasks]        = useState([]);
  const [editingTask,   setEditingTask]  = useState(null);
  const [taskSaving,    setTaskSaving]   = useState(false);
  const [showDoneTasks, setShowDoneTasks] = useState(false);

  // ── Blue/Gold anchor date ─────────────────────────────────────────────────
  const DEFAULT_ANCHOR = '2026-08-03';
  const [anchorDate, setAnchorDate]     = useState(DEFAULT_ANCHOR);
  const [anchorSaving, setAnchorSaving] = useState(false);
  const [anchorSaved,  setAnchorSaved]  = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'blueGoldCalendar'), (snap) => {
      if (snap.exists() && snap.data().anchorDate) setAnchorDate(snap.data().anchorDate);
    });
    return () => unsub();
  }, []);

  const saveAnchorDate = async () => {
    setAnchorSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'blueGoldCalendar'), { anchorDate }, { merge: true });
      setAnchorSaved(true);
      setTimeout(() => setAnchorSaved(false), 2500);
      writeLog({
        type: 'settings', action: 'update',
        description: `Updated Blue/Gold calendar anchor date to ${anchorDate}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      console.error('Anchor save failed:', err);
    } finally {
      setAnchorSaving(false);
    }
  };

  // ── Events data — load public + private (for L45+) ───────────────────────
  useEffect(() => {
    let publicEvents   = [];
    let privateEvents  = [];
    let publicLoaded   = false;
    let privateLoaded  = !canSetPrivate; // skip private load for below-L45

    const merge = () => {
      if (!publicLoaded || !privateLoaded) return;
      const all = [
        ...publicEvents.map(e => ({ ...e, _isPrivate: false })),
        ...privateEvents.map(e => ({ ...e, _isPrivate: true })),
      ].sort((a, b) => (a.date > b.date ? 1 : -1));
      setEvents(all);
      setLoading(false);
    };

    const qPub = query(collection(db, 'events'), orderBy('date', 'asc'));
    const unsubPub = onSnapshot(qPub, (snap) => {
      publicEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      publicLoaded = true;
      merge();
    });

    if (!canSetPrivate) return () => unsubPub();

    const qPriv = query(collection(db, 'leadershipCalendar'), orderBy('date', 'asc'));
    const unsubPriv = onSnapshot(qPriv, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      privateEvents = isBattalion
        ? all
        : all.filter(ev =>
            ev.scope === 'all' ||
            (ev.scope === 'company' && ev.company === myCompany)
          );
      privateLoaded = true;
      merge();
    });

    return () => { unsubPub(); unsubPriv(); };
  }, [canSetPrivate, isBattalion, myCompany]);

  // ── Task listener (battalion staff only) ─────────────────────────────────
  useEffect(() => {
    if (!isBattalion) return;
    const q = query(collection(db, 'leadershipTasks'), orderBy('dueDate', 'asc'));
    return onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => t.isAssigned));
    });
  }, [isBattalion]);

  const saveTask = async () => {
    if (!editingTask?.title?.trim() || !editingTask?.dueDate) return;
    setTaskSaving(true);
    try {
      const payload = {
        title:           editingTask.title.trim(),
        dueDate:         editingTask.dueDate,
        description:     editingTask.description?.trim() || '',
        priority:        editingTask.priority || 'medium',
        isAssigned:      true,
        assignedCompanies: editingTask.assignedCompanies || [],
        assignedPositions: editingTask.assignedPositions || [],
        completed:           false,
        completedByCompany:  {},
        createdBy:       userData?.displayName || userData?.fullName || userData?.email || 'Staff',
        createdByUid:    user?.uid || '',
        createdAt:       Timestamp.now(),
      };
      if (editingTask.id) {
        const { createdAt, createdByUid, createdBy, ...updates } = payload;
        await updateDoc(doc(db, 'leadershipTasks', editingTask.id), updates);
      } else {
        await addDoc(collection(db, 'leadershipTasks'), payload);
      }
      setEditingTask(null);
    } finally {
      setTaskSaving(false);
    }
  };

  const toggleTask = async (task) => {
    await updateDoc(doc(db, 'leadershipTasks', task.id), {
      completed:   !task.completed,
      completedAt: !task.completed ? Timestamp.now() : null,
    });
  };

  const deleteTask = async (id) => {
    await deleteDoc(doc(db, 'leadershipTasks', id));
  };

  // ── Save (create or update) ───────────────────────────────────────────────
  const handleSave = async () => {
    if (!editingEvent?.title || !editingEvent?.date) return;
    const isPrivate = editingEvent._isPrivate ?? editingEvent.isPrivate ?? false;
    const targetCol = isPrivate ? 'leadershipCalendar' : 'events';
    setSaving(true);
    try {
      const payload = {
        title:       editingEvent.title.trim(),
        date:        editingEvent.date,
        endDate:     editingEvent.endDate && editingEvent.endDate > editingEvent.date
                       ? editingEvent.endDate : '',
        type:        editingEvent.type        || '',
        location:    (editingEvent.location || '').trim(),
        time:        (editingEvent.time || '').trim(),
        description: (editingEvent.description || '').trim(),
        updatedAt:   serverTimestamp(),
      };
      if (isPrivate) {
        payload.scope   = editingEvent.scope   || 'all';
        payload.company = editingEvent.scope === 'company' ? (editingEvent.company || '') : '';
      }
      if (editingEvent.id) {
        await updateDoc(doc(db, targetCol, editingEvent.id), payload);
      } else {
        await addDoc(collection(db, targetCol), {
          ...payload,
          createdBy:    userData?.fullName || 'Staff',
          createdByUid: user?.uid || '',
          createdAt:    serverTimestamp(),
        });
      }
      setEditingEvent(null);
      writeLog({
        type: isPrivate ? 'leadership_calendar' : 'event',
        action: editingEvent.id ? 'update' : 'create',
        description: `${editingEvent.id ? 'Updated' : 'Created'} ${isPrivate ? 'private' : ''} event: "${payload.title}" on ${payload.date}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: editingEvent.id || '', targetName: payload.title,
      });
    } catch (err) {
      console.error('Event save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    const ev = events.find(e => e.id === id);
    const isPrivate = ev?._isPrivate ?? false;
    const targetCol = isPrivate ? 'leadershipCalendar' : 'events';
    const ok = await confirm(
      `"${ev?.title || 'This event'}" will be removed from the ${isPrivate ? 'leadership calendar' : 'public calendar'}. This cannot be undone.`,
      { title: 'Delete Event', destructive: true }
    );
    if (!ok) return;
    try {
      await deleteDoc(doc(db, targetCol, id));
      writeLog({
        type: isPrivate ? 'leadership_calendar' : 'event', action: 'delete',
        description: `Deleted ${isPrivate ? 'private' : ''} event: "${ev?.title || id}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: ev?.title,
      });
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // ── Form helper ───────────────────────────────────────────────────────────
  const setField = (key, val) => setEditingEvent(ev => ({ ...ev, [key]: val }));

  const formProps = { editingEvent, setField, saving, handleSave, setEditingEvent, companies, canSetPrivate };

  // ── Split into upcoming / past ────────────────────────────────────────────
  const upcoming = events.filter(ev => !isPast(ev));
  const past     = events.filter(ev =>  isPast(ev));

  const makeEditHandler = (ev) => () =>
    setEditingEvent({
      id:          ev.id,
      title:       ev.title,
      date:        ev.date,
      endDate:     ev.endDate     || '',
      type:        ev.type        || '',
      location:    ev.location    || '',
      time:        ev.time        || '',
      description: ev.description || '',
      _isPrivate:  ev._isPrivate  ?? false,
      isPrivate:   ev._isPrivate  ?? false,
      scope:       ev.scope       || 'all',
      company:     ev.company     || '',
    });

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={Calendar} title="Calendar Events" />}
      {!editingEvent && (
        <div className="flex justify-end gap-2 mb-6">
          {isBattalion && (
            <button
              onClick={() => setEditingTask({ ...BLANK_TASK })}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-500/10 text-violet-600 dark:text-violet-400 font-black text-xs uppercase rounded-xl hover:bg-violet-500/20 transition-all border border-violet-500/20 whitespace-nowrap"
            >
              <CheckSquare size={14} /> New Task
            </button>
          )}
          <button
            onClick={() => setEditingEvent({ ...BLANK })}
            className="flex items-center gap-2 px-5 py-2.5 bg-yellow-500 text-slate-950 font-black text-xs uppercase rounded-xl hover:bg-yellow-400 transition-all shadow-lg shadow-yellow-500/20 whitespace-nowrap"
          >
            <Plus size={14} /> New Event
          </button>
        </div>
      )}

      {/* Blue/Gold schedule settings */}
      <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0" />
          <span className="w-3 h-3 rounded-full bg-yellow-500 flex-shrink-0" />
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">
            Blue / Gold Day Schedule
          </h2>
        </div>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-4 ml-8">
          Set the date of the first Blue Day of the school year. The calendar alternates Blue → Gold each school day, automatically skipping weekends and any events marked <strong>No School</strong>.
        </p>
        <div className="flex items-end gap-3 ml-8">
          <div className="flex-1 max-w-xs">
            <label className={labelClass}>First Blue Day</label>
            <DatePicker value={anchorDate} onChange={setAnchorDate} />
          </div>
          <button
            onClick={saveAnchorDate}
            disabled={anchorSaving}
            className={`flex items-center gap-2 px-5 py-3 font-black text-xs uppercase rounded-xl transition-all shadow-lg disabled:opacity-50 whitespace-nowrap ${
              anchorSaved
                ? 'bg-green-500 text-white shadow-green-500/20'
                : 'bg-yellow-500 text-slate-950 hover:bg-yellow-400 shadow-yellow-500/20'
            }`}
          >
            {anchorSaving
              ? <Loader2 size={14} className="animate-spin" />
              : anchorSaved
                ? <Check size={14} />
                : <Save size={14} />}
            {anchorSaved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-[11px] text-blue-700 dark:text-blue-300 mb-6">
        <Info size={15} className="flex-shrink-0 mt-0.5" />
        Events appear on the public <strong>/events</strong> calendar page, ordered by date. Location and time are optional but recommended.
      </div>

      {/* New-event form (shown above the list) */}
      {editingEvent && !editingEvent.id && <div className="mb-4"><EventForm {...formProps} isNew /></div>}

      {/* ── Upcoming events ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        {loading && (
          <div className="text-center py-16 text-slate-400 dark:text-slate-600 text-xs font-black uppercase tracking-widest animate-pulse">
            Loading events…
          </div>
        )}

        {!loading && upcoming.length === 0 && !editingEvent && (
          <div className="text-center py-14 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl text-slate-400 dark:text-slate-700 text-[10px] font-black uppercase tracking-widest">
            No upcoming events — click "New Event" to add one
          </div>
        )}

        {upcoming.map(ev => {
          const canManage = ev._isPrivate
            ? (canEditAny || (isBattalion && ev.createdByUid === user?.uid))
            : (canEditAny || isBattalion || ev.createdByUid === user?.uid);
          return (
            <EventRow
              key={ev.id + (ev._isPrivate ? '-priv' : '')}
              ev={ev}
              editingEvent={editingEvent}
              formProps={formProps}
              onEdit={makeEditHandler(ev)}
              onDelete={() => handleDelete(ev.id)}
              showEdit={canManage}
              showDelete={canManage}
            />
          );
        })}
      </div>

      {/* Floating "Add" button at the bottom if list is long */}
      {!editingEvent && upcoming.length >= 4 && (
        <button
          onClick={() => setEditingEvent({ ...BLANK })}
          className="w-full mt-4 py-4 border-2 border-dashed border-slate-300 dark:border-white/10 rounded-2xl text-xs font-black uppercase text-slate-400 hover:border-yellow-500 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={14} /> New Event
        </button>
      )}

      {/* ── Archived (past) events ──────────────────────────────────────── */}
      {!loading && past.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setArchiveOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 rounded-xl text-left bg-slate-100 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 hover:bg-slate-150 dark:hover:bg-white/5 transition-colors"
          >
            <Archive size={13} className="text-slate-400 dark:text-slate-600 flex-shrink-0" />
            <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 flex-1">
              Archived Events
            </span>
            <span className="text-[10px] font-black text-slate-300 dark:text-slate-700 mr-2">
              {past.length} past
            </span>
            {archiveOpen
              ? <ChevronDown size={13} className="text-slate-400 flex-shrink-0" />
              : <ChevronRight size={13} className="text-slate-400 flex-shrink-0" />}
          </button>

          {archiveOpen && (
            <div className="mt-2 space-y-2">
              {past.map(ev => {
                const canManage = ev._isPrivate
                  ? (canEditAny || (isBattalion && ev.createdByUid === user?.uid))
                  : (canEditAny || isBattalion || ev.createdByUid === user?.uid);
                return (
                  <EventRow
                    key={ev.id + (ev._isPrivate ? '-priv' : '')}
                    ev={ev}
                    editingEvent={editingEvent}
                    formProps={formProps}
                    onEdit={makeEditHandler(ev)}
                    onDelete={() => handleDelete(ev.id)}
                    archived
                    showEdit={canManage}
                    showDelete={canManage}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
      {/* ── Battalion Tasks ─────────────────────────────────────────────── */}
      {isBattalion && (
        <div className="mt-10">
          {/* Task form (inline modal) */}
          {editingTask && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setEditingTask(null)}>
              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="font-black uppercase italic text-sm text-slate-900 dark:text-white flex items-center gap-2">
                    <CheckSquare size={15} className="text-violet-500" />
                    {editingTask.id ? 'Edit Task' : 'New Battalion Task'}
                  </h3>
                  <button onClick={() => setEditingTask(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={16} /></button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelClass}>Title *</label>
                    <input autoFocus className={inputClass} value={editingTask.title} onChange={e => setEditingTask(t => ({ ...t, title: e.target.value }))} placeholder="Task title…" />
                  </div>
                  <div>
                    <label className={labelClass}>Due Date *</label>
                    <DatePicker value={editingTask.dueDate} onChange={v => setEditingTask(t => ({ ...t, dueDate: v }))} placeholder="Pick a due date" />
                  </div>
                  <div>
                    <label className={labelClass}>Priority</label>
                    <select className={inputClass} value={editingTask.priority} onChange={e => setEditingTask(t => ({ ...t, priority: e.target.value }))}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  {/* Companies — pill toggles, blank = all */}
                  <div className="col-span-2">
                    <label className={labelClass}>
                      Companies
                      {(editingTask.assignedCompanies || []).length > 0
                        ? <span className="ml-2 text-violet-500">{(editingTask.assignedCompanies || []).length} selected</span>
                        : <span className="ml-2 normal-case font-normal text-slate-400 dark:text-slate-500">— blank = all companies</span>
                      }
                    </label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {companies.map(co => {
                        const sel = (editingTask.assignedCompanies || []).includes(co);
                        return (
                          <button
                            key={co}
                            type="button"
                            onClick={() => setEditingTask(t => {
                              const cur = t.assignedCompanies || [];
                              return { ...t, assignedCompanies: sel ? cur.filter(x => x !== co) : [...cur, co] };
                            })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                              sel
                                ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-400/40'
                                : 'bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-violet-400/40 hover:text-violet-600 dark:hover:text-violet-400'
                            }`}
                          >
                            {co}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Positions — scrollable checkbox list, blank = all */}
                  <div className="col-span-2">
                    <label className={labelClass}>
                      Positions
                      {(editingTask.assignedPositions || []).length > 0
                        ? <span className="ml-2 text-violet-500">{(editingTask.assignedPositions || []).length} selected</span>
                        : <span className="ml-2 normal-case font-normal text-slate-400 dark:text-slate-500">— blank = all positions</span>
                      }
                    </label>
                    <div className="max-h-44 overflow-y-auto border border-slate-200 dark:border-white/10 rounded-xl bg-slate-50 dark:bg-black/30 p-1">
                      {[...JROTC_POSITIONS].reverse().map(p => {
                        const checked = (editingTask.assignedPositions || []).includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setEditingTask(t => {
                              const cur = t.assignedPositions || [];
                              return { ...t, assignedPositions: checked ? cur.filter(x => x !== p) : [...cur, p] };
                            })}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] text-left transition-all ${
                              checked
                                ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                                : 'hover:bg-slate-100 dark:hover:bg-white/5 text-slate-600 dark:text-slate-400'
                            }`}
                          >
                            <span className={`w-3.5 h-3.5 rounded flex-shrink-0 border flex items-center justify-center ${
                              checked ? 'bg-violet-500 border-violet-500' : 'border-slate-300 dark:border-white/20'
                            }`}>
                              {checked && <svg width="8" height="8" viewBox="0 0 8 8"><path d="M1.5 4l2 2 3-3.5" stroke="white" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </span>
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>Notes</label>
                    <textarea className={inputClass + ' resize-none'} rows={2} value={editingTask.description} onChange={e => setEditingTask(t => ({ ...t, description: e.target.value }))} placeholder="Optional notes…" />
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button onClick={() => setEditingTask(null)} className="flex-1 py-2 rounded-xl text-xs font-black uppercase bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 transition-colors">Cancel</button>
                  <button
                    onClick={saveTask}
                    disabled={taskSaving || !editingTask.title?.trim() || !editingTask.dueDate}
                    className="flex-1 py-2 rounded-xl text-xs font-black uppercase bg-violet-500 text-white hover:bg-violet-400 transition-colors disabled:opacity-40"
                  >
                    {taskSaving ? 'Saving…' : editingTask.id ? 'Save Changes' : 'Create Task'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tasks list */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/5 bg-violet-50/40 dark:bg-violet-500/5">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 flex items-center gap-2">
                <CheckSquare size={12} /> Battalion Tasks
                {tasks.filter(t => !t.completed && t.dueDate < new Date().toISOString().slice(0,10)).length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[9px] bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 px-1.5 py-0.5 rounded">
                    <AlertCircle size={8} /> {tasks.filter(t => !t.completed && t.dueDate < new Date().toISOString().slice(0,10)).length} overdue
                  </span>
                )}
              </h3>
              <button onClick={() => setEditingTask({ ...BLANK_TASK })} className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-violet-600 dark:text-violet-400 hover:text-violet-500 transition-colors">
                <Plus size={11} /> New Task
              </button>
            </div>

            {tasks.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-600 text-center py-8">No battalion tasks yet — click "+ New Task" to create one.</p>
            ) : (
              <div className="px-5">
                {(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  const fmtDate = str => { if (!str) return ''; const [y,m,d] = str.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m,10)-1]} ${parseInt(d,10)}`; };
                  const PSTYLE = { high:'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20', medium:'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20', low:'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10' };
                  const scopeLabel = t => {
                    if (t.assignedCompanies !== undefined) {
                      const cos = t.assignedCompanies || [];
                      const pos = t.assignedPositions || [];
                      if (!cos.length && !pos.length) return '→ All L45+';
                      const parts = [];
                      if (cos.length) parts.push(cos.join(', '));
                      if (pos.length) parts.push(pos.join(', '));
                      return `→ ${parts.join(' · ')}`;
                    }
                    return t.assignedScope === 'company' ? `→ ${t.assignedCompany}` : t.assignedScope === 'position' ? `→ ${(t.assignedPositions || []).join(', ')}` : '→ All L45+';
                  };

                  const renderRow = (t) => {
                    const coCount = Object.values(t.completedByCompany || {}).filter(Boolean).length;
                    return (
                    <div key={t.id} className="flex items-center gap-3 py-2.5 border-b border-slate-100 dark:border-white/5 last:border-0 group">
                      <span className={`flex-shrink-0 ${coCount > 0 ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'}`}>
                        {coCount > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{t.title}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{scopeLabel(t)}{t.description ? ` · ${t.description}` : ''}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[9px] font-black tabular-nums text-violet-500 dark:text-violet-400">{coCount} co. ✓</span>
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${PSTYLE[t.priority || 'medium']}`}>{t.priority || 'med'}</span>
                        <span className={`text-[10px] font-bold tabular-nums ${t.dueDate < today ? 'text-red-500' : 'text-slate-400'}`}>{fmtDate(t.dueDate)}</span>
                        <button onClick={() => setEditingTask({ ...t })} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-all"><Edit3 size={12} /></button>
                        <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    );
                  };

                  return (
                    <>
                      {tasks.map(renderRow)}
                      {tasks.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-600 text-center py-4">No tasks yet.</p>}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminEvents;
