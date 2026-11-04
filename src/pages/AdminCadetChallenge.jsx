// src/pages/AdminCadetChallenge.jsx
//
// Cadet Challenge physical fitness records — cycle-based management.
//
// Three cycles per year (#1, #2, #3). Each cycle tracks per-company status:
//   open → submitted (finalized by company S1 assistant) → locked (verified by Bn S1)
//
// Events:  Push-Ups (int), Sit-Ups (int), Shuttle Run (decimal sec),
//          One Mile (MM:SS string), Sit-N-Reach (decimal cm)
// Medical exemption checkbox per cadet — no reason required.
//
// Role access matrix:
//   INPUT  : company_s1_assistant, company_s3_assistant,
//             company_xo, company_1sg, company_commander  (own company only)
//   FINALIZE: company_s1_assistant  (own company, cycle must be open)
//   VIEW company: all INPUT roles + s1_adjutant (their company) + own records for cadets
//   VIEW all: s1_adjutant, s3_operations, battalion_xo, battalion_commander,
//             battalion_csm, sergeant_major, senior_army_instructor, army_instructor
//   UNLOCK/SEND-BACK: s1_adjutant only

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db, auth } from '../firebase';
import {
  collection, doc, setDoc, addDoc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { useCompanies } from '../hooks/useCompanies';
import { ROLE_HIERARCHY, ROLE_LABELS } from '../constants';
import {
  Activity, Plus, Trash2, Edit3, X, Loader2, CheckCircle2,
  Lock, Unlock, RotateCcw, Send, AlertTriangle, Shield,
  ChevronDown, Filter, ClipboardList, GraduationCap, Award, Download, BarChart2, Printer,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import { groupByLet } from '../utils/groupByLet';
import { normalizeCompany } from '../utils/normalizeCompany';
import { exportCSV } from '../utils/exportCSV';
import { printRoster } from '../utils/printRoster';

// ── Constants ──────────────────────────────────────────────────────────────────

const CYCLES = [1, 2, 3];
// Roster entries stored under any of these company values are Battalion/HQ members.
const BATTALION_COMPANIES = ['Battalion', 'Zulu'];

// Roles that can input records (company-level command + assistants).
// company_master_sergeant has edit access here specifically —
// all other pages are view-only for that role.
const INPUT_ROLES = [
  'company_s1_assistant', 'company_s3_assistant',
  'company_xo', 'company_1sg', 'company_commander',
  'company_master_sergeant',
];

// Only company S1 assistants can finalize
const FINALIZE_ROLES = [
  'company_master_sergeant',
  'company_s1_assistant',
  'company_s3_assistant',
  'company_xo',
];

// Battalion-level roles that can see all companies
const VIEW_ALL_ROLES = [
  's1_adjutant', 's3_operations', 'battalion_xo',
  'battalion_commander', 'battalion_csm', 'sergeant_major',
  'senior_army_instructor', 'army_instructor',
];

// Battalion S1 or Battalion S3 can unlock / send back
const UNLOCK_ROLES = ['s1_adjutant', 's3_operations'];

// S1, S3, and Battalion XO can open a cycle so company leadership can enter data.
// Cycles start CLOSED — no data entry until one of these roles opens it.
const OPEN_ROLES = ['s1_adjutant', 's3_operations', 'battalion_xo'];

const ADMIN_LEVEL   = 80;
const STAFF_LEVEL   = 70;
const COMMAND_LEVEL = 45;

// ── Helpers ────────────────────────────────────────────────────────────────────

const ic = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const lc = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

const EMPTY_FORM = {
  cadetId: '', cadetName: '',
  pushUps: '', sitUps: '',
  shuttleRun: '', oneMile: '', sitNReach: '',
  medicalExempt: false,
  exemptEvents: [],   // per-event exemptions (subset of EVENTS keys)
};

function cycleKey(company, cycleNum) { return `${company}_${cycleNum}`; }

function statusColor(status) {
  if (status === 'locked')    return 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20';
  if (status === 'submitted') return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
  if (status === 'closed')    return 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10';
  return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20';
}

function statusLabel(status) {
  if (status === 'locked')    return 'Locked';
  if (status === 'submitted') return 'Submitted';
  if (status === 'closed')    return 'Closed';
  return 'Open';
}

// ── Ribbon Qualification Standards ─────────────────────────────────────────────
// Source: JROTC Cadet Challenge norm tables.
// Arrays indexed by age 13–17 (index 0–4).
// LET level → age: LET 1→14, LET 2→15, LET 3→16, LET 4→17 (default 15).
// shuttleRun and oneMile: LOWER is better. All others: HIGHER is better.

const STANDARDS_85 = {
  M: {
    sitUps:     [53, 56, 57, 56, 55],
    pushUps:    [39, 40, 42, 44, 53],
    shuttleRun: [9.5, 9.1, 9.0, 8.7, 8.7],
    oneMile:    ['6:50', '6:26', '6:20', '6:08', '6:06'],
    sitNReach:  [33, 36, 37, 38, 41],
  },
  F: {
    sitUps:     [46, 47, 48, 45, 44],
    pushUps:    [21, 20, 20, 24, 25],
    shuttleRun: [10.2, 10.1, 10.0, 10.1, 10.0],
    oneMile:    ['8:13', '7:59', '8:08', '8:23', '8:15'],
    sitNReach:  [38, 40, 43, 42, 42],
  },
};

const STANDARDS_50 = {
  M: {
    sitUps:     [42, 45, 45, 45, 44],
    pushUps:    [24, 24, 30, 30, 37],
    shuttleRun: [10.2, 9.9, 9.7, 9.4, 9.4],
    oneMile:    ['8:06', '7:44', '7:30', '7:10', '7:04'],
    sitNReach:  [26, 28, 30, 30, 34],
  },
  F: {
    sitUps:     [37, 37, 36, 35, 34],
    pushUps:    [11, 10, 15, 12, 16],
    shuttleRun: [11.1, 11.2, 11.0, 10.9, 11.0],
    oneMile:    ['10:23', '10:06', '9:58', '10:31', '10:22'],
    sitNReach:  [31, 33, 36, 34, 35],
  },
};

// LET level string → expected age (clamped 13–17).
function letToAge(letStr) {
  const n = parseInt((letStr || '').replace(/\D/g, ''), 10);
  if (n === 1) return 14;
  if (n === 2) return 15;
  if (n === 3) return 16;
  if (n === 4) return 17;
  return 15;
}

// Parse 'MM:SS' string → total seconds.
function parseTimeToSecs(str) {
  if (!str) return Infinity;
  const parts = String(str).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

// Returns 'athletic' (85th pct, N-2-3), 'physical_fitness' (50th pct, N-2-2), or null.
// cadet should have .gender ('Male'/'Female') and .letLevel ('LET 1'–'LET 4').
function evalRibbon(rec, cadet) {
  if (!rec || rec.medicalExempt) return null;
  const gender   = cadet?.gender === 'Female' ? 'F' : 'M';
  const ageIdx   = Math.max(0, Math.min(4, letToAge(cadet?.letLevel || 'LET 2') - 13));
  const exemptEvs = rec.exemptEvents || [];

  function meets(stdTable) {
    const std = stdTable[gender];
    let atLeastOne = false;
    for (const ev of ['pushUps', 'sitUps', 'shuttleRun', 'oneMile', 'sitNReach']) {
      if (exemptEvs.includes(ev)) continue;
      const val = rec[ev];
      if (val === null || val === undefined || val === '') return false;
      atLeastOne = true;
      const threshold = std[ev][ageIdx];
      if (ev === 'oneMile') {
        if (parseTimeToSecs(String(val)) > parseTimeToSecs(String(threshold))) return false;
      } else if (ev === 'shuttleRun') {
        if (parseFloat(val) > parseFloat(threshold)) return false;
      } else {
        if (parseFloat(val) < parseFloat(threshold)) return false;
      }
    }
    return atLeastOne;
  }

  if (meets(STANDARDS_85)) return 'athletic';
  if (meets(STANDARDS_50)) return 'physical_fitness';
  return null;
}

// ── Main component ─────────────────────────────────────────────────────────────

const AdminCadetChallenge = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const { companies } = useCompanies();

  const userLevel   = ROLE_HIERARCHY[role] || 0;
  const canViewAll  = VIEW_ALL_ROLES.includes(role) || userLevel >= STAFF_LEVEL;
  const canInput    = INPUT_ROLES.includes(role) || userLevel >= COMMAND_LEVEL;
  const canFinalize = FINALIZE_ROLES.includes(role);
  const canUnlock   = UNLOCK_ROLES.includes(role);
  // S1, S3, XO (and admins) can open a closed cycle so company roles can enter data.
  const canOpen     = OPEN_ROLES.includes(role) || userLevel >= ADMIN_LEVEL;
  const myCompany   = userData?.company || '';

  // Which companies to display in the cycle-status subscription.
  // Always include myCompany even if it's not in the admin-configured companies list
  // (Battalion is not a lettered company and won't appear in that list).
  const visibleCompanies = useMemo(() => {
    if (!canViewAll) return myCompany ? [myCompany] : [];
    const extra = myCompany && !companies.includes(myCompany) ? [myCompany] : [];
    return [...extra, ...companies];
  }, [canViewAll, companies, myCompany]);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedCycle,   setSelectedCycle]   = useState(1);
  const [filterCompany,   setFilterCompany]    = useState('');         // staff filter
  const [groupLet,        setGroupLet]         = useState(false);
  const [pageTab,         setPageTab]         = useState('records');  // 'records' | 'contenders'
  // Default Battalion S1 (canViewAll) to their own company so they immediately
  // see their own table + cycle status + action buttons on first load.
  const initFilterRef = useRef(false);
  useEffect(() => {
    if (!initFilterRef.current && canViewAll && myCompany) {
      setFilterCompany(myCompany);
      initFilterRef.current = true;
    }
  }, [canViewAll, myCompany]);
  const [showModal,       setShowModal]        = useState(false);
  const [editingRecord,   setEditingRecord]    = useState(null);       // { id, ...record } or null
  const [form,            setForm]             = useState(EMPTY_FORM);
  const [saving,          setSaving]           = useState(false);
  const [deleteConf,      setDeleteConf]       = useState(null);
  const [toast,           setToast]            = useState(null);
  const [finalizeConf,    setFinalizeConf]     = useState(null);       // company name
  const [finalizing,      setFinalizing]       = useState(false);
  const [sendBackConf,    setSendBackConf]     = useState(null);       // { company }
  const [sendBackNote,    setSendBackNote]     = useState('');
  const [sendingBack,     setSendingBack]      = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────────
  const [cycleStatuses, setCycleStatuses]   = useState({});   // { "Alpha_1": { status, ... } }
  const [records,       setRecords]         = useState([]);   // primary-company records for selected cycle
  const [bnRecordsRaw,  setBnRecordsRaw]    = useState([]);   // ALL cycles' records for battalion members who observe myCompany
  const [cadets,        setCadets]          = useState([]);   // primary-company roster members
  const [bnCadets,      setBnCadets]        = useState([]);   // battalion members whose secondaryCompany == target
  const [dataLoading,   setDataLoading]     = useState(true);
  const [allRosterMap,  setAllRosterMap]    = useState({});   // docId → rosterData for ribbon eval across all companies

  // ── Print options state ───────────────────────────────────────────────────────
  const [showPrintOptions,   setShowPrintOptions]   = useState(false);
  const [printChallengeCols, setPrintChallengeCols] = useState(['pushUps', 'sitUps', 'shuttleRun', 'oneMile', 'sitNReach']);

  // ── Personal-view state (users without input/view access) ─────────────────────
  const [myRosterDocId,     setMyRosterDocId]     = useState(null);
  const [myRosterDocLoaded, setMyRosterDocLoaded] = useState(false);
  const [myPersonalRecords, setMyPersonalRecords] = useState([]);
  const [myPersonalLoading, setMyPersonalLoading] = useState(true);

  // The active company for queries (staff filter, or the user's own company)
  const targetCompany = filterCompany || myCompany;

  // Merge primary cadets + battalion observers, deduped by uid, sorted by name
  const allCadets = useMemo(() => {
    const seen = new Set(cadets.map(c => c.uid));
    return [...cadets, ...bnCadets.filter(c => !seen.has(c.uid))]
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
  }, [cadets, bnCadets]);

  // Cycle-filtered battalion-member records, merged with primary records, deduped by id
  const allRecords = useMemo(() => {
    const bnFiltered = bnRecordsRaw.filter(r => r.cycleNumber === selectedCycle);
    const seen = new Set(records.map(r => r.id));
    return [...records, ...bnFiltered.filter(r => !seen.has(r.id))];
  }, [records, bnRecordsRaw, selectedCycle]);

  // Subscribe to cycle status docs for the selected cycle
  useEffect(() => {
    if (authLoading || !visibleCompanies.length) { setDataLoading(false); return; }

    const unsubs = visibleCompanies.map(company => {
      const key = cycleKey(company, selectedCycle);
      const docRef = doc(db, 'cadetChallengeCycles', key);
      return onSnapshot(docRef, snap => {
        setCycleStatuses(prev => ({
          ...prev,
          [key]: snap.exists() ? snap.data() : { status: 'closed' },
        }));
      });
    });

    return () => unsubs.forEach(u => u());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, selectedCycle, companies.join(','), canViewAll, myCompany]);

  // Subscribe to records for the selected cycle
  useEffect(() => {
    if (authLoading) return;
    setDataLoading(true);

    let q;
    if (canViewAll) {
      q = query(
        collection(db, 'cadetChallengeRecords'),
        where('cycleNumber', '==', selectedCycle),
        orderBy('cadetName', 'asc'),
      );
    } else if (canInput && myCompany) {
      q = query(
        collection(db, 'cadetChallengeRecords'),
        where('cycleNumber', '==', selectedCycle),
        where('company', '==', myCompany),
        orderBy('cadetName', 'asc'),
      );
    } else {
      setRecords([]);
      setDataLoading(false);
      return;
    }

    const unsub = onSnapshot(q, snap => {
      setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setDataLoading(false);
    }, () => setDataLoading(false));

    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, selectedCycle, role, myCompany]);

  // Load cadets for company from the Roster (source of truth for all cadets,
  // regardless of whether they have a portal account). Using roster instead
  // of the users collection means every cadet in the company appears in the
  // table — not just those who have signed up to the portal.
  useEffect(() => {
    if (!myCompany && !canViewAll) return;
    if (!targetCompany) { setCadets([]); return; }

    // When filtering for Battalion, include legacy 'Zulu' records too.
    const companyFilter = BATTALION_COMPANIES.includes(targetCompany)
      ? BATTALION_COMPANIES
      : [targetCompany];
    const q = query(
      collection(db, 'roster'),
      where('company', 'in', companyFilter),
      orderBy('fullName', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      // Use the roster doc ID as `uid` so the rest of the component
      // (record keying, quick-save, medical toggle) works unchanged.
      setCadets(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [myCompany, canViewAll, filterCompany, targetCompany]);

  // Load battalion members who observe the target company (secondaryCompany match).
  // These cadets appear in BOTH their primary company tab AND this secondary tab.
  useEffect(() => {
    if (!targetCompany) { setBnCadets([]); return; }

    const q = query(
      collection(db, 'roster'),
      where('secondaryCompany', '==', targetCompany),
      orderBy('fullName', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      setBnCadets(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    }, () => setBnCadets([]));
    return () => unsub();
  }, [targetCompany]);

  // Load ALL-cycles records for battalion members who observe myCompany.
  // This is needed so company S1 assistants can see/edit battalion observers' records
  // even though those records are stored under the battalion member's primary company.
  // Only runs for company-level users (canInput && !canViewAll) because canViewAll
  // users already get all records in the primary records subscription above.
  useEffect(() => {
    if (!myCompany || canViewAll || !canInput) { setBnRecordsRaw([]); return; }

    const q = query(
      collection(db, 'cadetChallengeRecords'),
      where('secondaryCompany', '==', myCompany),
    );
    const unsub = onSnapshot(q, snap => {
      setBnRecordsRaw(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setBnRecordsRaw([]));
    return () => unsub();
  }, [myCompany, canViewAll, canInput]);

  // Load all roster data for canViewAll users so we can evaluate ribbon qualifications
  // across every company in the all-companies view (no filter active).
  useEffect(() => {
    if (!canViewAll) { setAllRosterMap({}); return; }
    const unsub = onSnapshot(collection(db, 'roster'), snap => {
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      setAllRosterMap(map);
    }, () => {});
    return () => unsub();
  }, [canViewAll]);

  // ── Personal-view effects ─────────────────────────────────────────────────────
  // Step 1: find the user's roster doc by linkedUid
  useEffect(() => {
    if (canInput || canViewAll || authLoading || !user) return;
    getDocs(query(collection(db, 'roster'), where('linkedUid', '==', user.uid)))
      .then(snap => {
        setMyRosterDocId(snap.empty ? null : snap.docs[0].id);
        setMyRosterDocLoaded(true);
      })
      .catch(() => setMyRosterDocLoaded(true));
  }, [canInput, canViewAll, authLoading, user]);

  // Step 2: subscribe to all of the user's records across every cycle
  useEffect(() => {
    if (canInput || canViewAll || !myRosterDocLoaded) return;
    setMyPersonalLoading(true);
    let q;
    if (myRosterDocId) {
      q = query(collection(db, 'cadetChallengeRecords'), where('cadetId', '==', myRosterDocId));
    } else if (userData?.fullName) {
      q = query(collection(db, 'cadetChallengeRecords'), where('cadetName', '==', userData.fullName));
    } else {
      setMyPersonalRecords([]);
      setMyPersonalLoading(false);
      return;
    }
    const unsub = onSnapshot(q, snap => {
      const recs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.cycleNumber || 0) - (b.cycleNumber || 0));
      setMyPersonalRecords(recs);
      setMyPersonalLoading(false);
    }, () => setMyPersonalLoading(false));
    return () => unsub();
  }, [canInput, canViewAll, myRosterDocId, myRosterDocLoaded, userData?.fullName]);

  // ── Toast helper ─────────────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Modal helpers ─────────────────────────────────────────────────────────────
  const openCreate = (cadetUid = '', cadetName = '') => {
    setForm({
      ...EMPTY_FORM,
      cadetId: cadetUid,
      cadetName,
    });
    setEditingRecord(null);
    setShowModal(true);
  };

  const openEdit = (rec) => {
    setForm({
      cadetId:      rec.cadetId      || '',
      cadetName:    rec.cadetName    || '',
      pushUps:      rec.pushUps      ?? '',
      sitUps:       rec.sitUps       ?? '',
      shuttleRun:   rec.shuttleRun   ?? '',
      oneMile:      rec.oneMile      || '',
      sitNReach:    rec.sitNReach    ?? '',
      medicalExempt: rec.medicalExempt || false,
      exemptEvents:  rec.exemptEvents  || [],
    });
    setEditingRecord(rec);
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditingRecord(null); setForm(EMPTY_FORM); };

  // ── Current company for forms ────────────────────────────────────────────────
  const activeCompany = filterCompany || myCompany;
  const activeKey     = cycleKey(activeCompany, selectedCycle);
  const activeCycle   = cycleStatuses[activeKey] || { status: 'closed' };
  const isLocked      = activeCycle.status === 'locked';
  const isSubmitted   = activeCycle.status === 'submitted';
  const isClosed      = activeCycle.status === 'closed';
  // Company-level roles cannot edit when cycle is closed; canViewAll (S1/S3/XO) always can edit open cycles
  const canEdit       = canInput && !isLocked && !(isSubmitted && !canUnlock) && !(isClosed && !canViewAll);

  // Records for the currently viewed company.
  // Include records where the cadet's PRIMARY company matches (normal case) OR
  // where secondaryCompany matches (battalion members observing this company).
  const companyRecords = useMemo(() => {
    if (canViewAll && !filterCompany) return allRecords;
    const isBn = BATTALION_COMPANIES.includes(activeCompany);
    return allRecords.filter(r =>
      (isBn ? BATTALION_COMPANIES.includes(r.company) : r.company === activeCompany)
      || r.secondaryCompany === activeCompany
    );
  }, [allRecords, activeCompany, canViewAll, filterCompany]);

  // Map cadetId → record for table view
  const recordMap = useMemo(() => {
    const map = {};
    companyRecords.forEach(r => { if (r.cadetId) map[r.cadetId] = r; });
    return map;
  }, [companyRecords]);

  // Per-event company averages for non-exempt cadets in the current cycle view.
  const avgStats = useMemo(() => {
    const nonExempt = companyRecords.filter(r => !r.medicalExempt);
    const n = nonExempt.length;
    if (!n) return { n: 0 };

    const numAvg = (key, dec) => {
      const vals = nonExempt.map(r => parseFloat(r[key])).filter(v => !isNaN(v));
      if (!vals.length) return null;
      return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(dec);
    };

    const mileSeconds = nonExempt.map(r => {
      const s = r.oneMile;
      if (!s) return null;
      const m = String(s).match(/^(\d+):(\d{2})$/);
      if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
      const p = parseFloat(s);
      return isNaN(p) ? null : p;
    }).filter(v => v !== null);

    const mileAvg = mileSeconds.length
      ? mileSeconds.reduce((a, b) => a + b, 0) / mileSeconds.length
      : null;

    const fmtMile = secs => {
      if (secs == null) return null;
      const mm = Math.floor(secs / 60);
      const ss = Math.round(secs % 60);
      return `${mm}:${String(ss).padStart(2, '0')}`;
    };

    return {
      n,
      pushUps:    numAvg('pushUps',    1),
      sitUps:     numAvg('sitUps',     1),
      shuttleRun: numAvg('shuttleRun', 2),
      oneMile:    fmtMile(mileAvg),
      sitNReach:  numAvg('sitNReach',  1),
    };
  }, [companyRecords]);

  // Ribbon qualification list — works for both single-company and all-companies views.
  // Each entry: { name, company } so we can show a company tag in the all-companies view.
  const allRibbonQuals = useMemo(() => {
    const athletic = [];
    const physFit  = [];

    if (canViewAll && !filterCompany) {
      // All-companies overview: evaluate using full roster map + all records
      allRecords.forEach(rec => {
        if (!rec.cadetId || rec.medicalExempt) return;
        const ribbon = evalRibbon(rec, allRosterMap[rec.cadetId] || {});
        if (ribbon === 'athletic')              athletic.push({ name: rec.cadetName, company: rec.company || '' });
        else if (ribbon === 'physical_fitness') physFit.push({ name: rec.cadetName, company: rec.company || '' });
      });
    } else {
      // Single-company view: cadets already have gender + letLevel from the roster subscription
      [...cadets, ...bnCadets].forEach(cadet => {
        const rec    = recordMap[cadet.uid];
        const ribbon = evalRibbon(rec, cadet);
        if (ribbon === 'athletic')              athletic.push({ name: cadet.fullName, company: cadet.company || activeCompany });
        else if (ribbon === 'physical_fitness') physFit.push({ name: cadet.fullName, company: cadet.company || activeCompany });
      });
    }

    athletic.sort((a, b) => a.name.localeCompare(b.name));
    physFit.sort( (a, b) => a.name.localeCompare(b.name));
    return { athletic, physFit };
  }, [canViewAll, filterCompany, allRecords, allRosterMap, cadets, bnCadets, recordMap, activeCompany]);

  // ── Cycle completion stats ───────────────────────────────────────────────────
  // Total cadets in the company roster vs. cadets who have completed all five
  // events (or are medically exempt). Only computed when the cycle is active
  // (open, submitted, or locked — not closed).
  const cycleStats = useMemo(() => {
    if (isClosed) return null;
    // Only meaningful in single-company view (company users or filtered staff)
    if (canViewAll && !filterCompany) return null;
    const allCadets = [...cadets, ...bnCadets];
    const total = allCadets.length;
    const completed = allCadets.filter(cadet => {
      const rec = recordMap[cadet.uid];
      if (!rec) return false;
      if (rec.medicalExempt) return true;
      return (
        (rec.pushUps    != null && rec.pushUps    !== '') &&
        (rec.sitUps     != null && rec.sitUps     !== '') &&
        (rec.shuttleRun != null && rec.shuttleRun !== '') &&
        (rec.oneMile    != null && rec.oneMile    !== '') &&
        (rec.sitNReach  != null && rec.sitNReach  !== '')
      );
    }).length;
    return { total, completed };
  }, [isClosed, canViewAll, filterCompany, cadets, bnCadets, recordMap]);

  // ── Top-contenders breakdown (used by the Contenders tab) ───────────────────
  const CONTENDER_EVENTS = [
    { key: 'pushUps',    label: 'Push-Ups',     unit: 'reps', asc: false },
    { key: 'sitUps',     label: 'Sit-Ups',      unit: 'reps', asc: false },
    { key: 'shuttleRun', label: 'Shuttle Run',  unit: 's',    asc: true  },
    { key: 'oneMile',    label: 'One-Mile Run', unit: '',      asc: true  },
    { key: 'sitNReach',  label: 'Sit-N-Reach',  unit: 'cm',   asc: false },
  ];

  const contenders = useMemo(() => {
    const entries = [];
    if (canViewAll && !filterCompany) {
      allRecords.forEach(rec => {
        if (rec.medicalExempt) return;
        const roster = allRosterMap[rec.cadetId] || {};
        entries.push({ name: rec.cadetName, gender: roster.gender || '', company: rec.company || '', rec });
      });
    } else {
      // Build gender map from primary cadets only; also track battalion observers to exclude them.
      const gmap = {};
      cadets.forEach(c => { gmap[c.uid] = c.gender || ''; });
      const bnUids = new Set(bnCadets.map(c => c.uid));
      companyRecords.forEach(rec => {
        if (rec.medicalExempt) return;
        if (bnUids.has(rec.cadetId)) return; // exclude battalion leadership observers
        entries.push({ name: rec.cadetName, gender: gmap[rec.cadetId] || '', company: rec.company || activeCompany, rec });
      });
    }
    return CONTENDER_EVENTS.map(evt => {
      const withVal = entries.map(e => {
        const v = e.rec[evt.key];
        if (v === null || v === undefined || v === '') return null;
        const num = evt.key === 'oneMile' ? parseTimeToSecs(String(v)) : parseFloat(v);
        return isNaN(num) ? null : { ...e, _val: num };
      }).filter(Boolean);
      const sorted = [...withVal].sort((a, b) => evt.asc ? a._val - b._val : b._val - a._val);
      return {
        ...evt,
        males:   sorted.filter(e => e.gender === 'Male').slice(0, 5),
        females: sorted.filter(e => e.gender === 'Female').slice(0, 5),
      };
    });
  }, [canViewAll, filterCompany, allRecords, allRosterMap, companyRecords, cadets, bnCadets, activeCompany]);

  // ── Cadet Challenge roster print ─────────────────────────────────────────────
  const CHALLENGE_PRINT_COL_DEFS = [
    { key: 'pushUps',    label: 'Push-Ups',    getValue: c => { const r = recordMap[c.uid]; return r?.pushUps    ?? ''; } },
    { key: 'sitUps',     label: 'Sit-Ups',     getValue: c => { const r = recordMap[c.uid]; return r?.sitUps     ?? ''; } },
    { key: 'shuttleRun', label: 'Shuttle Run', getValue: c => { const r = recordMap[c.uid]; return r?.shuttleRun ?? ''; } },
    { key: 'oneMile',    label: 'One-Mile',    getValue: c => { const r = recordMap[c.uid]; return r?.oneMile    ?? ''; } },
    { key: 'sitNReach',  label: 'Sit-N-Reach', getValue: c => { const r = recordMap[c.uid]; return r?.sitNReach  ?? ''; } },
    { key: 'blank',      label: '',            getValue: () => '' },
  ];

  const handlePrintChallengeRoster = () => {
    const selectedColDefs = CHALLENGE_PRINT_COL_DEFS.filter(d => printChallengeCols.includes(d.key));
    const cols = selectedColDefs.length > 0 ? selectedColDefs : null;
    const co = filterCompany || activeCompany;
    printRoster(allCadets, `${co} Company – Cycle #${selectedCycle}`, cols ? { columns: cols } : undefined);
    setShowPrintOptions(false);
  };

  const handleExportChallenge = () => {
    const rows = companyRecords.map(r => ({
      cadetName: r.cadetName || '',
      company: r.company || activeCompany || '',
      cycle: selectedCycle,
      pushUps: r.pushUps ?? '',
      sitUps: r.sitUps ?? '',
      shuttleRun: r.shuttleRun ?? '',
      oneMile: r.oneMile ?? '',
      sitNReach: r.sitNReach ?? '',
      gender: r.gender || '',
      medicalExempt: r.medicalExempt ? 'Yes' : 'No',
    }));
    const company = (filterCompany || activeCompany || 'all').toLowerCase().replace(/\s+/g, '_');
    exportCSV(rows, `cadet_challenge_${company}_cycle${selectedCycle}_${new Date().toISOString().slice(0,10)}.csv`, [
      { key: 'cadetName',    label: 'Cadet Name' },
      { key: 'company',      label: 'Company' },
      { key: 'cycle',        label: 'Cycle' },
      { key: 'gender',       label: 'Gender' },
      { key: 'pushUps',      label: 'Push-Ups' },
      { key: 'sitUps',       label: 'Sit-Ups' },
      { key: 'shuttleRun',   label: 'Shuttle Run (s)' },
      { key: 'oneMile',      label: 'One Mile' },
      { key: 'sitNReach',    label: 'Sit-and-Reach (cm)' },
      { key: 'medicalExempt', label: 'Medical Exempt' },
    ]);
  };

  // ── Save record ───────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.cadetName.trim() && !form.cadetId) { showToast('Select or enter a cadet name.'); return; }
    if (!activeCompany) { showToast('Company not determined.'); return; }
    setSaving(true);
    try {
      // If the selected cadet is a battalion member (has a secondaryCompany in their
      // roster record), the record is stored under their PRIMARY company — not the
      // company currently being viewed. This keeps one canonical record per cadet per
      // cycle while still making it visible from the secondary-company tab.
      const cadetRosterEntry = allCadets.find(c => c.uid === form.cadetId);
      const recordCompany    = cadetRosterEntry?.company || activeCompany;
      const secondaryCompany = cadetRosterEntry?.secondaryCompany || null;

      const payload = {
        company:          recordCompany,
        ...(secondaryCompany ? { secondaryCompany } : {}),
        cycleNumber:      selectedCycle,
        cadetId:          form.cadetId   || 'manual',
        cadetName:        form.cadetName.trim(),
        // linkedUid lets Firestore rules gate personal reads by the cadet's own
        // Auth UID without a 2-hop join through the roster collection.
        linkedUid:        cadetRosterEntry?.linkedUid || null,
        pushUps:       (form.medicalExempt || form.exemptEvents.includes('pushUps'))    ? null : (form.pushUps   !== '' ? Number(form.pushUps)   : null),
        sitUps:        (form.medicalExempt || form.exemptEvents.includes('sitUps'))     ? null : (form.sitUps    !== '' ? Number(form.sitUps)    : null),
        shuttleRun:    (form.medicalExempt || form.exemptEvents.includes('shuttleRun')) ? null : (form.shuttleRun !== '' ? parseFloat(form.shuttleRun) : null),
        oneMile:       (form.medicalExempt || form.exemptEvents.includes('oneMile'))    ? null : (form.oneMile.trim()  || null),
        sitNReach:     (form.medicalExempt || form.exemptEvents.includes('sitNReach'))  ? null : (form.sitNReach !== '' ? parseFloat(form.sitNReach) : null),
        medicalExempt: form.medicalExempt,
        exemptEvents:  form.medicalExempt ? [] : (form.exemptEvents || []),
        enteredByUid:  user.uid,
        enteredByName: userData?.fullName || '',
        updatedAt:     serverTimestamp(),
      };

      if (editingRecord) {
        await updateDoc(doc(db, 'cadetChallengeRecords', editingRecord.id), payload);
        showToast('Record updated');
      } else {
        // Use cadetId as doc ID if available (prevents duplicates per cadet per cycle).
        // Use the cadet's primary company in the docId so battalion members always
        // map to the same doc regardless of which company tab triggered the save.
        const docId = form.cadetId && form.cadetId !== 'manual'
          ? `${recordCompany}_${selectedCycle}_${form.cadetId}`
          : `${recordCompany}_${selectedCycle}_${Date.now()}`;
        await setDoc(doc(db, 'cadetChallengeRecords', docId), {
          ...payload, createdAt: serverTimestamp(),
        }, { merge: true });
        showToast('Record saved');
      }
      closeModal();
      writeLog({
        type: 'cadet_challenge', action: editingRecord ? 'update' : 'create',
        description: `${editingRecord ? 'Updated' : 'Saved'} CC record for ${form.cadetName} — Cycle #${selectedCycle}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: form.cadetName,
        notes: `cycle:${selectedCycle},company:${recordCompany}`,
      });
    } catch (err) {
      console.error(err);
      showToast('Save failed — try again');
    } finally {
      setSaving(false);
    }
  };

  // Quick-save from table view (inline edit of one field)
  const handleQuickSave = async (cadet, field, value) => {
    const existing = recordMap[cadet.uid];
    // Battalion members have cadet.company = their primary company and
    // cadet.secondaryCompany = the company being viewed. Store records under
    // the primary company so there's one canonical doc per cadet per cycle.
    const recordCompany    = cadet.company || activeCompany;
    const secondaryCompany = cadet.secondaryCompany || null;
    const docId            = `${recordCompany}_${selectedCycle}_${cadet.uid}`;
    try {
      const update = {
        company: recordCompany,
        ...(secondaryCompany ? { secondaryCompany } : {}),
        cycleNumber: selectedCycle,
        cadetId: cadet.uid, cadetName: cadet.fullName,
        enteredByUid: user.uid, enteredByName: userData?.fullName || '',
        updatedAt: serverTimestamp(),
        [field]: value,
      };
      if (!existing) update.createdAt = serverTimestamp();
      await setDoc(doc(db, 'cadetChallengeRecords', docId), update, { merge: true });
      writeLog({
        type: 'cadet_challenge', action: existing ? 'update' : 'create',
        description: `${existing ? 'Updated' : 'Created'} CC record for ${cadet.fullName} (${field}) — Cycle #${selectedCycle}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: cadet.fullName,
        notes: `cycle:${selectedCycle},company:${recordCompany},field:${field}`,
      });
    } catch (err) {
      showToast('Save failed');
      console.error(err);
    }
  };

  const handleMedicalToggle = async (cadet) => {
    const recordCompany    = cadet.company || activeCompany;
    const secondaryCompany = cadet.secondaryCompany || null;
    const docId            = `${recordCompany}_${selectedCycle}_${cadet.uid}`;
    const rec     = recordMap[cadet.uid];
    const current = rec?.medicalExempt || false;
    try {
      await setDoc(doc(db, 'cadetChallengeRecords', docId), {
        company: recordCompany,
        ...(secondaryCompany ? { secondaryCompany } : {}),
        cycleNumber: selectedCycle,
        cadetId: cadet.uid, cadetName: cadet.fullName,
        medicalExempt: !current,
        exemptEvents: [],   // full exemption supersedes per-event list; clear it both ways
        enteredByUid: user.uid, enteredByName: userData?.fullName || '',
        updatedAt: serverTimestamp(),
        ...(!rec ? { createdAt: serverTimestamp() } : {}),
      }, { merge: true });
      writeLog({
        type: 'cadet_challenge', action: 'medical-exempt',
        description: `${!current ? 'Granted' : 'Removed'} full medical exemption for ${cadet.fullName} — Cycle #${selectedCycle}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: cadet.fullName,
        notes: `cycle:${selectedCycle},company:${recordCompany},exempt:${!current}`,
      });
    } catch { showToast('Toggle failed'); }
  };

  const handleEventExemptToggle = async (cadet, eventKey) => {
    const recordCompany    = cadet.company || activeCompany;
    const secondaryCompany = cadet.secondaryCompany || null;
    const docId            = `${recordCompany}_${selectedCycle}_${cadet.uid}`;
    const rec              = recordMap[cadet.uid];
    const current          = rec?.exemptEvents || [];
    const removing         = current.includes(eventKey);
    const newExempts       = removing ? current.filter(k => k !== eventKey) : [...current, eventKey];
    const evLabel          = EVENTS.find(e => e.key === eventKey)?.label || eventKey;
    try {
      await setDoc(doc(db, 'cadetChallengeRecords', docId), {
        company: recordCompany,
        ...(secondaryCompany ? { secondaryCompany } : {}),
        cycleNumber: selectedCycle,
        cadetId: cadet.uid, cadetName: cadet.fullName,
        exemptEvents: newExempts,
        ...(!removing ? { [eventKey]: null } : {}),   // clear score when exempting
        enteredByUid: user.uid, enteredByName: userData?.fullName || '',
        updatedAt: serverTimestamp(),
        ...(!rec ? { createdAt: serverTimestamp() } : {}),
      }, { merge: true });
      writeLog({
        type: 'cadet_challenge', action: removing ? 'event-unexempt' : 'event-exempt',
        description: `${removing ? 'Removed' : 'Granted'} ${evLabel} exemption for ${cadet.fullName} — Cycle #${selectedCycle}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: cadet.fullName,
        notes: `cycle:${selectedCycle},company:${recordCompany},event:${eventKey}`,
      });
    } catch { showToast('Toggle failed'); }
  };

  const handleDelete = async () => {
    if (!deleteConf) return;
    try {
      await deleteDoc(doc(db, 'cadetChallengeRecords', deleteConf.id));
      setDeleteConf(null);
      showToast('Record deleted');
      writeLog({
        type: 'cadet_challenge', action: 'delete',
        description: `Deleted CC record for ${deleteConf.cadetName} — Cycle #${selectedCycle}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConf.id, targetName: deleteConf.cadetName,
      });
    } catch { showToast('Delete failed'); }
  };

  // ── Finalize cycle ────────────────────────────────────────────────────────────
  const handleFinalize = async () => {
    if (!finalizeConf) return;
    setFinalizing(true);
    try {
      // Update cycle status
      await setDoc(doc(db, 'cadetChallengeCycles', cycleKey(activeCompany, selectedCycle)), {
        company: activeCompany, cycleNumber: selectedCycle,
        status: 'submitted',
        submittedBy: userData?.fullName || '',
        submittedByUid: user.uid,
        submittedAt: serverTimestamp(),
      }, { merge: true });

      // Email notification
      const idToken = await getIdToken(auth.currentUser);
      const res = await fetch('/api/notify-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'finalize', idToken,
          cycleNumber: selectedCycle,
          company: activeCompany,
          submitterName: userData?.fullName || '',
        }),
      });
      const data = await res.json();
      setFinalizeConf(null);
      showToast(`Cycle #${selectedCycle} submitted — ${data.sent || 0} notifications sent`);
      writeLog({
        type: 'cadet_challenge', action: 'finalize',
        description: `Finalized CC Cycle #${selectedCycle} for ${activeCompany}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', notes: `cycle:${selectedCycle},company:${activeCompany}`,
      });
    } catch (err) {
      console.error(err);
      showToast('Finalize failed — try again');
    } finally {
      setFinalizing(false);
    }
  };

  // ── Open cycle (S1 / S3 / XO) — starts a closed cycle so companies can enter data ─
  const handleOpenCycle = async (company) => {
    try {
      await setDoc(doc(db, 'cadetChallengeCycles', cycleKey(company, selectedCycle)), {
        company, cycleNumber: selectedCycle,
        status: 'open',
        openedBy: userData?.fullName || '',
        openedByUid: user.uid,
        openedAt: serverTimestamp(),
      }, { merge: true });
      showToast(`${company} Cycle #${selectedCycle} opened`);
    } catch { showToast('Open failed'); }
  };

  // ── Unlock cycle (Battalion S1) ───────────────────────────────────────────────
  const handleUnlock = async (company) => {
    try {
      await setDoc(doc(db, 'cadetChallengeCycles', cycleKey(company, selectedCycle)), {
        status: 'open',
        unlockedBy: userData?.fullName || '',
        unlockedByUid: user.uid,
        unlockedAt: serverTimestamp(),
      }, { merge: true });
      showToast(`${company} Cycle #${selectedCycle} unlocked`);
    } catch { showToast('Unlock failed'); }
  };

  // ── Lock cycle (Battalion S1) ─────────────────────────────────────────────────
  const handleLock = async (company) => {
    try {
      await setDoc(doc(db, 'cadetChallengeCycles', cycleKey(company, selectedCycle)), {
        status: 'locked',
        lockedBy: userData?.fullName || '',
        lockedByUid: user.uid,
        lockedAt: serverTimestamp(),
      }, { merge: true });

      // Auto-submit Uniform Requests for qualifying cadets' ribbons
      try {
        // Fetch roster to get gender, letLevel, rank, and linkedUid
        const companyFilter = BATTALION_COMPANIES.includes(company) ? BATTALION_COMPANIES : [company];
        const rosterSnap = await getDocs(
          query(collection(db, 'roster'), where('company', 'in', companyFilter))
        );
        const rosterMap = {};
        rosterSnap.docs.forEach(d => { rosterMap[d.id] = d.data(); });

        // Records for this company in this cycle
        const companyRecs = allRecords.filter(
          r => r.company === company && r.cycleNumber === selectedCycle && !r.medicalExempt
        );

        const requestWrites = [];
        for (const rec of companyRecs) {
          if (!rec.cadetId) continue;
          const cadetRoster = rosterMap[rec.cadetId] || {};
          const ribbon = evalRibbon(rec, cadetRoster);
          if (!ribbon) continue;

          const detail = ribbon === 'athletic'
            ? 'JROTC Athletic Ribbon (N-2-3)'
            : 'JROTC Physical Fitness Ribbon (N-2-2)';

          // Use a deterministic doc ID to prevent duplicates on re-lock
          requestWrites.push(
            setDoc(
              doc(db, 'uniform_requests', `ribbon_${rec.cadetId}_${cycleKey(company, selectedCycle)}`),
              {
                issuedBy:        'Cadet Challenge System',
                cadetName:       rec.cadetName,
                rosterDocId:     rec.cadetId,
                linkedUid:       cadetRoster.linkedUid || null,
                company,
                rank:            cadetRoster.rank || '',
                item:            'Ribbons',
                detail,
                notes:           `Auto-submitted · Cadet Challenge Cycle #${selectedCycle}`,
                status:          'Pending',
                timestamp:       serverTimestamp(),
                requestedByUid:  null,
                requestedByEmail: null,
                autoSubmitted:   true,
              }
            )
          );
        }

        if (requestWrites.length > 0) await Promise.all(requestWrites);
        showToast(
          requestWrites.length > 0
            ? `${company} Cycle #${selectedCycle} locked · ${requestWrites.length} ribbon request${requestWrites.length === 1 ? '' : 's'} sent to Uniform Requests`
            : `${company} Cycle #${selectedCycle} locked`
        );
      } catch (ribbonErr) {
        console.error('Ribbon request generation failed:', ribbonErr);
        showToast(`${company} Cycle #${selectedCycle} locked`);
      }
    } catch { showToast('Lock failed'); }
  };

  // ── Send back (Battalion S1) ──────────────────────────────────────────────────
  const handleSendBack = async () => {
    if (!sendBackConf) return;
    setSendingBack(true);
    try {
      await setDoc(doc(db, 'cadetChallengeCycles', cycleKey(sendBackConf.company, selectedCycle)), {
        status: 'open',
        sentBackBy: userData?.fullName || '',
        sentBackByUid: user.uid,
        sentBackAt: serverTimestamp(),
        sentBackNote: sendBackNote.trim() || null,
      }, { merge: true });

      const idToken = await getIdToken(auth.currentUser);
      await fetch('/api/notify-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'send-back', idToken,
          cycleNumber: selectedCycle,
          company: sendBackConf.company,
          note: sendBackNote.trim(),
        }),
      });
      setSendBackConf(null);
      setSendBackNote('');
      showToast(`Sent back to ${sendBackConf.company} S1 Assistant`);
    } catch { showToast('Send back failed'); }
    finally { setSendingBack(false); }
  };

  // ── Loading / access check ────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-yellow-500" size={40} />
      </div>
    );
  }

  // Users without input/view access get a read-only personal view
  const hasFullAccess = canInput || canViewAll;

  if (!hasFullAccess) {
    return (
      <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={Activity} title="Cadet Challenge" />}

          {myPersonalLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
            </div>
          ) : myPersonalRecords.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
              <Activity className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No records yet</p>
              <p className="text-slate-400 text-xs mt-2 max-w-xs mx-auto">
                Once your S1 assistant enters your fitness scores, they will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {CYCLES.map(cycleNum => {
                const rec = myPersonalRecords.find(r => r.cycleNumber === cycleNum);
                if (!rec) return null;
                return (
                  <div key={cycleNum}>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 mb-3 px-1">
                      Cycle #{cycleNum}
                    </p>
                    <RecordCard rec={rec} canEdit={false} canDelete={false} />
                  </div>
                );
              })}
            </div>
          )}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={Activity} title="Cadet Challenge" />}

        {/* ── Page-level tab: Records / Top Contenders ── */}
        <div className="flex gap-2 mb-6">
          {[
            { id: 'records',    label: 'Records' },
            { id: 'contenders', label: 'Top Contenders' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setPageTab(t.id)}
              className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                pageTab === t.id
                  ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                  : 'bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500/30'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TOP CONTENDERS VIEW ── */}
        {pageTab === 'contenders' && (
          <div className="space-y-6 mb-8">
            {/* Sub-header */}
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500 px-1">
              Top 5 per event · Cycle #{selectedCycle}{canViewAll && !filterCompany ? ' · All Companies' : filterCompany ? ` · ${filterCompany}` : ` · ${activeCompany}`}
            </p>

            {contenders.map(evt => (
              <div key={evt.key} className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 overflow-hidden">
                {/* Event header */}
                <div className="px-5 py-3 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">
                    {evt.label}{evt.unit ? ` · ${evt.unit}` : ''} — {evt.asc ? 'fastest wins' : 'highest score'}
                  </p>
                </div>
                {/* Male / Female columns */}
                <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 dark:divide-white/5">
                  {[
                    { list: evt.males,   label: '♂ Male',   color: 'text-blue-600 dark:text-blue-400' },
                    { list: evt.females, label: '♀ Female', color: 'text-rose-600 dark:text-rose-400' },
                  ].map(col => (
                    <div key={col.label} className="p-4">
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-3 ${col.color}`}>{col.label}</p>
                      {col.list.length === 0 ? (
                        <p className="text-[10px] text-slate-400 italic">No data yet</p>
                      ) : (
                        <ol className="space-y-1.5">
                          {col.list.map((e, i) => (
                            <li key={`${e.name}-${i}`} className="flex items-center gap-2">
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 ${
                                i === 0 ? 'bg-yellow-400 text-slate-900' :
                                i === 1 ? 'bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200' :
                                i === 2 ? 'bg-amber-700/60 text-amber-100' :
                                'bg-slate-100 dark:bg-white/5 text-slate-400'
                              }`}>{i + 1}</span>
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex-1 truncate">{e.name}</span>
                              {(canViewAll && !filterCompany) && (
                                <span className="text-[9px] text-slate-400 dark:text-slate-500 shrink-0">{normalizeCompany(e.company)}</span>
                              )}
                              <span className="text-xs font-black text-slate-600 dark:text-slate-300 shrink-0 tabular-nums">
                                {String(e.rec[evt.key])}{evt.unit && evt.key !== 'oneMile' ? ` ${evt.unit}` : ''}
                              </span>
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

        {/* ── RECORDS VIEW (all existing content) ── */}
        {pageTab === 'records' && <>

        {/* Cycle tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {CYCLES.map(n => (
            <button
              key={n}
              onClick={() => setSelectedCycle(n)}
              className={`px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                selectedCycle === n
                  ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                  : 'bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500/30'
              }`}
            >
              Cycle #{n}
            </button>
          ))}

          {/* Group-by-LET toggle */}
          <button
            onClick={() => setGroupLet(g => !g)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border ${
              groupLet
                ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                : 'bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400'
            }`}
          >
            <GraduationCap size={13} /> Group by LET
          </button>
          {companyRecords.length > 0 && (
            <button
              onClick={handleExportChallenge}
              title="Export this cycle's records to CSV"
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500 hover:text-yellow-600"
            >
              <Download size={13} /> Export CSV
            </button>
          )}
          {allCadets.length > 0 && activeCompany && (
            <div className="relative">
              <button
                onClick={() => setShowPrintOptions(o => !o)}
                title="Print company roster"
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500 hover:text-yellow-600"
              >
                <Printer size={13} /> Print Roster
              </button>
              {showPrintOptions && (
                <div className="absolute left-0 top-full mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-4 min-w-[220px]">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Columns to Include</p>
                  <div className="space-y-2 mb-3">
                    {CHALLENGE_PRINT_COL_DEFS.map(col => (
                      <label key={col.key} className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={printChallengeCols.includes(col.key)}
                          onChange={e => setPrintChallengeCols(prev =>
                            e.target.checked ? [...prev, col.key] : prev.filter(k => k !== col.key)
                          )}
                          className="accent-yellow-500 w-3.5 h-3.5"
                        />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {col.label || 'Blank Column'}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mb-3">
                    Battalion leadership always included.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handlePrintChallengeRoster}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 px-3 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
                    >
                      <Printer size={11} /> Print PDF
                    </button>
                    <button
                      onClick={() => setShowPrintOptions(false)}
                      className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-black uppercase transition-all"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Staff company filter */}
        {canViewAll && (
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-2 shadow-sm">
              <Filter size={13} className="text-slate-400" />
              <select
                value={filterCompany}
                onChange={e => setFilterCompany(e.target.value)}
                className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2"
              >
                <option value="">All Companies</option>
                {/* Include myCompany (e.g. Battalion) even if not in the admin-configured list */}
                {myCompany && !companies.includes(myCompany) && (
                  <option key={myCompany}>{myCompany}</option>
                )}
                {companies.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            {/* Cycle status pills — show all companies when no filter, otherwise just the selected one */}
            {!filterCompany && (
              <div className="flex gap-2 flex-wrap">
                {visibleCompanies.map(company => {
                  const key  = cycleKey(company, selectedCycle);
                  const stat = cycleStatuses[key]?.status || 'closed';
                  return (
                    <span key={company} className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg ${statusColor(stat)}`}>
                      {company}: {statusLabel(stat)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Cycle status banner + action buttons ─────────────────────────────────
            Shown for company-level users (always) and for canViewAll users when a
            specific company is selected — giving Battalion S1 the same controls a
            company S1 assistant sees for their own company.                        */}
        {activeCompany && (!canViewAll || filterCompany) && (
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-xl ${statusColor(activeCycle.status)}`}>
              {canViewAll && <>{filterCompany} · </>}Cycle #{selectedCycle} — {statusLabel(activeCycle.status)}
            </span>

            {/* Completion stats — only while the cycle is active */}
            {cycleStats && (
              <>
                <span className="text-[10px] font-black uppercase px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10">
                  {cycleStats.total} cadets
                </span>
                <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-xl border ${
                  cycleStats.completed === cycleStats.total && cycleStats.total > 0
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
                    : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                }`}>
                  {cycleStats.completed} / {cycleStats.total} complete
                </span>
              </>
            )}

            {/* Open Cycle — S1/S3/XO when cycle is closed */}
            {canOpen && isClosed && (
              <button
                onClick={() => handleOpenCycle(activeCompany)}
                className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-4 py-2 rounded-xl transition-all"
              >
                <Unlock size={14} /> Open Cycle
              </button>
            )}

            {/* Company-level notice when cycle is closed */}
            {isClosed && !canOpen && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5">
                <Lock size={12} /> Cycle not yet open — waiting for S1/S3/XO to start it
              </span>
            )}

            {/* Finalize — MSgt, S1, S3, or XO; cycle must be open */}
            {canFinalize && activeCycle.status === 'open' && (
              <button
                onClick={() => setFinalizeConf(activeCompany)}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white font-black text-xs uppercase tracking-widest px-4 py-2 rounded-xl transition-all"
              >
                <Send size={14} /> Finalize & Submit
              </button>
            )}

            {/* Unlock — Battalion S1 or Battalion S3 */}
            {canUnlock && activeCycle.status !== 'open' && activeCycle.status !== 'closed' && (
              <button
                onClick={() => handleUnlock(activeCompany)}
                className="flex items-center gap-2 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl border border-yellow-500/30 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all"
              >
                <Unlock size={13} /> Unlock Cycle
              </button>
            )}
            {canUnlock && activeCycle.status === 'submitted' && (
              <>
                <button
                  onClick={() => handleLock(activeCompany)}
                  className="flex items-center gap-2 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-green-600 text-white hover:bg-green-500 transition-all"
                >
                  <Lock size={13} /> Lock & Verify
                </button>
                <button
                  onClick={() => setSendBackConf({ company: activeCompany })}
                  className="flex items-center gap-2 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-orange-500 text-white hover:bg-orange-400 transition-all"
                >
                  <RotateCcw size={13} /> Send Back
                </button>
              </>
            )}

            {activeCycle.status === 'submitted' && !canUnlock && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-bold">
                Submitted by {activeCycle.submittedBy || 'Company Staff'} · awaiting Battalion S1/S3 review
              </span>
            )}
            {activeCycle.status === 'locked' && (
              <span className="text-xs text-green-600 font-bold flex items-center gap-1.5">
                <Lock size={12} /> Verified & locked by {activeCycle.lockedBy || 'Battalion S1/S3'}
              </span>
            )}
          </div>
        )}

        {/* ── TABLE VIEW ── */}
        <TableView
          cadets={cadets}
          bnCadets={bnCadets}
          recordMap={recordMap}
          canEdit={canEdit}
          isLocked={isLocked}
          onEdit={openEdit}
          onDelete={setDeleteConf}
          onQuickSave={handleQuickSave}
          onMedicalToggle={handleMedicalToggle}
          onAddManual={() => openCreate()}
          onCreateForCadet={(uid, name) => openCreate(uid, name)}
          onEventExemptToggle={handleEventExemptToggle}
          loading={dataLoading}
          groupLet={groupLet}
        />

        {/* ── Company Averages ── */}
        {avgStats.n > 0 && (
          <div className="mt-4 rounded-2xl border border-blue-100 dark:border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-blue-50/60 dark:bg-slate-800/40 border-b border-blue-100 dark:border-white/5">
              <div className="flex items-center gap-2">
                <BarChart2 size={13} className="text-blue-500" />
                <p className="text-xs font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                  Company Averages · Cycle #{selectedCycle}
                </p>
              </div>
              <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-500/15 px-2.5 py-1 rounded-full shrink-0">
                {avgStats.n} cadet{avgStats.n !== 1 ? 's' : ''} (non-exempt)
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
              {[
                { key: 'pushUps',    label: 'Push-Ups'    },
                { key: 'sitUps',     label: 'Sit-Ups'     },
                { key: 'shuttleRun', label: 'Shuttle (s)' },
                { key: 'oneMile',    label: '1 Mile'      },
                { key: 'sitNReach',  label: 'Sit-N-Reach' },
              ].map(({ key, label }, i) => (
                <div key={key} className={`px-4 py-4 text-center ${i > 0 ? 'border-l border-blue-100 dark:border-white/5' : ''}`}>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">{label}</p>
                  <p className="text-xl font-black text-slate-700 dark:text-white tabular-nums">
                    {avgStats[key] != null ? avgStats[key] : '—'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STAFF: all companies' records ── */}
        {canViewAll && !filterCompany && (
          <div className="space-y-6 mt-6">
            {visibleCompanies.map(company => {
              const key     = cycleKey(company, selectedCycle);
              const stat    = cycleStatuses[key]?.status || 'closed';
              // Include battalion members who observe this company (secondaryCompany match)
              const recs    = allRecords.filter(r => r.company === company || r.secondaryCompany === company);
              const recMap  = {};
              recs.forEach(r => { if (r.cadetId) recMap[r.cadetId] = r; });
              return (
                <CompanySection
                  key={company} company={company} cycleStatus={stat}
                  cycleData={cycleStatuses[key] || {}}
                  records={recs} canUnlock={canUnlock} canOpen={canOpen}
                  onOpen={() => handleOpenCycle(company)}
                  onUnlock={() => handleUnlock(company)}
                  onLock={() => handleLock(company)}
                  onSendBack={() => setSendBackConf({ company })}
                />
              );
            })}
          </div>
        )}

        </> /* end pageTab === 'records' */}

        {/* ── Ribbon Qualifications — bottom summary (always visible) ──────────────
            Shows all cadets currently meeting the standard. Live as scores are
            entered. Auto-submits to Uniform Requests (S4) when cycle is locked.  */}
        <div className="mt-8 rounded-2xl border border-amber-200 dark:border-amber-500/20 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 bg-amber-50 dark:bg-amber-500/5 border-b border-amber-200 dark:border-amber-500/15">
              <div className="flex items-center gap-2.5">
                <Award size={15} className="text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                    Ribbon Qualifications · Cycle #{selectedCycle}
                  </p>
                  <p className="text-[10px] text-amber-600/70 dark:text-amber-500/70 mt-0.5">
                    {isLocked
                      ? '✓ Award requests were submitted to Uniform Requests when this cycle was locked'
                      : 'Live · award requests auto-submit to Uniform Requests (S4) when the cycle is locked'}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 bg-amber-100 dark:bg-amber-500/15 px-2.5 py-1 rounded-full shrink-0">
                {allRibbonQuals.athletic.length + allRibbonQuals.physFit.length} qualifying
              </span>
            </div>

            {/* Two-column table */}
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-amber-100 dark:divide-amber-500/10">
              {/* Athletic column */}
              <div className="p-4">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-amber-600 dark:text-amber-500 mb-3 flex items-center gap-1.5">
                  <span className="text-base leading-none">★</span> Athletic Ribbon (N-2-3) · 85th Percentile
                  <span className="ml-auto text-amber-400 dark:text-amber-600">{allRibbonQuals.athletic.length}</span>
                </p>
                {allRibbonQuals.athletic.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic">No cadets currently</p>
                ) : (
                  <ul className="space-y-1.5">
                    {allRibbonQuals.athletic.map(({ name, company }) => (
                      <li key={name} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{name}</span>
                        {canViewAll && !filterCompany && company && (
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0">{company}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Physical Fitness column */}
              <div className="p-4">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5">
                  <span className="text-base leading-none">◆</span> Phys Fit Ribbon (N-2-2) · 50th Percentile
                  <span className="ml-auto text-slate-400 dark:text-slate-600">{allRibbonQuals.physFit.length}</span>
                </p>
                {allRibbonQuals.physFit.length === 0 ? (
                  <p className="text-[10px] text-slate-400 italic">No cadets currently</p>
                ) : (
                  <ul className="space-y-1.5">
                    {allRibbonQuals.physFit.map(({ name, company }) => (
                      <li key={name} className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{name}</span>
                        {canViewAll && !filterCompany && company && (
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0">{company}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

      {/* ── Entry/Edit Modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && closeModal()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <h2 className="font-black uppercase text-sm tracking-widest flex items-center gap-2">
                  <Activity size={16} className="text-yellow-500" />
                  {editingRecord ? 'Edit Record' : 'New Record'} — Cycle #{selectedCycle}
                </h2>
                <button onClick={closeModal} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-5">
                {/* Cadet name */}
                <div>
                  <label className={lc}>Cadet Name *</label>
                  {allCadets.length > 0 ? (
                    <select
                      required={!editingRecord}
                      value={form.cadetId}
                      onChange={e => {
                        const cadet = allCadets.find(c => c.uid === e.target.value);
                        setForm(f => ({
                          ...f,
                          cadetId: e.target.value,
                          cadetName: cadet?.fullName || '',
                        }));
                      }}
                      className={ic}
                    >
                      <option value="">— Select Cadet —</option>
                      {allCadets.map(c => (
                        <option key={c.uid} value={c.uid}>{c.fullName}</option>
                      ))}
                      <option value="manual">+ Enter manually</option>
                    </select>
                  ) : null}
                  {(form.cadetId === 'manual' || allCadets.length === 0) && (
                    <input
                      required
                      type="text"
                      placeholder="LAST, FIRST"
                      value={form.cadetName}
                      onChange={e => setForm(f => ({ ...f, cadetName: e.target.value }))}
                      className={`${ic} mt-2`}
                    />
                  )}
                </div>

                {/* Medical exemption */}
                <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-xl border border-slate-200 dark:border-white/10 hover:border-yellow-500/30 transition-all">
                  <div
                    onClick={() => setForm(f => ({ ...f, medicalExempt: !f.medicalExempt }))}
                    className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all cursor-pointer ${
                      form.medicalExempt
                        ? 'bg-yellow-500 border-yellow-500'
                        : 'border-slate-300 dark:border-white/20'
                    }`}
                  >
                    {form.medicalExempt && <CheckCircle2 size={12} className="text-slate-950" />}
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">Medical Exemption</p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500">Exempt from all events — no reason required</p>
                  </div>
                </label>

                {/* Event scores */}
                {!form.medicalExempt && (
                  <div>
                    <p className="text-[10px] font-black uppercase text-yellow-500 tracking-widest mb-3">Event Scores</p>
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { key: 'pushUps',    label: 'Push-Ups (reps)',          type: 'number', extra: { min:'0', max:'999', placeholder:'0' } },
                        { key: 'sitUps',     label: 'Sit-Ups (reps)',           type: 'number', extra: { min:'0', max:'999', placeholder:'0' } },
                        { key: 'shuttleRun', label: 'Shuttle Run (sec)',         type: 'number', extra: { min:'0', max:'999', step:'0.01', placeholder:'7.22' } },
                        { key: 'oneMile',    label: 'One Mile (MM:SS)',          type: 'text',   extra: { pattern:'^\\d{1,2}:\\d{2}$', title:'Format: MM:SS (e.g. 7:22)', placeholder:'7:22' } },
                        { key: 'sitNReach',  label: 'Sit-N-Reach (cm)',          type: 'number', extra: { min:'-30', max:'100', step:'0.1', placeholder:'30.5' }, wide: true },
                      ].map(({ key, label, type, extra, wide }) => {
                        const evExempt = form.exemptEvents.includes(key);
                        const toggleEvExempt = () => setForm(f => ({
                          ...f,
                          exemptEvents: evExempt
                            ? f.exemptEvents.filter(k => k !== key)
                            : [...f.exemptEvents, key],
                          ...(evExempt ? {} : { [key]: '' }),
                        }));
                        return (
                          <div key={key} className={wide ? 'col-span-2' : ''}>
                            <div className="flex items-center justify-between mb-1">
                              <label className={lc}>{label}</label>
                              <button
                                type="button"
                                onClick={toggleEvExempt}
                                className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full transition-all ${evExempt ? 'bg-orange-500/15 text-orange-500 border border-orange-500/30' : 'text-slate-400 hover:text-orange-500'}`}
                              >
                                {evExempt ? '✕ Exempt' : 'Exempt?'}
                              </button>
                            </div>
                            {evExempt ? (
                              <div className="h-9 rounded-xl bg-orange-500/5 border border-orange-500/20 flex items-center px-3">
                                <span className="text-[10px] font-black uppercase text-orange-500 tracking-widest">Event exempted — no score required</span>
                              </div>
                            ) : (
                              <input type={type} {...extra}
                                value={form[key]}
                                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                                className={ic} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <button
                  type="submit" disabled={saving}
                  className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={14} /> {editingRecord ? 'Save Changes' : 'Save Record'}</>}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Finalize confirmation ── */}
      <AnimatePresence>
        {finalizeConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-green-200 dark:border-green-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Send className="mx-auto text-green-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Finalize Cycle #{selectedCycle}?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                This will submit all records for <strong>{activeCompany} Company</strong> and notify
                Battalion S1, S3, and XO. Editing will be locked until unlocked by Battalion S1.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setFinalizeConf(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button onClick={handleFinalize} disabled={finalizing}
                  className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                  {finalizing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {finalizing ? 'Sending…' : 'Confirm'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Send Back modal ── */}
      <AnimatePresence>
        {sendBackConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-orange-200 dark:border-orange-500/20 rounded-3xl p-8 max-w-sm w-full">
              <RotateCcw className="mx-auto text-orange-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2 text-center">Send Back for Corrections</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 text-center">
                Returns Cycle #{selectedCycle} for <strong>{sendBackConf.company}</strong> to the S1 Assistant with an optional note.
              </p>
              <div className="mb-4">
                <label className={lc}>Note (optional)</label>
                <textarea rows={3} value={sendBackNote}
                  onChange={e => setSendBackNote(e.target.value)}
                  placeholder="What needs to be corrected..."
                  className={`${ic} resize-none`} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setSendBackConf(null); setSendBackNote(''); }}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button onClick={handleSendBack} disabled={sendingBack}
                  className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-60 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                  {sendingBack ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Send Back
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete confirmation ── */}
      <AnimatePresence>
        {deleteConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Trash2 className="mx-auto text-red-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Delete Record?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Permanently removes the record for <strong>{deleteConf.cadetName}</strong>.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConf(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  Cancel
                </button>
                <button onClick={handleDelete}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-black text-xs uppercase tracking-widest transition-all">
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-2xl shadow-xl z-50">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── TableView sub-component ────────────────────────────────────────────────────

const EVENTS = [
  { key: 'pushUps',    label: 'Push-Ups',    type: 'number', step: '1',    placeholder: '0' },
  { key: 'sitUps',     label: 'Sit-Ups',     type: 'number', step: '1',    placeholder: '0' },
  { key: 'shuttleRun', label: 'Shuttle (s)', type: 'number', step: '0.01', placeholder: '7.22' },
  { key: 'oneMile',    label: '1 Mile',      type: 'text',   step: null,   placeholder: '7:22' },
  { key: 'sitNReach',  label: 'Sit-N-Reach (cm)', type: 'number', step: '0.1', placeholder: '30.5' },
];

const TableView = ({ cadets, bnCadets = [], recordMap, canEdit, isLocked, onEdit, onDelete, onQuickSave, onMedicalToggle, onEventExemptToggle, onAddManual, onCreateForCadet, loading, groupLet }) => {
  // Deduplicate bnCadets against the primary cadets list so no cadet appears twice
  const primaryUids = new Set(cadets.map(c => c.uid));
  const bnCadetsUniq = bnCadets.filter(c => !primaryUids.has(c.uid));
  const [editingCell, setEditingCell] = useState(null); // { uid, key }
  const [cellValue,   setCellValue]   = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  const startEdit = (uid, key, currentVal) => {
    if (!canEdit || isLocked) return;
    setEditingCell({ uid, key });
    setCellValue(currentVal ?? '');
  };

  const commitEdit = async (cadet) => {
    if (!editingCell) return;
    const { key } = editingCell;
    const parsed = key === 'oneMile' ? cellValue.trim() : (cellValue !== '' ? parseFloat(cellValue) : null);
    await onQuickSave(cadet, key, parsed);
    setEditingCell(null);
  };

  if (loading) return (
    <div className="space-y-2">
      {[1,2,3,4].map(n => <div key={n} className="h-12 bg-slate-100 dark:bg-slate-900/60 rounded-xl animate-pulse" />)}
    </div>
  );

  if (cadets.length === 0) return (
    <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
      <ClipboardList className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
      <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No cadets in roster</p>
      <p className="text-xs text-slate-400 mt-2">Add cadets to the Battalion Roster first, then return here.</p>
      <button onClick={onAddManual} className="mt-4 text-yellow-500 text-xs font-black uppercase hover:text-yellow-400">
        + Add manual record
      </button>
    </div>
  );

  // Defined before return so both the main tbody and the battalion
  // section can call it without IIFE scoping issues.
  const renderRow = (cadet, idx) => {
    const rec          = recordMap[cadet.uid];
    const isFullExempt = rec?.medicalExempt || false;
    const exemptEvents = rec?.exemptEvents  || [];
    const isEventExempt = (key) => isFullExempt || exemptEvents.includes(key);
    const ribbon       = rec && !isFullExempt ? evalRibbon(rec, cadet) : null;
    return (
      <tr
        key={cadet.uid}
        className={`border-b border-slate-100 dark:border-white/5 transition-colors ${idx % 2 === 0 ? 'bg-white dark:bg-slate-950/30' : 'bg-slate-50/50 dark:bg-slate-900/20'} ${isFullExempt ? 'opacity-60' : ''}`}
      >
        <td className="p-3">
          <p className="font-black text-slate-900 dark:text-white">{cadet.fullName}</p>
          {ribbon && (
            <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full mt-0.5 inline-block ${
              ribbon === 'athletic'
                ? 'bg-amber-400/20 text-amber-700 dark:text-amber-400'
                : 'bg-slate-200 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300'
            }`}>
              {ribbon === 'athletic' ? '★ Athletic N-2-3' : '◆ Phys Fit N-2-2'}
            </span>
          )}
          {rec?.enteredByName && (
            <p className="text-[10px] text-slate-400">by {rec.enteredByName}</p>
          )}
        </td>
        {/* Full medical exempt toggle */}
        <td className="p-3 text-center">
          <button
            onClick={() => canEdit && !isLocked && onMedicalToggle(cadet)}
            disabled={!canEdit || isLocked}
            title={isFullExempt ? 'Remove full exemption' : 'Mark fully exempt from all events'}
            className={`w-5 h-5 rounded mx-auto flex items-center justify-center border-2 transition-all ${
              isFullExempt ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-white/20'
            } ${canEdit && !isLocked ? 'cursor-pointer' : 'cursor-default'}`}
          >
            {isFullExempt && <CheckCircle2 size={11} className="text-slate-950" />}
          </button>
        </td>
        {EVENTS.map(ev => {
          const val        = rec?.[ev.key];
          const isActive   = editingCell?.uid === cadet.uid && editingCell?.key === ev.key;
          const evExempt   = isEventExempt(ev.key);
          const perEvExempt = !isFullExempt && exemptEvents.includes(ev.key);
          return (
            <td key={ev.key} className="p-2 text-center">
              {isFullExempt ? (
                <span className="text-[10px] text-slate-300 dark:text-slate-600 font-bold">exempt</span>
              ) : isActive ? (
                <div className="flex flex-col items-center gap-1">
                  <input
                    ref={inputRef}
                    type={ev.type}
                    step={ev.step || undefined}
                    value={cellValue}
                    onChange={e => setCellValue(e.target.value)}
                    onBlur={() => commitEdit(cadet)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(cadet); if (e.key === 'Escape') setEditingCell(null); }}
                    className="w-full text-center bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-400 rounded-lg py-1 px-2 text-xs font-bold outline-none"
                  />
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { onEventExemptToggle?.(cadet, ev.key); setEditingCell(null); }}
                    className="text-[9px] text-slate-400 hover:text-orange-500 font-black uppercase tracking-wider transition-colors"
                  >
                    Mark exempt
                  </button>
                </div>
              ) : perEvExempt ? (
                <div className="flex items-center justify-center gap-1">
                  <span className="text-[10px] text-orange-400 dark:text-orange-500 font-bold">exempt</span>
                  {canEdit && !isLocked && (
                    <button
                      onClick={() => onEventExemptToggle?.(cadet, ev.key)}
                      title="Remove this event's exemption"
                      className="text-[9px] text-slate-400 hover:text-red-500 font-black transition-colors"
                    >✕</button>
                  )}
                </div>
              ) : (
                <span
                  onClick={() => startEdit(cadet.uid, ev.key, val)}
                  className={`inline-block min-w-[50px] py-1 px-2 rounded-lg font-bold transition-all ${
                    canEdit && !isLocked
                      ? 'cursor-pointer hover:bg-yellow-50 dark:hover:bg-yellow-500/10 hover:text-yellow-600'
                      : ''
                  } ${val != null ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-600'}`}
                >
                  {val != null ? String(val) : '—'}
                </span>
              )}
            </td>
          );
        })}
        {canEdit && (
          <td className="p-2 text-center">
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={() => rec ? onEdit(rec) : onCreateForCadet?.(cadet.uid, cadet.fullName)}
                title={rec ? 'Edit full record' : 'Add record for this cadet'}
                className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all">
                <Edit3 size={13} />
              </button>
              {rec && (
                <button onClick={() => onDelete({ id: rec.id, cadetName: cadet.fullName })}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  };

  const theadRow = (
    <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5">
      <th className="text-left p-3 font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 min-w-[180px]">Cadet</th>
      <th className="p-3 text-center font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 w-10">Exempt</th>
      {EVENTS.map(ev => (
        <th key={ev.key} className="p-3 text-center font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 min-w-[90px]">
          {ev.label}
        </th>
      ))}
      {canEdit && <th className="p-3 w-20" />}
    </tr>
  );

  return (
    <>
    <div className="overflow-x-auto rounded-2xl border border-blue-100 dark:border-white/5 shadow-sm">
      <table className="w-full text-xs">
        <thead>{theadRow}</thead>
        <tbody>
          {groupLet
            ? groupByLet(cadets, c => c.letLevel, c => c.fullName).map(({ level, entries: group }) => (
                <React.Fragment key={level}>
                  <tr>
                    <td colSpan={999} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-y border-yellow-200 dark:border-yellow-500/20">
                      {level}
                    </td>
                  </tr>
                  {group.map((cadet, idx) => renderRow(cadet, idx))}
                </React.Fragment>
              ))
            : cadets.map((cadet, idx) => renderRow(cadet, idx))
          }
        </tbody>
      </table>
      {canEdit && (
        <div className="p-3 border-t border-slate-100 dark:border-white/5">
          <button onClick={onAddManual}
            className="text-xs font-black uppercase text-slate-400 hover:text-yellow-500 transition-colors flex items-center gap-1.5">
            <Plus size={13} /> Add manual entry
          </button>
        </div>
      )}
    </div>

    {/* ── Battalion · In Period ── */}
    {bnCadetsUniq.length > 0 && (
      <div className="mt-4">
        <div className="flex items-center gap-3 mb-2 px-1">
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <Shield size={10} /> Battalion · In Period
          </span>
          <span className="text-[9px] text-slate-400 dark:text-slate-500">
            — HQ staff attached to this company's class period
          </span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-amber-200 dark:border-amber-500/20 shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200 dark:border-amber-500/20">
                <th className="text-left p-3 font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 min-w-[180px]">Cadet</th>
                <th className="p-3 text-center font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 w-10">Exempt</th>
                {EVENTS.map(ev => (
                  <th key={ev.key} className="p-3 text-center font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 min-w-[90px]">
                    {ev.label}
                  </th>
                ))}
                {canEdit && <th className="p-3 w-20" />}
              </tr>
            </thead>
            <tbody>
              {groupLet
                ? groupByLet(bnCadetsUniq, c => c.letLevel, c => c.fullName).map(({ level, entries: group }) => (
                    <React.Fragment key={`bn-${level}`}>
                      <tr>
                        <td colSpan={999} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-y border-yellow-200 dark:border-yellow-500/20">
                          {level}
                        </td>
                      </tr>
                      {group.map((cadet, idx) => renderRow(cadet, idx))}
                    </React.Fragment>
                  ))
                : bnCadetsUniq.map((cadet, idx) => renderRow(cadet, idx))
              }
            </tbody>
          </table>
        </div>
      </div>
    )}
    </>
  );
};

// ── RecordCard sub-component ───────────────────────────────────────────────────

const RecordCard = ({ rec, canEdit, canDelete, onEdit, onDelete }) => (
  <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm hover:border-yellow-500/20 transition-all">
    <div className="flex items-center gap-3 min-w-0">
      <div className={`w-2 h-2 rounded-full shrink-0 ${rec.medicalExempt ? 'bg-slate-300 dark:bg-slate-600' : 'bg-yellow-400'}`} />
      <div className="min-w-0">
        <p className="font-black text-sm uppercase tracking-tight truncate">{rec.cadetName}</p>
        <p className="text-[10px] font-bold text-slate-400 uppercase">
          {normalizeCompany(rec.company)}
          {rec.medicalExempt && <span className="ml-2 text-orange-500">● Medical Exempt</span>}
          {!rec.medicalExempt && rec.exemptEvents?.length > 0 && (
            <span className="ml-2 text-orange-400">● {rec.exemptEvents.length} event{rec.exemptEvents.length > 1 ? 's' : ''} exempt</span>
          )}
        </p>
      </div>
    </div>
    {!rec.medicalExempt && (
      <div className="flex flex-wrap gap-4 sm:mx-auto text-center">
        {rec.pushUps   != null && <ScoreChip label="Push-Ups"   value={rec.pushUps} />}
        {rec.sitUps    != null && <ScoreChip label="Sit-Ups"    value={rec.sitUps} />}
        {rec.shuttleRun != null && <ScoreChip label="Shuttle (s)" value={rec.shuttleRun} />}
        {rec.oneMile             && <ScoreChip label="1 Mile"    value={rec.oneMile} />}
        {rec.sitNReach  != null && <ScoreChip label="Sit-N-Reach" value={`${rec.sitNReach} cm`} />}
      </div>
    )}
    <div className="flex items-center gap-2 shrink-0 ml-auto">
      {canEdit  && <button onClick={onEdit}   className="p-2 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all"><Edit3 size={15} /></button>}
      {canDelete && <button onClick={onDelete} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"><Trash2 size={15} /></button>}
    </div>
  </div>
);

// ── CompanySection sub-component (staff view) ──────────────────────────────────

const CompanySection = ({ company, cycleStatus, cycleData, records, canUnlock, canOpen, onUnlock, onLock, onSendBack, onOpen }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between p-5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/3 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <Shield size={16} className="text-yellow-500" />
          <span className="font-black uppercase tracking-widest text-sm">{company} Company</span>
          <span className="text-[10px] text-slate-400 font-bold">({records.length} records)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg ${statusColor(cycleStatus)}`}>
            {statusLabel(cycleStatus)}
          </span>
          {/* Open Cycle — S1/S3/XO when cycle is closed */}
          {canOpen && cycleStatus === 'closed' && (
            <button onClick={e => { e.stopPropagation(); onOpen(); }}
              className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg bg-yellow-500 text-slate-950 hover:bg-yellow-400 transition-all flex items-center gap-1">
              <Unlock size={10} /> Open
            </button>
          )}
          {canUnlock && cycleStatus === 'submitted' && (
            <>
              <button onClick={e => { e.stopPropagation(); onLock(); }}
                className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg bg-green-600 text-white hover:bg-green-500 transition-all flex items-center gap-1">
                <Lock size={10} /> Lock
              </button>
              <button onClick={e => { e.stopPropagation(); onSendBack(); }}
                className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg bg-orange-500 text-white hover:bg-orange-400 transition-all flex items-center gap-1">
                <RotateCcw size={10} /> Send Back
              </button>
            </>
          )}
          {canUnlock && cycleStatus !== 'open' && cycleStatus !== 'closed' && (
            <button onClick={e => { e.stopPropagation(); onUnlock(); }}
              className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border border-yellow-500/30 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all flex items-center gap-1">
              <Unlock size={10} /> Unlock
            </button>
          )}
          <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden border-t border-slate-100 dark:border-white/5">
            {records.length === 0 ? (
              <p className="p-5 text-xs text-slate-400 font-bold uppercase">No records submitted yet.</p>
            ) : (
              <div className="p-3 space-y-2">
                {records.map(rec => <RecordCard key={rec.id} rec={rec} canEdit={false} canDelete={false} />)}
              </div>
            )}
            {cycleData.submittedBy && (
              <p className="px-5 pb-4 text-[10px] text-slate-400 font-bold uppercase">
                Submitted by {cycleData.submittedBy}
                {cycleData.sentBackBy && ` · Sent back by ${cycleData.sentBackBy}`}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── ScoreChip ──────────────────────────────────────────────────────────────────
const ScoreChip = ({ label, value }) => (
  <div className="text-center">
    <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">{label}</p>
    <p className="text-sm font-black text-slate-900 dark:text-white">{value}</p>
  </div>
);

export default AdminCadetChallenge;
