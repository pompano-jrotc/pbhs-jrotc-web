// src/pages/AdminAFIPrep.jsx
// AFI (Annual Formal Inspection) Prep Tool — standard JROTC AFI categories, scoring, historical trends.

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY } from '../constants';
import AdminPageHeader from '../components/AdminPageHeader';
import { writeLog } from '../lib/writeLog';
import {
  ClipboardCheck, Plus, ChevronDown, ChevronUp, TrendingUp, Loader2,
  CheckCircle, XCircle, Minus, BarChart3,
} from 'lucide-react';

const STAFF_LEVEL_L = 70;
const COMMAND_L = 45;

// Standard JROTC AFI categories and sub-items
const AFI_CATEGORIES = [
  {
    id: 'personnel',
    name: 'Personnel',
    items: [
      'Strength Report Accuracy',
      'Cadet Records Maintained',
      'Promotion Orders Current',
    ],
  },
  {
    id: 'training',
    name: 'Training & Operations',
    items: [
      'Training Calendar Posted',
      'Lesson Plans on File',
      'PT Program Active',
      'Drill Proficiency',
      'First Aid Knowledge',
    ],
  },
  {
    id: 'uniform',
    name: 'Uniform & Equipment',
    items: [
      'Uniform Serviceability',
      'Proper Wear of Uniform',
      'Equipment Accountability',
      'Hand Receipt Current',
      'Supply Room Organized',
    ],
  },
  {
    id: 'admin',
    name: 'Administration',
    items: [
      'Bulletin Board Current',
      'SOP Maintained',
      'Awards Records Filed',
      'Graduation Requirements Tracked',
    ],
  },
  {
    id: 'leadership',
    name: 'Leadership & Character',
    items: [
      'Cadet Leadership Program',
      'Community Service Hours',
      'Academic Performance Monitoring',
      'Character Development Activities',
    ],
  },
  {
    id: 'safety',
    name: 'Safety',
    items: [
      'Range Safety (if applicable)',
      'Field Safety Briefings',
      'Emergency Action Plans Posted',
    ],
  },
];

const RATING_OPTIONS = [
  { value: 'outstanding', label: 'Outstanding', score: 4, color: 'bg-emerald-500 text-white' },
  { value: 'satisfactory', label: 'Satisfactory', score: 3, color: 'bg-blue-500 text-white' },
  { value: 'marginal', label: 'Marginal', score: 2, color: 'bg-yellow-500 text-slate-950' },
  { value: 'unsatisfactory', label: 'Unsatisfactory', score: 1, color: 'bg-red-500 text-white' },
  { value: 'na', label: 'N/A', score: null, color: 'bg-slate-200 dark:bg-white/10 text-slate-500' },
];

const RATING_ABBR = { outstanding: 'O', satisfactory: 'S', marginal: 'M', unsatisfactory: 'U', na: 'N/A' };

const SCORE_COLORS = {
  outstanding: 'text-emerald-600 dark:text-emerald-400',
  satisfactory: 'text-blue-600 dark:text-blue-400',
  marginal: 'text-yellow-600 dark:text-yellow-400',
  unsatisfactory: 'text-red-600 dark:text-red-400',
};

const calcScore = (ratings) => {
  const vals = Object.values(ratings).filter(r => r && r !== 'na');
  if (!vals.length) return null;
  const scores = vals.map(r => RATING_OPTIONS.find(o => o.value === r)?.score || 0);
  return Math.round(scores.reduce((a,b)=>a+b,0) / scores.length * 25);
};

const scoreLabel = (s) => {
  if (s === null) return 'Not Scored';
  if (s >= 90) return 'Outstanding';
  if (s >= 75) return 'Satisfactory';
  if (s >= 60) return 'Marginal';
  return 'Unsatisfactory';
};

// ── Create session form ────────────────────────────────────────────────────────
const CreateSessionForm = ({ user, onDone }) => {
  const [form, setForm] = useState({ title: '', date: '', inspector: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!form.title) { setErr('Title is required.'); return; }
    setSaving(true); setErr('');
    const ratings = {};
    AFI_CATEGORIES.forEach(cat => cat.items.forEach(item => { ratings[`${cat.id}::${item}`] = ''; }));
    try {
      await addDoc(collection(db, 'afiSessions'), {
        title: form.title.trim(),
        date: form.date,
        inspector: form.inspector.trim(),
        notes: form.notes.trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        ratings,
        finalized: false,
      });
      writeLog(`Created AFI session: ${form.title}`);
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-black uppercase tracking-wider">New AFI Session</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Session Name <span className="text-red-500">*</span></label>
          <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. SY 2025-26 AFI" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Inspection Date</label>
          <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Inspector</label>
          <input value={form.inspector} onChange={e=>setForm(f=>({...f,inspector:e.target.value}))} placeholder="Name / Unit" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Notes</label>
          <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
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

// ── AFI Session editor ─────────────────────────────────────────────────────────
const SessionCard = ({ session, canEdit }) => {
  const [expanded, setExpanded] = useState(false);
  const [ratings, setRatings] = useState(session.ratings || {});
  const [saving, setSaving] = useState(false);
  const [openCats, setOpenCats] = useState({});

  const score = calcScore(ratings);
  const label = scoreLabel(score);

  const setRating = (key, val) => setRatings(r => ({ ...r, [key]: val === r[key] ? '' : val }));
  const toggleCat = (id) => setOpenCats(c => ({ ...c, [id]: !c[id] }));

  const save = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'afiSessions', session.id), { ratings });
      writeLog(`Updated AFI scores for: ${session.title}`);
    } finally { setSaving(false); }
  };

  const finalize = async () => {
    if (!confirm('Finalize this session? Ratings will be locked.')) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'afiSessions', session.id), { ratings, finalized: true });
    } finally { setSaving(false); }
  };

  const scoreColor = score >= 90 ? 'text-emerald-600 dark:text-emerald-400' : score >= 75 ? 'text-blue-600 dark:text-blue-400' : score >= 60 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(e=>!e)}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{session.title}</p>
          <p className="text-xs text-slate-500">{session.date || '—'}{session.inspector ? ` · ${session.inspector}` : ''}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {score !== null && (
            <div className="text-right">
              <p className={`text-lg font-black ${scoreColor}`}>{score}</p>
              <p className="text-[9px] text-slate-400 uppercase font-bold">{label}</p>
            </div>
          )}
          {session.finalized && <span className="text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded">Final</span>}
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-white/5">
          {AFI_CATEGORIES.map(cat => {
            const isOpen = openCats[cat.id] !== false; // default open
            const catRatings = cat.items.map(item => ratings[`${cat.id}::${item}`] || '');
            const catScore = calcScore(Object.fromEntries(cat.items.map((item,i) => [item, catRatings[i]])));
            return (
              <div key={cat.id} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                <div className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-slate-50 dark:hover:bg-white/2.5" onClick={() => toggleCat(cat.id)}>
                  <span className="text-xs font-black text-slate-700 dark:text-slate-300 flex-1">{cat.name}</span>
                  {catScore !== null && <span className={`text-xs font-black ${scoreColor}`}>{catScore}</span>}
                  {isOpen ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
                </div>
                {isOpen && (
                  <div className="px-4 pb-3 space-y-1">
                    {cat.items.map(item => {
                      const key = `${cat.id}::${item}`;
                      const current = ratings[key] || '';
                      return (
                        <div key={item} className="flex items-center gap-2 py-1">
                          <span className="flex-1 text-xs text-slate-600 dark:text-slate-400">{item}</span>
                          <div className="flex gap-1">
                            {RATING_OPTIONS.map(opt => (
                              <button
                                key={opt.value}
                                disabled={!canEdit || session.finalized}
                                onClick={() => setRating(key, opt.value)}
                                className={`text-[9px] font-black px-1.5 py-0.5 rounded transition-colors disabled:cursor-not-allowed ${current === opt.value ? opt.color : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10'}`}
                                title={opt.label}
                              >
                                {RATING_ABBR[opt.value]}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {canEdit && !session.finalized && (
            <div className="p-3 bg-slate-50 dark:bg-white/2.5 flex items-center gap-3">
              <div className="text-xs text-slate-500 flex gap-3 flex-wrap">
                {RATING_OPTIONS.map(o => (
                  <span key={o.value} className="flex items-center gap-1">
                    <span className={`w-3 h-3 rounded text-[6px] flex items-center justify-center font-black ${o.color}`}>{RATING_ABBR[o.value]}</span>
                    <span>{o.label}</span>
                  </span>
                ))}
              </div>
              <div className="ml-auto flex gap-2">
                <button onClick={save} disabled={saving} className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                  Save
                </button>
                <button onClick={finalize} disabled={saving} className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  Finalize
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AdminAFIPrep({ hideHeader = false }) {
  const { user, role } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canEdit = userLevel >= COMMAND_L;
  const canCreate = userLevel >= STAFF_LEVEL_L;

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'afiSessions'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const latestScore = useMemo(() => {
    const finalized = sessions.filter(s => s.finalized);
    if (!finalized.length) return null;
    return calcScore(finalized[0].ratings);
  }, [sessions]);

  return (
    <div className={hideHeader ? 'w-full' : 'p-4 md:p-6 space-y-6 max-w-5xl mx-auto'}>
      {!hideHeader && (
        <AdminPageHeader
          title="AFI Prep"
          subtitle="Annual Formal Inspection preparation and scoring"
          icon={ClipboardCheck}
        />
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Sessions" value={sessions.length} />
        <Stat label="Finalized" value={sessions.filter(s=>s.finalized).length} accent />
        <Stat label="Latest Score" value={latestScore !== null ? latestScore : '—'} />
      </div>

      {/* Trend — simple bar chart */}
      {sessions.filter(s=>s.finalized).length >= 2 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <p className="text-xs font-black uppercase text-slate-500 mb-3 flex items-center gap-1.5"><TrendingUp size={13} />Score Trend</p>
          <div className="flex items-end gap-2 h-16">
            {sessions.filter(s=>s.finalized).slice(0,8).reverse().map(s => {
              const sc = calcScore(s.ratings);
              const h = sc ? Math.round(sc / 100 * 100) : 0;
              return (
                <div key={s.id} className="flex flex-col items-center gap-1 flex-1">
                  <div className={`w-full rounded-t ${sc >= 90 ? 'bg-emerald-500' : sc >= 75 ? 'bg-blue-500' : sc >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{height:`${Math.max(h, 2)}%`}} title={`${sc}`} />
                  <span className="text-[8px] text-slate-400 truncate w-full text-center">{(s.title||'').split(' ')[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        {canCreate && (
          <button onClick={() => setShowForm(f=>!f)} className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-2 rounded-lg transition-colors">
            <Plus size={13} />{showForm ? 'Cancel' : 'New AFI Session'}
          </button>
        )}
      </div>

      {showForm && <CreateSessionForm user={user} onDone={() => setShowForm(false)} />}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-yellow-500" /></div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-600">
          <ClipboardCheck size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold">No AFI sessions yet</p>
          {canCreate && <p className="text-xs mt-1">Create your first session to begin tracking</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => <SessionCard key={s.id} session={s} canEdit={canEdit} />)}
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
