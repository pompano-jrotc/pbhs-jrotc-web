// src/pages/AdminScholarshipBoard.jsx
// Scholarship & Opportunity Board — staff post, all cadets view/bookmark.

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import AdminPageHeader from '../components/AdminPageHeader';
import {
  GraduationCap, Plus, Bookmark, BookmarkCheck, ExternalLink, Trash2,
  Calendar, DollarSign, Loader2, ChevronDown, ChevronUp, Tag,
} from 'lucide-react';

const STAFF_LEVEL_L = 70;

const CATEGORIES = [
  'All', 'Scholarship', 'Internship', 'Program', 'Competition', 'Award', 'Other',
];

const CAT_STYLES = {
  Scholarship: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  Internship:  'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  Program:     'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  Competition: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  Award:       'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  Other:       'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
};

const fmtDeadline = (d) => {
  if (!d) return null;
  const date = new Date(d + 'T00:00:00');
  const diff = Math.ceil((date - new Date()) / 86400000);
  if (diff < 0) return { label: 'Closed', cls: 'text-red-500' };
  if (diff === 0) return { label: 'Due Today!', cls: 'text-red-500 font-black' };
  if (diff <= 7) return { label: `${diff}d left`, cls: 'text-orange-500 font-bold' };
  if (diff <= 30) return { label: `${diff}d left`, cls: 'text-yellow-600 dark:text-yellow-400' };
  return { label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), cls: 'text-slate-500' };
};

// ── Post form ──────────────────────────────────────────────────────────────────
const PostForm = ({ user, onDone }) => {
  const [form, setForm] = useState({
    title: '', category: 'Scholarship', description: '', url: '',
    amount: '', deadline: '', eligibility: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.title || !form.description) { setErr('Title and description are required.'); return; }
    if (form.url && !form.url.match(/^https?:\/\//i)) { setErr('URL must start with https://'); return; }
    setSaving(true); setErr('');
    try {
      await addDoc(collection(db, 'scholarshipBoard'), {
        ...form,
        title: form.title.trim(),
        description: form.description.trim(),
        url: form.url.trim(),
        amount: form.amount.trim(),
        eligibility: form.eligibility.trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        bookmarkedBy: [],
        active: true,
      });
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">Post Opportunity</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Title <span className="text-red-500">*</span></label>
          <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. ROTC Scholarship" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Category</label>
          <select value={form.category} onChange={e=>set('category',e.target.value)} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500">
            {CATEGORIES.filter(c=>c!=='All').map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Deadline</label>
          <input type="date" value={form.deadline} onChange={e=>set('deadline',e.target.value)} className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Amount / Value</label>
          <input value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="e.g. $5,000 / year" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Application URL</label>
          <input value={form.url} onChange={e=>set('url',e.target.value)} placeholder="https://..." className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Eligibility</label>
          <input value={form.eligibility} onChange={e=>set('eligibility',e.target.value)} placeholder="e.g. Junior/Senior, GPA 3.0+" className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Description <span className="text-red-500">*</span></label>
          <textarea value={form.description} onChange={e=>set('description',e.target.value)} rows={3} placeholder="Details about the opportunity..." className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500 resize-none" />
        </div>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button onClick={submit} disabled={saving} className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Post Opportunity
      </button>
    </div>
  );
};

// ── Opportunity card ───────────────────────────────────────────────────────────
const OpportunityCard = ({ opp, uid, canEdit }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const bookmarked = opp.bookmarkedBy?.includes(uid);
  const deadline = fmtDeadline(opp.deadline);

  const toggleBookmark = async (e) => {
    e.stopPropagation();
    if (!uid) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'scholarshipBoard', opp.id), {
        bookmarkedBy: bookmarked ? arrayRemove(uid) : arrayUnion(uid),
      });
    } finally { setLoading(false); }
  };

  const remove = async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this opportunity?')) return;
    await deleteDoc(doc(db, 'scholarshipBoard', opp.id));
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(e=>!e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${CAT_STYLES[opp.category] || CAT_STYLES.Other}`}>{opp.category}</span>
            {opp.amount && (
              <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                <DollarSign size={9} />{opp.amount}
              </span>
            )}
            {deadline && (
              <span className={`text-[9px] font-bold flex items-center gap-0.5 ${deadline.cls}`}>
                <Calendar size={9} />{deadline.label}
              </span>
            )}
          </div>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{opp.title}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-slate-400">{opp.bookmarkedBy?.length || 0} saved</span>
          <button onClick={toggleBookmark} disabled={loading} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark opportunity'} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
            {bookmarked ? <BookmarkCheck size={15} className="text-yellow-500" /> : <Bookmark size={15} className="text-slate-400" />}
          </button>
          {canEdit && <button onClick={remove} aria-label="Delete opportunity" className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>}
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/5 pt-3 space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-400">{opp.description}</p>
          {opp.eligibility && (
            <p className="text-xs text-slate-500"><span className="font-bold">Eligibility:</span> {opp.eligibility}</p>
          )}
          {opp.url && (
            <a href={opp.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-yellow-600 dark:text-yellow-400 hover:underline" onClick={e => e.stopPropagation()}>
              <ExternalLink size={12} />Apply / Learn More
            </a>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AdminScholarshipBoard() {
  const { user, role } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canPost = userLevel >= STAFF_LEVEL_L;

  const [opps, setOpps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('All');
  const [onlyBookmarked, setOnlyBookmarked] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'scholarshipBoard'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setOpps(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    let list = opps;
    if (cat !== 'All') list = list.filter(o => o.category === cat);
    if (onlyBookmarked) list = list.filter(o => o.bookmarkedBy?.includes(user?.uid));
    return list;
  }, [opps, cat, onlyBookmarked, user?.uid]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Scholarship Board"
        subtitle="Scholarships, internships, and opportunities for cadets"
        icon={GraduationCap}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total" value={opps.length} />
        <Stat label="Upcoming" value={opps.filter(o => o.deadline && new Date(o.deadline+'T00:00:00') > new Date()).length} accent />
        <Stat label="My Saved" value={opps.filter(o=>o.bookmarkedBy?.includes(user?.uid)).length} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex flex-wrap gap-1 bg-slate-100 dark:bg-white/5 rounded-lg p-1">
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCat(c)} className={`text-xs font-bold px-3 py-1 rounded-md transition-colors ${cat===c ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500'}`}>{c}</button>
          ))}
        </div>
        <button onClick={() => setOnlyBookmarked(b => !b)} className={`flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${onlyBookmarked ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400' : 'border-slate-200 dark:border-white/10 text-slate-500'}`}>
          <Bookmark size={12} />My Saved
        </button>
        {canPost && (
          <button onClick={() => setShowForm(f => !f)} className="ml-auto flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-2 rounded-lg transition-colors">
            <Plus size={13} />
            {showForm ? 'Cancel' : 'Post Opportunity'}
          </button>
        )}
      </div>

      {showForm && <PostForm user={user} onDone={() => setShowForm(false)} />}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-yellow-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-600">
          <GraduationCap size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold">No opportunities found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(o => (
            <OpportunityCard key={o.id} opp={o} uid={user?.uid} canEdit={canPost} />
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
