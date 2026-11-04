// src/pages/AdminLeaderboard.jsx
//
// Battalion Fitness Leaderboard — public to all authenticated cadets.
// Shows the top male and female contender per event for each company,
// using each cadet's personal best across all recorded cycles.

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { usePageMeta } from '../hooks/usePageMeta';
import { useAuth } from '../hooks/useAuth';
import { useLocation } from 'react-router-dom';
import { Loader2, BarChart3, Medal } from 'lucide-react';
import { normalizeCompany } from '../utils/normalizeCompany';
import { ROLE_HIERARCHY } from '../constants';

// ── Constants ──────────────────────────────────────────────────────────────────

const EVENTS = [
  { key: 'pushUps',    label: 'Push-Ups',     unit: 'reps', asc: false },
  { key: 'sitUps',     label: 'Sit-Ups',      unit: 'reps', asc: false },
  { key: 'shuttleRun', label: 'Shuttle Run',  unit: 's',    asc: true  },
  { key: 'oneMile',    label: 'One-Mile Run', unit: '',      asc: true  },
  { key: 'sitNReach',  label: 'Sit-N-Reach',  unit: 'cm',   asc: false },
];

// Rank badge styles for positions 1–3
const RANK_BADGE = [
  'bg-yellow-400 text-slate-900',
  'bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200',
  'bg-amber-700/60 text-amber-100',
];

function parseTimeToSecs(str) {
  if (!str) return Infinity;
  const parts = String(str).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function numVal(v, evtKey) {
  if (v === null || v === undefined || v === '') return null;
  if (evtKey === 'oneMile') return parseTimeToSecs(String(v));
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fmtScore(v, evt) {
  if (v === null || v === undefined || v === '') return '—';
  return `${v}${evt.unit ? ' ' + evt.unit : ''}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

const AdminLeaderboard = () => {
  usePageMeta({ title: 'Battalion Leaderboard', path: '/admin/leaderboard' });

  const { user, role, loading: authLoading } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const { pathname } = useLocation();
  // Public route (/leaderboard) never touches Firestore — avoids permission-denied
  // errors regardless of the viewer's auth state or role level. Admin route
  // (/admin/leaderboard) uses live Firestore for L70+ who can read all collections.
  const useFirestore = pathname.startsWith('/admin') && userLevel >= 70;

  const [records,    setRecords]    = useState([]);
  const [rosterMap,  setRosterMap]  = useState({});
  const [recLoading, setRecLoading] = useState(true);
  const [fundraiserEntries, setFundraiserEntries] = useState([]);

  useEffect(() => {
    if (authLoading) return;

    if (!useFirestore) {
      fetch('/api/leaderboard.json')
        .then(r => r.json())
        .then(data => {
          setRecords(data.records || []);
          setRosterMap(data.roster || {});
          setFundraiserEntries(data.fundraiserEntries || []);
          setRecLoading(false);
        })
        .catch(() => setRecLoading(false));
      return;
    }

    const unsubRec = onSnapshot(collection(db, 'cadetChallengeRecords'), snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setRecLoading(false);
    }, () => setRecLoading(false));

    const unsubRoster = onSnapshot(collection(db, 'roster'), snap => {
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      setRosterMap(map);
    }, () => {});

    return () => { unsubRec(); unsubRoster(); };
  }, [authLoading, useFirestore]);

  // Live fundraiser subscription — admin route + L70+ only.
  useEffect(() => {
    if (authLoading || !useFirestore) return;
    const unsub = onSnapshot(collection(db, 'fundraiserEntries'), snap => {
      setFundraiserEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
    return () => unsub();
  }, [authLoading, useFirestore]);

  // Compute personal-best per cadet per event across all cycles
  const { companies, leaderboard } = useMemo(() => {
    const bestMap = {};
    records.forEach(rec => {
      if (rec.medicalExempt) return;
      const cid = rec.cadetId || rec.cadetName;
      if (!cid) return;
      if (!bestMap[cid]) {
        const roster = rosterMap[rec.cadetId] || {};
        bestMap[cid] = {
          name:    rec.cadetName,
          cadetId: rec.cadetId,
          company: rec.company || roster.company || '',
          gender:  roster.gender || '',
          best:    {},
        };
      }
      const entry = bestMap[cid];
      const roster = rosterMap[rec.cadetId] || {};
      if (roster.gender)  entry.gender  = roster.gender;
      if (roster.company) entry.company = roster.company;

      EVENTS.forEach(evt => {
        const v = rec[evt.key];
        if (v === null || v === undefined || v === '') return;
        const n = numVal(v, evt.key);
        if (n === null) return;
        const prev = entry.best[evt.key];
        if (prev === undefined) {
          entry.best[evt.key] = { raw: v, num: n };
        } else {
          const better = evt.asc ? n < prev.num : n > prev.num;
          if (better) entry.best[evt.key] = { raw: v, num: n };
        }
      });
    });

    const allEntries = Object.values(bestMap).filter(e => e.company);
    const companyList = [...new Set(allEntries.map(e => e.company))].sort();

    const lb = EVENTS.map(evt => {
      const withScore = allEntries
        .filter(e => e.best[evt.key] !== undefined)
        .map(e => ({ ...e, _val: e.best[evt.key].num, _raw: e.best[evt.key].raw }))
        .sort((a, b) => evt.asc ? a._val - b._val : b._val - a._val);

      const byCompany = {};
      companyList.forEach(co => {
        const coEntries = withScore.filter(e => e.company === co);
        byCompany[co] = {
          male:   coEntries.filter(e => e.gender === 'Male').slice(0, 1),
          female: coEntries.filter(e => e.gender === 'Female').slice(0, 1),
        };
      });

      const topMale   = withScore.filter(e => e.gender === 'Male').slice(0, 1);
      const topFemale = withScore.filter(e => e.gender === 'Female').slice(0, 1);

      return { ...evt, byCompany, topMale, topFemale };
    });

    return { companies: companyList, leaderboard: lb };
  }, [records, rosterMap]);

  // Top raised per company + overall battalion top 3
  const topDonors = useMemo(() => {
    if (fundraiserEntries.length === 0) return null;
    const src = fundraiserEntries.filter(e => !e.voided);
    const byIdAll = {};
    src.forEach(e => {
      const key = e.cadetId && e.cadetId !== 'manual' ? e.cadetId : `manual_${e.cadetName}`;
      if (!byIdAll[key]) byIdAll[key] = { name: e.cadetName, company: e.company, total: 0 };
      byIdAll[key].total += e.amount || 0;
    });
    const all = Object.values(byIdAll).filter(d => d.total > 0).sort((a, b) => b.total - a.total);
    const byCompany = {};
    all.forEach(d => {
      if (!d.company) return;
      if (!byCompany[d.company]) byCompany[d.company] = [];
      if (byCompany[d.company].length < 3) byCompany[d.company].push(d);
    });
    return { byCompany, top5Overall: all.slice(0, 5), totalRaised: all.reduce((s, d) => s + d.total, 0) };
  }, [fundraiserEntries]);

  if (recLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="animate-spin text-yellow-500" size={36} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white pt-24 pb-20 px-6 font-sans">
      <div className="max-w-5xl mx-auto">
      {/* Page header */}
      <div className="mb-10">
        <h1 className="text-4xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white flex items-center gap-3">
          <BarChart3 size={32} className="text-yellow-500 flex-shrink-0" />
          Battalion Leaderboard
        </h1>
        <p className="mt-1.5 text-sm text-slate-400 dark:text-slate-500">
          Personal-best scores across all cycles · Top contenders per event by company
        </p>
      </div>

      {records.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <BarChart3 className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No records yet</p>
          <p className="text-slate-400 text-xs mt-2">Scores will appear here once they're entered in Cadet Challenge.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* ── Top Raised ── */}
          {topDonors && topDonors.top5Overall.length > 0 && (
            <div className="space-y-4">
              {/* Battalion Top 5 */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden max-w-lg">
                <div className="px-5 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Medal size={13} className="text-yellow-500" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Top Raised</span>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500">Total: ${topDonors.totalRaised.toFixed(2)}</span>
                </div>
                <div className="px-2 py-1">
                  <div className="px-2 py-2 mb-1">
                    <span className="text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500">Battalion Top 5</span>
                  </div>
                  {topDonors.top5Overall.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                      <span className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[9px] font-black shrink-0 ${RANK_BADGE[i] || 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>{i + 1}</span>
                      <span className="font-bold text-sm text-slate-800 dark:text-slate-200 flex-1">{d.name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{normalizeCompany(d.company)}</span>
                      <span className="font-black text-sm text-yellow-600 dark:text-yellow-500 tabular-nums">${d.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top 3 per company grid */}
              {Object.keys(topDonors.byCompany).length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
                    <Medal size={11} className="text-yellow-500" /> Top 3 by Company
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(topDonors.byCompany).sort(([a], [b]) => a.localeCompare(b)).map(([co, donors]) => (
                      <div key={co} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-50 dark:bg-white/3 border-b border-slate-100 dark:border-white/5">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-slate-400">{co} Company</p>
                        </div>
                        <div className="px-3 py-3 space-y-2">
                          {donors.map((d, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[8px] font-black shrink-0 ${RANK_BADGE[i] || 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>{i + 1}</span>
                              <span className="font-bold text-xs text-slate-800 dark:text-slate-200 flex-1 truncate">{d.name}</span>
                              <span className="font-black text-xs text-yellow-600 dark:text-yellow-500 tabular-nums shrink-0">${d.total.toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {leaderboard.map(evt => (
            <div key={evt.key}>
              {/* Event header */}
              <div className="mb-4">
                <h2 className="font-black uppercase tracking-widest text-sm text-slate-900 dark:text-white">
                  {evt.label}
                </h2>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                  {evt.asc ? 'Fastest wins' : 'Highest score'}{evt.unit ? ` · ${evt.unit}` : ''}
                </p>
              </div>

              {/* Company grid */}
              <div className={`grid gap-3 ${
                companies.length <= 2 ? 'grid-cols-1 sm:grid-cols-2' :
                companies.length <= 3 ? 'grid-cols-1 sm:grid-cols-3' :
                'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
              }`}>
                {companies.map(co => {
                  const data = evt.byCompany[co] || { male: [], female: [] };
                  return (
                    <div key={co} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 overflow-hidden">
                      {/* Company label */}
                      <div className="px-4 py-2.5 bg-slate-50 dark:bg-white/3 border-b border-slate-100 dark:border-white/5">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-slate-400">
                          {co} Company
                        </p>
                      </div>

                      {/* Male */}
                      <div className="px-4 pt-3 pb-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 dark:text-blue-400 mb-1.5">Male</p>
                        {data.male.length === 0 ? (
                          <p className="text-[10px] text-slate-400 italic mb-2">No data</p>
                        ) : (
                          <ol className="space-y-1 mb-2">
                            {data.male.map((e, i) => (
                              <li key={e.name + i} className="flex items-center gap-2 text-xs">
                                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 ${RANK_BADGE[i] || 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                                  {i + 1}
                                </span>
                                <span className="font-bold text-slate-800 dark:text-slate-200 flex-1 truncate">{e.name}</span>
                                <span className="font-black text-slate-600 dark:text-slate-300 shrink-0 tabular-nums text-[10px]">
                                  {fmtScore(e._raw, evt)}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>

                      <div className="mx-4 border-t border-slate-100 dark:border-white/5" />

                      {/* Female */}
                      <div className="px-4 pt-2 pb-3">
                        <p className="text-[9px] font-black uppercase tracking-widest text-rose-500 dark:text-rose-400 mb-1.5 mt-1">Female</p>
                        {data.female.length === 0 ? (
                          <p className="text-[10px] text-slate-400 italic">No data</p>
                        ) : (
                          <ol className="space-y-1">
                            {data.female.map((e, i) => (
                              <li key={e.name + i} className="flex items-center gap-2 text-xs">
                                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 ${RANK_BADGE[i] || 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                                  {i + 1}
                                </span>
                                <span className="font-bold text-slate-800 dark:text-slate-200 flex-1 truncate">{e.name}</span>
                                <span className="font-black text-slate-600 dark:text-slate-300 shrink-0 tabular-nums text-[10px]">
                                  {fmtScore(e._raw, evt)}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Battalion-wide top 3 */}
              <div className="mt-3 rounded-xl border border-yellow-200 dark:border-yellow-500/20 bg-yellow-50 dark:bg-yellow-500/5 px-5 py-3 flex flex-wrap gap-6">
                {[
                  { list: evt.topMale,   label: 'Battalion Best — Male'   },
                  { list: evt.topFemale, label: 'Battalion Best — Female' },
                ].map(col => (
                  <div key={col.label} className="flex-1 min-w-[180px]">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1.5">{col.label}</p>
                    {col.list.length === 0 ? (
                      <p className="text-[10px] text-slate-400 italic">No data</p>
                    ) : (
                      <ol className="flex flex-wrap gap-x-4 gap-y-1">
                        {col.list.map((e, i) => (
                          <li key={e.name + i} className="flex items-center gap-1.5 text-xs">
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black shrink-0 ${RANK_BADGE[i] || 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                              {i + 1}
                            </span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{e.name}</span>
                            <span className="text-slate-500 dark:text-slate-400 text-[10px]">({normalizeCompany(e.company)})</span>
                            <span className="font-black text-amber-700 dark:text-amber-400 text-[10px] tabular-nums">{fmtScore(e._raw, evt)}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
};

export default AdminLeaderboard;
