// src/components/PatchNotesModal.jsx
//
// Login notification modal — content is composed by S6 in AdminLoginNotification
// and stored in Firestore at settings/loginNotification.
// Shows once per user per notificationId (tracked in localStorage).

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Wrench, Shield, Info } from 'lucide-react';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

const SECTION_STYLES = {
  feat:      { icon: Zap,    text: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', dot: 'bg-yellow-500' },
  fix:       { icon: Wrench, text: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   dot: 'bg-blue-400'   },
  sec:       { icon: Shield, text: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    dot: 'bg-red-400'    },
  important: { icon: Shield, text: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    dot: 'bg-red-400'    },
  info:      { icon: Info,   text: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/20',  dot: 'bg-slate-400'  },
};

const PatchNotesModal = () => {
  const [notification, setNotification] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'loginNotification'),
      snap => {
        if (!snap.exists()) { setNotification(null); setVisible(false); return; }
        const data = snap.data();
        if (!data.enabled) { setNotification(null); setVisible(false); return; }
        setNotification(data);
        try {
          const key = `loginNotifSeen_${data.notificationId || data.version || 'default'}`;
          if (!localStorage.getItem(key)) setVisible(true);
        } catch {}
      },
      () => {}
    );
    return () => unsub();
  }, []);

  const dismiss = () => {
    try {
      if (notification) {
        const key = `loginNotifSeen_${notification.notificationId || notification.version || 'default'}`;
        localStorage.setItem(key, '1');
      }
    } catch {}
    setVisible(false);
  };

  if (!notification) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-slate-950/90"
          onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 420, mass: 0.5 }}
            style={{ willChange: 'transform, opacity' }}
            className="relative bg-slate-900 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-white/5 shadow-2xl overflow-hidden"
          >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-yellow-500/70 to-transparent" />

            <div className="flex items-start justify-between px-6 pt-6 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  {notification.version && (
                    <span className="inline-flex items-center text-[9px] font-black uppercase tracking-[0.3em] text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                      {notification.version}
                    </span>
                  )}
                  {notification.date && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                      {notification.date}
                    </span>
                  )}
                </div>
                <h2 className="text-[1.6rem] font-black uppercase italic tracking-tighter text-white leading-none">
                  {notification.title || "What's New"}
                </h2>
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mt-1">
                  {notification.subtitle || 'PBHS Battalion Command Portal'}
                </p>
              </div>
              <button
                onClick={dismiss}
                aria-label="Close notification"
                className="p-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all mt-0.5"
              >
                <X size={15} />
              </button>
            </div>

            <div
              className="px-6 pb-2 space-y-3 overflow-y-auto"
              style={{ maxHeight: 'min(60vh, 420px)' }}
            >
              {(notification.sections || []).map((section, idx) => {
                const style = SECTION_STYLES[section.type] || SECTION_STYLES.info;
                const Icon = style.icon;
                return (
                  <div key={idx} className={`rounded-2xl border ${style.border} ${style.bg} p-4`}>
                    <div className={`flex items-center gap-2 mb-3 ${style.text}`}>
                      <Icon size={12} strokeWidth={2.5} />
                      <span className="text-[9px] font-black uppercase tracking-[0.3em]">{section.label || 'Section'}</span>
                    </div>
                    <ul className="space-y-2">
                      {(section.items || []).map((item, i) => (
                        <li key={i} className="flex gap-2.5 text-[11px] text-slate-300 leading-relaxed font-medium">
                          <span className={`mt-[7px] w-1 h-1 rounded-full shrink-0 ${style.dot}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <div className="px-6 pt-4 pb-6">
              <button
                onClick={dismiss}
                className="w-full bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-slate-950 font-black uppercase text-[11px] tracking-widest py-3.5 rounded-xl transition-all"
              >
                {notification.buttonLabel || 'Got It — Continue to Dashboard'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PatchNotesModal;
