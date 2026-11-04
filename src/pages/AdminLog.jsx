// src/pages/AdminLog.jsx
//
// Activity Log — Staff (70+) only.
// Shows a real-time feed of all adminLog entries: auto-generated action
// records (sign-in, roster edits, uniform/form approvals, and all portal
// mutations from v1.6.25+) plus manual duty-log entries written by staff.

import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import {
  collection, onSnapshot, orderBy, query, addDoc, serverTimestamp,
} from 'firebase/firestore';
import {
  // existing
  ScrollText, Plus, X, Clock, LogIn, Shirt, ClipboardList,
  Users, ShieldCheck, AlertCircle, FileText, Bell,
  // new
  Search, Megaphone, Tent, Trophy, PenLine, File, Calendar,
  MessageSquare, DollarSign, Archive, Award, Star, BookOpen,
  NotebookPen, Newspaper, Package, Camera, ClipboardCheck,
  Lock, Monitor, Settings, Box, UserCheck, Ruler, Filter,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import { Navigate } from 'react-router-dom';
import ScrambleText from '../components/ScrambleText';

// ── Constants ─────────────────────────────────────────────────────────────────

const MANUAL_CATEGORIES = [
  'Duty Note', 'Incident', 'Supply', 'Training', 'Admin', 'Other',
];

const LOG_TYPES = [
  { key: 'all',             label: 'All' },
  // Staff / auth
  { key: 'manual',          label: 'Duty Log' },
  { key: 'auth',            label: 'Sign-ins' },
  { key: 'account',         label: 'Accounts' },
  { key: 'settings',        label: 'Settings' },
  // People & org
  { key: 'roster',          label: 'Roster' },
  { key: 'leadership',      label: 'Leadership' },
  { key: 'team',            label: 'Teams' },
  { key: 'honor_company',   label: 'Honor Company' },
  // Events & activities
  { key: 'event',                label: 'Events' },
  { key: 'leadership_calendar',  label: 'Leadership Cal' },
  { key: 'camp',                 label: 'Camps' },
  { key: 'cadet_challenge', label: 'Cadet Challenge' },
  { key: 'meeting_log',     label: 'Meeting Logs' },
  { key: 'aar_log',         label: 'AAR Logs' },
  { key: 's1',              label: 'S1 / S4' },
  // Supply & logistics
  { key: 'supply',          label: 'Supply' },
  { key: 'order',           label: 'Orders' },
  { key: 's2',              label: 'S2' },
  { key: 's6',              label: 'S6' },
  { key: 'uniform',         label: 'Uniforms' },
  { key: 'uniform_sizes',   label: 'Uniform Sizes' },
  { key: 'form',            label: 'Form Requests' },
  // Content & comms
  { key: 'announcement',    label: 'Announcements' },
  { key: 'newsletter',      label: 'Newsletters' },
  { key: 'document',        label: 'Documents' },
  { key: 'photos',          label: 'Photos' },
  { key: 'content',         label: 'Content' },
  { key: 'feedback',        label: 'Feedback' },
  // Finance & records
  { key: 'fundraiser',      label: 'Fundraiser' },
  { key: 'history',         label: 'History' },
];

const TYPE_META = {
  // ── Original types ─────────────────────────────────────────────────────────
  manual:          { icon: FileText,      color: 'text-yellow-500',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20',  label: 'Duty Log'       },
  auth:            { icon: LogIn,         color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    label: 'Sign-in'        },
  uniform:         { icon: Shirt,         color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  label: 'Uniform'        },
  form:            { icon: ClipboardList, color: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    label: 'Form Request'   },
  roster:          { icon: Users,         color: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/20',   label: 'Roster'         },
  account:         { icon: ShieldCheck,   color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  label: 'Account'        },
  // ── v1.6.25 types ──────────────────────────────────────────────────────────
  announcement:    { icon: Megaphone,     color: 'text-pink-400',    bg: 'bg-pink-500/10',    border: 'border-pink-500/20',    label: 'Announcement'   },
  camp:            { icon: Tent,          color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Camp'           },
  cadet_challenge: { icon: Trophy,        color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   label: 'Cadet Challenge'},
  content:         { icon: PenLine,       color: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/20',  label: 'Content'        },
  document:        { icon: File,          color: 'text-slate-300',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20',   label: 'Document'       },
  event:                { icon: Calendar,      color: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/20',    label: 'Event'              },
  leadership_calendar:  { icon: Lock,          color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  label: 'Leadership Cal'     },
  feedback:        { icon: MessageSquare, color: 'text-teal-400',    bg: 'bg-teal-500/10',    border: 'border-teal-500/20',    label: 'Feedback'       },
  fundraiser:      { icon: DollarSign,    color: 'text-lime-400',    bg: 'bg-lime-500/10',    border: 'border-lime-500/20',    label: 'Fundraiser'     },
  history:         { icon: Archive,       color: 'text-indigo-400',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/20',  label: 'History'        },
  honor_company:   { icon: Award,         color: 'text-yellow-300',  bg: 'bg-yellow-300/10',  border: 'border-yellow-300/20',  label: 'Honor Company'  },
  leadership:      { icon: Star,          color: 'text-amber-300',   bg: 'bg-amber-300/10',   border: 'border-amber-300/20',   label: 'Leadership'     },
  meeting_log:     { icon: BookOpen,      color: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/20',     label: 'Meeting Log'    },
  aar_log:         { icon: NotebookPen,   color: 'text-blue-300',    bg: 'bg-blue-300/10',    border: 'border-blue-300/20',    label: 'AAR Log'        },
  newsletter:      { icon: Newspaper,     color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/20', label: 'Newsletter'     },
  order:           { icon: Package,       color: 'text-orange-300',  bg: 'bg-orange-300/10',  border: 'border-orange-300/20',  label: 'Order'          },
  photos:          { icon: Camera,        color: 'text-purple-300',  bg: 'bg-purple-300/10',  border: 'border-purple-300/20',  label: 'Photos'         },
  s1:              { icon: ClipboardCheck,color: 'text-green-300',   bg: 'bg-green-300/10',   border: 'border-green-300/20',   label: 'S1 / S4'        },
  s2:              { icon: Lock,          color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',     label: 'S2'             },
  s6:              { icon: Monitor,       color: 'text-cyan-300',    bg: 'bg-cyan-300/10',    border: 'border-cyan-300/20',    label: 'S6'             },
  settings:        { icon: Settings,      color: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/20',   label: 'Settings'       },
  supply:          { icon: Box,           color: 'text-amber-500',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   label: 'Supply'         },
  team:            { icon: UserCheck,     color: 'text-teal-300',    bg: 'bg-teal-300/10',    border: 'border-teal-300/20',    label: 'Team'           },
  uniform_sizes:   { icon: Ruler,         color: 'text-violet-300',  bg: 'bg-violet-300/10',  border: 'border-violet-300/20',  label: 'Uniform Sizes'  },
};

// ── Action → card theme ───────────────────────────────────────────────────────
// Maps the entry's `action` field to a semantic color theme for the card.
// Type-badge / icon colors come from TYPE_META above and are unchanged.

const ACTION_THEMES = {
  // Green — creation / positive resolution
  create:          'green',
  approve:         'green',
  fulfill:         'green',
  finalize:        'green',
  mark_complete:   'green',
  open:            'green',
  assign:          'green',
  log:             'green',
  add_category:    'green',
  archive:         'green',
  reactivate:      'green',
  // Red — deletion / negative resolution
  delete:          'red',
  deny:            'red',
  close:           'red',
  void:            'red',
  remove_category: 'red',
  reset:           'red',
  delete_year:     'red',
  suspend:         'red',
  reject:          'red',
  // Yellow — modification
  update:          'yellow',
  mark_pending:    'yellow',
  mark_reviewed:   'yellow',
  save:            'yellow',
  // Blue — authentication
  sign_in:         'blue',
  // Manual duty-log entries and anything else → default (no card tint)
};

const THEME_CARD = {
  green:   { bg: 'bg-emerald-500/5',  border: 'border-emerald-500/20',  hover: 'hover:border-emerald-500/35',  action: 'text-emerald-400' },
  red:     { bg: 'bg-red-500/5',      border: 'border-red-500/20',      hover: 'hover:border-red-500/35',      action: 'text-red-400'     },
  yellow:  { bg: 'bg-yellow-500/5',   border: 'border-yellow-500/20',   hover: 'hover:border-yellow-500/35',   action: 'text-yellow-500'  },
  blue:    { bg: 'bg-blue-500/5',     border: 'border-blue-500/20',     hover: 'hover:border-blue-500/35',     action: 'text-blue-400'    },
  default: { bg: 'bg-slate-900',      border: 'border-white/5',         hover: 'hover:border-white/10',        action: 'text-slate-500'   },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts?.toDate) return '—';
  const secs = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fullDate(ts) {
  if (!ts?.toDate) return '';
  return ts.toDate().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

const AdminLog = ({ hideHeader = false }) => {
  const { role, userData, loading: authLoading } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const isAuth = userLevel >= STAFF_LEVEL;

  const [entries,    setEntries]    = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading,    setLoading]    = useState(true);

  // Manual entry modal state
  const [modalOpen,    setModalOpen]    = useState(false);
  const [category,     setCategory]     = useState(MANUAL_CATEGORIES[0]);
  const [description,  setDescription]  = useState('');
  const [notes,        setNotes]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [notification, setNotification] = useState(null);

  const showNotify = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const resetModal = () => {
    setCategory(MANUAL_CATEGORIES[0]);
    setDescription('');
    setNotes('');
    setModalOpen(false);
  };

  // ── Live feed ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuth) return;
    const q = query(collection(db, 'adminLog'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [isAuth]);

  // ── Manual entry submit ─────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!description.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'adminLog'), {
        type:         'manual',
        action:       category.toLowerCase().replace(/\s+/g, '-'),
        description:  description.trim(),
        userId:       auth.currentUser?.uid || '',
        userFullName: userData?.fullName || 'Unknown',
        userRole:     role || '',
        targetId:     null,
        targetName:   null,
        category,
        notes:        notes.trim() || null,
        timestamp:    serverTimestamp(),
      });
      showNotify('Log entry saved');
      resetModal();
    } catch {
      showNotify('Failed to save entry', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (authLoading) return null;
  if (!isAuth) return <Navigate to="/admin/dashboard" />;

  // ── Filtered entries ────────────────────────────────────────────────────────
  const filtered = entries.filter(e => {
    const matchesType = typeFilter === 'all' || e.type === typeFilter;
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term || [
      e.description, e.userFullName, e.targetName, e.action, e.notes, e.category,
    ].some(f => (f || '').toLowerCase().includes(term));
    return matchesType && matchesSearch;
  });

  const isFiltered = typeFilter !== 'all' || searchTerm.trim() !== '';

  return (
    <div className={hideHeader ? 'w-full' : 'min-h-screen bg-slate-950 text-white p-8 pt-24 font-sans'}>

      {/* Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className={`fixed top-10 left-1/2 z-[200] flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl border-l-4 ${
              notification.type === 'error'
                ? 'bg-slate-900 border-red-500 text-red-400'
                : 'bg-slate-900 border-yellow-500 text-yellow-500'
            }`}
          >
            {notification.type === 'error' ? <AlertCircle size={18} /> : <Bell size={18} />}
            <span className="text-[11px] font-black uppercase tracking-wider">{notification.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      {!hideHeader && (
        <div className="mb-8 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <Link to="/admin/dashboard" className="text-yellow-500 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest mb-2 hover:opacity-70 transition-all">
              <span className="text-base leading-none">&#8592;</span> Back to Command
            </Link>
            <h1 className="text-4xl font-black uppercase italic tracking-tighter flex items-center gap-3">
              <ScrollText className="text-yellow-500" />
              <ScrambleText text="Activity Log" trigger="mount" />
            </h1>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500 mt-1">
              {isFiltered
                ? `${filtered.length} of ${entries.length} entries`
                : `${entries.length} total entries`}
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-yellow-500 text-slate-950 px-6 py-2.5 rounded-xl text-xs font-black uppercase hover:bg-yellow-400 transition-all shadow-lg shadow-yellow-500/10"
          >
            <Plus size={16} /> Add Duty Log Entry
          </button>
        </div>
      )}
      {hideHeader && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-yellow-500 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-black uppercase hover:bg-yellow-400 transition-all shadow-lg shadow-yellow-500/20"
          >
            <Plus size={16} /> Add Duty Log Entry
          </button>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search entries by description, name, or action…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-white/5 rounded-xl pl-9 pr-9 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Type filter tabs — horizontal scroll */}
      <div
        className="mb-6 overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
          {LOG_TYPES.map(({ key, label }) => {
            const meta = TYPE_META[key];
            const Icon = meta?.icon;
            const count = key === 'all' ? null : entries.filter(e => e.type === key).length;
            return (
              <button
                key={key}
                onClick={() => setTypeFilter(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap ${
                  typeFilter === key
                    ? 'bg-yellow-500 text-slate-950'
                    : 'bg-slate-900 text-slate-500 hover:text-slate-300 border border-white/5'
                }`}
              >
                {Icon && key !== 'all' && <Icon size={10} />}
                {label}
                {count !== null && count > 0 && (
                  <span className={`ml-0.5 ${typeFilter === key ? 'opacity-70' : 'opacity-40'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-24">
            <Clock size={28} className="text-yellow-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-white/10 rounded-3xl">
            <ScrollText className="mx-auto text-slate-600 mb-4" size={36} />
            <p className="text-slate-500 font-bold uppercase tracking-widest text-sm">No entries found</p>
            {isFiltered ? (
              <button
                onClick={() => { setTypeFilter('all'); setSearchTerm(''); }}
                className="mt-3 text-yellow-500 text-xs font-black uppercase tracking-widest hover:opacity-70 transition-all"
              >
                Clear filters
              </button>
            ) : (
              <p className="text-slate-600 text-xs mt-2">
                Actions logged by staff will appear here automatically.
              </p>
            )}
          </div>
        ) : (
          filtered.map(entry => {
            const meta  = TYPE_META[entry.type] || TYPE_META.manual;
            const Icon  = meta.icon;
            const theme = ACTION_THEMES[entry.action] ?? 'default';
            const card  = THEME_CARD[theme];
            return (
              <div
                key={entry.id}
                className={`${card.bg} border ${card.border} ${card.hover} rounded-xl px-5 py-4 flex items-start gap-4 transition-colors`}
              >
                {/* Icon — type color unchanged */}
                <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${meta.bg} border ${meta.border}`}>
                  <Icon size={14} className={meta.color} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        {/* Type badge — keeps type color */}
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} border ${meta.border}`}>
                          {entry.category || meta.label}
                        </span>
                        {/* Action label — colored by action theme */}
                        <span className={`text-[10px] font-bold uppercase ${card.action}`}>
                          {entry.action?.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-white leading-snug">{entry.description}</p>
                      {entry.notes && (
                        <p className="text-xs text-slate-400 mt-1 italic leading-snug">{entry.notes}</p>
                      )}
                      <p className="text-[10px] text-slate-600 mt-1 font-bold">
                        {entry.userFullName || 'Unknown'}
                        {entry.userRole ? ` · ${entry.userRole.replace(/_/g, ' ')}` : ''}
                        {entry.targetName ? ` · ${entry.targetName}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-600 font-bold shrink-0" title={fullDate(entry.timestamp)}>
                      {timeAgo(entry.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Manual entry modal */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div onClick={resetModal} className="absolute inset-0 bg-slate-950/80" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-slate-900 border border-white/10 w-full max-w-md rounded-[2rem] shadow-2xl p-8"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black uppercase italic tracking-tighter flex items-center gap-2">
                  <FileText size={18} className="text-yellow-500" /> Duty Log Entry
                </h2>
                <button onClick={resetModal} className="text-slate-500 hover:text-white transition-colors">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Category */}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">
                    Category
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {MANUAL_CATEGORIES.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setCategory(cat)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border transition-all ${
                          category === cat
                            ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                            : 'bg-white/5 text-slate-400 border-white/5 hover:border-yellow-500/30'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-yellow-500 block mb-1.5">
                    Entry *
                  </label>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Brief summary of the event or action…"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !saving && description.trim() && handleSubmit()}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                    Notes (optional)
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Additional details, follow-up actions, personnel involved…"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors resize-none"
                  />
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={saving || !description.trim()}
                  className="w-full py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black uppercase text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Clock size={14} className="animate-spin" /> : <Plus size={14} />}
                  {saving ? 'Saving…' : 'Log Entry'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default AdminLog;
