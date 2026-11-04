// src/pages/AdminCadetProfile.jsx
//
// Admin Cadet Profile — full overview for a single cadet.
// Accessible to company staff (35+) and above.
//
// Sections: Header, Cadet Challenge (all cycles), Promotion Board history,
//           Ribbon Awards, Uniform Sizes, Fundraiser summary.

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import {
  doc, getDoc, collection, query, where, onSnapshot,
  getDocs, addDoc, updateDoc, serverTimestamp, deleteField,
  deleteDoc, writeBatch,
} from 'firebase/firestore';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import {
  ChevronLeft, Hash, User, Loader2, AlertTriangle,
  Award, Dumbbell, ClipboardList, Shirt, DollarSign, ChevronDown, ChevronUp,
  Plus, X, Camera, Check, MessageSquare, Edit3, Trash2, GraduationCap, History,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { usePageMeta } from '../hooks/usePageMeta';

const COMPANY_STAFF_LEVEL = 35;

const EVENTS = [
  { key: 'pushUps',    label: 'Push-Ups'        },
  { key: 'sitUps',     label: 'Sit-Ups'          },
  { key: 'shuttleRun', label: 'Shuttle (s)'       },
  { key: 'oneMile',    label: '1 Mile'            },
  { key: 'sitNReach',  label: 'Sit-N-Reach (cm)' },
];

const RIBBON_META = {
  athletic:         { label: 'JROTC Athletic Ribbon',     code: 'N-2-3', cls: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30' },
  physical_fitness: { label: 'JROTC Physical Fitness Ribbon', code: 'N-2-2', cls: 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-white/10' },
};

const fmt$ = n => n != null ? `$${Number(n).toFixed(2)}` : '$0.00';
const pad5  = n  => n != null ? String(n).padStart(5, '0') : null;

// ── Collapsible section card ──────────────────────────────────────────────────
const Section = ({ icon: Icon, title, badge, headerRight, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl overflow-hidden">
      <div className="flex items-center px-6 py-4 gap-3">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex-1 flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-3">
            <Icon size={15} className="text-yellow-500 shrink-0" />
            <span className="text-sm font-black uppercase italic tracking-tight text-slate-800 dark:text-white">{title}</span>
            {badge != null && (
              <span className="text-[10px] font-black text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">{badge}</span>
            )}
          </div>
          {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </button>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      {open && <div className="border-t border-blue-50 dark:border-white/5 px-6 pb-6 pt-4">{children}</div>}
    </div>
  );
};

// ── Stat tile ─────────────────────────────────────────────────────────────────
const Tile = ({ label, value }) => (
  <div className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl px-4 py-3 text-center">
    <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className="text-base font-black text-slate-800 dark:text-white tabular-nums">{value ?? '—'}</p>
  </div>
);

// ── Main page ─────────────────────────────────────────────────────────────────
const AdminCadetProfile = () => {
  const { rosterDocId } = useParams();
  const { user, role, userData, loading: authLoading } = useAuth();
  const navigate  = useNavigate();
  const userLevel = !authLoading ? (ROLE_HIERARCHY[role] || 0) : 0;
  const canView   = userLevel >= COMPANY_STAFF_LEVEL;

  usePageMeta({ title: 'Cadet Profile', description: 'Individual cadet overview.', path: '/admin/personnel/:id' });

  // ── State ─────────────────────────────────────────────────────────────────
  const [rosterDoc,    setRosterDoc]    = useState(null);
  const [portrait,     setPortrait]     = useState(null);
  const [loadingBase,  setLoadingBase]  = useState(true);

  const [challengeRecs, setChallengeRecs] = useState([]);
  const [boardScores,   setBoardScores]   = useState([]);
  const [boards,        setBoards]        = useState([]);   // promotionBoards lookup
  const [ribbons,       setRibbons]       = useState([]);
  const [sizes,         setSizes]         = useState(null);
  const [fundraiser,    setFundraiser]    = useState({ total: 0, count: 0 });

  // ── Ribbon award modal ────────────────────────────────────────────────────
  const [ribbonTypes,   setRibbonTypes]   = useState([]);
  const [showAwardModal, setShowAwardModal] = useState(false);
  const [awardForm,     setAwardForm]     = useState({ ribbonTypeId: '', awardedDate: '', cycleNumber: '', citation: '', recommendedBy: '', status: 'pending' });
  const [awardSaving,   setAwardSaving]   = useState(false);
  const [toast,         setToast]         = useState(null);

  const canManageRibbons = userLevel >= STAFF_LEVEL;

  // ── Photo management ──────────────────────────────────────────────────────
  const [linkedUserData,   setLinkedUserData]   = useState(null);
  const [assigningPortrait, setAssigningPortrait] = useState(false);
  const [approvingPortrait, setApprovingPortrait] = useState(false);

  // ── Ribbon recommendations ────────────────────────────────────────────────
  const [recommendations,       setRecommendations]       = useState([]);
  const [fromRecommendationId,  setFromRecommendationId]  = useState(null);

  // ── Cadet yearly history ──────────────────────────────────────────────────
  const [historyRecs,    setHistoryRecs]    = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Row actions (delete / graduate) from profile ─────────────────────────
  const [showDeleteConf, setShowDeleteConf] = useState(false);
  const [showGradConf,   setShowGradConf]   = useState(false);
  const [deleting,       setDeleting]       = useState(false);
  const [graduating,     setGraduating]     = useState(false);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Load roster doc + portrait ────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || authLoading || !canView) return;
    setLoadingBase(true);
    getDoc(doc(db, 'roster', rosterDocId)).then(async snap => {
      if (!snap.exists()) { setRosterDoc(null); setLoadingBase(false); return; }
      const data = { id: snap.id, ...snap.data() };
      setRosterDoc(data);
      // Load portrait + full user data from linked account if available
      if (data.linkedUid) {
        try {
          const uSnap = await getDoc(doc(db, 'users', data.linkedUid));
          if (uSnap.exists()) {
            const uData = uSnap.data();
            setPortrait(uData.portrait || null);
            setLinkedUserData(uData);
          }
        } catch (_) {}
      }
      setLoadingBase(false);
    }).catch(() => { setRosterDoc(null); setLoadingBase(false); });
  }, [rosterDocId, authLoading, canView]);

  // ── Challenge records ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || !canView) return;
    const q = query(
      collection(db, 'cadetChallengeRecords'),
      where('cadetId', '==', rosterDocId),
    );
    return onSnapshot(q, snap => {
      const recs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.cycleNumber || a.cycleNum || 0) - (b.cycleNumber || b.cycleNum || 0));
      setChallengeRecs(recs);
    }, () => {});
  }, [rosterDocId, canView]);

  // ── Promotion board scores ────────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || !canView) return;
    const q = query(
      collection(db, 'promotionScores'),
      where('rosterDocId', '==', rosterDocId),
    );
    return onSnapshot(q, async snap => {
      const scores = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setBoardScores(scores);
      // Load board metadata for any boardIds we haven't fetched yet
      const boardIds = [...new Set(scores.map(s => s.boardId).filter(Boolean))];
      if (boardIds.length === 0) return;
      try {
        const existing = new Set(boards.map(b => b.id));
        const missing  = boardIds.filter(id => !existing.has(id));
        if (missing.length === 0) return;
        const snaps = await Promise.all(missing.map(id => getDoc(doc(db, 'promotionBoards', id))));
        const fetched = snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));
        setBoards(prev => [...prev, ...fetched]);
      } catch (_) {}
    }, () => {});
  }, [rosterDocId, canView]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ribbon awards ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || !canView) return;
    const q = query(collection(db, 'ribbonAwards'), where('rosterDocId', '==', rosterDocId));
    return onSnapshot(q, snap => {
      setRibbons(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
  }, [rosterDocId, canView]);

  // ── Uniform sizes ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || !canView) return;
    getDocs(query(collection(db, 'uniformSizes'), where('cadetId', '==', rosterDocId)))
      .then(snap => {
        if (!snap.empty) setSizes({ id: snap.docs[0].id, ...snap.docs[0].data() });
      })
      .catch(() => {});
  }, [rosterDocId, canView]);

  // ── Fundraiser entries ────────────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || !canView) return;
    getDocs(query(collection(db, 'fundraiserEntries'), where('cadetId', '==', rosterDocId)))
      .then(snap => {
        const entries = snap.docs.map(d => d.data()).filter(e => !e.voided);
        const total = entries.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        setFundraiser({ total, count: entries.length });
      })
      .catch(() => {});
  }, [rosterDocId, canView]);

  // ── Ribbon type catalog ───────────────────────────────────────────────────
  useEffect(() => {
    if (!canView) return;
    return onSnapshot(collection(db, 'ribbonTypes'), snap => {
      setRibbonTypes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
  }, [canView]);

  // ── Ribbon recommendations (pending only) ─────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || !canView) return;
    const q = query(
      collection(db, 'ribbonRecommendations'),
      where('rosterDocId', '==', rosterDocId),
      where('status', '==', 'pending'),
    );
    return onSnapshot(q, snap => {
      setRecommendations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});
  }, [rosterDocId, canView]);

  // ── Cadet yearly history ──────────────────────────────────────────────────
  useEffect(() => {
    if (!rosterDocId || !canView) return;
    setHistoryLoading(true);
    getDocs(query(collection(db, 'cadetYearlyHistory'), where('rosterId', '==', rosterDocId)))
      .then(snap => {
        const recs = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.schoolYear || '').localeCompare(a.schoolYear || ''));
        setHistoryRecs(recs);
        setHistoryLoading(false);
      })
      .catch(() => setHistoryLoading(false));
  }, [rosterDocId, canView]);

  // ── Board lookup map ──────────────────────────────────────────────────────
  const boardMap = useMemo(() => {
    const m = {};
    boards.forEach(b => { m[b.id] = b; });
    return m;
  }, [boards]);

  // ── Sort board scores newest-first ────────────────────────────────────────
  const sortedScores = useMemo(() => {
    return [...boardScores].sort((a, b) => {
      const ta = boardMap[a.boardId]?.boardDate?.toMillis?.() || 0;
      const tb = boardMap[b.boardId]?.boardDate?.toMillis?.() || 0;
      return tb - ta;
    });
  }, [boardScores, boardMap]);

  // ── Award ribbon ─────────────────────────────────────────────────────────
  const handleAwardRibbon = async () => {
    if (!awardForm.ribbonTypeId) { showToast('Select a ribbon type', 'err'); return; }
    const rt = ribbonTypes.find(r => r.id === awardForm.ribbonTypeId);
    if (!rt) { showToast('Ribbon type not found', 'err'); return; }
    setAwardSaving(true);
    try {
      const awardDocRef = await addDoc(collection(db, 'ribbonAwards'), {
        rosterDocId,
        ribbonTypeId:  rt.id,
        ribbonName:    rt.name,
        ribbonCode:    rt.code || '',
        cycleNumber:   awardForm.cycleNumber ? Number(awardForm.cycleNumber) : null,
        awardedDate:   awardForm.awardedDate || null,
        citation:      awardForm.citation.trim() || null,
        recommendedBy: awardForm.recommendedBy.trim() || null,
        awardedByUid:  user?.uid || '',
        awardedByName: userData?.fullName || '',
        status:        awardForm.status,
        createdAt:     serverTimestamp(),
      });
      // Mark source recommendation as approved if this award came from one
      if (fromRecommendationId) {
        try {
          await updateDoc(doc(db, 'ribbonRecommendations', fromRecommendationId), {
            status:             'approved',
            convertedToAwardId: awardDocRef.id,
            reviewedByUid:      user?.uid || '',
            reviewedByName:     userData?.fullName || '',
            reviewedAt:         serverTimestamp(),
          });
        } catch (_) {}
      }
      showToast('Ribbon awarded');
      setAwardForm({ ribbonTypeId: '', awardedDate: '', cycleNumber: '', citation: '', recommendedBy: '', status: 'pending' });
      setFromRecommendationId(null);
      setShowAwardModal(false);
    } catch {
      showToast('Failed to award ribbon — try again', 'err');
    } finally {
      setAwardSaving(false);
    }
  };

  // ── Staff photo assignment ────────────────────────────────────────────────
  const handleAssignPortrait = async (e) => {
    const file = e.target.files[0];
    if (!file || !rosterDoc?.linkedUid) return;
    setAssigningPortrait(true);
    try {
      const data = await uploadToCloudinary(file, 'image');
      await updateDoc(doc(db, 'users', rosterDoc.linkedUid), {
        portrait:               data.secure_url,
        portraitAssignedByStaff: true,
        portraitPending:        deleteField(),
        portraitPendingAt:      deleteField(),
      });
      setPortrait(data.secure_url);
      setLinkedUserData(prev => ({
        ...(prev || {}),
        portrait: data.secure_url,
        portraitAssignedByStaff: true,
        portraitPending: undefined,
      }));
      showToast('Photo assigned');
    } catch (err) {
      const msg = err?.code === 'permission-denied'
        ? 'Permission denied — contact S6 to adjust your access'
        : 'Upload failed — try again';
      showToast(msg, 'err');
    } finally {
      setAssigningPortrait(false);
    }
  };

  const handleApprovePortrait = async () => {
    if (!linkedUserData?.portraitPending || !rosterDoc?.linkedUid) return;
    setApprovingPortrait(true);
    try {
      await updateDoc(doc(db, 'users', rosterDoc.linkedUid), {
        portrait:         linkedUserData.portraitPending,
        portraitPending:  deleteField(),
        portraitPendingAt: deleteField(),
      });
      setPortrait(linkedUserData.portraitPending);
      setLinkedUserData(prev => ({
        ...(prev || {}),
        portrait: prev.portraitPending,
        portraitPending: undefined,
      }));
      showToast('Photo approved');
    } catch {
      showToast('Failed — try again', 'err');
    } finally {
      setApprovingPortrait(false);
    }
  };

  const handleRejectPortrait = async () => {
    if (!rosterDoc?.linkedUid) return;
    try {
      await updateDoc(doc(db, 'users', rosterDoc.linkedUid), {
        portraitPending:  deleteField(),
        portraitPendingAt: deleteField(),
      });
      setLinkedUserData(prev => ({ ...(prev || {}), portraitPending: undefined }));
      showToast('Photo request rejected');
    } catch {
      showToast('Failed — try again', 'err');
    }
  };

  // ── Convert recommendation to award ──────────────────────────────────────
  const handleConvertRecommendation = (rec) => {
    setAwardForm({
      ribbonTypeId:  rec.ribbonTypeId || '',
      awardedDate:   '',
      cycleNumber:   '',
      citation:      rec.reason || '',
      recommendedBy: rec.recommenderName || '',
      status:        'pending',
    });
    setFromRecommendationId(rec.id);
    setShowAwardModal(true);
  };

  const handleRejectRecommendation = async (id) => {
    try {
      await updateDoc(doc(db, 'ribbonRecommendations', id), {
        status:        'rejected',
        reviewedByUid: user?.uid || '',
        reviewedByName: userData?.fullName || '',
        reviewedAt:    serverTimestamp(),
      });
      showToast('Recommendation rejected');
    } catch {
      showToast('Failed — try again', 'err');
    }
  };

  // ── Delete cadet from profile ─────────────────────────────────────────────
  const handleDeleteCadet = async () => {
    if (!rosterDoc) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'roster', rosterDocId));
      navigate('/admin/personnel?tab=roster');
    } catch {
      showToast('Failed — try again', 'err');
      setDeleting(false);
      setShowDeleteConf(false);
    }
  };

  // ── Graduate cadet from profile ───────────────────────────────────────────
  const handleGraduateCadet = async () => {
    if (!rosterDoc) return;
    setGraduating(true);
    try {
      const batch = writeBatch(db);
      const relatedCollections = [
        { col: 'cadetChallengeRecords',  field: 'cadetId'     },
        { col: 'uniformSizes',           field: 'cadetId'     },
        { col: 'fundraiserEntries',      field: 'cadetId'     },
        { col: 'cadetYearlyHistory',     field: 'rosterId'    },
        { col: 'formSubmissions',        field: 'rosterDocId' },
      ];
      for (const { col, field } of relatedCollections) {
        const snap = await getDocs(query(collection(db, col), where(field, '==', rosterDocId)));
        snap.docs.forEach(d => batch.delete(d.ref));
      }
      batch.delete(doc(db, 'roster', rosterDocId));
      await batch.commit();
      navigate('/admin/personnel?tab=roster');
    } catch {
      showToast('Graduate failed — try again', 'err');
      setGraduating(false);
      setShowGradConf(false);
    }
  };

  // ── Render guards ─────────────────────────────────────────────────────────
  if (authLoading || loadingBase) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-yellow-500" size={40} />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex-1 p-6 md:p-10 w-full">
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <AlertTriangle className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Access Restricted</p>
        </div>
      </div>
    );
  }

  if (!rosterDoc) {
    return (
      <div className="flex-1 p-6 md:p-10 w-full">
        <Link
          to="/admin/personnel?tab=roster"
          className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors mb-6"
        >
          <ChevronLeft size={13} /> Back to Roster
        </Link>
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <AlertTriangle className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Cadet not found</p>
        </div>
      </div>
    );
  }

  const { fullName, rank, position, company, letLevel, cadetNumber, gender, notes } = rosterDoc;
  const initials = (fullName || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex-1 p-6 md:p-8 w-full max-w-5xl mx-auto space-y-6">

      {/* Back link */}
      <Link
        to="/admin/personnel?tab=roster"
        className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors"
      >
        <ChevronLeft size={13} /> Back to Roster
      </Link>

      {/* ── Header card ── */}
      <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-6">
        <div className="flex items-start gap-5 flex-wrap sm:flex-nowrap">
          {/* Portrait / initials + staff photo management */}
          <div className="shrink-0 space-y-2">
            <div className="relative">
              {portrait ? (
                <img
                  src={portrait}
                  alt={fullName}
                  className="w-20 h-20 rounded-2xl object-cover border-2 border-yellow-500/20"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-yellow-500/10 border-2 border-yellow-500/20 flex items-center justify-center">
                  <span className="text-2xl font-black text-yellow-500">{initials}</span>
                </div>
              )}
              {linkedUserData?.portraitPending && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                  <span className="text-[7px] font-black text-slate-950">!</span>
                </div>
              )}
            </div>

            {/* Staff-only photo controls */}
            {canManageRibbons && rosterDoc.linkedUid && (
              <div className="space-y-1.5 w-20">
                {linkedUserData?.portraitPending && (
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-1.5 space-y-1.5">
                    <p className="text-[8px] font-black text-yellow-500 uppercase tracking-widest text-center leading-tight">Pending Photo</p>
                    <img src={linkedUserData.portraitPending} alt="Pending" className="w-full aspect-square rounded-lg object-cover opacity-80" />
                    <div className="flex gap-1">
                      <button
                        onClick={handleApprovePortrait}
                        disabled={approvingPortrait}
                        className="flex-1 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[8px] font-black uppercase transition-colors disabled:opacity-50 flex items-center justify-center"
                        title="Approve this photo"
                      >
                        {approvingPortrait ? <Loader2 size={9} className="animate-spin" /> : <Check size={9} />}
                      </button>
                      <button
                        onClick={handleRejectPortrait}
                        className="flex-1 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[8px] font-black uppercase transition-colors flex items-center justify-center"
                        title="Reject this photo"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  </div>
                )}
                <label className={`flex items-center justify-center gap-1 w-full py-1.5 rounded-xl border border-dashed text-[8px] font-black uppercase tracking-widest transition-colors cursor-pointer ${assigningPortrait ? 'border-yellow-500/30 text-yellow-500' : 'border-slate-200 dark:border-white/10 text-slate-400 hover:text-yellow-500 hover:border-yellow-500/30'}`}>
                  {assigningPortrait ? <Loader2 size={9} className="animate-spin" /> : <Camera size={9} />}
                  {assigningPortrait ? '…' : 'Assign'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAssignPortrait} disabled={assigningPortrait} />
                </label>
              </div>
            )}
          </div>

          {/* Name / ID / metadata */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white leading-none">
                {fullName}
              </h1>
              {cadetNumber != null && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2 py-0.5 rounded-full font-mono shrink-0">
                  <Hash size={9} />
                  {pad5(cadetNumber)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap mt-2">
              {rank && (
                <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                  {rank}
                </span>
              )}
              {position && (
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2.5 py-1 rounded-full">
                  {position}
                </span>
              )}
              {company && (
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  {company} Co.
                </span>
              )}
              {letLevel && (
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                  {letLevel}
                </span>
              )}
              {gender && (
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                  gender === 'Male'   ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : gender === 'Female' ? 'bg-pink-500/10 text-pink-600 dark:text-pink-400'
                  : 'bg-slate-100 text-slate-500'
                }`}>
                  {gender}
                </span>
              )}
            </div>

            {notes && (
              <p className="text-xs text-slate-400 mt-2 italic">{notes}</p>
            )}

            {/* Action buttons */}
            {userLevel >= COMMAND_LEVEL && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                <button
                  onClick={() => navigate(`/admin/personnel?tab=roster&editId=${rosterDocId}`)}
                  title="Edit roster entry"
                  className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-colors"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => document.getElementById('cadet-history-section')?.scrollIntoView({ behavior: 'smooth' })}
                  title="View cadet history"
                  className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                >
                  <History size={14} />
                </button>
                <button
                  onClick={() => setShowDeleteConf(true)}
                  title="Remove from roster"
                  className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
                {userLevel >= ADMIN_LEVEL && (
                  <button
                    onClick={() => setShowGradConf(true)}
                    title="Mark as graduated"
                    className="p-2 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
                  >
                    <GraduationCap size={14} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-2 shrink-0">
            <Tile label="Challenge" value={challengeRecs.length > 0 ? `${challengeRecs.length} cycle${challengeRecs.length !== 1 ? 's' : ''}` : 'None'} />
            <Tile label="Boards"    value={boardScores.length || 'None'} />
            <Tile label="Raised"    value={fmt$(fundraiser.total)} />
          </div>
        </div>
      </div>

      {/* ── Cadet Challenge ── */}
      <Section icon={Dumbbell} title="Cadet Challenge" badge={challengeRecs.length > 0 ? `${challengeRecs.length} cycle${challengeRecs.length !== 1 ? 's' : ''}` : null}>
        {challengeRecs.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No challenge records found.</p>
        ) : (
          <div className="space-y-4">
            {challengeRecs.map(rec => (
              <div key={rec.id} className="rounded-2xl border border-blue-100 dark:border-white/5 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-800/40">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Cycle #{rec.cycleNum ?? '?'}
                  </span>
                  {rec.medicalExempt && (
                    <span className="text-[9px] font-black uppercase text-orange-500 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
                      Medical Exempt
                    </span>
                  )}
                </div>
                {rec.medicalExempt ? (
                  <div className="px-4 py-3">
                    <p className="text-xs text-slate-400 italic">Medically exempt — no scores recorded.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-5">
                    {EVENTS.map(({ key, label }, i) => (
                      <div key={key} className={`px-4 py-3 text-center ${i > 0 ? 'border-l border-blue-50 dark:border-white/[0.04]' : ''}`}>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                        <p className="text-sm font-black text-slate-700 dark:text-white tabular-nums">
                          {rec[key] != null ? rec[key] : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Promotion Boards ── */}
      <Section icon={ClipboardList} title="Promotion Boards" badge={boardScores.length > 0 ? boardScores.length : null}>
        {sortedScores.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No promotion board scores found.</p>
        ) : (
          <div className="space-y-4">
            {sortedScores.map(score => {
              const board = boardMap[score.boardId];
              const dateStr = board?.boardDate?.toDate
                ? board.boardDate.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null;
              const cats = board?.categories || [];
              return (
                <div key={score.id} className="rounded-2xl border border-blue-100 dark:border-white/5 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 dark:bg-slate-800/40 flex-wrap gap-2">
                    <div>
                      <p className="text-xs font-black text-slate-700 dark:text-slate-200">
                        {board?.title || score.boardId}
                      </p>
                      {dateStr && <p className="text-[9px] text-slate-400">{dateStr}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full tabular-nums">
                        {score.totalScore ?? 0} pts
                      </span>
                      {score.extraCredit > 0 && (
                        <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                          +{score.extraCredit} XC
                        </span>
                      )}
                    </div>
                  </div>
                  {cats.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-3">
                      {cats.map(cat => {
                        const val = score.scores?.[cat.id];
                        return (
                          <div key={cat.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/30 rounded-xl px-3 py-1.5">
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mr-2">{cat.label}</p>
                            <p className={`text-[10px] font-black tabular-nums shrink-0 ${
                              val === 100 ? 'text-emerald-600 dark:text-emerald-400'
                              : val === 90  ? 'text-blue-600 dark:text-blue-400'
                              : val === 80  ? 'text-yellow-600 dark:text-yellow-400'
                              : val === 0   ? 'text-red-500'
                              : 'text-slate-300 dark:text-slate-600'
                            }`}>
                              {val != null ? val : '—'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Ribbon Recommendations ── */}
      {canManageRibbons && (
        <Section
          icon={MessageSquare}
          title="Ribbon Recommendations"
          badge={recommendations.length > 0 ? recommendations.length : null}
          defaultOpen={recommendations.length > 0}
        >
          {recommendations.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No pending recommendations for this cadet.</p>
          ) : (
            <div className="space-y-3">
              {recommendations.map(rec => (
                <div key={rec.id} className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 dark:bg-yellow-500/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                    <div>
                      <p className="text-xs font-black text-slate-700 dark:text-slate-200">{rec.ribbonName || 'Unknown Ribbon'}</p>
                      {rec.ribbonCode && <p className="text-[9px] text-slate-400 uppercase tracking-wider">{rec.ribbonCode}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleConvertRecommendation(rec)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[9px] font-black uppercase tracking-widest transition-colors"
                      >
                        <Award size={9} /> Award
                      </button>
                      <button
                        onClick={() => handleRejectRecommendation(rec.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[9px] font-black uppercase tracking-widest transition-colors"
                      >
                        <X size={9} /> Reject
                      </button>
                    </div>
                  </div>
                  {rec.reason && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic leading-relaxed mb-2">"{rec.reason}"</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-black text-slate-400">From: {rec.recommenderName || 'Unknown'}</span>
                    {rec.recommenderRelation && (
                      <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-1.5 py-0.5 rounded-full capitalize">{rec.recommenderRelation}</span>
                    )}
                    {rec.recommenderEmail && (
                      <span className="text-[9px] text-slate-400">{rec.recommenderEmail}</span>
                    )}
                    {rec.createdAt?.toDate && (
                      <span className="text-[9px] text-slate-500">
                        {rec.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Ribbon Awards ── */}
      <Section
        icon={Award}
        title="Ribbon Awards"
        badge={ribbons.length > 0 ? ribbons.length : null}
        headerRight={
          <button
            onClick={() => setShowAwardModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-[9px] font-black uppercase tracking-widest rounded-xl transition-colors"
          >
            <Plus size={11} /> Award
          </button>
        }
      >
        {ribbons.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No ribbon awards on record.</p>
        ) : (
          <div className="space-y-2">
            {ribbons.map(r => {
              const name = r.ribbonName || (RIBBON_META[r.ribbon]?.label) || r.ribbon || 'Ribbon';
              const code = r.ribbonCode || (RIBBON_META[r.ribbon]?.code) || '';
              return (
                <div key={r.id} className="flex items-center justify-between rounded-2xl border px-4 py-3 bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/10">
                  <div>
                    <p className="text-xs font-black text-slate-700 dark:text-slate-200">{name}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">
                      {code}{r.cycleNumber ? ` · Cycle #${r.cycleNumber}` : ''}{r.awardedDate ? ` · ${r.awardedDate}` : ''}
                    </p>
                    {r.recommendedBy && (
                      <p className="text-[9px] text-slate-400">Recommended by {r.recommendedBy}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      r.status === 'issued'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20'
                    }`}>
                      {r.status === 'issued' ? 'Issued' : 'Pending'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Uniform Sizes ── */}
      <Section icon={Shirt} title="Uniform Sizes">
        {!sizes ? (
          <p className="text-xs text-slate-400 italic">No uniform sizes on record.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {[
              { key: 'shirtSize',          label: 'Shirt'          },
              { key: 'pantSize',           label: 'Pants'          },
              { key: 'shoeSize',           label: 'Shoes'          },
              { key: 'hatSize',            label: 'Hat'            },
              { key: 'beltSize',           label: 'Belt'           },
              { key: 'jacketSize',         label: 'Jacket'         },
              { key: 'hasClassA',          label: 'Has Class A'    },
              { key: 'cadetPosition',      label: 'Position'       },
            ].map(({ key, label }) => {
              const val = sizes[key];
              if (val == null || val === '') return null;
              return (
                <div key={key} className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl px-4 py-3">
                  <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                  <p className="text-sm font-black text-slate-700 dark:text-white">
                    {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : val}
                  </p>
                </div>
              );
            }).filter(Boolean)}
          </div>
        )}
      </Section>

      {/* ── Fundraiser ── */}
      <Section icon={DollarSign} title="Fundraiser">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Tile label="Total Raised"  value={fmt$(fundraiser.total)} />
          <Tile label="Transactions"  value={fundraiser.count || 'None'} />
        </div>
      </Section>

      {/* ── Cadet Yearly History ── */}
      <div id="cadet-history-section">
        <Section icon={History} title="Cadet History" badge={historyRecs.length > 0 ? historyRecs.length : null} defaultOpen={false}>
          {historyLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-yellow-500" size={24} />
            </div>
          ) : historyRecs.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No yearly history records found.</p>
          ) : (
            <div className="space-y-3">
              {historyRecs.map(rec => (
                <div key={rec.id} className="rounded-2xl border border-blue-100 dark:border-white/5 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/40">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {rec.schoolYear || 'Unknown Year'}
                    </span>
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {rec.rank && (
                      <div>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Rank</p>
                        <p className="font-black text-yellow-600 dark:text-yellow-400">{rec.rank}</p>
                      </div>
                    )}
                    {rec.position && (
                      <div>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Position</p>
                        <p className="font-bold text-slate-700 dark:text-slate-300">{rec.position}</p>
                      </div>
                    )}
                    {rec.company && (
                      <div>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">Company</p>
                        <p className="font-bold text-slate-700 dark:text-slate-300">{rec.company}</p>
                      </div>
                    )}
                    {rec.letLevel && (
                      <div>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-0.5">LET</p>
                        <p className="font-bold text-slate-700 dark:text-slate-300">{rec.letLevel}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-xs font-black shadow-xl ${
          toast.type === 'err' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ── Award Ribbon Modal ── */}
      {showAwardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">

            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-800 dark:text-white">Award Ribbon</h2>
              <button onClick={() => { setShowAwardModal(false); setFromRecommendationId(null); }} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Ribbon type */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                Ribbon Type <span className="text-red-500">*</span>
              </label>
              {ribbonTypes.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No ribbon types defined yet. Add types in the Ribbon Registry tab.</p>
              ) : (
                <select
                  value={awardForm.ribbonTypeId}
                  onChange={e => setAwardForm(f => ({ ...f, ribbonTypeId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                >
                  <option value="">— Select a ribbon type —</option>
                  {ribbonTypes.map(rt => (
                    <option key={rt.id} value={rt.id}>{rt.name}{rt.code ? ` (${rt.code})` : ''}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Date + Cycle */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Award Date</label>
                <input
                  type="date"
                  value={awardForm.awardedDate}
                  onChange={e => setAwardForm(f => ({ ...f, awardedDate: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Cycle #</label>
                <input
                  type="number"
                  min="1"
                  value={awardForm.cycleNumber}
                  onChange={e => setAwardForm(f => ({ ...f, cycleNumber: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                />
              </div>
            </div>

            {/* Recommended by */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Recommended By</label>
              <input
                value={awardForm.recommendedBy}
                onChange={e => setAwardForm(f => ({ ...f, recommendedBy: e.target.value }))}
                placeholder="Name or role (optional)"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
              />
            </div>

            {/* Citation */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Citation</label>
              <textarea
                value={awardForm.citation}
                onChange={e => setAwardForm(f => ({ ...f, citation: e.target.value }))}
                rows={2}
                placeholder="Optional justification or citation text"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 resize-none"
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Status</label>
              <div className="flex gap-2">
                {['pending', 'issued'].map(s => (
                  <button
                    key={s}
                    onClick={() => setAwardForm(f => ({ ...f, status: s }))}
                    className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                      awardForm.status === s
                        ? s === 'issued'
                          ? 'bg-emerald-500 text-white border-emerald-500'
                          : 'bg-yellow-500 text-slate-950 border-yellow-500'
                        : 'border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Awarded by (auto) */}
            <p className="text-[10px] text-slate-400">
              Awarded by: <span className="font-black">{userData?.fullName || 'You'}</span>
            </p>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowAwardModal(false); setFromRecommendationId(null); }}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAwardRibbon}
                disabled={awardSaving || !awardForm.ribbonTypeId}
                className="flex-1 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                {awardSaving ? <Loader2 size={14} className="animate-spin" /> : <Award size={14} />}
                {awardSaving ? 'Saving…' : 'Award Ribbon'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {showDeleteConf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-black text-slate-800 dark:text-white">Remove from Roster</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Remove {fullName} from the roster permanently? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConf(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleDeleteCadet}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Graduate confirm ── */}
      {showGradConf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-black text-slate-800 dark:text-white">Mark as Graduated</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Mark {fullName} as graduated? This removes them from the active roster and deletes all associated records permanently.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowGradConf(false)} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleGraduateCadet}
                disabled={graduating}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                {graduating ? <Loader2 size={14} className="animate-spin" /> : <GraduationCap size={14} />}
                {graduating ? 'Processing…' : 'Graduate'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminCadetProfile;
