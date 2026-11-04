// src/pages/AdminFeedback.jsx
//
// Feedback, feature requests, and bug reports management.
//
// SUBMIT  : any authenticated user (via floating button in AdminLayout)
// VIEW    : s5_public_affairs, s6_technology, battalion top 3 (XO/CSM/BC), instructors
// RESOLVE : same as view
// DELETE  : instructors + ADMIN_LEVEL

import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import {
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, Timestamp, orderBy,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY, ADMIN_LEVEL } from '../constants';
import {
  MessageSquare, Bug, Lightbulb, MessageCircle, Plus, X, Trash2,
  CheckCircle2, Clock, Loader2, ChevronDown, ChevronUp, Filter,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';

// ── Access ────────────────────────────────────────────────────────────────────
const VIEW_ROLES = [
  's5_public_affairs', 's6_technology',
  'battalion_xo', 'battalion_csm', 'battalion_commander',
  'senior_army_instructor', 'army_instructor',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const TYPE_META = {
  Bug:              { icon: <Bug size={12} />,          color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  'Feature Request':{ icon: <Lightbulb size={12} />,   color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  Feedback:         { icon: <MessageCircle size={12} />,color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
};

const PRIORITY_COLOR = {
  Low:    'bg-slate-400/10 text-slate-500 border-slate-400/20',
  Medium: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20',
  High:   'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
};

const STATUS_META = {
  Open:       { color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/20', icon: <Clock size={10} /> },
  'In Review':{ color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',         icon: <Loader2 size={10} /> },
  Resolved:   { color: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',     icon: <CheckCircle2 size={10} /> },
};

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const Badge = ({ meta, label }) => meta ? (
  <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border ${meta.color}`}>
    {meta.icon} {label}
  </span>
) : null;

// ── Main page ─────────────────────────────────────────────────────────────────
const AdminFeedback = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  const userLevel = ROLE_HIERARCHY[role] || 0;

  const canView   = VIEW_ROLES.includes(role) || userLevel >= ADMIN_LEVEL;
  const canDelete = userLevel >= 95; // instructors only

  const [items,       setItems]       = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expanded,    setExpanded]    = useState(null);   // id of expanded row
  const [deleting,    setDeleting]    = useState(null);
  const [updating,    setUpdating]    = useState(null);
  const [filterType,   setFilterType]   = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');

  useEffect(() => {
    if (!canView) return;
    const q = query(collection(db, 'feedback'), orderBy('submittedAt', 'desc'));
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingData(false);
    });
  }, [canView]);

  const filtered = useMemo(() => items.filter(it => {
    if (filterType !== 'All' && it.type !== filterType) return false;
    if (filterStatus !== 'All' && it.status !== filterStatus) return false;
    return true;
  }), [items, filterType, filterStatus]);

  const handleStatusChange = async (id, newStatus) => {
    const item = items.find(i => i.id === id);
    setUpdating(id);
    try {
      await updateDoc(doc(db, 'feedback', id), {
        status: newStatus,
        ...(newStatus === 'Resolved' ? {
          resolvedAt: Timestamp.now(),
          resolvedByName: userData?.fullName || '',
        } : {}),
      });
      writeLog({
        type: 'feedback', action: 'status_change',
        description: `Feedback "${item?.title || id}" marked ${newStatus}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: item?.title,
        notes: `status:${newStatus}`,
      });
    } finally {
      setUpdating(null);
    }
  };

  const handleDelete = async (item) => {
    const ok = await confirm(`Delete "${item.title}"? This cannot be undone.`, { title: 'Delete Feedback', destructive: true });
    if (!ok) return;
    setDeleting(item.id);
    try {
      await deleteDoc(doc(db, 'feedback', item.id));
      writeLog({
        type: 'feedback', action: 'delete',
        description: `Deleted feedback: "${item.title}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: item.id, targetName: item.title,
      });
    }
    finally { setDeleting(null); }
  };

  if (authLoading) return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500" />
    </div>
  );

  if (!canView) return <Navigate to="/admin/dashboard" />;

  const counts = { Open: 0, 'In Review': 0, Resolved: 0 };
  items.forEach(it => { if (counts[it.status] !== undefined) counts[it.status]++; });

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={MessageSquare} title="Feedback Hub" />}

        {/* Status summary */}
        <div className="flex items-center gap-3 flex-shrink-0 mb-10">
          {Object.entries(counts).map(([status, n]) => (
            <button
              key={status}
              onClick={() => setFilterStatus(s => s === status ? 'All' : status)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                filterStatus === status
                  ? STATUS_META[status].color
                  : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              {STATUS_META[status].icon}
              {n} {status}
            </button>
          ))}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <Filter size={12} className="text-slate-400" />
          {['All', 'Bug', 'Feature Request', 'Feedback'].map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                filterType === t
                  ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                  : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* List */}
        {loadingData ? (
          <div className="text-center py-24">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-yellow-500 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
            <MessageSquare className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={40} />
            <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No submissions yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => (
              <div
                key={item.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm"
              >
                <div
                  className="flex items-start gap-4 p-5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpanded(e => e === item.id ? null : item.id)}
                >
                  {/* Type/status column */}
                  <div className="flex flex-col gap-1.5 shrink-0 pt-0.5">
                    <Badge meta={TYPE_META[item.type]} label={item.type} />
                    <Badge meta={PRIORITY_COLOR[item.priority] ? { icon: null, color: PRIORITY_COLOR[item.priority] } : null} label={item.priority} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white text-sm truncate">{item.title}</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase mt-0.5">
                      {item.submittedByName || 'Anonymous'} · {fmtDate(item.submittedAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge meta={STATUS_META[item.status]} label={item.status} />
                    {expanded === item.id ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                  </div>
                </div>

                {/* Expanded details */}
                {expanded === item.id && (
                  <div className="border-t border-slate-100 dark:border-white/5 px-5 pb-5 pt-4 space-y-4">
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                      {item.description || <span className="text-slate-400 italic">No description provided.</span>}
                    </p>

                    {item.status === 'Resolved' && item.resolvedAt && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">
                        Resolved {fmtDate(item.resolvedAt)} by {item.resolvedByName || '—'}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {item.status !== 'In Review' && (
                        <button
                          onClick={() => handleStatusChange(item.id, 'In Review')}
                          disabled={!!updating}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all disabled:opacity-50"
                        >
                          {updating === item.id ? <Loader2 size={10} className="animate-spin" /> : <Loader2 size={10} />}
                          Mark In Review
                        </button>
                      )}
                      {item.status !== 'Resolved' && (
                        <button
                          onClick={() => handleStatusChange(item.id, 'Resolved')}
                          disabled={!!updating}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-all disabled:opacity-50"
                        >
                          <CheckCircle2 size={10} /> Mark Resolved
                        </button>
                      )}
                      {item.status !== 'Open' && (
                        <button
                          onClick={() => handleStatusChange(item.id, 'Open')}
                          disabled={!!updating}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10 transition-all disabled:opacity-50"
                        >
                          <X size={10} /> Reopen
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(item)}
                          disabled={deleting === item.id}
                          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all disabled:opacity-50"
                        >
                          {deleting === item.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
};

export default AdminFeedback;
