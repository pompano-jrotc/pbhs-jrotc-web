// src/pages/AdminServiceHours.jsx
// Service Hours management — staff 70+ approve/reject; cadets see own submissions.

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, updateDoc, doc, addDoc,
  serverTimestamp, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import AdminPageHeader from '../components/AdminPageHeader';
import { writeLog } from '../lib/writeLog';
import {
  Clock, CheckCircle, XCircle, Plus, Filter, User, Calendar,
  Phone, ChevronDown, ChevronUp, Loader2, Award,
} from 'lucide-react';

const ADMIN_LEVEL = 80;
const STAFF_REVIEW_LEVEL = 70;

const STATUS_STYLES = {
  pending:  'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300',
  approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

const StatusChip = ({ status }) => (
  <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
    {status === 'pending'  && <Clock size={9} />}
    {status === 'approved' && <CheckCircle size={9} />}
    {status === 'rejected' && <XCircle size={9} />}
    {status}
  </span>
);

const fmt = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ── Submit form ────────────────────────────────────────────────────────────────
const SubmitForm = ({ userData, user, onDone }) => {
  const [form, setForm] = useState({
    activityName: '', date: '', timeIn: '', timeOut: '',
    totalHours: '', contactName: '', contactPhone: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.activityName || !form.date || !form.totalHours || !form.contactName) {
      setErr('Fill in all required fields.');
      return;
    }
    const hrs = parseFloat(form.totalHours);
    if (isNaN(hrs) || hrs <= 0) { setErr('Total hours must be a positive number.'); return; }
    setSaving(true); setErr('');
    try {
      await addDoc(collection(db, 'serviceHours'), {
        submittedBy: user.uid,
        linkedUid: user.uid,
        cadetName: userData?.fullName || '',
        company: userData?.company || '',
        activityName: form.activityName.trim(),
        date: form.date,
        timeIn: form.timeIn,
        timeOut: form.timeOut,
        totalHours: hrs,
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        status: 'pending',
        submittedAt: serverTimestamp(),
      });
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const field = (label, key, type = 'text', required = false, placeholder = '') => (
    <div>
      <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-yellow-500 focus:border-transparent outline-none"
      />
    </div>
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">Submit Service Hours</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">{field('Activity / Event Name', 'activityName', 'text', true)}</div>
        {field('Date', 'date', 'date', true)}
        {field('Time In', 'timeIn', 'text', false, 'e.g. 9:00 AM')}
        {field('Time Out', 'timeOut', 'text', false, 'e.g. 1:00 PM')}
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
            Total Hours<span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="number"
            value={form.totalHours}
            onChange={e => set('totalHours', e.target.value)}
            min="0.1"
            step="0.5"
            placeholder="0.5"
            className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-yellow-500 focus:border-transparent outline-none"
          />
        </div>
        {field('Contact Person Name', 'contactName', 'text', true)}
        {field('Contact Phone', 'contactPhone', 'tel')}
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Submit Hours
      </button>
    </div>
  );
};

// ── Entry card ─────────────────────────────────────────────────────────────────
const EntryCard = ({ entry, canReview, onApprove, onReject }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const act = async (action) => {
    setLoading(true);
    await action();
    setLoading(false);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{entry.activityName}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-slate-500">{fmt(entry.submittedAt)}</span>
            {canReview && <span className="text-xs text-slate-400 dark:text-slate-500">· {entry.cadetName}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-black text-yellow-600 dark:text-yellow-400">{entry.totalHours}h</span>
          <StatusChip status={entry.status} />
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/5 pt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Info icon={Calendar} label="Date" value={entry.date || '—'} />
            <Info icon={Clock} label="Hours" value={`${entry.timeIn || '—'} → ${entry.timeOut || '—'}`} />
            <Info icon={User} label="Contact" value={entry.contactName || '—'} />
            <Info icon={Phone} label="Phone" value={entry.contactPhone || '—'} />
          </div>

          {canReview && entry.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => act(onApprove)}
                disabled={loading}
                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                Approve
              </button>
              <button
                onClick={() => act(onReject)}
                disabled={loading}
                className="flex items-center gap-1.5 bg-red-500 hover:bg-red-400 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <XCircle size={12} />
                Reject
              </button>
            </div>
          )}
          {canReview && entry.status !== 'pending' && (
            <div className="pt-1">
              <button
                onClick={() => act(() => onApprove('pending'))}
                disabled={loading}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline"
              >
                Reset to Pending
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Info = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-1.5">
    <Icon size={11} className="text-slate-400 mt-0.5 shrink-0" />
    <div>
      <span className="block text-[9px] text-slate-400 uppercase font-bold">{label}</span>
      <span className="text-slate-700 dark:text-slate-300">{value}</span>
    </div>
  </div>
);

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AdminServiceHours({ hideHeader = false }) {
  const { user, userData, role } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canReview = userLevel >= STAFF_REVIEW_LEVEL;

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!user) return;
    let q;
    if (canReview) {
      q = query(collection(db, 'serviceHours'), orderBy('submittedAt', 'desc'));
    } else {
      q = query(
        collection(db, 'serviceHours'),
        where('linkedUid', '==', user.uid),
        orderBy('submittedAt', 'desc'),
      );
    }
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [user?.uid, canReview]);

  const approve = async (id, status = 'approved') => {
    await updateDoc(doc(db, 'serviceHours', id), { status, reviewedBy: user.uid, reviewedAt: serverTimestamp() });
    if (status === 'approved') writeLog(`Approved service hours: ${id}`);
  };
  const reject = async (id) => {
    await updateDoc(doc(db, 'serviceHours', id), { status: 'rejected', reviewedBy: user.uid, reviewedAt: serverTimestamp() });
    writeLog(`Rejected service hours: ${id}`);
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter(e => e.status === filter);
  }, [entries, filter]);

  // Per-cadet totals
  const myApproved = entries.filter(e => e.linkedUid === user?.uid && e.status === 'approved')
    .reduce((s, e) => s + (e.totalHours || 0), 0);

  const totalPending = entries.filter(e => e.status === 'pending').length;

  return (
    <div className={hideHeader ? 'w-full' : 'p-4 md:p-6 space-y-6 max-w-5xl mx-auto'}>
      {!hideHeader && (
        <AdminPageHeader
          title="Service Hours"
          subtitle={canReview ? 'Review and approve cadet community service submissions' : 'Track your community service hours'}
          icon={Award}
        />
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {canReview ? (
          <>
            <Stat label="Total Submissions" value={entries.length} />
            <Stat label="Pending Review" value={totalPending} accent />
            <Stat label="Approved" value={entries.filter(e=>e.status==='approved').length} />
            <Stat label="Rejected" value={entries.filter(e=>e.status==='rejected').length} />
          </>
        ) : (
          <>
            <Stat label="My Total" value={entries.reduce((s,e)=>s+(e.totalHours||0),0).toFixed(1) + 'h'} />
            <Stat label="Approved" value={myApproved.toFixed(1) + 'h'} accent />
            <Stat label="Pending" value={entries.filter(e=>e.status==='pending').length} />
            <Stat label="FL Grad (40h)" value={`${Math.min(100, Math.round(myApproved/40*100))}%`} />
          </>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-slate-100 dark:bg-white/5 rounded-lg p-1">
          {['all', 'pending', 'approved', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`text-xs font-bold px-3 py-1 rounded-md capitalize transition-colors ${filter === s ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(f => !f)}
          className="ml-auto flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-2 rounded-lg transition-colors"
        >
          <Plus size={13} />
          {showForm ? 'Cancel' : 'Log Hours'}
        </button>
      </div>

      {showForm && (
        <SubmitForm userData={userData} user={user} onDone={() => setShowForm(false)} />
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-yellow-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-600">
          <Award size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold">No submissions</p>
          <p className="text-xs mt-1">{filter !== 'all' ? `No ${filter} entries` : 'No service hours logged yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => (
            <EntryCard
              key={e.id}
              entry={e}
              canReview={canReview}
              onApprove={(status) => approve(e.id, status)}
              onReject={() => reject(e.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, value, accent }) => (
  <div className={`rounded-xl p-3 border ${accent ? 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10'}`}>
    <p className={`text-lg font-black ${accent ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</p>
    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mt-0.5">{label}</p>
  </div>
);
