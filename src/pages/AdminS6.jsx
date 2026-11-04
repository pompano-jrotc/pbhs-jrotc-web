// src/pages/AdminS6.jsx
//
// S6 Technology — Daily Cart Checklist Management
//
// S6 (s6_technology) view:
//   Tab: Carts   — manage cart list (add/edit/remove; serial codes optional)
//   Tab: Tasks   — manage default + custom tasks per cart
//   Tab: Today   — see today's checklist completion status per cart; send reminders
//   Tab: History — past submissions
//
// S6 Assistant (company_s6_assistant) view:
//   Today's checklists for each cart — auto-created on page load if not yet
//   generated for today. Each cart: task checklist + one photo → submit.
//
// S5 (s5_public_affairs) can access the Review / History tab to view submissions.
//
// Photo deletion: S6 photos are kept (low volume, not set to auto-delete).
// S6 is notified (via UI banner + manual email remind) when checklists are incomplete.

import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, where, serverTimestamp,
} from 'firebase/firestore';
import { getIdToken } from 'firebase/auth';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY, ROLE_LABELS } from '../constants';
import { uploadPhotoToStorage } from '../utils/storageUploadPhoto';
import {
  Laptop, Plus, Trash2, Edit3, X, Loader2, CheckCircle2,
  Camera, ClipboardList, Settings, Calendar, History,
  AlertTriangle, Bell, ImageIcon, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AdminPageHeader from '../components/AdminPageHeader';

// ── Constants ──────────────────────────────────────────────────────────────────

const S6_ROLE       = 's6_technology';
const S5_ROLE       = 's5_public_affairs';
const ASSISTANT_ROLE = 'company_s6_assistant';

const DEFAULT_CARTS = [
  { id: 'jrotc-cart',      name: 'JROTC Cart',      isDefault: true },
  { id: 'classroom-cart',  name: 'Classroom Cart',   isDefault: true },
];

const DEFAULT_TASKS = [
  { name: 'Laptops plugged in',                              isDefault: true },
  { name: 'Cart locked',                                     isDefault: true },
  { name: 'Cart powered on',                                 isDefault: true },
  { name: 'Drone cabinet — ensure locked and equipment safe',isDefault: true },
  { name: 'Robotics cabinet — ensure locked and equipment safe', isDefault: true },
];

const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

const ic = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const lc = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

const statusColor = (s) =>
  s === 'reviewed'  ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
  s === 'submitted' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
  'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400';

// ── Main component ─────────────────────────────────────────────────────────────

const AdminS6 = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const userLevel   = ROLE_HIERARCHY[role] || 0;
  const isS6        = role === S6_ROLE;
  const isS5        = role === S5_ROLE;
  const isAssistant = role === ASSISTANT_ROLE;
  const isStaff     = userLevel >= 70;
  const canManage   = isS6 || isStaff;
  const canReview   = isS5 || canManage;

  const [activeTab, setActiveTab] = useState(isAssistant && !canManage ? 'today-assistant' : 'carts');
  const [toast,     setToast]     = useState(null);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-yellow-500" size={40} /></div>;
  if (!canManage && !isAssistant && !canReview) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center p-8">
        <div>
          <Laptop className="mx-auto text-yellow-500 mb-4" size={40} />
          <p className="font-black uppercase text-sm text-slate-500">Access Restricted</p>
          <p className="text-xs text-slate-400 mt-2">This page is for S6 Technology and S6 Assistants.</p>
        </div>
      </div>
    );
  }

  const mgmtTabs = [
    { id: 'carts',   label: 'Carts',   icon: <Laptop size={14} />,       hidden: !canManage },
    { id: 'tasks',   label: 'Tasks',   icon: <ClipboardList size={14} />, hidden: !canManage },
    { id: 'today',   label: 'Today',   icon: <Calendar size={14} />,      hidden: !canManage },
    { id: 'history', label: 'History', icon: <History size={14} />,       hidden: !canReview },
  ].filter(t => !t.hidden);

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={Laptop} title="S6 Checklist" meta={`Technology · ${ROLE_LABELS[role] || role}`} />}

        {/* S6 Assistant: show today's checklist */}
        {isAssistant && !canManage && (
          <AssistantTodayView user={user} userData={userData} showToast={showToast} />
        )}

        {/* Management / Review tabs */}
        {(canManage || canReview) && (
          <>
            <div className="flex gap-2 mb-8 flex-wrap">
              {mgmtTabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                    activeTab === tab.id
                      ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                      : 'bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500/30'
                  }`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            {activeTab === 'carts'   && <CartsTab   user={user} userData={userData} showToast={showToast} />}
            {activeTab === 'tasks'   && <TasksTab   user={user} userData={userData} showToast={showToast} />}
            {activeTab === 'today'   && <TodayTab   user={user} userData={userData} showToast={showToast} />}
            {activeTab === 'history' && <HistoryTab user={user} userData={userData} showToast={showToast} canReview={canReview} />}
          </>
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

// ── CartsTab ──────────────────────────────────────────────────────────────────

const CartsTab = ({ user, showToast }) => {
  const [carts,      setCarts]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [form,       setForm]       = useState({ name: '', serialNumber: '' });
  const [saving,     setSaving]     = useState(false);
  const [deleteConf, setDeleteConf] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 's6Carts'), where('isActive', '==', true), orderBy('sortOrder', 'asc')),
      snap => { setCarts(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      async () => {
        // If collection is empty, seed default carts
        await seedDefaultCarts();
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  const seedDefaultCarts = async () => {
    const existing = await getDocs(collection(db, 's6Carts'));
    if (existing.empty) {
      for (let i = 0; i < DEFAULT_CARTS.length; i++) {
        await setDoc(doc(db, 's6Carts', DEFAULT_CARTS[i].id), {
          ...DEFAULT_CARTS[i], isActive: true, serialNumber: null, sortOrder: i,
          createdAt: serverTimestamp(),
        });
      }
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), serialNumber: form.serialNumber.trim() || null, updatedAt: serverTimestamp() };
      if (editing) {
        await updateDoc(doc(db, 's6Carts', editing.id), payload);
        showToast('Cart updated');
      } else {
        await addDoc(collection(db, 's6Carts'), { ...payload, isDefault: false, isActive: true, sortOrder: carts.length, createdAt: serverTimestamp() });
        showToast('Cart added');
      }
      setShowForm(false); setEditing(null); setForm({ name: '', serialNumber: '' });
      writeLog({
        type: 's6', action: editing ? 'update' : 'create',
        description: `${editing ? 'Updated' : 'Added'} S6 cart: "${form.name}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: form.name,
      });
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteConf) return;
    try {
      await updateDoc(doc(db, 's6Carts', deleteConf.id), { isActive: false });
      setDeleteConf(null); showToast('Cart removed');
      writeLog({
        type: 's6', action: 'delete',
        description: `Removed S6 cart: "${deleteConf.name}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConf.id, targetName: deleteConf.name,
      });
    } catch { showToast('Failed'); }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{carts.length} carts</p>
        <button onClick={() => { setForm({ name: '', serialNumber: '' }); setEditing(null); setShowForm(true); }}
          className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-yellow-500/20">
          <Plus size={14} /> Add Cart
        </button>
      </div>

      {loading ? <div className="h-12 bg-slate-100 dark:bg-slate-900/60 rounded-xl animate-pulse" /> :
        carts.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
            <Laptop className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
            <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No carts configured yet</p>
            <p className="text-slate-400 text-xs mt-2">Add your first cart above to get started.</p>
          </div>
        ) :
        carts.map(cart => (
          <div key={cart.id} className="flex items-center justify-between bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl p-4 shadow-sm">
            <div>
              <p className="font-black text-sm flex items-center gap-2">
                <Laptop size={14} className="text-yellow-500" /> {cart.name}
                {cart.isDefault && <span className="text-[9px] font-black uppercase bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded-md text-slate-500">Default</span>}
              </p>
              {cart.serialNumber ? (
                <p className="text-[10px] text-slate-400 font-mono mt-0.5">S/N: {cart.serialNumber}</p>
              ) : (
                <p className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5">No serial number on file</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setForm({ name: cart.name, serialNumber: cart.serialNumber || '' }); setEditing(cart); setShowForm(true); }}
                className="p-2 rounded-lg text-slate-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all"><Edit3 size={14} /></button>
              {!cart.isDefault && (
                <button onClick={() => setDeleteConf(cart)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"><Trash2 size={14} /></button>
              )}
            </div>
          </div>
        ))
      }

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-md shadow-2xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <h2 className="font-black uppercase text-sm tracking-widest">{editing ? 'Edit Cart' : 'Add Cart'}</h2>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={18} /></button>
              </div>
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div>
                  <label className={lc}>Cart Name *</label>
                  <input required type="text" placeholder="e.g. JROTC Cart" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={ic} />
                </div>
                <div>
                  <label className={lc}>Serial Number (optional — add later)</label>
                  <input type="text" placeholder="e.g. SN-12345678" value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} className={ic} />
                </div>
                <button type="submit" disabled={saving}
                  className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2">
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={14} /> {editing ? 'Save' : 'Add Cart'}</>}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Trash2 className="mx-auto text-red-500 mb-4" size={32} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Remove Cart?</h3>
              <p className="text-sm text-slate-500 mb-6">Remove <strong>{deleteConf.name}</strong>?</p>
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

// ── TasksTab ──────────────────────────────────────────────────────────────────

const TasksTab = ({ user, showToast }) => {
  const [carts,   setCarts]   = useState([]);
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form,    setForm]    = useState({ name: '', cartId: '' });
  const [saving,  setSaving]  = useState(false);
  const [deleteConf, setDeleteConf] = useState(null);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 's6Carts'), where('isActive', '==', true), orderBy('sortOrder', 'asc')),
      snap => setCarts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(query(collection(db, 's6Tasks'), where('isActive', '==', true), orderBy('cartId', 'asc'), orderBy('sortOrder', 'asc')),
      snap => { setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false));
    return () => { u1(); u2(); };
  }, []);

  // Seed default tasks when carts load for first time
  useEffect(() => {
    if (carts.length === 0) return;
    getDocs(query(collection(db, 's6Tasks'), where('isDefault', '==', true))).then(snap => {
      if (snap.empty) {
        carts.forEach(async (cart, ci) => {
          for (let i = 0; i < DEFAULT_TASKS.length; i++) {
            await addDoc(collection(db, 's6Tasks'), {
              cartId: cart.id, cartName: cart.name,
              name: DEFAULT_TASKS[i].name, isDefault: true, isActive: true,
              sortOrder: i, createdAt: serverTimestamp(),
            });
          }
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carts.length]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.cartId) return;
    setSaving(true);
    const cart = carts.find(c => c.id === form.cartId);
    try {
      await addDoc(collection(db, 's6Tasks'), {
        cartId: form.cartId, cartName: cart?.name || '',
        name: form.name.trim(), isDefault: false, isActive: true,
        sortOrder: tasks.filter(t => t.cartId === form.cartId).length,
        createdAt: serverTimestamp(), createdByUid: user.uid,
      });
      showToast('Task added');
      setShowForm(false); setForm({ name: '', cartId: '' });
      writeLog({
        type: 's6', action: 'create',
        description: `Added S6 task: "${form.name}" for cart "${cart?.name}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: form.name,
      });
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteConf) return;
    try {
      await updateDoc(doc(db, 's6Tasks', deleteConf.id), { isActive: false });
      setDeleteConf(null); showToast('Task removed');
      writeLog({
        type: 's6', action: 'delete',
        description: `Removed S6 task: "${deleteConf.name}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConf.id, targetName: deleteConf.name,
      });
    } catch { showToast('Failed'); }
  };

  const grouped = useMemo(() => {
    const g = {};
    tasks.forEach(t => {
      if (!g[t.cartId]) g[t.cartId] = { cartName: t.cartName, tasks: [] };
      g[t.cartId].tasks.push(t);
    });
    return g;
  }, [tasks]);

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{tasks.length} permanent tasks</p>
        <button onClick={() => { setForm({ name: '', cartId: carts[0]?.id || '' }); setShowForm(true); }}
          className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-yellow-500/20">
          <Plus size={14} /> Add Task
        </button>
      </div>

      {loading ? (
        [1,2,3].map(n => <div key={n} className="h-12 bg-slate-100 dark:bg-slate-900/60 rounded-xl animate-pulse" />)
      ) : tasks.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <ClipboardList className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No tasks configured yet</p>
          <p className="text-slate-400 text-xs mt-2">Add tasks for each cart using the button above.</p>
        </div>
      ) : Object.entries(grouped).map(([cartId, { cartName, tasks: cartTasks }]) => (
        <div key={cartId}>
          <p className="text-[10px] font-black uppercase text-yellow-500 tracking-widest mb-2">{cartName}</p>
          <div className="space-y-2">
            {cartTasks.map(task => (
              <div key={task.id} className="flex items-center justify-between bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl p-3.5 shadow-sm">
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                  <span className="text-sm font-bold">{task.name}</span>
                  {task.isDefault && <span className="text-[9px] font-black uppercase bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded text-slate-500">Default</span>}
                </div>
                {!task.isDefault && (
                  <button onClick={() => setDeleteConf(task)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"><Trash2 size={13} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setShowForm(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-md shadow-2xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <h2 className="font-black uppercase text-sm tracking-widest">Add Custom Task</h2>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={18} /></button>
              </div>
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div>
                  <label className={lc}>Cart *</label>
                  <select required value={form.cartId} onChange={e => setForm(f => ({ ...f, cartId: e.target.value }))} className={ic}>
                    <option value="">— Select Cart —</option>
                    {carts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lc}>Task Description *</label>
                  <input required type="text" placeholder="e.g. Check iPad charging cables" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={ic} />
                </div>
                <button type="submit" disabled={saving}
                  className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2">
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Adding…</> : <><Plus size={14} /> Add Task</>}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConf && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 max-w-sm w-full text-center">
              <Trash2 className="mx-auto text-red-500 mb-4" size={28} />
              <h3 className="font-black uppercase text-sm tracking-widest mb-2">Remove Task?</h3>
              <p className="text-sm text-slate-500 mb-6">"{deleteConf.name}"</p>
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

// ── TodayTab (S6 management view) ─────────────────────────────────────────────

const TodayTab = ({ user, userData, showToast }) => {
  const [carts,        setCarts]        = useState([]);
  const [checklists,   setChecklists]   = useState([]);
  const [assistants,   setAssistants]   = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [reminding,    setReminding]    = useState(null);
  const today = todayStr();

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 's6Carts'), where('isActive', '==', true), orderBy('sortOrder', 'asc')),
      snap => { setCarts(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); });
    const u2 = onSnapshot(query(collection(db, 's6Checklists'), where('date', '==', today)),
      snap => setChecklists(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u3 = onSnapshot(query(collection(db, 'users'), where('role', '==', 'company_s6_assistant'), where('approved', '==', true)),
      snap => setAssistants(snap.docs.map(d => ({ uid: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); };
  }, [today]);

  const handleRemind = async (cart) => {
    const checklist = checklists.find(c => c.cartId === cart.id);
    if (!checklist?.completedByEmail && assistants.length === 0) { showToast('No S6 assistants found.'); return; }
    setReminding(cart.id);
    try {
      const idToken = await getIdToken(auth.currentUser);
      // Send reminder to each S6 assistant
      const targets = checklist?.completedByEmail
        ? [{ email: checklist.completedByEmail, name: checklist.completedByName }]
        : assistants;
      await Promise.all(targets.map(a => fetch('/api/notify-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 's6-reminder', idToken,
          assistantEmail: a.email, assistantName: a.fullName || a.name || '',
          cartName: cart.name,
        }),
      })));
      showToast('Reminder sent');
    } catch { showToast('Reminder failed'); }
    finally { setReminding(null); }
  };

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">
        Today — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      {loading ? (
        [1,2].map(n => <div key={n} className="h-24 bg-slate-100 dark:bg-slate-900/60 rounded-2xl animate-pulse" />)
      ) : carts.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <Calendar className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No carts set up yet</p>
          <p className="text-slate-400 text-xs mt-2">Configure carts in the Carts tab first.</p>
        </div>
      ) : carts.map(cart => {
        const cl = checklists.find(c => c.cartId === cart.id);
        const isSubmitted = cl?.status === 'submitted' || cl?.status === 'reviewed';
        const isPending   = !cl || cl.status === 'pending';
        return (
          <div key={cart.id} className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <Laptop size={18} className="text-yellow-500" />
                <div>
                  <p className="font-black text-sm">{cart.name}</p>
                  {cl?.completedByName && <p className="text-[10px] text-slate-400">by {cl.completedByName}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isPending && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                    <AlertTriangle size={12} className="text-red-500" />
                    <span className="text-[10px] font-black uppercase text-red-500">Not submitted</span>
                  </div>
                )}
                {isSubmitted && (
                  <span className="text-[10px] font-black uppercase px-2.5 py-1 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
                    ✓ {cl.status}
                  </span>
                )}
                {isPending && (
                  <button
                    onClick={() => handleRemind(cart)}
                    disabled={reminding === cart.id}
                    className="flex items-center gap-1.5 text-xs font-black uppercase px-3 py-2 rounded-xl border border-yellow-500/30 text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 transition-all disabled:opacity-50">
                    {reminding === cart.id ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                    Remind
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── HistoryTab ────────────────────────────────────────────────────────────────

const HistoryTab = ({ user, userData, showToast, canReview }) => {
  const [checklists, setChecklists] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [viewing,    setViewing]    = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 's6Checklists'), orderBy('date', 'desc'), orderBy('cartName', 'asc')),
      snap => { setChecklists(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const handleReview = async (id) => {
    try {
      await updateDoc(doc(db, 's6Checklists', id), {
        status: 'reviewed', reviewedAt: serverTimestamp(), reviewedByName: userData?.fullName || '',
      });
      setViewing(null); showToast('Marked as reviewed');
    } catch { showToast('Failed'); }
  };

  // Group by date
  const grouped = useMemo(() => {
    const g = {};
    checklists.forEach(cl => {
      if (!g[cl.date]) g[cl.date] = [];
      g[cl.date].push(cl);
    });
    return g;
  }, [checklists]);

  return (
    <div className="space-y-6">
      {loading ? (
        [1,2,3].map(n => <div key={n} className="h-14 bg-slate-100 dark:bg-slate-900/60 rounded-2xl animate-pulse" />)
      ) : checklists.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <History className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No submissions yet</p>
        </div>
      ) : (
        Object.entries(grouped).map(([date, cls]) => (
          <div key={date}>
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">
              {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
            <div className="space-y-2">
              {cls.map(cl => (
                <div key={cl.id} className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl p-4 flex items-center gap-4 shadow-sm">
                  <Laptop size={16} className="text-yellow-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-sm">{cl.cartName}</p>
                    <p className="text-[10px] text-slate-400">{cl.completedByName || 'Unknown'}</p>
                  </div>
                  <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg ${statusColor(cl.status)}`}>{cl.status}</span>
                  <button onClick={() => setViewing(cl)}
                    className="text-xs font-black uppercase px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/10 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 hover:text-yellow-600 transition-all">View</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Detail modal */}
      <AnimatePresence>
        {viewing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setViewing(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <div>
                  <h2 className="font-black uppercase text-sm tracking-widest">{viewing.cartName}</h2>
                  <p className="text-[10px] text-slate-400 mt-0.5">{viewing.date} · {viewing.completedByName}</p>
                </div>
                <button onClick={() => setViewing(null)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                {viewing.photoUrl ? (
                  <img src={viewing.photoUrl} alt="Checklist" className="w-full rounded-xl object-cover max-h-64" />
                ) : (
                  <div className="flex items-center gap-2 text-slate-400 text-xs font-bold"><ImageIcon size={14} /> No photo</div>
                )}
                <div className="space-y-2">
                  {(viewing.items || []).map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20">
                      <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${item.checked ? 'bg-green-500' : 'bg-slate-200 dark:bg-white/10'}`}>
                        {item.checked && <CheckCircle2 size={11} className="text-white" />}
                      </div>
                      <p className="text-sm font-bold">{item.taskName}</p>
                    </div>
                  ))}
                </div>
                {canReview && viewing.status === 'submitted' && (
                  <button onClick={() => handleReview(viewing.id)}
                    className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2">
                    <CheckCircle2 size={14} /> Mark Reviewed
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ── AssistantTodayView ────────────────────────────────────────────────────────

const AssistantTodayView = ({ user, userData, showToast }) => {
  const [carts,       setCarts]       = useState([]);
  const [tasks,       setTasks]       = useState([]);
  const [checklists,  setChecklists]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [submitForm,  setSubmitForm]  = useState(null);
  const today = todayStr();

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 's6Carts'), where('isActive', '==', true), orderBy('sortOrder', 'asc')),
      snap => setCarts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(query(collection(db, 's6Tasks'), where('isActive', '==', true), orderBy('sortOrder', 'asc')),
      snap => { setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); });
    const u3 = onSnapshot(query(collection(db, 's6Checklists'), where('date', '==', today)),
      snap => setChecklists(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); };
  }, [today]);

  // Auto-create today's checklist docs for each cart if they don't exist
  useEffect(() => {
    if (carts.length === 0 || tasks.length === 0) return;
    carts.forEach(async (cart) => {
      const existing = checklists.find(c => c.cartId === cart.id && c.date === today);
      if (!existing) {
        const cartTasks = tasks.filter(t => t.cartId === cart.id);
        if (cartTasks.length === 0) return;
        const docId = `${today}_${cart.id}`;
        const snap = await getDoc(doc(db, 's6Checklists', docId));
        if (!snap.exists()) {
          await setDoc(doc(db, 's6Checklists', docId), {
            date: today, cartId: cart.id, cartName: cart.name,
            status: 'pending', completedByUid: null, completedByName: null,
            submittedAt: null, photoUrl: null, photoStoragePath: null,
            items: cartTasks.map(t => ({ taskId: t.id, taskName: t.name, checked: false })),
            createdAt: serverTimestamp(),
          });
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carts.length, tasks.length, today]);

  const openSubmit = (cart) => {
    const cl      = checklists.find(c => c.cartId === cart.id);
    const cartTasks = tasks.filter(t => t.cartId === cart.id);
    setSubmitForm({
      cart, checklist: cl,
      items: cl?.items || cartTasks.map(t => ({ taskId: t.id, taskName: t.name, checked: false })),
      photo: null, uploading: false, progress: 0,
    });
  };

  const handleSubmit = async () => {
    if (!submitForm.photo) { showToast('Please attach a photo.'); return; }
    setSubmitForm(f => ({ ...f, uploading: true }));
    try {
      const { url, storagePath } = await uploadPhotoToStorage(
        submitForm.photo, 's6-checklists',
        pct => setSubmitForm(f => ({ ...f, progress: pct })),
      );
      const docId = `${today}_${submitForm.cart.id}`;
      await setDoc(doc(db, 's6Checklists', docId), {
        date: today, cartId: submitForm.cart.id, cartName: submitForm.cart.name,
        status: 'submitted',
        completedByUid: user.uid, completedByName: userData?.fullName || '',
        completedByEmail: user.email || '',
        submittedAt: serverTimestamp(),
        photoUrl: url, photoStoragePath: storagePath,
        items: submitForm.items,
      }, { merge: true });
      setSubmitForm(null); showToast('Checklist submitted!');
    } catch (err) { console.error(err); showToast('Submit failed — try again'); }
    finally { setSubmitForm(f => f ? { ...f, uploading: false } : null); }
  };

  const toggleItem = (idx) => setSubmitForm(f => {
    const items = [...f.items];
    items[idx] = { ...items[idx], checked: !items[idx].checked };
    return { ...f, items };
  });

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">
        Today — {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
      {loading ? (
        [1,2].map(n => <div key={n} className="h-24 bg-slate-100 dark:bg-slate-900/60 rounded-2xl animate-pulse" />)
      ) : carts.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <Laptop className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No tasks set up yet</p>
          <p className="text-slate-400 text-xs mt-2 max-w-xs mx-auto">
            Once your S6 officer configures carts and tasks, they will appear here.
          </p>
        </div>
      ) : carts.map(cart => {
        const cl           = checklists.find(c => c.cartId === cart.id);
        const isSubmitted  = cl?.status === 'submitted' || cl?.status === 'reviewed';
        return (
          <div key={cart.id} className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <div className="flex items-center gap-3">
                <Laptop size={18} className="text-yellow-500" />
                <p className="font-black text-sm">{cart.name}</p>
              </div>
              <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg ${isSubmitted ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'}`}>
                {isSubmitted ? '✓ Submitted' : 'Pending'}
              </span>
            </div>

            {isSubmitted ? (
              <div className="space-y-1.5">
                {(cl.items || []).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2.5 text-xs">
                    <div className={`w-4 h-4 rounded shrink-0 flex items-center justify-center ${item.checked ? 'bg-green-500' : 'bg-slate-200 dark:bg-white/10'}`}>
                      {item.checked && <CheckCircle2 size={10} className="text-white" />}
                    </div>
                    <span className={`font-bold ${item.checked ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 line-through'}`}>{item.taskName}</span>
                  </div>
                ))}
                {cl.photoUrl && <img src={cl.photoUrl} alt="Proof" className="mt-3 w-full max-h-40 object-cover rounded-xl" />}
              </div>
            ) : (
              <button onClick={() => openSubmit(cart)}
                className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2">
                <ClipboardList size={14} /> Complete Checklist
              </button>
            )}
          </div>
        );
      })}

      {/* Submit modal */}
      <AnimatePresence>
        {submitForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={e => e.target === e.currentTarget && setSubmitForm(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="p-6 border-b border-blue-100 dark:border-white/5 flex items-center justify-between">
                <h2 className="font-black uppercase text-sm tracking-widest">{submitForm.cart.name} — End of Class</h2>
                <button onClick={() => setSubmitForm(null)} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-5">
                {/* Checklist */}
                <div>
                  <p className={lc}>Checklist ({submitForm.items.filter(i => i.checked).length}/{submitForm.items.length})</p>
                  <div className="space-y-2 mt-2">
                    {submitForm.items.map((item, idx) => (
                      <label key={idx} onClick={() => toggleItem(idx)}
                        className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20 cursor-pointer hover:border-yellow-500/30 transition-all">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${item.checked ? 'bg-green-500 border-green-500' : 'border-slate-300 dark:border-white/20'}`}>
                          {item.checked && <CheckCircle2 size={12} className="text-white" />}
                        </div>
                        <span className="text-sm font-bold">{item.taskName}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Photo */}
                <div>
                  <label className={lc}>Photo Proof *</label>
                  <label className="flex flex-col items-center gap-2 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-6 cursor-pointer hover:border-yellow-500/50 transition-all">
                    <Camera size={24} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-500">
                      {submitForm.photo ? submitForm.photo.name : 'Tap to take or attach photo'}
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
                    : <><CheckCircle2 size={14} /> Submit Checklist</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminS6;
