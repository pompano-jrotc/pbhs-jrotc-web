// src/pages/AdminAchievementWall.jsx
// Achievement Wall — public display of cadet accomplishments, opt-out controlled by staff.

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY } from '../constants';
import AdminPageHeader from '../components/AdminPageHeader';
import { writeLog } from '../lib/writeLog';
import {
  Trophy, Plus, Trash2, Star, Medal, Award, Zap, Loader2,
  Eye, EyeOff, ChevronDown, ChevronUp,
} from 'lucide-react';

const STAFF_LEVEL_L = 70;

const ACHIEVEMENT_TYPES = [
  'Promotion', 'Award / Ribbon', 'Competition', 'Academic', 'Service', 'Leadership', 'Other',
];

const TYPE_ICONS = {
  'Promotion':     Trophy,
  'Award / Ribbon': Medal,
  'Competition':   Star,
  'Academic':      Award,
  'Service':       Zap,
  'Leadership':    Trophy,
  'Other':         Star,
};

const TYPE_COLORS = {
  'Promotion':     'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  'Award / Ribbon':'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  'Competition':   'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  'Academic':      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  'Service':       'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  'Leadership':    'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
  'Other':         'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
};

const fmtDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ── Post form ──────────────────────────────────────────────────────────────────
const PostForm = ({ user, onDone }) => {
  const [form, setForm] = useState({
    cadetName: '', type: 'Award / Ribbon', title: '', description: '', date: '',
    visible: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.cadetName || !form.title) { setErr('Cadet name and title are required.'); return; }
    setSaving(true); setErr('');
    try {
      await addDoc(collection(db, 'achievementWall'), {
        cadetName: form.cadetName.trim(),
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim(),
        date: form.date,
        visible: form.visible,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      writeLog(`Posted achievement: ${form.title} for ${form.cadetName}`);
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">Post Achievement</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Cadet Name <span className="text-red-500">*</span></label>
          <input value={form.cadetName} onChange={e=>set('cadetName',e.target.value)} placeholder="Full name" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Type</label>
          <select value={form.type} onChange={e=>set('type',e.target.value)} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500">
            {ACHIEVEMENT_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Title <span className="text-red-500">*</span></label>
          <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. National JROTC Award" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Date</label>
          <input type="date" value={form.date} onChange={e=>set('date',e.target.value)} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div className="flex items-center gap-3 pt-5">
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={form.visible} onChange={e=>set('visible',e.target.checked)} className="sr-only peer" />
            <div className="w-9 h-5 bg-slate-200 dark:bg-white/10 rounded-full peer peer-checked:bg-yellow-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
          </label>
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Visible on public wall</span>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Description</label>
          <textarea value={form.description} onChange={e=>set('description',e.target.value)} rows={2} placeholder="Optional details..." className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500 resize-none" />
        </div>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button onClick={submit} disabled={saving} className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Post Achievement
      </button>
    </div>
  );
};

// ── Achievement card ───────────────────────────────────────────────────────────
const AchievementCard = ({ item, canEdit }) => {
  const [loading, setLoading] = useState(false);
  const Icon = TYPE_ICONS[item.type] || Star;

  const toggleVisibility = async () => {
    setLoading(true);
    await updateDoc(doc(db, 'achievementWall', item.id), { visible: !item.visible });
    setLoading(false);
  };

  const remove = async () => {
    if (!confirm('Delete this achievement?')) return;
    await deleteDoc(doc(db, 'achievementWall', item.id));
  };

  return (
    <div className={`bg-white dark:bg-slate-900 border rounded-xl p-4 flex gap-4 items-start ${!item.visible ? 'opacity-50 border-dashed border-slate-300 dark:border-white/10' : 'border-slate-200 dark:border-white/10'}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TYPE_COLORS[item.type] || TYPE_COLORS.Other}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${TYPE_COLORS[item.type] || TYPE_COLORS.Other}`}>{item.type}</span>
            <p className="text-sm font-black text-slate-800 dark:text-slate-200 mt-1">{item.title}</p>
            <p className="text-xs text-yellow-600 dark:text-yellow-400 font-bold">{item.cadetName}</p>
            {item.description && <p className="text-xs text-slate-500 mt-1">{item.description}</p>}
            {item.date && <p className="text-[10px] text-slate-400 mt-1">{item.date}</p>}
          </div>
          {canEdit && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={toggleVisibility} disabled={loading} aria-label={item.visible ? 'Hide achievement' : 'Show achievement'} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-slate-400">
                {item.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button onClick={remove} aria-label="Delete achievement" className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AdminAchievementWall() {
  const { user, role } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canEdit = userLevel >= STAFF_LEVEL_L;

  const [achievements, setAchievements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('All');
  const [showHidden, setShowHidden] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'achievementWall'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setAchievements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    let list = achievements;
    if (!showHidden) list = list.filter(a => a.visible !== false);
    else list = achievements.filter(a => !a.visible);
    if (typeFilter !== 'All') list = list.filter(a => a.type === typeFilter);
    return list;
  }, [achievements, typeFilter, showHidden]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Achievement Wall"
        subtitle="Celebrating cadet accomplishments across the battalion"
        icon={Trophy}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total" value={achievements.length} />
        <Stat label="Visible" value={achievements.filter(a=>a.visible!==false).length} accent />
        {canEdit && <Stat label="Hidden" value={achievements.filter(a=>a.visible===false).length} />}
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-white/5 rounded-lg p-1">
          {['All', ...ACHIEVEMENT_TYPES].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={`text-xs font-bold px-2 py-1 rounded-md transition-colors ${typeFilter===t ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>{t}</button>
          ))}
        </div>
        {canEdit && (
          <button onClick={() => setShowHidden(h=>!h)} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${showHidden ? 'bg-slate-200 dark:bg-white/10 border-slate-300 dark:border-white/20 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500'}`}>
            <EyeOff size={12} />Show Hidden
          </button>
        )}
        {canEdit && (
          <button onClick={() => setShowForm(f=>!f)} className="ml-auto flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-2 rounded-lg transition-colors">
            <Plus size={13} />
            {showForm ? 'Cancel' : 'Post Achievement'}
          </button>
        )}
      </div>

      {showForm && <PostForm user={user} onDone={() => setShowForm(false)} />}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-yellow-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-600">
          <Trophy size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold">No achievements yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => (
            <AchievementCard key={a.id} item={a} canEdit={canEdit} />
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
