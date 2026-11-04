import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, doc, updateDoc, deleteDoc, setDoc, onSnapshot,
  query, orderBy, serverTimestamp, getDocs, writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import {
  Users, GraduationCap, Plus, Trash2, X, Loader2,
  CheckCircle2, UploadCloud, RefreshCw, Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';

const INSTRUCTOR_TYPES = ["SAI", "AI"];

// Mirror of AdminRoster.jsx LEADERSHIP_SYNC_CONFIG — keep in sync.
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
};

const initialInstructorForm = { type: 'SAI', name: '' };

const AdminLeadership = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  const isAuthorized = (ROLE_HIERARCHY[role] || 0) >= STAFF_LEVEL;

  const [activeTab, setActiveTab]       = useState('leadership');
  const [leadership, setLeadership]     = useState([]);
  const [instructors, setInstructors]   = useState([]);
  const [dataLoading, setDataLoading]   = useState(true);
  const [syncing, setSyncing]           = useState(false);
  const [syncCount, setSyncCount]       = useState(null);

  // Portrait-upload modal
  const [portraitTarget, setPortraitTarget] = useState(null); // { id, name }
  const [uploadingPortrait, setUploadingPortrait] = useState(false);

  // Instructor modal
  const [showInstructorModal, setShowInstructorModal] = useState(false);
  const [editingInstructor, setEditingInstructor]     = useState(null);
  const [instructorForm, setInstructorForm]           = useState(initialInstructorForm);

  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!isAuthorized) return;
    const qLead = query(collection(db, 'leadership'), orderBy('role', 'asc'));
    const unsubLead = onSnapshot(qLead, snap => {
      setLeadership(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setDataLoading(false);
    }, () => setDataLoading(false));

    const unsubInst = onSnapshot(collection(db, 'instructors'), snap => {
      setInstructors(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubLead(); unsubInst(); };
  }, [isAuthorized]);

  const showStatus = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3500);
  };

  // ── Bulk sync from roster ──────────────────────────────────────────────────
  const syncFromRoster = async () => {
    setSyncing(true);
    setSyncCount(null);
    try {
      const [rosterSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, 'roster')),
        getDocs(collection(db, 'users')),
      ]);

      const usersById = {};
      usersSnap.docs.forEach(d => { usersById[d.id] = d.data(); });

      const batch = writeBatch(db);
      let count = 0;

      rosterSnap.docs.forEach(d => {
        const entry = d.data();
        const cfg   = LEADERSHIP_SYNC_CONFIG[entry.position];
        if (!cfg) return;

        const docId = cfg.companyLevel
          ? `${cfg.docIdPrefix}${(entry.company || '').toLowerCase().replace(/[^a-z0-9]/g, '_')}`
          : cfg.docId;

        const portrait = entry.linkedUid ? usersById[entry.linkedUid]?.portrait || '' : '';
        const syncData = {
          name:        entry.fullName || '',
          rank:        entry.rank || 'N/A',
          role:        cfg.role,
          company:     cfg.companyLevel ? `${entry.company} Company` : '',
          _rosterSync: true,
        };
        if (portrait) syncData.portrait = portrait;

        batch.set(doc(db, 'leadership', docId), syncData, { merge: true });
        count++;
      });

      await batch.commit();
      setSyncCount(count);
      showStatus(`Synced ${count} entr${count === 1 ? 'y' : 'ies'} from roster`);
      writeLog({
        type: 'leadership', action: 'sync',
        description: `Bulk-synced ${count} leadership entries from roster`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      console.error('Sync failed:', err);
      showStatus('Sync failed — try again');
    } finally {
      setSyncing(false);
    }
  };

  // ── Portrait upload for a specific leadership entry ────────────────────────
  const handlePortraitUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !portraitTarget) return;
    setUploadingPortrait(true);
    try {
      const data = await uploadToCloudinary(file, 'image');
      await updateDoc(doc(db, 'leadership', portraitTarget.id), { portrait: data.secure_url });
      showStatus('Portrait updated');
      writeLog({
        type: 'leadership', action: 'update',
        description: `Uploaded portrait for ${portraitTarget.name}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: portraitTarget.id, targetName: portraitTarget.name,
      });
    } catch (err) {
      showStatus(err.message || 'Portrait upload failed');
    } finally {
      setUploadingPortrait(false);
      setPortraitTarget(null);
    }
  };

  // ── Leadership entry delete ────────────────────────────────────────────────
  const handleDeleteLeader = async (item) => {
    const ok = await confirm(`Remove ${item.name || 'this entry'} from the leadership display? The roster entry is not affected.`, { title: 'Remove Display Entry', destructive: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'leadership', item.id));
      showStatus('Entry removed');
      writeLog({
        type: 'leadership', action: 'delete',
        description: `Removed leadership display entry: ${item.name || item.id}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: item.id, targetName: item.name,
      });
    } catch {
      showStatus('Error removing entry');
    }
  };

  // ── Instructor CRUD ────────────────────────────────────────────────────────
  const openAddInstructor    = () => { setEditingInstructor(null); setInstructorForm(initialInstructorForm); setShowInstructorModal(true); };
  const openEditInstructor   = (item) => { setEditingInstructor(item); setInstructorForm({ type: item.type || 'SAI', name: item.name || '' }); setShowInstructorModal(true); };

  const handleSaveInstructor = async (e) => {
    e.preventDefault();
    try {
      if (editingInstructor) {
        await updateDoc(doc(db, 'instructors', editingInstructor.id), instructorForm);
      } else {
        const ref = doc(db, 'instructors', instructorForm.type.toLowerCase());
        await setDoc(ref, instructorForm, { merge: true });
      }
      setShowInstructorModal(false);
      setEditingInstructor(null);
      setInstructorForm(initialInstructorForm);
      showStatus('Instructor saved');
      writeLog({
        type: 'leadership', action: editingInstructor ? 'update' : 'create',
        description: `${editingInstructor ? 'Updated' : 'Added'} instructor: ${instructorForm.name} (${instructorForm.type})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: instructorForm.name,
      });
    } catch {
      showStatus('Error saving instructor');
    }
  };

  const handleDeleteInstructor = async (id) => {
    const record = instructors.find(i => i.id === id);
    const ok = await confirm(`Remove ${record?.name || 'this instructor'}? This cannot be undone.`, { title: 'Remove Instructor', destructive: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'instructors', id));
      showStatus('Instructor removed');
      writeLog({
        type: 'leadership', action: 'delete',
        description: `Removed instructor: ${record?.name || id}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: record?.name,
      });
    } catch {
      showStatus('Error removing instructor');
    }
  };

  if (authLoading || (dataLoading && isAuthorized)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-yellow-600">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (authLoading) return null;
  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      <div className="max-w-6xl mx-auto">

        {!hideHeader && <AdminPageHeader icon={Users} title="Leadership" />}

        {/* Tabs */}
        <div className="flex bg-slate-200/50 dark:bg-white/5 p-1 rounded-2xl w-fit border border-slate-200 dark:border-white/5 mb-8">
          {[
            { id: 'leadership', label: 'Leadership Roster', icon: Users },
            { id: 'instructors', label: 'Instructors', icon: GraduationCap },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-yellow-500 text-slate-950 shadow-lg' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </div>

        {/* ── Leadership Roster tab ────────────────────────────────────────── */}
        {activeTab === 'leadership' && (
          <>
            {/* Info banner */}
            <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl px-5 py-4 mb-5">
              <Info size={15} className="text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-black text-yellow-700 dark:text-yellow-400 uppercase tracking-wide mb-0.5">Auto-managed from Roster</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Name, rank, and position on the public Leadership page are pulled automatically from the Roster whenever a cadet is saved.
                  Use <strong>Sync from Roster</strong> to populate all entries at once, or upload a portrait photo per-entry below.
                </p>
              </div>
            </div>

            {/* Sync button */}
            <div className="flex items-center gap-3 mb-5">
              <button
                onClick={syncFromRoster}
                disabled={syncing}
                className="flex items-center gap-2 px-5 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-colors shadow-md shadow-yellow-500/20"
              >
                {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {syncing ? 'Syncing…' : 'Sync from Roster'}
              </button>
              {syncCount !== null && (
                <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                  ✓ {syncCount} entries synced
                </span>
              )}
            </div>

            {/* Entry list */}
            <div className="grid gap-4">
              {leadership.map(item => (
                <div key={item.id} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-5 rounded-2xl flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {/* Portrait + upload overlay */}
                    <label className="relative w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200 dark:border-white/5 flex-shrink-0 cursor-pointer group"
                      title="Click to upload portrait">
                      {item.portrait
                        ? <img src={item.portrait} alt={item.name} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600"><Users size={18} /></div>
                      }
                      <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        {uploadingPortrait && portraitTarget?.id === item.id
                          ? <Loader2 size={14} className="animate-spin text-white" />
                          : <UploadCloud size={14} className="text-white" />
                        }
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => { setPortraitTarget({ id: item.id, name: item.name }); handlePortraitUpload(e); }}
                        disabled={uploadingPortrait}
                      />
                    </label>

                    <div>
                      <h3 className="font-black uppercase italic text-base leading-tight">{item.name || 'Unnamed'}</h3>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <span className="text-[9px] font-black text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded uppercase">{item.role}</span>
                        {item.rank && item.rank !== 'N/A' && (
                          <span className="text-[9px] font-black text-slate-500 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded uppercase">{item.rank}</span>
                        )}
                        {item.company && item.company !== 'None' && item.company !== '' && (
                          <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded uppercase">{item.company}</span>
                        )}
                        {item._rosterSync && (
                          <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded uppercase">Roster</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    title="Remove from leadership display"
                    onClick={() => handleDeleteLeader(item)}
                    className="p-2.5 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-red-500 hover:text-white transition-all text-slate-400"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}

              {leadership.length === 0 && !syncing && (
                <div className="text-center py-16 text-slate-400 dark:text-slate-600 text-xs font-bold uppercase tracking-widest">
                  No entries yet — click "Sync from Roster" to populate
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Instructors tab ──────────────────────────────────────────────── */}
        {activeTab === 'instructors' && (
          <>
            <div className="flex justify-end mb-4">
              <button onClick={openAddInstructor} className="bg-yellow-500 text-slate-950 px-6 py-3 rounded-2xl font-black uppercase text-xs flex items-center gap-2 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20 transition-all">
                <Plus size={18} /> New Instructor
              </button>
            </div>

            <div className="grid gap-4">
              {instructors.map(item => (
                <div key={item.id} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-6 rounded-2xl flex items-center justify-between gap-6 hover:shadow-md transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center border border-slate-200 dark:border-white/5 text-slate-400 dark:text-slate-500">
                      <GraduationCap size={20} />
                    </div>
                    <div>
                      <h3 className="font-black uppercase italic text-lg">{item.name || 'Unnamed'}</h3>
                      <span className="text-[9px] font-black text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded uppercase">{item.type}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button title="Edit instructor" onClick={() => openEditInstructor(item)} className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-yellow-500 hover:text-slate-950 transition-all text-slate-500">
                      <GraduationCap size={16} />
                    </button>
                    <button title="Delete instructor" onClick={() => handleDeleteInstructor(item.id)} className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-red-500 hover:text-white transition-all text-slate-500">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
              {instructors.length === 0 && (
                <div className="text-center py-16 text-slate-400 dark:text-slate-600 text-xs font-bold uppercase tracking-widest">No instructors yet</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Instructor modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showInstructorModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80" onClick={() => setShowInstructorModal(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-8 md:p-10 rounded-[3rem] max-w-md w-full shadow-2xl">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                  {editingInstructor ? 'Edit Instructor' : 'New Instructor'}
                </h2>
                <button title="Close" onClick={() => setShowInstructorModal(false)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white"><X /></button>
              </div>

              <form onSubmit={handleSaveInstructor} className="space-y-6">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Instructor Type</label>
                  <select className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none" value={instructorForm.type} onChange={e => setInstructorForm({ ...instructorForm, type: e.target.value })}>
                    {INSTRUCTOR_TYPES.map(t => <option key={t} value={t} className="bg-white dark:bg-slate-900">{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Rank and Last Name</label>
                  <input required placeholder="e.g. LTC Johnson" className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white" value={instructorForm.name} onChange={e => setInstructorForm({ ...instructorForm, name: e.target.value })} />
                </div>
                <button type="submit" className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-4 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20">
                  {editingInstructor ? 'Update Instructor' : 'Add Instructor'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Status toast ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {status && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="fixed bottom-8 right-8 bg-yellow-500 text-slate-950 px-8 py-4 rounded-2xl font-black uppercase text-xs flex items-center gap-3 shadow-2xl z-[200]">
            <CheckCircle2 size={18} /> {status}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminLeadership;
