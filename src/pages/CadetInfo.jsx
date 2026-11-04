import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Star, Users, Award, Target, Scale, GraduationCap, ChevronRight } from 'lucide-react';
import { db } from '../firebase';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { DEFAULT_CADET_INFO } from '../data/defaultPageContent';
import { usePageMeta } from '../hooks/usePageMeta';
import Reveal from '../components/Reveal';

// --- DYNAMIC RANK SYMBOL ENGINE (CLEAN & SPACED) ---
// bg-black is intentional here: rank insignia are always displayed on a black
// military-style backing board regardless of the page's light/dark mode.
const RankSymbol = ({ type, count, hasWreath, hasStar, hasDiamond }) => {
  const isOfficer = type === 'officer' || type === 'officer-disk';
  const containerClass = "relative w-16 h-32 bg-black border border-white/10 rounded-md flex flex-col items-center py-4 overflow-hidden shadow-2xl";

  if (isOfficer) {
    const isDisk = type === 'officer-disk';
    return (
      <div className={containerClass}>
        <div className="flex flex-col gap-3 items-center justify-center h-full">
          {[...Array(count)].map((_, i) => (
            <div
              key={i}
              className={isDisk
                ? "w-4 h-4 rounded-full bg-gradient-to-br from-slate-100 to-slate-300 shadow-[0_0_8px_rgba(255,255,255,0.3)] border border-slate-400"
                : "w-5 h-5 rotate-45 bg-gradient-to-br from-slate-100 to-slate-300 shadow-[0_0_8px_rgba(255,255,255,0.3)] border border-slate-400"
              }
            />
          ))}
        </div>
      </div>
    );
  }

  const up = parseInt(count.split('/')[0]) || 0;
  const down = parseInt(count.split('/')[1]) || 0;

  return (
    <div className={containerClass}>
      <div className="flex flex-col h-full w-full items-center justify-between px-1 scale-[0.9]">
        <div className="flex flex-col gap-1 w-full items-center">
          {[...Array(up)].map((_, i) => (
            <div
              key={i}
              className="w-12 h-3 bg-yellow-500 shadow-sm"
              style={{ clipPath: 'polygon(50% 0%, 100% 100%, 85% 100%, 50% 25%, 15% 100%, 0% 100%)' }}
            />
          ))}
        </div>

        <div className="relative flex items-center justify-center h-12 w-full">
          {hasWreath && (
            <div className="absolute w-12 h-12 border-4 border-double border-yellow-500/60 rounded-full flex items-center justify-center">
                <div className="absolute inset-0 border-2 border-dotted border-yellow-500/40 rounded-full rotate-45" />
            </div>
          )}
          {hasStar && <Star size={hasWreath ? 18 : 20} className="text-yellow-500 fill-yellow-500 z-10" />}
          {hasDiamond && <div className="w-4 h-4 rotate-45 bg-yellow-500 border border-yellow-600 shadow-sm z-10" />}
        </div>

        <div className="flex flex-col gap-1.5 w-full items-center">
          {[...Array(down)].map((_, i) => (
            <div key={i} className="w-12 h-1.5 bg-yellow-500 rounded-sm shadow-sm" />
          ))}
        </div>
      </div>
    </div>
  );
};

const Section = ({ title, icon: Icon, children, color = "yellow" }) => (
  <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/5 p-8 rounded-3xl hover:border-yellow-500/20 transition-all shadow-sm dark:shadow-xl">
    <div className="flex items-center gap-4 mb-6">
      <div className={`p-3 bg-${color}-500/10 rounded-2xl text-${color}-500`}>
        <Icon size={28} />
      </div>
      <h2 className="text-2xl font-black uppercase italic tracking-tighter">{title}</h2>
    </div>
    <div className="space-y-4">{children}</div>
  </div>
);

// The rank card background stays dark (bg-black/40) regardless of page theme —
// it's representing a physical insignia board, which is always black.
const RankItem = ({ name, abbr, description, symbolProps }) => (
  <div className="flex flex-col items-center bg-slate-800/20 dark:bg-black/40 p-4 rounded-xl border border-slate-200 dark:border-white/5 group hover:border-yellow-500/50 transition-colors">
    <div className="w-full h-44 mb-3 bg-slate-200 dark:bg-white/5 rounded-lg flex items-center justify-center p-2 text-center overflow-hidden">
      <RankSymbol {...symbolProps} />
    </div>
    <span className="text-[10px] font-black uppercase text-center leading-tight tracking-tighter mb-1 text-slate-500">{description}</span>
    <span className="text-[11px] font-black uppercase text-center leading-tight tracking-tighter">{name}</span>
    {abbr && <span className="text-[9px] font-bold text-yellow-500/70 tracking-widest mt-1">{abbr}</span>}
  </div>
);

const CadetInfo = () => {
  usePageMeta({
    title: 'Cadet Info',
    description: 'Cadet creed, rank structure, and general information for PBHS JROTC Tornado Battalion cadets.',
    path: '/cadet-info',
  });
  // Local states for dynamic data layers
  const [commandStaff, setCommandStaff] = useState({ bc: 'Loading...', xo: 'Loading...', csm: 'Loading...' });
  const [instructors, setInstructors] = useState({ sai: 'LTC Johnson', ai: '1SG Chevrestt' });
  const [content, setContent] = useState(DEFAULT_CADET_INFO);

  // --- COMPONENT DATA FETCHING (LIVE FIRESTORE) ---
  useEffect(() => {
    const unsubContent = onSnapshot(doc(db, "pageContent", "cadet-info"), (snap) => {
      if (snap.exists()) setContent({ ...DEFAULT_CADET_INFO, ...snap.data() });
    });

    const unsubLeadership = onSnapshot(collection(db, "leadership"), (snapshot) => {
      let tempStaff = { bc: 'Not Assigned', xo: 'Not Assigned', csm: 'Not Assigned' };
      snapshot.docs.forEach(docSnap => {
        const meta = docSnap.data();
        if (!meta.role || !meta.name) return;
        const cleanRole = meta.role.toLowerCase().replace(/[\s-_]/g, '');
        // Only battalion-level entries (no company) for all three top positions.
        // Company XOs share role "Executive Officer" with the battalion XO, so
        // without this check the last company XO (sorted by doc ID) overwrites
        // the battalion XO and the wrong name is displayed.
        const isBattalionEntry = !meta.company || meta.company.trim() === '' || meta.company.trim().toLowerCase() === 'none';
        if (cleanRole === 'battalioncommander') tempStaff.bc = meta.name;
        if ((cleanRole === 'executiveofficer' || cleanRole === 'battalionxo') && isBattalionEntry) tempStaff.xo = meta.name;
        if (cleanRole === 'commandsergeantmajor') tempStaff.csm = meta.name;
      });
      setCommandStaff(tempStaff);
    });

    const unsubInstructors = onSnapshot(collection(db, "instructors"), (snapshot) => {
      let tempInstructors = { sai: 'LTC Johnson', ai: '1SG Chevrestt' }; // Fallback defaults
      snapshot.docs.forEach(docSnap => {
        const meta = docSnap.data();
        if (!meta.type || !meta.name) return;
        const cleanType = meta.type.toUpperCase().trim();
        if (cleanType === 'SAI') tempInstructors.sai = meta.name;
        if (cleanType === 'AI') tempInstructors.ai = meta.name;
      });
      setInstructors(tempInstructors);
    });

    return () => { unsubContent(); unsubLeadership(); unsubInstructors(); };
  }, []);

  // Abbreviations match JROTC_RANKS in AdminUsers.jsx/UniformRequests.jsx (C/PVT ... C/COL) -
  // keeping this page's naming consistent with what staff actually assign on the roster.
  const officerRanks = [
    { name: "Cadet Colonel", abbr: "C/COL", desc: "3 Diamonds", props: { type: 'officer', count: 3 } },
    { name: "Cadet Lieutenant Colonel", abbr: "C/LTC", desc: "2 Diamonds", props: { type: 'officer', count: 2 } },
    { name: "Cadet Major", abbr: "C/MAJ", desc: "1 Diamond", props: { type: 'officer', count: 1 } },
    { name: "Cadet Captain", abbr: "C/CPT", desc: "3 Disks", props: { type: 'officer-disk', count: 3 } },
    { name: "Cadet 1st Lieutenant", abbr: "C/1LT", desc: "2 Disks", props: { type: 'officer-disk', count: 2 } },
    { name: "Cadet 2nd Lieutenant", abbr: "C/2LT", desc: "1 Disk", props: { type: 'officer-disk', count: 1 } },
  ];

  const enlistedRanks = [
    { name: "Cadet Command Sergeant Major", abbr: "C/CSM", desc: "3 Up / 3 Down / Wreath", props: { count: "3/3", hasWreath: true, hasStar: true } },
    { name: "Cadet Sergeant Major", abbr: "C/SGM", desc: "3 Up / 3 Down / Star", props: { count: "3/3", hasStar: true } },
    { name: "Cadet First Sergeant", abbr: "C/1SG", desc: "3 Up / 3 Down / Diamond", props: { count: "3/3", hasDiamond: true } },
    { name: "Cadet Master Sergeant", abbr: "C/MSG", desc: "3 Up / 3 Down", props: { count: "3/3" } },
    { name: "Cadet Sergeant First Class", abbr: "C/SFC", desc: "3 Up / 2 Down", props: { count: "3/2" } },
    { name: "Cadet Staff Sergeant", abbr: "C/SSG", desc: "3 Up / 1 Down", props: { count: "3/1" } },
    { name: "Cadet Sergeant", abbr: "C/SGT", desc: "3 Up", props: { count: "3/0" } },
    { name: "Cadet Corporal", abbr: "C/CPL", desc: "2 Up", props: { count: "2/0" } },
    { name: "Cadet Private First Class", abbr: "C/PFC", desc: "1 Up / 1 Down", props: { count: "1/1" } },
    { name: "Cadet Private", abbr: "C/PVT", desc: "1 Up", props: { count: "1/0" } },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white pt-24 pb-20 px-6 font-sans">
      <div className="max-w-7xl mx-auto">

        {/* HERO HEADER */}
        <Reveal className="text-center mb-16">
          <h1 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter mb-4">
            Cadet <span className="text-yellow-500">Info</span>
          </h1>
          <div className="flex items-center justify-center gap-4 text-slate-500 font-bold uppercase tracking-[0.4em] text-xs">
            <span>PBHS JROTC</span>
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
            <span>Est. 2006</span>
          </div>
        </Reveal>

        {/* TOP ROW: MISSION & MEANINGS */}
        <Reveal delay={0.1} className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-yellow-500 p-6 rounded-3xl text-slate-950 shadow-lg shadow-yellow-500/10">
            <h3 className="text-xs font-black uppercase mb-1 opacity-70 tracking-widest">The Mission</h3>
            <p className="text-xl font-black uppercase italic leading-tight">{content.missionText}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-6 rounded-3xl">
            <h3 className="text-xs font-black uppercase mb-2 text-yellow-500 tracking-widest">Definitions</h3>
            <div className="space-y-1 text-sm font-bold uppercase italic">
              <p><span className="text-slate-500 not-italic mr-2 text-[10px]">JROTC:</span> {content.jrotcDefinition}</p>
              <p><span className="text-slate-500 not-italic mr-2 text-[10px]">LET:</span> {content.letDefinition}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-6 rounded-3xl">
            <h3 className="text-xs font-black uppercase mb-2 text-yellow-500 tracking-widest">Leadership</h3>
            <p className="text-[11px] leading-relaxed text-slate-500 font-medium">
              {content.leadershipDefinition}
            </p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="space-y-8 lg:col-span-2">

            {/* INSIGNIA SECTION */}
            <Reveal delay={0.05}>
            <Section title="Insignia of Grade" icon={GraduationCap} color="yellow">
              <div className="space-y-10">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-6 flex items-center gap-2">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-white/10"></div>
                    Officer Ranks
                    <div className="h-px flex-1 bg-slate-200 dark:bg-white/10"></div>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                    {officerRanks.map(r => (
                      <RankItem key={r.name} name={r.name} abbr={r.abbr} description={r.desc} symbolProps={r.props} />
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-6 flex items-center gap-2">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-white/10"></div>
                    Enlisted Ranks
                    <div className="h-px flex-1 bg-slate-200 dark:bg-white/10"></div>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                    {enlistedRanks.map(r => (
                      <RankItem key={r.name} name={r.name} abbr={r.abbr} description={r.desc} symbolProps={r.props} />
                    ))}
                  </div>
                </div>
              </div>
            </Section>
            </Reveal>

            {/* THE CREED */}
            <Reveal delay={0.1}>
            <Section title="The Cadet Creed" icon={Shield} color="yellow">
              <p className="text-sm leading-relaxed italic text-slate-600 dark:text-slate-300 whitespace-pre-line border-l-2 border-yellow-500/50 pl-6 py-2">
                {content.cadetCreed}
              </p>
            </Section>
            </Reveal>

            {/* 11 PRINCIPLES */}
            <Reveal delay={0.15}>
            <Section title="11 Principles of Leadership" icon={Scale} color="blue">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {content.principles.map((p, i) => (
                  <div key={i} className="flex gap-3 text-[11px] bg-slate-100 dark:bg-black/40 p-3 rounded-xl border border-slate-200 dark:border-white/5 group hover:border-blue-500/30 transition-colors">
                    <span className="text-blue-500 font-black">{i + 1}</span>
                    <span className="text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">{p}</span>
                  </div>
                ))}
              </div>
            </Section>
            </Reveal>
          </div>

          <div className="space-y-8">
            {/* DYNAMIC BATTALION LEADERSHIP ELEMENTS */}
            <Reveal delay={0.05}>
            <Section title="Battalion Leadership" icon={Users} color="yellow">
              <div className="space-y-4">
                <div className="bg-yellow-500 p-4 rounded-2xl text-slate-950 shadow-lg">
                  <p className="text-[10px] font-black uppercase opacity-60">Battalion Commander</p>
                  <p className="text-lg font-black uppercase italic tracking-tighter">{commandStaff.bc}</p>
                </div>
                <div className="grid grid-cols-1 gap-2 text-[13px] font-black uppercase italic">
                  {[
                    { role: "XO", name: commandStaff.xo },
                    { role: "CSM", name: commandStaff.csm }
                  ].map((leader) => (
                    <div key={leader.role} className="bg-slate-100 dark:bg-black/40 p-3 rounded-xl border border-slate-200 dark:border-white/5 flex justify-between items-center group hover:border-yellow-500/30 transition-all">
                      <span className="text-slate-500 not-italic text-[9px] group-hover:text-yellow-500">{leader.role}</span>
                      <span>{leader.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
            </Reveal>

            {/* ARMY VALUES */}
            <Reveal delay={0.1}>
            <Section title="Army Values" icon={Award} color="yellow">
              <div className="space-y-3">
                {content.armyValues.map((item) => (
                  <div key={item.l} className="group">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-black text-yellow-500 group-hover:scale-110 transition-transform">{item.l}</span>
                      <span className="font-bold text-xs text-slate-900 dark:text-white uppercase tracking-wider">{item.v}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 ml-6 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">{item.d}</p>
                  </div>
                ))}
              </div>
            </Section>
            </Reveal>

            {/* INSTRUCTORS SECTION */}
            <Reveal delay={0.15}>
            <Section title="Instructors" icon={Target} color="yellow">
              <div className="space-y-2">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-100 dark:bg-black/20 flex items-center justify-between group hover:bg-slate-200 dark:hover:bg-black/40 transition-all">
                  <span className="text-[10px] text-yellow-500 font-black">SAI</span>
                  <p className="font-black uppercase italic text-sm">{instructors.sai}</p>
                </div>
                <div className="p-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-100 dark:bg-black/20 flex items-center justify-between group hover:bg-slate-200 dark:hover:bg-black/40 transition-all">
                  <span className="text-[10px] text-yellow-500 font-black">AI</span>
                  <p className="font-black uppercase italic text-sm">{instructors.ai}</p>
                </div>
              </div>
            </Section>
            </Reveal>
          </div>
        </div>

        {/* ── Promotion Board Knowledge Quiz CTA ─────────────────────────── */}
        <Reveal delay={0.12} className="mt-8">
          <div className="relative overflow-hidden bg-slate-800 dark:bg-slate-900/80 border border-white/5 rounded-3xl p-8 md:p-12 flex flex-col md:flex-row md:items-center gap-8">
            {/* Decorative */}
            <div className="absolute -top-8 -left-8 w-40 h-40 bg-yellow-500/5 rotate-45 rounded-xl pointer-events-none" />
            <div className="absolute -bottom-10 left-24 w-24 h-24 bg-yellow-500/5 rotate-45 rounded-lg pointer-events-none" />

            {/* Text */}
            <div className="flex-1 min-w-0 relative z-10">
              <p className="text-[0.65rem] font-black tracking-[0.25em] uppercase text-yellow-500 mb-3">
                Promotion Board Prep · Knowledge Quiz
              </p>
              <h2 className="text-3xl md:text-4xl font-black uppercase italic tracking-tighter text-white leading-none mb-4">
                Board<br />
                <span className="text-yellow-500">Knowledge</span>
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed max-w-md">
                Army Values, the 11 Principles of Leadership, the Cadet Creed, and JROTC fundamentals —
                all in one quiz with instant feedback on every answer.
              </p>
            </div>

            {/* Stats + button */}
            <div className="flex flex-col gap-6 relative z-10 shrink-0">
              <div className="flex gap-8">
                {[['50+', 'Questions'], ['5', 'Categories'], ['~15', 'Minutes']].map(([val, lbl]) => (
                  <div key={lbl}>
                    <div className="font-black text-2xl text-yellow-500 leading-none tabular-nums">{val}</div>
                    <div className="text-[0.6rem] font-bold tracking-[0.14em] uppercase text-slate-500 mt-1">{lbl}</div>
                  </div>
                ))}
              </div>
              <Link
                to="/knowledge-quiz"
                className="inline-flex items-center gap-2.5 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-slate-900 text-sm font-bold tracking-[0.06em] uppercase px-7 py-3.5 rounded-xl transition-colors self-start"
              >
                Start Quiz
                <ChevronRight size={15} />
              </Link>
            </div>
          </div>
        </Reveal>

        {/* ── Mindset Assessment CTA ──────────────────────────────────────── */}
        <Reveal delay={0.15} className="mt-4">
          <div className="relative overflow-hidden bg-slate-900 dark:bg-black/40 border border-white/5 rounded-3xl p-8 md:p-12 flex flex-col md:flex-row md:items-center gap-8">
            {/* Decorative diamond */}
            <div className="absolute -top-8 -right-8 w-40 h-40 bg-yellow-500/5 rotate-45 rounded-xl pointer-events-none" />
            <div className="absolute -bottom-10 right-24 w-24 h-24 bg-yellow-500/5 rotate-45 rounded-lg pointer-events-none" />

            {/* Text */}
            <div className="flex-1 min-w-0 relative z-10">
              <p className="text-[0.65rem] font-black tracking-[0.25em] uppercase text-yellow-500 mb-3">
                Leadership Development · Cadet Self-Assessment
              </p>
              <h2 className="text-3xl md:text-4xl font-black uppercase italic tracking-tighter text-white leading-none mb-4">
                Mindset<br />
                <span className="text-yellow-500">Readiness</span>
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed max-w-md">
                Your mindset is one of the most powerful weapons in your arsenal as a leader.
                Take the 14-question assessment and discover where you stand.
              </p>
            </div>

            {/* Stats + button */}
            <div className="flex flex-col gap-6 relative z-10 shrink-0">
              <div className="flex gap-8">
                {[['14', 'Questions'], ['~5', 'Minutes'], ['4', 'Outcomes']].map(([val, lbl]) => (
                  <div key={lbl}>
                    <div className="font-black text-2xl text-yellow-500 leading-none tabular-nums">{val}</div>
                    <div className="text-[0.6rem] font-bold tracking-[0.14em] uppercase text-slate-500 mt-1">{lbl}</div>
                  </div>
                ))}
              </div>
              <Link
                to="/mindset-quiz"
                className="inline-flex items-center gap-2.5 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-slate-900 text-sm font-bold tracking-[0.06em] uppercase px-7 py-3.5 rounded-xl transition-colors self-start"
              >
                Begin Assessment
                <ChevronRight size={15} />
              </Link>
            </div>
          </div>
        </Reveal>

      </div>
    </div>
  );
};

export default CadetInfo;
