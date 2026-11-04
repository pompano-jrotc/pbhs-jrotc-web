// src/pages/AdminCompanies.jsx
//
// SAI/AI-only page to configure the battalion's lettered companies.
// Changes write to `settings/companies` in Firestore and propagate
// instantly everywhere via the useCompanies() hook.

import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, ADMIN_LEVEL } from '../constants';
import {
  Building2, Plus, Trash2, GripVertical,
  Loader2, CheckCircle2, AlertCircle, Save, FolderOpen, Eye, EyeOff
} from 'lucide-react';
import { DEFAULT_VISIBILITY } from '../hooks/usePageVisibility';
import { motion, AnimatePresence } from 'framer-motion';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';

// "Battalion" is a fixed designation for HQ staff — it is NOT a company and
// must never appear in this list or be added by an admin.
const DEFAULT_COMPANIES = ["Alpha", "Bravo", "Charlie", "Delta"];
const DEFAULT_CATEGORIES = ["Regulations", "Forms", "Handbooks & Guides", "Uniform", "Other"];

const AdminCompanies = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  // s6_technology is explicitly allowed via the route's allowedRoles; the
  // level check alone (>= 80) would block them since they sit at level 70.
  const isAuthorized = (ROLE_HIERARCHY[role] || 0) >= ADMIN_LEVEL || role === 's6_technology';

  const [companies, setCompanies] = useState(DEFAULT_COMPANIES);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCats, setSavingCats] = useState(false);
  const [savingVis, setSavingVis] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error', msg: string }
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [dragIdx, setDragIdx] = useState(null);
  const [catDragIdx, setCatDragIdx] = useState(null);

  // Load existing configs once on mount
  useEffect(() => {
    if (!isAuthorized) return;
    Promise.all([
      getDoc(doc(db, 'settings', 'companies')),
      getDoc(doc(db, 'settings', 'documentCategories')),
      getDoc(doc(db, 'settings', 'pageVisibility')),
    ]).then(([companiesSnap, catsSnap, visSnap]) => {
      if (companiesSnap.exists()) {
        const names = companiesSnap.data()?.names;
        if (Array.isArray(names) && names.length > 0) setCompanies(names);
      }
      if (catsSnap.exists()) {
        const cats = catsSnap.data()?.categories;
        if (Array.isArray(cats) && cats.length > 0) setCategories(cats);
      }
      if (visSnap.exists()) {
        setVisibility({ ...DEFAULT_VISIBILITY, ...visSnap.data() });
      }
      setDataLoading(false);
    }).catch(() => setDataLoading(false));
  }, [isAuthorized]);

  const showStatus = (type, msg) => {
    setStatus({ type, msg });
    setTimeout(() => setStatus(null), 3500);
  };

  const handleSave = async () => {
    const trimmed = companies.map(c => c.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      showStatus('error', 'At least one company is required.');
      return;
    }
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'companies'), { names: trimmed });
      setCompanies(trimmed);
      showStatus('success', 'Company list saved. Changes are live instantly.');
      writeLog({
        type: 'settings', action: 'update',
        description: `Updated company list: ${trimmed.join(', ')}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      showStatus('error', 'Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    if (name.toLowerCase() === 'battalion') {
      showStatus('error', '"Battalion" is a reserved designation for HQ staff — it cannot be added as a company.');
      return;
    }
    if (companies.map(c => c.toLowerCase()).includes(name.toLowerCase())) {
      showStatus('error', `"${name}" already exists.`);
      return;
    }
    setCompanies([...companies, name]);
    setNewName('');
  };

  const handleRename = (idx, value) => {
    const updated = [...companies];
    updated[idx] = value;
    setCompanies(updated);
  };

  const handleDelete = (idx) => {
    setCompanies(companies.filter((_, i) => i !== idx));
  };

  // Simple drag-to-reorder (companies)
  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const updated = [...companies];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    setCompanies(updated);
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  // ── Document categories handlers ──────────────────────────────────────
  const handleSaveCategories = async () => {
    const trimmed = categories.map(c => c.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      showStatus('error', 'At least one category is required.');
      return;
    }
    setSavingCats(true);
    try {
      await setDoc(doc(db, 'settings', 'documentCategories'), { categories: trimmed });
      setCategories(trimmed);
      showStatus('success', 'Document categories saved. Changes are live instantly.');
      writeLog({
        type: 'settings', action: 'update',
        description: `Updated document categories: ${trimmed.join(', ')}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      showStatus('error', 'Save failed: ' + err.message);
    } finally {
      setSavingCats(false);
    }
  };

  const handleAddCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (categories.map(c => c.toLowerCase()).includes(name.toLowerCase())) {
      showStatus('error', `"${name}" already exists.`);
      return;
    }
    setCategories([...categories, name]);
    setNewCategory('');
  };

  const handleRenameCategory = (idx, value) => {
    const updated = [...categories];
    updated[idx] = value;
    setCategories(updated);
  };

  const handleDeleteCategory = (idx) => {
    setCategories(categories.filter((_, i) => i !== idx));
  };

  const handleCatDragStart = (idx) => setCatDragIdx(idx);
  const handleCatDragOver = (e, idx) => {
    e.preventDefault();
    if (catDragIdx === null || catDragIdx === idx) return;
    const updated = [...categories];
    const [moved] = updated.splice(catDragIdx, 1);
    updated.splice(idx, 0, moved);
    setCategories(updated);
    setCatDragIdx(idx);
  };
  const handleCatDragEnd = () => setCatDragIdx(null);

  // ── Page visibility handlers ──────────────────────────────────────────
  const handleToggleVisibility = (key) => {
    setVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSaveVisibility = async () => {
    setSavingVis(true);
    try {
      await setDoc(doc(db, 'settings', 'pageVisibility'), visibility);
      showStatus('success', 'Page visibility saved. Nav updates instantly for all visitors.');
      writeLog({
        type: 'settings', action: 'update',
        description: `Updated public page visibility settings`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });
    } catch (err) {
      showStatus('error', 'Save failed: ' + err.message);
    } finally {
      setSavingVis(false);
    }
  };

  if (authLoading) return (
    <div className="min-h-screen bg-blue-50 dark:bg-slate-950 flex items-center justify-center">
      <Loader2 className="animate-spin text-yellow-500" size={32} />
    </div>
  );

  if (!user) return <Navigate to="/admin" />;
  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      <div className="max-w-2xl mx-auto w-full">

        {!hideHeader && <AdminPageHeader icon={Building2} title="Companies" />}

        {/* Status toast */}
        <AnimatePresence>
          {status && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className={`flex items-center gap-2 p-3 rounded-xl text-sm font-bold mb-6 ${
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

        {/* Company list */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-blue-100 dark:border-white/5 shadow-sm p-6 mb-6">
          <p className="text-[11px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-4">
            Current Companies — drag to reorder
          </p>

          {dataLoading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="h-11 bg-blue-50 dark:bg-white/5 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {companies.map((name, idx) => (
                <div
                  key={idx}
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-grab active:cursor-grabbing ${
                    dragIdx === idx
                      ? 'border-yellow-500/40 bg-yellow-500/5 shadow-lg'
                      : 'border-blue-100 dark:border-white/10 bg-blue-50/50 dark:bg-white/5 hover:border-blue-200 dark:hover:border-white/20'
                  }`}
                >
                  <GripVertical size={16} className="text-slate-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={name}
                    onChange={e => handleRename(idx, e.target.value)}
                    maxLength={30}
                    className="flex-1 bg-transparent text-sm font-bold text-slate-900 dark:text-white outline-none border-b border-transparent focus:border-yellow-500 transition-colors"
                  />
                  <button
                    onClick={() => handleDelete(idx)}
                    disabled={companies.length <= 1}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Remove company"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              {/* Always-present Battalion row (non-removable) */}
              <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-slate-200 dark:border-white/10 opacity-50">
                <GripVertical size={16} className="text-slate-300" />
                <span className="flex-1 text-sm font-bold text-slate-500 dark:text-slate-400">Battalion</span>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Fixed</span>
              </div>
            </div>
          )}
        </div>

        {/* Add new company */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-blue-100 dark:border-white/5 shadow-sm p-6 mb-6">
          <p className="text-[11px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-3">
            Add Company
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. Echo"
              maxLength={30}
              className="flex-1 bg-blue-50 dark:bg-black/50 border border-blue-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-colors"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim()}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-yellow-500 text-slate-950 font-black text-sm uppercase tracking-widest hover:bg-yellow-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={16} /> Add
            </button>
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || dataLoading}
          className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-yellow-500 text-slate-950 font-black text-sm uppercase tracking-widest hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-500/20"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {saving ? 'Saving…' : 'Save Company List'}
        </button>

        <p className="text-center text-[11px] text-slate-400 dark:text-slate-600 mt-4">
          Saves to Firestore → all pages update instantly. Renaming a company here does not rename existing cadet records — update those separately in Manage Personnel.
        </p>

        {/* ── DOCUMENT CATEGORIES ────────────────────────────────────── */}
        <div className="mt-10 pt-10 border-t border-blue-100 dark:border-white/5">
          <div className="flex items-center gap-2 mb-6">
            <FolderOpen size={18} className="text-yellow-500" />
            <div>
              <h2 className="text-sm font-black uppercase italic tracking-tight text-slate-900 dark:text-white">Document Categories</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-widest">Used in Documents admin + public /documents page</p>
            </div>
          </div>

          {/* Category list */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-blue-100 dark:border-white/5 shadow-sm p-6 mb-6">
            <p className="text-[11px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-4">
              Current Categories — drag to reorder
            </p>
            {dataLoading ? (
              <div className="space-y-3">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-11 bg-blue-50 dark:bg-white/5 animate-pulse rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {categories.map((name, idx) => (
                  <div
                    key={idx}
                    draggable
                    onDragStart={() => handleCatDragStart(idx)}
                    onDragOver={(e) => handleCatDragOver(e, idx)}
                    onDragEnd={handleCatDragEnd}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-grab active:cursor-grabbing ${
                      catDragIdx === idx
                        ? 'border-yellow-500/40 bg-yellow-500/5 shadow-lg'
                        : 'border-blue-100 dark:border-white/10 bg-blue-50/50 dark:bg-white/5 hover:border-blue-200 dark:hover:border-white/20'
                    }`}
                  >
                    <GripVertical size={16} className="text-slate-400 flex-shrink-0" />
                    <input
                      type="text"
                      value={name}
                      onChange={e => handleRenameCategory(idx, e.target.value)}
                      maxLength={40}
                      className="flex-1 bg-transparent text-sm font-bold text-slate-900 dark:text-white outline-none border-b border-transparent focus:border-yellow-500 transition-colors"
                    />
                    <button
                      onClick={() => handleDeleteCategory(idx)}
                      disabled={categories.length <= 1}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Remove category"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add new category */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-blue-100 dark:border-white/5 shadow-sm p-6 mb-6">
            <p className="text-[11px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-3">
              Add Category
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                placeholder="e.g. Safety Plans"
                maxLength={40}
                className="flex-1 bg-blue-50 dark:bg-black/50 border border-blue-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-colors"
              />
              <button
                onClick={handleAddCategory}
                disabled={!newCategory.trim()}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-yellow-500 text-slate-950 font-black text-sm uppercase tracking-widest hover:bg-yellow-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} /> Add
              </button>
            </div>
          </div>

          {/* Save categories */}
          <button
            onClick={handleSaveCategories}
            disabled={savingCats || dataLoading}
            className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-yellow-500 text-slate-950 font-black text-sm uppercase tracking-widest hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-500/20"
          >
            {savingCats ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {savingCats ? 'Saving…' : 'Save Document Categories'}
          </button>

          <p className="text-center text-[11px] text-slate-400 dark:text-slate-600 mt-4">
            Existing documents keep their current category tag — renaming a category here does not reclassify them automatically.
          </p>
        </div>

        {/* ── PAGE VISIBILITY ────────────────────────────────────────── */}
        <div className="mt-10 pt-10 border-t border-blue-100 dark:border-white/5">
          <div className="flex items-center gap-2 mb-6">
            <Eye size={18} className="text-yellow-500" />
            <div>
              <h2 className="text-sm font-black uppercase italic tracking-tight text-slate-900 dark:text-white">Page Visibility</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-widest">Controls which links appear in the public navigation</p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-blue-100 dark:border-white/5 shadow-sm p-6 mb-6">
            <p className="text-[11px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-4">
              Public nav links — toggle to show / hide
            </p>
            {dataLoading ? (
              <div className="space-y-3">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-12 bg-blue-50 dark:bg-white/5 animate-pulse rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { key: 'about',             label: 'About JROTC' },
                  { key: 'cadet-info',        label: 'Cadet Info' },
                  { key: 'leadership',        label: 'Leadership' },
                  { key: 'teams',             label: 'Special Teams' },
                  { key: 'announcements',     label: 'Announcements' },
                  { key: 'events',            label: 'Events Calendar' },
                  { key: 'documents',         label: 'Documents' },
                  { key: 'promotion-board',   label: 'Promotion Board' },
                  { key: 'photos',            label: 'Photo Gallery' },
                  { key: 'winning-colors',    label: 'Winning Colors (inside Cadet Info)' },
                ].map(({ key, label }) => {
                  const isOn = !!visibility[key];
                  return (
                    <button
                      key={key}
                      onClick={() => handleToggleVisibility(key)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                        isOn
                          ? 'border-yellow-500/30 bg-yellow-500/5 hover:border-yellow-500/50'
                          : 'border-blue-100 dark:border-white/10 bg-blue-50/50 dark:bg-white/5 hover:border-blue-200 dark:hover:border-white/20'
                      }`}
                    >
                      <span className={`text-sm font-bold ${isOn ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500 line-through'}`}>
                        {label}
                      </span>
                      <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${isOn ? 'text-yellow-500' : 'text-slate-400 dark:text-slate-600'}`}>
                        {isOn ? <Eye size={14} /> : <EyeOff size={14} />}
                        {isOn ? 'Visible' : 'Hidden'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={handleSaveVisibility}
            disabled={savingVis || dataLoading}
            className="w-full flex items-center justify-center gap-2 p-4 rounded-2xl bg-yellow-500 text-slate-950 font-black text-sm uppercase tracking-widest hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-500/20"
          >
            {savingVis ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {savingVis ? 'Saving…' : 'Save Page Visibility'}
          </button>

          <p className="text-center text-[11px] text-slate-400 dark:text-slate-600 mt-4">
            Hides the nav link — the page itself still exists at its URL. Saves to Firestore → the public nav updates instantly.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminCompanies;
