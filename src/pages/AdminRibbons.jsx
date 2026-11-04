// src/pages/AdminRibbons.jsx
//
// Ribbon Awards — Battalion S4 view for tracking and issuing earned ribbons.
//
// Awards are generated automatically when a Cadet Challenge cycle is locked.
// S4 Logistics (70+) sees all companies; Company S4 Assistant (35) sees only their company.
// S4 can mark awards as issued once they've been physically distributed.
//
// Ribbon tiers:
//   Athletic Ribbon   (N-2-3) — 85th percentile
//   Phys Fit Ribbon   (N-2-2) — 50th percentile

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, COMMAND_LEVEL, STAFF_LEVEL } from '../constants';
import {
  Award, CheckCircle2, Clock, Loader2, Filter,
  ChevronDown, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AdminPageHeader from '../components/AdminPageHeader';

// ── Constants ──────────────────────────────────────────────────────────────────

// Roles that can mark awards as issued (Battalion S4 and above only)
const CAN_ISSUE_ROLES = ['s4_logistics'];
const CAN_ISSUE_LEVEL = STAFF_LEVEL; // 70+

const RIBBON_META = {
  athletic: {
    label: 'JROTC Athletic Ribbon',
    code:  'N-2-3',
    pct:   '85th Percentile',
    cls:   'bg-amber-400/15 text-amber-700 dark:text-amber-400 border border-amber-400/30',
    dot:   'bg-amber-500',
    star:  '★',
  },
  physical_fitness: {
    label: 'JROTC Physical Fitness Ribbon',
    code:  'N-2-2',
    pct:   '50th Percentile',
    cls:   'bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-white/10',
    dot:   'bg-slate-400',
    star:  '◆',
  },
};

// ── Main component ──────────────────────────────────────────────────────────────

const AdminRibbons = () => {
  const { userData, role, loading: authLoading } = useAuth();

  const userLevel   = ROLE_HIERARCHY[role] || 0;
  // Battalion S4+ sees all companies and can mark issued
  const isS4        = userLevel >= CAN_ISSUE_LEVEL;
  // Anyone with at least company-level access (35+) sees their own company
  const canViewOwn  = userLevel >= 35 && !isS4;
  const myCompany   = userData?.company || '';

  // ── UI State ─────────────────────────────────────────────────────────────────
  const [awards,       setAwards]       = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending');   // 'pending' | 'issued' | 'all'
  const [filterCompany,setFilterCompany]= useState('');
  const [filterRibbon, setFilterRibbon] = useState('');          // '' | 'athletic' | 'physical_fitness'
  const [issuing,      setIssuing]      = useState(null);        // awardId being issued
  const [toast,        setToast]        = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // ── Data ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    setLoading(true);

    let q;
    if (isS4) {
      // Battalion S4 (70+) sees all awards
      q = query(collection(db, 'ribbonAwards'));
    } else if (canViewOwn && myCompany) {
      // Company leadership / assistants (35–69) see only their own company
      q = query(collection(db, 'ribbonAwards'), where('company', '==', myCompany));
    } else {
      setAwards([]);
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(q, snap => {
      setAwards(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));

    return () => unsub();
  }, [authLoading, isS4, canViewOwn, myCompany]);

  // ── Filtered + grouped awards ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return awards.filter(a => {
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (filterCompany && a.company !== filterCompany) return false;
      if (filterRibbon  && a.ribbon  !== filterRibbon)  return false;
      return true;
    });
  }, [awards, filterStatus, filterCompany, filterRibbon]);

  // Group by company then cycle
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(a => {
      const key = a.company || '—';
      if (!map[key]) map[key] = {};
      const cKey = `Cycle #${a.cycleNumber || '?'}`;
      if (!map[key][cKey]) map[key][cKey] = [];
      map[key][cKey].push(a);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Company options for filter
  const companyOptions = useMemo(() => {
    const s = new Set(awards.map(a => a.company).filter(Boolean));
    return [...s].sort();
  }, [awards]);

  // ── Mark Issued ───────────────────────────────────────────────────────────────
  const handleIssue = async (award) => {
    if (!isS4) return;
    setIssuing(award.id);
    try {
      await updateDoc(doc(db, 'ribbonAwards', award.id), {
        status:     'issued',
        issuedBy:   userData?.fullName || '',
        issuedByUid: null, // populated server-side if needed
        issuedAt:   serverTimestamp(),
      });
      showToast(`${award.cadetName} · ribbon marked as issued`);
    } catch {
      showToast('Update failed — try again');
    } finally {
      setIssuing(null);
    }
  };

  // ── Access gate ───────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-yellow-500" size={40} />
      </div>
    );
  }

  if (!isS4 && !canViewOwn) {
    return (
      <div className="flex-1 p-6 md:p-10 w-full">
        <AdminPageHeader icon={Award} title="Ribbon Awards" />
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <AlertTriangle className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Access Restricted</p>
          <p className="text-xs text-slate-400 mt-2">This page is for company leadership and above.</p>
        </div>
      </div>
    );
  }

  const pendingCount = awards.filter(a => a.status === 'pending').length;
  const issuedCount  = awards.filter(a => a.status === 'issued').length;

  return (
    <div className="flex-1 p-6 md:p-10 w-full">
      <AdminPageHeader icon={Award} title="Ribbon Awards" />

      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 mb-1">Pending Issuance</p>
          <p className="text-3xl font-black text-amber-700 dark:text-amber-400">{pendingCount}</p>
        </div>
        <div className="rounded-2xl border border-green-200 dark:border-green-500/20 bg-green-50/50 dark:bg-green-500/5 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-green-600 dark:text-green-400 mb-1">Issued</p>
          <p className="text-3xl font-black text-green-700 dark:text-green-400">{issuedCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-white/5 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Total</p>
          <p className="text-3xl font-black text-slate-700 dark:text-slate-200">{awards.length}</p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status filter */}
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2">
          <Filter size={13} className="text-slate-400" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2"
          >
            <option value="pending">Pending</option>
            <option value="issued">Issued</option>
            <option value="all">All Statuses</option>
          </select>
        </div>

        {/* Ribbon type filter */}
        <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2">
          <Award size={13} className="text-slate-400" />
          <select
            value={filterRibbon}
            onChange={e => setFilterRibbon(e.target.value)}
            className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2"
          >
            <option value="">All Ribbons</option>
            <option value="athletic">Athletic (N-2-3)</option>
            <option value="physical_fitness">Phys Fit (N-2-2)</option>
          </select>
        </div>

        {/* Company filter — only shown for battalion-level users */}
        {isS4 && companyOptions.length > 1 && (
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2">
            <ChevronDown size={13} className="text-slate-400" />
            <select
              value={filterCompany}
              onChange={e => setFilterCompany(e.target.value)}
              className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2"
            >
              <option value="">All Companies</option>
              {companyOptions.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-yellow-500" size={32} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <Award className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">
            {awards.length === 0 ? 'No ribbon awards yet' : 'No awards match filters'}
          </p>
          <p className="text-xs text-slate-400 mt-2 max-w-xs mx-auto">
            {awards.length === 0
              ? 'Awards are generated automatically when a Cadet Challenge cycle is locked.'
              : 'Try adjusting the filters above.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([company, cycles]) => (
            <div key={company} className="rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden">
              {/* Company header */}
              <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5">
                <p className="font-black uppercase tracking-widest text-xs text-slate-700 dark:text-slate-200">
                  {company} Company
                </p>
              </div>

              {Object.entries(cycles).sort().map(([cycleLabel, cycleAwards]) => (
                <div key={cycleLabel}>
                  {/* Cycle sub-header */}
                  <div className="px-4 py-2 bg-yellow-50/50 dark:bg-yellow-500/5 border-b border-yellow-200/50 dark:border-yellow-500/10">
                    <p className="text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500">
                      {cycleLabel}
                    </p>
                  </div>

                  {/* Awards list */}
                  <ul className="divide-y divide-slate-100 dark:divide-white/5">
                    {cycleAwards.map(award => {
                      const meta = RIBBON_META[award.ribbon] || RIBBON_META.physical_fitness;
                      return (
                        <li key={award.id} className="flex items-center gap-4 px-4 py-3">
                          {/* Ribbon badge */}
                          <span className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0 ${meta.cls}`}>
                            {meta.star} {meta.code}
                          </span>

                          {/* Name + ribbon */}
                          <div className="flex-1 min-w-0">
                            <p className="font-black text-slate-900 dark:text-white text-sm truncate">{award.cadetName}</p>
                            <p className="text-[10px] text-slate-400 truncate">{meta.label} · {meta.pct}</p>
                          </div>

                          {/* Status / action */}
                          {award.status === 'issued' ? (
                            <div className="text-right shrink-0">
                              <p className="text-[9px] font-black uppercase tracking-wider text-green-600 dark:text-green-400 flex items-center gap-1 justify-end">
                                <CheckCircle2 size={10} /> Issued
                              </p>
                              {award.issuedBy && (
                                <p className="text-[9px] text-slate-400">by {award.issuedBy}</p>
                              )}
                            </div>
                          ) : isS4 ? (
                            <button
                              onClick={() => handleIssue(award)}
                              disabled={issuing === award.id}
                              className="shrink-0 flex items-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white font-black text-[9px] uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all"
                            >
                              {issuing === award.id
                                ? <Loader2 size={10} className="animate-spin" />
                                : <CheckCircle2 size={10} />}
                              Mark Issued
                            </button>
                          ) : (
                            <span className="text-[9px] font-black uppercase text-amber-600 dark:text-amber-400 flex items-center gap-1 shrink-0">
                              <Clock size={10} /> Pending
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-2xl shadow-xl z-50"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminRibbons;
