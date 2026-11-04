// src/pages/AdminUniformSizes.jsx
//
// Uniform Sizes — per-cadet size tracking for S4 assistants and company leadership.
//
// Sizes tracked (all gender-aware where applicable):
//   Class B Shirt    — military sizing (XS-R, 8-L, …)
//   Class B Pants    — military sizing (30×32 male, 10-R female)
//   PT Shirt         — unisex (XS – 3XL)
//   Class B Shoes    — US size + width (e.g. 10R)
//   Company Shirt    — unisex (XS – 4XL)
//   Class A Jacket   — leadership only; gender-specific military sizing
//
// Class A auto-check: company CO/XO/1SG with a linked portal account
//   get the checkbox pre-checked when selected from the cadet dropdown.
//   S4 assistant can manually override for any cadet.
//
// Workflow:
//   draft → S4 assistant enters sizes
//   submitted → S4 finalizes; S4 Logistics + Battalion XO get email
//   pending → S4 edits a record after submission; S4 Logistics gets email
//   S4 Logistics clicks "Acknowledge" → clears pending flag
//
// Role matrix:
//   Input (own company): company_s4_assistant, company_commander, company_xo, company_1sg
//   View / manage all:   s4_logistics, battalion level 85+
//   Finalize:            company_s4_assistant
//   Acknowledge:         s4_logistics

import React, {
  useState, useEffect, useMemo, useCallback, useRef,
} from 'react';
import { db, auth } from '../firebase';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp,
} from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { useCompanies } from '../hooks/useCompanies';
import { ROLE_HIERARCHY, ROLE_LABELS } from '../constants';
import {
  Shirt, Plus, Trash2, Edit3, X, Loader2, CheckCircle2,
  Filter, Send, Lock, Unlock, AlertTriangle, ChevronDown,
  Settings2, Check, GraduationCap, Download,
} from 'lucide-react';
import { groupByLet } from '../utils/groupByLet';
import { exportCSV } from '../utils/exportCSV';
import { motion, AnimatePresence } from 'framer-motion';
import AdminPageHeader from '../components/AdminPageHeader';
import CadetSearch from '../components/CadetSearch';

// ── Sizing constants ───────────────────────────────────────────────────────────

const SHIRT_SIZES_MALE = [13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20]
  .flatMap(s => ['S', 'R', 'L'].map(l => `${s}-${l}`));

const SHIRT_SIZES_FEMALE = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
  .flatMap(s => ['S', 'R', 'L'].map(l => `${s}-${l}`));

const PANTS_SIZES_MALE = [26, 27, 28, 29, 30, 31, 32, 33, 34, 36, 38, 40, 42, 44]
  .flatMap(w => [26, 28, 30, 32, 34, 36].map(i => `${w}×${i}`));

const PANTS_SIZES_FEMALE = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]
  .flatMap(s => ['S', 'R', 'L'].map(l => `${s}-${l}`));

const PT_SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const CO_SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'];

const SHOE_US_MALE   = ['5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','10.5','11','11.5','12','12.5','13','13.5','14','14.5','15'];
const SHOE_US_FEMALE = ['4','4.5','5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','10.5','11'];
const SHOE_WIDTHS    = ['N', 'R', 'W'];

const JACKET_SIZES_MALE   = [34, 36, 38, 40, 42, 44, 46, 48, 50].flatMap(n => ['R', 'L'].map(l => `${n}${l}`));
const JACKET_SIZES_FEMALE = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].flatMap(n => ['S', 'R', 'L'].map(l => `${n}${l}`));

// ── Role / access constants ────────────────────────────────────────────────────

// Roster entries stored under any of these company values are Battalion/HQ members.
const BATTALION_COMPANIES = ['Battalion', 'Zulu'];

const INPUT_ROLES    = ['company_s4_assistant', 'company_commander', 'company_xo', 'company_1sg'];
const FINALIZE_ROLE  = 'company_s4_assistant';
const ACKNOWLEDGE_ROLE = 's4_logistics';
const VIEW_ALL_LEVEL = 85; // battalion XO and above
const ADMIN_LEVEL    = 85;

// Company leadership roles — these cadets auto-get Class A checked
const LEADERSHIP_ROLES = ['company_commander', 'company_xo', 'company_1sg'];

// ── Status helpers ─────────────────────────────────────────────────────────────

function statusColor(s) {
  if (s === 'submitted') return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
  if (s === 'pending')   return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20';
  return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20';
}
function statusLabel(s) {
  if (s === 'submitted') return 'Submitted';
  if (s === 'pending')   return 'Pending Review';
  return 'Draft';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ic  = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const lc  = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

const EMPTY_FORM = {
  cadetId: '', cadetName: '', gender: '', linkedUid: '', cadetPosition: '',
  classBShirtSize: '',
  classBPantsSize: '',
  ptShirtSize: '',
  classBShoeUS: '', classBShoeWidth: 'R',
  companyShirtSize: '',
  hasClassA: false, classAJacketSize: '',
};

// ── Column definitions (shared across config, table, and finalize modal) ─────────

const ALL_COLUMNS = [
  { key: 'classBShirtSize',  label: 'Class B Shirt',  short: 'Cl. B Shirt'  },
  { key: 'classBPantsSize',  label: 'Class B Pants',  short: 'Cl. B Pants'  },
  { key: 'ptShirtSize',      label: 'PT Shirt',        short: 'PT Shirt'     },
  { key: 'classBShoeSize',   label: 'Class B Shoes',  short: 'Shoes'        },
  { key: 'companyShirtSize', label: 'Company Shirt',   short: 'Co. Shirt'    },
  { key: 'classAJacketSize', label: 'Class A Jacket', short: 'Cl. A Jacket' },
];
const ALL_COLUMN_KEYS = ALL_COLUMNS.map(c => c.key);

// Returns true when a size record is missing at least one required column.
// Class A jacket is only expected when the record explicitly has hasClassA = true.
function isMissingRequired(rec, requiredCols) {
  return requiredCols.some(col =>
    col === 'classAJacketSize'
      ? rec.hasClassA && !rec.classAJacketSize
      : !rec[col]
  );
}

// Returns true when a roster position string indicates company-level leadership
// (Commander, XO, 1SG) — used to auto-check Class A jacket. Platoon leaders,
// squad leaders, and specialty-team commanders are intentionally excluded so
// S4 can manually check those as needed.
function isCompanyLeadershipPosition(position) {
  const p = (position || '').toLowerCase();
  return (
    /\bcommander\b/.test(p) && !p.includes('platoon') && !p.includes('squad') ||
    /\bxo\b/.test(p) ||
    p.includes('executive officer') ||
    p.includes('1sg') ||
    p.includes('1st sergeant') ||
    p.includes('first sergeant')
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

const AdminUniformSizes = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const { companies } = useCompanies();

  const userLevel      = ROLE_HIERARCHY[role] || 0;
  const myCompany      = userData?.company || '';
  const canInput       = INPUT_ROLES.includes(role) || userLevel >= VIEW_ALL_LEVEL;
  const canFinalize    = role === FINALIZE_ROLE;
  const canAcknowledge = role === ACKNOWLEDGE_ROLE;
  const canViewAll     = role === ACKNOWLEDGE_ROLE || userLevel >= VIEW_ALL_LEVEL;
  const canDelete      = canViewAll;

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [filterCompany,  setFilterCompany]  = useState('');
  const [groupLet,       setGroupLet]       = useState(false);
  const [showModal,      setShowModal]      = useState(false);
  const [editingRecord,  setEditingRecord]  = useState(null);
  const [form,           setForm]           = useState(EMPTY_FORM);
  const [saving,         setSaving]         = useState(false);
  const [finalizeConf,   setFinalizeConf]   = useState(false);
  const [finalizing,     setFinalizing]     = useState(false);
  const [ackConf,        setAckConf]        = useState(false);
  const [acknowledging,  setAcknowledging]  = useState(false);
  const [deleteConf,     setDeleteConf]     = useState(null);
  const [toast,          setToast]          = useState(null);
  const [dataLoading,    setDataLoading]    = useState(true);
  const [detectingLeader,setDetectingLeader]= useState(false);
  // Bump to force the uniformSizes subscription to restart (used after
  // a successful save and as an auto-retry after a permission error).
  const [sizesFetchKey,  setSizesFetchKey]  = useState(0);

  // ── Column config state (S4 logistics only) ───────────────────────────────────
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [configCols,      setConfigCols]      = useState(ALL_COLUMN_KEYS);
  const [savingConfig,    setSavingConfig]     = useState(false);

  // ── Finalize column selection ─────────────────────────────────────────────────
  const [submitCols, setSubmitCols] = useState(ALL_COLUMN_KEYS);

  // ── Reopen state (S4 logistics only) ─────────────────────────────────────────
  const [reopenConf, setReopenConf] = useState(false);
  const [reopening,  setReopening]  = useState(false);

  // ── Personal-view state ───────────────────────────────────────────────────────
  const [myRosterDocId,     setMyRosterDocId]     = useState(null);
  const [myRosterDocLoaded, setMyRosterDocLoaded] = useState(false);
  const [mySizeRecord,      setMySizeRecord]      = useState(null);
  const [myPersonalLoading, setMyPersonalLoading] = useState(true);

  // ── Data state ────────────────────────────────────────────────────────────────
  const [sizes,      setSizes]      = useState([]);   // uniformSizes records
  const [cadets,     setCadets]     = useState([]);   // roster
  const [statusDoc,  setStatusDoc]  = useState({});   // uniformSizeStatus/{company}

  const activeCompany = filterCompany || myCompany;

  // Default canViewAll users to their company
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current && canViewAll && myCompany) {
      setFilterCompany(myCompany);
      initRef.current = true;
    }
  }, [canViewAll, myCompany]);

  // Keep the column-config checkboxes in sync with whatever Firestore has
  // for the selected company (resets whenever the status doc changes or the
  // company filter changes so the panel always reflects the saved state).
  useEffect(() => {
    setConfigCols(statusDoc.requiredColumns || ALL_COLUMN_KEYS);
  }, [statusDoc]);

  // ── Subscribe: uniformSizes ───────────────────────────────────────────────────
  // sizesFetchKey is incremented after each successful save (so the table
  // updates immediately) and on a permission-error retry (so that a rules
  // change propagates without a page reload — the subscription restarts and
  // the new listener is evaluated under the updated rules).
  useEffect(() => {
    if (authLoading) return;
    setDataLoading(true);
    let q;
    if (canViewAll && !filterCompany) {
      q = query(collection(db, 'uniformSizes'), orderBy('cadetName', 'asc'));
    } else if (activeCompany) {
      const companyFilter = BATTALION_COMPANIES.includes(activeCompany)
        ? BATTALION_COMPANIES
        : [activeCompany];
      q = query(
        collection(db, 'uniformSizes'),
        where('company', 'in', companyFilter),
        orderBy('cadetName', 'asc'),
      );
    } else {
      setSizes([]); setDataLoading(false); return;
    }
    let retryTimer = null;
    const unsub = onSnapshot(q,
      snap => {
        setSizes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setDataLoading(false);
      },
      err => {
        console.warn('[uniformSizes] snapshot error:', err.code, '— retrying in 3 s');
        setDataLoading(false);
        // Restart the subscription after 3 s. After a Firestore rules deploy
        // the new listener will be evaluated under the updated rules.
        retryTimer = setTimeout(() => setSizesFetchKey(k => k + 1), 3000);
      },
    );
    return () => { unsub(); if (retryTimer) clearTimeout(retryTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, filterCompany, activeCompany, canViewAll, sizesFetchKey]);

  // ── Subscribe: roster cadets ──────────────────────────────────────────────────
  // When a canViewAll user is in "All Companies" mode (no filterCompany), load
  // the entire roster so the table rows and the cadet dropdown match the
  // all-companies uniform sizes that are already loading. Without this, the
  // cadets subscription would fall back to myCompany (often 'Battalion'),
  // showing only HQ rows while sizes for every company are loaded.
  useEffect(() => {
    let q;
    if (canViewAll && !filterCompany) {
      // All-companies overview — load full roster (no company filter)
      q = query(collection(db, 'roster'), orderBy('fullName', 'asc'));
    } else if (activeCompany) {
      const companyFilter = BATTALION_COMPANIES.includes(activeCompany)
        ? BATTALION_COMPANIES
        : [activeCompany];
      q = query(
        collection(db, 'roster'),
        where('company', 'in', companyFilter),
        orderBy('fullName', 'asc'),
      );
    } else {
      setCadets([]);
      return;
    }
    const unsub = onSnapshot(q, snap => {
      setCadets(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [activeCompany, canViewAll, filterCompany]);

  // ── Subscribe: cycle/status doc ───────────────────────────────────────────────
  useEffect(() => {
    if (!activeCompany) { setStatusDoc({}); return; }
    const unsub = onSnapshot(doc(db, 'uniformSizeStatus', activeCompany), snap => {
      setStatusDoc(snap.exists() ? snap.data() : {});
    });
    return () => unsub();
  }, [activeCompany]);

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

  // Step 2: subscribe to the user's size record (0 or 1 docs)
  useEffect(() => {
    if (canInput || canViewAll || !myRosterDocLoaded) return;
    setMyPersonalLoading(true);
    let q;
    if (myRosterDocId) {
      q = query(collection(db, 'uniformSizes'), where('cadetId', '==', myRosterDocId));
    } else if (userData?.fullName) {
      q = query(collection(db, 'uniformSizes'), where('cadetName', '==', userData.fullName));
    } else {
      setMySizeRecord(null);
      setMyPersonalLoading(false);
      return;
    }
    const unsub = onSnapshot(q, snap => {
      setMySizeRecord(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() });
      setMyPersonalLoading(false);
    }, () => setMyPersonalLoading(false));
    return () => unsub();
  }, [canInput, canViewAll, myRosterDocId, myRosterDocLoaded, userData?.fullName]);

  // ── Computed ──────────────────────────────────────────────────────────────────
  const displaySizes = useMemo(() => {
    if (canViewAll && !filterCompany) return sizes;
    if (BATTALION_COMPANIES.includes(activeCompany)) {
      return sizes.filter(s => BATTALION_COMPANIES.includes(s.company));
    }
    return sizes.filter(s => s.company === activeCompany);
  }, [sizes, activeCompany, canViewAll, filterCompany]);

  // Map cadetId → size record
  const sizeMap = useMemo(() => {
    const map = {};
    displaySizes.forEach(s => { if (s.cadetId) map[s.cadetId] = s; });
    return map;
  }, [displaySizes]);

  const currentStatus  = statusDoc.status || 'draft';
  const isSubmitted    = currentStatus === 'submitted';
  const isPending      = currentStatus === 'pending';
  // Which size columns are required for this company (set by S4 logistics;
  // defaults to all columns if not yet configured).
  // Only show "missing" indicators when S4 has explicitly configured required columns.
  // Default to empty so cadets don't see false warnings before S4 sets requirements.
  const requiredCols   = statusDoc.requiredColumns || [];
  // canViewAll users must have a specific company selected (filterCompany) before
  // adding/editing — "All Companies" mode is a read-only overview. Without a
  // selected company, activeCompany falls back to myCompany ('Battalion'), which
  // would incorrectly save sizes under Battalion for cadets from other companies.
  const canEdit        = canInput && (canViewAll ? !!filterCompany : !!activeCompany);

  // ── Toast ─────────────────────────────────────────────────────────────────────
  const showToast = useCallback(msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Modal helpers ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingRecord(null);
    setShowModal(true);
  };

  const openEdit = (rec) => {
    const [shoeUS, shoeW] = splitShoeSize(rec.classBShoeSize || '');
    // Position lives in the roster, not the size record — look it up live.
    const rosterEntry = cadets.find(c => c.uid === rec.cadetId);
    setForm({
      cadetId:          rec.cadetId         || '',
      cadetName:        rec.cadetName        || '',
      gender:           rec.gender           || '',
      cadetPosition:    rosterEntry?.position || '',
      linkedUid:        rec.linkedUid        || '',
      classBShirtSize:  rec.classBShirtSize  || '',
      classBPantsSize:  rec.classBPantsSize  || '',
      ptShirtSize:      rec.ptShirtSize      || '',
      classBShoeUS:     shoeUS,
      classBShoeWidth:  shoeW || 'R',
      companyShirtSize: rec.companyShirtSize || '',
      hasClassA:        rec.hasClassA        || false,
      classAJacketSize: rec.classAJacketSize || '',
    });
    setEditingRecord(rec);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingRecord(null);
    setForm(EMPTY_FORM);
  };

  // ── Cadet selection → auto-fill gender + detect leadership ───────────────────
  const handleCadetSelect = async (uid) => {
    const cadet = cadets.find(c => c.uid === uid);
    if (!cadet) {
      setForm(f => ({ ...f, cadetId: uid, cadetName: '', gender: '', cadetPosition: '', hasClassA: false }));
      return;
    }

    // Seed form with roster data immediately (gender, position)
    const gender   = cadet.gender   || '';
    const position = cadet.position || '';

    // Auto-check Class A from roster position (company CO/XO/1SG).
    // Other cadets (platoon leaders, specialty teams, etc.) can be manually checked.
    const leaderByPosition = isCompanyLeadershipPosition(position);

    setForm(f => ({
      ...f,
      cadetId:       uid,
      cadetName:     cadet.fullName || '',
      gender,
      cadetPosition: position,
      linkedUid:     cadet.linkedUid || '',
      hasClassA:     leaderByPosition,
    }));

    // Cross-check the cadet's linked portal role as a secondary signal
    // (catches cases where position text doesn't match but the portal role does).
    if (cadet.linkedUid) {
      setDetectingLeader(true);
      try {
        const userSnap = await getDoc(doc(db, 'users', cadet.linkedUid));
        if (userSnap.exists()) {
          const linkedRole = userSnap.data().role || '';
          if (LEADERSHIP_ROLES.includes(linkedRole)) {
            setForm(f => ({ ...f, hasClassA: true }));
          }
        }
      } catch { /* non-blocking */ }
      setDetectingLeader(false);
    }
  };

  const handleExportSizes = () => {
    const rows = displaySizes.map(s => {
      const cadet = s.cadetId ? cadets.find(c => c.uid === s.cadetId) : null;
      return {
        cadetName: cadet?.fullName || s.cadetName || '',
        rank: cadet?.rank || '',
        company: s.company || activeCompany || '',
        classBShirt: s.classBShirtSize || '',
        classBPants: s.classBPantsSize || '',
        classBShoes: s.classBShoeSize || '',
        ptShirt: s.ptShirtSize || '',
        ptShorts: s.ptShortsSize || '',
        coShirt: s.coShirtSize || '',
        classAJacket: s.classAJacketSize || '',
        classAPants: s.classAPantsSize || '',
      };
    });
    const company = (activeCompany || 'all').toLowerCase().replace(/\s+/g, '_');
    exportCSV(rows, `uniform_sizes_${company}_${new Date().toISOString().slice(0,10)}.csv`, [
      { key: 'cadetName',   label: 'Cadet Name' },
      { key: 'rank',        label: 'Rank' },
      { key: 'company',     label: 'Company' },
      { key: 'classBShirt', label: 'Class B Shirt' },
      { key: 'classBPants', label: 'Class B Pants' },
      { key: 'classBShoes', label: 'Class B Shoes' },
      { key: 'ptShirt',     label: 'PT Shirt' },
      { key: 'ptShorts',    label: 'PT Shorts' },
      { key: 'coShirt',     label: 'Co. Shirt' },
      { key: 'classAJacket', label: 'Class A Jacket' },
      { key: 'classAPants', label: 'Class A Pants' },
    ]);
  };

  // ── Save record ───────────────────────────────────────────────────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.cadetId) { showToast('Select a cadet.'); return; }
    if (!activeCompany) { showToast('Company not determined.'); return; }
    setSaving(true);
    try {
      const shoeSize = form.classBShoeUS
        ? `${form.classBShoeUS}${form.classBShoeWidth}`
        : '';
      const payload = {
        company:          activeCompany,
        cadetId:          form.cadetId,
        cadetName:        form.cadetName,
        gender:           form.gender || '',
        // Stored so Firestore rules can gate personal reads by Auth UID without
        // a 2-hop roster lookup (cadetId is a roster doc ID, not an Auth UID).
        linkedUid:        form.linkedUid || null,
        classBShirtSize:  form.classBShirtSize  || null,
        classBPantsSize:  form.classBPantsSize  || null,
        ptShirtSize:      form.ptShirtSize      || null,
        classBShoeSize:   shoeSize              || null,
        companyShirtSize: form.companyShirtSize || null,
        hasClassA:        form.hasClassA,
        classAJacketSize: form.hasClassA ? (form.classAJacketSize || null) : null,
        updatedAt:        serverTimestamp(),
        updatedByUid:     user.uid,
        updatedByName:    userData?.fullName || '',
      };

      const docId = `${activeCompany}_${form.cadetId}`;

      if (editingRecord) {
        // Editing after submission → trigger 'pending' state
        await setDoc(doc(db, 'uniformSizes', docId), payload, { merge: true });
        if (isSubmitted) {
          await setDoc(doc(db, 'uniformSizeStatus', activeCompany), {
            status:    'pending',
            pendingAt: serverTimestamp(),
            pendingNote: `Sizes updated for ${form.cadetName} by ${userData?.fullName || 'S4 Assistant'}`,
          }, { merge: true });
          // Notify S4 logistics
          try {
            const idToken = await getIdToken(auth.currentUser);
            await fetch('/api/notify-uniform', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'pending',
                idToken,
                company: activeCompany,
                cadetName: form.cadetName,
                editorName: userData?.fullName || '',
              }),
            });
          } catch { /* notification is best-effort */ }
        }
        showToast(isSubmitted ? 'Sizes updated — marked pending' : 'Sizes updated');
      } else {
        await setDoc(doc(db, 'uniformSizes', docId), {
          ...payload,
          createdAt: serverTimestamp(),
        }, { merge: true });
        showToast('Sizes saved');
      }
      closeModal();
      // Force the subscription to restart so the saved record appears
      // immediately rather than waiting for the next listener event.
      setSizesFetchKey(k => k + 1);
      writeLog({
        type: 'uniform_sizes', action: editingRecord ? 'update' : 'create',
        description: `${editingRecord ? 'Updated' : 'Saved'} uniform sizes for ${form.cadetName}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: docId, targetName: form.cadetName,
        notes: `company:${activeCompany}`,
      });
    } catch (err) {
      console.error(err);
      showToast('Save failed — try again');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteConf) return;
    try {
      await deleteDoc(doc(db, 'uniformSizes', deleteConf.id));
      setDeleteConf(null);
      showToast('Record deleted');
      setSizesFetchKey(k => k + 1);
      writeLog({
        type: 'uniform_sizes', action: 'delete',
        description: `Deleted uniform sizes for ${deleteConf.cadetName || deleteConf.id}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConf.id, targetName: deleteConf.cadetName,
      });
    } catch { showToast('Delete failed'); }
  };

  // ── Finalize (company S4 assistant) ──────────────────────────────────────────
  const handleFinalize = async () => {
    // ── Pre-finalize validation ──────────────────────────────────────────────
    // Block finalize if any cadet is still missing a required column. This
    // prevents spoofing — submitting incomplete data as if it's done, which
    // would trigger email notifications with misleading information.
    if (requiredCols.length > 0) {
      const missing = displaySizes.filter(s => isMissingRequired(s, requiredCols));
      if (missing.length > 0) {
        showToast(
          `Cannot finalize: ${missing.length} cadet${missing.length === 1 ? '' : 's'} still missing required sizes. Fix them first.`
        );
        return;
      }
    }

    setFinalizing(true);
    try {
      await setDoc(doc(db, 'uniformSizeStatus', activeCompany), {
        company:           activeCompany,
        status:            'submitted',
        submittedAt:       serverTimestamp(),
        submittedByUid:    user.uid,
        submittedByName:   userData?.fullName || '',
        submittedColumns:  submitCols,
      }, { merge: true });

      // Notify S4 logistics + battalion XO
      try {
        const idToken = await getIdToken(auth.currentUser);
        await fetch('/api/notify-uniform', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type:          'submit',
            idToken,
            company:       activeCompany,
            submitterName: userData?.fullName || '',
            recordCount:   displaySizes.length,
          }),
        });
      } catch { /* best-effort */ }

      setFinalizeConf(false);
      showToast(`${activeCompany} uniform sizes submitted`);
      writeLog({
        type: 'uniform_sizes', action: 'finalize',
        description: `Submitted ${activeCompany} uniform sizes (${displaySizes.length} records)`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', notes: `company:${activeCompany},records:${displaySizes.length}`,
      });
    } catch (err) {
      console.error(err);
      showToast('Finalize failed — try again');
    } finally {
      setFinalizing(false);
    }
  };

  // ── Acknowledge (S4 logistics) ────────────────────────────────────────────────
  const handleAcknowledge = async () => {
    setAcknowledging(true);
    try {
      await setDoc(doc(db, 'uniformSizeStatus', activeCompany), {
        status:              'submitted',
        acknowledgedAt:      serverTimestamp(),
        acknowledgedByUid:   user.uid,
        acknowledgedByName:  userData?.fullName || '',
        pendingNote:         null,
      }, { merge: true });
      setAckConf(false);
      showToast('Changes acknowledged');
    } catch (err) {
      console.error(err);
      showToast('Acknowledge failed');
    } finally {
      setAcknowledging(false);
    }
  };

  // ── Save required-column config (S4 logistics) ───────────────────────────────
  const handleSaveConfig = async () => {
    if (!filterCompany) return;
    setSavingConfig(true);
    try {
      await setDoc(doc(db, 'uniformSizeStatus', filterCompany), {
        requiredColumns: configCols,
      }, { merge: true });
      showToast('Required fields updated');
      writeLog({
        type: 'uniform_sizes', action: 'configure',
        description: `Updated required size columns for ${filterCompany}: ${
          configCols.map(k => ALL_COLUMNS.find(c => c.key === k)?.label).join(', ')
        }`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', notes: `company:${filterCompany}`,
      });
    } catch (err) {
      console.error(err);
      showToast('Save failed');
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Reopen (S4 logistics) — resets submitted/pending back to draft ────────────
  const handleReopen = async () => {
    const targetCompany = filterCompany || activeCompany;
    setReopening(true);
    try {
      await setDoc(doc(db, 'uniformSizeStatus', targetCompany), {
        status:         'draft',
        reopenedAt:     serverTimestamp(),
        reopenedByUid:  user.uid,
        reopenedByName: userData?.fullName || '',
        pendingNote:    null,
      }, { merge: true });
      setReopenConf(false);
      showToast(`${targetCompany} sizes reopened`);
      writeLog({
        type: 'uniform_sizes', action: 'reopen',
        description: `Reopened ${targetCompany} uniform sizes for revision`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', notes: `company:${targetCompany}`,
      });
    } catch (err) {
      console.error(err);
      showToast('Reopen failed');
    } finally {
      setReopening(false);
    }
  };

  // ── Access check ──────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="animate-spin text-yellow-500" size={40} />
    </div>
  );

  const hasFullAccess = canInput || canViewAll;

  // ── PERSONAL VIEW (read-only, for cadets without input/management access) ─────
  if (!hasFullAccess) {
    const rec = mySizeRecord;
    const SizeRow = ({ label, value }) => value ? (
      <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-white/5 last:border-0">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</span>
        <span className="text-sm font-black text-slate-900 dark:text-white">{value}</span>
      </div>
    ) : null;

    return (
      <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={Shirt} title="Uniform Sizes" meta={`My Sizes · ${ROLE_LABELS[role] || 'Cadet'}`} />}

          {myPersonalLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
            </div>
          ) : !rec ? (
            <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
              <Shirt className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No sizes on file</p>
              <p className="text-slate-400 text-xs mt-2 max-w-xs mx-auto">
                Once your S4 assistant enters your sizes, they will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Status badge */}
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-xl ${statusColor(rec.status || 'draft')}`}>
                  {statusLabel(rec.status || 'draft')}
                </span>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-6 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-yellow-500 mb-4">Class B Uniform</p>
                <SizeRow label="Shirt"  value={rec.classBShirtSize} />
                <SizeRow label="Pants"  value={rec.classBPantsSize} />
                <SizeRow label="Shoes"  value={rec.classBShoeSize}  />
              </div>

              <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-6 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-yellow-500 mb-4">Other Items</p>
                <SizeRow label="PT Shirt"      value={rec.ptShirtSize}      />
                <SizeRow label="Company Shirt" value={rec.companyShirtSize} />
                {rec.hasClassA && <SizeRow label="Class A Jacket" value={rec.classAJacketSize} />}
                {!rec.ptShirtSize && !rec.companyShirtSize && !rec.hasClassA && (
                  <p className="text-xs text-slate-400 text-center py-2">—</p>
                )}
              </div>
            </div>
          )}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={Shirt} title="Uniform Sizes" meta={`Size Tracking · ${ROLE_LABELS[role] || role}`} />}
        {canEdit && (
          <div className="flex justify-end -mt-4 mb-8">
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-5 py-3 rounded-xl transition-all shadow-lg shadow-yellow-500/20"
            >
              <Plus size={16} /> Add / Update Cadet
            </button>
          </div>
        )}

        {/* Company filter + LET group toggle */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {canViewAll && (
            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-2 shadow-sm">
              <Filter size={13} className="text-slate-400" />
              <select
                value={filterCompany}
                onChange={e => setFilterCompany(e.target.value)}
                className="text-xs font-bold text-slate-700 dark:text-slate-300 bg-transparent outline-none pr-2"
              >
                <option value="">All Companies</option>
                {myCompany && !companies.includes(myCompany) && <option key={myCompany}>{myCompany}</option>}
                {companies.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          )}
          <button
            onClick={() => setGroupLet(g => !g)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all border ${
              groupLet
                ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                : 'bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400'
            }`}
          >
            <GraduationCap size={13} /> Group by LET
          </button>
          {displaySizes.length > 0 && (
            <button
              onClick={handleExportSizes}
              title="Export to CSV"
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all border bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500 hover:text-yellow-600"
            >
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>

        {/* ── S4 Logistics: Required-column configuration panel ── */}
        {canAcknowledge && filterCompany && (
          <div className="mb-4 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowConfigPanel(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors text-xs font-black uppercase tracking-widest text-slate-500"
            >
              <span className="flex items-center gap-2">
                <Settings2 size={13} className="text-yellow-500" />
                Required Fields — {filterCompany}
                {!showConfigPanel && (
                  <span className="font-normal normal-case tracking-normal text-slate-400 text-[10px]">
                    ({requiredCols.length === ALL_COLUMN_KEYS.length ? 'All' : requiredCols.length} required)
                  </span>
                )}
              </span>
              <ChevronDown size={13} className={`transition-transform duration-200 ${showConfigPanel ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
              {showConfigPanel && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-3 border-t border-slate-100 dark:border-white/5">
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Check the size categories this company must provide. Cadets with records missing checked fields will show as <strong className="text-yellow-600 dark:text-yellow-400">Incomplete</strong>. Unchecked columns are still visible and editable — they just won't count against completeness.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {ALL_COLUMNS.map(col => {
                        const active = configCols.includes(col.key);
                        return (
                          <button
                            key={col.key} type="button"
                            onClick={() => setConfigCols(prev =>
                              active ? prev.filter(k => k !== col.key) : [...prev, col.key]
                            )}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-all text-left ${
                              active
                                ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
                                : 'border-slate-200 dark:border-white/10 text-slate-400 hover:border-slate-300'
                            }`}
                          >
                            <div className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center border ${active ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-white/30'}`}>
                              {active && <Check size={9} className="text-slate-950" />}
                            </div>
                            {col.label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={handleSaveConfig} disabled={savingConfig}
                      className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-[10px] uppercase tracking-widest px-4 py-2 rounded-xl transition-all"
                    >
                      {savingConfig ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      Save Configuration
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Status banner + actions */}
        {activeCompany && (!canViewAll || filterCompany) && (
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-xl ${statusColor(currentStatus)}`}>
              {canViewAll && <>{filterCompany} · </>}Uniform Sizes — {statusLabel(currentStatus)}
            </span>

            {isPending && canAcknowledge && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-orange-600 dark:text-orange-400 font-bold flex items-center gap-1.5">
                  <AlertTriangle size={13} />
                  {statusDoc.pendingNote || 'Sizes were edited after submission'}
                </span>
                <button
                  onClick={() => setAckConf(true)}
                  className="flex items-center gap-2 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-500 transition-all"
                >
                  <CheckCircle2 size={13} /> Acknowledge
                </button>
              </div>
            )}

            {/* Reopen — S4 logistics can unlock a submitted/pending submission */}
            {canAcknowledge && (isSubmitted || isPending) && (
              <button
                onClick={() => setReopenConf(true)}
                className="flex items-center gap-2 text-xs font-black uppercase tracking-widest px-4 py-2 rounded-xl border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-all"
              >
                <Unlock size={13} /> Reopen
              </button>
            )}

            {canFinalize && currentStatus === 'draft' && (
              <button
                onClick={() => { setSubmitCols(requiredCols.length > 0 ? requiredCols : ALL_COLUMN_KEYS); setFinalizeConf(true); }}
                disabled={displaySizes.length === 0}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest px-4 py-2 rounded-xl transition-all"
              >
                <Send size={14} /> Finalize & Submit
              </button>
            )}

            {isSubmitted && (
              <span className="text-xs text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1.5">
                <Lock size={12} />
                Submitted by {statusDoc.submittedByName || 'S4 Assistant'}
                {statusDoc.submittedColumns && statusDoc.submittedColumns.length < ALL_COLUMN_KEYS.length && (
                  <span className="font-normal">
                    {' '}· {statusDoc.submittedColumns.map(k => ALL_COLUMNS.find(c => c.key === k)?.short).filter(Boolean).join(', ')}
                  </span>
                )}
              </span>
            )}

            {isPending && !canAcknowledge && (
              <span className="text-xs text-orange-500 font-bold">
                Awaiting S4 Logistics review
              </span>
            )}
          </div>
        )}

        {/* Summary chips */}
        {activeCompany && (
          <div className="flex gap-3 mb-6 flex-wrap">
            <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-2 text-xs font-black uppercase text-slate-500">
              {displaySizes.length} / {cadets.length} cadets entered
            </div>
            {(() => {
              const incompleteCount = displaySizes.filter(s => isMissingRequired(s, requiredCols)).length;
              return incompleteCount > 0 ? (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-2 text-xs font-black uppercase text-yellow-600 dark:text-yellow-400">
                  {incompleteCount} incomplete
                </div>
              ) : displaySizes.length > 0 ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-2 text-xs font-black uppercase text-green-600 dark:text-green-400">
                  All complete
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* Main table */}
        {dataLoading ? (
          <div className="space-y-2">
            {[1,2,3,4].map(n => <div key={n} className="h-12 bg-slate-100 dark:bg-slate-900/60 rounded-xl animate-pulse" />)}
          </div>
        ) : (!activeCompany && !(canViewAll && !filterCompany)) ? (
          <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
            <Shirt className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
            {canInput && !canViewAll ? (
              <>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Company not configured</p>
                <p className="text-xs text-slate-400 mt-2">Your company isn't set — ask an admin to update your profile.</p>
              </>
            ) : (
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Select a company to begin</p>
            )}
          </div>
        ) : cadets.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
            <Shirt className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
            <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No cadets in roster</p>
            <p className="text-xs text-slate-400 mt-2">Add cadets to the Battalion Roster first.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-blue-100 dark:border-white/5 shadow-sm">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5">
                  {['Cadet', 'Gender'].map(h => (
                    <th key={h} className="text-left p-3 font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[80px]">{h}</th>
                  ))}
                  {ALL_COLUMNS.map(col => {
                    const isReq = requiredCols.includes(col.key);
                    return (
                      <th key={col.key} className={`text-left p-3 font-black uppercase tracking-widest whitespace-nowrap min-w-[80px] ${isReq ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-500 dark:text-slate-400'}`}>
                        {col.short}{isReq && <span className="ml-0.5 text-yellow-500">*</span>}
                      </th>
                    );
                  })}
                  <th className="text-left p-3 font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 whitespace-nowrap min-w-[80px]"></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const renderRow = (cadet, idx) => {
                  const rec = sizeMap[cadet.uid];
                  const hasData = !!rec;
                  return (
                    <tr
                      key={cadet.uid}
                      className={`border-b border-slate-100 dark:border-white/5 ${idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-white/[0.02]'}`}
                    >
                      <td className="p-3">
                        <div className="font-black text-slate-900 dark:text-white">{cadet.fullName}</div>
                        {cadet.rank && <div className="text-[9px] text-slate-400 font-bold uppercase">{cadet.rank}</div>}
                      </td>
                      <td className="p-3 text-slate-500 font-bold">{cadet.gender || '—'}</td>
                      {ALL_COLUMNS.map(col => {
                        // Compute the display value (Class A has special rendering)
                        let displayVal;
                        if (col.key === 'classAJacketSize') {
                          displayVal = rec?.hasClassA ? (rec.classAJacketSize || '✓ (size TBD)') : null;
                        } else {
                          displayVal = rec?.[col.key] || null;
                        }
                        // Class A is only required for cadets flagged hasClassA
                        const effectiveRequired =
                          requiredCols.includes(col.key) &&
                          (col.key === 'classAJacketSize' ? !!rec?.hasClassA : true);
                        return (
                          <SizeCell
                            key={col.key}
                            value={displayVal}
                            required={effectiveRequired}
                            hasRecord={!!rec}
                          />
                        );
                      })}
                      <td className="p-3 whitespace-nowrap">
                        {canEdit && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => rec ? openEdit(rec) : (handleCadetSelect(cadet.uid), setShowModal(true))}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all"
                            >
                              <Edit3 size={13} />
                            </button>
                            {canDelete && rec && (
                              <button
                                onClick={() => setDeleteConf({ id: rec.id, cadetName: cadet.fullName })}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                  }; // end renderRow

                  if (groupLet) {
                    return groupByLet(cadets, c => c.letLevel, c => c.fullName).map(({ level, entries: group }) => (
                      <React.Fragment key={level}>
                        <tr>
                          <td colSpan={999} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-y border-yellow-200 dark:border-yellow-500/20">
                            {level}
                          </td>
                        </tr>
                        {group.map((cadet, idx) => renderRow(cadet, idx))}
                      </React.Fragment>
                    ));
                  }
                  return cadets.map((cadet, idx) => renderRow(cadet, idx));
                })()}
              </tbody>
            </table>
          </div>
        )}

      {/* ── Add/Edit Modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && closeModal()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
            >
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
                <h2 className="font-black uppercase text-sm tracking-widest flex items-center gap-2">
                  <Shirt size={16} className="text-yellow-500" />
                  {editingRecord ? 'Edit Sizes' : 'Enter Sizes'} — {activeCompany}
                </h2>
                <button onClick={closeModal} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-6 space-y-5">

                {/* Cadet selection */}
                <div>
                  <label className={lc}>Cadet *</label>
                  <CadetSearch
                    cadets={cadets}
                    value={form.cadetId}
                    onChange={(uid) => handleCadetSelect(uid)}
                    required
                    disabled={!!editingRecord}
                    inputClass={ic}
                    placeholder="Type 2+ letters to search…"
                  />
                  {detectingLeader && (
                    <p className="text-[10px] text-slate-400 ml-1 mt-1 flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" /> Checking leadership status…
                    </p>
                  )}
                  {(form.gender || form.cadetPosition) && (
                    <div className="ml-1 mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      {form.gender && (
                        <p className="text-[10px] text-slate-400 font-bold uppercase">
                          Gender: {form.gender === 'M' ? 'Male (M)' : form.gender === 'F' ? 'Female (F)' : form.gender}
                        </p>
                      )}
                      {form.cadetPosition && (
                        <p className="text-[10px] text-slate-400 font-bold uppercase">
                          Position: {form.cadetPosition}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Class B Shirt */}
                <SizeSelect
                  label="Class B Shirt Size"
                  value={form.classBShirtSize}
                  onChange={v => setForm(f => ({ ...f, classBShirtSize: v }))}
                  options={form.gender === 'F' ? SHIRT_SIZES_FEMALE : SHIRT_SIZES_MALE}
                  placeholder="— Select —"
                />

                {/* Class B Pants */}
                <SizeSelect
                  label="Class B Pants Size"
                  value={form.classBPantsSize}
                  onChange={v => setForm(f => ({ ...f, classBPantsSize: v }))}
                  options={form.gender === 'F' ? PANTS_SIZES_FEMALE : PANTS_SIZES_MALE}
                  placeholder="— Select —"
                />

                {/* PT Shirt */}
                <SizeSelect
                  label="PT Shirt Size"
                  value={form.ptShirtSize}
                  onChange={v => setForm(f => ({ ...f, ptShirtSize: v }))}
                  options={PT_SHIRT_SIZES}
                  placeholder="— Select —"
                />

                {/* Class B Shoes */}
                <div>
                  <label className={lc}>Class B Shoe Size</label>
                  <div className="grid grid-cols-[1fr_160px] gap-2">
                    <select
                      value={form.classBShoeUS}
                      onChange={e => setForm(f => ({ ...f, classBShoeUS: e.target.value }))}
                      className={ic}
                    >
                      <option value="">US Size</option>
                      {(form.gender === 'F' ? SHOE_US_FEMALE : SHOE_US_MALE).map(s => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <select
                      value={form.classBShoeWidth}
                      onChange={e => setForm(f => ({ ...f, classBShoeWidth: e.target.value }))}
                      className={ic}
                    >
                      {SHOE_WIDTHS.map(w => <option key={w} value={w}>{w === 'N' ? 'N (Narrow)' : w === 'W' ? 'W (Wide)' : 'R (Regular)'}</option>)}
                    </select>
                  </div>
                  {form.classBShoeUS && (
                    <p className="text-[10px] text-slate-400 ml-1 mt-1 font-bold">→ {form.classBShoeUS}{form.classBShoeWidth}</p>
                  )}
                </div>

                {/* Company Shirt */}
                <SizeSelect
                  label="Company Shirt Size"
                  value={form.companyShirtSize}
                  onChange={v => setForm(f => ({ ...f, companyShirtSize: v }))}
                  options={CO_SHIRT_SIZES}
                  placeholder="— Select —"
                />

                {/* Class A Jacket */}
                <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div
                      onClick={() => setForm(f => ({ ...f, hasClassA: !f.hasClassA, classAJacketSize: '' }))}
                      className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all cursor-pointer ${
                        form.hasClassA
                          ? 'bg-yellow-500 border-yellow-500'
                          : 'border-slate-300 dark:border-white/20'
                      }`}
                    >
                      {form.hasClassA && <CheckCircle2 size={12} className="text-slate-950" />}
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">Class A Jacket</p>
                      <p className="text-[10px] text-slate-400">Auto-required for Company CO, XO, 1SG</p>
                    </div>
                  </label>

                  {form.hasClassA && (
                    <SizeSelect
                      label="Class A Jacket Size"
                      value={form.classAJacketSize}
                      onChange={v => setForm(f => ({ ...f, classAJacketSize: v }))}
                      options={form.gender === 'F' ? JACKET_SIZES_FEMALE : JACKET_SIZES_MALE}
                      placeholder="— Select Size —"
                    />
                  )}
                </div>

                {isSubmitted && !editingRecord && (
                  <p className="text-[10px] text-orange-500 font-bold uppercase tracking-widest text-center">
                    ⚠ Saving after submission will mark company sizes as Pending Review
                  </p>
                )}

                <button
                  type="submit" disabled={saving || !form.cadetId}
                  className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={14} /> Save Sizes</>}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Finalize Confirmation (with column selection) ── */}
      <AnimatePresence>
        {finalizeConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-green-200 dark:border-green-500/20 rounded-3xl p-6 max-w-sm w-full">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <Send className="text-green-500" size={18} />
                </div>
                <div>
                  <h3 className="font-black uppercase text-sm tracking-widest">Finalize Uniform Sizes</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">{displaySizes.length} records · {activeCompany} Company</p>
                </div>
              </div>

              {/* Column selection */}
              <div className="mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Columns included in this submission</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {ALL_COLUMNS.map(col => {
                    const active = submitCols.includes(col.key);
                    return (
                      <button
                        key={col.key} type="button"
                        onClick={() => setSubmitCols(prev =>
                          active ? prev.filter(k => k !== col.key) : [...prev, col.key]
                        )}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-all text-left ${
                          active
                            ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
                            : 'border-slate-200 dark:border-white/10 text-slate-400'
                        }`}
                      >
                        <div className={`w-3 h-3 rounded flex-shrink-0 flex items-center justify-center border ${active ? 'bg-green-500 border-green-500' : 'border-slate-300 dark:border-white/30'}`}>
                          {active && <Check size={8} className="text-white" />}
                        </div>
                        {col.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-slate-400 mb-4">S4 Logistics and Battalion XO will be notified. You can still edit after submission — changes will be flagged for review.</p>

              <div className="flex gap-3">
                <button onClick={() => setFinalizeConf(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400">
                  Cancel
                </button>
                <button onClick={handleFinalize} disabled={finalizing || submitCols.length === 0}
                  className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-60 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                  {finalizing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {finalizing ? 'Sending…' : 'Submit'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Acknowledge Confirmation ── */}
      <AnimatePresence>
        {ackConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <CheckCircle2 className="mx-auto text-blue-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Acknowledge Changes?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                <strong>{activeCompany} Company</strong> has updated their uniform sizes after submission.
              </p>
              {statusDoc.pendingNote && (
                <p className="text-xs text-slate-400 bg-slate-50 dark:bg-white/5 rounded-xl p-3 mb-4">{statusDoc.pendingNote}</p>
              )}
              <p className="text-xs text-slate-400 mb-6">Confirming will return the status to Submitted.</p>
              <div className="flex gap-3">
                <button onClick={() => setAckConf(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400">
                  Cancel
                </button>
                <button onClick={handleAcknowledge} disabled={acknowledging}
                  className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                  {acknowledging ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Acknowledge
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Reopen Confirmation ── */}
      <AnimatePresence>
        {reopenConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-yellow-200 dark:border-yellow-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Unlock className="mx-auto text-yellow-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Reopen Uniform Sizes?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                This will return <strong>{filterCompany || activeCompany} Company</strong> sizes to <strong>Draft</strong> status.
              </p>
              <p className="text-xs text-slate-400 mb-6">
                The S4 assistant will be able to add, edit, and re-submit sizes. Previously submitted data is preserved.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setReopenConf(false)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400">
                  Cancel
                </button>
                <button onClick={handleReopen} disabled={reopening}
                  className="flex-1 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2">
                  {reopening ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
                  {reopening ? 'Reopening…' : 'Reopen'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete Confirmation ── */}
      <AnimatePresence>
        {deleteConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Trash2 className="mx-auto text-red-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Delete Sizes?</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                Removes all size data for <strong>{deleteConf.cadetName}</strong>.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConf(null)}
                  className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400">
                  Cancel
                </button>
                <button onClick={handleDelete}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-black text-xs uppercase tracking-widest">
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

// ── Sub-components ─────────────────────────────────────────────────────────────

const SizeCell = ({ value, required, hasRecord }) => (
  <td className="p-3 font-bold whitespace-nowrap">
    {value
      ? <span className="text-slate-700 dark:text-slate-300">{value}</span>
      : (required && hasRecord)
        ? <span className="text-red-400 dark:text-red-500 text-[10px] font-black uppercase tracking-widest">Missing</span>
        : <span className="text-slate-300 dark:text-slate-700">—</span>
    }
  </td>
);

const SizeSelect = ({ label, value, onChange, options, placeholder }) => (
  <div>
    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest">{label}</label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all"
    >
      <option value="">{placeholder || '— Select —'}</option>
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  </div>
);

// ── Utility ────────────────────────────────────────────────────────────────────

/** Split stored shoe size "10R" → ["10", "R"] */
function splitShoeSize(combined) {
  if (!combined) return ['', 'R'];
  const match = combined.match(/^(\d+\.?\d*)(N|R|W)$/);
  if (match) return [match[1], match[2]];
  return [combined, 'R'];
}

export default AdminUniformSizes;
