// src/pages/CadetPortal.jsx
//
// Personal cadet record dashboard — accessible to any approved authenticated user.
// Cadets (level < 45) land here automatically; command-level users can visit directly.

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { db } from '../firebase';
import {
  collection, query, where, orderBy, limit, onSnapshot,
  doc, getDoc, getDocs,
} from 'firebase/firestore';
import {
  Award, Dumbbell, Calendar, Megaphone, UserCircle,
  ChevronRight, Shield, Star, Flag,
} from 'lucide-react';
import { ROLE_LABELS } from '../constants';
import { getInitials } from '../utils/getInitials';
import { usePageMeta } from '../hooks/usePageMeta';

const _slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_');

const FLAG_REQUIREMENTS_BY_POSITION = {
  'Squad Member': 30, 'Squad Leader Assistant': 35, 'Squad Leader': 35,
  'Company S1 Assistant': 40, 'Company S2 Assistant': 40, 'Company S3 Assistant': 40,
  'Company S4 Assistant': 40, 'Company S5 Assistant': 40, 'Company S6 Assistant': 40,
  'Company S7 Assistant': 40, 'Platoon Sergeant': 45, 'Platoon Leader': 50,
  'First Sergeant': 60, 'Master Sergeant': 60, 'Company XO': 60, 'Company Commander': 60,
  'Battalion Staff (S-1)': 80, 'Battalion Staff (S-2)': 80, 'Battalion Staff (S-3)': 80,
  'Battalion Staff (S-4)': 80, 'Battalion Staff (S-5)': 80, 'Battalion Staff (S-6)': 80,
  'Battalion Staff (S-7)': 80, 'Sergeant Major': 80, 'Battalion XO': 80,
  'Battalion Deputy Commander': 80, 'Battalion CSM': 80, 'Battalion Commander': 80,
};
const toFlags = amount => Math.floor((amount || 0) / 2);

const CadetPortal = () => {
  const { user, userData, role, loading } = useAuth();

  const [rosterDoc,     setRosterDoc]     = useState(null);
  const [rosterLoaded,  setRosterLoaded]  = useState(false);
  const [ribbons,       setRibbons]       = useState([]);
  const [ptRecords,     setPtRecords]     = useState([]);
  const [events,        setEvents]        = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [leadership,    setLeadership]    = useState({ bc: '', xo: '', csm: '' });

  // Company chain (CC → PL → SL) for squad-level cadets
  const [chainCC, setChainCC] = useState(null);
  const [chainPL, setChainPL] = useState(null);
  const [chainSL, setChainSL] = useState(null);

  // Promotion board scores
  const [boardScores, setBoardScores] = useState([]);
  const [boardsMap,   setBoardsMap]   = useState({});


  // Fundraiser entries
  const [fundraiserEntries, setFundraiserEntries] = useState([]);

  // Service hours
  const [serviceHours, setServiceHours] = useState([]);

  usePageMeta({
    title: 'My Record',
    description: 'Personal cadet record — ribbons, PT, chain of command.',
    path: '/admin/my',
  });

  // ── Roster doc via linkedUid ──────────────────────────────────────────────
  useEffect(() => {
    if (loading || !user) return;
    const q = query(collection(db, 'roster'), where('linkedUid', '==', user.uid));
    const unsub = onSnapshot(q, snap => {
      if (!snap.empty) {
        setRosterDoc({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        setRosterDoc(null);
      }
      setRosterLoaded(true);
    }, () => setRosterLoaded(true));
    return () => unsub();
  }, [loading, user]);

  // ── Ribbons + PT ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDoc) return;

    const ribbonQ = query(
      collection(db, 'ribbonAwards'),
      where('rosterDocId', '==', rosterDoc.id),
      orderBy('awardedAt', 'desc'),
    );
    const unsubRibbons = onSnapshot(ribbonQ, snap => {
      setRibbons(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setRibbons([]));

    // Query all challenge records and filter client-side by cadetId OR
    // case-insensitive name. No company filter — records may be stored under a
    // different company if the cadet's roster role changed (e.g. squad member
    // vs battalion staff entry for the same person).
    const norm = (s) => (s || '').trim().toLowerCase();
    const myName = norm(rosterDoc.fullName);
    getDocs(collection(db, 'cadetChallengeRecords')).then(snap => {
      const recs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r => r.cadetId === rosterDoc.id || norm(r.cadetName) === myName)
        .sort((a, b) => (b.cycleNumber || 0) - (a.cycleNumber || 0));
      setPtRecords(recs);
    }).catch(() => setPtRecords([]));

    return () => { unsubRibbons(); };
  }, [rosterDoc?.id, rosterDoc?.fullName]);

  // ── Promotion board scores ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'promotionScores'), where('linkedUid', '==', user.uid));
    const unsub = onSnapshot(q, snap => {
      setBoardScores(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setBoardScores([]));
    return () => unsub();
  }, [user]);

  // ── Boards map (id → title+date) ─────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getDocs(collection(db, 'promotionBoards')).then(snap => {
      const m = {};
      snap.docs.forEach(d => { m[d.id] = d.data(); });
      setBoardsMap(m);
    }).catch(() => {});
  }, [user]);

  // ── Company chain: CC → PL → SL ──────────────────────────────────────────
  // Falls back to userData when no roster doc is linked so the chain always loads
  useEffect(() => {
    const co  = rosterDoc?.company  || userData?.company  || '';
    const plt = rosterDoc?.platoon  || userData?.platoon  || '';
    const sq  = rosterDoc?.squad    || userData?.squad    || '';
    if (!co) return;

    const ccId = `commander_${_slug(co)}`;
    const plId = plt ? `pl_${_slug(co)}_${_slug(plt)}` : null;
    const slId = (plt && sq) ? `sl_${_slug(co)}_${_slug(plt)}_${_slug(sq)}` : null;

    getDoc(doc(db, 'leadership', ccId))
      .then(d => setChainCC(d.exists() ? { id: d.id, ...d.data() } : null))
      .catch(() => setChainCC(null));

    if (plId) {
      getDoc(doc(db, 'leadership', plId))
        .then(d => setChainPL(d.exists() ? { id: d.id, ...d.data() } : null))
        .catch(() => setChainPL(null));
    }
    if (slId) {
      getDoc(doc(db, 'leadership', slId))
        .then(d => setChainSL(d.exists() ? { id: d.id, ...d.data() } : null))
        .catch(() => setChainSL(null));
    }
  }, [rosterDoc?.id, rosterDoc?.company, rosterDoc?.platoon, rosterDoc?.squad,
      userData?.company, userData?.platoon, userData?.squad]);

  // ── Events, announcements, battalion leadership ───────────────────────────
  useEffect(() => {
    if (loading || !user) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const eventsQ = query(
      collection(db, 'events'),
      where('date', '>=', todayStr),
      orderBy('date', 'asc'),
      limit(3),
    );
    const unsubEvents = onSnapshot(eventsQ, snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    const annQ = query(
      collection(db, 'announcements'),
      orderBy('timestamp', 'desc'),
      limit(3),
    );
    const unsubAnn = onSnapshot(annQ, snap => {
      setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    const unsubLeadership = onSnapshot(collection(db, 'leadership'), snap => {
      const temp = { bc: '', xo: '', csm: '' };
      snap.docs.forEach(docSnap => {
        const meta = docSnap.data();
        if (!meta.role || !meta.name) return;
        const cleanRole = meta.role.toLowerCase().replace(/[\s\-_]/g, '');
        const isBn = !meta.company || meta.company.trim() === '' || meta.company.trim().toLowerCase() === 'none';
        if (cleanRole === 'battalioncommander') temp.bc = meta.name;
        if ((cleanRole === 'executiveofficer' || cleanRole === 'battalionxo') && isBn) temp.xo = meta.name;
        if (cleanRole === 'commandsergeantmajor') temp.csm = meta.name;
      });
      setLeadership(temp);
    }, () => {});

    return () => { unsubEvents(); unsubAnn(); unsubLeadership(); };
  }, [loading, user]);


  // ── Fundraiser entries (own only via linkedUid) ───────────────────────────
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'fundraiserEntries'), where('linkedUid', '==', user.uid));
    const unsub = onSnapshot(q, snap => {
      setFundraiserEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setFundraiserEntries([]));
    return () => unsub();
  }, [user]);

  // ── Service hours (own only via linkedUid) ────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'serviceHours'),
      where('linkedUid', '==', user.uid),
      orderBy('submittedAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      setServiceHours(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setServiceHours([]));
    return () => unsub();
  }, [user]);

  if (loading || !rosterLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-yellow-500" />
      </div>
    );
  }

  // Surface display values — prefer roster doc, fall back to users doc
  const displayName = rosterDoc?.fullName || userData?.fullName || 'Cadet';
  const rank        = rosterDoc?.rank     || userData?.rank     || '';
  const company     = rosterDoc?.company  || userData?.company  || '';
  const position    = rosterDoc?.position || userData?.position || '';
  const letLevel    = rosterDoc?.letLevel || '';
  const platoon     = rosterDoc?.platoon  || '';
  const squad       = rosterDoc?.squad    || '';
  const portrait    = userData?.portrait  || null;
  const latestPt    = ptRecords[0] || null;

  // Fundraiser totals
  const totalRaised   = fundraiserEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const totalFlags    = fundraiserEntries.reduce((s, e) => s + (e.flags ?? toFlags(e.amount)), 0);
  const flagRequired  = FLAG_REQUIREMENTS_BY_POSITION[position] || 30;
  const flagPct       = Math.min(100, Math.round((totalFlags / flagRequired) * 100));

  // Always show company chain section whenever the cadet has a company assigned
  // (use rosterDoc or userData fallback, same as the chain effect)
  const chainCompany = rosterDoc?.company || userData?.company || '';
  const showCompanyChain = !!chainCompany;

  return (
    <div className="flex-1 text-slate-900 dark:text-slate-100">
      <main className="p-6 md:p-10">

        {/* ── Profile header ───────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 mb-8 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-6 items-start">

            {/* Portrait */}
            <div className="w-20 h-20 rounded-2xl bg-yellow-500 text-slate-950 flex items-center justify-center text-2xl font-black uppercase shrink-0 overflow-hidden shadow-lg shadow-yellow-500/20">
              {portrait ? (
                <img src={portrait} alt="" className="w-full h-full object-cover" />
              ) : (
                getInitials(displayName) || <UserCircle size={36} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  {letLevel && (
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest">
                        {letLevel}
                      </span>
                    </div>
                  )}
                  <h1 className="text-3xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white leading-none">
                    {rank && <span className="text-yellow-500">{rank} </span>}{displayName}
                  </h1>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest mt-1.5">
                    {[position, company && `${company} Co.`, platoon && `${platoon} PLT`].filter(Boolean).join(' · ')}
                  </p>
                </div>

                <Link
                  to="/admin/profile"
                  className="text-[10px] font-black uppercase tracking-widest text-yellow-500 hover:text-yellow-400 border border-yellow-500/30 hover:border-yellow-500/60 px-4 py-2 rounded-xl transition-all shrink-0"
                >
                  Edit Profile
                </Link>
              </div>

              {/* Quick stats */}
              <div className="flex gap-8 mt-5 flex-wrap">
                <div>
                  <p className="text-2xl font-black text-yellow-500 leading-none">{ribbons.length}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Ribbons</p>
                </div>
                {ptRecords.length > 0 && (
                  <div>
                    <p className="text-2xl font-black text-yellow-500 leading-none">Cycle {latestPt?.cycleNumber}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Latest PT</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Main grid ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left column */}
          <div className="lg:col-span-2 space-y-6">

            {/* Ribbon Rack */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-black uppercase italic flex items-center gap-3 text-slate-900 dark:text-white">
                  <Award className="text-yellow-500" size={18} />
                  Ribbon Rack
                </h2>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {ribbons.length} {ribbons.length === 1 ? 'ribbon' : 'ribbons'}
                </span>
              </div>

              {ribbons.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400 italic">
                  No ribbons on record yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {ribbons.map(r => {
                    const awardDate = r.awardedAt?.toDate?.();
                    const dateStr = awardDate
                      ? awardDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '';
                    return (
                      <div key={r.id} className="bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-white/5 rounded-2xl p-4">
                        <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center mb-2">
                          <Award size={15} className="text-yellow-500" />
                        </div>
                        <p className="text-xs font-black text-slate-800 dark:text-slate-200 leading-snug mb-1">{r.ribbonName}</p>
                        {r.awardedByName && (
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">by {r.awardedByName}</p>
                        )}
                        {dateStr && (
                          <p className="text-[10px] text-slate-400 mt-0.5">{dateStr}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Fallen Heroes Fundraiser */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-black uppercase italic flex items-center gap-3 text-slate-900 dark:text-white">
                  <Flag className="text-yellow-500" size={18} />
                  Fallen Heroes Fundraiser
                </h2>
                <Link to="/admin/fundraiser" className="text-[10px] font-black uppercase tracking-widest text-yellow-500 hover:text-yellow-400 border border-yellow-500/30 hover:border-yellow-500/60 px-3 py-1.5 rounded-xl transition-all">
                  Details
                </Link>
              </div>

              {/* Progress bar */}
              <div className="mb-6">
                <div className="flex items-end justify-between mb-2">
                  <div>
                    <span className="text-3xl font-black text-yellow-500 leading-none">{totalFlags}</span>
                    <span className="text-sm font-black text-slate-400 ml-1">/ {flagRequired} flags</span>
                  </div>
                  <span className="text-sm font-black text-slate-500">{flagPct}%</span>
                </div>
                <div className="h-2.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${flagPct >= 100 ? 'bg-green-500' : 'bg-yellow-500'}`}
                    style={{ width: `${flagPct}%` }}
                  />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-2">
                  ${totalRaised.toFixed(2)} raised · {flagPct >= 100 ? 'Requirement met!' : `${flagRequired - totalFlags} flags to go`}
                </p>
              </div>

              {/* Payment history */}
              {fundraiserEntries.length === 0 ? (
                <div className="py-4 text-center text-sm text-slate-400 italic">
                  No payments logged yet — $2 = 1 flag.
                </div>
              ) : (
                <div className="space-y-2">
                  {fundraiserEntries
                    .slice()
                    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
                    .map(entry => {
                      const date = entry.createdAt?.toDate?.();
                      const dateStr = date
                        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '';
                      const typeColors = {
                        cash:   'bg-green-500/10 text-green-600 dark:text-green-400',
                        check:  'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                        estore: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
                      };
                      return (
                        <div key={entry.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl px-4 py-2.5 border border-slate-100 dark:border-white/5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${typeColors[entry.paymentType] || typeColors.cash}`}>
                              {entry.paymentType || 'cash'}
                            </span>
                            {dateStr && <span className="text-[10px] text-slate-400 font-bold">{dateStr}</span>}
                            {entry.orderNumber && (
                              <span className="text-[9px] text-slate-400 truncate">#{entry.orderNumber}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[10px] font-black text-slate-400">{entry.flags ?? toFlags(entry.amount)} flags</span>
                            <span className="text-sm font-black text-slate-800 dark:text-slate-200">${(entry.amount || 0).toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </section>

            {/* Service Hours */}
            {(() => {
              const approved = serviceHours.filter(h => h.status === 'approved').reduce((s,h) => s + (h.totalHours||0), 0);
              const flGradPct = Math.min(100, Math.round(approved/40*100));
              const bfPct = Math.min(100, Math.round(approved/100*100));
              const statusColors = { approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' };
              return (
                <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-base font-black uppercase italic flex items-center gap-3 text-slate-900 dark:text-white">
                      <Award className="text-yellow-500" size={18} />
                      Service Hours
                    </h2>
                    <Link to="/admin/service-hours" className="text-[10px] font-black uppercase tracking-widest text-yellow-500 hover:text-yellow-400 border border-yellow-500/30 hover:border-yellow-500/60 px-3 py-1.5 rounded-xl transition-all">
                      Log Hours
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {[{ label: 'FL Graduation (40h)', pct: flGradPct }, { label: 'Bright Futures (100h)', pct: bfPct }].map(g => (
                      <div key={g.label}>
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                          <span>{g.label}</span><span>{approved.toFixed(1)}h</span>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${g.pct>=100?'bg-emerald-500':'bg-yellow-500'}`} style={{width:`${g.pct}%`}} />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">{g.pct}% — {g.pct>=100?'Requirement met!':'Not yet met'}</p>
                      </div>
                    ))}
                  </div>
                  {serviceHours.length === 0 ? (
                    <p className="text-sm text-slate-400 italic text-center py-2">No hours submitted yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {serviceHours.slice(0,5).map(h => (
                        <div key={h.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl px-4 py-2.5 border border-slate-100 dark:border-white/5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${statusColors[h.status]||statusColors.pending}`}>{h.status}</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{h.activityName}</span>
                          </div>
                          <span className="text-sm font-black text-yellow-600 dark:text-yellow-400 shrink-0">{h.totalHours}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })()}

            {/* Promotion Board Scores */}
            {boardScores.length > 0 && (
              <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-base font-black uppercase italic flex items-center gap-3 text-slate-900 dark:text-white">
                    <Star className="text-yellow-500" size={18} />
                    Promotion Board Scores
                  </h2>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {boardScores.length} {boardScores.length === 1 ? 'board' : 'boards'}
                  </span>
                </div>
                <div className="space-y-4">
                  {boardScores
                    .slice()
                    .sort((a, b) => {
                      const aDate = boardsMap[a.boardId]?.boardDate?.toDate?.() || new Date(0);
                      const bDate = boardsMap[b.boardId]?.boardDate?.toDate?.() || new Date(0);
                      return bDate - aDate;
                    })
                    .map(score => {
                      const board = boardsMap[score.boardId] || {};
                      const boardDate = board.boardDate?.toDate?.();
                      const dateStr = boardDate
                        ? boardDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '';
                      const totalPossible = board.totalPossible || 1100;
                      const pct = score.totalScore != null ? Math.round((score.totalScore / totalPossible) * 100) : null;
                      return (
                        <div key={score.id} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-white/5 rounded-2xl p-5">
                          <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
                            <div>
                              <p className="text-sm font-black text-slate-800 dark:text-slate-200 leading-tight">
                                {board.title || 'Promotion Board'}
                              </p>
                              {dateStr && (
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">{dateStr}</p>
                              )}
                            </div>
                            {score.totalScore != null && (
                              <div className="text-right shrink-0">
                                <p className="text-xl font-black text-yellow-500 leading-none">{score.totalScore}</p>
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">
                                  / {totalPossible}{pct != null ? ` · ${pct}%` : ''}
                                </p>
                              </div>
                            )}
                          </div>
                          {score.scores && Object.keys(score.scores).length > 0 && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {Object.entries(score.scores).map(([catId, val]) => {
                                const cat = (board.categories || []).find(c => c.id === catId);
                                const label = cat?.label || catId;
                                return (
                                  <div key={catId} className="flex items-center justify-between gap-2 bg-white dark:bg-slate-900 rounded-xl px-3 py-2 border border-slate-100 dark:border-white/5">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">{label}</span>
                                    <span className={`text-xs font-black shrink-0 ${val === 100 ? 'text-green-500' : val === 0 ? 'text-red-400' : 'text-yellow-500'}`}>
                                      {val != null ? val : '—'}
                                    </span>
                                  </div>
                                );
                              })}
                              {score.extraCredit > 0 && (
                                <div className="flex items-center justify-between gap-2 bg-yellow-500/5 rounded-xl px-3 py-2 border border-yellow-500/20">
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-yellow-500/70 truncate">Extra Credit</span>
                                  <span className="text-xs font-black text-yellow-500 shrink-0">+{score.extraCredit}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {score.notes && (
                            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 italic border-t border-slate-100 dark:border-white/5 pt-3">
                              {score.notes}
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* Physical Training */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-black uppercase italic flex items-center gap-3 text-slate-900 dark:text-white">
                  <Dumbbell className="text-yellow-500" size={18} />
                  Cadet Challenge Scores
                </h2>
              </div>

              {ptRecords.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400 italic">
                  No PT records on file yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {ptRecords.map(rec => (
                    <div key={rec.id} className={`rounded-2xl border p-5 ${rec.id === latestPt?.id ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-white/5'}`}>
                      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${rec.id === latestPt?.id ? 'bg-yellow-500 text-slate-950' : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'}`}>
                          Cycle {rec.cycleNumber}
                        </span>
                        {rec.medicalExempt && (
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Medical Exempt</span>
                        )}
                      </div>
                      {rec.medicalExempt ? (
                        <p className="text-sm text-slate-400 italic">Medical exemption on file for this cycle.</p>
                      ) : (
                        <div className="grid grid-cols-5 gap-2 text-center">
                          {[
                            { label: 'Push-Ups',    key: 'pushUps',    unit: '' },
                            { label: 'Sit-Ups',     key: 'sitUps',     unit: '' },
                            { label: 'Shuttle',     key: 'shuttleRun', unit: 's' },
                            { label: '1 Mile',      key: 'oneMile',    unit: '' },
                            { label: 'Sit-N-Reach', key: 'sitNReach',  unit: 'cm' },
                          ].map(({ label, key, unit }) => (
                            <div key={key}>
                              <p className="text-sm font-black text-slate-800 dark:text-slate-200 leading-none">
                                {rec[key] !== undefined && rec[key] !== null && rec[key] !== ''
                                  ? `${rec[key]}${unit}`
                                  : '—'
                                }
                              </p>
                              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-1.5">{label}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-6">

            {/* Chain of Command */}
            <div className="bg-gradient-to-br from-yellow-500 to-yellow-400 rounded-3xl p-6 text-slate-950 shadow-lg shadow-yellow-500/20">
              <h3 className="font-black uppercase italic text-base mb-1 tracking-tighter flex items-center gap-2">
                <Shield size={16} className="shrink-0" />
                Chain of Command
              </h3>
              <p className="text-[10px] font-black opacity-70 mb-5 uppercase tracking-[0.2em]">Battalion → Company Chain</p>
              <div className="space-y-2.5">
                {/* Battalion level */}
                {[
                  { label: 'BC',  value: leadership.bc  },
                  { label: 'XO',  value: leadership.xo  },
                  { label: 'CSM', value: leadership.csm },
                ].map(({ label, value }) => value ? (
                  <div key={label} className="bg-white/20 backdrop-blur-md p-3 rounded-xl border border-white/20 flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-wider w-8 shrink-0 opacity-70">{label}</span>
                    <span className="text-xs font-black truncate">{value}</span>
                  </div>
                ) : null)}

                {/* Company chain — always shown when cadet has a company */}
                {showCompanyChain && (
                  <>
                    <div className="border-t border-white/20 my-1" />
                    {[
                      { label: 'CC', data: chainCC },
                      { label: 'PL', data: chainPL },
                      { label: 'SL', data: chainSL },
                    ].map(({ label, data }) => (
                      <div key={label} className={`p-3 rounded-xl border flex items-center gap-3 ${data ? 'bg-white/20 backdrop-blur-md border-white/20' : 'bg-white/5 border-white/10'}`}>
                        <span className="text-[10px] font-black uppercase tracking-wider w-8 shrink-0 opacity-70">{label}</span>
                        <span className={`text-xs font-black truncate ${data ? '' : 'opacity-40 italic'}`}>
                          {data ? data.name : 'Not assigned'}
                        </span>
                      </div>
                    ))}
                  </>
                )}

                {!leadership.bc && !leadership.xo && !leadership.csm && !showCompanyChain && (
                  <p className="text-xs opacity-60 italic">Leadership not yet configured.</p>
                )}
              </div>
              <Link
                to="/leadership"
                className="mt-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest bg-slate-950/10 hover:bg-slate-950/20 rounded-xl py-2.5 transition-all"
              >
                View All Leadership <ChevronRight size={12} />
              </Link>
            </div>

            {/* Upcoming Events */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                  <Calendar size={13} /> Upcoming Events
                </h3>
                <Link to="/events" className="text-yellow-500 p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-all">
                  <ChevronRight size={16} />
                </Link>
              </div>
              <div className="space-y-5 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200 dark:before:bg-white/5">
                {events.length > 0 ? events.map(event => (
                  <div key={event.id} className="relative pl-6 group">
                    <div className="absolute left-0 top-1.5 w-3.5 h-3.5 bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-white/10 rounded-full group-hover:border-yellow-500 group-hover:bg-yellow-500 transition-all" />
                    <p className="text-[10px] font-black text-yellow-500/70 uppercase mb-1 tracking-tighter">{event.date}</p>
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">{event.title}</h4>
                    {event.location && (
                      <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{event.location}</p>
                    )}
                  </div>
                )) : (
                  <p className="text-xs text-slate-400 italic text-center py-3">No upcoming events.</p>
                )}
              </div>
            </section>

            {/* Announcements */}
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                  <Megaphone size={13} /> Announcements
                </h3>
                <Link to="/announcements" className="text-yellow-500 p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-all">
                  <ChevronRight size={16} />
                </Link>
              </div>
              {announcements.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-3">No recent announcements.</p>
              ) : (
                <div className="space-y-3">
                  {announcements.map(a => {
                    const ts = a.timestamp?.toDate?.();
                    const dateStr = ts
                      ? ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '';
                    const text = a.content || a.body || a.message || a.text || '';
                    return (
                      <div key={a.id} className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-white/5">
                        {(a.title || dateStr) && (
                          <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest mb-1">
                            {a.title || dateStr}
                          </p>
                        )}
                        {text && (
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">{text}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>


      </main>
    </div>
  );
};

export default CadetPortal;
