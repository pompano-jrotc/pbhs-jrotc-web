// src/components/CadetTour.jsx
//
// First-login walkthrough for cadet-level users.
// Shows once per device via localStorage; replay via window event 'replay-cadet-tour'.

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Award, CalendarDays, LayoutGrid, UserCircle } from 'lucide-react';

export const CADET_TOUR_KEY = 'cadetTourSeen_v1';

const STEPS = [
  {
    icon: Award,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    title: 'Your Record is Live',
    body: 'This page is your personal record. Ribbons, Cadet Challenge scores, service hours, and promotion board results all update here automatically — no action needed from you.',
    hint: 'Scroll down to see your ribbon rack, PT history, and service hours tracker.',
  },
  {
    icon: CalendarDays,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    title: 'Stay in the Loop',
    body: "The right column shows upcoming formations, field trips, and messages from your chain of command. Check it before every class period — announcements live here.",
    hint: 'Upcoming Events and Announcements update in real time.',
  },
  {
    icon: LayoutGrid,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    title: 'More in the Sidebar',
    body: 'There\'s more than this page. Use the sidebar to reach Scholarships & Opportunities, the Achievement Wall, and your Fallen Heroes Fundraiser tracker.',
    hint: 'On mobile, tap the menu button (top-left) to open the sidebar.',
  },
  {
    icon: UserCircle,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    title: 'Set Up Your Profile',
    body: 'Add a photo and keep your info current — it shows on your record and helps your chain of command identify you. Find it at the top of the sidebar under your name.',
    hint: "Tap 'Edit Profile' at the top of your record to get started.",
  },
];

const CadetTour = () => {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CADET_TOUR_KEY)) setVisible(true);
    } catch {}

    const handler = () => { setStep(0); setVisible(true); };
    window.addEventListener('replay-cadet-tour', handler);
    return () => window.removeEventListener('replay-cadet-tour', handler);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(CADET_TOUR_KEY, '1'); } catch {}
    setVisible(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  };

  const { icon: Icon, color, bgColor, title, body, hint } = STEPS[step];
  const isLast = step === STEPS.length - 1;

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
            key={step}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 420, mass: 0.5 }}
            className="relative bg-slate-900 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-white/5 shadow-2xl overflow-hidden"
          >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-yellow-500/70 to-transparent" />

            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-6">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${bgColor} shrink-0`}>
                <Icon size={18} className={color} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                  {step + 1} / {STEPS.length}
                </span>
                <button
                  onClick={dismiss}
                  aria-label="Skip tour"
                  className="p-2 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 pt-5 pb-4">
              <h2 className="text-xl font-black uppercase italic tracking-tighter text-white leading-tight mb-3">
                {title}
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed mb-3">
                {body}
              </p>
              <p className="text-[11px] font-bold text-slate-500 italic">
                {hint}
              </p>
            </div>

            {/* Progress + action */}
            <div className="px-6 pb-6 flex items-center justify-between gap-4">
              <div className="flex gap-1.5">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    aria-label={`Go to step ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step ? 'w-5 bg-yellow-500' : i < step ? 'w-1.5 bg-yellow-500/40' : 'w-1.5 bg-white/10'
                    }`}
                  />
                ))}
              </div>
              <button
                onClick={next}
                className="bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-slate-950 font-black uppercase text-[11px] tracking-widest px-6 py-3 rounded-xl transition-all"
              >
                {isLast ? 'Get Started' : 'Next'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CadetTour;
