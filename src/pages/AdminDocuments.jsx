import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, doc, addDoc, deleteDoc, updateDoc, onSnapshot, serverTimestamp, getDoc, writeBatch
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, ADMIN_LEVEL } from '../constants';
import {
  FileText, Plus, Trash2, X, Loader2, CheckCircle2, UploadCloud, Download, File, Pencil, GripVertical, Save
} from 'lucide-react';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadPdfSigned } from '../utils/cloudinarySignedUpload';

// Same unsigned-upload pattern as AdminLeadership.jsx's portrait uploads -
// this app hosts all uploaded files on Cloudinary rather than Firebase
// Storage, so there's no separate Storage security rule to publish here.
// uploadToCloudinary validates the real file bytes are a PDF (not just the
// extension) before it ever reaches Cloudinary.

const DEFAULT_CATEGORIES = ["Cadet Command", "6th Brigade", "Broward County Regiment", "Tornado Battalion", "Other"];

const initialForm = { title: '', description: '', category: '', fileUrl: '', fileName: '' };

const inputClass = "w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white";
const labelClass = "text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1";

const formatBytes = (bytes) => {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

const docHref = (url) =>
  url?.includes('/raw/upload/')
    ? `/api/cloudinary-sign?download=1&url=${encodeURIComponent(url)}`
    : url;

const AdminDocuments = ({ hideHeader = false }) => {
  const { user, role, userData, loading: authLoading } = useAuth();
  const isAuthorized = role === 's5_public_affairs' || role === 's6_technology' || (ROLE_HIERARCHY[role] || 0) >= ADMIN_LEVEL;

  const [documents, setDocuments] = useState([]);
  const [localDocs, setLocalDocs] = useState([]);
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [dataLoading, setDataLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editDoc,       setEditDoc]       = useState(null);
  const [editForm,      setEditForm]      = useState({ title: '', description: '', category: '' });
  const [editSaving,    setEditSaving]    = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!isAuthorized) return;
    getDoc(doc(db, 'settings', 'documentCategories')).then(snap => {
      if (snap.exists()) {
        const cats = snap.data()?.categories;
        if (Array.isArray(cats) && cats.length > 0) setCategories(cats);
      }
    });
    const unsub = onSnapshot(collection(db, "documents"), (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => {
        if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
        if (a.sortOrder != null) return -1;
        if (b.sortOrder != null) return 1;
        return (b.uploadedAt?.seconds || 0) - (a.uploadedAt?.seconds || 0);
      });
      setDocuments(docs);
      setDataLoading(false);
    }, () => setDataLoading(false));
    return () => unsub();
  }, [isAuthorized]);

  // Sync localDocs from Firestore when not dragging and no unsaved order changes.
  // Must check !orderDirty: handleDrop sets dragIdx=null in the same React batch
  // as orderDirty=true, so without this guard the effect immediately overwrites
  // the reordered list before the user clicks Save Order.
  useEffect(() => {
    if (dragIdx === null && !orderDirty) {
      setLocalDocs(documents);
    }
  }, [documents, dragIdx, orderDirty]);

  const showStatus = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3500);
  };

  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };

  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...localDocs];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setLocalDocs(next);
    setOrderDirty(true);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const handleSaveOrder = async () => {
    setSavingOrder(true);
    try {
      const batch = writeBatch(db);
      localDocs.forEach((d, i) => batch.update(doc(db, 'documents', d.id), { sortOrder: i }));
      await batch.commit();
      setOrderDirty(false);
      showStatus('Order Saved');
      writeLog({
        type: 'document', action: 'reorder',
        description: 'Reordered document list',
        userId: user?.uid || '', userFullName: userData?.fullName || '', userRole: role || '',
      });
    } catch (err) {
      console.error('Reorder save failed:', err);
      showStatus('Save Failed');
    } finally {
      setSavingOrder(false);
    }
  };

  const openAdd = () => { setForm({ ...initialForm, category: categories[0] || 'Cadet Command' }); setShowModal(true); };

  const openEdit = (d) => {
    setEditDoc(d);
    setEditForm({ title: d.title || '', description: d.description || '', category: d.category || categories[0] });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editDoc) return;
    setEditSaving(true);
    try {
      await updateDoc(doc(db, 'documents', editDoc.id), {
        title:       editForm.title.trim(),
        description: editForm.description.trim(),
        category:    editForm.category,
      });
      showStatus('Document updated');
      writeLog({
        type: 'document', action: 'edit',
        description: `Updated document: "${editForm.title}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: editDoc.id, targetName: editForm.title,
      });
      setEditDoc(null);
    } catch (err) {
      console.error('Update failed:', err);
      showStatus('Update Failed');
    } finally {
      setEditSaving(false);
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadPdfSigned(file, 'documents/regulations');
      setForm(prev => ({
        ...prev,
        fileUrl: data.url,
        fileName: data.fileName,
        fileSize: data.bytes,
        title: prev.title || file.name.replace(/\.[^/.]+$/, '')
      }));
    } catch (err) {
      console.error("Document upload failed:", err);
      showStatus(err.message || "Upload Failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.fileUrl) return showStatus("Choose a file first");
    setSaving(true);
    try {
      await addDoc(collection(db, "documents"), {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        fileUrl: form.fileUrl,
        fileName: form.fileName,
        fileSize: form.fileSize || null,
        uploadedAt: serverTimestamp(),
        uploadedBy: userData?.fullName || 'Battalion Staff'
      });
      showStatus("Document Published");
      setShowModal(false);
      writeLog({
        type: 'document', action: 'create',
        description: `Published document: "${form.title}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: form.title,
      });
      setForm(initialForm);
    } catch (err) {
      console.error("Save failed:", err);
      showStatus("Save Failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { id, title } = deleteConfirm;
    try {
      await deleteDoc(doc(db, "documents", id));
      showStatus("Document Removed");
      writeLog({
        type: 'document', action: 'delete',
        description: `Removed document: "${title || id}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: title,
      });
    } catch (err) {
      console.error("Delete failed:", err);
      showStatus("Delete Failed");
    } finally {
      setDeleteConfirm(null);
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

        {!hideHeader && <AdminPageHeader icon={FileText} title="Documents" />}

        <div className="flex items-center justify-between mb-6 gap-3">
          {orderDirty ? (
            <button onClick={handleSaveOrder} disabled={savingOrder} className="bg-green-500 text-white font-black uppercase text-xs px-6 py-4 rounded-2xl hover:bg-green-400 transition-all flex items-center gap-2 shadow-lg shadow-green-500/20 disabled:opacity-60">
              {savingOrder ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Order
            </button>
          ) : (
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-600 flex items-center gap-1.5">
              <GripVertical size={12} /> Drag rows to reorder
            </p>
          )}
          <button onClick={openAdd} className="bg-yellow-500 text-slate-950 font-black uppercase text-xs px-6 py-4 rounded-2xl hover:bg-yellow-400 transition-all flex items-center gap-2 shadow-lg shadow-yellow-500/20">
            <Plus size={16} /> Upload Document
          </button>
        </div>

        {/* List */}
        <div className="space-y-3">
          {localDocs.length === 0 && (
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-10 rounded-[2rem] text-center text-slate-400 dark:text-slate-500 text-sm font-bold uppercase tracking-widest">
              No documents published yet
            </div>
          )}
          {localDocs.map((d, idx) => {
            const isWebp = d.fileName?.toLowerCase().endsWith('.webp') || d.fileUrl?.includes('/image/upload/');
            const isDragging = dragIdx === idx;
            const isDragOver = dragOverIdx === idx && dragIdx !== idx;
            return (
            <div
              key={d.id}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDrop={e => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              className={`bg-white dark:bg-slate-900/40 border p-6 rounded-[2rem] flex items-center justify-between gap-4 transition-all cursor-grab active:cursor-grabbing select-none ${
                isDragging ? 'opacity-40 scale-[0.98]' : ''
              } ${
                isDragOver
                  ? 'border-yellow-500 shadow-lg shadow-yellow-500/10'
                  : 'border-slate-200 dark:border-white/5'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <GripVertical size={16} className="text-slate-300 dark:text-slate-700 flex-shrink-0" />
                {isWebp ? (
                  <img src={d.fileUrl} alt={d.title} className="w-14 h-14 object-cover rounded-xl flex-shrink-0 border border-slate-200 dark:border-white/10" />
                ) : (
                <div className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 p-3 rounded-xl flex-shrink-0">
                  <File size={22} />
                </div>
                )}
                <div className="min-w-0">
                  <p className="font-black uppercase italic truncate">{d.title}</p>
                  <div className="flex flex-wrap gap-2 items-center mt-1">
                    <span className="text-yellow-600 dark:text-yellow-500 font-black text-[10px] uppercase">{d.category}</span>
                    {d.fileSize && <span className="text-slate-400 dark:text-slate-500 text-[10px] font-bold uppercase">{formatBytes(d.fileSize)}</span>}
                  </div>
                  {d.description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-1">{d.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a href={docHref(d.fileUrl)} target="_blank" rel="noopener noreferrer" title="Download" className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-yellow-500 hover:text-slate-950 transition-all text-slate-500">
                  <Download size={18} />
                </a>
                <button title="Edit document" onClick={() => openEdit(d)} className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-blue-500 hover:text-white transition-all text-slate-500">
                  <Pencil size={18} />
                </button>
                <button title="Remove document" onClick={() => setDeleteConfirm(d)} className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-red-500 hover:text-white transition-all text-slate-500">
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          );
          })}
        </div>
      </div>

      {/* UPLOAD MODAL */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80" onClick={() => setShowModal(false)} />
            <motion.form
              onSubmit={handleSave}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2rem] p-8 max-w-lg w-full shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black uppercase italic">Upload Document</h3>
                <button type="button" title="Close" onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white"><X size={20} /></button>
              </div>

              <div>
                <label className={labelClass}>File</label>
                <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-6 cursor-pointer hover:border-yellow-500 transition-all text-xs font-black uppercase text-slate-500">
                  {uploading ? <Loader2 className="animate-spin" size={16} /> : <UploadCloud size={16} />}
                  {uploading ? 'Uploading...' : form.fileName || 'Choose PDF or WebP'}
                  <input type="file" accept="application/pdf,image/webp" className="hidden" onChange={handleFileSelect} disabled={uploading} />
                </label>
              </div>

              <div>
                <label className={labelClass}>Title</label>
                <input required className={inputClass} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>

              <div>
                <label className={labelClass}>Category</label>
                <select className={inputClass} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className={labelClass}>Description (optional)</label>
                <textarea className={`${inputClass} h-20 resize-none`} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>

              <button type="submit" disabled={saving || uploading || !form.fileUrl} className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-4 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving ? <Loader2 className="animate-spin" size={18} /> : 'Publish Document'}
              </button>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE CONFIRM */}
      <AnimatePresence>
        {deleteConfirm && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80" onClick={() => setDeleteConfirm(null)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2rem] p-8 max-w-sm w-full shadow-2xl text-center space-y-6">
              <p className="font-black uppercase italic text-lg">Remove "{deleteConfirm.title}"?</p>
              <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">This takes it off the public page immediately</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 bg-slate-100 dark:bg-white/5 py-3 rounded-xl font-black uppercase text-xs">Cancel</button>
                <button onClick={confirmDelete} className="flex-1 bg-red-500 text-white py-3 rounded-xl font-black uppercase text-xs">Remove</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* EDIT MODAL */}
      <AnimatePresence>
        {editDoc && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80" onClick={() => setEditDoc(null)} />
            <motion.form
              onSubmit={handleUpdate}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-[2rem] p-8 max-w-lg w-full shadow-2xl space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black uppercase italic flex items-center gap-2"><Pencil size={18} className="text-yellow-500" /> Edit Document</h3>
                <button type="button" onClick={() => setEditDoc(null)} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white"><X size={20} /></button>
              </div>

              <div>
                <label className={labelClass}>Title</label>
                <input required className={inputClass} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
              </div>

              <div>
                <label className={labelClass}>Category</label>
                <select className={inputClass} value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <textarea required className={`${inputClass} h-24 resize-none`} placeholder="Brief description of this document…" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditDoc(null)} className="flex-1 bg-slate-100 dark:bg-white/5 py-3 rounded-xl font-black uppercase text-xs">Cancel</button>
                <button type="submit" disabled={editSaving} className="flex-1 bg-yellow-500 text-slate-950 py-3 rounded-xl font-black uppercase text-xs disabled:opacity-50 flex items-center justify-center gap-2">
                  {editSaving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save Changes'}
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

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

export default AdminDocuments;
