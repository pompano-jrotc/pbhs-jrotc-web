// src/pages/AdminRoster.jsx
//
// Battalion Roster — source of truth for every cadet regardless of whether
// they have a Command Portal account. Each entry can optionally be linked to
// a user UID (linkedUid) to show a portal-account indicator on the row.
//
// Access tiers:
//   canManageAll  — staff (70+): view/edit any company
//   canManageOwn  — command (45+): view/edit own company only
//
// Cadet Challenge scores are joined client-side by cadetName from the
// cadet_challenge collection (most-recent record per cadet).

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs,
  writeBatch, Timestamp, increment, deleteField, runTransaction,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { useCompanies } from '../hooks/useCompanies';
import { normalizeCompany } from '../utils/normalizeCompany';
import {
  ROLE_HIERARCHY, STAFF_LEVEL, COMMAND_LEVEL, ADMIN_LEVEL,
  JROTC_RANKS, JROTC_POSITIONS, BATTALION_POSITIONS, POSITION_RANKS, SECONDARY_POSITIONS,
  COMPANY_HQ_LOCKED_POSITIONS, COMPANY_HQ_DEFAULT_POSITIONS,
  rankExceedsMax, boardTargetRank,
} from '../constants';
import {
  Link2, UserCircle, Plus, Edit3, Trash2, X,
  Loader2, CheckCircle2, Search, ChevronDown, Eye, RefreshCw,
  History, GraduationCap, Trophy, Tent, BookOpen, ChevronRight, Filter,
  ShieldAlert, Clock, CheckCheck, XCircle, AlertTriangle, TrendingUp, Download, Hash, Printer,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import { printRoster } from '../utils/printRoster';
import { groupByLet } from '../utils/groupByLet';
import { exportCSV } from '../utils/exportCSV';

// Maps a secondary-position label to the team keyword used in /admin/teams?team=
function teamKeyFromPosition(pos) {
  if (!pos) return null;
  const p = pos.toLowerCase();
  if (p.includes('color guard')) return 'Color Guard';
  if (p.includes('drill'))       return 'Drill';
  if (p.includes('rifle'))       return 'Rifle';
  if (p.includes('raider'))      return 'Raider';
  return null;
}

// ── constants ─────────────────────────────────────────────────────────────────

const PLATOONS = ['1st Platoon', '2nd Platoon', '3rd Platoon', 'Company HQ'];
const SQUADS   = ['1st Squad', '2nd Squad', '3rd Squad', '4th Squad'];
const LET_LEVELS = ['LET 1', 'LET 2', 'LET 3', 'LET 4'];
const GENDERS  = ['Male', 'Female', 'Other'];

// Roles exempt from the roster self-edit restriction — keep in sync with firestore.rules isSelfEditExempt()
const SELF_EDIT_EXEMPT_ROLES = [
  'battalion_commander', 'battalion_xo', 'battalion_csm',
  'senior_army_instructor', 'army_instructor', 's1_adjutant',
];

// Authority fields that non-exempt accounts cannot change on their own entry.
const AUTHORITY_FIELDS = ['position', 'rank', 'letLevel', 'company', 'linkedUid'];

// Fields captured in the rosterChangelog snapshot (excludes timestamps).
const CHANGELOG_FIELDS = [
  'fullName', 'rank', 'position', 'secondaryPosition', 'company', 'platoon', 'squad',
  'gender', 'letLevel', 'linkedUid', 'secondaryCompany', 'notes',
];

// 'Zulu' kept for backward compat — old Firestore records still carry it.
// All new records use 'Battalion'. Both are treated as HQ throughout.
const BATTALION_COMPANIES = ['Battalion', 'Zulu'];

// Positions that auto-sync to the publicly-readable `leadership` Firestore
// collection whenever a roster entry is saved. This keeps the public
// Leadership page populated from the roster without manual Publishing Hub entries.
// companyLevel: true → doc ID includes the company; false → fixed battalion-level doc ID.
const LEADERSHIP_SYNC_CONFIG = {
  'Battalion Commander':        { docId: 'battalion_commander', role: 'Battalion Commander',   companyLevel: false },
  'Battalion XO':               { docId: 'battalion_xo',        role: 'Executive Officer',      companyLevel: false },
  'Battalion CSM':              { docId: 'battalion_csm',        role: 'Command Sergeant Major', companyLevel: false },
  'Sergeant Major':             { docId: 'sergeant_major',       role: 'Sergeant Major',         companyLevel: false },
  'Battalion Deputy Commander': { docId: 'battalion_dco',        role: 'Deputy Commander',       companyLevel: false },
  'Battalion Staff (S-1)':      { docId: 'staff_s1',             role: 'S-1',                    companyLevel: false },
  'Battalion Staff (S-2)':      { docId: 'staff_s2',             role: 'S-2',                    companyLevel: false },
  'Battalion Staff (S-3)':      { docId: 'staff_s3',             role: 'S-3',                    companyLevel: false },
  'Battalion Staff (S-4)':      { docId: 'staff_s4',             role: 'S-4',                    companyLevel: false },
  'Battalion Staff (S-5)':      { docId: 'staff_s5',             role: 'S-5',                    companyLevel: false },
  'Battalion Staff (S-6)':      { docId: 'staff_s6',             role: 'S-6',                    companyLevel: false },
  'Battalion Staff (S-7)':      { docId: 'staff_s7',             role: 'S-7',                    companyLevel: false },
  'Company Commander':          { docIdPrefix: 'commander_',     role: 'Commander',              companyLevel: true  },
  'Company XO':                 { docIdPrefix: 'xo_',            role: 'Executive Officer',      companyLevel: true  },
  'First Sergeant':             { docIdPrefix: '1sg_',           role: 'First Sergeant',         companyLevel: true  },
  'Master Sergeant':            { docIdPrefix: 'msgt_',          role: 'Master Sergeant',        companyLevel: true  },
  'Platoon Leader':             { docIdPrefix: 'pl_',            role: 'Platoon Leader',         companyLevel: true,  platoonLevel: true },
  'Squad Leader':               { docIdPrefix: 'sl_',            role: 'Squad Leader',           companyLevel: true,  squadLevel:   true },
};

const _slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_');

function leadershipDocId(position, company, platoon, squad) {
  const cfg = LEADERSHIP_SYNC_CONFIG[position];
  if (!cfg) return null;
  if (cfg.squadLevel)   return `${cfg.docIdPrefix}${_slug(company)}_${_slug(platoon)}_${_slug(squad)}`;
  if (cfg.platoonLevel) return `${cfg.docIdPrefix}${_slug(company)}_${_slug(platoon)}`;
  if (cfg.companyLevel) return `${cfg.docIdPrefix}${_slug(company)}`;
  return cfg.docId;
}

const EMPTY_FORM = {
  fullName: '', rank: '', position: '', secondaryPosition: '', company: '',
  platoon: '', squad: '', gender: '', letLevel: '',
  notes: '', linkedUid: '', secondaryCompany: '',
  syncMaster: 'roster',
};

const iCls = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const lCls = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

// ── helpers ───────────────────────────────────────────────────────────────────

// Handles null/undefined gracefully — Battalion entries store platoon/squad
// as null, and searching would throw if we called null.trim() directly.
const normalize = (s) => (s ?? '').trim().toLowerCase();

// Pull the most-recent challenge record for a cadet by name (case-insensitive)
const latestChallenge = (cadetName, challengeMap) =>
  challengeMap[normalize(cadetName)] ?? null;

// ── sub-components ────────────────────────────────────────────────────────────

const ScoreBadge = ({ label, value }) => {
  if (value == null || value === '' || value === 0) return null;
  return (
    <span className="inline-flex flex-col items-center leading-none bg-slate-100 dark:bg-white/5 rounded-lg px-2 py-1 mr-1 mb-1">
      <span className="text-[8px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">{label}</span>
      <span className="text-xs font-black text-slate-800 dark:text-slate-200">{value}</span>
    </span>
  );
};

// ── main ──────────────────────────────────────────────────────────────────────

const AdminRoster = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const { companies } = useCompanies();

  const userLevel     = !authLoading ? (ROLE_HIERARCHY[role] || 0) : 0;
  const canManageAll  = userLevel >= STAFF_LEVEL;
  const canManageOwn  = userLevel >= COMMAND_LEVEL;
  // True when editing an existing entry that has a linked portal account.
  // All personal/org fields come from the portal and are locked here —
  // changes must go through the Accounts page (managed by S1).
  // S1 and S3 assistants can create, edit, and delete cadets in their own
  // company — but they cannot change a cadet's name or company assignment.
  const canS1Edit     = role === 'company_s1_assistant' || role === 'company_s3_assistant';
  // S6, S7, and MSgt are view-only (no write access).
  // S6/S7 can see all companies (canManageAll=true for queries) but cannot modify.
  // company_master_sergeant is view-only here — edit rights limited to Cadet Challenge.
  const canViewOwn    = role === 'company_master_sergeant';
  const canEdit       = role !== 's7_special_projects' && role !== 's6_technology'
    && role !== 'company_master_sergeant'
    && (canManageAll || canManageOwn || canS1Edit);
  const myCompany     = userData?.company || '';

  // Self-edit security: this account is exempt if they hold a top-level role.
  // All other accounts are blocked from editing authority fields on their own entry.
  const isSelfEditExempt = SELF_EDIT_EXEMPT_ROLES.includes(role);
  // Battalion S1 (70+) can review and approve pending deletion requests.
  const canApproveDeletion = userLevel >= STAFF_LEVEL;

  // Staff default to the Battalion tab; company command default to their own company.
  // Persists last-used company across profile visits via sessionStorage.
  const [activeCompany, setActiveCompany] = useState('');
  const [searchParams]  = useSearchParams();
  const editIdParam     = searchParams.get('editId');
  const editIdOpenedRef = useRef(false);

  const changeCompany = (co) => {
    setActiveCompany(co);
    if (canManageAll) try { sessionStorage.setItem('rosterCompany', co); } catch (_) {}
  };

  // set the tab once auth is ready, restoring last-used company for staff
  useEffect(() => {
    if (!authLoading && !activeCompany) {
      let initial;
      if (canManageAll) {
        try { initial = sessionStorage.getItem('rosterCompany'); } catch (_) {}
        if (!initial) initial = 'Battalion';
      } else {
        initial = myCompany;
      }
      setActiveCompany(initial);
    }
  }, [authLoading, canManageAll, myCompany, activeCompany]);

  const [rosterEntries,    setRosterEntries]    = useState([]);
  const [challengeRecords, setChallengeRecords] = useState([]);
  const [portalUsers,      setPortalUsers]      = useState([]);
  const [dataLoading,      setDataLoading]      = useState(true);
  const [search,           setSearch]           = useState('');
  const [groupLet,         setGroupLet]         = useState(false);
  // Battalion members whose secondaryCompany attaches them to the active
  // company period — fetched via a separate subscription for non-admin users.
  const [bnInPeriodDocs,   setBnInPeriodDocs]   = useState([]);

  const [showModal,   setShowModal]   = useState(false);
  const [editingId,   setEditingId]   = useState(null);
  const [form,        setForm]        = useState(EMPTY_FORM);

  // ── Promotion Board ──────────────────────────────────────────────────────────
  const [boardModal,   setBoardModal]   = useState(false);
  const [boardNum,     setBoardNum]     = useState(1);
  const [boardRunning, setBoardRunning] = useState(false);
  const [boardEntries, setBoardEntries] = useState([]); // full roster snapshot for preview
  // Must come AFTER editingId and form useState declarations — const is not
  // hoisted, so placing these before their dependencies causes a TDZ crash
  // in the production bundle where esbuild preserves the declaration order.
  const accountLocked     = !!editingId && !!form.linkedUid;
  const platoonAutoLocked = COMPANY_HQ_LOCKED_POSITIONS.includes(form.position);
  const [saving,       setSaving]       = useState(false);
  const [backfilling,        setBackfilling]        = useState(false);
  const [syncingLeadership,  setSyncingLeadership]  = useState(false);
  const [deleteConf,   setDeleteConf]   = useState(null);
  const [toast,        setToast]        = useState(null);

  // ── Pending deletion requests (Battalion S1 approval queue) ────────────────
  const [pendingActions,    setPendingActions]    = useState([]);
  const [pendingLoading,    setPendingLoading]    = useState(false);
  const [approvingAction,   setApprovingAction]   = useState(null);
  const [rejectingAction,   setRejectingAction]   = useState(null);
  const [deleteRequestConf, setDeleteRequestConf] = useState(null); // entry asking for deletion

  // ── Cadet History (view archived years) ────────────────────────────────────
  const [historyEntry,   setHistoryEntry]   = useState(null); // entry being viewed
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(null); // expanded year key

  // ── Graduate cadet ─────────────────────────────────────────────────────────
  const [graduateConf, setGraduateConf] = useState(null);
  const [graduating,   setGraduating]   = useState(false);

  // ── data subscriptions ────────────────────────────────────────────────────

  // Roster entries — company-scoped or all depending on access
  useEffect(() => {
    if (authLoading || !activeCompany) return;

    const q = canManageAll
      ? query(collection(db, 'roster'), orderBy('fullName', 'asc'))
      : query(
          collection(db, 'roster'),
          where('company', '==', activeCompany),
          orderBy('fullName', 'asc'),
        );

    setDataLoading(true);
    const unsub = onSnapshot(q, (snap) => {
      setRosterEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setDataLoading(false);
    }, () => setDataLoading(false));

    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, activeCompany, canManageAll]);

  // All challenge records (for client-side join).
  // Reads from cadetChallengeRecords (current system). No orderBy so no
  // composite index is needed — sorting happens client-side in challengeMap.
  useEffect(() => {
    if (authLoading || !activeCompany) return;
    const q = canManageAll
      ? query(collection(db, 'cadetChallengeRecords'))
      : query(collection(db, 'cadetChallengeRecords'),
          where('company', '==', activeCompany));
    const unsub = onSnapshot(
      q,
      (snap) => setChallengeRecords(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    );
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, activeCompany, canManageAll]);

  // Battalion-in-period subscription — for non-admin users, fetch roster docs
  // whose secondaryCompany matches the active company tab.  Admin users already
  // receive all roster entries from the main subscription above.
  useEffect(() => {
    if (authLoading || canManageAll || !activeCompany || BATTALION_COMPANIES.includes(activeCompany)) {
      setBnInPeriodDocs([]);
      return;
    }
    const q = query(
      collection(db, 'roster'),
      where('secondaryCompany', '==', activeCompany),
    );
    const unsub = onSnapshot(q, (snap) => {
      setBnInPeriodDocs(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(e => BATTALION_COMPANIES.includes(e.company)),
      );
    }, () => setBnInPeriodDocs([]));
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, activeCompany, canManageAll]);

  // Portal users (for link picker and account indicator)
  useEffect(() => {
    if (authLoading) return;
    const unsub = onSnapshot(
      query(collection(db, 'users'), orderBy('fullName', 'asc')),
      (snap) => setPortalUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))),
    );
    return () => unsub();
  }, [authLoading]);

  // Pending deletion requests (visible to Battalion S1 / staff 70+)
  useEffect(() => {
    if (authLoading || !canApproveDeletion) return;
    setPendingLoading(true);
    const unsub = onSnapshot(
      query(collection(db, 'rosterPendingActions'),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'asc')),
      (snap) => {
        setPendingActions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setPendingLoading(false);
      },
      () => setPendingLoading(false),
    );
    return () => unsub();
  }, [authLoading, canApproveDeletion]);

  // ── derived data ──────────────────────────────────────────────────────────

  // Map: normalised cadetName → best challenge record to display.
  // "Best" = highest cycleNumber that has at least one actual score (or a medical
  // exemption). This keeps Cycle 1 locked data visible in the column even after
  // Cycle 2 opens but before anyone has entered scores for the new cycle.
  const hasScores = (rec) =>
    rec?.medicalExempt ||
    rec?.exemptEvents?.length > 0 ||
    rec?.pushUps    != null ||
    rec?.sitUps     != null ||
    rec?.shuttleRun != null ||
    rec?.oneMile    != null ||
    rec?.sitNReach  != null;

  const challengeMap = useMemo(() => {
    const map = {};
    // Sort: highest cycleNumber first; tie-break by createdAt desc
    const sorted = [...challengeRecords].sort((a, b) => {
      const cn = (b.cycleNumber || 0) - (a.cycleNumber || 0);
      if (cn !== 0) return cn;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
    // Two-pass: first pass keeps best record with actual scores per cadet;
    // second pass fills in cadets who have records but all scores are null
    // (so the cycle badge still shows even for fully exempt cadets etc.)
    for (const rec of sorted) {
      const key = normalize(rec.cadetName);
      if (!key) continue;
      if (!map[key] && hasScores(rec)) map[key] = rec;
    }
    // Fallback: if no scored record exists yet, use the most recent record anyway
    for (const rec of sorted) {
      const key = normalize(rec.cadetName);
      if (key && !map[key]) map[key] = rec;
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeRecords]);

  // Map: uid → user (for linkedUid lookups)
  const userMap = useMemo(() => {
    const m = {};
    for (const u of portalUsers) m[u.uid] = u;
    return m;
  }, [portalUsers]);

  // When battalion staff type a search, scan every company at once.
  // Without a search, behaviour is unchanged (company-tab filtered).
  const isAllCompanies = activeCompany === 'All';
  const isSearchingAll = canManageAll && !isAllCompanies && search.trim().length > 0;

  const visibleEntries = useMemo(() => {
    const rawQ = search.trim();
    const q = normalize(rawQ.replace(/^#/, ''));
    if (isSearchingAll) {
      return rosterEntries.filter(e =>
        normalize(e.fullName).includes(q) ||
        normalize(e.position).includes(q) ||
        normalize(e.rank).includes(q) ||
        normalize(e.platoon).includes(q) ||
        normalize(e.company).includes(q) ||
        String(e.cadetNumber ?? '').includes(rawQ.replace(/^#/, '')),
      );
    }
    const base = isAllCompanies
      ? rosterEntries
      : rosterEntries.filter(e =>
          BATTALION_COMPANIES.includes(activeCompany)
            ? BATTALION_COMPANIES.includes(e.company)
            : e.company === activeCompany
        );
    if (!rawQ) return base;
    return base.filter(e =>
      normalize(e.fullName).includes(q) ||
      normalize(e.position).includes(q) ||
      normalize(e.rank).includes(q) ||
      normalize(e.platoon).includes(q) ||
      normalize(e.company).includes(q) ||
      String(e.cadetNumber ?? '').includes(rawQ.replace(/^#/, '')),
    );
  }, [rosterEntries, activeCompany, search, isSearchingAll, isAllCompanies]);

  // ── Period counts ─────────────────────────────────────────────────────────
  // isOnBattalionTab: viewing the HQ tab — battalion-in-period concept N/A.
  // companyTotal: unfiltered headcount for the active company/tab.
  // battalionInPeriod: battalion HQ members whose secondaryCompany attaches
  //   them to this company's class period — adds to the room's headcount.
  const isOnBattalionTab = !isAllCompanies && BATTALION_COMPANIES.includes(activeCompany);
  const companyTotal = isAllCompanies
    ? rosterEntries.length
    : isOnBattalionTab
      ? rosterEntries.filter(e => BATTALION_COMPANIES.includes(e.company)).length
      : rosterEntries.filter(e => e.company === activeCompany).length;
  // Battalion members whose secondaryCompany attaches them to this company's period.
  // Admin users filter from the already-complete rosterEntries; non-admin users
  // get these from the dedicated bnInPeriodDocs subscription (separate query).
  const battalionInPeriodEntries = useMemo(() => {
    if (isOnBattalionTab || isAllCompanies) return [];
    if (canManageAll) {
      return rosterEntries.filter(e =>
        BATTALION_COMPANIES.includes(e.company) && e.secondaryCompany === activeCompany,
      );
    }
    return bnInPeriodDocs;
  }, [rosterEntries, bnInPeriodDocs, activeCompany, isOnBattalionTab, canManageAll]);
  const battalionInPeriod = battalionInPeriodEntries.length;

  // ── helpers ───────────────────────────────────────────────────────────────

  const showToast = (msg, isError = false) => { setToast({ msg, isError }); setTimeout(() => setToast(null), 3000); };

  // Auto-open edit modal when navigated back from a profile with ?editId=
  useEffect(() => {
    if (!editIdParam || editIdOpenedRef.current || dataLoading || !rosterEntries.length) return;
    const entry = rosterEntries.find(e => e.id === editIdParam);
    if (entry) {
      editIdOpenedRef.current = true;
      openEdit(entry); // eslint-disable-line
    }
  }, [editIdParam, rosterEntries, dataLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, company: activeCompany });
    setEditingId(null);
    setShowModal(true);
  };

  const openEdit = (entry) => {
    setForm({
      fullName:         entry.fullName         || '',
      rank:             entry.rank             || '',
      position:         entry.position         || '',
      company:          entry.company          || activeCompany,
      platoon:          entry.platoon          || '',
      squad:            entry.squad            || '',
      gender:           entry.gender           || '',
      letLevel:         entry.letLevel         || '',
      notes:            entry.notes            || '',
      linkedUid:        entry.linkedUid        || '',
      secondaryPosition: entry.secondaryPosition || '',
      secondaryCompany:  entry.secondaryCompany  || '',
      syncMaster:        entry.syncMaster        || 'roster',
    });
    setEditingId(entry.id);
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditingId(null); setForm(EMPTY_FORM); };

  const handleBackfillIds = async () => {
    const unassigned = rosterEntries
      .filter(e => !e.cadetNumber)
      .sort((a, b) => ((a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0)));
    if (!unassigned.length) { showToast('All cadets already have an ID'); return; }
    if (!window.confirm(`Assign cadet IDs to ${unassigned.length} cadet${unassigned.length !== 1 ? 's' : ''} without one? IDs are permanent.`)) return;
    setBackfilling(true);
    try {
      const counterRef = doc(db, 'settings', 'cadetCounter');
      let startNum;
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        startNum = snap.exists() ? (snap.data().count || 0) : 0;
        tx.set(counterRef, { count: startNum + unassigned.length }, { merge: true });
      });
      const batch = writeBatch(db);
      unassigned.forEach((entry, i) => {
        batch.update(doc(db, 'roster', entry.id), { cadetNumber: startNum + i + 1 });
      });
      await batch.commit();
      showToast(`Assigned IDs to ${unassigned.length} cadet${unassigned.length !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Backfill failed:', err);
      showToast('Backfill failed — see console', true);
    } finally {
      setBackfilling(false);
    }
  };

  const handleSyncLeadership = async () => {
    if (!window.confirm('Re-sync all Platoon Leader and Squad Leader entries to the leadership collection? This fixes missing PL/SL slots in the Cadet Portal chain of command.')) return;
    setSyncingLeadership(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'roster'),
        where('position', 'in', ['Platoon Leader', 'Squad Leader']),
      ));
      const batch = writeBatch(db);
      let count = 0;
      snap.docs.forEach(d => {
        const { fullName, position, company, platoon, squad } = d.data();
        if (!company) return;
        const docId = leadershipDocId(position, company, platoon, squad);
        if (!docId) return;
        const cfg = LEADERSHIP_SYNC_CONFIG[position];
        batch.set(doc(db, 'leadership', docId), {
          name:        fullName || '',
          role:        cfg?.role || position,
          company:     company  || '',
          platoon:     platoon  || '',
          squad:       position === 'Squad Leader' ? (squad || '') : '',
          syncMaster:  'roster',
          syncedAt:    serverTimestamp(),
        }, { merge: true });
        count++;
      });
      await batch.commit();
      showToast(`Synced ${count} leadership doc${count !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Leadership sync failed:', err);
      showToast('Sync failed — see console', true);
    } finally {
      setSyncingLeadership(false);
    }
  };

  const handleExportRoster = () => {
    const rows = visibleEntries.map(e => ({
      fullName: e.fullName || '',
      rank: e.rank || '',
      position: e.position || '',
      secondaryPosition: e.secondaryPosition || '',
      company: e.company || '',
      platoon: e.platoon || '',
      squad: e.squad || '',
      gender: e.gender || '',
      letLevel: e.letLevel || '',
    }));
    const company = isSearchingAll ? 'all' : (activeCompany || 'roster').toLowerCase().replace(/\s+/g, '_');
    exportCSV(rows, `roster_${company}_${new Date().toISOString().slice(0,10)}.csv`, [
      { key: 'fullName',          label: 'Full Name' },
      { key: 'rank',              label: 'Rank' },
      { key: 'position',          label: 'Position' },
      { key: 'secondaryPosition', label: 'Secondary Position' },
      { key: 'company',           label: 'Company' },
      { key: 'platoon',           label: 'Platoon' },
      { key: 'squad',             label: 'Squad' },
      { key: 'gender',            label: 'Gender' },
      { key: 'letLevel',          label: 'LET Level' },
    ]);
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.fullName.trim()) return;

    // ── Rank ceiling enforcement ──────────────────────────────────────────────
    // A cadet's rank must never exceed the authorized max for their position.
    if (rankExceedsMax(form.rank, form.position)) {
      showToast(
        `${form.rank} is above the authorized max rank (${POSITION_RANKS[form.position]}) for ${form.position}. Correct the rank before saving.`,
        true,
      );
      return;
    }

    setSaving(true);
    try {
      const isBn = BATTALION_COMPANIES.includes(form.company || activeCompany);
      const resolvedCompany = (form.company || activeCompany || '').trim();
    if (!resolvedCompany) {
      showToast('Your company is not configured — ask an admin to update your profile', true);
      setSaving(false);
      return;
    }

    const payload = {
        fullName:         form.fullName.trim().toUpperCase(),
        rank:              form.rank             || null,
        position:          form.position         || null,
        secondaryPosition: form.secondaryPosition || null,
        company:           resolvedCompany,
        platoon:           isBn ? null : (form.platoon || null),
        squad:             isBn ? null : (form.squad   || null),
        secondaryCompany:  isBn ? (form.secondaryCompany || null) : null,
        gender:           form.gender    || null,
        letLevel:         form.letLevel  || null,
        notes:            form.notes.trim() || null,
        linkedUid:        form.linkedUid || null,
        syncMaster:       form.linkedUid ? (form.syncMaster || 'roster') : null,
      };
      if (editingId) {
        // ── Roster changelog: capture before/after diff ────────────────────
        const existingEntry = rosterEntries.find(e => e.id === editingId);
        if (existingEntry) {
          const changedFields = {};
          for (const field of CHANGELOG_FIELDS) {
            const oldVal = existingEntry[field] ?? null;
            const newVal = payload[field] ?? null;
            if (String(oldVal) !== String(newVal)) changedFields[field] = { from: oldVal, to: newVal };
          }
          if (Object.keys(changedFields).length > 0) {
            // Flag S1 adjutant rank/position changes for BC/CSM review —
            // per policy, only BC/CSM can freely change rank/position; S1 adjutant
            // is permitted but the change must be reviewed by BC if commissioned
            // officer or BC/CSM if NCO.
            const rankOrPositionChanged = 'rank' in changedFields || 'position' in changedFields;
            const isS1Change = role === 's1_adjutant';
            addDoc(collection(db, 'rosterChangelog'), {
              rosterId: editingId,
              cadetName: existingEntry.fullName,
              changes: changedFields,
              changedBy: user?.uid || '',
              changedByName: userData?.fullName || '',
              changedByRole: role || '',
              timestamp: serverTimestamp(),
              ...(rankOrPositionChanged && isS1Change && {
                flaggedForApproval: true,
                flagReason: 'S1 adjutant changed rank/position — requires BC/CSM review per chain of command policy',
              }),
            }).catch(err => console.warn('[rosterChangelog] write failed:', err));

            // Write an immediate security alert log entry when S1 changes rank/position
            if (rankOrPositionChanged && isS1Change) {
              writeLog({
                type: 'roster', action: 'rank_change_flagged',
                description: `⚑ S1 adjutant changed rank/position for ${existingEntry.fullName} — pending BC/CSM review`,
                userId: user?.uid || '', userFullName: userData?.fullName || '',
                userRole: role || '', targetId: editingId, targetName: existingEntry.fullName,
                category: 'security',
              });
            }
          }
        }

        await updateDoc(doc(db, 'roster', editingId), { ...payload, updatedAt: serverTimestamp() });
        showToast('Entry updated');
        writeLog({
          type: 'roster', action: 'update',
          description: `Updated roster entry for ${payload.fullName}`,
          userId: user?.uid || '', userFullName: userData?.fullName || '',
          userRole: role || '', targetId: editingId, targetName: payload.fullName,
        });
      } else {
        // Duplicate guard — block if another entry already has this exact name.
        const normalizedNew = payload.fullName.trim().toUpperCase();
        const duplicate = rosterEntries.find(
          e => (e.fullName || '').trim().toUpperCase() === normalizedNew
        );
        if (duplicate) {
          showToast(`A cadet named "${payload.fullName}" is already on the roster`, true);
          setSaving(false);
          return;
        }
        // Atomically assign the next 5-digit cadet number
        const counterRef = doc(db, 'settings', 'cadetCounter');
        let cadetNumber = null;
        try {
          await runTransaction(db, async (tx) => {
            const snap = await tx.get(counterRef);
            const current = snap.exists() ? (snap.data().count || 0) : 0;
            cadetNumber = current + 1;
            tx.set(counterRef, { count: cadetNumber }, { merge: true });
          });
        } catch (numErr) {
          console.warn('cadetCounter transaction failed (non-fatal):', numErr);
        }

        const newDoc = await addDoc(collection(db, 'roster'), {
          ...payload,
          ...(cadetNumber != null ? { cadetNumber } : {}),
          createdAt:  serverTimestamp(),
          updatedAt:  serverTimestamp(),
          createdBy:  user?.uid || '',
        });
        showToast('Cadet added');
        writeLog({
          type: 'roster', action: 'create',
          description: `Added ${payload.fullName} to the roster (${payload.company})`,
          userId: user?.uid || '', userFullName: userData?.fullName || '',
          userRole: role || '', targetId: newDoc.id, targetName: payload.fullName,
        });

        // ── Auto-sync to active S1 Tracker events ───────────────────────────
        // Find every form event that is still open (dueDate in the future) and
        // covers this cadet's company (battalion-wide or same company), then
        // create a pending submission for them so they appear in the tracker.
        // Runs after the roster save succeeds; failures are non-fatal.
        try {
          const now = Timestamp.now();
          const evSnap = await getDocs(
            query(collection(db, 'formEvents'), where('dueDate', '>=', now))
          );
          const matchingEvents = evSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(e => e.scope === 'battalion' || e.company === payload.company);

          if (matchingEvents.length > 0) {
            // Check which events already have a submission for this roster doc
            // (guards against duplicate inserts if called twice by accident).
            const existSnap = await getDocs(
              query(collection(db, 'formSubmissions'), where('rosterDocId', '==', newDoc.id))
            );
            const existingEventIds = new Set(existSnap.docs.map(d => d.data().eventId));
            const missing = matchingEvents.filter(e => !existingEventIds.has(e.id));

            if (missing.length > 0) {
              const syncBatch = writeBatch(db);
              missing.forEach(event => {
                const subRef = doc(collection(db, 'formSubmissions'));
                syncBatch.set(subRef, {
                  eventId:          event.id,
                  rosterDocId:      newDoc.id,
                  linkedUid:        payload.linkedUid        || null,
                  cadetName:        payload.fullName         || '',
                  rank:             payload.rank             || '',
                  company:          payload.company          || '',
                  secondaryCompany: payload.secondaryCompany || '',
                  letLevel:         payload.letLevel         || '',
                  status:           'pending',
                  turnedInAt:       null,
                  turnedInBy:       null,
                  turnedInByName:   null,
                  notes:            '',
                  fileUrl:          null,
                  fileStoragePath:  null,
                });
                syncBatch.update(doc(db, 'formEvents', event.id), {
                  totalCadets: increment(1),
                });
              });
              await syncBatch.commit();
              console.log(`S1 sync: added ${payload.fullName} to ${missing.length} active event(s)`);
            }
          }
        } catch (syncErr) {
          // Non-fatal — the cadet is on the roster; S1 can manually add them if needed.
          console.warn('S1 event auto-sync failed (non-fatal):', syncErr);
        }
      }

      // ── Roster → account sync ────────────────────────────────────────────
      // Whenever a linked account exists, push the shared fields to the users/
      // doc so the portal profile stays in sync automatically. This fires
      // regardless of syncMaster — the syncMaster flag only controls the
      // reverse direction (portal → roster, handled in AdminUsers.jsx).
      if (form.linkedUid) {
        const syncFields = {
          fullName: payload.fullName,
          rank:     payload.rank,
          position: payload.position,
          company:  payload.company,
          ...(payload.platoon          !== undefined ? { platoon:          payload.platoon          } : {}),
          ...(payload.squad            !== undefined ? { squad:            payload.squad            } : {}),
          ...(payload.secondaryCompany !== undefined ? { secondaryCompany: payload.secondaryCompany } : {}),
          gender:   payload.gender,
          letLevel: payload.letLevel,
          updatedAt: serverTimestamp(),
        };
        try {
          await updateDoc(doc(db, 'users', form.linkedUid), syncFields);
        } catch (syncErr) {
          // Non-fatal — roster save succeeded; just log the sync miss
          console.warn('Roster→portal sync failed:', syncErr);
        }
      }

      // ── Roster → Leadership sync ─────────────────────────────────────────
      // If this entry holds a public-facing leadership position, mirror
      // name/rank/portrait into the publicly-readable `leadership` collection
      // so the public Leadership page stays in sync without manual Publishing Hub entries.
      try {
        const oldEntry   = editingId ? rosterEntries.find(e => e.id === editingId) : null;
        const oldDocId   = oldEntry?.position ? leadershipDocId(oldEntry.position, oldEntry.company, oldEntry.platoon, oldEntry.squad) : null;
        const newDocId   = payload.position   ? leadershipDocId(payload.position,  payload.company,  payload.platoon,  payload.squad)  : null;

        // If position or company changed, remove the stale leadership entry
        if (oldDocId && oldDocId !== newDocId) {
          await deleteDoc(doc(db, 'leadership', oldDocId)).catch(() => {});
        }

        if (newDocId) {
          const cfg      = LEADERSHIP_SYNC_CONFIG[payload.position];
          const portrait = userMap[form.linkedUid]?.portrait || '';
          const syncData = {
            name:        payload.fullName,
            rank:        payload.rank || 'N/A',
            role:        cfg.role,
            company:     cfg.companyLevel ? `${payload.company} Company` : '',
            platoon:     cfg.platoonLevel || cfg.squadLevel ? (payload.platoon || '') : '',
            squad:       cfg.squadLevel ? (payload.squad || '') : '',
            _rosterSync: true,
          };
          // Only write portrait if we actually have one — preserves a manually-uploaded photo
          if (portrait) syncData.portrait = portrait;
          await setDoc(
            doc(db, 'leadership', newDocId),
            syncData,
            { merge: true },  // preserves manually-set desc/quote/portrait from Publishing Hub
          );
        }
      } catch (lErr) {
        // Non-fatal — leadership display may be stale until next save or manual update
        console.warn('Roster→leadership sync failed (non-fatal):', lErr);
      }

      closeModal();
    } catch (err) {
      console.error('Roster save failed:', err);
      if (err?.code === 'permission-denied') {
        showToast('Permission denied — verify your company matches the entry');
      } else {
        showToast('Save failed — try again');
      }
    } finally {
      setSaving(false);
    }
  };

  // deleteSubmissionsForCadet: removes all formSubmissions tied to a roster doc.
  // Called before deleting the roster doc so S1 Tracker stays clean.
  // Non-fatal — a failure here should not block the roster deletion.
  const deleteSubmissionsForCadet = async (rosterId) => {
    try {
      const snap = await getDocs(
        query(collection(db, 'formSubmissions'), where('rosterDocId', '==', rosterId))
      );
      if (snap.empty) return;
      // Batch-delete in chunks of 490 to stay under the 500-op limit
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 490) {
        const batch = writeBatch(db);
        docs.slice(i, i + 490).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.warn('S1 submission cleanup failed (non-fatal):', err);
    }
  };

  // handleDelete: staff (70+) can delete immediately; everyone else submits a
  // pending action for Battalion S1 to approve. The actual Firestore delete is
  // gated by rules to level 70+ only.
  const handleDelete = async () => {
    if (!deleteConf) return;
    const entry = deleteConf;
    try {
      if (canApproveDeletion) {
        // Staff (70+): immediate delete — clean up S1 submissions first
        await deleteSubmissionsForCadet(entry.id);
        await deleteDoc(doc(db, 'roster', entry.id));
        // Remove the leadership entry if this cadet held a public-facing position
        const lDocId = entry.position ? leadershipDocId(entry.position, entry.company) : null;
        if (lDocId) deleteDoc(doc(db, 'leadership', lDocId)).catch(() => {});
        writeLog({
          type: 'roster', action: 'delete',
          description: `Removed ${entry.fullName} from the roster`,
          userId: user?.uid || '', userFullName: userData?.fullName || '',
          userRole: role || '', targetId: entry.id, targetName: entry.fullName,
        });
        showToast('Entry removed');
      } else {
        // Commander / assistant: submit for S1 approval
        await addDoc(collection(db, 'rosterPendingActions'), {
          type: 'delete',
          rosterId:          entry.id,
          cadetName:         entry.fullName,
          cadetCompany:      entry.company,
          cadetRank:         entry.rank    || null,
          cadetPosition:     entry.position || null,
          requestedBy:       user?.uid || '',
          requestedByName:   userData?.fullName || '',
          requestedByRole:   role || '',
          status:            'pending',
          createdAt:         serverTimestamp(),
        });
        writeLog({
          type: 'roster', action: 'delete_requested',
          description: `${userData?.fullName} requested deletion of ${entry.fullName} — pending Battalion S1 approval`,
          userId: user?.uid || '', userFullName: userData?.fullName || '',
          userRole: role || '', targetId: entry.id, targetName: entry.fullName,
          category: 'security',
        });
        showToast('Deletion request submitted — Battalion S1 will review');
      }
      setDeleteConf(null);
    } catch {
      showToast('Failed — try again');
    }
  };

  // S1 approves a pending deletion: perform the actual delete and mark resolved.
  const handleApproveDelete = async (action) => {
    if (approvingAction) return;
    setApprovingAction(action.id);
    try {
      // Clean up S1 Tracker submissions before removing the roster doc
      await deleteSubmissionsForCadet(action.rosterId);
      await deleteDoc(doc(db, 'roster', action.rosterId));
      // Remove stale leadership entry if the cadet held a public-facing position
      if (action.cadetPosition) {
        const lDocId = leadershipDocId(action.cadetPosition, action.cadetCompany || '');
        if (lDocId) deleteDoc(doc(db, 'leadership', lDocId)).catch(() => {});
      }
      await updateDoc(doc(db, 'rosterPendingActions', action.id), {
        status:          'approved',
        reviewedBy:      user?.uid || '',
        reviewedByName:  userData?.fullName || '',
        reviewedAt:      serverTimestamp(),
      });
      writeLog({
        type: 'roster', action: 'delete',
        description: `Approved deletion of ${action.cadetName} (requested by ${action.requestedByName})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: action.rosterId, targetName: action.cadetName,
      });
      showToast(`${action.cadetName} removed`);
    } catch {
      showToast('Approval failed — try again');
    } finally {
      setApprovingAction(null);
    }
  };

  // S1 rejects a pending deletion: mark resolved with status 'rejected'.
  const handleRejectDelete = async (action) => {
    if (rejectingAction) return;
    setRejectingAction(action.id);
    try {
      await updateDoc(doc(db, 'rosterPendingActions', action.id), {
        status:          'rejected',
        reviewedBy:      user?.uid || '',
        reviewedByName:  userData?.fullName || '',
        reviewedAt:      serverTimestamp(),
      });
      writeLog({
        type: 'roster', action: 'delete_rejected',
        description: `Rejected deletion request for ${action.cadetName} (requested by ${action.requestedByName})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: action.rosterId, targetName: action.cadetName,
      });
      showToast('Request rejected');
    } catch {
      showToast('Failed — try again');
    } finally {
      setRejectingAction(null);
    }
  };

  // ── Cadet History helpers ─────────────────────────────────────────────────

  const openHistory = async (entry) => {
    setHistoryEntry(entry);
    setHistoryRecords([]);
    setHistoryExpanded(null);
    setHistoryLoading(true);
    try {
      const q    = query(collection(db, 'cadetYearlyHistory'), where('rosterId', '==', entry.id));
      const snap = await getDocs(q);
      const records = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.schoolYear || '').localeCompare(a.schoolYear || ''));
      setHistoryRecords(records);
      if (records.length > 0) setHistoryExpanded(records[0].schoolYear);
    } catch (err) {
      console.error('History load failed:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // ── Graduate helpers ──────────────────────────────────────────────────────

  const handleGraduate = async () => {
    if (!graduateConf) return;
    setGraduating(true);
    try {
      const rosterId = graduateConf.id;
      const batch = writeBatch(db);

      // Delete all associated records across collections
      const relatedCollections = [
        { col: 'fundraiserEntries',      field: 'cadetId'    },
        { col: 'cadetChallengeRecords',  field: 'cadetId'    },
        { col: 'uniformSizes',           field: 'cadetId'    },
        { col: 'cadetYearlyHistory',     field: 'rosterId'   },
        { col: 'formSubmissions',        field: 'rosterDocId' },
      ];
      for (const { col, field } of relatedCollections) {
        const snap = await getDocs(query(collection(db, col), where(field, '==', rosterId)));
        snap.forEach(d => batch.delete(d.ref));
      }

      // Remove cadet from any S5 Shop completions maps
      const s5Snap = await getDocs(collection(db, 's5Shop'));
      s5Snap.forEach(taskDoc => {
        if (taskDoc.data().completions?.[rosterId] !== undefined) {
          batch.update(taskDoc.ref, { [`completions.${rosterId}`]: deleteField() });
        }
      });

      // Delete the roster doc itself
      batch.delete(doc(db, 'roster', rosterId));

      await batch.commit();
      setGraduateConf(null);
      showToast(`${graduateConf.fullName} removed from roster`);
    } catch (err) {
      console.error('Graduation delete failed:', err);
      showToast('Delete failed — try again');
    } finally {
      setGraduating(false);
    }
  };

  // ── access guard ──────────────────────────────────────────────────────────

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="animate-spin text-yellow-500" size={40} />
    </div>
  );

  if (!canManageOwn && !canManageAll && !canViewOwn && !canS1Edit) return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div>
        <UserCircle className="mx-auto text-yellow-500 mb-4" size={40} />
        <p className="font-black uppercase text-sm text-slate-500">Access Restricted</p>
        <p className="text-xs text-slate-400 mt-2">Company command and above.</p>
      </div>
    </div>
  );

  // ── render helpers ────────────────────────────────────────────────────────
  // Defined here (not inside JSX) so both the main tbody and the
  // Battalion-in-period section can share the same function.
  // forceReadOnly = true → hides Edit/Delete/Graduate (used for battalion
  // entries shown inside a company tab for non-canManageAll users).
  const renderRow = (entry, idx, forceReadOnly = false) => {
    const rowCanEdit = canEdit && !forceReadOnly;
    const ch  = latestChallenge(entry.fullName, challengeMap);
    const acc = entry.linkedUid ? userMap[entry.linkedUid] : null;
    const hasAccount = Boolean(entry.linkedUid);
    const isSelfEntry    = Boolean(user?.uid && entry.linkedUid === user.uid);
    const selfEditBlocked = isSelfEntry && !isSelfEditExempt;

    return (
      <tr
        key={entry.id}
        className={`border-b border-blue-50 dark:border-white/[0.03] hover:bg-yellow-50/30 dark:hover:bg-yellow-500/5 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-900/30'}`}
      >
        {/* Rank */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-[10px] font-black uppercase text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">
            {entry.rank || '—'}
          </span>
        </td>

        {/* Name + account indicator + company badge (global search) */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-xs text-slate-900 dark:text-white uppercase tracking-tight whitespace-nowrap">
              {entry.fullName}
            </span>
            {entry.cadetNumber != null && (
              <span
                title={`Cadet ID #${String(entry.cadetNumber).padStart(5, '0')}`}
                className="inline-flex items-center gap-0.5 text-[9px] font-black tracking-wider text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-1.5 py-0.5 rounded-full whitespace-nowrap font-mono"
              >
                <Hash size={8} />
                {String(entry.cadetNumber).padStart(5, '0')}
              </span>
            )}
            {isSearchingAll && entry.company && (
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                {BATTALION_COMPANIES.includes(entry.company) ? 'Battalion' : `${entry.company} Co.`}
              </span>
            )}
            {hasAccount && (
              <span
                title={acc ? `Portal: ${acc.fullName}` : 'Has portal account'}
                className="text-blue-400 shrink-0"
              >
                <Link2 size={12} />
              </span>
            )}
            {BATTALION_COMPANIES.includes(entry.company) && entry.secondaryCompany && (
              <span
                title={`Watches over ${entry.secondaryCompany} Company`}
                className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full"
              >
                <Eye size={9} />
                {entry.secondaryCompany}
              </span>
            )}
          </div>
          {entry.letLevel && (
            <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase mt-0.5">{entry.letLevel}</p>
          )}
        </td>

        {/* Position */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-xs text-slate-600 dark:text-slate-300 font-bold">{entry.position || '—'}</span>
          {entry.secondaryPosition && (() => {
            const teamKey = teamKeyFromPosition(entry.secondaryPosition);
            const cls = "ml-2 inline-flex items-center text-[9px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded-full";
            return teamKey ? (
              <Link
                to={`/admin/teams?team=${encodeURIComponent(teamKey)}`}
                title={`Go to ${teamKey} team`}
                className={`${cls} hover:bg-indigo-500/20 hover:border-indigo-500/40 transition-colors`}
              >
                {entry.secondaryPosition}
              </Link>
            ) : (
              <span title={`Secondary: ${entry.secondaryPosition}`} className={cls}>
                {entry.secondaryPosition}
              </span>
            );
          })()}
        </td>

        {/* Platoon */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-xs text-slate-500 dark:text-slate-400">{entry.platoon || '—'}</span>
        </td>

        {/* Squad */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-xs text-slate-500 dark:text-slate-400">{entry.squad || '—'}</span>
        </td>

        {/* Gender */}
        <td className="px-4 py-3 whitespace-nowrap">
          {entry.gender ? (
            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
              entry.gender === 'Male'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : entry.gender === 'Female'
                  ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-500'
            }`}>
              {entry.gender === 'Male' ? 'M' : entry.gender === 'Female' ? 'F' : entry.gender}
            </span>
          ) : <span className="text-slate-300 dark:text-slate-700">—</span>}
        </td>

        {/* Challenge scores */}
        <td className="px-4 py-3">
          {ch ? (
            <div className="flex flex-wrap items-start gap-x-0">
              {/* Cycle badge */}
              <span className="inline-flex items-center self-center mr-1.5 mb-1 text-[8px] font-black uppercase tracking-wider text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">
                C{ch.cycleNumber ?? '?'}
              </span>
              {ch.medicalExempt ? (
                <span className="text-[10px] text-orange-500 font-bold uppercase self-center">Med. Exempt</span>
              ) : (
                <>
                  <ScoreBadge label="PU"   value={ch.pushUps} />
                  <ScoreBadge label="SU"   value={ch.sitUps} />
                  <ScoreBadge label="Sht"  value={ch.shuttleRun} />
                  <ScoreBadge label="Mile" value={ch.oneMile} />
                  <ScoreBadge label="S&R"  value={ch.sitNReach} />
                  {(!ch.pushUps && !ch.sitUps && !ch.shuttleRun && !ch.oneMile && !ch.sitNReach) && (
                    <span className="text-[10px] text-slate-400 font-bold self-center">No scores yet</span>
                  )}
                </>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-slate-300 dark:text-slate-700 font-bold uppercase">No record</span>
          )}
        </td>

        {/* Actions */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-1">
            <Link
              to={`/admin/personnel/${entry.id}`}
              title="View cadet profile"
              className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all"
            >
              <UserCircle size={14} />
            </Link>
            {(canManageAll || canManageOwn) && (
              <button
                onClick={() => openHistory(entry)}
                title="View cadet history"
                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all"
              >
                <History size={14} />
              </button>
            )}
            {rowCanEdit && (
              <>
                <button
                  onClick={() => {
                    if (selfEditBlocked) {
                      writeLog({
                        type: 'roster', action: 'self_edit_blocked',
                        description: `${userData?.fullName || 'Unknown'} attempted to edit their own roster entry`,
                        userId: user?.uid || '', userFullName: userData?.fullName || '',
                        userRole: role || '', targetId: entry.id, targetName: entry.fullName,
                        category: 'security',
                      });
                      if (userLevel >= COMMAND_LEVEL) {
                        user?.getIdToken?.().then(idToken => {
                          fetch('/api/notify-security', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              idToken,
                              event: 'self_edit_attempt',
                              actorName: userData?.fullName || '',
                              actorRole: role || '',
                              targetName: entry.fullName,
                              targetId: entry.id,
                            }),
                          }).catch(() => {});
                        }).catch(() => {});
                      }
                      showToast('You cannot edit your own roster entry — contact a staff member');
                      return;
                    }
                    openEdit(entry);
                  }}
                  title={selfEditBlocked ? 'Self-editing blocked — contact staff' : 'Edit entry'}
                  className={`p-1.5 rounded-lg transition-all ${
                    selfEditBlocked
                      ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                      : 'text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10'
                  }`}
                >
                  {selfEditBlocked ? <ShieldAlert size={14} /> : <Edit3 size={14} />}
                </button>
                <button
                  onClick={() => setDeleteConf({ id: entry.id, fullName: entry.fullName, company: entry.company, rank: entry.rank, position: entry.position })}
                  title={canApproveDeletion ? 'Remove from roster' : 'Request removal (requires S1 approval)'}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            {!forceReadOnly && userLevel >= ADMIN_LEVEL && !entry.graduated && (
              <button
                onClick={() => setGraduateConf({ id: entry.id, fullName: entry.fullName })}
                title="Mark as graduated"
                className="p-1.5 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-500/10 transition-all"
              >
                <GraduationCap size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={UserCircle} title="Battalion Roster" />}

        {/* ── Header actions ── */}
        <div className="flex items-center justify-end mb-8 gap-4 flex-wrap">
          {/* Promotion board moved to S1 → Promotion Board page (closed board detail) */}
          {/* Only canManageAll (staff 70+) can add cadets to the Battalion tab.
              Company leadership (canManageOwn) can only add to their own company. */}
          {canEdit && (!isOnBattalionTab || canManageAll) && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-5 py-3 rounded-xl transition-all shadow-lg shadow-yellow-500/20"
            >
              <Plus size={16} /> Add Cadet
            </button>
          )}
          {canViewOwn && !canEdit && (
            <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 dark:bg-white/5 px-4 py-2.5 rounded-xl">
              Read Only
            </span>
          )}
        </div>

        {/* ── Pending Deletion Approvals (Battalion S1 only) ── */}
        {canApproveDeletion && (pendingLoading || pendingActions.length > 0) && (
          <div className="mb-8 rounded-2xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/10 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-200 dark:border-amber-500/20 bg-amber-100/60 dark:bg-amber-900/20">
              <Clock size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                Pending Roster Deletions — {pendingActions.length} request{pendingActions.length !== 1 ? 's' : ''}
              </span>
            </div>
            {pendingLoading ? (
              <div className="flex items-center gap-2 px-5 py-4 text-amber-600 dark:text-amber-400">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-xs font-bold">Loading requests…</span>
              </div>
            ) : (
              <div className="divide-y divide-amber-200/60 dark:divide-amber-500/10">
                {pendingActions.map(action => (
                  <div key={action.id} className="flex items-center gap-4 px-5 py-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-slate-900 dark:text-white">
                        {action.cadetName}
                        {action.cadetRank && (
                          <span className="ml-2 text-[9px] font-bold text-slate-400">({action.cadetRank})</span>
                        )}
                        <span className="ml-2 text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
                          {action.cadetCompany} Co.
                        </span>
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Requested by <strong className="text-slate-700 dark:text-slate-300">{action.requestedByName}</strong>
                        {' '}({action.requestedByRole?.replace(/_/g, ' ')})
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRejectDelete(action)}
                        disabled={rejectingAction === action.id || approvingAction === action.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-50 transition-all"
                      >
                        {rejectingAction === action.id ? <Loader2 size={10} className="animate-spin" /> : <XCircle size={10} />}
                        Reject
                      </button>
                      <button
                        onClick={() => handleApproveDelete(action)}
                        disabled={approvingAction === action.id || rejectingAction === action.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50 transition-all"
                      >
                        {approvingAction === action.id ? <Loader2 size={10} className="animate-spin" /> : <CheckCheck size={10} />}
                        Approve &amp; Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Company filter ── */}
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          {canManageAll ? (
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-2.5 shadow-sm">
              <Filter size={13} className="text-slate-400 shrink-0" />
              <select
                value={activeCompany}
                onChange={e => changeCompany(e.target.value)}
                className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2 cursor-pointer"
              >
                <option value="All">All Companies</option>
                {['Battalion', ...companies].filter(Boolean).map(co => (
                  <option key={co} value={co}>
                    {BATTALION_COMPANIES.includes(co) ? `${co} · HQ` : `${co} Company`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
              {BATTALION_COMPANIES.includes(myCompany) ? `${myCompany} · HQ` : `${myCompany} Company`}
            </span>
          )}
          <div className="ml-auto self-center text-right space-y-0.5">
            <p className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest">
              {visibleEntries.length} cadet{visibleEntries.length !== 1 ? 's' : ''}
            </p>
            {!isOnBattalionTab && (
              <>
                <p className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest">
                  {battalionInPeriod} battalion in period
                </p>
                <p className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-widest border-t border-slate-200 dark:border-white/10 pt-0.5">
                  {companyTotal + battalionInPeriod} total
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Search + LET group toggle ── */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex-1 min-w-[200px] max-w-sm space-y-1">
            <div className="relative">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={canManageAll ? 'Search by name, rank, position, or #ID…' : 'Search by name, rank, or position…'}
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600"
              />
            </div>
            {isSearchingAll && (
              <p className="text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 pl-1">
                Searching all companies · {visibleEntries.length} result{visibleEntries.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <button
            onClick={() => setGroupLet(g => !g)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border ${
              groupLet
                ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                : 'bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400'
            }`}
          >
            <GraduationCap size={13} /> Group by LET
          </button>
          {visibleEntries.length > 0 && (
            <button
              onClick={handleExportRoster}
              title="Export to CSV"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500 hover:text-yellow-600"
            >
              <Download size={13} /> Export CSV
            </button>
          )}
          {visibleEntries.length > 0 && (
            <button
              onClick={() => {
                const title = isAllCompanies
                  ? 'All Companies Roster'
                  : BATTALION_COMPANIES.includes(activeCompany)
                    ? 'Battalion Roster'
                    : `${activeCompany} Company Roster`;
                printRoster(visibleEntries, title);
              }}
              title="Print roster"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500 hover:text-yellow-600"
            >
              <Printer size={13} /> Print Roster
            </button>
          )}
          {userLevel >= ADMIN_LEVEL && rosterEntries.some(e => !e.cadetNumber) && (
            <button
              onClick={handleBackfillIds}
              disabled={backfilling}
              title="Assign cadet IDs to cadets who don't have one yet"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-600 disabled:opacity-50"
            >
              {backfilling ? <Loader2 size={13} className="animate-spin" /> : <Hash size={13} />}
              {backfilling ? 'Assigning…' : 'Assign IDs'}
            </button>
          )}
          {userLevel >= STAFF_LEVEL && (
            <button
              onClick={handleSyncLeadership}
              disabled={syncingLeadership}
              title="Sync all Platoon Leader and Squad Leader entries to the leadership collection"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500 hover:text-yellow-600 disabled:opacity-50"
            >
              {syncingLeadership ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {syncingLeadership ? 'Syncing…' : 'Sync Leadership'}
            </button>
          )}
        </div>

        {/* ── Roster table ── */}
        {dataLoading ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map(n => (
              <div key={n} className="h-14 bg-slate-100 dark:bg-slate-900/60 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="text-center py-24 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
            <UserCircle className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={40} />
            <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm">
              {isSearchingAll ? 'No cadets match your search across any company' : search ? 'No cadets match your search' : `No cadets in ${activeCompany} Company yet`}
            </p>
            {!search && canEdit && (
              <button onClick={openCreate} className="mt-4 text-yellow-500 text-xs font-black uppercase tracking-widest hover:text-yellow-400 transition-colors">
                + Add first cadet
              </button>
            )}
          </div>
        ) : (
          <>
          <div className="overflow-x-auto rounded-2xl border border-blue-100 dark:border-white/5 shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-blue-100 dark:border-white/5">
                  {['Rank','Name','Position','Platoon','Squad','Gender','Challenge Scores',''].map(h => (
                    <th key={h} className="text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupLet
                  ? groupByLet(visibleEntries, e => e.letLevel, e => e.fullName).map(({ level, entries: group }) => (
                      <React.Fragment key={level}>
                        <tr>
                          <td colSpan={999} className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-y border-yellow-200 dark:border-yellow-500/20">
                            {level}
                          </td>
                        </tr>
                        {group.map((entry, idx) => renderRow(entry, idx))}
                      </React.Fragment>
                    ))
                  : visibleEntries.map((entry, idx) => renderRow(entry, idx))
                }
              </tbody>
            </table>
          </div>

          {/* ── Battalion members in period (company tabs only) ── */}
          {!isOnBattalionTab && battalionInPeriodEntries.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-3 mb-2 px-1">
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                  <Eye size={10} /> Battalion · In Period
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500">
                  — HQ staff attached to this company's class period
                </span>
                {!canManageAll && (
                  <span className="ml-auto text-[9px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full">
                    View only
                  </span>
                )}
              </div>
              <div className="overflow-x-auto rounded-2xl border border-amber-200 dark:border-amber-500/20 shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-500/20">
                      {['Rank','Name','Position','Platoon','Squad','Gender','Challenge Scores',''].map(h => (
                        <th key={h} className="text-left text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 px-4 py-3 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Battalion entries in company tabs are read-only for company leadership.
                      // canManageAll (staff 70+) retains full edit access.
                      const bnReadOnly = !canManageAll;
                      const bnEntries = groupLet
                        ? groupByLet(battalionInPeriodEntries, e => e.letLevel, e => e.fullName)
                            .flatMap(({ level, entries: grp }) => [
                              <tr key={`bn-hdr-${level}`}>
                                <td colSpan={999} className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-y border-yellow-200 dark:border-yellow-500/20">
                                  {level}
                                </td>
                              </tr>,
                              ...grp.map((entry, idx) => renderRow(entry, idx, bnReadOnly)),
                            ])
                        : battalionInPeriodEntries.map((entry, idx) => renderRow(entry, idx, bnReadOnly));
                      return bnEntries;
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </>
        )}


      {/* ── Promotion Board Modal ── */}
      {boardModal && (() => {
        // Compute eligible cadets for the selected board number
        const eligible = boardEntries
          .filter(e => {
            const target = boardTargetRank(e.position, boardNum);
            if (!target || !e.rank) return false;
            const curIdx = JROTC_RANKS.indexOf(e.rank);
            const tgtIdx = JROTC_RANKS.indexOf(target);
            return curIdx >= 0 && curIdx < tgtIdx;
          })
          .map(e => ({ ...e, targetRank: boardTargetRank(e.position, boardNum) }))
          .sort((a, b) => (a.company || '').localeCompare(b.company || '') || a.fullName.localeCompare(b.fullName));

        const runBoard = async () => {
          setBoardRunning(true);
          try {
            await Promise.all(eligible.map(async e => {
              // Update roster entry
              await updateDoc(doc(db, 'roster', e.id), { rank: e.targetRank });
              // Sync to linked portal account if present
              if (e.linkedUid) {
                try { await updateDoc(doc(db, 'users', e.linkedUid), { rank: e.targetRank }); }
                catch { /* non-fatal */ }
              }
            }));
            await writeLog({
              type: 'roster', action: 'update',
              description: `Promotion Board ${boardNum} run — ${eligible.length} cadet${eligible.length !== 1 ? 's' : ''} promoted`,
              userId: user?.uid || '', userFullName: userData?.fullName || '', userRole: role || '',
              targetId: '', targetName: '',
            });
            setBoardModal(false);
            showToast(`Board ${boardNum} complete — ${eligible.length} cadet${eligible.length !== 1 ? 's' : ''} promoted`);
          } catch (err) {
            console.error('Board failed:', err);
            showToast('Promotion board failed — check console', true);
          } finally {
            setBoardRunning(false);
          }
        };

        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="modal-enter bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <TrendingUp size={18} className="text-indigo-500" />
                  <span className="font-black uppercase text-sm tracking-widest text-slate-900 dark:text-white">Promotion Board</span>
                </div>
                <button onClick={() => setBoardModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                  <X size={18} />
                </button>
              </div>

              {/* Board selector */}
              <div className="px-6 pt-5 pb-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Select Board</p>
                <div className="flex gap-3">
                  {[1, 2].map(n => (
                    <button
                      key={n}
                      onClick={() => setBoardNum(n)}
                      className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest border transition-all ${boardNum === n ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-indigo-400'}`}
                    >
                      Board {n}
                      <span className="block text-[9px] font-bold normal-case tracking-normal mt-0.5 opacity-70">
                        {n === 1 ? 'Promote to one rank below max' : 'Promote to max authorized rank'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview list */}
              <div className="flex-1 overflow-y-auto px-6 pb-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 mt-2">
                  {eligible.length} cadet{eligible.length !== 1 ? 's' : ''} eligible for promotion
                </p>
                {eligible.length === 0 ? (
                  <p className="text-sm text-slate-400 italic py-6 text-center">
                    All cadets are already at or above the Board {boardNum} target — no promotions needed.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {eligible.map(e => (
                      <div key={e.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 text-sm">
                        <div>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{e.fullName}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{normalizeCompany(e.company)}{e.position ? ` · ${e.position}` : ''}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded">{e.rank || '—'}</span>
                          <span className="text-slate-300 dark:text-slate-600 text-xs">→</span>
                          <span className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded">{e.targetRank}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-3">
                <button onClick={() => setBoardModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button
                  disabled={eligible.length === 0 || boardRunning}
                  onClick={runBoard}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  {boardRunning ? <><Loader2 size={14} className="animate-spin" /> Running…</> : <><TrendingUp size={14} /> Run Board {boardNum}</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Add / Edit Modal ── */}
      {showModal && (
          <div
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && closeModal()}
          >
            <div className="modal-enter bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
                <h2 className="font-black uppercase text-sm tracking-widest text-slate-900 dark:text-white">
                  {editingId ? 'Edit Roster Entry' : 'Add Cadet'}
                </h2>
                <button onClick={closeModal} aria-label="Close" className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-4">

                {/* Portal-managed banner — shown when editing a linked account entry */}
                {accountLocked && (
                  <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-2xl p-4 flex items-start gap-3">
                    <Link2 size={14} className="text-blue-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-widest mb-1">
                        Managed by Portal Account
                      </p>
                      <p className="text-[11px] text-blue-600 dark:text-blue-400 leading-relaxed">
                        {canS1Edit
                          ? <>This cadet has a portal account. <strong>Name, rank, position, and company</strong> are locked — contact Battalion S1 to change those. You can freely update <strong>LET level, gender, platoon, squad, and notes</strong>.</>
                          : <>This cadet's name, rank, position, company, and platoon are pulled directly from their portal account — managed by the <strong>Battalion S1</strong>. To change any of these fields, contact S1 who will update it in the Accounts page. Only <strong>notes</strong> can be edited here.</>
                        }
                      </p>
                    </div>
                  </div>
                )}

                {/* LET Level — first field; drives defaults below */}
                <div>
                  <label className={lCls}>LET Level *</label>
                  <select
                    value={form.letLevel}
                    disabled={accountLocked && !canS1Edit}
                    onChange={accountLocked && !canS1Edit ? undefined : e => {
                      const lvl = e.target.value;
                      setForm(f => ({
                        ...f,
                        letLevel: lvl,
                        // LET 1 → lock position to Squad Member if none set yet
                        ...(!f.position && lvl === 'LET 1' ? { position: 'Squad Member' } : {}),
                      }));
                    }}
                    className={`${iCls} ${accountLocked && !canS1Edit ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <option value="">— Select —</option>
                    {LET_LEVELS.map(l => <option key={l}>{l}</option>)}
                  </select>
                  {form.letLevel === 'LET 1' && (
                    <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                      LET 1 cadets default to Squad Member — change below if needed.
                    </p>
                  )}
                </div>

                {/* Full Name — locked for S1 assistants and for linked account entries */}
                {(() => {
                  const nameLocked = (canS1Edit && !!editingId) || accountLocked;
                  return (
                    <div>
                      <label className={lCls}>
                        Full Name * (LAST, FIRST)
                        {nameLocked && (
                          <span className="ml-2 text-slate-400 normal-case tracking-normal font-bold">— contact staff to change</span>
                        )}
                      </label>
                      <input
                        required
                        type="text"
                        value={form.fullName}
                        readOnly={nameLocked}
                        onChange={nameLocked ? undefined : e => setForm(f => ({ ...f, fullName: e.target.value }))}
                        placeholder="DOE, JOHN"
                        className={`${iCls} ${nameLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                      />
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-4">
                  {/* Rank — locked for linked-account entries (account is master) and for
                      company-level officers on existing entries (Firestore rank/position lock). */}
                  {(() => {
                    // v1.6.61: rank lock temporarily removed — company leadership
                    // needs to assign ranks during initial roster setup.
                    const rankLocked = accountLocked;
                    return (
                      <div>
                        <label className={lCls}>
                          Rank
                          {rankLocked && (
                            <span className="ml-2 text-slate-400 normal-case tracking-normal font-bold">— contact staff to change</span>
                          )}
                        </label>
                        <select
                          value={form.rank}
                          disabled={rankLocked}
                          onChange={rankLocked ? undefined : e => setForm(f => ({ ...f, rank: e.target.value }))}
                          className={`${iCls} ${rankLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <option value="">— Select —</option>
                          {JROTC_RANKS.map(r => <option key={r}>{r}</option>)}
                        </select>
                        {!rankLocked && (() => {
                          const authRank = POSITION_RANKS[form.position] || '';
                          const isOver   = authRank && form.rank && rankExceedsMax(form.rank, form.position);
                          const isUnder  = authRank && form.rank && !isOver && form.rank !== authRank;
                          return (
                            <>
                              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                                Must reflect the cadet's current issued uniform rank — not a desired or future rank.
                              </p>
                              {authRank && (
                                <p className={`mt-0.5 text-[10px] font-bold flex items-center flex-wrap gap-1.5 ${isOver ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>
                                  {isOver
                                    ? <span className="font-black">⛔ OVER RANK — max for this position is {authRank}.</span>
                                    : <><span>Max rank for this position:</span><span className="font-black">{authRank}</span></>
                                  }
                                  {(isOver || isUnder) && (
                                    <button
                                      type="button"
                                      onClick={() => setForm(f => ({ ...f, rank: authRank }))}
                                      className="ml-1 underline underline-offset-2 hover:opacity-70 transition-opacity"
                                    >
                                      Use {authRank}
                                    </button>
                                  )}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    );
                  })()}

                  {/* Gender */}
                  {(() => {
                    const genderLocked = accountLocked && !canS1Edit;
                    return (
                      <div>
                        <label className={lCls}>Gender</label>
                        <select
                          value={form.gender}
                          disabled={genderLocked}
                          onChange={genderLocked ? undefined : e => setForm(f => ({ ...f, gender: e.target.value }))}
                          className={`${iCls} ${genderLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          <option value="">— Select —</option>
                          {GENDERS.map(g => <option key={g}>{g}</option>)}
                        </select>
                      </div>
                    );
                  })()}
                </div>

                {/* Position — three-layer gate:
                    1. Locked entirely when a portal account is linked (account is master).
                    2. When editing an existing entry, only staff (70+) can change position
                       (Firestore's rank/position lock enforces this server-side too).
                    3. Battalion-level positions are hidden from sub-staff even on creates
                       (Firestore create rule enforces the same). */}
                {(() => {
                  // v1.6.61: position lock temporarily removed — see rankLocked note above.
                  const posLocked = accountLocked;
                  return (
                    <div>
                      <label className={lCls}>
                        Position
                        {posLocked && (
                          <span className="ml-2 text-slate-400 normal-case tracking-normal font-bold">— contact staff to change</span>
                        )}
                      </label>
                      <select
                        value={form.position}
                        disabled={posLocked}
                        onChange={posLocked ? undefined : e => {
                          const newPos = e.target.value;
                          const isHqLocked   = COMPANY_HQ_LOCKED_POSITIONS.includes(newPos);
                          const isHqDefault  = COMPANY_HQ_DEFAULT_POSITIONS.includes(newPos);
                          const authRank     = POSITION_RANKS[newPos] || '';
                          setForm(f => ({
                            ...f,
                            position: newPos,
                            // Auto-fill rank when the field is blank and the regulation
                            // specifies an authorized rank for this position.
                            ...(!f.rank && authRank ? { rank: authRank } : {}),
                            // Auto-assign Company HQ platoon for command/staff positions.
                            ...(isHqLocked || isHqDefault ? { platoon: 'Company HQ', squad: '' } : {}),
                          }));
                        }}
                        className={`${iCls} ${posLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <option value="">— Select —</option>
                        {JROTC_POSITIONS
                          .filter(p => canManageAll || !BATTALION_POSITIONS.includes(p))
                          .map(p => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                  );
                })()}

                {/* Special Assignment (secondary position) — staff-only billet held in
                    addition to the primary position (e.g. Company Commander + Raider Team Commander).
                    Only staff (70+) can assign these. */}
                {canManageAll && (
                  <div>
                    <label className={lCls}>Special Assignment <span className="normal-case tracking-normal font-bold text-slate-400">(secondary — optional)</span></label>
                    <select
                      value={form.secondaryPosition}
                      onChange={e => setForm(f => ({ ...f, secondaryPosition: e.target.value }))}
                      className={iCls}
                    >
                      <option value="">— None —</option>
                      {SECONDARY_POSITIONS.map(p => <option key={p}>{p}</option>)}
                    </select>
                    <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                      Held in addition to the primary position above.
                    </p>
                  </div>
                )}

                {/* Company row + conditional platoon/squad or secondary company */}
                <div className="grid grid-cols-3 gap-4">
                  {/* Company — locked for portal-linked entries (account is master) */}
                  <div>
                    <label className={lCls}>Company</label>
                    <input
                      type="text"
                      value={form.company}
                      readOnly={!canManageAll || accountLocked}
                      onChange={(!canManageAll || accountLocked) ? undefined : e => setForm(f => ({ ...f, company: e.target.value }))}
                      className={`${iCls} ${(!canManageAll || accountLocked) ? 'opacity-60 cursor-not-allowed' : ''}`}
                    />
                  </div>

                  {/* Platoon / Squad — hidden for Battalion; locked for portal-linked entries */}
                  {!BATTALION_COMPANIES.includes(form.company) && (
                    <div>
                      <label className={lCls}>
                        Platoon
                        {platoonAutoLocked && !accountLocked && (
                          <span className="ml-2 text-slate-400 normal-case tracking-normal font-bold">— fixed for this position</span>
                        )}
                      </label>
                      {/* Locked when portal account is master OR position forces Company HQ. */}
                      {/* S1 assistants can update platoon even on linked cadets. */}
                      <select
                        value={form.platoon}
                        disabled={(accountLocked && !canS1Edit) || platoonAutoLocked}
                        onChange={(accountLocked && !canS1Edit) || platoonAutoLocked ? undefined : e => {
                          const next = e.target.value;
                          setForm(f => ({
                            ...f,
                            platoon: next,
                            ...(next === 'Company HQ' ? { squad: '' } : {}),
                          }));
                        }}
                        className={`${iCls} ${(accountLocked && !canS1Edit) || platoonAutoLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <option value="">— —</option>
                        {PLATOONS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                  )}

                  {!BATTALION_COMPANIES.includes(form.company) && form.platoon !== 'Company HQ' && (
                    <div>
                      <label className={lCls}>Squad</label>
                      <select
                        value={form.squad}
                        disabled={accountLocked && !canS1Edit}
                        onChange={accountLocked && !canS1Edit ? undefined : e => setForm(f => ({ ...f, squad: e.target.value }))}
                        className={`${iCls} ${accountLocked && !canS1Edit ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <option value="">— —</option>
                        {SQUADS.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Secondary company — only for Battalion */}
                  {BATTALION_COMPANIES.includes(form.company) && (
                    <div className="col-span-2">
                      <label className={lCls}>Class Period Company</label>
                      <select
                        value={form.secondaryCompany}
                        onChange={e => setForm(f => ({ ...f, secondaryCompany: e.target.value }))}
                        className={`${iCls} border-yellow-500/40`}
                      >
                        <option value="">— None —</option>
                        {companies
                          .filter(c => !BATTALION_COMPANIES.includes(c))
                          .map(c => <option key={c} value={c}>{c} Co. (Observer)</option>)}
                      </select>
                    </div>
                  )}
                </div>


                {/* Link to Portal Account */}
                <div>
                  <label className={lCls}>
                    <span className="flex items-center gap-1"><Link2 size={10} /> Link to Portal Account (optional)</span>
                  </label>
                  <select
                    value={form.linkedUid}
                    onChange={e => setForm(f => ({ ...f, linkedUid: e.target.value }))}
                    className={iCls}
                  >
                    <option value="">— No account linked —</option>
                    {portalUsers
                      .filter(u => u.approved && u.fullName)
                      .map(u => (
                        <option key={u.uid} value={u.uid}>
                          {u.fullName}{u.rank ? ` · ${u.rank}` : ''}
                        </option>
                      ))
                    }
                  </select>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 ml-1">
                    Linking shows the portal icon (🔗) on their row.
                  </p>
                </div>

                {/* Sync info — shown when an account is linked.
                    Account page is always the authority; no toggle needed. */}
                {form.linkedUid && (
                  <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-3 flex items-center gap-2">
                    <RefreshCw size={10} className="text-slate-400 shrink-0" />
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                      Saving from the <strong className="text-slate-600 dark:text-slate-300">Accounts page</strong> always updates this entry — the portal account is the source of truth.
                    </p>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className={lCls}>Notes (optional)</label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Any additional notes…"
                    className={`${iCls} resize-none`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {saving
                    ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                    : <><CheckCircle2 size={14} /> {editingId ? 'Save Changes' : 'Add to Roster'}</>
                  }
                </button>
              </form>
            </div>
          </div>
        )}

      {/* ── Delete Confirmation ── */}
        {deleteConf && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="modal-enter bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              {canApproveDeletion
                ? <Trash2 className="mx-auto text-red-500 mb-4" size={32} />
                : <AlertTriangle className="mx-auto text-amber-500 mb-4" size={32} />
              }
              <h3 className="font-black uppercase text-sm tracking-widest text-slate-900 dark:text-white mb-2">
                {canApproveDeletion ? 'Remove from Roster?' : 'Request Removal?'}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                {canApproveDeletion
                  ? <>This removes <strong>{deleteConf.fullName}</strong> from the battalion roster. Their portal account (if any) is not affected.</>
                  : <>A removal request will be sent to the <strong>Battalion S1</strong> for approval. <strong>{deleteConf.fullName}</strong> will remain on the roster until approved.</>
                }
              </p>
              {!canApproveDeletion && (
                <p className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400 tracking-widest mb-4">
                  Requires Battalion S1 sign-off
                </p>
              )}
              <div className="flex gap-3 mt-4">
                <button onClick={() => setDeleteConf(null)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className={`flex-1 py-3 rounded-xl text-white font-black text-xs uppercase transition-all ${
                    canApproveDeletion
                      ? 'bg-red-500 hover:bg-red-600'
                      : 'bg-amber-500 hover:bg-amber-600'
                  }`}
                >
                  {canApproveDeletion ? 'Remove' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        )}

      {/* ── Cadet History Modal ── */}
        {historyEntry && (
          <div
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setHistoryEntry(null)}
          >
            <div className="modal-enter bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
              {/* Header */}
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
                    <History size={18} className="text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Cadet History</p>
                    <h3 className="font-black text-slate-900 dark:text-white">{historyEntry.fullName}</h3>
                  </div>
                </div>
                <button onClick={() => setHistoryEntry(null)} aria-label="Close" className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6">
                {historyLoading ? (
                  <div className="flex items-center gap-3 text-slate-400 py-8">
                    <Loader2 size={18} className="animate-spin" /> Loading history…
                  </div>
                ) : historyRecords.length === 0 ? (
                  <div className="text-center py-12">
                    <History size={32} className="mx-auto text-slate-200 dark:text-slate-700 mb-3" />
                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">No archived records yet</p>
                    <p className="text-xs text-slate-400 mt-1">Year-end archives will appear here.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {historyRecords.map(rec => (
                      <div key={rec.id} className="border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
                        {/* Year header */}
                        <button
                          onClick={() => setHistoryExpanded(historyExpanded === rec.schoolYear ? null : rec.schoolYear)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="font-black text-sm text-slate-900 dark:text-white">{rec.schoolYear}</span>
                            <span className="text-xs text-slate-500">{rec.rank} · {rec.company ? `${normalizeCompany(rec.company)} Co.` : '—'}</span>
                          </div>
                          <ChevronRight size={14} className={`text-slate-400 transition-transform ${historyExpanded === rec.schoolYear ? 'rotate-90' : ''}`} />
                        </button>

                        {/* Expanded details */}
                        {historyExpanded === rec.schoolYear && (
                          <div className="px-4 py-4 space-y-4">
                            {/* Basics */}
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5">Position</p>
                                <p className="text-slate-700 dark:text-slate-200">{rec.position || '—'}</p>
                                {rec.secondaryPosition && (() => {
                                  const tk = teamKeyFromPosition(rec.secondaryPosition);
                                  return tk ? (
                                    <Link to={`/admin/teams?team=${encodeURIComponent(tk)}`} className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold mt-0.5 hover:underline block">
                                      {rec.secondaryPosition}
                                    </Link>
                                  ) : (
                                    <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold mt-0.5">{rec.secondaryPosition}</p>
                                  );
                                })()}
                              </div>
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-0.5 flex items-center gap-1"><BookOpen size={9} /> LET Level</p>
                                <p className="text-slate-700 dark:text-slate-200">{rec.letLevel || '—'}</p>
                              </div>
                            </div>

                            {/* Challenge Scores */}
                            {rec.scores && (
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Trophy size={9} /> Challenge Scores</p>
                                {rec.scores.medicalExempt ? (
                                  <p className="text-xs text-slate-400 italic">Medical exemption</p>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {[
                                      { l: 'Push-Ups',  v: rec.scores.pushUps },
                                      { l: 'Sit-Ups',   v: rec.scores.sitUps },
                                      { l: 'Shuttle',   v: rec.scores.shuttleRun },
                                      { l: '1 Mile',    v: rec.scores.oneMile },
                                      { l: 'S&R',       v: rec.scores.sitNReach },
                                    ].filter(i => i.v != null && i.v !== '').map(({ l, v }) => (
                                      <span key={l} className="inline-flex flex-col items-center bg-slate-100 dark:bg-white/5 rounded-xl px-3 py-1.5 min-w-[52px]">
                                        <span className="text-[9px] font-black uppercase text-slate-400 tracking-wide">{l}</span>
                                        <span className="text-sm font-black text-slate-800 dark:text-slate-200">{v}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Awards */}
                            {rec.awards && (
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><Trophy size={9} /> Awards</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300">{rec.awards}</p>
                              </div>
                            )}

                            {/* Camp */}
                            {rec.campNotes && (
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><Tent size={9} /> Camp Attendance</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300">{rec.campNotes}</p>
                              </div>
                            )}

                            <p className="text-[10px] text-slate-400">Archived {rec.archivedByName ? `by ${rec.archivedByName}` : ''} · {rec.archivedAt?.toDate ? rec.archivedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      {/* ── Graduate Confirmation ── */}
        {graduateConf && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="modal-enter bg-white dark:bg-slate-900 border border-green-200 dark:border-green-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <GraduationCap className="mx-auto text-rose-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest text-slate-900 dark:text-white mb-2">Graduate &amp; Remove?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                <strong>{graduateConf.fullName}</strong> will be permanently removed from the roster and all associated records will be deleted. <span className="text-rose-500 font-bold">This cannot be undone.</span>
              </p>
              <div className="flex gap-3">
                <button onClick={() => setGraduateConf(null)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button onClick={handleGraduate} disabled={graduating} className="flex-1 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-black text-xs uppercase transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                  {graduating && <Loader2 size={12} className="animate-spin" />} Remove
                </button>
              </div>
            </div>
          </div>
        )}

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-2xl shadow-xl z-50 ${
              toast.isError
                ? 'bg-rose-600 text-white'
                : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminRoster;
