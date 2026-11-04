import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, CheckCircle, Shield, ChevronLeft, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { DEFAULT_POSITION_REQUIREMENTS } from '../components/S1PromotionBoard';
import { usePageMeta } from '../hooks/usePageMeta';
import Reveal from '../components/Reveal';

// Public-page rank tabs → positionRequirements key
const RANK_TO_POS = {
  'Company 1SG':   'First Sergeant',
  '1st Sergeant':  'First Sergeant',
};

// Staff assistant section.id → positionRequirements key
const ASST_TO_POS = {
  'S-1': 'Company S1 Assistant',
  'S-2': 'Company S2 Assistant',
  'S-3': 'Company S3 Assistant',
  'S-4': 'Company S4 Assistant',
  'S-5': 'Company S5 Assistant',
  'S-6': 'Company S6 Assistant',
  'S-7': 'Company S7 Assistant',
};

const BTN_STAFF_TO_POS = {
  'S-1': 'Battalion Staff (S-1)',
  'S-2': 'Battalion Staff (S-2)',
  'S-3': 'Battalion Staff (S-3)',
  'S-4': 'Battalion Staff (S-4)',
  'S-5': 'Battalion Staff (S-5)',
  'S-6': 'Battalion Staff (S-6)',
  'S-7': 'Battalion Staff (S-7)',
};

const BTN_COMMAND_POSITIONS = [
  'Sergeant Major',
  'Battalion XO',
  'Battalion Deputy Commander',
  'Battalion CSM',
  'Battalion Commander',
];

// Ordered tabs shown on the public page
const RANK_TABS = [
  'Squad Member',
  'Squad Leader',
  'Platoon Sergeant',
  'Platoon Leader',
  'Company 1SG',
  'Company XO',
  'Company Commander',
  'Staff Assistants',
  'Battalion Staff',
  'Battalion Command',
];

// Staff assistant sub-sections
const STAFF_ASST_SECTIONS = [
  { id: 'S-1', title: 'Personnel / Admin' },
  { id: 'S-2', title: 'Intelligence / Security' },
  { id: 'S-3', title: 'Operations / Training' },
  { id: 'S-4', title: 'Logistics / Supply' },
  { id: 'S-5', title: 'Public Affairs / Community' },
  { id: 'S-6', title: 'Signal / Communications' },
  { id: 'S-7', title: 'Civil Affairs / Engagement' },
];

const PromotionBoard = () => {
  usePageMeta({
    title: 'Promotion Study Guide',
    description: 'Promotion board study guide and requirements by rank for PBHS JROTC Tornado Battalion.',
    path: '/promotion-board',
  });

  const [selectedRank, setSelectedRank]   = useState('Squad Member');
  const [activeAsst, setActiveAsst]       = useState('S-1');
  const [activeBtnStaff, setActiveBtnStaff] = useState('S-1');
  const [activeBtnCmd, setActiveBtnCmd]   = useState('Sergeant Major');
  const [posReqs, setPosReqs]             = useState(DEFAULT_POSITION_REQUIREMENTS);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    return onSnapshot(doc(db, 'pageContent', 'promotion-board'), snap => {
      if (snap.exists() && snap.data().positionRequirements) {
        setPosReqs({ ...DEFAULT_POSITION_REQUIREMENTS, ...snap.data().positionRequirements });
      }
    });
  }, []);

  const getPosReqs = (rankTab) => {
    const key = RANK_TO_POS[rankTab] || rankTab;
    return posReqs[key] || DEFAULT_POSITION_REQUIREMENTS[key] || { items: [], duties: [], notes: '' };
  };

  const getAsstPosReqs = (sectionId) => {
    const key = ASST_TO_POS[sectionId];
    return posReqs[key] || DEFAULT_POSITION_REQUIREMENTS[key] || { items: [], duties: [], notes: '' };
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pt-32 pb-20 px-6 text-left">
      <div className="max-w-6xl mx-auto">
        <Link
          to="/cadet-info"
          className="inline-flex items-center text-slate-500 hover:text-yellow-500 mb-8 transition-colors text-xs font-bold uppercase tracking-widest"
        >
          <ChevronLeft size={16} className="mr-1" /> Back
        </Link>

        <Reveal>
          <header className="mb-12">
            <h1 className="text-4xl md:text-6xl font-black text-slate-900 dark:text-white uppercase italic font-military tracking-tighter">
              Promotion <span className="text-yellow-500">Board</span>
            </h1>
          </header>
        </Reveal>

        {/* RANK / POSITION SELECTOR */}
        <div className="flex gap-2 mb-12 flex-wrap">
          {RANK_TABS.map(rank => (
            <button
              key={rank}
              onClick={() => setSelectedRank(rank)}
              className={`px-4 py-2 rounded border text-[10px] font-black uppercase tracking-widest transition-all ${
                selectedRank === rank
                  ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-lg'
                  : 'border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              {rank}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── STAFF ASSISTANTS ───────────────────────────────────────────────── */}
          {selectedRank === 'Staff Assistants' ? (
            <motion.div
              key="asst-view"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="grid lg:grid-cols-3 gap-8"
            >
              {/* Sidebar selector */}
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <LayoutGrid size={12} /> Assistant Roles
                </p>
                {STAFF_ASST_SECTIONS.map(section => (
                  <button
                    key={section.id}
                    onClick={() => setActiveAsst(section.id)}
                    className={`w-full p-4 rounded-xl border text-left transition-all ${
                      activeAsst === section.id
                        ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-lg font-black'
                        : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <span className="italic block text-lg">{section.id}</span>
                    <span className={`text-[10px] uppercase font-bold tracking-tighter ${activeAsst === section.id ? 'text-slate-900' : 'text-slate-500'}`}>
                      {section.title}
                    </span>
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="lg:col-span-2 space-y-6">
                {(() => {
                  const r = getAsstPosReqs(activeAsst);
                  return (
                    <div className="grid gap-6">
                      {/* Checklist */}
                      <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-yellow-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                          <BookOpen className="text-yellow-500" size={20} /> Promotion Board Requirement
                        </h3>
                        {r.items.length === 0 ? (
                          <p className="text-sm text-slate-400 italic">No requirements configured yet.</p>
                        ) : (
                          <ul className="grid grid-cols-1 gap-3">
                            {r.items.map((item, i) => (
                              <li key={i} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                                <CheckCircle size={14} className="text-yellow-600 shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.notes && (
                          <p className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 text-xs text-slate-400 italic leading-relaxed">{r.notes}</p>
                        )}
                      </div>
                      {/* Duties */}
                      {r.duties && r.duties.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-blue-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                          <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                            <Shield className="text-blue-500" size={20} /> Duties &amp; Responsibilities
                          </h3>
                          <ul className="space-y-4">
                            {r.duties.map((duty, i) => (
                              <li key={i} className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                                <div className="h-1.5 w-1.5 rounded-full bg-blue-500 mt-2 shrink-0 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                {duty}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </motion.div>

          ) : selectedRank === 'Battalion Staff' ? (
            /* ── BATTALION STAFF ────────────────────────────────────────────── */
            <motion.div
              key="btn-staff-view"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="grid lg:grid-cols-3 gap-8"
            >
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <LayoutGrid size={12} /> Battalion Staff
                </p>
                {STAFF_ASST_SECTIONS.map(section => (
                  <button
                    key={section.id}
                    onClick={() => setActiveBtnStaff(section.id)}
                    className={`w-full p-4 rounded-xl border text-left transition-all ${
                      activeBtnStaff === section.id
                        ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-lg font-black'
                        : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <span className="italic block text-lg">{section.id}</span>
                    <span className={`text-[10px] uppercase font-bold tracking-tighter ${activeBtnStaff === section.id ? 'text-slate-900' : 'text-slate-500'}`}>
                      {section.title}
                    </span>
                  </button>
                ))}
              </div>
              <div className="lg:col-span-2 space-y-6">
                {(() => {
                  const key = BTN_STAFF_TO_POS[activeBtnStaff];
                  const r = posReqs[key] || DEFAULT_POSITION_REQUIREMENTS[key] || { items: [], duties: [], notes: '' };
                  return (
                    <div className="grid gap-6">
                      <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-yellow-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                          <BookOpen className="text-yellow-500" size={20} /> Promotion Board Requirement
                        </h3>
                        {r.items.length === 0 ? (
                          <p className="text-sm text-slate-400 italic">No requirements configured yet.</p>
                        ) : (
                          <ul className="grid grid-cols-1 gap-3">
                            {r.items.map((item, i) => (
                              <li key={i} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                                <CheckCircle size={14} className="text-yellow-600 shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.notes && (
                          <p className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 text-xs text-slate-400 italic leading-relaxed">{r.notes}</p>
                        )}
                      </div>
                      {r.duties && r.duties.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-blue-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                          <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                            <Shield className="text-blue-500" size={20} /> Duties &amp; Responsibilities
                          </h3>
                          <ul className="space-y-4">
                            {r.duties.map((duty, i) => (
                              <li key={i} className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                                <div className="h-1.5 w-1.5 rounded-full bg-blue-500 mt-2 shrink-0 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                {duty}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </motion.div>

          ) : selectedRank === 'Battalion Command' ? (
            /* ── BATTALION COMMAND ──────────────────────────────────────────── */
            <motion.div
              key="btn-cmd-view"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="grid lg:grid-cols-3 gap-8"
            >
              <div className="space-y-2">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <LayoutGrid size={12} /> Command Positions
                </p>
                {BTN_COMMAND_POSITIONS.map(pos => (
                  <button
                    key={pos}
                    onClick={() => setActiveBtnCmd(pos)}
                    className={`w-full p-4 rounded-xl border text-left transition-all ${
                      activeBtnCmd === pos
                        ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-lg font-black'
                        : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <span className="text-sm font-bold block">{pos}</span>
                  </button>
                ))}
              </div>
              <div className="lg:col-span-2 space-y-6">
                {(() => {
                  const r = posReqs[activeBtnCmd] || DEFAULT_POSITION_REQUIREMENTS[activeBtnCmd] || { items: [], duties: [], notes: '' };
                  return (
                    <div className="grid gap-6">
                      <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-yellow-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                          <BookOpen className="text-yellow-500" size={20} /> Promotion Board Requirement
                        </h3>
                        {r.items.length === 0 ? (
                          <p className="text-sm text-slate-400 italic">No requirements configured yet.</p>
                        ) : (
                          <ul className="grid grid-cols-1 gap-3">
                            {r.items.map((item, i) => (
                              <li key={i} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                                <CheckCircle size={14} className="text-yellow-600 shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.notes && (
                          <p className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 text-xs text-slate-400 italic leading-relaxed">{r.notes}</p>
                        )}
                      </div>
                      {r.duties && r.duties.length > 0 && (
                        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-blue-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                          <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                            <Shield className="text-blue-500" size={20} /> Duties &amp; Responsibilities
                          </h3>
                          <ul className="space-y-4">
                            {r.duties.map((duty, i) => (
                              <li key={i} className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                                <div className="h-1.5 w-1.5 rounded-full bg-blue-500 mt-2 shrink-0 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                                {duty}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </motion.div>

          ) : (
            /* ── ALL OTHER POSITIONS ────────────────────────────────────────── */
            <motion.div
              key={selectedRank}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {(() => {
                const r = getPosReqs(selectedRank);
                return (
                  <div className="grid lg:grid-cols-2 gap-6">
                    {/* Promotion Board Requirement */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-yellow-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                        <BookOpen className="text-yellow-500" size={20} /> Promotion Board Requirement
                      </h3>
                      {r.items.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">No requirements configured yet.</p>
                      ) : (
                        <ul className="grid grid-cols-1 gap-3">
                          {r.items.map((item, i) => (
                            <li key={i} className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                              <CheckCircle size={14} className="text-yellow-600 shrink-0" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      )}
                      {r.notes && (
                        <p className="mt-5 pt-4 border-t border-slate-100 dark:border-white/5 text-xs text-slate-400 italic leading-relaxed">{r.notes}</p>
                      )}
                    </div>

                    {/* Duties & Responsibilities */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border-t-4 border-blue-500 shadow-sm dark:shadow-none ring-1 ring-slate-100 dark:ring-white/5">
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white uppercase italic mb-6 flex items-center gap-2">
                        <Shield className="text-blue-500" size={20} /> Duties &amp; Responsibilities
                      </h3>
                      {!r.duties || r.duties.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">No duties configured yet.</p>
                      ) : (
                        <ul className="space-y-4">
                          {r.duties.map((duty, i) => (
                            <li key={i} className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                              <div className="h-1.5 w-1.5 rounded-full bg-blue-500 mt-2 shrink-0 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                              {duty}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default PromotionBoard;
