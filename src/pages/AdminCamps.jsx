import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import {
  Tent, Plus, Edit3, Trash2, X, Loader2, CheckCircle2, Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import DatePicker from '../components/DatePicker';

const initialCampForm = { name: '', date: '', location: '', notes: '', attendeeCount: '', attendeeNotes: '' };

const inputClass = "w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white";
const labelClass = "text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1";

const AdminCamps = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const isAuthorized = (ROLE_HIERARCHY[role] || 0) >= STAFF_LEVEL;

  const [camps, setCamps] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingCamp, setEditingCamp] = useState(null);
  const [campForm, setCampForm] = useState(initialCampForm);
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, name: '' });
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!isAuthorized) return;
    const unsubCamps = onSnapshot(query(collection(db, "camps"), orderBy("date", "desc")), (snap) => {
      setCamps(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setDataLoading(false);
    }, () => setDataLoading(false));

    return () => unsubCamps();
  }, [isAuthorized]);

  const showStatus = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  };

  const openAdd = () => { setEditingCamp(null); setCampForm(initialCampForm); setShowModal(true); };
  const openEdit = (camp) => { setEditingCamp(camp); setCampForm({ ...initialCampForm, ...camp }); setShowModal(true); };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...campForm,
        attendeeCount: parseInt(campForm.attendeeCount, 10) || 0,
      };
      if (editingCamp) {
        await updateDoc(doc(db, "camps", editingCamp.id), { ...payload, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "camps"), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: user.uid });
      }
      setShowModal(false);
      setEditingCamp(null);
      setCampForm(initialCampForm);
      showStatus("Camp Saved");
      writeLog({
        type: 'camp', action: editingCamp ? 'update' : 'create',
        description: `${editingCamp ? 'Updated' : 'Created'} camp: ${campForm.name}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: editingCamp?.id || '', targetName: campForm.name,
      });
    } catch (err) {
      console.error("Camp save failed:", err);
      showStatus("Save Failed");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDoc(doc(db, "camps", deleteConfirm.id));
      setDeleteConfirm({ open: false, id: null, name: '' });
      showStatus("Camp Removed");
      writeLog({
        type: 'camp', action: 'delete',
        description: `Deleted camp: ${deleteConfirm.name}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConfirm.id, targetName: deleteConfirm.name,
      });
    } catch {
      showStatus("Delete Failed");
    }
  };

  if (authLoading || (dataLoading && isAuthorized)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-yellow-600">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      <div className="max-w-4xl mx-auto">

        {!hideHeader && <AdminPageHeader icon={Tent} title="Camp Attendance" />}

        <div className="flex justify-end mb-6">
          <button onClick={openAdd} className="bg-yellow-500 text-slate-950 px-6 py-3 rounded-2xl font-black uppercase text-xs flex items-center gap-2 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20 transition-all">
            <Plus size={18} /> Log Camp
          </button>
        </div>

        <div className="grid gap-4">
          {camps.map(camp => (
            <div key={camp.id} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-6 rounded-[2rem] flex flex-wrap items-center justify-between gap-6 hover:shadow-md transition-all">
              <div>
                <h3 className="font-black uppercase italic text-lg">{camp.name || "Unnamed Camp"}</h3>
                <div className="flex flex-wrap gap-2 mt-1">
                  {camp.date && <span className="text-[9px] font-black text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded uppercase">{camp.date}</span>}
                  {camp.location && <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded uppercase">{camp.location}</span>}
                  <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded uppercase flex items-center gap-1">
                    <Users size={10} /> {camp.attendeeCount ?? camp.attendees?.length ?? 0} Attendees
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button title="Edit camp" onClick={() => openEdit(camp)} className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-yellow-500 hover:text-slate-950 transition-all text-slate-500">
                  <Edit3 size={18} />
                </button>
                <button title="Delete camp" onClick={() => setDeleteConfirm({ open: true, id: camp.id, name: camp.name })} className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-red-500 hover:text-white transition-all text-slate-500">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
          {camps.length === 0 && (
            <div className="text-center py-16 text-slate-400 dark:text-slate-600 text-xs font-bold uppercase tracking-widest">No camps logged yet</div>
          )}
        </div>
      </div>

      {/* CAMP MODAL */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80" onClick={() => setShowModal(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-8 md:p-10 rounded-[3rem] max-w-2xl w-full shadow-2xl overflow-y-auto max-h-[90vh]">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                  {editingCamp ? 'Edit Camp' : 'Log New Camp'}
                </h2>
                <button title="Close" onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white"><X /></button>
              </div>

              <form onSubmit={handleSave} className="space-y-5">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Camp Name</label>
                    <input required className={inputClass} placeholder="e.g. JCLC Summer 2026" value={campForm.name} onChange={e => setCampForm({ ...campForm, name: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Date</label>
                    <DatePicker value={campForm.date} onChange={v => setCampForm({ ...campForm, date: v })} placeholder="Pick a date" />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Location</label>
                  <input className={inputClass} value={campForm.location} onChange={e => setCampForm({ ...campForm, location: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Notes</label>
                  <textarea className={`${inputClass} h-20 resize-none`} value={campForm.notes} onChange={e => setCampForm({ ...campForm, notes: e.target.value })} />
                </div>

                <div>
                  <label className={labelClass}>
                    Attendance Count <span className="text-yellow-500">*</span>
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    className={inputClass}
                    placeholder="e.g. 24"
                    value={campForm.attendeeCount}
                    onChange={e => setCampForm({ ...campForm, attendeeCount: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    Attendee Names / Ranks <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <textarea
                    className={`${inputClass} h-24 resize-none`}
                    placeholder={"e.g.\nC/CPT DE ALMEIDA\nC/1LT SMITH\nC/SSG JONES"}
                    value={campForm.attendeeNotes}
                    onChange={e => setCampForm({ ...campForm, attendeeNotes: e.target.value })}
                  />
                  <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1 ml-1">One cadet per line. Free text — no required format.</p>
                </div>

                <button type="submit" className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all mt-4 text-sm shadow-lg shadow-yellow-500/20">
                  {editingCamp ? 'Update Camp' : 'Save Camp'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE CONFIRM */}
      {deleteConfirm.open && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/90">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-10 rounded-[2.5rem] max-w-sm w-full text-center shadow-2xl">
            <Trash2 size={40} className="text-red-500 mx-auto mb-6" />
            <h3 className="text-xl font-black uppercase italic mb-3 text-slate-900 dark:text-white">Delete Camp Record?</h3>
            <p className="text-slate-500 text-xs mb-8 leading-relaxed">Permanently remove <span className="text-red-600 font-bold">{deleteConfirm.name}</span> and its attendance record.</p>
            <div className="flex flex-col gap-3">
              <button onClick={handleDelete} className="w-full bg-red-600 py-4 rounded-xl font-black text-white uppercase text-[10px] tracking-widest hover:bg-red-500 transition-all">Confirm Delete</button>
              <button onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })} className="w-full py-4 rounded-xl font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all uppercase text-[10px] tracking-widest bg-slate-100 dark:bg-white/5">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* STATUS TOAST */}
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

export default AdminCamps;
