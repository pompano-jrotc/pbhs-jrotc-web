// src/pages/AdminAARLogs.jsx
//
// AAR Logs — After Action Reports for battalion and company events.
//
// WHO CAN DO WHAT
//   Create              : company command (45+) and battalion staff (70+)
//   View own company    : company command (45–69) — their company's AARs only
//   View all            : battalion staff (70+)
//   Edit own            : the creator (45+)
//   Edit anyone + delete: XO/CSM/BC/S1 (myLevel >= 85 or s1_adjutant role)
//
// FIELDS PER AAR
//   Event name       — free text
//   Event date       — date picker
//   Company          — locked: battalion staff (70+) → null ("Battalion-wide");
//                      company command (45–69) → their own company; never editable
//   Attendee count   — number
//   Facilitators     — tag-style list (add/remove names)
//   Good items       — bullet-point list ("What went well")
//   Improve items    — bullet-point list ("Needs improvement")
//
// DATA MODEL (Firestore collection: aarLogs)
//   eventName      (string)
//   eventDate      (Timestamp)
//   company        (string | null)   — null = battalion-wide; string = company name
//   attendeeCount  (number)
//   facilitators   (string[])
//   goodItems      (BulletItem[])  — { text: string, children: string[] }[]; old docs use string[] (auto-upgraded on save)
//   improveItems   (BulletItem[])
//   createdBy      (uid)
//   createdByName  (string)
//   createdByCompany (string)
//   createdAt      (Timestamp)
//   updatedAt      (Timestamp | null)
//   updatedByName  (string | null)

import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { db, auth } from '../firebase';
import {
  collection, query, where, orderBy, onSnapshot,
  doc, addDoc, updateDoc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import {
  ClipboardCheck, Plus, X, Pencil, Trash2,
  Eye, Loader2, Users,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';
import BulletListEditor, { normalizeBullets } from '../components/BulletListEditor';
import { ROLE_HIERARCHY, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import DatePicker from '../components/DatePicker';

// ── Role constants ─────────────────────────────────────────────────────────────
// Who can edit ANYONE's AAR and delete:
const ELEVATED_EDIT_ROLES = ['battalion_xo', 'battalion_csm', 'sergeant_major', 'battalion_commander', 's1_adjutant'];

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function dateStrToTimestamp(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0));
}

function timestampToDateStr(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── FacilitatorEditor ─────────────────────────────────────────────────────────
// Tag-style list for facilitator names.
function FacilitatorEditor({ names, onChange, readOnly }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...names, t]);
    setDraft('');
  };
  const remove = (i) => onChange(names.filter((_, idx) => idx !== i));

  if (readOnly) {
    if (!names.length) return <span className="text-slate-300 dark:text-slate-600 text-sm">—</span>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {names.map((n, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[11px] font-bold bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-lg">
            {n}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {names.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 px-2.5 py-1 rounded-lg group">
              {n}
              <button onClick={() => remove(i)} className="text-slate-300 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors" title="Remove"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Facilitator name… (press Enter)"
          className="flex-1 bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
        />
        <button onClick={add} disabled={!draft.trim()} className="text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-lg bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 hover:bg-yellow-500 hover:text-slate-950 disabled:opacity-30 transition-all whitespace-nowrap">
          + Add
        </button>
      </div>
    </div>
  );
}

// ── Empty form template ────────────────────────────────────────────────────────
const mkEmpty = (defaultCompany = '') => ({
  eventName:    '',
  eventDate:    '',
  company:      defaultCompany,
  attendeeCount:'',
  facilitators: [],
  goodItems:    [],
  improveItems: [],
});

// ── Main page ──────────────────────────────────────────────────────────────────
const AdminAARLogs = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  const userLevel  = ROLE_HIERARCHY[role] || 0;
  const myCompany  = userData?.company || '';

  // ── Access flags ──────────────────────────────────────────────────────────────
  const isAuthorized    = userLevel >= COMMAND_LEVEL;          // 45+
  const canCreate       = isAuthorized;
  const isStaff         = userLevel >= STAFF_LEVEL;            // 70+
  const canElevatedEdit = ELEVATED_EDIT_ROLES.includes(role) || userLevel >= 85;
  const canDelete       = canElevatedEdit;
  // Company command (45–69) see their own company's AARs only:
  const isCompanyViewer = !isStaff && isAuthorized;
  const uid             = auth.currentUser?.uid;

  // ── Data state ─────────────────────────────────────────────────────────────────
  const [aars,        setAars]       = useState([]);
  const [loadingAars, setLoadingAars] = useState(true);
  const [aarsError,   setAarsError]  = useState(false);

  // ── Modal state ────────────────────────────────────────────────────────────────
  const [modalMode, setModalMode] = useState(null); // null | 'create' | 'edit' | 'view'
  const [activeAAR, setActiveAAR] = useState(null);
  const [form,      setForm]      = useState(mkEmpty(myCompany));
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(null);

  // ── Firestore subscription ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthorized) return;
    // Company names may have been stored in different cases historically (e.g. 'Bravo' vs 'BRAVO').
    // Query with all common casings so legacy records are included; security rules use .lower() to match.
    const companyCasings = myCompany
      ? [...new Set([myCompany, myCompany.toUpperCase(), myCompany.charAt(0).toUpperCase() + myCompany.slice(1).toLowerCase()])]
      : [];
    const q = isCompanyViewer && companyCasings.length > 0
      ? query(collection(db, 'aarLogs'), where('company', 'in', companyCasings), orderBy('createdAt', 'desc'))
      : query(collection(db, 'aarLogs'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setAars(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingAars(false);
      setAarsError(false);
    }, () => { setLoadingAars(false); setAarsError(true); });
  }, [isAuthorized, isCompanyViewer, myCompany]);

  // ── Handlers ───────────────────────────────────────────────────────────────────
  const openCreate = () => {
    // Battalion staff (70+) always log for the whole battalion (company: null).
    // Company command (45–69) always log for their own company.
    setForm(mkEmpty(isStaff ? null : myCompany));
    setActiveAAR(null);
    setModalMode('create');
  };

  const openEdit = (aar) => {
    setForm({
      eventName:     aar.eventName    || '',
      eventDate:     timestampToDateStr(aar.eventDate),
      // Use ?? so a battalion-wide record (company: null) stays null instead
      // of falling back to myCompany. Only truly-missing fields fall back.
      company:       aar.company      ?? null,
      attendeeCount: aar.attendeeCount != null ? String(aar.attendeeCount) : '',
      facilitators:  aar.facilitators || [],
      goodItems:     normalizeBullets(aar.goodItems),
      improveItems:  normalizeBullets(aar.improveItems),
    });
    setActiveAAR(aar);
    setModalMode('edit');
  };

  const openView = (aar) => {
    setActiveAAR(aar);
    setModalMode('view');
  };

  const closeModal = () => {
    setModalMode(null);
    setActiveAAR(null);
    setForm(mkEmpty(isStaff ? null : myCompany));
  };

  const handleSave = async () => {
    if (!form.eventDate || !form.eventName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        eventName:     form.eventName.trim(),
        eventDate:     dateStrToTimestamp(form.eventDate),
        company:       form.company,
        attendeeCount: parseInt(form.attendeeCount) || 0,
        facilitators:  form.facilitators,
        goodItems:     form.goodItems,
        improveItems:  form.improveItems,
        updatedAt:     Timestamp.now(),
        updatedByName: userData?.fullName || '',
      };

      if (modalMode === 'create') {
        await addDoc(collection(db, 'aarLogs'), {
          ...payload,
          createdBy:       uid,
          createdByName:   userData?.fullName    || '',
          createdByCompany: userData?.company    || '',
          createdAt:       Timestamp.now(),
        });
      } else {
        await updateDoc(doc(db, 'aarLogs', activeAAR.id), payload);
      }
      closeModal();
      writeLog({
        type: 'aar_log', action: modalMode === 'create' ? 'create' : 'update',
        description: `${modalMode === 'create' ? 'Created' : 'Updated'} AAR: "${payload.eventName}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: payload.eventName,
      });
    } catch (err) {
      console.error('AAR save error:', err);
      alert('Failed to save AAR. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (aar) => {
    const ok = await confirm(`Delete the AAR for "${aar.eventName}"? This cannot be undone.`, { title: 'Delete AAR', destructive: true });
    if (!ok) return;
    setDeleting(aar.id);
    try {
      await deleteDoc(doc(db, 'aarLogs', aar.id));
      writeLog({
        type: 'aar_log', action: 'delete',
        description: `Deleted AAR: "${aar.eventName}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: aar.id, targetName: aar.eventName,
      });
    } catch (err) {
      console.error('AAR delete error:', err);
      alert('Failed to delete AAR.');
    } finally {
      setDeleting(null);
    }
  };

  // ── Guards ─────────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500" />
    </div>
  );

  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  // ════════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════════
  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={ClipboardCheck} title="AAR Logs" />}

      {/* ── Header actions ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-10">
        {isCompanyViewer && (
          <div className="p-4 bg-blue-50/60 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/10 rounded-2xl flex items-center gap-3">
            <Eye className="text-blue-400 shrink-0" size={15} />
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400">
              Showing AARs for {myCompany} Company.
            </p>
          </div>
        )}
        <div className="ml-auto">
          {canCreate && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus size={14} /> New AAR
            </button>
          )}
        </div>
      </div>

      {/* ── AAR cards ─────────────────────────────────────────────────────────── */}
      {loadingAars ? (
        <div className="text-center py-24">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-yellow-500 mx-auto" />
          <p className="text-slate-400 text-xs font-bold mt-4 uppercase tracking-widest">Loading AARs…</p>
        </div>
      ) : aarsError ? (
        <div className="text-center py-16 border-2 border-dashed border-red-200 dark:border-red-500/20 rounded-3xl">
          <p className="text-red-500 dark:text-red-400 font-black uppercase tracking-widest text-sm">Unable to load AARs</p>
          <p className="text-slate-400 text-xs mt-2">A database index may still be building. Try again in a few minutes.</p>
        </div>
      ) : aars.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <ClipboardCheck className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={40} />
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No AARs filed yet</p>
          {canCreate && (
            <button onClick={openCreate} className="mt-4 text-yellow-600 dark:text-yellow-500 text-xs font-black uppercase tracking-widest hover:underline">
              File the first one →
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-blue-100 dark:border-white/5 bg-blue-50/40 dark:bg-slate-800/30">
                  <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Event</th>
                  <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden md:table-cell">Date</th>
                  {isStaff && <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden md:table-cell">Company</th>}
                  <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden lg:table-cell">
                    <Users size={10} className="inline-block mr-1" />Attendees
                  </th>
                  <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden lg:table-cell">Facilitators</th>
                  <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden md:table-cell">Good / Improve</th>
                  <th className="px-4 py-3 text-right text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {aars.map(aar => {
                  const logCanEdit = canElevatedEdit || aar.createdBy === uid;
                  return (
                    <tr key={aar.id} className="border-b border-blue-50 dark:border-white/5 hover:bg-blue-50/20 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{aar.eventName || '—'}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">by {aar.createdByName || '—'}</p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap hidden md:table-cell">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{fmtDate(aar.eventDate)}</span>
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-[10px] font-black uppercase tracking-wider bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 px-2 py-0.5 rounded">
                            {aar.company || 'Battalion-wide'}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-400 tabular-nums">{aar.attendeeCount ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {(aar.facilitators || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {aar.facilitators.slice(0, 2).map((f, i) => (
                              <span key={i} className="text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded">
                                {f}
                              </span>
                            ))}
                            {aar.facilitators.length > 2 && (
                              <span className="text-[10px] text-slate-400">+{aar.facilitators.length - 2}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex gap-3 text-[10px] font-bold">
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {(aar.goodItems || []).length} good
                          </span>
                          <span className="text-orange-500 dark:text-orange-400">
                            {(aar.improveItems || []).length} improve
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => openView(aar)}
                            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 bg-blue-50/50 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-all"
                          >
                            <Eye size={10} /> View
                          </button>
                          {logCanEdit && (
                            <button
                              onClick={() => openEdit(aar)}
                              className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-yellow-600 dark:hover:text-yellow-500 bg-yellow-50/50 dark:bg-slate-800 hover:bg-yellow-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-all"
                            >
                              <Pencil size={10} /> Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(aar)}
                              disabled={deleting === aar.id}
                              className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-300 hover:text-red-600 dark:text-slate-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 px-2 py-1.5 rounded-lg transition-all disabled:opacity-40"
                            >
                              {deleting === aar.id ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          CREATE / EDIT / VIEW MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 bg-black/50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-2xl shadow-2xl border border-blue-100 dark:border-white/5 my-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-0 mb-6">
              <h2 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                {modalMode === 'create' ? 'New AAR'
                 : modalMode === 'edit'   ? `Edit AAR — ${activeAAR?.eventName}`
                 : activeAAR?.eventName || 'AAR Report'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="px-8 pb-8 space-y-6">

              {/* ── Event Info ─────────────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                {/* Event name */}
                <div className="col-span-2">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Event Name</label>
                  {modalMode === 'view' ? (
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{activeAAR?.eventName || '—'}</p>
                  ) : (
                    <input
                      value={form.eventName}
                      onChange={e => setForm(f => ({ ...f, eventName: e.target.value }))}
                      placeholder="e.g., Fall Military Ball, Battalion Drill, Range Day…"
                      className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                    />
                  )}
                </div>

                {/* Event date */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Event Date</label>
                  {modalMode === 'view' ? (
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{fmtDate(activeAAR?.eventDate)}</p>
                  ) : (
                    <DatePicker
                      value={form.eventDate}
                      onChange={v => setForm(f => ({ ...f, eventDate: v }))}
                    />
                  )}
                </div>

                {/* Company — always locked: battalion staff → Battalion-wide (null);
                      company command → their own company. */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Company</label>
                  {modalMode === 'view' ? (
                    <span className="inline-block text-sm font-black uppercase tracking-wider bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 px-2.5 py-1 rounded-lg">
                      {activeAAR?.company || 'Battalion-wide'}
                    </span>
                  ) : (
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 px-4 py-3 bg-blue-50/30 dark:bg-slate-800/50 rounded-xl border border-blue-100 dark:border-white/5">
                      {form.company || 'Battalion-wide'}
                    </p>
                  )}
                </div>
              </div>

              {/* ── Attendee Count ───────────────────────────────────────────── */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">
                  Number of Attendees
                </label>
                {modalMode === 'view' ? (
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {activeAAR?.attendeeCount != null ? activeAAR.attendeeCount : '—'}
                  </p>
                ) : (
                  <input
                    type="number"
                    min={0}
                    value={form.attendeeCount}
                    onChange={e => setForm(f => ({ ...f, attendeeCount: e.target.value }))}
                    placeholder="0"
                    className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                  />
                )}
              </div>

              {/* ── Facilitators ─────────────────────────────────────────────── */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-2">
                  Facilitator(s)
                </label>
                <FacilitatorEditor
                  names={modalMode === 'view' ? (activeAAR?.facilitators || []) : form.facilitators}
                  onChange={names => setForm(f => ({ ...f, facilitators: names }))}
                  readOnly={modalMode === 'view'}
                />
              </div>

              {/* ── What Went Well ───────────────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    What Went Well
                  </label>
                </div>
                {modalMode === 'view' ? (
                  <BulletListEditor items={activeAAR?.goodItems || []} onChange={() => {}} readOnly color="green" />
                ) : (
                  <BulletListEditor
                    items={form.goodItems}
                    onChange={items => setForm(f => ({ ...f, goodItems: items }))}
                    placeholder="Add a positive… (press Enter)"
                    color="green"
                  />
                )}
              </div>

              {/* ── Needs Improvement ────────────────────────────────────────── */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    Needs Improvement
                  </label>
                </div>
                {modalMode === 'view' ? (
                  <BulletListEditor items={activeAAR?.improveItems || []} onChange={() => {}} readOnly />
                ) : (
                  <BulletListEditor
                    items={form.improveItems}
                    onChange={items => setForm(f => ({ ...f, improveItems: items }))}
                    placeholder="Add an improvement… (press Enter)"
                  />
                )}
              </div>

              {/* ── Created / updated info ────────────────────────────────────── */}
              {modalMode === 'view' && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-white/5 pt-3">
                  Filed by {activeAAR?.createdByName || '—'} ({activeAAR?.company || 'Battalion-wide'})
                  {activeAAR?.updatedAt && ` · Updated ${fmtDate(activeAAR.updatedAt)} by ${activeAAR.updatedByName || '—'}`}
                </p>
              )}

              {/* ── Action buttons ────────────────────────────────────────────── */}
              {modalMode !== 'view' && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={closeModal}
                    className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-blue-50/50 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 transition-colors border border-blue-100 dark:border-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!form.eventDate || !form.eventName.trim() || saving}
                    className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? 'Saving…' : modalMode === 'create' ? 'File AAR' : 'Save Changes'}
                  </button>
                </div>
              )}

              {modalMode === 'view' && (canElevatedEdit || activeAAR?.createdBy === uid) && (
                <div className="pt-2">
                  <button
                    onClick={() => { closeModal(); openEdit(activeAAR); }}
                    className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-wider bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 hover:bg-yellow-500 hover:text-slate-950 transition-all border border-yellow-200/50 dark:border-yellow-500/20"
                  >
                    <span className="flex items-center justify-center gap-2"><Pencil size={12} /> Edit This AAR</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAARLogs;
