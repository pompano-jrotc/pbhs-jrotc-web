// src/pages/AdminFundraiser.jsx
//
// Fallen Heroes Fundraiser Tracking
//
// ── Access model ──────────────────────────────────────────────────────────────
// Any signed-in portal user can reach this page.
//
// FULL VIEW (Transactions + Roster tabs) — FULL_ACCESS_ROLES or admin 80+:
//   s1_adjutant, s3_operations, battalion_xo, battalion_csm,
//   battalion_commander, company_commander, company_xo, company_1sg
//
// PERSONAL VIEW (own entries only) — everyone else:
//   Looks up the user's roster doc via linkedUid; falls back to cadetName
//   matching userData.fullName. Shows $0 / 0 flags if no entries yet.
//
// $2 = 1 flag, rounded down.  e.g. $5 → 2 flags ($4 credited).

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, addDoc, updateDoc, setDoc, doc, onSnapshot,
  query, where, serverTimestamp, getDocs, orderBy,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { useCompanies } from '../hooks/useCompanies';
import { normalizeCompany } from '../utils/normalizeCompany';
import { ROLE_HIERARCHY, ROLE_LABELS } from '../constants';
import {
  DollarSign, Flag, Plus, X, Loader2, CheckCircle2,
  Filter, Banknote, FileText, ShoppingCart,
  Users, ReceiptText, Ban, Heart, BarChart3, Lock, Unlock,
  SlidersHorizontal, CalendarDays, Target, Search, Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import CadetSearch from '../components/CadetSearch';
import { groupByLet } from '../utils/groupByLet';
import { GraduationCap, Printer } from 'lucide-react';
import { printRoster } from '../utils/printRoster';
import DatePicker from '../components/DatePicker';
import { exportCSV } from '../utils/exportCSV';

// ── Constants ──────────────────────────────────────────────────────────────────

// Roles that get the full Transactions + Roster view
const FULL_ACCESS_ROLES = [
  's1_adjutant', 's3_operations',
  'battalion_xo', 'battalion_csm', 'battalion_commander',
  'company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant',
];

// company_master_sergeant can VIEW the fundraiser page but cannot log payments —
// edit rights for MSgt are limited to Cadet Challenge only.
const COMPANY_INPUT_ROLES = ['company_commander', 'company_xo', 'company_1sg'];
const BN_INPUT_ROLES      = ['s1_adjutant', 's3_operations'];

const PAYMENT_TYPES = [
  { key: 'cash',   label: 'Cash',    icon: <Banknote     size={14} /> },
  { key: 'check',  label: 'Check',   icon: <FileText     size={14} /> },
  { key: 'estore', label: 'E-Store', icon: <ShoppingCart size={14} /> },
];

const PAYMENT_COLORS = {
  cash:   'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
  check:  'bg-blue-500/10  text-blue-600  dark:text-blue-400  border-blue-500/20',
  estore: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  // legacy
  zelle:  'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
};

const ADMIN_LEVEL = 80;
const STAFF_LEVEL = 70;
// Roster entries belonging to Battalion HQ (not a lettered company).
const BATTALION_COMPANIES = ['Battalion', 'Zulu'];

// $2 = 1 flag, round down
const toFlags = (amount) => Math.floor((amount || 0) / 2);

// ── Flag requirements by roster position ───────────────────────────────────────
// Squad Member: 30 | Squad Leader: 35 | Staff Assistants: 40
// Platoon Sergeant: 45 | Platoon Leader: 50 | Company Leadership + MSG: 60 | Battalion: 80
const FLAG_REQUIREMENTS_BY_POSITION = {
  'Squad Member':                30,
  'Squad Leader Assistant':      35,
  'Squad Leader':                35,
  'Company S1 Assistant':        40,
  'Company S2 Assistant':        40,
  'Company S3 Assistant':        40,
  'Company S4 Assistant':        40,
  'Company S5 Assistant':        40,
  'Company S6 Assistant':        40,
  'Company S7 Assistant':        40,
  'Platoon Sergeant':            45,
  'Platoon Leader':              50,
  'First Sergeant':              60,
  'Master Sergeant':             60,
  'Company XO':                  60,
  'Company Commander':           60,
  'Battalion Staff (S-1)':       80,
  'Battalion Staff (S-2)':       80,
  'Battalion Staff (S-3)':       80,
  'Battalion Staff (S-4)':       80,
  'Battalion Staff (S-5)':       80,
  'Battalion Staff (S-6)':       80,
  'Battalion Staff (S-7)':       80,
  'Sergeant Major':              80,
  'Battalion XO':                80,
  'Battalion Deputy Commander':  80,
  'Battalion CSM':               80,
  'Battalion Commander':         80,
};
const DEFAULT_FLAG_REQUIREMENT = 30; // fallback for unknown positions
const FALLBACK_WEEKS = 4; // used only if no date range is configured in Firestore

// Military hierarchy ordering for position lists — mirrors JROTC_POSITIONS (reversed)
const POSITION_ORDER = [
  'Battalion Commander',
  'Battalion CSM',
  'Battalion Deputy Commander',
  'Battalion XO',
  'Sergeant Major',
  'Battalion Staff (S-1)',
  'Battalion Staff (S-2)',
  'Battalion Staff (S-3)',
  'Battalion Staff (S-4)',
  'Battalion Staff (S-5)',
  'Battalion Staff (S-6)',
  'Battalion Staff (S-7)',
  'Company Commander',
  'Company XO',
  'Master Sergeant',
  'First Sergeant',
  'Company S1 Assistant',
  'Company S2 Assistant',
  'Company S3 Assistant',
  'Company S4 Assistant',
  'Company S5 Assistant',
  'Company S6 Assistant',
  'Company S7 Assistant',
  'Platoon Leader',
  'Platoon Sergeant',
  'Squad Leader',
  'Squad Leader Assistant',
  'Squad Member',
];
const positionSortKey = (name) => {
  const idx = POSITION_ORDER.indexOf(name);
  return idx === -1 ? POSITION_ORDER.length : idx;
};

const ic = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const lc = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

const ORDER_NUMBER_RE = /^1112011-\d+$/;
const ORDER_NUMBER_SCAN_RE = /1112011-\d+/gi;

const EMPTY_FORM = {
  cadetId: '', cadetName: '', paymentType: 'cash', amount: '', notes: '', orderNumber: '', orderDate: '',
};

// ── Main Component ─────────────────────────────────────────────────────────────

const AdminFundraiser = () => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const { companies } = useCompanies();

  const userLevel   = ROLE_HIERARCHY[role] || 0;
  const myCompany   = userData?.company || '';
  // All battalion staff (L70+) see the full cross-company view.
  const canViewFull = FULL_ACCESS_ROLES.includes(role) || userLevel >= STAFF_LEVEL;
  // All battalion staff (L70+) can log payments for any company.
  const canInput    = COMPANY_INPUT_ROLES.includes(role) || BN_INPUT_ROLES.includes(role) || userLevel >= STAFF_LEVEL;
  const canViewAll  = BN_INPUT_ROLES.includes(role) || userLevel >= STAFF_LEVEL;
  // Void permission mirrors input permission.
  const canDelete   = COMPANY_INPUT_ROLES.includes(role) || BN_INPUT_ROLES.includes(role) || userLevel >= STAFF_LEVEL;
  // Opening/closing the fundraiser period is reserved for S1, S3, and Top 3 only.
  const canOpenFundraiser = ['battalion_xo', 'battalion_commander', 'battalion_csm', 's1_adjutant', 's3_operations'].includes(role) || userLevel >= ADMIN_LEVEL;
  // Company leadership cannot log payments until the fundraiser is opened by S1/S3.
  const isCompanyInput    = COMPANY_INPUT_ROLES.includes(role) && !BN_INPUT_ROLES.includes(role) && userLevel < ADMIN_LEVEL;
  // Battalion XO, S1, S3, BN Commander, BN CSM, and admin 80+ can edit settings.
  const canEditSettings   = ['battalion_xo', 'battalion_commander', 'battalion_csm', 's1_adjutant', 's3_operations'].includes(role) || userLevel >= ADMIN_LEVEL;

  // ── Fundraiser open/close setting ────────────────────────────────────────────
  // Stored in settings/fundraiser  { isOpen: boolean }
  // Company leadership can only log payments when isOpen === true.
  // S1, S3, and staff (70+) can always log; they also control the toggle.
  const [fundraiserIsOpen, setFundraiserIsOpen] = useState(false);
  const [togglingOpen,     setTogglingOpen]     = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'fundraiser'), snap => {
      setFundraiserIsOpen(snap.exists() ? (snap.data().isOpen === true) : false);
    }, () => setFundraiserIsOpen(false));
    return () => unsub();
  }, []);

  const handleToggleFundraiser = async () => {
    const opening = !fundraiserIsOpen;
    setTogglingOpen(true);
    try {
      await setDoc(doc(db, 'settings', 'fundraiser'), { isOpen: opening }, { merge: true });
      writeLog({
        type: 'fundraiser', action: 'settings',
        description: `Fundraiser ${opening ? 'opened' : 'closed'} for submissions`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      console.error('Toggle fundraiser error:', err);
    } finally {
      setTogglingOpen(false);
    }
  };

  // Company input is gated: staff/S1/S3 can always log; company leadership only when open.
  const canLogPayment = canInput && (canOpenFundraiser || fundraiserIsOpen);

  // ── Editable fundraiser settings (from Firestore) ────────────────────────────
  const [positionReqs,     setPositionReqs]     = useState(FLAG_REQUIREMENTS_BY_POSITION);
  const [defaultReq,       setDefaultReq]       = useState(DEFAULT_FLAG_REQUIREMENT);
  const [fundraiserStart,  setFundraiserStart]  = useState('');
  const [fundraiserEnd,    setFundraiserEnd]     = useState('');
  // Settings-tab local edit state
  const [editReqs,         setEditReqs]         = useState({});
  const [editStart,        setEditStart]        = useState('');
  const [editEnd,          setEditEnd]          = useState('');
  const [editDefaultReq,   setEditDefaultReq]   = useState(String(DEFAULT_FLAG_REQUIREMENT));
  const [savingSettings,   setSavingSettings]   = useState(false);
  const [migrating,        setMigrating]        = useState(false);
  const [migrateResult,    setMigrateResult]    = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'fundraiserGoal'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        const merged = d.positionRequirements && Object.keys(d.positionRequirements).length > 0
          ? { ...FLAG_REQUIREMENTS_BY_POSITION, ...d.positionRequirements }
          : FLAG_REQUIREMENTS_BY_POSITION;
        setPositionReqs(merged);
        setDefaultReq(d.defaultRequirement ?? DEFAULT_FLAG_REQUIREMENT);
        setFundraiserStart(d.startDate || '');
        setFundraiserEnd(d.endDate || '');
      }
    }, () => {});
    return () => unsub();
  }, []);

  // ── Print options state ───────────────────────────────────────────────────────
  const [showPrintOptions,  setShowPrintOptions]  = useState(false);
  const [printFundCols,     setPrintFundCols]     = useState(['total', 'flags']);
  const [printFundIncludeBn, setPrintFundIncludeBn] = useState(false);

  // ── Full-view UI state ────────────────────────────────────────────────────────
  const [activeTab,          setActiveTab]          = useState('transactions');
  const [searchQuery,        setSearchQuery]        = useState('');
  const [weeklyFilterCompany, setWeeklyFilterCompany] = useState('');
  const [filterCompany,setFilterCompany]= useState('');
  const [groupLet,     setGroupLet]     = useState(false);
  const [showModal,    setShowModal]    = useState(false);
  const [modalCompany, setModalCompany] = useState('');
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [saving,       setSaving]       = useState(false);
  const [deleteConf,   setDeleteConf]   = useState(null);
  const [toast,        setToast]        = useState(null);
  const [dataLoading,  setDataLoading]  = useState(true);
  const [splitCadets,  setSplitCadets]  = useState([]);   // [{cadetId, cadetName, company}]
  const [splitSearchKey, setSplitSearchKey] = useState(0); // remounts CadetSearch after each add

  // ── Full-view data ────────────────────────────────────────────────────────────
  const [entries, setEntries] = useState([]);
  const [cadets,  setCadets]  = useState([]);

  const activeCompany = filterCompany || myCompany;

  // Default canViewAll users to their company on mount.
  // Battalion HQ members (company = 'Zulu'|'Battalion') stay on the all-companies view.
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current && canViewAll && myCompany && !BATTALION_COMPANIES.includes(myCompany)) {
      setFilterCompany(myCompany);
      initRef.current = true;
    }
  }, [canViewAll, myCompany]);

  // ── Personal-view state ───────────────────────────────────────────────────────
  const [myRosterDocId,     setMyRosterDocId]     = useState(null);
  const [myRosterDocLoaded, setMyRosterDocLoaded] = useState(false);
  const [myEntries,         setMyEntries]         = useState([]);
  const [myDataLoading,     setMyDataLoading]     = useState(true);

  // Step 1 (personal view only): find my roster doc by linkedUid
  useEffect(() => {
    if (canViewFull || !user || authLoading) return;
    getDocs(query(collection(db, 'roster'), where('linkedUid', '==', user.uid)))
      .then(snap => {
        setMyRosterDocId(snap.empty ? null : snap.docs[0].id);
        setMyRosterDocLoaded(true);
      })
      .catch(() => setMyRosterDocLoaded(true));
  }, [canViewFull, user, authLoading]);

  // Step 2 (personal view only): subscribe to my entries once roster doc is known
  useEffect(() => {
    if (canViewFull || !myRosterDocLoaded) return;
    setMyDataLoading(true);

    let q;
    if (myRosterDocId) {
      q = query(collection(db, 'fundraiserEntries'), where('cadetId', '==', myRosterDocId));
    } else if (userData?.fullName) {
      // Fallback: match by cadet name (for users without a linkedUid on their roster doc)
      q = query(collection(db, 'fundraiserEntries'), where('cadetName', '==', userData.fullName));
    } else {
      setMyEntries([]);
      setMyDataLoading(false);
      return;
    }

    const unsub = onSnapshot(q, snap => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(e => !e.voided) // personal view never shows voided entries
        .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0));
      setMyEntries(all);
      setMyDataLoading(false);
    }, err => {
      console.error('personal fundraiser snapshot error:', err);
      setMyDataLoading(false);
    });

    return () => unsub();
  }, [canViewFull, myRosterDocId, myRosterDocLoaded, userData?.fullName]);

  // ── Full-view subscriptions ───────────────────────────────────────────────────
  useEffect(() => {
    if (!canViewFull || authLoading) return;
    setDataLoading(true);
    let q;
    if (canViewAll && !filterCompany) {
      q = query(collection(db, 'fundraiserEntries'));
    } else if (filterCompany === '_battalion') {
      q = query(collection(db, 'fundraiserEntries'), where('company', 'in', BATTALION_COMPANIES));
    } else if (activeCompany) {
      q = query(collection(db, 'fundraiserEntries'), where('company', '==', activeCompany));
    } else {
      setEntries([]); setDataLoading(false); return;
    }
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setDataLoading(false);
    }, err => { console.error('fundraiserEntries snapshot error:', err); setDataLoading(false); });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewFull, authLoading, filterCompany, activeCompany, canViewAll, role]);

  // ── Fundraiser goal + cross-company totals (full-access only) ────────────────
  const [allEntries,  setAllEntries]  = useState([]);
  const [allRoster,   setAllRoster]   = useState([]); // full battalion roster for goal calc

  useEffect(() => {
    if (!canViewFull) return;
    // Load all entries for cross-company totals/graph.
    // canViewAll users (battalion S1/S3, staff 70+) can query everything;
    // company-level users (XO, commander, 1SG) are scoped to own company so
    // Firestore security rules don't reject the subscription.
    const entriesQ = canViewAll
      ? collection(db, 'fundraiserEntries')
      : query(collection(db, 'fundraiserEntries'), where('company', '==', myCompany || ''));
    const unsubAll = onSnapshot(entriesQ, snap => {
      setAllEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setAllEntries([]));
    // Roster for per-company goal calculations — same scoping.
    const rosterQ = canViewAll
      ? query(collection(db, 'roster'))
      : query(collection(db, 'roster'), where('company', '==', myCompany || ''));
    const unsubRoster = onSnapshot(
      rosterQ,
      snap => setAllRoster(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setAllRoster([]),
    );
    return () => { unsubAll(); unsubRoster(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewFull, canViewAll, myCompany]);

  // Weeks from configured date range (falls back to FALLBACK_WEEKS if not set)
  const numWeeks = (fundraiserStart && fundraiserEnd)
    ? Math.max(1, Math.ceil((new Date(fundraiserEnd) - new Date(fundraiserStart)) / (7 * 24 * 60 * 60 * 1000)))
    : FALLBACK_WEEKS;

  // Which week of the fundraiser we are currently in (1-based, clamped to numWeeks)
  const today = new Date();
  const currentWeek = fundraiserStart
    ? Math.min(numWeeks, Math.max(1, Math.ceil((today - new Date(fundraiserStart)) / (7 * 24 * 60 * 60 * 1000))))
    : 1;

  // Per-company TOTAL flag goals (all weeks combined)
  const companyTotalGoals = useMemo(() => {
    const totals = {};
    allRoster.filter(c => !c.graduated).forEach(cadet => {
      const company = cadet.company;
      if (!company) return;
      const req = positionReqs[cadet.position] ?? defaultReq;
      totals[company] = (totals[company] || 0) + req;
    });
    return totals;
  }, [allRoster, positionReqs, defaultReq]);

  // Battalion-wide totals (sum of all companies)
  const bnTotalGoalFlags  = useMemo(() => Object.values(companyTotalGoals).reduce((s, v) => s + v, 0), [companyTotalGoals]);
  const bnWeeklyGoalFlags = useMemo(() => Math.ceil(bnTotalGoalFlags / numWeeks), [bnTotalGoalFlags, numWeeks]);

  // Per-company WEEKLY flag goals = total / numWeeks
  const companyGoals = useMemo(() => {
    const weekly = {};
    Object.keys(companyTotalGoals).forEach(co => {
      weekly[co] = Math.ceil(companyTotalGoals[co] / numWeeks);
    });
    return weekly;
  }, [companyTotalGoals, numWeeks]);

  // Per-company totals (non-voided) for the graph — in dollars raised
  const companyNames = companies;
  const companyTotals = useMemo(() => {
    const totals = {};
    allEntries.filter(e => !e.voided).forEach(e => {
      if (e.company) totals[e.company] = (totals[e.company] || 0) + (e.amount || 0);
    });
    return totals;
  }, [allEntries]);

  // Per-company, per-week breakdown (canViewAll only, requires fundraiserStart)
  const weeklyBreakdown = useMemo(() => {
    if (!canViewAll || !fundraiserStart) return null;
    const startMs = new Date(fundraiserStart + 'T00:00:00').getTime();
    const rows = {};
    [...companyNames, '_battalion'].forEach(co => { rows[co] = {}; });
    allEntries.filter(e => !e.voided && e.submittedAt?.toDate).forEach(e => {
      const ms = e.submittedAt.toDate().getTime();
      const wk = Math.min(numWeeks, Math.max(1, Math.ceil((ms - startMs) / (7 * 24 * 60 * 60 * 1000))));
      const co = BATTALION_COMPANIES.includes(e.company) ? '_battalion' : e.company;
      if (!rows[co]) return;
      rows[co][wk] = (rows[co][wk] || 0) + (e.amount || 0);
    });
    return rows;
  }, [canViewAll, allEntries, fundraiserStart, numWeeks, companyNames]);

  // ── Full-view: roster subscription ───────────────────────────────────────────
  useEffect(() => {
    if (!canViewFull) { setCadets([]); return; }
    if (filterCompany === '_battalion') {
      const q = query(
        collection(db, 'roster'),
        where('company', 'in', ['Battalion', 'Zulu']),
      );
      const unsub = onSnapshot(q, snap => {
        const docs = snap.docs
          .map(d => ({ uid: d.id, ...d.data() }))
          .filter(c => !c.graduated)
          .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
        setCadets(docs);
      });
      return () => unsub();
    }
    if (canViewAll && !filterCompany) {
      // All-companies view: load every cadet so the modal can search across the battalion
      const q = query(collection(db, 'roster'), orderBy('fullName', 'asc'));
      const unsub = onSnapshot(q, snap => {
        setCadets(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
      });
      return () => unsub();
    }
    if (!activeCompany) { setCadets([]); return; }
    const q = query(
      collection(db, 'roster'),
      where('company', '==', activeCompany),
      orderBy('fullName', 'asc'),
    );
    const unsub = onSnapshot(q, snap => {
      setCadets(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [canViewFull, canViewAll, filterCompany, activeCompany]);

  // ── Full-view computed ────────────────────────────────────────────────────────
  const displayEntries = useMemo(() => {
    const filtered = (canViewAll && !filterCompany)
      ? entries
      : filterCompany === '_battalion'
        ? entries.filter(e => BATTALION_COMPANIES.includes(e.company))
        : entries.filter(e => e.company === activeCompany);
    return [...filtered].sort((a, b) => {
      const ta = a.submittedAt?.seconds ?? 0;
      const tb = b.submittedAt?.seconds ?? 0;
      return tb - ta;
    });
  }, [entries, activeCompany, canViewAll, filterCompany]);

  const activeEntries = useMemo(() => displayEntries.filter(e => !e.voided), [displayEntries]);
  const totalAmount   = useMemo(() => activeEntries.reduce((s, e) => s + (e.amount || 0), 0), [activeEntries]);
  const totalFlags    = useMemo(() => activeEntries.reduce((s, e) => s + (e.flags  || 0), 0), [activeEntries]);

  const rosterAggregated = useMemo(() => {
    const byId = {};
    activeEntries.forEach(e => {
      const key = e.cadetId === 'manual' ? `manual_${e.cadetName}` : e.cadetId;
      if (!byId[key]) byId[key] = { cadetId: e.cadetId, cadetName: e.cadetName, company: e.company, total: 0, flags: 0, count: 0, lastAt: null };
      byId[key].total += e.amount || 0;
      byId[key].flags += e.flags  || 0;
      byId[key].count += 1;
      if (!byId[key].lastAt || (e.submittedAt?.seconds > byId[key].lastAt?.seconds)) {
        byId[key].lastAt = e.submittedAt;
      }
    });
    const viewingAll = canViewAll && !filterCompany;
    const rosterSource = viewingAll
      ? allRoster.filter(r => !r.graduated).map(r => ({ uid: r.id, fullName: r.fullName, company: r.company, rank: r.rank, letLevel: r.letLevel }))
      : filterCompany === '_battalion'
        ? allRoster.filter(r => !r.graduated && BATTALION_COMPANIES.includes(r.company)).map(r => ({ uid: r.id, fullName: r.fullName, company: r.company, rank: r.rank, letLevel: r.letLevel || '' }))
        : cadets.map(c => ({ ...c, letLevel: c.letLevel || '' }));
    const result = rosterSource.map(c => ({
      uid: c.uid, fullName: c.fullName, company: c.company, rank: c.rank, letLevel: c.letLevel || '',
      ...(byId[c.uid] || { total: 0, flags: 0, count: 0, lastAt: null }),
    }));
    Object.values(byId).forEach(agg => {
      if (agg.cadetId === 'manual' && !result.find(r => r.uid === agg.cadetId)) {
        result.push({ uid: 'manual', fullName: agg.cadetName, company: agg.company, rank: '', letLevel: '', ...agg });
      }
    });
    return result.sort((a, b) => b.total - a.total || (a.fullName || '').localeCompare(b.fullName || ''));
  }, [activeEntries, cadets, allRoster, canViewAll, filterCompany]);

  // ── Top-3 donors per company + overall (uses allEntries so it works for canViewAll) ──
  const topDonors = useMemo(() => {
    if (!canViewAll) return null;
    const src = allEntries.filter(e => !e.voided);
    const byIdAll = {};
    src.forEach(e => {
      const key = e.cadetId && e.cadetId !== 'manual' ? e.cadetId : `manual_${e.cadetName}`;
      if (!byIdAll[key]) byIdAll[key] = { name: e.cadetName, company: e.company, total: 0 };
      byIdAll[key].total += e.amount || 0;
    });
    const all = Object.values(byIdAll).filter(d => d.total > 0).sort((a, b) => b.total - a.total);
    const byCompany = {};
    all.forEach(d => {
      if (!byCompany[d.company]) byCompany[d.company] = [];
      if (byCompany[d.company].length < 3) byCompany[d.company].push(d);
    });
    return { byCompany, top3Overall: all.slice(0, 3), totalRaised: all.reduce((s, d) => s + d.total, 0) };
  }, [allEntries, canViewAll]);

  // ── Personal-view computed ────────────────────────────────────────────────────
  const myTotal = useMemo(() => myEntries.reduce((s, e) => s + (e.amount || 0), 0), [myEntries]);
  const myFlags = useMemo(() => myEntries.reduce((s, e) => s + (e.flags  || 0), 0), [myEntries]);

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const showToast = useCallback(msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Fundraiser roster print ────────────────────────────────────────────────────
  const FUNDRAISER_PRINT_COL_DEFS = [
    { key: 'total',       label: 'Total Raised',  getValue: c => c.total > 0 ? `$${c.total.toFixed(2)}` : '' },
    { key: 'flags',       label: 'Flags Earned',  getValue: c => c.flags  > 0 ? String(c.flags)          : '' },
    { key: 'count',       label: '# Payments',    getValue: c => c.count  > 0 ? String(c.count)          : '' },
    { key: 'lastPayment', label: 'Last Payment',  getValue: c => c.lastAt?.toDate ? c.lastAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '' },
    { key: 'blank',       label: '',              getValue: () => '' },
  ];

  const handlePrintFundRoster = () => {
    const selectedColDefs = FUNDRAISER_PRINT_COL_DEFS.filter(d => printFundCols.includes(d.key));
    const cols = selectedColDefs.length > 0 ? selectedColDefs : null;

    let rosterForPrint = [...rosterAggregated];

    // Optionally merge battalion leadership cadets who observe the selected company
    if (printFundIncludeBn && canViewAll && filterCompany && filterCompany !== '_battalion') {
      const bnCadetsList = allRoster.filter(r => !r.graduated && BATTALION_COMPANIES.includes(r.company) && r.secondaryCompany === filterCompany);
      const bnEntriesList = allEntries.filter(e => !e.voided && BATTALION_COMPANIES.includes(e.company));
      const byId = {};
      bnEntriesList.forEach(e => {
        const key = e.cadetId === 'manual' ? `manual_${e.cadetName}` : e.cadetId;
        if (!byId[key]) byId[key] = { cadetId: e.cadetId, cadetName: e.cadetName, company: e.company, total: 0, flags: 0, count: 0, lastAt: null };
        byId[key].total += e.amount || 0;
        byId[key].flags += e.flags  || 0;
        byId[key].count += 1;
        if (!byId[key].lastAt || (e.submittedAt?.seconds > byId[key].lastAt?.seconds)) {
          byId[key].lastAt = e.submittedAt;
        }
      });
      const bnRows = bnCadetsList.map(c => ({
        uid: c.uid || c.id, fullName: c.fullName, company: c.company, rank: c.rank, letLevel: c.letLevel || '',
        ...(byId[c.uid || c.id] || { total: 0, flags: 0, count: 0, lastAt: null }),
      }));
      const existingUids = new Set(rosterForPrint.map(r => r.uid));
      bnRows.filter(r => !existingUids.has(r.uid)).forEach(r => rosterForPrint.push(r));
    }

    const label = canViewAll && !filterCompany ? 'All Companies'
      : filterCompany === '_battalion' ? 'Battalion HQ'
      : filterCompany ? `${filterCompany} Company`
      : `${activeCompany} Company`;
    printRoster(rosterForPrint, `${label} Fundraiser Roster`, cols ? { columns: cols } : undefined);
    setShowPrintOptions(false);
  };

  const handleExportFundraiser = () => {
    const rows = entries
      .filter(e => !e.voided)
      .map(e => ({
        cadetName: e.cadetName || '',
        company: e.company || '',
        paymentType: e.paymentType || '',
        amount: e.amount ?? '',
        flags: Math.floor((parseFloat(e.amount) || 0) / 2),
        orderNumber: e.orderNumber || '',
        orderDate: e.orderDate || '',
        notes: e.notes || '',
      }));
    const company = (filterCompany || activeCompany || 'all').toLowerCase().replace(/\s+/g, '_');
    exportCSV(rows, `fundraiser_${company}_${new Date().toISOString().slice(0,10)}.csv`, [
      { key: 'cadetName',   label: 'Cadet Name' },
      { key: 'company',     label: 'Company' },
      { key: 'paymentType', label: 'Payment Type' },
      { key: 'amount',      label: 'Amount ($)' },
      { key: 'flags',       label: 'Flags Earned' },
      { key: 'orderNumber', label: 'Order #' },
      { key: 'orderDate',   label: 'Order Date' },
      { key: 'notes',       label: 'Notes' },
    ]);
  };

  // ── Save payment ──────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();

    // ── E-Store path (multi-cadet split, duplicate check, order date) ───────────
    if (form.paymentType === 'estore') {
      const on = form.orderNumber.trim();
      if (!on) { showToast('Enter an order number.'); return; }
      if (!ORDER_NUMBER_RE.test(on)) { showToast('Order # format: 1112011-##########'); return; }
      if (!form.orderDate) { showToast('Enter the order date.'); return; }
      if (!form.amount || Number(form.amount) <= 0) { showToast('Enter a valid amount.'); return; }
      if (splitCadets.length === 0) { showToast('Add at least one cadet.'); return; }

      setSaving(true);
      try {
        // Duplicate order number check (skip voided entries)
        const dupSnap = await getDocs(query(collection(db, 'fundraiserEntries'), where('orderNumber', '==', on)));
        if (dupSnap.docs.some(d => !d.data().voided)) {
          showToast('Order # already logged — use a different number.');
          setSaving(false);
          return;
        }

        // Cents-accurate split
        const totalAmt   = parseFloat(form.amount);
        const n          = splitCadets.length;
        const totalCents = Math.round(totalAmt * 100);
        const perCents   = Math.floor(totalCents / n);
        const extraCents = totalCents - perCents * n;

        await Promise.all(splitCadets.map((sc, i) => {
          const amtCents = perCents + (i === 0 ? extraCents : 0);
          const amt      = amtCents / 100;
          const flags    = toFlags(amt);
          const cadet    = cadets.find(c => c.uid === sc.cadetId);
          const company  = cadet?.company || sc.company ||
            (canViewAll && !filterCompany ? modalCompany : activeCompany);
          const linkedUid = cadet?.linkedUid || null;
          return addDoc(collection(db, 'fundraiserEntries'), {
            company, cadetId: sc.cadetId || 'manual', cadetName: sc.cadetName,
            paymentType: 'estore', amount: amt, flags,
            notes: form.notes.trim() || null,
            orderNumber: on, orderDate: form.orderDate,
            splitCount: n, linkedUid,
            submittedByUid: user.uid, submittedByName: userData?.fullName || '',
            submittedAt: serverTimestamp(), createdAt: serverTimestamp(),
          });
        }));

        const names = splitCadets.map(sc => sc.cadetName).join(', ');
        showToast(n === 1 ? 'E-Store payment logged' : `E-Store split ${n} ways`);
        setShowModal(false);
        setForm(EMPTY_FORM);
        setModalCompany('');
        setSplitCadets([]);
        setSplitSearchKey(k => k + 1);
        writeLog({
          type: 'fundraiser', action: 'create',
          description: `Logged e-store #${on} $${totalAmt.toFixed(2)} split ${n} way${n !== 1 ? 's' : ''}: ${names}`,
          userId: user?.uid || '', userFullName: userData?.fullName || '',
          userRole: role || '', targetName: names,
          notes: `orderDate:${form.orderDate}`,
        });
      } catch (err) {
        console.error(err);
        showToast('Save failed — try again');
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── Cash / Check path ────────────────────────────────────────────────────────
    const paymentCompany = (canViewAll && !filterCompany)
      ? (form.cadetId !== 'manual' ? (cadets.find(c => c.uid === form.cadetId)?.company || '') : modalCompany)
      : activeCompany;
    const name = form.cadetId === 'manual'
      ? form.cadetName.trim()
      : (cadets.find(c => c.uid === form.cadetId)?.fullName || form.cadetName.trim());
    if (!name) { showToast('Select or enter a cadet name.'); return; }
    if (!form.amount || Number(form.amount) <= 0) { showToast('Enter a valid amount.'); return; }
    if (!paymentCompany) { showToast('Select a company.'); return; }

    setSaving(true);
    try {
      const amt   = parseFloat(form.amount);
      const flags = toFlags(amt);
      const linkedUid = form.cadetId !== 'manual'
        ? (cadets.find(c => c.uid === form.cadetId)?.linkedUid || null)
        : null;
      await addDoc(collection(db, 'fundraiserEntries'), {
        company: paymentCompany, cadetId: form.cadetId || 'manual', cadetName: name,
        paymentType: form.paymentType, amount: amt, flags,
        notes: form.notes.trim() || null, orderNumber: null,
        linkedUid,
        submittedByUid: user.uid, submittedByName: userData?.fullName || '',
        submittedAt: serverTimestamp(), createdAt: serverTimestamp(),
      });
      showToast('Payment logged');
      setShowModal(false);
      setForm(EMPTY_FORM);
      setModalCompany('');
      writeLog({
        type: 'fundraiser', action: 'create',
        description: `Logged payment for ${name}: $${amt} (${form.paymentType})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: name,
        notes: `company:${paymentCompany}`,
      });
    } catch (err) {
      console.error(err);
      showToast('Save failed — try again');
    } finally {
      setSaving(false);
    }
  };

  // ── Void (soft-delete) ────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteConf) return;
    try {
      await updateDoc(doc(db, 'fundraiserEntries', deleteConf.id), {
        voided:        true,
        voidedAt:      serverTimestamp(),
        voidedByUid:   user.uid,
        voidedByName:  userData?.fullName || '',
      });
      setDeleteConf(null);
      showToast('Entry voided');
      writeLog({
        type: 'fundraiser', action: 'void',
        description: `Voided payment entry for ${deleteConf.cadetName}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConf.id, targetName: deleteConf.cadetName,
      });
    } catch (err) {
      console.error(err);
      showToast('Void failed — try again');
    }
  };

  // ── Save fundraiser settings ──────────────────────────────────────────────────
  const handleOpenSettings = () => {
    setEditReqs(Object.fromEntries(Object.entries(positionReqs).map(([k, v]) => [k, String(v)])));
    setEditStart(fundraiserStart);
    setEditEnd(fundraiserEnd);
    setEditDefaultReq(String(defaultReq));
    setActiveTab('settings');
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      await setDoc(doc(db, 'settings', 'fundraiserGoal'), {
        startDate: editStart,
        endDate:   editEnd,
        positionRequirements: Object.fromEntries(
          Object.entries(editReqs).map(([k, v]) => [k, Number(v) || 0])
        ),
        defaultRequirement: Number(editDefaultReq) || DEFAULT_FLAG_REQUIREMENT,
      }, { merge: true });
      writeLog({
        type: 'fundraiser', action: 'settings',
        description: `Updated fundraiser requirements: ${editStart} → ${editEnd}, ${Object.keys(editReqs).length} positions`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
      showToast('Settings saved');
      setActiveTab('transactions');
    } catch (err) {
      console.error(err);
      showToast('Save failed — try again');
    } finally {
      setSavingSettings(false);
    }
  };

  // ── Migrate order numbers from notes → orderNumber field ─────────────────────
  const handleMigrateOrderNumbers = async () => {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const snap = await getDocs(collection(db, 'fundraiserEntries'));
      const updates = [];
      let migrated = 0;
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.orderNumber) return;
        if (!data.notes) return;
        const match = data.notes.match(ORDER_NUMBER_SCAN_RE);
        if (!match) return;
        const orderNumber = match[0].toUpperCase();
        const cleanedNotes = data.notes.replace(ORDER_NUMBER_SCAN_RE, '').replace(/^[\s,;·\-–—]+|[\s,;·\-–—]+$/g, '').trim() || null;
        updates.push(updateDoc(doc(db, 'fundraiserEntries', d.id), { orderNumber, notes: cleanedNotes }));
        migrated++;
      });
      await Promise.all(updates);
      setMigrateResult(`Migrated ${migrated} entr${migrated !== 1 ? 'ies' : 'y'}.`);
      writeLog({
        type: 'fundraiser', action: 'settings',
        description: `Migrated ${migrated} e-store order numbers from notes to orderNumber field`,
        userId: user?.uid || '', userFullName: userData?.fullName || '', userRole: role || '',
      });
    } catch (err) {
      console.error(err);
      setMigrateResult('Migration failed — check console.');
    } finally {
      setMigrating(false);
    }
  };

  // ── Loading gate ──────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="animate-spin text-yellow-500" size={40} />
    </div>
  );

  const liveFlags = toFlags(parseFloat(form.amount) || 0);

  // ── PERSONAL VIEW ─────────────────────────────────────────────────────────────
  if (!canViewFull) {
    const displayName = userData?.fullName || userData?.name || 'Cadet';

    return (
      <div className="flex-1 p-6 md:p-10 w-full">
        <AdminPageHeader icon={DollarSign} title="Fundraiser" />

          {myDataLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-4 mb-8">
                <SummaryCard
                  icon={<DollarSign size={18} className="text-green-500" />}
                  label="Total Raised"
                  value={`$${myTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                />
                <SummaryCard
                  icon={<Flag size={18} className="text-yellow-500" />}
                  label="Total Flags"
                  value={myFlags.toLocaleString()}
                />
              </div>

              {/* My entries list */}
              {myEntries.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
                  <Heart className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
                  <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No payments recorded yet</p>
                  <p className="text-slate-400 text-xs mt-2 max-w-xs mx-auto">
                    Once your company leadership logs a donation for you, it will appear here.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 dark:text-slate-500 mb-3 px-1">
                    Payment History
                  </p>
                  <div className="overflow-x-auto rounded-2xl border border-blue-100 dark:border-white/5 shadow-sm">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5">
                          {['Date', 'Payment', 'Amount', 'Flags', 'Notes'].map(h => (
                            <th key={h} className="text-left p-3 font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {myEntries.map((entry, idx) => (
                          <tr key={entry.id} className={`border-b border-slate-100 dark:border-white/5 ${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-white/[0.02]'}`}>
                            <td className="p-3 text-slate-400 whitespace-nowrap">
                              {entry.submittedAt?.toDate
                                ? entry.submittedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                : '—'}
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${PAYMENT_COLORS[entry.paymentType] || 'bg-slate-100'}`}>
                                {PAYMENT_TYPES.find(t => t.key === entry.paymentType)?.icon}
                                {PAYMENT_TYPES.find(t => t.key === entry.paymentType)?.label || entry.paymentType}
                              </span>
                            </td>
                            <td className="p-3 font-black text-green-600 dark:text-green-400 whitespace-nowrap">
                              ${(entry.amount || 0).toFixed(2)}
                            </td>
                            <td className="p-3 font-black text-yellow-600 dark:text-yellow-400">
                              {entry.flags ?? toFlags(entry.amount)}
                            </td>
                            <td className="p-3 max-w-[180px]">
                              {entry.orderNumber && (
                                <p className="text-[9px] font-black font-mono text-yellow-600 dark:text-yellow-500 mb-0.5 truncate">{entry.orderNumber}</p>
                              )}
                              <span className="text-slate-500 dark:text-slate-400 truncate block">{entry.notes || (entry.orderNumber ? null : '—')}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

      </div>
    );
  }

  // ── FULL VIEW (Transactions + Roster tabs) ────────────────────────────────────
  return (
    <div className="flex-1 p-6 md:p-10 w-full">
      <AdminPageHeader icon={DollarSign} title="Fundraiser" />

        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          {/* Fundraiser open/close toggle — S1/S3/staff only */}
          {canOpenFundraiser ? (
            <button
              onClick={handleToggleFundraiser}
              disabled={togglingOpen}
              className={`flex items-center gap-2 font-black text-xs uppercase tracking-widest px-4 py-2.5 rounded-xl transition-all border ${
                fundraiserIsOpen
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/5 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {togglingOpen ? <Loader2 size={13} className="animate-spin" /> : fundraiserIsOpen ? <Unlock size={13} /> : <Lock size={13} />}
              {fundraiserIsOpen ? 'Fundraiser Open' : 'Fundraiser Closed'}
            </button>
          ) : isCompanyInput && !fundraiserIsOpen ? (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/5">
              <Lock size={13} className="text-slate-400" />
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Fundraiser not yet open — S1/S3 will open it when ready
              </p>
            </div>
          ) : <span />}

          {/* Log Payment button — company input only when open; S1/S3 always */}
          {canLogPayment && activeCompany && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-5 py-3 rounded-xl transition-all shadow-lg shadow-yellow-500/20"
            >
              <Plus size={16} /> Log Payment
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { key: 'transactions', label: 'Transactions', icon: <ReceiptText  size={15} /> },
            { key: 'roster',       label: 'Roster',       icon: <Users        size={15} /> },
            ...(canViewFull ? [{ key: 'goals',  label: 'Goals',   icon: <Target       size={15} /> }] : []),
            ...(canViewAll  ? [{ key: 'weekly',      label: 'Weekly',      icon: <CalendarDays size={15} /> }] : []),
            ...(canEditSettings   ? [{ key: 'settings', label: 'Settings', icon: <SlidersHorizontal size={15} /> }] : []),
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { if (tab.key === 'settings') { handleOpenSettings(); } else { setActiveTab(tab.key); setSearchQuery(''); } }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                activeTab === tab.key
                  ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                  : 'bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500/30'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Company filter + search bar */}
        {(canViewAll || (activeTab === 'transactions' || activeTab === 'roster')) && (
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            {canViewAll && (
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-2 shadow-sm">
                <Filter size={13} className="text-slate-400" />
                <select
                  value={filterCompany}
                  onChange={e => setFilterCompany(e.target.value)}
                  className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2"
                >
                  <option value="">All Companies</option>
                  {myCompany && !companies.includes(myCompany) && !BATTALION_COMPANIES.includes(myCompany) && <option key={myCompany}>{myCompany}</option>}
                  {companies.map(c => <option key={c}>{c}</option>)}
                  <option value="_battalion">Battalion HQ</option>
                </select>
              </div>
            )}
            {(activeTab === 'transactions' || activeTab === 'roster') && (
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-2 shadow-sm flex-1 min-w-[200px] max-w-sm">
                <Search size={13} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={activeTab === 'transactions' ? 'Name, company, order #…' : 'Name or company…'}
                  className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none w-full placeholder:text-slate-400 dark:placeholder:text-slate-600"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0">
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Company Performance Graph (battalion staff / canViewAll only) ── */}
        {canViewAll && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6 mb-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
              <div>
                <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest flex items-center gap-2">
                  <BarChart3 size={14} /> Company Performance
                </h3>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                  {fundraiserStart && fundraiserEnd
                    ? `${new Date(fundraiserStart).toLocaleDateString('en-US',{month:'short',day:'numeric'})} → ${new Date(fundraiserEnd).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · ${numWeeks} wk${numWeeks!==1?'s':''}`
                    : `Goals auto-calculated from roster positions (÷ ${numWeeks} weeks)`}
                  {canEditSettings && (
                    <button onClick={handleOpenSettings} className="ml-3 text-yellow-600 dark:text-yellow-500 hover:underline font-black">Edit</button>
                  )}
                </p>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                <div className="w-3 h-3 rounded-sm bg-emerald-500" /> Companies (% of goal)
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                <div className="w-3 h-3 rounded-sm bg-yellow-500" /> Battalion HQ (% of goal)
              </div>
            </div>

            {/* Bars — lettered companies first, then Battalion HQ as a separate group */}
            {(() => {
              const bnTotal = allEntries.filter(e => !e.voided && BATTALION_COMPANIES.includes(e.company))
                .reduce((s, e) => s + (e.amount || 0), 0);
              const bnGoalFlags = BATTALION_COMPANIES.reduce((s, co) => s + (companyTotalGoals[co] || 0), 0);
              const bnGoalDollars = bnGoalFlags * 2;

              const allBars = [
                ...companyNames.map(co => ({ co, label: co, actual: companyTotals[co] || 0, goalFlags: companyTotalGoals[co] || 0, isBn: false })),
                ...(bnTotal > 0 || bnGoalDollars > 0 ? [{ co: '_battalion', label: 'Battalion', actual: bnTotal, goalFlags: bnGoalFlags, isBn: true }] : []),
              ];

              return (
                <div className="space-y-4">
                  {allBars.map(({ co, label, actual, goalFlags, isBn }) => {
                    const goalDollars = goalFlags * 2;
                    const pct = goalDollars > 0 ? Math.min((actual / goalDollars) * 100, 100) : 0;
                    const ahead = actual >= goalDollars && goalDollars > 0;
                    return (
                      <div key={co}>
                        {isBn && <div className="border-t border-dashed border-slate-200 dark:border-white/5 mt-3 mb-4" />}
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black uppercase ${isBn ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-600 dark:text-slate-400'}`}>
                              {label}{isBn && ' · HQ'}
                            </span>
                            {goalFlags > 0 && (
                              <span className="text-[9px] text-slate-400 dark:text-slate-500">
                                Goal: {goalFlags.toLocaleString()} flags (${goalDollars.toLocaleString()})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black tabular-nums ${ahead ? 'text-emerald-600 dark:text-emerald-400' : isBn ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-500 dark:text-slate-400'}`}>
                              {pct.toFixed(0)}%{ahead && ' ✓'}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                              ${actual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                        <div className="relative h-4">
                          <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${isBn ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Summary bar */}
        {(activeCompany || (canViewAll && !filterCompany)) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
            <SummaryCard icon={<DollarSign size={18} className="text-green-500" />} label="Total Raised" value={`$${totalAmount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`} />
            <SummaryCard icon={<Flag size={18} className="text-yellow-500" />} label="Total Flags" value={totalFlags.toLocaleString()} />
            <SummaryCard icon={<ReceiptText size={18} className="text-blue-500" />} label="Active Payments" value={activeEntries.length.toLocaleString()} />
          </div>
        )}

        {/* Goals bar — shows battalion totals for "All Companies", company totals otherwise */}
        {(() => {
          const viewingAll  = canViewAll && !filterCompany;
          const isBnFilter  = filterCompany === '_battalion';
          const bnHQGoalFlags = BATTALION_COMPANIES.reduce((s, co) => s + (companyTotalGoals[co] || 0), 0);
          const goalFlags   = viewingAll ? bnTotalGoalFlags   : isBnFilter ? bnHQGoalFlags : (companyTotalGoals[activeCompany] || 0);
          const weeklyFlags = viewingAll ? bnWeeklyGoalFlags  : isBnFilter ? Math.ceil(bnHQGoalFlags / numWeeks) : (companyGoals[activeCompany] || 0);
          const label       = viewingAll ? 'Battalion Goals'  : isBnFilter ? 'Battalion HQ Goals' : `${activeCompany} Goals`;
          if (!goalFlags) return null;
          return (
          <div className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-2xl px-5 py-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
              <Target size={14} />
              <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500">Total (all {numWeeks} wk{numWeeks!==1?'s':''})</p>
              <p className="text-sm font-black text-slate-900 dark:text-white">
                {goalFlags.toLocaleString()} flags
                <span className="text-slate-400 dark:text-slate-500 font-normal ml-1.5">= ${(goalFlags * 2).toLocaleString()}</span>
              </p>
            </div>
            <div className="border-l border-slate-200 dark:border-white/10 pl-6">
              <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500">Weekly Target</p>
              <p className="text-sm font-black text-yellow-600 dark:text-yellow-400">
                {weeklyFlags.toLocaleString()} flags/wk
                <span className="text-slate-400 dark:text-slate-500 font-normal ml-1.5">= ${(weeklyFlags * 2).toLocaleString()}/wk</span>
              </p>
            </div>
            {fundraiserStart && fundraiserEnd && (
              <div className="border-l border-slate-200 dark:border-white/10 pl-6">
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500">Period</p>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {new Date(fundraiserStart).toLocaleDateString('en-US',{month:'short',day:'numeric'})} → {new Date(fundraiserEnd).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                </p>
              </div>
            )}
          </div>
          );
        })()}


        {/* ── TRANSACTIONS TAB ── */}
        {activeTab === 'transactions' && (() => {
          const sq = searchQuery.trim().toLowerCase();
          const visibleEntries = sq
            ? displayEntries.filter(e =>
                (e.cadetName || '').toLowerCase().includes(sq) ||
                (e.company   || '').toLowerCase().includes(sq) ||
                (e.orderNumber || '').toLowerCase().includes(sq) ||
                (e.notes || '').toLowerCase().includes(sq)
              )
            : displayEntries;
          return (
          dataLoading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(n => <div key={n} className="h-14 bg-slate-100 dark:bg-slate-900/60 rounded-xl animate-pulse" />)}
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
              <DollarSign className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">
                {sq ? 'No matching payments' : 'No payments logged yet'}
              </p>
              {!sq && canLogPayment && activeCompany && <button onClick={() => setShowModal(true)} className="mt-4 text-yellow-500 text-xs font-black uppercase hover:text-yellow-400">+ Log first payment</button>}
            </div>
          ) : (
            <>
              <div className="flex justify-end mb-3">
                <button
                  onClick={handleExportFundraiser}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-slate-200 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500 hover:text-yellow-600"
                >
                  <Download size={13} /> Export CSV
                </button>
              </div>
            <div className="overflow-x-auto rounded-2xl border border-blue-100 dark:border-white/5 shadow-sm">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5">
                    {['Cadet', 'Payment', 'Amount', 'Flags', 'Notes', 'Logged By', 'Date/Time', ''].map(h => (
                      <th key={h} className="text-left p-3 font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((entry, idx) => {
                    const isVoided = !!entry.voided;
                    return (
                      <tr
                        key={entry.id}
                        className={`border-b border-slate-100 dark:border-white/5 transition-colors ${
                          isVoided
                            ? 'opacity-50 bg-red-50/40 dark:bg-red-900/10'
                            : idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-white/[0.02]'
                        }`}
                      >
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {isVoided && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-[9px] font-black uppercase tracking-widest shrink-0">
                                <Ban size={8} /> Void
                              </span>
                            )}
                            <span className={`font-black ${isVoided ? 'line-through text-slate-400 dark:text-slate-600' : 'text-slate-900 dark:text-white'}`}>
                              {entry.cadetName}
                            </span>
                            {canViewAll && filterCompany === '' && (
                              <span className="text-[9px] font-bold text-slate-400">{normalizeCompany(entry.company)}</span>
                            )}
                          </div>
                          {isVoided && entry.voidedByName && (
                            <p className="text-[9px] text-red-500/70 dark:text-red-400/60 mt-0.5">
                              Voided by {entry.voidedByName}
                              {entry.voidedAt?.toDate ? ` · ${entry.voidedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                            </p>
                          )}
                        </td>
                        <td className="p-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${isVoided ? 'opacity-40 grayscale' : ''} ${PAYMENT_COLORS[entry.paymentType] || 'bg-slate-100'}`}>
                            {PAYMENT_TYPES.find(t => t.key === entry.paymentType)?.icon}
                            {PAYMENT_TYPES.find(t => t.key === entry.paymentType)?.label || entry.paymentType}
                          </span>
                        </td>
                        <td className={`p-3 font-black whitespace-nowrap ${isVoided ? 'line-through text-slate-400 dark:text-slate-600' : 'text-green-600 dark:text-green-400'}`}>
                          ${(entry.amount || 0).toFixed(2)}
                        </td>
                        <td className={`p-3 font-black whitespace-nowrap ${isVoided ? 'line-through text-slate-400 dark:text-slate-600' : 'text-yellow-600 dark:text-yellow-400'}`}>
                          {entry.flags ?? toFlags(entry.amount)}
                        </td>
                        <td className="p-3 max-w-[180px]">
                          {entry.orderNumber && (
                            <p className="text-[9px] font-black font-mono text-yellow-600 dark:text-yellow-500 mb-0.5 truncate">{entry.orderNumber}</p>
                          )}
                          <span className="text-slate-500 dark:text-slate-400 truncate block">{entry.notes || (entry.orderNumber ? null : '—')}</span>
                        </td>
                        <td className="p-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">{entry.submittedByName || '—'}</td>
                        <td className="p-3 text-slate-400 whitespace-nowrap">
                          {entry.submittedAt?.toDate
                            ? entry.submittedAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </td>
                        <td className="p-3">
                          {canDelete && !isVoided && (
                            <button
                              onClick={() => setDeleteConf({ id: entry.id, cadetName: entry.cadetName, amount: entry.amount })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                              title="Void entry"
                            >
                              <Ban size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )
        );})()}

        {/* ── ROSTER TAB ── */}
        {activeTab === 'roster' && (() => {
          const viewingAll = canViewAll && !filterCompany;
          const colHeaders = ['Rank', 'Cadet', ...(viewingAll ? ['Company'] : []), 'Total Raised', 'Total Flags', 'Payments', 'Last Payment'];
          const sq = searchQuery.trim().toLowerCase();
          const visibleRoster = sq
            ? rosterAggregated.filter(c =>
                (c.fullName || '').toLowerCase().includes(sq) ||
                (c.company  || '').toLowerCase().includes(sq)
              )
            : rosterAggregated;

          const RosterRow = ({ cadet, idx }) => (
            <tr key={`${cadet.uid}_${cadet.fullName}`} className={`border-b border-slate-100 dark:border-white/5 ${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-white/[0.02]'}`}>
              <td className="p-3 text-slate-400">{cadet.rank || '—'}</td>
              <td className="p-3 font-black text-slate-900 dark:text-white">{cadet.fullName}</td>
              {viewingAll && <td className="p-3 text-slate-500">{cadet.company || '—'}</td>}
              <td className="p-3">
                <span className={`font-black ${cadet.total > 0 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
                  ${cadet.total.toFixed(2)}
                </span>
              </td>
              <td className="p-3">
                <span className={`font-black ${cadet.flags > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-400'}`}>
                  {cadet.flags > 0 ? cadet.flags : '—'}
                </span>
              </td>
              <td className="p-3 text-slate-500 dark:text-slate-400">{cadet.count || 0}</td>
              <td className="p-3 text-slate-400">
                {cadet.lastAt?.toDate
                  ? cadet.lastAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '—'}
              </td>
            </tr>
          );

          return dataLoading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(n => <div key={n} className="h-14 bg-slate-100 dark:bg-slate-900/60 rounded-xl animate-pulse" />)}
            </div>
          ) : visibleRoster.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
              <Users className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">
                {sq ? 'No matching cadets' : 'No cadets in roster'}
              </p>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <button
                  onClick={() => setGroupLet(g => !g)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                    groupLet
                      ? 'bg-yellow-500 text-slate-950'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  <GraduationCap size={12} /> Group by LET
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowPrintOptions(o => !o)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    <Printer size={12} /> Print Roster
                  </button>
                  {showPrintOptions && (
                    <div className="absolute left-0 top-full mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl p-4 min-w-[220px]">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Columns to Include</p>
                      <div className="space-y-2 mb-3">
                        {FUNDRAISER_PRINT_COL_DEFS.map(col => (
                          <label key={col.key} className="flex items-center gap-2.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={printFundCols.includes(col.key)}
                              onChange={e => setPrintFundCols(prev =>
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
                      {canViewAll && filterCompany && filterCompany !== '_battalion' && (
                        <div className="border-t border-slate-100 dark:border-white/5 pt-3 mb-3">
                          <label className="flex items-center gap-2.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={printFundIncludeBn}
                              onChange={e => setPrintFundIncludeBn(e.target.checked)}
                              className="accent-yellow-500 w-3.5 h-3.5"
                            />
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                              Include Battalion Leadership
                            </span>
                          </label>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handlePrintFundRoster}
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
              </div>
              <div className="overflow-x-auto rounded-2xl border border-blue-100 dark:border-white/5 shadow-sm">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5">
                      {colHeaders.map(h => (
                        <th key={h} className="text-left p-3 font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupLet
                      ? groupByLet(visibleRoster, c => c.letLevel, c => c.fullName).map(({ level, entries: group }) => (
                          <React.Fragment key={level}>
                            <tr className="bg-slate-100 dark:bg-white/5">
                              <td colSpan={colHeaders.length} className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                {level}
                              </td>
                            </tr>
                            {group.map((cadet, idx) => <RosterRow key={`${cadet.uid}_${cadet.fullName}`} cadet={cadet} idx={idx} />)}
                          </React.Fragment>
                        ))
                      : visibleRoster.map((cadet, idx) => <RosterRow key={`${cadet.uid}_${cadet.fullName}`} cadet={cadet} idx={idx} />)
                    }
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}


      {/* ── GOALS TAB ── */}
      {activeTab === 'goals' && canViewFull && (
        <div className="space-y-6">
          {/* Fundraiser period summary */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 flex flex-wrap gap-6 items-center">
            <div className="flex items-center gap-3">
              <CalendarDays size={20} className="text-yellow-500 flex-shrink-0" />
              <div>
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest">Fundraiser Period</p>
                {fundraiserStart && fundraiserEnd ? (
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {new Date(fundraiserStart).toLocaleDateString('en-US',{month:'long',day:'numeric'})} → {new Date(fundraiserEnd).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}
                    <span className="ml-2 text-yellow-600 dark:text-yellow-500 font-black">({numWeeks} wk{numWeeks !== 1 ? 's' : ''} · Wk {currentWeek} now)</span>
                  </p>
                ) : (
                  <p className="text-sm text-slate-400 italic">Not configured{canEditSettings ? ' — ' : ''}{canEditSettings && <button onClick={handleOpenSettings} className="text-yellow-500 hover:underline font-black">Set dates in Settings</button>}</p>
                )}
              </div>
            </div>
            {canEditSettings && (
              <button onClick={handleOpenSettings} className="ml-auto flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors">
                <SlidersHorizontal size={11} /> Edit Settings
              </button>
            )}
          </div>

          {/* ── Battalion staff: full company comparison table + position breakdown ── */}
          {canViewAll && (
            <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5">
                  <h3 className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2">
                    <Target size={14} /> Company Goals
                  </h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5">
                      <th className="text-left px-6 py-3 font-black uppercase tracking-widest text-slate-400">Company</th>
                      <th className="text-right px-6 py-3 font-black uppercase tracking-widest text-slate-400">Cadets</th>
                      <th className="text-right px-6 py-3 font-black uppercase tracking-widest text-slate-400">Total Flags</th>
                      <th className="text-right px-6 py-3 font-black uppercase tracking-widest text-slate-400">Total $</th>
                      <th className="text-right px-6 py-3 font-black uppercase tracking-widest text-slate-400">Wkly Flags</th>
                      <th className="text-right px-6 py-3 font-black uppercase tracking-widest text-slate-400">Wkly $</th>
                      <th className="text-right px-6 py-3 font-black uppercase tracking-widest text-slate-400">Raised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...companyNames, ...BATTALION_COMPANIES.filter(c => companyTotalGoals[c] > 0 && !companyNames.includes(c))].map(co => {
                      const totalFlags   = companyTotalGoals[co] || 0;
                      const weeklyFlags  = companyGoals[co] || 0;
                      const raised       = companyTotals[co] || 0;
                      const raisedFlags  = toFlags(raised);
                      const cadetsInCo   = allRoster.filter(r => !r.graduated && r.company === co).length;
                      const ahead        = weeklyFlags > 0 && raisedFlags >= weeklyFlags;
                      return (
                        <tr key={co} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                          <td className="px-6 py-3 font-black uppercase text-slate-700 dark:text-slate-300">{co}</td>
                          <td className="px-6 py-3 text-right text-slate-500 tabular-nums">{cadetsInCo}</td>
                          <td className="px-6 py-3 text-right font-bold text-slate-700 dark:text-slate-300 tabular-nums">{totalFlags.toLocaleString()}</td>
                          <td className="px-6 py-3 text-right font-bold text-slate-500 tabular-nums">${(totalFlags * 2).toLocaleString()}</td>
                          <td className="px-6 py-3 text-right font-black text-yellow-600 dark:text-yellow-400 tabular-nums">{weeklyFlags.toLocaleString()}/wk</td>
                          <td className="px-6 py-3 text-right font-black text-yellow-600 dark:text-yellow-400 tabular-nums">${(weeklyFlags * 2).toLocaleString()}/wk</td>
                          <td className="px-6 py-3 text-right tabular-nums">
                            <span className={`font-black ${ahead ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                              {raisedFlags}{ahead ? ' ✓' : ''} <span className="font-normal text-slate-400">(${raised.toFixed(0)})</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    {(() => {
                      const allCos = [...companyNames, ...BATTALION_COMPANIES.filter(c => companyTotalGoals[c] > 0 && !companyNames.includes(c))];
                      const totCadets       = allCos.reduce((s, co) => s + allRoster.filter(r => !r.graduated && r.company === co).length, 0);
                      const totTotalFlags   = allCos.reduce((s, co) => s + (companyTotalGoals[co] || 0), 0);
                      const totWeeklyFlags  = allCos.reduce((s, co) => s + (companyGoals[co] || 0), 0);
                      const totRaised       = allCos.reduce((s, co) => s + (companyTotals[co] || 0), 0);
                      const totRaisedFlags  = toFlags(totRaised);
                      return (
                        <tr className="bg-yellow-50 dark:bg-yellow-500/5 border-t-2 border-yellow-200 dark:border-yellow-500/20">
                          <td className="px-6 py-3 font-black uppercase text-yellow-700 dark:text-yellow-400 tracking-wider">Battalion Total</td>
                          <td className="px-6 py-3 text-right font-black text-slate-700 dark:text-slate-300 tabular-nums">{totCadets}</td>
                          <td className="px-6 py-3 text-right font-black text-slate-700 dark:text-slate-300 tabular-nums">{totTotalFlags.toLocaleString()}</td>
                          <td className="px-6 py-3 text-right font-black text-slate-500 tabular-nums">${(totTotalFlags * 2).toLocaleString()}</td>
                          <td className="px-6 py-3 text-right font-black text-yellow-600 dark:text-yellow-400 tabular-nums">{totWeeklyFlags.toLocaleString()}/wk</td>
                          <td className="px-6 py-3 text-right font-black text-yellow-600 dark:text-yellow-400 tabular-nums">${(totWeeklyFlags * 2).toLocaleString()}/wk</td>
                          <td className="px-6 py-3 text-right tabular-nums">
                            <span className="font-black text-slate-600 dark:text-slate-300">
                              {totRaisedFlags.toLocaleString()} <span className="font-normal text-slate-400">(${totRaised.toFixed(0)})</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>

              {/* Position breakdown (staff only) */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5">
                  <h3 className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2">
                    <Users size={14} /> Flag Requirements by Position
                  </h3>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                    $2 = 1 flag · Edit requirements in Settings
                  </p>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-white/5">
                  {Object.entries(positionReqs).sort((a, b) => positionSortKey(a[0]) - positionSortKey(b[0])).map(([pos, flags]) => (
                    <div key={pos} className="flex items-center justify-between px-6 py-2.5">
                      <span className="text-xs text-slate-600 dark:text-slate-400">{pos}</span>
                      <div className="flex items-center gap-4 tabular-nums">
                        <span className="text-xs font-black text-yellow-600 dark:text-yellow-500">{flags} flags</span>
                        <span className="text-[10px] text-slate-400">${flags * 2}</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-6 py-2.5 bg-slate-50 dark:bg-black/10">
                    <span className="text-xs font-bold text-slate-500 italic">All other positions</span>
                    <div className="flex items-center gap-4 tabular-nums">
                      <span className="text-xs font-black text-slate-500">{defaultReq} flags</span>
                      <span className="text-[10px] text-slate-400">${defaultReq * 2}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Company view: own goals + weekly bar chart ── */}
          {!canViewAll && (() => {
            const myTotalGoalFlags   = companyTotalGoals[myCompany] || 0;
            const myWeeklyGoalFlags  = companyGoals[myCompany] || 0;
            const myTotalGoalDollars = myTotalGoalFlags * 2;
            const myWeeklyGoalDollars= myWeeklyGoalFlags * 2;
            const myTotalRaised      = allEntries.filter(e => !e.voided).reduce((s, e) => s + (e.amount || 0), 0);
            const startMs            = fundraiserStart ? new Date(fundraiserStart).getTime() : null;
            const weekMs             = 7 * 24 * 60 * 60 * 1000;

            // Amount raised within each week's date window
            const weeks = Array.from({ length: numWeeks }, (_, i) => {
              const wStart = startMs !== null ? startMs + i * weekMs : null;
              const wEnd   = wStart  !== null ? wStart  + weekMs     : null;
              const raised = allEntries.filter(e => {
                if (e.voided) return false;
                if (!wStart || !wEnd) return false;
                const tsMs = e.submittedAt?.seconds !== undefined
                  ? e.submittedAt.seconds * 1000
                  : (e.submittedAt?.toDate?.()?.getTime?.() || 0);
                return tsMs >= wStart && tsMs < wEnd;
              }).reduce((s, e) => s + (e.amount || 0), 0);
              return { week: i + 1, raised };
            });

            // Yellow expected-progress marker on the total bar
            const expectedFraction = myTotalGoalDollars > 0 ? Math.min(1, currentWeek / numWeeks) : 0;

            return (
              <>
                {/* Goal stat cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Total Goal</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white mt-1 tabular-nums">${myTotalGoalDollars.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{myTotalGoalFlags.toLocaleString()} flags over {numWeeks} wk{numWeeks !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Weekly Goal</p>
                    <p className="text-2xl font-black text-yellow-600 dark:text-yellow-500 mt-1 tabular-nums">${myWeeklyGoalDollars.toLocaleString()}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">{myWeeklyGoalFlags.toLocaleString()} flags/wk</p>
                  </div>
                </div>

                {/* Weekly + total bar chart */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6">
                  <h3 className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2 mb-1">
                    <BarChart3 size={14} /> Weekly Progress — {myCompany} Company
                  </h3>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500 mb-5">
                    Bar width = weekly goal · green fill = raised · yellow line = expected pace
                  </p>

                  <div className="space-y-3">
                    {weeks.map(({ week, raised }) => {
                      const fillPct = myWeeklyGoalDollars > 0
                        ? Math.min(100, (raised / myWeeklyGoalDollars) * 100)
                        : 0;
                      const isPast    = fundraiserStart && week < currentWeek;
                      const isCurrent = fundraiserStart && week === currentWeek;
                      const metGoal   = raised > 0 && raised >= myWeeklyGoalDollars;
                      return (
                        <div key={week}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Week {week}
                              {isCurrent && <span className="ml-1.5 text-yellow-500">· Current</span>}
                              {isPast    && <span className="ml-1.5 text-slate-400">· Done</span>}
                            </span>
                            <span className={`text-[10px] font-black tabular-nums ${metGoal ? 'text-emerald-500' : 'text-slate-400'}`}>
                              ${raised.toLocaleString()}{metGoal ? ' ✓' : ''}
                            </span>
                          </div>
                          {/* Bar: the container represents the full weekly goal */}
                          <div className="relative h-8">
                            <div className="absolute inset-0 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-lg transition-all duration-500"
                                style={{ width: `${fillPct}%` }}
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400 dark:text-slate-600 pointer-events-none">
                                Goal ${myWeeklyGoalDollars.toLocaleString()}
                              </span>
                            </div>
                            {myWeeklyGoalDollars > 0 && (
                              <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 z-10" style={{ right: 0 }} />
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Total bar */}
                    <div className="pt-4 border-t border-slate-100 dark:border-white/5 mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-black uppercase tracking-wide text-yellow-600 dark:text-yellow-500">
                          Total
                        </span>
                        <span className={`text-[10px] font-black tabular-nums ${myTotalRaised >= myTotalGoalDollars && myTotalGoalDollars > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
                          ${myTotalRaised.toLocaleString()} / ${myTotalGoalDollars.toLocaleString()}
                        </span>
                      </div>
                      {/* Bar: container = total goal; fill = raised; yellow marker = expected pace */}
                      <div className="w-full h-10 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden relative">
                        {myTotalGoalDollars > 0 && (
                          <div
                            className="h-full bg-emerald-500 rounded-lg transition-all duration-500"
                            style={{ width: `${Math.min(100, (myTotalRaised / myTotalGoalDollars) * 100)}%` }}
                          />
                        )}
                        {/* Expected-pace marker (yellow vertical line) */}
                        {expectedFraction > 0 && myTotalGoalDollars > 0 && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 z-10"
                            style={{ left: `${expectedFraction * 100}%` }}
                          />
                        )}
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400 dark:text-slate-600 pointer-events-none">
                          Goal ${myTotalGoalDollars.toLocaleString()}
                        </span>
                      </div>
                      {expectedFraction > 0 && myTotalGoalDollars > 0 && (
                        <p className="text-[9px] text-slate-400 mt-1.5 flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-sm bg-yellow-500 flex-shrink-0" />
                          Expected by Wk {currentWeek}: ${Math.round(expectedFraction * myTotalGoalDollars).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── WEEKLY TAB ── */}
      {activeTab === 'weekly' && canViewAll && weeklyBreakdown && (
        <div>
          {/* Company filter */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-2 shadow-sm">
              <Filter size={13} className="text-slate-400" />
              <select
                value={weeklyFilterCompany}
                onChange={e => setWeeklyFilterCompany(e.target.value)}
                className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2"
              >
                <option value="">All Companies</option>
                {companies.map(c => <option key={c}>{c}</option>)}
                <option value="_battalion">Battalion HQ</option>
              </select>
            </div>
          </div>

          {/* Bar chart */}
          {(() => {
            const isBnFilter = weeklyFilterCompany === '_battalion';
            const isAll      = !weeklyFilterCompany;

            const weeklyGoal = isAll
              ? bnWeeklyGoalFlags * 2
              : isBnFilter
                ? BATTALION_COMPANIES.reduce((s, co) => s + (companyGoals[co] || 0), 0) * 2
                : (companyGoals[weeklyFilterCompany] || 0) * 2;

            const weeks = Array.from({ length: numWeeks }, (_, i) => {
              const wk = i + 1;
              let amount = 0;
              if (isAll) {
                Object.values(weeklyBreakdown).forEach(d => { amount += d[wk] || 0; });
              } else if (isBnFilter) {
                amount = weeklyBreakdown['_battalion']?.[wk] || 0;
              } else {
                amount = weeklyBreakdown[weeklyFilterCompany]?.[wk] || 0;
              }
              const wkStart = fundraiserStart
                ? new Date(new Date(fundraiserStart + 'T00:00:00').getTime() + (wk - 1) * 7 * 24 * 60 * 60 * 1000)
                : null;
              const wkEnd = wkStart ? new Date(wkStart.getTime() + 6 * 24 * 60 * 60 * 1000) : null;
              return { wk, amount, wkStart, wkEnd };
            });

            const runningTotal = weeks.reduce((s, w) => s + w.amount, 0);

            // Each bar is independently scaled: full track width = its goal.
            // Fill = raised / goal (capped at 100%). No goal line needed — track edge IS the goal.
            const Bar = ({ label, sublabel, amount, goal, isTotal, isCurrent }) => {
              const pct = goal > 0 ? Math.min((amount / goal) * 100, 100) : 0;
              const met = goal > 0 && amount >= goal;
              return (
                <div className={`${isTotal ? 'pt-4 mt-2 border-t border-dashed border-slate-200 dark:border-white/5' : ''}`}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-black uppercase ${isCurrent ? 'text-yellow-600 dark:text-yellow-500' : isTotal ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-600 dark:text-slate-400'}`}>
                        {label}{isCurrent ? ' ▸' : ''}
                      </span>
                      {sublabel && <span className="text-[9px] text-slate-400 dark:text-slate-500">{sublabel}</span>}
                      {goal > 0 && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500">
                          Goal: {toFlags(goal).toLocaleString()} flags (${goal.toLocaleString()})
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] font-black tabular-nums shrink-0 ${met ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                      ${amount > 0 ? amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '0.00'}
                      {met && ' ✓'}
                    </span>
                  </div>
                  <div className="relative h-5">
                    <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${isTotal ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                      {goal > 0 && (
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-500 dark:text-slate-400 pointer-events-none whitespace-nowrap">
                          Goal ${goal.toLocaleString()}
                        </span>
                      )}
                    </div>
                    {goal > 0 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 z-10" style={{ right: 0 }} />
                    )}
                  </div>
                </div>
              );
            };

            const totalGoal = weeklyGoal * numWeeks;

            return (
              <>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6 shadow-sm space-y-5">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest flex items-center gap-2">
                    <CalendarDays size={14} />
                    {isAll ? 'Battalion · Week-by-Week' : isBnFilter ? 'Battalion HQ · Week-by-Week' : `${weeklyFilterCompany} · Week-by-Week`}
                  </h3>
                  <div className="flex items-center gap-3 text-[9px] font-black uppercase text-slate-400 shrink-0">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"/> Raised</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block"/> Total</span>
                    <span className="text-slate-500">· Track = goal · Line = goal</span>
                  </div>
                </div>
                {weeks.map(({ wk, amount, wkStart, wkEnd }) => (
                  <Bar
                    key={wk}
                    label={`Week ${wk}`}
                    sublabel={wkStart && wkEnd ? `${wkStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${wkEnd.toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : ''}
                    amount={amount}
                    goal={weeklyGoal}
                    isCurrent={wk === currentWeek}
                  />
                ))}
                <Bar
                  label="Total"
                  sublabel={`${numWeeks}-week fundraiser`}
                  amount={runningTotal}
                  goal={totalGoal}
                  isTotal
                />
              </div>

              {/* ── Company Pace Chart ── */}
              {isAll && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6 shadow-sm space-y-4 mt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest flex items-center gap-2">
                        <BarChart3 size={14} />
                        Company Pace · Week {currentWeek} of {numWeeks}
                      </h3>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                        Total raised vs. expected by Week {currentWeek} (yellow line)
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-[9px] font-black uppercase text-slate-400 shrink-0">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"/> Raised</span>
                      <span className="flex items-center gap-1"><span className="w-0.5 h-3 bg-yellow-500 inline-block"/> Wk {currentWeek} goal</span>
                    </div>
                  </div>
                  {[...companyNames, ...BATTALION_COMPANIES.filter(c => (companyTotalGoals[c] || 0) > 0)].map(co => {
                    const isBn = BATTALION_COMPANIES.includes(co);
                    const totalGoalDollars = (companyTotalGoals[co] || 0) * 2;
                    const weeklyGoalDollars = (companyGoals[co] || 0) * 2;
                    const paceGoal = weeklyGoalDollars * currentWeek;
                    const actual = companyTotals[co] || 0;
                    const pct = totalGoalDollars > 0 ? Math.min((actual / totalGoalDollars) * 100, 100) : 0;
                    const linePct = totalGoalDollars > 0 ? Math.min((paceGoal / totalGoalDollars) * 100, 100) : 0;
                    const onTrack = paceGoal === 0 || actual >= paceGoal;
                    return (
                      <div key={co}>
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black uppercase ${isBn ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-600 dark:text-slate-400'}`}>
                              {co}
                            </span>
                            <span className="text-[9px] text-slate-400 dark:text-slate-500">
                              Expected by Wk {currentWeek}: ${paceGoal.toLocaleString()}
                            </span>
                          </div>
                          <span className={`text-[10px] font-black tabular-nums shrink-0 ${onTrack ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            ${actual > 0 ? actual.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '0.00'}
                            {onTrack && actual > 0 && ' ✓'}
                          </span>
                        </div>
                        <div className="relative h-5">
                          <div className="absolute inset-0 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${isBn ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                            {totalGoalDollars > 0 && (
                              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-500 dark:text-slate-400 pointer-events-none whitespace-nowrap">
                                Goal ${totalGoalDollars.toLocaleString()}
                              </span>
                            )}
                          </div>
                          {linePct > 0 && (
                            <div
                              className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 z-10"
                              style={{ left: `${linePct}%` }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              </>
            );
          })()}
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {activeTab === 'settings' && canEditSettings && (
        <div className="max-w-2xl space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2 mb-5">
              <CalendarDays size={14} /> Fundraiser Period
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={lc}>Start Date</label>
                <DatePicker value={editStart} onChange={setEditStart} />
              </div>
              <div>
                <label className={lc}>End Date</label>
                <DatePicker value={editEnd} onChange={setEditEnd} />
              </div>
            </div>
            {editStart && editEnd && (() => {
              const wks = Math.max(1, Math.ceil((new Date(editEnd) - new Date(editStart)) / (7*24*60*60*1000)));
              return (
                <p className="text-[10px] font-black uppercase text-yellow-600 dark:text-yellow-500">
                  = {wks} week{wks !== 1 ? 's' : ''} of fundraising
                </p>
              );
            })()}
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2">
                <Flag size={14} /> Flag Requirements by Position
              </h3>
              <p className="text-[9px] text-slate-400 italic">$2 = 1 flag</p>
            </div>

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {Object.entries(editReqs).sort((a, b) => positionSortKey(a[0]) - positionSortKey(b[0])).map(([pos, val]) => (
                <div key={pos} className="flex items-center gap-3">
                  <span className="flex-1 text-xs text-slate-600 dark:text-slate-400 truncate">{pos}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={val}
                      onChange={e => setEditReqs(r => ({ ...r, [pos]: e.target.value }))}
                      className="w-20 text-right bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs font-black text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors tabular-nums"
                    />
                    <span className="text-[9px] text-slate-400 w-10">flags</span>
                    <span className="text-[9px] text-slate-400 w-12 text-right">${(Number(val)||0)*2}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 dark:border-white/5 mt-4 pt-4">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-xs font-bold text-slate-500 italic">Default (all other positions)</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={editDefaultReq}
                    onChange={e => setEditDefaultReq(e.target.value)}
                    className="w-20 text-right bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs font-black text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors tabular-nums"
                  />
                  <span className="text-[9px] text-slate-400 w-10">flags</span>
                  <span className="text-[9px] text-slate-400 w-12 text-right">${(Number(editDefaultReq)||0)*2}</span>
                </div>
              </div>
            </div>
          </div>

          {/* One-time migration: move order numbers from notes → orderNumber field */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-400 flex items-center gap-2 mb-1">
              <ShoppingCart size={13} /> E-Store Order # Migration
            </h3>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-4">
              Scans all existing e-store entries for order numbers (format: 1112011-…) in the notes field and moves them to the dedicated Order # field. Safe to run once — skips entries that already have an order number.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleMigrateOrderNumbers}
                disabled={migrating || !!migrateResult}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-50 transition-colors"
              >
                {migrating ? <><Loader2 size={12} className="animate-spin" /> Migrating…</> : 'Run Migration'}
              </button>
              {migrateResult && (
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">{migrateResult}</span>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setActiveTab('transactions')}
              className="flex-1 py-3.5 rounded-xl text-xs font-black uppercase text-slate-500 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="flex-1 py-3.5 rounded-xl text-xs font-black uppercase text-black bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {savingSettings ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* ── Log Payment Modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && (setShowModal(false), setForm(EMPTY_FORM), setModalCompany(''), setSplitCadets([]), setSplitSearchKey(k => k + 1))}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-md shadow-2xl"
            >
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <h2 className="font-black uppercase text-sm tracking-widest flex items-center gap-2">
                  <DollarSign size={16} className="text-yellow-500" />
                  {form.paymentType === 'estore'
                    ? 'Log E-Store Payment'
                    : (() => {
                        if (canViewAll && !filterCompany) {
                          const co = form.cadetId && form.cadetId !== 'manual'
                            ? cadets.find(c => c.uid === form.cadetId)?.company
                            : modalCompany;
                          return `Log Payment${co ? ` — ${co}` : ''}`;
                        }
                        return `Log Payment — ${activeCompany}`;
                      })()
                  }
                </h2>
                <button onClick={() => (setShowModal(false), setForm(EMPTY_FORM), setModalCompany(''), setSplitCadets([]), setSplitSearchKey(k => k + 1))} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
                {/* Payment type — always first so switching changes the rest of the form */}
                <div>
                  <label className={lc}>Payment Type *</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PAYMENT_TYPES.map(pt => (
                      <button
                        key={pt.key}
                        type="button"
                        onClick={() => {
                          setForm(f => ({ ...f, paymentType: pt.key, orderNumber: pt.key !== 'estore' ? '' : f.orderNumber, orderDate: pt.key !== 'estore' ? '' : f.orderDate }));
                          if (pt.key !== 'estore') { setSplitCadets([]); setSplitSearchKey(k => k + 1); }
                        }}
                        className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 font-black text-[10px] uppercase tracking-widest transition-all ${
                          form.paymentType === pt.key
                            ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                            : 'border-slate-200 dark:border-white/10 text-slate-500 hover:border-yellow-500/30'
                        }`}
                      >
                        {pt.icon} {pt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {form.paymentType === 'estore' ? (
                  <>
                    {/* Order Number */}
                    <div>
                      <label className={lc}>Order Number *</label>
                      <input
                        type="text"
                        placeholder="1112011-##########"
                        value={form.orderNumber}
                        onChange={e => setForm(f => ({ ...f, orderNumber: e.target.value }))}
                        className={ic}
                      />
                      {form.orderNumber && !ORDER_NUMBER_RE.test(form.orderNumber.trim()) && (
                        <p className="text-[10px] text-red-500 ml-1 mt-1">Format: 1112011-##########</p>
                      )}
                    </div>

                    {/* Order Date */}
                    <div>
                      <label className={lc}>Order Date *</label>
                      <DatePicker value={form.orderDate} onChange={v => setForm(f => ({ ...f, orderDate: v }))} />
                    </div>

                    {/* Total Amount */}
                    <div>
                      <label className={lc}>
                        {splitCadets.length > 1
                          ? `Total Amount * — $${(parseFloat(form.amount) / splitCadets.length || 0).toFixed(2)} each`
                          : 'Total Amount *'}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-black">$</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={form.amount}
                          onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                          className={`${ic} pl-7`}
                        />
                      </div>
                      {form.amount && parseFloat(form.amount) > 0 && splitCadets.length > 1 && (
                        <p className="mt-1.5 text-xs font-black text-yellow-600 dark:text-yellow-400 ml-1">
                          ${(parseFloat(form.amount) / splitCadets.length).toFixed(2)} × {splitCadets.length} cadets
                        </p>
                      )}
                    </div>

                    {/* Multi-cadet picker */}
                    <div>
                      <label className={lc}>
                        {splitCadets.length === 0 ? 'Cadet(s) *' : `Cadets · ${splitCadets.length} added`}
                      </label>
                      {splitCadets.length > 0 && (
                        <div className="space-y-1.5 mb-3">
                          {splitCadets.map((sc, i) => {
                            const perAmt = form.amount && parseFloat(form.amount) > 0
                              ? (parseFloat(form.amount) / splitCadets.length).toFixed(2)
                              : null;
                            return (
                              <div key={sc.cadetId + i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                                <span className="flex-1 text-xs font-black text-slate-900 dark:text-white truncate">{sc.cadetName}</span>
                                {sc.company && <span className="text-[9px] font-bold text-slate-400 shrink-0">{sc.company}</span>}
                                {perAmt && <span className="text-xs font-black text-green-600 dark:text-green-400 tabular-nums shrink-0">${perAmt}</span>}
                                <button type="button" onClick={() => setSplitCadets(s => s.filter((_, j) => j !== i))} className="p-1 rounded text-slate-400 hover:text-red-500 transition-colors shrink-0">
                                  <X size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {cadets.length > 0 ? (
                        <CadetSearch
                          key={splitSearchKey}
                          cadets={cadets.filter(c => !splitCadets.some(sc => sc.cadetId === c.uid))}
                          value=""
                          showCompany={canViewAll && !filterCompany}
                          onChange={(uid, name) => {
                            if (!uid && !name) return;
                            const existing = uid && uid !== 'manual' ? cadets.find(c => c.uid === uid) : null;
                            setSplitCadets(s => [...s, { cadetId: uid || 'manual', cadetName: name, company: existing?.company || '' }]);
                            setSplitSearchKey(k => k + 1);
                          }}
                          inputClass={ic}
                          placeholder={splitCadets.length === 0 ? 'Type 2+ letters to search…' : 'Add another cadet…'}
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder="LAST, FIRST — press Enter to add"
                          className={ic}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const name = e.currentTarget.value.trim();
                              if (name) { setSplitCadets(s => [...s, { cadetId: 'manual', cadetName: name, company: modalCompany }]); e.currentTarget.value = ''; }
                            }
                          }}
                        />
                      )}
                      {canViewAll && !filterCompany && splitCadets.some(sc => sc.cadetId === 'manual') && (
                        <select required value={modalCompany} onChange={e => setModalCompany(e.target.value)} className={`${ic} mt-2`}>
                          <option value="">Select company for manual entries…</option>
                          {companies.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Single cadet (cash / check) */}
                    <div>
                      <label className={lc}>Cadet *</label>
                      {cadets.length > 0 ? (
                        <CadetSearch
                          cadets={cadets}
                          value={form.cadetId === 'manual' ? '' : form.cadetId}
                          showCompany={canViewAll && !filterCompany}
                          onChange={(uid, name) => setForm(f => ({ ...f, cadetId: uid || 'manual', cadetName: name }))}
                          required
                          inputClass={ic}
                          placeholder="Type 2+ letters to search…"
                        />
                      ) : null}
                      {(form.cadetId === 'manual' || cadets.length === 0) && (
                        <input
                          required
                          type="text"
                          placeholder="LAST, FIRST"
                          value={form.cadetName}
                          onChange={e => setForm(f => ({ ...f, cadetName: e.target.value }))}
                          className={`${ic} mt-2`}
                        />
                      )}
                      {canViewAll && !filterCompany && (form.cadetId === 'manual' || cadets.length === 0) && (
                        <select required value={modalCompany} onChange={e => setModalCompany(e.target.value)} className={`${ic} mt-2`}>
                          <option value="">Select company…</option>
                          {companies.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                    </div>

                    {/* Amount */}
                    <div>
                      <label className={lc}>Dollar Amount *</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-black">$</span>
                        <input
                          required
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={form.amount}
                          onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                          className={`${ic} pl-7`}
                        />
                      </div>
                      {form.amount && parseFloat(form.amount) > 0 && (
                        <p className="mt-2 text-xs font-black text-yellow-600 dark:text-yellow-400 ml-1">
                          = {liveFlags} flag{liveFlags !== 1 ? 's' : ''}
                          {parseFloat(form.amount) % 2 !== 0 && (
                            <span className="text-slate-400 font-normal ml-2">(${parseFloat(form.amount).toFixed(2)} → rounded down)</span>
                          )}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {/* Notes — always */}
                <div>
                  <label className={lc}>Notes (optional)</label>
                  <textarea
                    rows={2}
                    placeholder="Check #1234, payment for week 3…"
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    className={`${ic} resize-none`}
                  />
                </div>

                <button
                  type="submit" disabled={saving}
                  className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {saving
                    ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                    : form.paymentType === 'estore' && splitCadets.length > 1
                      ? <><CheckCircle2 size={14} /> Log E-Store — {splitCadets.length} Cadets</>
                      : <><CheckCircle2 size={14} /> Save Payment</>
                  }
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Void Confirmation ── */}
      <AnimatePresence>
        {deleteConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Ban className="mx-auto text-red-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Void Entry?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                Marks <strong>{deleteConf.cadetName}</strong>'s <strong>${(deleteConf.amount||0).toFixed(2)}</strong> payment as voided.
              </p>
              <p className="text-xs text-slate-400 mb-6">
                The entry stays in the transaction log with a VOID label for audit purposes and is excluded from all totals.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConf(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5">
                  Cancel
                </button>
                <button onClick={handleDelete}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                  <Ban size={13} /> Void
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

// ── Summary Card ───────────────────────────────────────────────────────────────

const SummaryCard = ({ icon, label, value }) => (
  <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
    <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-black/30 flex items-center justify-center shrink-0">{icon}</div>
    <div>
      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">{label}</p>
      <p className="text-lg font-black text-slate-900 dark:text-white leading-tight">{value}</p>
    </div>
  </div>
);

export default AdminFundraiser;
