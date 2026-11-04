// src/pages/AdminS2.jsx
//
// S2 Intelligence — Inspection Management
//
// S2 (s2_intelligence) view:
//   Tab: Items   — manage the list of inspectable items (rifles + cabinets)
//   Tab: Assign  — create inspection assignments for S2 assistants
//   Tab: Review  — view submitted inspections, approve / reject
//
// S2 Assistant (company_s2_assistant) view:
//   Their pending and past inspection assignments — mark checklist items,
//   add notes, upload a photo, then submit.
//
// Items are pre-loaded and S2 can add/edit/delete as rifles come and go.
// Photos are stored in Firebase Storage and auto-deleted after 90 days.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY, ROLE_LABELS } from '../constants';
import { uploadPhotoToStorage, deletePhotoFromStorage } from '../utils/storageUploadPhoto';
import {
  Search, Plus, Trash2, Edit3, X, Loader2, CheckCircle2, XCircle,
  Shield, Eye, Camera, Package, ClipboardList, Users, ChevronDown,
  ImageIcon, RotateCcw, AlertTriangle, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AdminPageHeader from '../components/AdminPageHeader';

// ── Constants ──────────────────────────────────────────────────────────────────

const S2_ROLE       = 's2_intelligence';
const ASSISTANT_ROLE = 'company_s2_assistant';
const STAFF_LEVEL   = 70;

const AREA_LABELS = {
  armory:           'Armory (General)',
  rifle:            'Rifle (Armory)',
  s4_cabinet:       'S4 Cabinet',
  uniform_cabinet:  'Uniform Cabinet',
  flags_cabinet:    'Flags Cabinet',
  supply_cabinet:   'Supply Cabinet',
};

const PHOTO_RETENTION_DAYS = 90;

// Firestore doc ID helper
const ic = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const lc = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

function deleteAt90Days() {
  const d = new Date();
  d.setDate(d.getDate() + PHOTO_RETENTION_DAYS);
  return Timestamp.fromDate(d);
}

const statusColor = (s) =>
  s === 'approved'  ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
  s === 'rejected'  ? 'bg-red-500/10 text-red-500' :
  s === 'submitted' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
  'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';

// ── Main component ─────────────────────────────────────────────────────────────

const AdminS2 = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const userLevel    = ROLE_HIERARCHY[role] || 0;
  const isS2         = role === S2_ROLE;
  const isAssistant  = role === ASSISTANT_ROLE;
  const isStaff      = userLevel >= STAFF_LEVEL;
  const canManage    = isS2 || isStaff;

  const [activeTab,   setActiveTab]   = useState('items');
  const [toast,       setToast]       = useState(null);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-yellow-500" size={40} /></div>;
  if (!canManage && !isAssistant) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center p-8">
        <div>
          <Search className="mx-auto text-yellow-500 mb-4" size={40} />
          <p className="font-black uppercase text-sm text-slate-500">Access Restricted</p>
          <p className="text-xs text-slate-400 mt-2">This page is for S2 Intelligence and S2 Assistants.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={Shield} title="S2 Inspections" meta={`Intelligence · ${ROLE_LABELS[role] || role}`} />}

        {/* S2 management tabs */}
        {canManage && (
          <>
            <div className="flex gap-2 mb-8 flex-wrap">
              {[
                { id: 'items',  label: 'Manage Items', icon: <Package size={14} /> },
                { id: 'assign', label: 'Assign',       icon: <Users size={14} /> },
                { id: 'review', label: 'Review',       icon: <Eye size={14} /> },
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                    activeTab === tab.id
                      ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                      : 'bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500/30'
                  }`}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            {activeTab === 'items'  && <ItemsTab  user={user} userData={userData} showToast={showToast} />}
            {activeTab === 'assign' && <AssignTab user={user} userData={userData} showToast={showToast} />}
            {activeTab === 'review' && <ReviewTab user={user} userData={userData} showToast={showToast} canManage={canManage} />}
          </>
        )}

        {/* S2 assistant view */}
        {isAssistant && !canManage && (
          <MyInspectionsTab user={user} userData={userData} showToast={showToast} />
        )}

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

// ── Items Tab ─────────────────────────────────────────────────────────────────

const ItemsTab = ({ user, userData, showToast }) => {
  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [form,        setForm]        = useState({ name: '', area: 'rifle', serialNumber: '' });
  const [saving,      setSaving]      = useState(false);
  const [deleteConf,  setDeleteConf]  = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 's2Items'), where('isActive', '==', true), orderBy('area', 'asc'), orderBy('name', 'asc')),
      snap => { setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const openCreate = () => { setForm({ name: '', area: 'rifle', serialNumber: '' }); setEditing(null); setShowForm(true); };
  const openEdit   = (item) => { setForm({ name: item.name, area: item.area, serialNumber: item.serialNumber || '' }); setEditing(item); setShowForm(true); };
  const closeForm  = () => { setShowForm(false); setEditing(null); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        area: form.area,
        serialNumber: form.serialNumber.trim() || null,
        isActive: true,
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 's2Items', editing.id), payload);
        showToast('Item updated');
      } else {
        await addDoc(collection(db, 's2Items'), { ...payload, createdAt: serverTimestamp(), createdByUid: user.uid });
        showToast('Item added');
      }
      closeForm();
      writeLog({
        type: 's2', action: editing ? 'update' : 'create',
        description: `${editing ? 'Updated' : 'Added'} S2 item: "${form.name}" (${form.area})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: form.name,
      });
    } catch (err) { console.error(err); showToast('Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteConf) return;
    try {
      await updateDoc(doc(db, 's2Items', deleteConf.id), { isActive: false });
      setDeleteConf(null); showToast('Item removed');
      writeLog({
        type: 's2', action: 'delete',
        description: `Removed S2 item: "${deleteConf.name}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConf.id, targetName: deleteConf.name,
      });
    } catch { showToast('Delete failed'); }
  };

  const grouped = useMemo(() => {
    const g = {};
    items.forEach(item => {
      const key = AREA_LABELS[item.area] || item.area;
      if (!g[key]) g[key] = [];
      g[key].push(item);
    });
    return g;
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{items.length} active items</p>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-yellow-500/20">
          <Plus size={14} /> Add Item
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(n => <div key={n} className="h-12 bg-slate-100 dark:bg-slate-900/60 rounded-xl animate-pulse" />)}</div>
      ) : Object.entries(grouped).map(([area, areaItems]) => (
        <div key={area}>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-yellow-500 mb-2">{area}</p>
          <div className="space-y-2">
            {areaItems.map(item => (
              <div key={item.id}
                className="flex items-center justify-between bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl p-4 shadow-sm">
                <div>
                  <p className="font-black text-sm">{item.name}</p>
                  {item.serialNumber && <p className="text-[10px] text-slate-400 font-mono">S/N: {item.serialNumber}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(item)} className="p-2 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all"><Edit3 size={14} /></button>
                  <button onClick={() => setDeleteConf(item)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Form modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && closeForm()}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-md shadow-2xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <h2 className="font-black uppercase text-sm tracking-widest">{editing ? 'Edit Item' : 'Add Item'}</h2>
                <button onClick={closeForm} aria-label="Close" className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={18} /></button>
              </div>
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div>
                  <label className={lc}>Area *</label>
                  <select required value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} className={ic}>
                    {Object.entries(AREA_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lc}>Item Name *</label>
                  <input required type="text" placeholder="e.g. M-1903 Rifle" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={ic} />
                </div>
                <div>
                  <label className={lc}>Serial Number (optional)</label>
                  <input type="text" placeholder="e.g. 7412583" value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} className={ic} />
                </div>
                <button type="submit" disabled={saving}
                  className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2">
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={14} /> {editing ? 'Save Changes' : 'Add Item'}</>}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Trash2 className="mx-auto text-red-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Remove Item?</h3>
              <p className="text-sm text-slate-500 mb-6">Remove <strong>{deleteConf.name}</strong> from the inspection list?</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConf(null)} className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-black text-xs uppercase text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all">Cancel</button>
                <button onClick={handleDelete} className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-black text-xs uppercase tracking-widest transition-all">Remove</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── Assign Tab ────────────────────────────────────────────────────────────────

const AssignTab = ({ user, userData, showToast }) => {
  const [assistants,    setAssistants]    = useState([]);
  const [items,         setItems]         = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [assignTo,      setAssignTo]      = useState('');
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'users'), where('role', '==', 'company_s2_assistant'), where('approved', '==', true), orderBy('fullName', 'asc')), snap => {
      setAssistants(snap.docs.map(d => ({ uid: d.id, ...d.data() })));
    });
    const u2 = onSnapshot(query(collection(db, 's2Items'), where('isActive', '==', true), orderBy('area', 'asc'), orderBy('name', 'asc')), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { u1(); u2(); };
  }, []);

  const toggleItem = (id) => {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleAssign = async () => {
    if (!assignTo || selectedItems.length === 0) { showToast('Select an assistant and at least one item.'); return; }
    setSaving(true);
    try {
      const assistant = assistants.find(a => a.uid === assignTo);
      const itemSnapshots = items.filter(i => selectedItems.includes(i.id)).map(i => ({
        s2ItemId:     i.id,
        itemName:     i.name,
        area:         i.area,
        serialNumber: i.serialNumber || null,
        checked:      false,
        notes:        '',
      }));
      await addDoc(collection(db, 's2Inspections'), {
        assignedToUid:  assignTo,
        assignedToName: assistant?.fullName || '',
        assignedByUid:  user.uid,
        assignedByName: userData?.fullName || '',
        assignedAt:     serverTimestamp(),
        status:         'pending',
        itemSnapshots,
        photoUrl:       null,
        photoStoragePath: null,
        photoDeleteAt:  null,
        submittedAt:    null,
        approvedAt:     null,
        approvedByName: null,
        notes:          '',
      });
      setSelectedItems([]);
      setAssignTo('');
      showToast(`Inspection assigned to ${assistant?.fullName || 'assistant'}`);
      writeLog({
        type: 's2', action: 'assign',
        description: `Assigned S2 inspection to ${assistant?.fullName || assignTo} (${selectedItems.length} items)`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: assistant?.fullName,
      });
    } catch (err) { console.error(err); showToast('Assignment failed'); }
    finally { setSaving(false); }
  };

  const grouped = useMemo(() => {
    const g = {};
    items.forEach(item => {
      const key = AREA_LABELS[item.area] || item.area;
      if (!g[key]) g[key] = [];
      g[key].push(item);
    });
    return g;
  }, [items]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <label className={lc}>Assign to S2 Assistant *</label>
        <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className={ic}>
          <option value="">— Select Assistant —</option>
          {assistants.map(a => <option key={a.uid} value={a.uid}>{a.fullName} ({a.company || 'no company'})</option>)}
        </select>
      </div>

      <div>
        <p className="text-[10px] font-black uppercase text-yellow-500 tracking-widest mb-3">
          Select Items to Inspect ({selectedItems.length} selected)
        </p>
        {Object.entries(grouped).map(([area, areaItems]) => (
          <div key={area} className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{area}</p>
            <div className="space-y-2">
              {areaItems.map(item => (
                <label key={item.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-blue-100 dark:border-white/5 bg-white dark:bg-slate-900 cursor-pointer hover:border-yellow-500/30 transition-all">
                  <div
                    onClick={() => toggleItem(item.id)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                      selectedItems.includes(item.id) ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-white/20'
                    }`}
                  >
                    {selectedItems.includes(item.id) && <CheckCircle2 size={12} className="text-slate-950" />}
                  </div>
                  <div>
                    <p className="font-bold text-sm">{item.name}</p>
                    {item.serialNumber && <p className="text-[10px] text-slate-400 font-mono">S/N: {item.serialNumber}</p>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button onClick={handleAssign} disabled={saving || !assignTo || selectedItems.length === 0}
        className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-xs uppercase tracking-widest px-6 py-3 rounded-xl transition-all shadow-lg shadow-yellow-500/20">
        {saving ? <><Loader2 size={14} className="animate-spin" /> Assigning…</> : <><ClipboardList size={14} /> Assign Inspection</>}
      </button>
    </div>
  );
};

// ── Review Tab ────────────────────────────────────────────────────────────────

const ReviewTab = ({ user, userData, showToast, canManage }) => {
  const [inspections, setInspections] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [viewing,     setViewing]     = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 's2Inspections'), orderBy('assignedAt', 'desc')),
      snap => { setInspections(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const handleApprove = async (id) => {
    const ins = inspections.find(i => i.id === id);
    try {
      await updateDoc(doc(db, 's2Inspections', id), {
        status: 'approved', approvedAt: serverTimestamp(), approvedByName: userData?.fullName || '',
      });
      setViewing(null); showToast('Inspection approved');
      writeLog({
        type: 's2', action: 'approve',
        description: `Approved S2 inspection for ${ins?.assignedToName || id}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: ins?.assignedToName,
      });
    } catch { showToast('Failed'); }
  };

  const handleReject = async (id) => {
    const ins = inspections.find(i => i.id === id);
    try {
      await updateDoc(doc(db, 's2Inspections', id), {
        status: 'rejected', rejectedAt: serverTimestamp(), rejectedByName: userData?.fullName || '',
      });
      setViewing(null); showToast('Inspection returned');
      writeLog({
        type: 's2', action: 'reject',
        description: `Returned S2 inspection to ${ins?.assignedToName || id} for corrections`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: ins?.assignedToName,
      });
    } catch { showToast('Failed'); }
  };

  const submitted = inspections.filter(i => i.status === 'submitted');
  const others    = inspections.filter(i => i.status !== 'submitted');

  return (
    <div className="space-y-4">
      {loading ? (
        [1,2,3].map(n => <div key={n} className="h-16 bg-slate-100 dark:bg-slate-900/60 rounded-2xl animate-pulse" />)
      ) : inspections.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <ClipboardList className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No inspections yet</p>
        </div>
      ) : (
        <>
          {submitted.length > 0 && (
            <>
              <p className="text-[10px] font-black uppercase text-yellow-500 tracking-widest">Awaiting Review ({submitted.length})</p>
              {submitted.map(ins => <InspectionCard key={ins.id} ins={ins} onView={() => setViewing(ins)} />)}
            </>
          )}
          {others.length > 0 && (
            <>
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mt-4">All Inspections</p>
              {others.map(ins => <InspectionCard key={ins.id} ins={ins} onView={() => setViewing(ins)} />)}
            </>
          )}
        </>
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {viewing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setViewing(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <div>
                  <h2 className="font-black uppercase text-sm tracking-widest">Inspection Detail</h2>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {viewing.assignedToName} · <span className={`font-bold ${statusColor(viewing.status)}`}>{viewing.status}</span>
                  </p>
                </div>
                <button onClick={() => setViewing(null)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                {/* Photo */}
                {viewing.photoUrl ? (
                  <div>
                    <p className={lc}>Inspection Photo</p>
                    <img src={viewing.photoUrl} alt="Inspection" className="w-full rounded-xl object-cover max-h-64" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-slate-400 text-xs font-bold">
                    <ImageIcon size={14} /> No photo submitted
                  </div>
                )}
                {/* Checklist items */}
                <div>
                  <p className={lc}>Checklist ({(viewing.itemSnapshots || []).filter(i => i.checked).length}/{(viewing.itemSnapshots || []).length} checked)</p>
                  <div className="space-y-2 mt-2">
                    {(viewing.itemSnapshots || []).map((item, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20">
                        <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 ${item.checked ? 'bg-green-500' : 'bg-slate-200 dark:bg-white/10'}`}>
                          {item.checked && <CheckCircle2 size={12} className="text-white" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm">{item.itemName}</p>
                          {item.serialNumber && <p className="text-[10px] text-slate-400 font-mono">S/N: {item.serialNumber}</p>}
                          {item.notes && <p className="text-xs text-slate-500 mt-1 italic">{item.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {viewing.notes && (
                  <div>
                    <p className={lc}>Overall Notes</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300 italic">{viewing.notes}</p>
                  </div>
                )}
                {/* Actions */}
                {canManage && viewing.status === 'submitted' && (
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => handleApprove(viewing.id)}
                      className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                      <CheckCircle2 size={14} /> Approve
                    </button>
                    <button onClick={() => handleReject(viewing.id)}
                      className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-400 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2">
                      <RotateCcw size={14} /> Return
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── My Inspections Tab (S2 Assistant) ────────────────────────────────────────

const MyInspectionsTab = ({ user, userData, showToast }) => {
  const [inspections, setInspections] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(null); // inspection id
  const [submitForm,  setSubmitForm]  = useState(null); // { inspection, items, notes, photo, uploading, progress }

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 's2Inspections'), where('assignedToUid', '==', user.uid), orderBy('assignedAt', 'desc')),
      snap => { setInspections(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, [user.uid]);

  const openSubmit = (ins) => {
    setSubmitForm({
      inspection: ins,
      items: (ins.itemSnapshots || []).map(i => ({ ...i })),
      notes: '',
      photo: null,
      uploading: false,
      progress: 0,
    });
  };

  const toggleCheck = (idx) => {
    setSubmitForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], checked: !items[idx].checked };
      return { ...f, items };
    });
  };

  const setItemNote = (idx, note) => {
    setSubmitForm(f => {
      const items = [...f.items];
      items[idx] = { ...items[idx], notes: note };
      return { ...f, items };
    });
  };

  const handleSubmit = async () => {
    if (!submitForm.photo) { showToast('Please attach a photo.'); return; }
    setSubmitForm(f => ({ ...f, uploading: true }));
    try {
      const { url, storagePath } = await uploadPhotoToStorage(
        submitForm.photo,
        's2-inspections',
        pct => setSubmitForm(f => ({ ...f, progress: pct })),
      );
      await updateDoc(doc(db, 's2Inspections', submitForm.inspection.id), {
        status:           'submitted',
        itemSnapshots:    submitForm.items,
        notes:            submitForm.notes.trim(),
        photoUrl:         url,
        photoStoragePath: storagePath,
        photoDeleteAt:    deleteAt90Days(),
        submittedAt:      serverTimestamp(),
      });
      setSubmitForm(null); showToast('Inspection submitted!');
    } catch (err) { console.error(err); showToast('Submit failed — try again'); }
    finally { setSubmitForm(f => f ? { ...f, uploading: false } : null); }
  };

  const pending   = inspections.filter(i => i.status === 'pending' || i.status === 'rejected');
  const submitted = inspections.filter(i => i.status === 'submitted' || i.status === 'approved');

  return (
    <div className="space-y-4">
      {loading ? (
        [1,2].map(n => <div key={n} className="h-20 bg-slate-100 dark:bg-slate-900/60 rounded-2xl animate-pulse" />)
      ) : inspections.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <ClipboardList className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No inspections assigned</p>
          <p className="text-xs text-slate-400 mt-2">S2 Intelligence will assign inspections here.</p>
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <p className="text-[10px] font-black uppercase text-yellow-500 tracking-widest">Pending ({pending.length})</p>
              {pending.map(ins => (
                <InspectionCard key={ins.id} ins={ins} onView={() => openSubmit(ins)} actionLabel="Complete" />
              ))}
            </>
          )}
          {submitted.length > 0 && (
            <>
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mt-4">Completed</p>
              {submitted.map(ins => <InspectionCard key={ins.id} ins={ins} />)}
            </>
          )}
        </>
      )}

      {/* Submit drawer */}
      <AnimatePresence>
        {submitForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setSubmitForm(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <h2 className="font-black uppercase text-sm tracking-widest">Complete Inspection</h2>
                <button onClick={() => setSubmitForm(null)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-5">
                {/* Checklist */}
                <div>
                  <p className={lc}>Checklist ({submitForm.items.filter(i => i.checked).length}/{submitForm.items.length})</p>
                  <div className="space-y-3 mt-2">
                    {submitForm.items.map((item, idx) => (
                      <div key={idx} className="p-3 rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20">
                        <label className="flex items-start gap-3 cursor-pointer">
                          <div onClick={() => toggleCheck(idx)}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all cursor-pointer ${item.checked ? 'bg-green-500 border-green-500' : 'border-slate-300 dark:border-white/20'}`}>
                            {item.checked && <CheckCircle2 size={12} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm">{item.itemName}</p>
                            {item.serialNumber && <p className="text-[10px] text-slate-400 font-mono">S/N: {item.serialNumber}</p>}
                          </div>
                        </label>
                        <textarea rows={2}
                          value={item.notes}
                          onChange={e => setItemNote(idx, e.target.value)}
                          placeholder="Notes (optional)…"
                          className="mt-2 w-full text-xs bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg p-2 resize-none outline-none focus:border-yellow-500 text-slate-700 dark:text-slate-300" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Overall notes */}
                <div>
                  <label className={lc}>Overall Notes (optional)</label>
                  <textarea rows={2}
                    value={submitForm.notes}
                    onChange={e => setSubmitForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Any general observations…"
                    className={`${ic} resize-none`} />
                </div>

                {/* Photo */}
                <div>
                  <label className={lc}>Inspection Photo *</label>
                  <label className="flex flex-col items-center gap-2 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-6 cursor-pointer hover:border-yellow-500/50 transition-all">
                    <Camera size={24} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-500">
                      {submitForm.photo ? submitForm.photo.name : 'Tap to attach photo'}
                    </span>
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={e => e.target.files[0] && setSubmitForm(f => ({ ...f, photo: e.target.files[0] }))} />
                  </label>
                  {submitForm.uploading && (
                    <div className="mt-2 h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-500 transition-all" style={{ width: `${submitForm.progress}%` }} />
                    </div>
                  )}
                </div>

                <button onClick={handleSubmit} disabled={submitForm.uploading}
                  className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2">
                  {submitForm.uploading
                    ? <><Loader2 size={14} className="animate-spin" /> Uploading {submitForm.progress}%…</>
                    : <><CheckCircle2 size={14} /> Submit Inspection</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── InspectionCard ─────────────────────────────────────────────────────────────

const InspectionCard = ({ ins, onView, actionLabel = 'View' }) => {
  const ts = ins.assignedAt?.toDate ? ins.assignedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const checkedCount = (ins.itemSnapshots || []).filter(i => i.checked).length;
  const totalCount   = (ins.itemSnapshots || []).length;
  return (
    <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:border-yellow-500/20 transition-all">
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm uppercase">{ins.assignedToName}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {totalCount} items · {ts}
          {ins.status === 'submitted' && ` · ${checkedCount}/${totalCount} checked`}
        </p>
      </div>
      <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg ${statusColor(ins.status)}`}>
        {ins.status}
      </span>
      {onView && (
        <button onClick={onView}
          className="flex items-center gap-1.5 text-xs font-black uppercase px-3 py-2 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 transition-all">
          <Eye size={13} /> {actionLabel}
        </button>
      )}
    </div>
  );
};

export default AdminS2;
