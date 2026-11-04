// src/components/AdminLayout.jsx
//
// Layout route that wraps all authenticated admin pages with the shared
// AdminSidebar so staff see the nav on every page, not just the dashboard.
// Used as a React Router v6 layout route (element with <Outlet />) in App.jsx.
//
// Also owns the session soft-lock: listens for the 'idle-session-lock' event
// dispatched by useIdleLogout and renders SessionLockScreen in response.
// Using a lock overlay (instead of signOut) means re-authentication is
// password-only — no SMS 2FA triggered, preserving Firebase's SMS quota.

import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu, MessageSquare, Bug, Lightbulb, MessageCircle, X, Send, Loader2 } from 'lucide-react';
import AdminSidebar from './AdminSidebar';
import SessionLockScreen from './SessionLockScreen';
import Footer from './Footer';
import { db } from '../firebase';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';

// ── Feedback widget (floating button + modal) ─────────────────────────────────
const BLANK_FEEDBACK = { type: 'Bug', title: '', description: '', priority: 'Medium' };

const FeedbackWidget = () => {
  const { userData } = useAuth();
  const [open,    setOpen]    = useState(false);
  const [form,    setForm]    = useState(BLANK_FEEDBACK);
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'feedback'), {
        ...form,
        title:           form.title.trim(),
        description:     form.description.trim(),
        status:          'Open',
        submittedBy:     userData?.uid    || '',
        submittedByName: userData?.fullName || 'Anonymous',
        submittedAt:     Timestamp.now(),
        resolvedAt:      null,
        resolvedByName:  null,
      });
      setSuccess(true);
      setTimeout(() => { setOpen(false); setForm(BLANK_FEEDBACK); setSuccess(false); }, 1800);
    } catch (err) {
      console.error('Feedback submit failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const TYPE_ICONS = {
    Bug:              <Bug size={14} />,
    'Feature Request':<Lightbulb size={14} />,
    Feedback:         <MessageCircle size={14} />,
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        title="Submit feedback or report a bug"
        className="fixed bottom-6 right-6 z-40 w-12 h-12 bg-yellow-500 hover:bg-yellow-400 text-slate-950 rounded-full shadow-xl shadow-yellow-500/30 flex items-center justify-center transition-all hover:scale-110 active:scale-95"
      >
        <MessageSquare size={20} />
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-6 bg-black/50">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-white/5">
            <div className="flex items-center justify-between px-6 pt-6 pb-0 mb-4">
              <h2 className="text-base font-black uppercase italic tracking-tighter text-slate-900 dark:text-white flex items-center gap-2">
                <MessageSquare size={18} className="text-yellow-500" /> Submit Feedback
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Close feedback panel" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <X size={18} />
              </button>
            </div>

            {success ? (
              <div className="px-6 pb-6 pt-2 text-center">
                <div className="w-14 h-14 bg-green-500/10 border border-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Send size={24} className="text-green-600 dark:text-green-400" />
                </div>
                <p className="font-black uppercase text-sm text-slate-900 dark:text-white">Submitted!</p>
                <p className="text-xs text-slate-400 mt-1">Thank you — we'll look into it.</p>
              </div>
            ) : (
              <div className="px-6 pb-6 space-y-4">
                {/* Type selector */}
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(TYPE_ICONS).map(([t, icon]) => (
                    <button
                      key={t}
                      onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-[10px] font-black uppercase transition-all ${
                        form.type === t
                          ? 'bg-yellow-500 text-slate-950 border-yellow-500 shadow-md shadow-yellow-500/20'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-white/5 hover:border-yellow-500/30'
                      }`}
                    >
                      {icon} {t}
                    </button>
                  ))}
                </div>

                {/* Title */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Title *</label>
                  <input
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Brief summary…"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Description *</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    rows={4}
                    placeholder="Steps to reproduce (bugs), or what you'd like to see (requests)…"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors resize-none"
                  />
                </div>

                {/* Priority */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Priority</label>
                  <div className="flex gap-2">
                    {['Low', 'Medium', 'High'].map(p => (
                      <button
                        key={p}
                        onClick={() => setForm(f => ({ ...f, priority: p }))}
                        className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${
                          form.priority === p
                            ? p === 'High'   ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                            : p === 'Medium' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 border-yellow-500/30'
                                             : 'bg-slate-400/10 text-slate-500 border-slate-400/20'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={submit}
                  disabled={saving || !form.title.trim() || !form.description.trim()}
                  className="w-full py-3 rounded-xl text-sm font-black uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {saving ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const AdminLayout = () => {
  // Initialise from sessionStorage so a page refresh while locked stays locked.
  const [locked, setLocked] = useState(
    () => sessionStorage.getItem('sessionLocked') === '1'
  );
  // Mobile sidebar open/closed state (desktop always shows sidebar via CSS)
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop sidebar collapsed (icon-only) state — persisted across page loads
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('adminSidebarCollapsed') === 'true'; } catch { return false; }
  });

  const handleToggleCollapse = () => {
    setSidebarCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('adminSidebarCollapsed', String(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    const handleLock = () => setLocked(true);
    window.addEventListener('idle-session-lock', handleLock);
    return () => window.removeEventListener('idle-session-lock', handleLock);
  }, []);

  // Close sidebar when route changes (user tapped a nav link)
  const handleSidebarClose = () => setSidebarOpen(false);

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
      <AdminSidebar
        open={sidebarOpen}
        onClose={handleSidebarClose}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleCollapse}
      />

      {/* Mobile backdrop — tapping outside the sidebar closes it */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={handleSidebarClose}
          aria-hidden="true"
        />
      )}

      {/* Main content — offset by sidebar width on lg+; width adjusts when sidebar collapses */}
      <div className={`flex-1 ${sidebarCollapsed ? 'lg:ml-[60px] lg:pl-6' : 'lg:ml-60'} flex flex-col min-w-0 transition-all duration-300`}>
        {/* Mobile top bar with hamburger — hidden on desktop */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-white/5 sticky top-0 z-10 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <Menu size={20} />
          </button>
          <span className="text-yellow-500 font-black text-sm uppercase italic tracking-tight select-none">
            Battalion HQ
          </span>
        </div>

        <Outlet />
        <Footer />
      </div>

      {/* Floating feedback button — always visible on admin pages */}
      <FeedbackWidget />

      {/* Session soft-lock overlay — shown on idle, cleared by password re-entry */}
      {locked && <SessionLockScreen onUnlock={() => setLocked(false)} />}
    </div>
  );
};

export default AdminLayout;
