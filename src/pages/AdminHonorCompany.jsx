// src/pages/AdminHonorCompany.jsx
//
// Private — Staff (70+) only.
// Quarterly Points tab: per-quarter points accumulator with audit trail.
// Org Day tab:          April 1st structured event scoring.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, addDoc, deleteDoc, updateDoc, doc, setDoc, Timestamp, writeBatch, query, where, orderBy, limit,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, STAFF_LEVEL, ADMIN_LEVEL } from '../constants';
import { useCompanies } from '../hooks/useCompanies';
import { normalizeCompany } from '../utils/normalizeCompany';
import {
  Trophy, Plus, X, Trash2, ChevronDown, ChevronUp, Loader2,
  Save, Medal, ClipboardList, Star, Settings,
  Timer, Users, Flag, RotateCcw, Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const QUARTERS = ['Q1', 'Q2', 'Q3'];

const DEFAULT_CATEGORIES = {
  q1Categories: ['Late Info', 'Attendance', 'Cadets in Band', 'S4 Survey', 'Harvest Drive'],
  q2Categories: ['Late Info', 'Attendance', 'Flags', 'Medal of Honor 5k', 'Toy Drive'],
  q3Categories: ['Late Info', 'Attendance', 'Military Ball'],
};

const ORG_DAY_EVENTS = [
  {
    key: 'pt', label: 'PT', icon: Users,
    desc: 'Pushups + Situps — Male & Female',
    higherBetter: true,
    fields: [
      { key: 'malePushups',   label: 'Male PU',   type: 'number', min: 0 },
      { key: 'femalePushups', label: 'Female PU', type: 'number', min: 0 },
      { key: 'maleSitups',    label: 'Male SU',   type: 'number', min: 0 },
      { key: 'femaleSitups',  label: 'Female SU', type: 'number', min: 0 },
    ],
    getScore:    d => d != null ? (Number(d?.malePushups)||0)+(Number(d?.femalePushups)||0)+(Number(d?.maleSitups)||0)+(Number(d?.femaleSitups)||0) : null,
    formatScore: d => !d ? '–' : `${(Number(d.malePushups)||0)+(Number(d.femalePushups)||0)} PU / ${(Number(d.maleSitups)||0)+(Number(d.femaleSitups)||0)} SU`,
  },
  {
    key: 'squadDrill', label: 'Squad Drill', icon: Flag,
    desc: '25 commands — total score (max 250)',
    higherBetter: true,
    fields: [{ key: 'total', label: 'Total', type: 'number', min: 0, max: 250 }],
    getScore:    d => d != null ? Number(d?.total) || 0 : null,
    formatScore: d => d?.total ? `${d.total} / 250` : '–',
  },
  {
    key: 'colorGuard', label: 'Color Guard', icon: Flag,
    desc: '14 commands — total score (max 140)',
    higherBetter: true,
    fields: [{ key: 'total', label: 'Total', type: 'number', min: 0, max: 140 }],
    getScore:    d => d != null ? Number(d?.total) || 0 : null,
    formatScore: d => d?.total ? `${d.total} / 140` : '–',
  },
  {
    key: 'raiders', label: 'Raiders', icon: Timer,
    desc: '4 knots — Male & Female time (mm:ss, lower = better)',
    higherBetter: false,
    fields: [
      { key: 'maleTime',   label: 'Male',   type: 'text', placeholder: 'mm:ss' },
      { key: 'femaleTime', label: 'Female', type: 'text', placeholder: 'mm:ss' },
    ],
    getScore: d => {
      const m = parseTime(d?.maleTime), f = parseTime(d?.femaleTime);
      return (isFinite(m) && isFinite(f)) ? m + f : null;
    },
    formatScore: d => (d?.maleTime || d?.femaleTime) ? `M:${d?.maleTime||'–'} F:${d?.femaleTime||'–'}` : '–',
  },
  {
    key: 'obstacleCourse', label: 'Obstacle Course', icon: Timer,
    desc: 'Team time (mm:ss, lower = better)',
    higherBetter: false,
    fields: [{ key: 'time', label: 'Time', type: 'text', placeholder: 'mm:ss' }],
    getScore:    d => { const t = parseTime(d?.time); return isFinite(t) ? t : null; },
    formatScore: d => d?.time || '–',
  },
  {
    key: 'relayRace', label: 'Relay Race', icon: Timer,
    desc: 'Team time (mm:ss, lower = better)',
    higherBetter: false,
    fields: [{ key: 'time', label: 'Time', type: 'text', placeholder: 'mm:ss' }],
    getScore:    d => { const t = parseTime(d?.time); return isFinite(t) ? t : null; },
    formatScore: d => d?.time || '–',
  },
  {
    key: 'balloonSit', label: 'Balloon Sit', icon: Timer,
    desc: 'Duration (mm:ss, longer = better)',
    higherBetter: true,
    fields: [{ key: 'time', label: 'Duration', type: 'text', placeholder: 'mm:ss' }],
    getScore:    d => { const t = parseTime(d?.time); return isFinite(t) ? t : null; },
    formatScore: d => d?.time || '–',
  },
  {
    key: 'tugOfWar', label: 'Tug of War', icon: Trophy,
    desc: 'Bracket placement (1 = champion)',
    higherBetter: false,
    fields: [{ key: 'placement', label: 'Place (1–5)', type: 'number', min: 1, max: 5 }],
    getScore:    d => d?.placement ? Number(d.placement) : null,
    formatScore: d => d?.placement ? ordinal(Number(d.placement)) : '–',
  },
  {
    key: 'potatoSack', label: 'Potato Sack Race', icon: Timer,
    desc: 'Team time (mm:ss, lower = better)',
    higherBetter: false,
    fields: [{ key: 'time', label: 'Time', type: 'text', placeholder: 'mm:ss' }],
    getScore:    d => { const t = parseTime(d?.time); return isFinite(t) ? t : null; },
    formatScore: d => d?.time || '–',
  },
  {
    key: 'knockout', label: 'Knockout', icon: Star,
    desc: 'Points from individual placements',
    higherBetter: true,
    fields: [{ key: 'points', label: 'Points', type: 'number', min: 0 }],
    getScore:    d => d != null ? Number(d?.points) || 0 : null,
    formatScore: d => d?.points != null ? `${d.points} pts` : '–',
  },
  {
    key: 'aystal1', label: 'AYSTAL1', icon: Star,
    desc: 'Trivia competition points',
    higherBetter: true,
    fields: [{ key: 'points', label: 'Points', type: 'number', min: 0 }],
    getScore:    d => d != null ? Number(d?.points) || 0 : null,
    formatScore: d => d?.points != null ? `${d.points} pts` : '–',
  },
  {
    key: 'spirit', label: 'Spirit', icon: Star,
    desc: '4 sub-scores (1–10 each, max 40)',
    higherBetter: true,
    fields: [
      { key: 's1', label: 'Cheer',        type: 'number', min: 1, max: 10 },
      { key: 's2', label: 'Banner',        type: 'number', min: 1, max: 10 },
      { key: 's3', label: 'Uniform',       type: 'number', min: 1, max: 10 },
      { key: 's4', label: 'Participation', type: 'number', min: 1, max: 10 },
    ],
    getScore:    d => d != null ? (Number(d?.s1)||0)+(Number(d?.s2)||0)+(Number(d?.s3)||0)+(Number(d?.s4)||0) : null,
    formatScore: d => {
      if (!d) return '–';
      const t = (Number(d.s1)||0)+(Number(d.s2)||0)+(Number(d.s3)||0)+(Number(d.s4)||0);
      return t > 0 ? `${t} / 40` : '–';
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parseTime = str => {
  if (!str) return Infinity;
  const parts = String(str).split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  return parseFloat(str) || Infinity;
};

const ordinal = n => ['1st','2nd','3rd','4th','5th'][n-1] || `${n}th`;

// Points are fixed on a 5-4-3-2-1 scale regardless of company count:
// 1st = 5 pts, 2nd = 4, 3rd = 3, 4th = 2, 5th = 1, 6th+ = 0.
function rankCompanies(companies, getScore, higherBetter, pointScale = [5, 4, 3, 2, 1]) {
  const pairs = companies.map(co => ({ co, score: getScore(co) }));
  const valid   = pairs.filter(p => p.score !== null && isFinite(p.score));
  const missing = pairs.filter(p => !valid.includes(p));
  valid.sort((a, b) => higherBetter ? b.score - a.score : a.score - b.score);
  let i = 0;
  while (i < valid.length) {
    let j = i;
    while (j + 1 < valid.length && valid[j+1].score === valid[i].score) j++;
    const pts = pointScale[i] ?? 0;
    for (let k = i; k <= j; k++) { valid[k].rank = i + 1; valid[k].points = pts; }
    i = j + 1;
  }
  missing.forEach(p => { p.rank = null; p.points = 0; });
  return [...valid, ...missing];
}

const MEDAL_CLS = {
  1: 'text-yellow-500', 2: 'text-slate-400', 3: 'text-amber-600',
};

const INPUT_TYPE_META = {
  number: {
    fields:      [{ key: 'value', label: 'Score', type: 'number', min: 0 }],
    getScore:    d => d != null ? Number(d?.value) || 0 : null,
    formatScore: d => d?.value != null ? `${d.value} pts` : '–',
  },
  time: {
    fields:      [{ key: 'time', label: 'Time', type: 'text', placeholder: 'mm:ss' }],
    getScore:    d => { const t = parseTime(d?.time); return isFinite(t) ? t : null; },
    formatScore: d => d?.time || '–',
  },
  placement: {
    fields:      [{ key: 'placement', label: 'Place (1–5)', type: 'number', min: 1, max: 5 }],
    getScore:    d => d?.placement ? Number(d.placement) : null,
    formatScore: d => d?.placement ? ordinal(Number(d.placement)) : '–',
  },
};
const INPUT_TYPE_ICONS = { number: Star, time: Timer, placement: Trophy };
const BLANK_NEW_EVENT  = { label: '', desc: '', higherBetter: true, inputType: 'number', pointScale: [5, 4, 3, 2, 1] };

// ─── Component ────────────────────────────────────────────────────────────────

const AdminHonorCompany = ({ hideHeader = false }) => {
  const { user, role, userData, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  // Battalion is not a company and does not compete for Honor Company.
  // (Safety net filter — Battalion should not appear in the companies list.)
  const { companies: allCompanies } = useCompanies();
  const COMPANIES = allCompanies.filter(co => co !== 'Battalion');
  const myLevel   = () => ROLE_HIERARCHY[role] || 0;
  const isAuth          = myLevel() >= STAFF_LEVEL;
  const canLog          = myLevel() >= STAFF_LEVEL;
  const canAdmin        = myLevel() >= ADMIN_LEVEL;
  // Only BC, XO, and CSM (level 85+) can create or remove scoring categories.
  const canCreateCategory = myLevel() >= 85;
  // L70–79 submit pending; L80+ approve/direct-write.
  const submitAsPending = canLog && !canAdmin;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab,     setActiveTab]     = useState('quarterly');
  const [quarter,       setQuarter]       = useState('Q1');
  const [orgYear,       setOrgYear]       = useState(new Date().getFullYear());
  const [resettingOrg,  setResettingOrg]  = useState(false);

  // ── Firestore data ────────────────────────────────────────────────────────
  const [settings,    setSettings]    = useState(DEFAULT_CATEGORIES);
  const [entries,     setEntries]     = useState([]);
  const [orgDayData,  setOrgDayData]  = useState({});
  const [dataLoading, setDataLoading] = useState(true);

  // ── Log modal ─────────────────────────────────────────────────────────────
  const BLANK_LOG = { quarter: 'Q1', category: '', company: COMPANIES[0], points: '', notes: '', isDeduction: false };
  const [logOpen,   setLogOpen]   = useState(false);
  const [logForm,   setLogForm]   = useState(BLANK_LOG);
  const [savingLog, setSavingLog] = useState(false);
  const [savedLog,  setSavedLog]  = useState(false);

  // ── Category management ───────────────────────────────────────────────────
  const [catInput,    setCatInput]    = useState('');
  const [catMaxScore, setCatMaxScore] = useState('');
  const [savingCat,   setSavingCat]   = useState(false);
  const [catOpen,     setCatOpen]     = useState(false);

  // ── Org Day editing ───────────────────────────────────────────────────────
  const [expandedEvent, setExpandedEvent] = useState(null);
  const [eventDraft,    setEventDraft]    = useState({});
  const [savingEvent,   setSavingEvent]   = useState(false);
  const [savedEvent,    setSavedEvent]    = useState(false);

  // ── Org Day config (event settings) ──────────────────────────────────────
  const [orgDayConfig,  setOrgDayConfig]  = useState(null);
  const [activeOrgTab,  setActiveOrgTab]  = useState('events');
  const [configDraft,   setConfigDraft]   = useState(null);
  const [savingConfig,  setSavingConfig]  = useState(false);
  const [savedConfig,   setSavedConfig]   = useState(false);
  const [newEventForm,  setNewEventForm]  = useState(BLANK_NEW_EVENT);

  // ── Audit trail ───────────────────────────────────────────────────────────
  const [auditOpen, setAuditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [changeHistory, setChangeHistory] = useState([]);

  // ── Spreadsheet (per-company) view ────────────────────────────────────────
  const [spreadsheetCompany, setSpreadsheetCompany] = useState(null);
  const [editingCell, setEditingCell] = useState(null); // `${company}|${category}`
  const [cellDraft,   setCellDraft]   = useState('');
  const [savingCell,  setSavingCell]  = useState(null);
  const [cellError,   setCellError]   = useState('');
  const savingViaEnter = useRef(false); // prevent double-save on Enter then blur

  // ── Subscriptions ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuth) return;
    const unsubs = [
      onSnapshot(doc(db, 'settings', 'honorCompany'), snap => {
        if (snap.exists()) {
          setSettings({ ...DEFAULT_CATEGORIES, ...snap.data() });
        } else {
          setDoc(doc(db, 'settings', 'honorCompany'), DEFAULT_CATEGORIES);
        }
        setDataLoading(false);
      }),
      onSnapshot(collection(db, 'honorCompanyEntries'), snap =>
        setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, 'adminLog'),
          where('type', '==', 'honor_company'),
          orderBy('timestamp', 'desc'),
          limit(200)
        ),
        snap => setChangeHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      ),
    ];
    return () => unsubs.forEach(u => u());
  }, [isAuth]);

  useEffect(() => {
    if (!isAuth) return;
    return onSnapshot(doc(db, 'settings', `orgDay_${orgYear}`), snap =>
      setOrgDayData(snap.exists() ? snap.data() : {})
    );
  }, [isAuth, orgYear]);

  useEffect(() => {
    if (!isAuth) return;
    return onSnapshot(doc(db, 'settings', 'orgDayConfig'), snap => {
      const data = snap.exists() ? snap.data() : { eventOverrides: {}, customEvents: [] };
      setOrgDayConfig(data);
      setConfigDraft(prev => prev === null ? data : prev);
    });
  }, [isAuth]);

  // ── Derived — Quarterly ───────────────────────────────────────────────────
  const currentCategories = useMemo(() =>
    settings[`${quarter.toLowerCase()}Categories`] || [],
    [settings, quarter]
  );

  const quarterEntries = useMemo(() =>
    entries.filter(e => e.quarter === quarter),
    [entries, quarter]
  );

  const companyTotals = useMemo(() => {
    const t = Object.fromEntries(COMPANIES.map(co => [co, 0]));
    // Only count approved entries (or legacy entries without a status field).
    quarterEntries.forEach(e => {
      if (e.status === 'pending') return;
      if (t[e.company] !== undefined) t[e.company] += Number(e.points) || 0;
    });
    return t;
  }, [quarterEntries]);

  const pendingEntries = useMemo(() =>
    entries.filter(e => e.status === 'pending'),
    [entries]
  );

  const rankedCompanies = useMemo(() =>
    [...COMPANIES].sort((a, b) => companyTotals[b] - companyTotals[a]),
    [companyTotals]
  );

  // per (company, category) sum for the active quarter — used by the spreadsheet (approved only)
  const cellTotals = useMemo(() => {
    const map = {};
    quarterEntries.forEach(e => {
      if (e.status === 'pending') return;
      const key = `${e.company}|${e.category}`;
      map[key] = (map[key] || 0) + (Number(e.points) || 0);
    });
    return map;
  }, [quarterEntries]);

  // ── Derived — Org Day ─────────────────────────────────────────────────────
  const activeOrgDayEvents = useMemo(() => {
    const overrides = orgDayConfig?.eventOverrides || {};
    const custom    = orgDayConfig?.customEvents   || [];
    const dflt      = [5, 4, 3, 2, 1];
    const base = ORG_DAY_EVENTS.map(ev => ({
      ...ev,
      label:        overrides[ev.key]?.label        ?? ev.label,
      desc:         overrides[ev.key]?.desc         ?? ev.desc,
      higherBetter: overrides[ev.key]?.higherBetter ?? ev.higherBetter,
      pointScale:   overrides[ev.key]?.pointScale   ?? dflt,
      enabled:      overrides[ev.key]?.enabled      ?? true,
    })).filter(ev => ev.enabled !== false);
    const customResolved = custom.map(ev => {
      const meta = INPUT_TYPE_META[ev.inputType || 'number'];
      return {
        key: ev.key, label: ev.label, desc: ev.desc || '',
        higherBetter: ev.higherBetter !== false,
        pointScale:   ev.pointScale || dflt,
        icon:         INPUT_TYPE_ICONS[ev.inputType || 'number'],
        fields:       meta.fields,
        getScore:     meta.getScore,
        formatScore:  meta.formatScore,
        isCustom:     true,
      };
    });
    return [...base, ...customResolved];
  }, [orgDayConfig]);

  const orgDayRankings = useMemo(() => {
    const byEvent = {};
    activeOrgDayEvents.forEach(ev => {
      const eventData = orgDayData?.[ev.key] || {};
      byEvent[ev.key] = rankCompanies(COMPANIES, co => ev.getScore(eventData[co]), ev.higherBetter, ev.pointScale);
    });
    const totalPts = Object.fromEntries(COMPANIES.map(co => [co, 0]));
    Object.values(byEvent).forEach(ranked => ranked.forEach(({ co, points }) => { totalPts[co] += points || 0; }));
    const sortedFinal = [...COMPANIES].sort((a, b) => totalPts[b] - totalPts[a]);
    return { byEvent, totalPts, sortedFinal };
  }, [orgDayData, activeOrgDayEvents]);

  // ── Handlers — Quarterly ──────────────────────────────────────────────────
  const submitLog = async () => {
    if (!logForm.category || !logForm.company || !logForm.points) return;
    const rawPts = Math.abs(Number(logForm.points));
    const finalPts = logForm.isDeduction ? -rawPts : rawPts;
    setSavingLog(true);
    try {
      const status = submitAsPending ? 'pending' : 'approved';
      await addDoc(collection(db, 'honorCompanyEntries'), {
        quarter:      logForm.quarter,
        category:     logForm.category,
        company:      logForm.company,
        points:       finalPts,
        isDeduction:  logForm.isDeduction,
        notes:        logForm.notes.trim(),
        loggedBy:     userData?.uid      || '',
        loggedByName: userData?.fullName || 'Unknown',
        loggedAt:     Timestamp.now(),
        status,
      });
      setSavedLog(true);
      setTimeout(() => { setLogOpen(false); setLogForm(BLANK_LOG); setSavedLog(false); }, 1600);
      writeLog({
        type: 'honor_company', action: 'create',
        description: `${status === 'pending' ? '[PENDING] ' : ''}Logged HC entry: ${logForm.company} — ${logForm.category} (${finalPts} pts) Q${logForm.quarter}${logForm.isDeduction ? ' [PENALTY]' : ''}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: logForm.company,
        notes: `quarter:${logForm.quarter},category:${logForm.category},status:${status}`,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSavingLog(false);
    }
  };

  const approvePending = async (entry) => {
    try {
      await updateDoc(doc(db, 'honorCompanyEntries', entry.id), { status: 'approved' });
      writeLog({
        type: 'honor_company', action: 'approve',
        description: `Approved HC entry: ${entry.company} — ${entry.category} (${entry.points} pts) Q${entry.quarter}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: entry.company,
      });
    } catch (err) { console.error(err); }
  };

  const rejectPending = async (entry) => {
    try {
      await deleteDoc(doc(db, 'honorCompanyEntries', entry.id));
      writeLog({
        type: 'honor_company', action: 'reject',
        description: `Rejected HC entry: ${entry.company} — ${entry.category} (${entry.points} pts) Q${entry.quarter}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: entry.company,
      });
    } catch (err) { console.error(err); }
  };

  // ── Spreadsheet cell save — replaces ALL entries for (company, category, quarter) ─
  // Excel model: typing 90 always makes the cell show 90, no delta math.
  const saveCellValue = async (company, category, newTotalStr) => {
    // Empty draft = cancel (user opened cell but didn't type anything)
    if (newTotalStr === '' || newTotalStr === undefined) {
      setEditingCell(null);
      setCellDraft('');
      return;
    }
    const newTotal = Number(newTotalStr);
    if (isNaN(newTotal)) { setEditingCell(null); setCellDraft(''); return; }
    const key = `${company}|${category}`;
    const current = cellTotals[key] || 0;
    if (newTotal === current) { setEditingCell(null); setCellDraft(''); return; }
    const cellKey = `${quarter}|${key}`;
    setSavingCell(cellKey);
    setCellError('');
    try {
      const toDelete = quarterEntries.filter(e => e.company === company && e.category === category);
      const batch = writeBatch(db);
      toDelete.forEach(e => batch.delete(doc(db, 'honorCompanyEntries', e.id)));
      if (newTotal !== 0) {
        const newRef = doc(collection(db, 'honorCompanyEntries'));
        batch.set(newRef, {
          quarter,
          category,
          company,
          points:       newTotal,
          isDeduction:  newTotal < 0,
          notes:        `Changed ${current} → ${newTotal}`,
          loggedBy:     userData?.uid      || '',
          loggedByName: userData?.fullName || 'Unknown',
          loggedAt:     Timestamp.now(),
        });
      }
      await batch.commit();
      writeLog({
        type: 'honor_company', action: 'spreadsheet_set',
        description: `Set HC ${company} — ${category} to ${newTotal} (was ${current}) Q${quarter}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: company,
        notes: `quarter:${quarter},category:${category}`,
      });
    } catch (err) {
      console.error('saveCellValue error:', err);
      setCellError(err?.message || 'Save failed — check your permissions');
    } finally {
      savingViaEnter.current = false;
      setSavingCell(null);
      setEditingCell(null);
      setCellDraft('');
    }
  };

  const deleteEntry = async id => {
    if (!canAdmin) return;
    const ok = await confirm('Delete this Honor Company entry? This cannot be undone.', { title: 'Delete Entry', destructive: true });
    if (!ok) return;
    await deleteDoc(doc(db, 'honorCompanyEntries', id));
    writeLog({
      type: 'honor_company', action: 'delete',
      description: `Deleted HC entry`,
      userId: user?.uid || '', userFullName: userData?.fullName || '',
      userRole: role || '', targetId: id,
    });
  };

  const addCategory = async () => {
    const val = catInput.trim();
    if (!val || currentCategories.includes(val)) return;
    const key        = `${quarter.toLowerCase()}Categories`;
    const detailKey  = `${quarter.toLowerCase()}CategoryDetails`;
    const maxScore   = Number(catMaxScore) || 100;
    const existing   = settings[detailKey] || {};
    setSavingCat(true);
    await setDoc(doc(db, 'settings', 'honorCompany'), {
      [key]:       [...currentCategories, val],
      [detailKey]: { ...existing, [val]: { maxScore } },
    }, { merge: true });
    setCatInput('');
    setCatMaxScore('');
    setSavingCat(false);
    writeLog({
      type: 'honor_company', action: 'create',
      description: `Added HC category "${val}" (max ${maxScore} pts) for Q${quarter}`,
      userId: user?.uid || '', userFullName: userData?.fullName || '',
      userRole: role || '',
    });
  };

  const removeCategory = async cat => {
    if (!canCreateCategory) return;
    const key       = `${quarter.toLowerCase()}Categories`;
    const detailKey = `${quarter.toLowerCase()}CategoryDetails`;
    const existing  = { ...(settings[detailKey] || {}) };
    delete existing[cat];
    await setDoc(doc(db, 'settings', 'honorCompany'), {
      [key]:       currentCategories.filter(c => c !== cat),
      [detailKey]: existing,
    }, { merge: true });
    writeLog({
      type: 'honor_company', action: 'delete',
      description: `Removed HC category "${cat}" for Q${quarter}`,
      userId: user?.uid || '', userFullName: userData?.fullName || '',
      userRole: role || '',
    });
  };

  // ── Handlers — Org Day ────────────────────────────────────────────────────
  const openEvent = evKey => {
    if (expandedEvent === evKey) { setExpandedEvent(null); return; }
    setExpandedEvent(evKey);
    const saved = orgDayData?.[evKey] || {};
    const draft = {};
    COMPANIES.forEach(co => { draft[co] = { ...(saved[co] || {}) }; });
    setEventDraft(draft);
    setSavedEvent(false);
  };

  const saveEvent = async () => {
    if (!expandedEvent) return;
    setSavingEvent(true);
    try {
      await setDoc(
        doc(db, 'settings', `orgDay_${orgYear}`),
        { year: orgYear, [expandedEvent]: eventDraft },
        { merge: true }
      );
      setSavedEvent(true);
      setTimeout(() => setSavedEvent(false), 2000);
      writeLog({
        type: 'honor_company', action: 'update',
        description: `Updated Org Day scores for event "${expandedEvent}" (${orgYear})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSavingEvent(false);
    }
  };

  const setDraftField = (co, field, val) =>
    setEventDraft(d => ({ ...d, [co]: { ...(d[co] || {}), [field]: val } }));

  const resetOrgDay = async () => {
    if (!canAdmin) return;
    const ok = await confirm(`Clear all Org Day scores for ${orgYear}? This cannot be undone.`, { title: 'Clear Org Day Scores', destructive: true });
    if (!ok) return;
    setResettingOrg(true);
    try {
      await deleteDoc(doc(db, 'settings', `orgDay_${orgYear}`));
      setExpandedEvent(null);
      setEventDraft({});
      writeLog({
        type: 'honor_company', action: 'delete',
        description: `Cleared all Org Day scores for ${orgYear}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      console.error(err);
    } finally {
      setResettingOrg(false);
    }
  };

  // ── Handlers — Org Day Config ─────────────────────────────────────────────
  const saveOrgDayConfig = async () => {
    if (!canAdmin || !configDraft) return;
    setSavingConfig(true);
    try {
      await setDoc(doc(db, 'settings', 'orgDayConfig'), configDraft);
      setSavedConfig(true);
      setTimeout(() => setSavedConfig(false), 2000);
      writeLog({
        type: 'honor_company', action: 'update',
        description: 'Updated Org Day event settings',
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSavingConfig(false);
    }
  };

  const updateEventOverride = (evKey, field, value) =>
    setConfigDraft(d => ({
      ...d,
      eventOverrides: {
        ...(d?.eventOverrides || {}),
        [evKey]: { ...(d?.eventOverrides?.[evKey] || {}), [field]: value },
      },
    }));

  const updateCustomEvent = (evKey, field, value) =>
    setConfigDraft(d => ({
      ...d,
      customEvents: (d?.customEvents || []).map(ev =>
        ev.key === evKey ? { ...ev, [field]: value } : ev
      ),
    }));

  const addCustomEvent = () => {
    if (!newEventForm.label.trim()) return;
    const key = `custom_${Date.now()}`;
    setConfigDraft(d => ({
      ...d,
      customEvents: [
        ...(d?.customEvents || []),
        { key, ...newEventForm, label: newEventForm.label.trim(), desc: newEventForm.desc.trim() },
      ],
    }));
    setNewEventForm(BLANK_NEW_EVENT);
  };

  const removeCustomEvent = evKey =>
    setConfigDraft(d => ({
      ...d,
      customEvents: (d?.customEvents || []).filter(e => e.key !== evKey),
    }));

  // ── Guards ────────────────────────────────────────────────────────────────
  if (authLoading || (dataLoading && isAuth)) {
    return <div className="min-h-screen flex items-center justify-center text-yellow-600"><Loader2 className="animate-spin" size={32} /></div>;
  }
  if (!isAuth) return <Navigate to="/admin/dashboard" />;

  // ─────────────────────────────────────────────────────────────────────────
  const maxTotal = Math.max(1, ...Object.values(companyTotals).map(v => Math.max(0, v)));
  const maxOrgTotal = Math.max(1, ...Object.values(orgDayRankings.totalPts));

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      <div className="max-w-5xl mx-auto">

        {!hideHeader && <AdminPageHeader icon={Trophy} title="Honor Company" />}

        {/* Tab bar */}
        <div className="flex gap-2 mb-6">
          {[
            { key: 'quarterly', label: 'Quarterly Points', icon: ClipboardList },
            { key: 'orgday',    label: 'Org Day',          icon: Medal },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === key
                  ? 'bg-yellow-500 text-slate-950 shadow-md shadow-yellow-500/20'
                  : 'bg-white dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-white/5 hover:text-yellow-600 dark:hover:text-yellow-500'
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* ═══ QUARTERLY TAB ══════════════════════════════════════════════ */}
        {activeTab === 'quarterly' && (
          <div className="space-y-5">

            {/* Controls */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex gap-2">
                {QUARTERS.map(q => (
                  <button key={q} onClick={() => setQuarter(q)}
                    className={`px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                      quarter === q
                        ? 'bg-yellow-500 text-slate-950'
                        : 'bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 text-slate-400 hover:border-yellow-500/30'
                    }`}
                  >{q}</button>
                ))}
              </div>
              {canLog && (
                <div className="flex items-center gap-2">
                  {canAdmin && pendingEntries.length > 0 && (
                    <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg bg-orange-100 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20">
                      <Clock size={10} /> {pendingEntries.length} Pending
                    </span>
                  )}
                  <button
                    onClick={() => { setLogForm({ ...BLANK_LOG, quarter }); setLogOpen(true); setSavedLog(false); }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-[10px] font-black uppercase tracking-widest transition-colors shadow-md shadow-yellow-500/20"
                  >
                    <Plus size={13} /> {submitAsPending ? 'Submit Points' : 'Log Points'}
                  </button>
                </div>
              )}
            </div>

            {/* Scoreboard */}
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-6">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2 mb-5">
                <Trophy size={13} /> {quarter} Scoreboard
              </h3>
              <div className="space-y-3">
                {rankedCompanies.map((co, idx) => {
                  const rank = idx + 1;
                  return (
                    <div key={co} className="flex items-center gap-3">
                      <span className={`w-6 text-center text-sm font-black ${MEDAL_CLS[rank] || 'text-slate-400'}`}>
                        {rank}
                      </span>
                      <span className="w-20 text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">{co}</span>
                      <div className="flex-1 h-5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-500 rounded-full transition-all duration-500"
                          style={{ width: `${(Math.max(0, companyTotals[co]) / maxTotal) * 100}%` }} />
                      </div>
                      <span className={`w-8 text-right text-sm font-black ${companyTotals[co] < 0 ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>{companyTotals[co]}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-Company Spreadsheet */}
            {currentCategories.length > 0 && (
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">
                {/* Company tab bar */}
                <div className="flex border-b border-slate-100 dark:border-white/5 overflow-x-auto">
                  {[{ label: 'All', value: null }, ...COMPANIES.map(co => ({ label: co, value: co }))].map(({ label, value }) => (
                    <button
                      key={label}
                      onClick={() => setSpreadsheetCompany(value)}
                      className={`flex-1 min-w-[64px] py-3 px-3 text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap border-b-2 ${
                        spreadsheetCompany === value
                          ? 'border-yellow-500 text-yellow-600 dark:text-yellow-400'
                          : 'border-transparent text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400'
                      }`}
                    >{label}</button>
                  ))}
                </div>

                {/* Grid */}
                <div className="overflow-x-auto">
                  {spreadsheetCompany === null ? (
                    // All-companies view — rows=companies, cols=categories
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-white/5">
                          <th className="text-left px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600 whitespace-nowrap">Company</th>
                          {currentCategories.map(cat => (
                            <th key={cat} className="text-center px-3 py-2.5 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600 whitespace-nowrap">{cat}</th>
                          ))}
                          <th className="text-right px-4 py-2.5 text-[9px] font-black uppercase text-yellow-600 dark:text-yellow-500 whitespace-nowrap">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankedCompanies.map(co => (
                          <tr key={co} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-yellow-50/20 dark:hover:bg-yellow-500/5 transition-colors">
                            <td className="px-4 py-2.5 font-black text-slate-900 dark:text-white whitespace-nowrap">{co}</td>
                            {currentCategories.map(cat => {
                              const key = `${co}|${cat}`;
                              const val = cellTotals[key] || 0;
                              return (
                                <td key={cat} className="px-3 py-2.5 text-center">
                                  <span className={`text-sm font-black ${val < 0 ? 'text-red-500' : val > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-700'}`}>
                                    {val !== 0 ? val : '–'}
                                  </span>
                                </td>
                              );
                            })}
                            <td className={`px-4 py-2.5 text-right text-sm font-black ${companyTotals[co] < 0 ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}>
                              {companyTotals[co]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    // Single-company view — click any Points cell to edit (Excel style)
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-white/5">
                          <th className="text-left px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Category</th>
                          <th className="text-center px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Max</th>
                          <th className="text-center px-4 py-2.5 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">
                            Points {canAdmin && <span className="normal-case tracking-normal font-normal text-slate-400">(click to edit)</span>}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentCategories.map(cat => {
                          const key = `${spreadsheetCompany}|${cat}`;
                          const cellKey = `${quarter}|${key}`;
                          const current = cellTotals[key] || 0;
                          const detail = settings[`${quarter.toLowerCase()}CategoryDetails`]?.[cat];
                          const maxScore = detail?.maxScore ?? 100;
                          const isEditing = editingCell === key;
                          const isSaving  = savingCell === cellKey;
                          return (
                            <tr key={cat} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-yellow-50/20 dark:hover:bg-yellow-500/5 transition-colors">
                              <td className="px-4 py-2.5 font-bold text-slate-700 dark:text-slate-300">{cat}</td>
                              <td className="px-4 py-2.5 text-center text-slate-400 dark:text-slate-600">{maxScore}</td>
                              <td className="px-4 py-2.5 text-center">
                                {isSaving ? (
                                  <Loader2 size={13} className="animate-spin text-yellow-500 mx-auto" />
                                ) : isEditing ? (
                                  <input
                                    autoFocus
                                    type="number"
                                    value={cellDraft}
                                    onChange={e => setCellDraft(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        savingViaEnter.current = true;
                                        saveCellValue(spreadsheetCompany, cat, cellDraft);
                                      }
                                      if (e.key === 'Escape') { setEditingCell(null); setCellDraft(''); }
                                    }}
                                    onBlur={() => {
                                      if (savingViaEnter.current) return;
                                      saveCellValue(spreadsheetCompany, cat, cellDraft);
                                    }}
                                    className="w-20 text-center bg-yellow-50 dark:bg-yellow-500/10 border-2 border-yellow-500 rounded-lg px-2 py-1 text-sm font-black text-slate-900 dark:text-white outline-none"
                                  />
                                ) : (
                                  <button
                                    disabled={!canAdmin}
                                    onClick={() => {
                                      if (!canAdmin) return;
                                      setEditingCell(key);
                                      setCellDraft(String(current === 0 ? '' : current));
                                    }}
                                    className={`min-w-[2.5rem] text-sm font-black rounded-lg px-2 py-1 transition-all ${
                                      canAdmin ? 'hover:bg-yellow-50 dark:hover:bg-yellow-500/10 hover:text-yellow-600 dark:hover:text-yellow-400 cursor-pointer' : 'cursor-default'
                                    } ${current < 0 ? 'text-red-500' : current > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-300 dark:text-slate-700'}`}
                                  >
                                    {current !== 0 ? current : '–'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Total row */}
                        <tr className="bg-yellow-50/50 dark:bg-yellow-500/5">
                          <td className="px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500" colSpan={2}>Total</td>
                          <td className={`px-4 py-2.5 text-center text-sm font-black ${companyTotals[spreadsheetCompany] < 0 ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}>
                            {companyTotals[spreadsheetCompany] || 0}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
                {cellError && (
                  <div className="px-4 py-2 text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-500/20">
                    {cellError}
                  </div>
                )}
              </div>
            )}

            {/* Category management — BC/XO/CSM only (canCreateCategory) */}
            {canCreateCategory && (
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl">
                <button onClick={() => setCatOpen(o => !o)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                    <Settings size={13} /> {quarter} Categories
                  </span>
                  {catOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </button>
                {catOpen && (
                  <div className="px-6 pb-5">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {currentCategories.length === 0 && (
                        <p className="text-xs italic text-slate-400">No categories — add one below.</p>
                      )}
                      {currentCategories.map(cat => {
                        const detail   = settings[`${quarter.toLowerCase()}CategoryDetails`]?.[cat];
                        const maxScore = detail?.maxScore ?? 100;
                        return (
                          <span key={cat} className="flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase">
                            {cat}
                            <span className="text-slate-400 font-normal normal-case">/{maxScore}pts</span>
                            <button onClick={() => removeCategory(cat)} aria-label={`Remove category ${cat}`} className="text-slate-400 hover:text-red-500 transition-colors">
                              <X size={10} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={catInput}
                        onChange={e => setCatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addCategory()}
                        placeholder="Category name…"
                        className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                      />
                      <input
                        type="number"
                        min="1"
                        value={catMaxScore}
                        onChange={e => setCatMaxScore(e.target.value)}
                        onKeyDown={e => e.stopPropagation()}
                        placeholder="Max pts"
                        className="w-24 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                      />
                      <button onClick={addCategory} disabled={savingCat || !catInput.trim()}
                        className="px-3 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 rounded-xl text-[10px] font-black uppercase disabled:opacity-50 transition-colors">
                        {savingCat ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      </button>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-2">Max points defaults to 100 if left blank.</p>
                  </div>
                )}
              </div>
            )}

            {/* Change History — pulled from adminLog */}
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl">
              <button onClick={() => setHistoryOpen(o => !o)}
                className="w-full flex items-center justify-between px-6 py-4 text-left">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <ClipboardList size={13} /> Change History ({changeHistory.length})
                </span>
                {historyOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </button>
              {historyOpen && (
                <div className="pb-2 overflow-x-auto">
                  {changeHistory.length === 0 ? (
                    <p className="text-center text-xs italic text-slate-400 py-6">No changes logged yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-white/5">
                          {['When','Who','Change'].map(h => (
                            <th key={h} className="text-left px-4 py-2 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {changeHistory.map(log => (
                          <tr key={log.id} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                            <td className="px-4 py-2.5 text-slate-400 dark:text-slate-600 whitespace-nowrap">
                              {log.timestamp?.toDate
                                ? log.timestamp.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                : '–'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{log.userFullName || '–'}</td>
                            <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">{log.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* Audit trail — current quarter entries */}
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl">
              <button onClick={() => setAuditOpen(o => !o)}
                className="w-full flex items-center justify-between px-6 py-4 text-left">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <ClipboardList size={13} /> {quarter} Entries ({quarterEntries.length})
                </span>
                {auditOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </button>
              {auditOpen && (
                <div className="pb-2 overflow-x-auto">
                  {quarterEntries.length === 0 ? (
                    <p className="text-center text-xs italic text-slate-400 py-6">No entries for {quarter} yet.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-white/5">
                          {['Company','Category','Pts','Logged By','Date','Notes',''].map(h => (
                            <th key={h} className="text-left px-4 py-2 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...quarterEntries].sort((a,b) => (b.loggedAt?.seconds||0)-(a.loggedAt?.seconds||0)).map(e => (
                          <tr key={e.id} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                            <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">{normalizeCompany(e.company)}</td>
                            <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{e.category}</td>
                            <td className={`px-4 py-2.5 font-black ${e.isDeduction || e.points < 0 ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}>
                              {e.isDeduction || e.points < 0 ? `−${Math.abs(e.points)}` : `+${e.points}`}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{e.loggedByName}</td>
                            <td className="px-4 py-2.5 text-slate-400 dark:text-slate-600 whitespace-nowrap">
                              {e.loggedAt?.toDate ? e.loggedAt.toDate().toLocaleDateString() : '–'}
                            </td>
                            <td className="px-4 py-2.5 text-slate-400 italic">{e.notes || '–'}</td>
                            <td className="px-4 py-2.5">
                              {canAdmin && (
                                <button onClick={() => deleteEntry(e.id)}
                                  aria-label="Delete entry"
                                  className="text-slate-300 dark:text-slate-700 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>

            {/* ── Pending Approvals (admin only) ──────────────────────────── */}
            {canAdmin && pendingEntries.length > 0 && (
              <div className="bg-white dark:bg-slate-900/40 border border-orange-200 dark:border-orange-500/20 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-orange-100 dark:border-orange-500/10 bg-orange-50/40 dark:bg-orange-500/5 flex items-center gap-2">
                  <Clock size={13} className="text-orange-500" />
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-orange-600 dark:text-orange-400">
                    Pending Approvals — {pendingEntries.length}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-orange-50 dark:border-white/5">
                        <th className="text-left px-4 py-3 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Submitted By</th>
                        <th className="text-left px-4 py-3 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Company</th>
                        <th className="text-left px-4 py-3 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Quarter</th>
                        <th className="text-left px-4 py-3 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Category</th>
                        <th className="text-left px-4 py-3 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Notes</th>
                        <th className="text-right px-4 py-3 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Points</th>
                        <th className="text-right px-4 py-3 text-[9px] font-black uppercase text-slate-400 dark:text-slate-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingEntries.map(entry => (
                        <tr key={entry.id} className="border-b border-orange-50 dark:border-white/[0.03] hover:bg-orange-50/30 dark:hover:bg-orange-500/5 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{entry.loggedByName || '—'}</td>
                          <td className="px-4 py-3 font-bold text-slate-600 dark:text-slate-400">{normalizeCompany(entry.company)}</td>
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{entry.quarter}</td>
                          <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{entry.category}</td>
                          <td className="px-4 py-3 text-slate-400 dark:text-slate-500 italic max-w-[200px]">
                            {entry.notes ? (
                              <span className="text-slate-500 dark:text-slate-400 not-italic">{entry.notes}</span>
                            ) : (
                              <span className="text-slate-300 dark:text-slate-600">—</span>
                            )}
                          </td>
                          <td className={`px-4 py-3 text-right font-black ${entry.points < 0 ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>
                            {entry.points > 0 ? `+${entry.points}` : entry.points}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => approvePending(entry)}
                                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20 border border-green-200 dark:border-green-500/20 transition-all"
                              >
                                <CheckCircle2 size={10} /> Approve
                              </button>
                              <button
                                onClick={() => rejectPending(entry)}
                                className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 border border-red-200 dark:border-red-500/20 transition-all"
                              >
                                <XCircle size={10} /> Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ ORG DAY TAB ════════════════════════════════════════════════ */}
        {activeTab === 'orgday' && (
          <div className="space-y-5">

            {/* Year + meta */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Year</span>
                <select value={orgYear} onChange={e => setOrgYear(Number(e.target.value))}
                  className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors">
                  {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-[10px] font-black uppercase text-slate-400">
                  April 1 — {COMPANIES.length} Companies — {activeOrgDayEvents.length} Events
                </p>
                {canAdmin && (
                  <button
                    onClick={resetOrgDay}
                    disabled={resettingOrg}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border border-red-500/20 text-red-500/70 hover:bg-red-500/10 hover:text-red-500 transition-all disabled:opacity-50"
                  >
                    {resettingOrg ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                    Reset {orgYear}
                  </button>
                )}
              </div>
            </div>

            {/* Org Day sub-tabs (admin only) */}
            {canAdmin && (
              <div className="flex gap-1 p-1 bg-slate-100 dark:bg-white/5 rounded-xl w-fit">
                {[
                  { key: 'events',   label: 'Events',   icon: Medal },
                  { key: 'settings', label: 'Settings', icon: Settings },
                ].map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => setActiveOrgTab(key)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                      activeOrgTab === key
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>
            )}

            {/* ── Events view ──────────────────────────────────────────────── */}
            {(activeOrgTab === 'events' || !canAdmin) && (
              <>
                {/* Final standings */}
                <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-6">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2 mb-5">
                    <Medal size={13} /> {orgYear} Org Day Standings
                  </h3>
                  <div className="space-y-3">
                    {orgDayRankings.sortedFinal.map((co, idx) => {
                      const rank = idx + 1;
                      const total = orgDayRankings.totalPts[co];
                      return (
                        <div key={co} className="flex items-center gap-3">
                          <span className={`w-6 text-center text-sm font-black ${MEDAL_CLS[rank] || 'text-slate-400'}`}>
                            {rank}
                          </span>
                          <span className="w-20 text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">{co}</span>
                          <div className="flex-1 h-5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-yellow-500 rounded-full transition-all duration-500"
                              style={{ width: `${(total / maxOrgTotal) * 100}%` }} />
                          </div>
                          <span className="w-14 text-right text-sm font-black text-slate-900 dark:text-white">{total} pts</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Event cards grid */}
                <div className="grid md:grid-cols-2 gap-4">
                  {activeOrgDayEvents.map(ev => {
                    const isOpen = expandedEvent === ev.key;
                    const Icon   = ev.icon;
                    const eventRankings = orgDayRankings.byEvent[ev.key] || [];
                    const hasData = COMPANIES.some(co => {
                      const d = orgDayData?.[ev.key]?.[co];
                      return d && Object.values(d).some(v => v !== '' && v !== undefined && v !== 0 && v != null);
                    });

                    return (
                      <div key={ev.key} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">

                        {/* Card header */}
                        <button onClick={() => canLog && openEvent(ev.key)}
                          className={`w-full flex items-center justify-between px-5 py-4 text-left transition-colors ${canLog ? 'hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`}>
                          <div className="flex items-center gap-3">
                            <Icon size={16} className={hasData ? 'text-yellow-500' : 'text-slate-300 dark:text-slate-700'} />
                            <div>
                              <p className="text-xs font-black uppercase text-slate-900 dark:text-white">{ev.label}</p>
                              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">{ev.desc}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {hasData && <span className="text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-lg">Scored</span>}
                            {canLog && (isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />)}
                          </div>
                        </button>

                        {/* Collapsed summary */}
                        {!isOpen && hasData && (
                          <div className="px-5 pb-4 grid grid-cols-5 gap-1">
                            {eventRankings.map(({ co, points, rank }) => (
                              <div key={co} className="text-center">
                                <div className={`text-xs font-black ${MEDAL_CLS[rank] || 'text-slate-400'}`}>{rank}</div>
                                <div className="text-[8px] uppercase font-bold text-slate-400">{co.slice(0,3)}</div>
                                <div className="text-[9px] font-black text-yellow-600 dark:text-yellow-500">{points}p</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Expanded input form */}
                        {isOpen && canLog && (
                          <div className="border-t border-slate-100 dark:border-white/5 px-5 py-4 space-y-4">
                            {COMPANIES.map(co => (
                              <div key={co}>
                                <p className="text-[9px] font-black uppercase text-slate-500 dark:text-slate-400 mb-2">{co}</p>
                                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${ev.fields.length}, 1fr)` }}>
                                  {ev.fields.map(field => (
                                    <div key={field.key}>
                                      <label className="text-[8px] font-black uppercase text-slate-400 dark:text-slate-600 block mb-1">{field.label}</label>
                                      <input
                                        type={field.type === 'text' ? 'text' : 'number'}
                                        placeholder={field.placeholder || '0'}
                                        min={field.min}
                                        max={field.max}
                                        value={eventDraft[co]?.[field.key] ?? ''}
                                        onChange={e => setDraftField(co, field.key, e.target.value)}
                                        onKeyDown={e => e.stopPropagation()}
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <div className="flex gap-2 pt-1">
                              <button onClick={saveEvent} disabled={savingEvent}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                                  savedEvent ? 'bg-emerald-500 text-white' : 'bg-yellow-500 hover:bg-yellow-400 text-slate-950'
                                }`}>
                                {savingEvent ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                {savedEvent ? 'Saved' : 'Save Event'}
                              </button>
                              <button onClick={() => setExpandedEvent(null)}
                                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Settings view ─────────────────────────────────────────────── */}
            {canAdmin && activeOrgTab === 'settings' && configDraft && (
              <div className="space-y-4">

                {/* Event list */}
                <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/5">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2">
                      <Settings size={13} /> Event Configuration
                    </h3>
                    <button
                      onClick={saveOrgDayConfig}
                      disabled={savingConfig}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                        savedConfig ? 'bg-emerald-500 text-white' : 'bg-yellow-500 hover:bg-yellow-400 text-slate-950'
                      }`}
                    >
                      {savingConfig ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                      {savedConfig ? 'Saved' : 'Save Settings'}
                    </button>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {/* Hardcoded events with override support */}
                    {ORG_DAY_EVENTS.map(ev => {
                      const ov      = configDraft?.eventOverrides?.[ev.key] || {};
                      const label   = ov.label       ?? ev.label;
                      const desc    = ov.desc        ?? ev.desc;
                      const higher  = ov.higherBetter ?? ev.higherBetter;
                      const scale   = ov.pointScale  ?? [5, 4, 3, 2, 1];
                      const enabled = ov.enabled     ?? true;
                      return (
                        <div key={ev.key} className={`px-6 py-4 transition-opacity ${enabled ? '' : 'opacity-40'}`}>
                          <div className="flex items-start gap-4">
                            <button
                              onClick={() => updateEventOverride(ev.key, 'enabled', !enabled)}
                              title={enabled ? 'Disable event' : 'Enable event'}
                              className={`relative mt-0.5 w-9 h-5 rounded-full flex-shrink-0 transition-colors ${enabled ? 'bg-yellow-500' : 'bg-slate-200 dark:bg-white/10'}`}
                            >
                              <span className={`absolute inset-y-0.5 w-3.5 bg-white rounded-full shadow-sm transition-all ${enabled ? 'right-0.5' : 'left-0.5'}`} />
                            </button>
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <input
                                  value={label}
                                  onChange={e => updateEventOverride(ev.key, 'label', e.target.value)}
                                  className="font-black text-xs uppercase text-slate-900 dark:text-white bg-transparent outline-none focus:bg-slate-50 dark:focus:bg-white/5 rounded px-1 -mx-1 min-w-0 flex-1"
                                />
                                <button
                                  onClick={() => updateEventOverride(ev.key, 'higherBetter', !higher)}
                                  className="text-[8px] font-black uppercase px-2 py-0.5 rounded-md border border-slate-200 dark:border-white/10 text-slate-500 hover:border-yellow-500/40 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors flex-shrink-0"
                                >
                                  {higher ? '↑ Higher' : '↓ Lower'}
                                </button>
                              </div>
                              <input
                                value={desc}
                                onChange={e => updateEventOverride(ev.key, 'desc', e.target.value)}
                                className="text-[9px] text-slate-400 dark:text-slate-500 bg-transparent outline-none focus:bg-slate-50 dark:focus:bg-white/5 rounded px-1 -mx-1 w-full"
                                placeholder="Description…"
                              />
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[8px] font-black uppercase text-slate-400 flex-shrink-0">Points:</span>
                                {['1st','2nd','3rd','4th','5th'].map((ord, i) => (
                                  <div key={i} className="flex items-center gap-0.5">
                                    <span className="text-[8px] text-slate-300 dark:text-slate-600">{ord}</span>
                                    <input
                                      type="number" min="0" max="99"
                                      value={scale[i] ?? 0}
                                      onChange={e => {
                                        const s = [...scale]; s[i] = Number(e.target.value) || 0;
                                        updateEventOverride(ev.key, 'pointScale', s);
                                      }}
                                      className="w-8 text-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded text-[10px] font-black text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 py-0.5"
                                    />
                                  </div>
                                ))}
                                <span className="text-[8px] text-slate-300 dark:text-slate-600">pts</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Custom events */}
                    {(configDraft?.customEvents || []).map(ev => {
                      const scale = ev.pointScale || [5, 4, 3, 2, 1];
                      return (
                        <div key={ev.key} className="px-6 py-4">
                          <div className="flex items-start gap-4">
                            <span className="mt-0.5 inline-block w-9 h-5 rounded-full bg-yellow-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <input
                                  value={ev.label}
                                  onChange={e => updateCustomEvent(ev.key, 'label', e.target.value)}
                                  className="font-black text-xs uppercase text-slate-900 dark:text-white bg-transparent outline-none focus:bg-slate-50 dark:focus:bg-white/5 rounded px-1 -mx-1 min-w-0 flex-1"
                                />
                                <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">Custom</span>
                                <button
                                  onClick={() => updateCustomEvent(ev.key, 'higherBetter', !(ev.higherBetter !== false))}
                                  className="text-[8px] font-black uppercase px-2 py-0.5 rounded-md border border-slate-200 dark:border-white/10 text-slate-500 hover:border-yellow-500/40 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors flex-shrink-0"
                                >
                                  {ev.higherBetter !== false ? '↑ Higher' : '↓ Lower'}
                                </button>
                                <button
                                  onClick={() => removeCustomEvent(ev.key)}
                                  className="text-slate-300 dark:text-slate-700 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              <input
                                value={ev.desc || ''}
                                onChange={e => updateCustomEvent(ev.key, 'desc', e.target.value)}
                                className="text-[9px] text-slate-400 dark:text-slate-500 bg-transparent outline-none focus:bg-slate-50 dark:focus:bg-white/5 rounded px-1 -mx-1 w-full"
                                placeholder="Description…"
                              />
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[8px] font-black uppercase text-slate-400 flex-shrink-0">Points:</span>
                                {['1st','2nd','3rd','4th','5th'].map((ord, i) => (
                                  <div key={i} className="flex items-center gap-0.5">
                                    <span className="text-[8px] text-slate-300 dark:text-slate-600">{ord}</span>
                                    <input
                                      type="number" min="0" max="99"
                                      value={scale[i] ?? 0}
                                      onChange={e => {
                                        const s = [...scale]; s[i] = Number(e.target.value) || 0;
                                        updateCustomEvent(ev.key, 'pointScale', s);
                                      }}
                                      className="w-8 text-center bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded text-[10px] font-black text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 py-0.5"
                                    />
                                  </div>
                                ))}
                                <span className="text-[8px] text-slate-300 dark:text-slate-600">pts</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Add new custom event */}
                <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-6">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2 mb-4">
                    <Plus size={13} /> Add Custom Event
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 block mb-1">Event Name *</label>
                      <input
                        value={newEventForm.label}
                        onChange={e => setNewEventForm(f => ({ ...f, label: e.target.value }))}
                        placeholder="e.g. Bean Bag Toss"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 block mb-1">Description</label>
                      <input
                        value={newEventForm.desc}
                        onChange={e => setNewEventForm(f => ({ ...f, desc: e.target.value }))}
                        placeholder="e.g. Bags landed (max 10)"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 block mb-1">Score Type</label>
                      <select
                        value={newEventForm.inputType}
                        onChange={e => setNewEventForm(f => ({ ...f, inputType: e.target.value }))}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                      >
                        <option value="number">Number Score (points, reps, etc.)</option>
                        <option value="time">Time (mm:ss)</option>
                        <option value="placement">Placement (1st, 2nd, 3rd…)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 block mb-1">Direction</label>
                      <div className="flex gap-2">
                        {[{ v: true, l: '↑ Higher' }, { v: false, l: '↓ Lower' }].map(({ v, l }) => (
                          <button key={String(v)} onClick={() => setNewEventForm(f => ({ ...f, higherBetter: v }))}
                            className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${
                              newEventForm.higherBetter === v
                                ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-white/5 hover:border-yellow-500/30'
                            }`}
                          >{l} = Better</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="text-[8px] font-black uppercase tracking-widest text-slate-400 block mb-2">Points per Placement</label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {['1st','2nd','3rd','4th','5th'].map((ord, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="text-[9px] text-slate-400">{ord}</span>
                          <input
                            type="number" min="0" max="99"
                            value={newEventForm.pointScale[i] ?? 0}
                            onChange={e => {
                              const s = [...newEventForm.pointScale]; s[i] = Number(e.target.value) || 0;
                              setNewEventForm(f => ({ ...f, pointScale: s }));
                            }}
                            className="w-10 text-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-lg text-sm font-black text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 py-1.5"
                          />
                        </div>
                      ))}
                      <span className="text-[9px] text-slate-400">pts</span>
                    </div>
                  </div>
                  <button
                    onClick={addCustomEvent}
                    disabled={!newEventForm.label.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-[10px] font-black uppercase tracking-widest disabled:opacity-40 transition-colors"
                  >
                    <Plus size={11} /> Add Event
                  </button>
                </div>

              </div>
            )}

          </div>
        )}
      </div>

      {/* ═══ LOG MODAL ══════════════════════════════════════════════════════ */}
      {logOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-white/5">
            <div className="flex items-center justify-between px-6 pt-6 pb-0 mb-5">
              <h2 className="text-sm font-black uppercase italic text-slate-900 dark:text-white flex items-center gap-2">
                <Plus size={15} className="text-yellow-500" /> {submitAsPending ? 'Submit Points for Approval' : 'Log Points'}
              </h2>
              <button onClick={() => setLogOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <X size={16} />
              </button>
            </div>

            {savedLog ? (
              <div className="px-6 pb-6 text-center py-8">
                <div className={`w-12 h-12 ${submitAsPending ? 'bg-orange-500/10 border-orange-500/20' : 'bg-yellow-500/10 border-yellow-500/20'} border rounded-full flex items-center justify-center mx-auto mb-3`}>
                  {submitAsPending
                    ? <Clock size={22} className="text-orange-500" />
                    : <Trophy size={22} className="text-yellow-600 dark:text-yellow-500" />
                  }
                </div>
                <p className="font-black uppercase text-slate-900 dark:text-white">
                  {submitAsPending ? 'Submitted for Approval' : 'Points Logged!'}
                </p>
                {submitAsPending && (
                  <p className="text-[10px] text-slate-400 mt-1">A battalion commander will review your submission.</p>
                )}
              </div>
            ) : (
              <div className="px-6 pb-6 space-y-4">
                {/* Quarter */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Quarter *</label>
                  <div className="flex gap-2">
                    {QUARTERS.map(q => (
                      <button key={q} onClick={() => setLogForm(f => ({ ...f, quarter: q, category: '' }))}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${
                          logForm.quarter === q
                            ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-white/5 hover:border-yellow-500/30'
                        }`}>{q}</button>
                    ))}
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Category *</label>
                  <select value={logForm.category} onChange={e => setLogForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors">
                    <option value="">Select category…</option>
                    {(settings[`${logForm.quarter.toLowerCase()}Categories`] || []).map(c => {
                      const detail   = settings[`${logForm.quarter.toLowerCase()}CategoryDetails`]?.[c];
                      const maxScore = detail?.maxScore ?? 100;
                      return <option key={c} value={c}>{c} (max {maxScore} pts)</option>;
                    })}
                  </select>
                  {logForm.category && (() => {
                    const detail   = settings[`${logForm.quarter.toLowerCase()}CategoryDetails`]?.[logForm.category];
                    const maxScore = detail?.maxScore ?? 100;
                    return (
                      <p className="text-[9px] text-slate-400 mt-1 ml-1">
                        Max points for this category: <strong>{maxScore}</strong>
                      </p>
                    );
                  })()}
                </div>

                {/* Company */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Company *</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COMPANIES.map(co => (
                      <button key={co} onClick={() => setLogForm(f => ({ ...f, company: co }))}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border transition-all ${
                          logForm.company === co
                            ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-white/5 hover:border-yellow-500/30'
                        }`}>{co.slice(0,3)}</button>
                    ))}
                  </div>
                </div>

                {/* Award / Penalty toggle */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Type *</label>
                  <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-white/5">
                    <button
                      type="button"
                      onClick={() => setLogForm(f => ({ ...f, isDeduction: false }))}
                      className={`flex-1 py-2 text-[10px] font-black uppercase transition-all ${
                        !logForm.isDeduction
                          ? 'bg-yellow-500 text-slate-950'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                      }`}
                    >Award</button>
                    <button
                      type="button"
                      onClick={() => setLogForm(f => ({ ...f, isDeduction: true }))}
                      className={`flex-1 py-2 text-[10px] font-black uppercase transition-all ${
                        logForm.isDeduction
                          ? 'bg-red-500 text-white'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                      }`}
                    >Penalty</button>
                  </div>
                </div>

                {/* Points */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Points *</label>
                  <input type="number" min="1" value={logForm.points}
                    onChange={e => setLogForm(f => ({ ...f, points: e.target.value }))}
                    onKeyDown={e => e.stopPropagation()}
                    placeholder="0"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                  />
                  {logForm.isDeduction && logForm.points && (
                    <p className="text-[9px] text-red-500 mt-1 ml-1">−{Math.abs(Number(logForm.points))} pts will be deducted</p>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">Notes (optional)</label>
                  <input type="text" value={logForm.notes}
                    onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                    onKeyDown={e => e.stopPropagation()}
                    placeholder="e.g. Won by 2 votes"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                  />
                </div>

                <button onClick={submitLog}
                  disabled={savingLog || !logForm.category || !logForm.company || !logForm.points}
                  className="w-full py-3 rounded-xl text-sm font-black uppercase bg-yellow-500 hover:bg-yellow-400 text-slate-950 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {savingLog ? <Loader2 size={14} className="animate-spin" /> : <Trophy size={14} />}
                  {savingLog ? 'Saving…' : 'Submit'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminHonorCompany;
