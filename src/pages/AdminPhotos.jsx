// src/pages/AdminPhotos.jsx
//
// Admin page to manage the public Photo Gallery page.
// Albums are stored in pageContent/photos.albums in Firestore.
// Each album: { id, title, count, coverImage, albumUrl }
// Cover images are uploaded to Cloudinary (same unsigned upload preset as
// AdminLeadership and AdminTeams); external album URLs link to Google Photos.

import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, ADMIN_LEVEL } from '../constants';
import {
  Image, Plus, Trash2, GripVertical, Save,
  Loader2, CheckCircle2, AlertCircle, UploadCloud, ExternalLink, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import { DEFAULT_PHOTOS } from '../data/defaultPageContent';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';

const emptyAlbum = () => ({
  id: Date.now(),
  title: '',
  count: '',
  coverImage: '',
  albumUrl: '',
});

const inputClass = "w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-colors";
const labelClass = "text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 block mb-1";

const AdminPhotos = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  // Only S5/S6 and top-4 (ADMIN_LEVEL) — same as AdminContent/AdminDocuments
  const isAuthorized = role === 's5_public_affairs' || role === 's6_technology' || (ROLE_HIERARCHY[role] || 0) >= ADMIN_LEVEL;

  const [albums, setAlbums] = useState(DEFAULT_PHOTOS.albums);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error', msg }
  const [showModal, setShowModal] = useState(false);
  const [editAlbum, setEditAlbum] = useState(null); // album being added/edited
  const [uploading, setUploading] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // album id

  useEffect(() => {
    if (!isAuthorized) return;
    const unsub = onSnapshot(doc(db, 'pageContent', 'photos'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data.albums) && data.albums.length > 0) setAlbums(data.albums);
        else setAlbums(DEFAULT_PHOTOS.albums);
      }
      setDataLoading(false);
    }, () => setDataLoading(false));
    return () => unsub();
  }, [isAuthorized]);

  const showStatus = (type, msg) => {
    setStatus({ type, msg });
    setTimeout(() => setStatus(null), 3500);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'pageContent', 'photos'), { albums });
      showStatus('success', 'Photo gallery updated. Changes are live instantly.');
      writeLog({
        type: 'photos', action: 'update',
        description: `Updated photo gallery albums (${albums.length} albums)`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      showStatus('error', 'Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Album modal ──────────────────────────────────────────────────────
  const openAdd = () => { setEditAlbum(emptyAlbum()); setShowModal(true); };
  const openEdit = (album) => { setEditAlbum({ ...album }); setShowModal(true); };

  const handleCoverUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadToCloudinary(file, 'image');
      setEditAlbum(prev => ({ ...prev, coverImage: data.secure_url }));
    } catch (err) {
      showStatus('error', err.message || 'Cover upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAlbumSave = () => {
    if (!editAlbum?.title?.trim()) return;
    const isNew = !albums.find(a => a.id === editAlbum.id);
    setAlbums(isNew
      ? [...albums, editAlbum]
      : albums.map(a => a.id === editAlbum.id ? editAlbum : a)
    );
    setShowModal(false);
    setEditAlbum(null);
  };

  // ── Drag to reorder ──────────────────────────────────────────────────
  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const updated = [...albums];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    setAlbums(updated);
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  // ── Delete ───────────────────────────────────────────────────────────
  const handleDelete = () => {
    if (deleteConfirm === null) return;
    setAlbums(albums.filter(a => a.id !== deleteConfirm));
    setDeleteConfirm(null);
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

        {!hideHeader && <AdminPageHeader icon={Image} title="Photo Gallery" />}

        <div className="flex justify-end mb-6">
          <button onClick={openAdd} className="bg-yellow-500 text-slate-950 px-6 py-3 rounded-2xl font-black uppercase text-xs flex items-center gap-2 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20 transition-all">
            <Plus size={18} /> Add Album
          </button>
        </div>

        {/* Status toast (inline) */}
        <AnimatePresence>
          {status && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className={`flex items-center gap-2 p-4 rounded-2xl text-sm font-bold mb-6 ${
                status.type === 'success'
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
              }`}
            >
              {status.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              {status.msg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Album list */}
        <div className="space-y-3 mb-8">
          {dataLoading ? (
            [1,2,3].map(i => <div key={i} className="h-24 bg-white dark:bg-slate-900/40 rounded-[2rem] animate-pulse" />)
          ) : albums.length === 0 ? (
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-10 rounded-[2rem] text-center text-slate-400 dark:text-slate-500 text-sm font-bold uppercase tracking-widest">
              No albums yet — click Add Album to get started
            </div>
          ) : (
            albums.map((album, idx) => (
              <div
                key={album.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={e => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                className={`bg-white dark:bg-slate-900/40 border rounded-[2rem] p-5 flex items-center gap-5 cursor-grab active:cursor-grabbing transition-all ${
                  dragIdx === idx
                    ? 'border-yellow-500/40 shadow-lg shadow-yellow-500/10'
                    : 'border-slate-200 dark:border-white/5 hover:shadow-md'
                }`}
              >
                <GripVertical size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />

                {/* Cover thumbnail */}
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-100 dark:bg-white/5 flex-shrink-0">
                  {album.coverImage ? (
                    <img src={album.coverImage} alt={album.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                      <Image size={24} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-black uppercase italic truncate text-slate-900 dark:text-white">{album.title}</p>
                  <div className="flex flex-wrap gap-2 mt-1 items-center">
                    {album.count && (
                      <span className="text-[9px] font-black text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded uppercase">{album.count}</span>
                    )}
                    {album.albumUrl && (
                      <a href={album.albumUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] font-black text-slate-400 hover:text-yellow-600 uppercase flex items-center gap-1">
                        External Link <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(album)} title="Edit album" className="p-2.5 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-yellow-500 hover:text-slate-950 transition-all text-slate-500">
                    <Image size={16} />
                  </button>
                  <button onClick={() => setDeleteConfirm(album.id)} title="Delete album" className="p-2.5 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-red-500 hover:text-white transition-all text-slate-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving || dataLoading}
          className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-yellow-500 text-slate-950 font-black text-sm uppercase tracking-widest hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-500/20"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {saving ? 'Saving…' : 'Save Gallery'}
        </button>
        <p className="text-center text-[11px] text-slate-400 dark:text-slate-600 mt-4">
          Saves to Firestore → public /photos page updates instantly.
        </p>
      </div>

      {/* ── ADD / EDIT ALBUM MODAL ─────────────────────────────────── */}
      <AnimatePresence>
        {showModal && editAlbum && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80" onClick={() => setShowModal(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-8 md:p-10 rounded-[3rem] max-w-lg w-full shadow-2xl overflow-y-auto max-h-[90vh]">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                  {albums.find(a => a.id === editAlbum.id) ? 'Edit Album' : 'Add Album'}
                </h2>
                <button title="Close" onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white"><X size={20} /></button>
              </div>

              <div className="space-y-5">
                {/* Cover image */}
                <div>
                  <label className={labelClass}>Cover Image</label>
                  <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-5 cursor-pointer hover:border-yellow-500 transition-all text-xs font-black uppercase text-slate-500 dark:text-slate-400 relative overflow-hidden">
                    {editAlbum.coverImage ? (
                      <img src={editAlbum.coverImage} alt="Cover" className="absolute inset-0 w-full h-full object-cover opacity-50 rounded-xl" />
                    ) : null}
                    <span className="relative z-10 flex items-center gap-2">
                      {uploading ? <Loader2 className="animate-spin" size={16} /> : <UploadCloud size={16} />}
                      {uploading ? 'Uploading...' : editAlbum.coverImage ? 'Replace Cover' : 'Upload Cover Image'}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} disabled={uploading} />
                  </label>
                </div>

                <div>
                  <label className={labelClass}>Album Title *</label>
                  <input required className={inputClass} placeholder="e.g. Raider States 2025-2026" value={editAlbum.title} onChange={e => setEditAlbum({ ...editAlbum, title: e.target.value })} />
                </div>

                <div>
                  <label className={labelClass}>Photo Count Label</label>
                  <input className={inputClass} placeholder="e.g. 163 Photos" value={editAlbum.count} onChange={e => setEditAlbum({ ...editAlbum, count: e.target.value })} />
                </div>

                <div>
                  <label className={labelClass}>External Album URL</label>
                  <input className={inputClass} type="url" placeholder="https://photos.app.goo.gl/..." value={editAlbum.albumUrl} onChange={e => setEditAlbum({ ...editAlbum, albumUrl: e.target.value })} />
                  <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1 ml-1">Google Photos, Flickr, or any public album link.</p>
                </div>

                <button
                  onClick={handleAlbumSave}
                  disabled={!editAlbum.title?.trim() || uploading}
                  className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-4 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 mt-2"
                >
                  {albums.find(a => a.id === editAlbum.id) ? 'Update Album' : 'Add to Gallery'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── DELETE CONFIRM ────────────────────────────────────────────── */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/90">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-10 rounded-[2.5rem] max-w-sm w-full text-center shadow-2xl">
            <Trash2 size={40} className="text-red-500 mx-auto mb-6" />
            <h3 className="text-xl font-black uppercase italic mb-3 text-slate-900 dark:text-white">Remove Album?</h3>
            <p className="text-slate-500 text-xs mb-8 leading-relaxed">
              Removes <span className="text-red-600 font-bold">{albums.find(a => a.id === deleteConfirm)?.title}</span> from the gallery. You'll need to click Save Gallery to commit.
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={handleDelete} className="w-full bg-red-600 py-4 rounded-xl font-black text-white uppercase text-[10px] tracking-widest hover:bg-red-500 transition-all">Remove</button>
              <button onClick={() => setDeleteConfirm(null)} className="w-full py-4 rounded-xl font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all uppercase text-[10px] tracking-widest bg-slate-100 dark:bg-white/5">Cancel</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminPhotos;
