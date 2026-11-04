import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import {
  Newspaper, Plus, Trash2, Edit3, X,
  Loader2, CheckCircle2, UploadCloud, Save, Eye, EyeOff,
} from 'lucide-react';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadPdfToStorage } from '../utils/storageUpload';
import DatePicker from '../components/DatePicker';

const EMPTY_FORM = {
  title: '', issue: '', date: '', summary: '', body: '',
  fileUrl: '', fileName: '', status: 'published',
};

const inputClass  = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const labelClass  = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

const formatDate = (val) => {
  if (!val) return '';
  if (val?.toDate) return val.toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const d = new Date(val);
  return !isNaN(d) ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : val;
};

const AdminNewsletters = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  // Wait until auth+Firestore loading is done before evaluating authorization.
  // role is null until the Firestore snapshot resolves; evaluating early would
  // cause isAuthorized = false and fire the redirect on every initial render.
  const isAuthorized = !authLoading && (ROLE_HIERARCHY[role] || 0) >= STAFF_LEVEL;

  const [newsletters, setNewsletters] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [editingId, setEditingId]     = useState(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [uploading, setUploading]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [status, setStatus]           = useState(null); // 'success' | 'error'

  useEffect(() => {
    if (!isAuthorized) return;
    const q = query(collection(db, 'newsletters'), orderBy('publishedAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setNewsletters(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setDataLoading(false);
    }, () => setDataLoading(false));
    return () => unsub();
  }, [isAuthorized]);

  const openCreate = () => { setForm(EMPTY_FORM); setEditingId(null); setShowModal(true); };
  const openEdit   = (item) => {
    setForm({
      title:    item.title    || '',
      issue:    item.issue    || '',
      date:     item.date     || '',
      summary:  item.summary  || '',
      body:     item.body     || '',
      fileUrl:  item.fileUrl  || '',
      fileName: item.fileName || '',
      status:   item.status   || 'published',
    });
    setEditingId(item.id);
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditingId(null); setForm(EMPTY_FORM); };

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadPdfToStorage(file, 'newsletters');
      setForm(f => ({ ...f, fileUrl: data.url, fileName: data.fileName }));
    } catch (err) {
      console.error('PDF upload failed:', err);
      setStatus('error');
      setTimeout(() => setStatus(null), 4000);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        publishedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, 'newsletters', editingId), payload);
      } else {
        payload.createdAt = serverTimestamp();
        await addDoc(collection(db, 'newsletters'), payload);
      }
      setStatus('success');
      setTimeout(() => setStatus(null), 3000);
      closeModal();
      writeLog({
        type: 'newsletter', action: editingId ? 'update' : 'create',
        description: `${editingId ? 'Updated' : 'Published'} newsletter: "${form.title || form.issue}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: editingId || '', targetName: form.title,
      });
    } catch (err) {
      console.error('Save failed:', err);
      setStatus('error');
      setTimeout(() => setStatus(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const item = newsletters.find(n => n.id === id);
    try {
      await deleteDoc(doc(db, 'newsletters', id));
      setDeleteConfirm(null);
      setStatus('success');
      setTimeout(() => setStatus(null), 3000);
      writeLog({
        type: 'newsletter', action: 'delete',
        description: `Deleted newsletter: "${item?.title || id}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: item?.title,
      });
    } catch {
      setStatus('error');
      setTimeout(() => setStatus(null), 3000);
    }
  };

  if (authLoading || (dataLoading && newsletters.length === 0 && isAuthorized)) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-yellow-500 mb-4" size={40} />
        <p className="font-black uppercase tracking-widest text-[10px] text-slate-500">Loading...</p>
      </div>
    );
  }

  if (!isAuthorized && !authLoading) return <Navigate to="/admin/dashboard" replace />;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      <div className="max-w-5xl mx-auto">

        {!hideHeader && <AdminPageHeader icon={Newspaper} title="Newsletters" />}

        <div className="flex justify-end mb-6">
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-yellow-500 text-slate-950 font-black uppercase text-[10px] tracking-widest px-5 py-3 rounded-xl hover:bg-yellow-400 transition-all shadow-lg shadow-yellow-500/20"
          >
            <Plus size={14} /> New Issue
          </button>
        </div>

        {/* Status toast */}
        <AnimatePresence>
          {status && (
            <motion.div
              initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={`mb-6 flex items-center gap-3 p-4 rounded-2xl text-sm font-bold ${status === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-500'}`}
            >
              <CheckCircle2 size={16} />
              {status === 'success' ? 'Saved successfully.' : 'Something went wrong — try again.'}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!dataLoading && newsletters.length === 0 && (
          <div className="text-center py-20">
            <Newspaper className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={48} />
            <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm mb-6">No newsletters yet</p>
            <button onClick={openCreate} className="bg-yellow-500 text-slate-950 font-black uppercase text-[10px] tracking-widest px-6 py-3 rounded-xl hover:bg-yellow-400 transition-all">
              <Plus size={14} className="inline mr-2" /> Create First Issue
            </button>
          </div>
        )}

        {/* Newsletter list */}
        <div className="space-y-4">
          {newsletters.map(item => (
            <div
              key={item.id}
              className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-white/5 rounded-2xl p-6 flex items-start justify-between gap-4 group hover:border-yellow-500/40 transition-all"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {item.issue && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                      {item.issue}
                    </span>
                  )}
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${item.status === 'published' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-slate-200 dark:bg-white/5 text-slate-400'}`}>
                    {item.status === 'published' ? <><Eye size={9} className="inline mr-1" />Published</> : <><EyeOff size={9} className="inline mr-1" />Draft</>}
                  </span>
                </div>
                <h3 className="font-black uppercase italic tracking-tighter text-lg text-slate-900 dark:text-white leading-tight truncate">{item.title}</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-0.5">{formatDate(item.date)}</p>
                {item.summary && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{item.summary}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => openEdit(item)}
                  className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-yellow-500/10 hover:text-yellow-500 text-slate-400 transition-all flex items-center justify-center"
                  title="Edit"
                >
                  <Edit3 size={15} />
                </button>
                <button
                  onClick={() => setDeleteConfirm(item)}
                  className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-red-500/10 hover:text-red-500 text-slate-400 transition-all flex items-center justify-center"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>


      {/* ── Create / Edit Modal ── */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2rem] w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-lg font-black uppercase italic tracking-tighter">
                    {editingId ? 'Edit Issue' : 'New Issue'}
                  </h2>
                  <button onClick={closeModal} aria-label="Close" className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 flex items-center justify-center text-slate-500 transition-all">
                    <X size={16} />
                  </button>
                </div>

                <form onSubmit={handleSave} className="space-y-5">
                  <div>
                    <label className={labelClass}>Title *</label>
                    <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inputClass} placeholder="Fall 2025 Battalion Newsletter" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Issue Label</label>
                      <input value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} className={inputClass} placeholder="Vol. 1 Issue 1" />
                    </div>
                    <div>
                      <label className={labelClass}>Date</label>
                      <DatePicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Summary</label>
                    <textarea
                      value={form.summary}
                      onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
                      rows={2}
                      placeholder="One-sentence preview shown on the newsletter card..."
                      className={`${inputClass} resize-none`}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Content Body (optional — shown inline when expanded)</label>
                    <textarea
                      value={form.body}
                      onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                      rows={6}
                      placeholder="Full newsletter text content..."
                      className={`${inputClass} resize-y`}
                    />
                  </div>

                  <div>
                    <label className={labelClass}>PDF Upload (optional)</label>
                    {form.fileUrl ? (
                      <div className="flex items-center justify-between bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl p-3">
                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 truncate">{form.fileName || 'Uploaded PDF'}</span>
                        <button type="button" onClick={() => setForm(f => ({ ...f, fileUrl: '', fileName: '' }))} aria-label="Remove uploaded file" className="text-slate-400 hover:text-red-500 transition-colors ml-3 shrink-0">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center gap-3 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-5 cursor-pointer hover:border-yellow-500 transition-all text-xs font-black uppercase text-slate-400">
                        {uploading ? <Loader2 className="animate-spin" size={16} /> : <UploadCloud size={16} />}
                        {uploading ? 'Uploading…' : 'Upload PDF'}
                        <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePdfUpload} disabled={uploading} />
                      </label>
                    )}
                  </div>

                  {/* Status toggle */}
                  <div className="flex items-center gap-3 pt-2">
                    <span className={labelClass + ' mb-0'}>Status</span>
                    <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
                      {['published', 'draft'].map(s => (
                        <button
                          key={s} type="button"
                          onClick={() => setForm(f => ({ ...f, status: s }))}
                          className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${form.status === s ? 'bg-yellow-500 text-slate-950' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={closeModal} className="flex-1 py-3 rounded-xl font-black uppercase text-xs bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-all">
                      Cancel
                    </button>
                    <button type="submit" disabled={saving || uploading} className="flex-1 py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50 transition-all">
                      {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                      {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Publish Issue'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete Confirm Modal ── */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/90"
          >
            <motion.div
              initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-8 rounded-[2rem] max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="text-red-500" size={22} />
              </div>
              <h3 className="text-lg font-black uppercase italic mb-2">Delete Issue?</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
                "<span className="font-bold text-slate-700 dark:text-slate-300">{deleteConfirm.title}</span>" will be permanently removed.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-3 rounded-xl font-black uppercase text-xs bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-all">
                  Cancel
                </button>
                <button onClick={() => handleDelete(deleteConfirm.id)} className="flex-1 py-3 rounded-xl font-black uppercase text-xs bg-red-500 text-white hover:bg-red-600 transition-all">
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminNewsletters;
