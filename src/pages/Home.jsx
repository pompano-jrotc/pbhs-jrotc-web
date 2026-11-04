import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Users, Award, ArrowRight, Star, ChevronLeft, ChevronRight, Megaphone, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import { collection, doc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { BulletinCardSkeleton, TopThreeCardSkeleton } from '../components/Skeleton';
import { usePageMeta } from '../hooks/usePageMeta';
import Reveal from '../components/Reveal';
import ScrambleText from '../components/ScrambleText';
import { DEFAULT_HOME } from '../data/defaultPageContent';

// Army Values with full descriptions from official JROTC reference content.
// Short names (displayed on the card) match the long-form entry (shown in the popup).
const ARMY_VALUES = [
  { name: 'Loyalty',         full: 'Loyalty',         desc: 'Bear true faith and allegiance to the U.S. Constitution, the Army, your unit, and other soldiers.' },
  { name: 'Duty',            full: 'Duty',             desc: 'Fulfill your obligations. Do what is right even when no one is looking.' },
  { name: 'Respect',         full: 'Respect',          desc: 'Treat people as they should be treated. Dignity and respect have no rank.' },
  { name: 'Selfless Service',full: 'Selfless Service', desc: 'Put the welfare of the nation, the Army, and your subordinates before your own.' },
  { name: 'Honor',           full: 'Honor',            desc: 'Live up to all the Army Values. Honor is the "glue" that holds the values together.' },
  { name: 'Integrity',       full: 'Integrity',        desc: 'Do what is right, legally and morally. Be honest in word and deed.' },
  { name: 'Personal Courage',full: 'Personal Courage', desc: 'Face fear, danger, or adversity (physical or moral). Do what is right regardless of consequence.' },
];

const Home = () => {
  // No title override here: the root page keeps the plain "PBHS JROTC"
  // brand title (matches index.html's static tag) rather than "Home | ...".
  usePageMeta({
    description: 'Official site of the Pompano Beach High School Army JROTC Tornado Battalion - leadership, discipline, and citizenship.',
    path: '/',
  });
  const [openValueIdx, setOpenValueIdx] = useState(null);
  const [homeContent, setHomeContent] = useState(DEFAULT_HOME);
  const [topThree, setTopThree] = useState([]);
  const [topThreeLoading, setTopThreeLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);

  // slides and quickAccess come from Firestore (with DEFAULT_HOME as the fallback)
  const slides = homeContent.slides;

  // --- HOMEPAGE CONTENT (slides + quick access) ---
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "pageContent", "home"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Normalize legacy "Special Teams" label saved before the rename
        if (Array.isArray(data.quickAccess)) {
          data.quickAccess = data.quickAccess.map(c =>
            c.title === 'Special Teams' ? { ...c, title: 'Teams' } : c
          );
        }
        setHomeContent({ ...DEFAULT_HOME, ...data });
      }
    });
    return () => unsub();
  }, []);

  // --- LIVE FIRESTORE LEADERSHIP DATA FOR TOP 3 & QUOTES ---
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "leadership"), (snapshot) => {
      const leadersList = snapshot.docs
        .map(d => {
          const meta = d.data();
          if (!meta.name) return null;
          return {
            name: meta.name.toUpperCase(),
            role: meta.role ? meta.role.trim() : '',
            rank: meta.rank || '',
            company: meta.company ? meta.company.trim().toLowerCase() : '',
            image: meta.portrait || '/covers/default.webp',
            quote: meta.quote || 'Ready to lead and excel.'
          };
        })
        .filter(Boolean);

      // Helper utility to clean roles of spaces, hyphens, and casing for comparison
      const sanitizeRole = (roleStr) => {
        return roleStr.toLowerCase().replace(/[\s-_]/g, '');
      };

      // Filter down specifically to the Top 3 command elements using unified sanitization.
      // XO/Battalion XO roles must NOT have a company assignment — company Executive Officers
      // share the same role string and should not appear here.
      const filteredTopThree = leadersList.filter(l => {
        const cleanRole = sanitizeRole(l.role);
        const hasCompany = l.company && l.company !== '' && l.company !== 'none';
        return (
          cleanRole === 'battalioncommander' ||
          ((cleanRole === 'executiveofficer' || cleanRole === 'battalionxo') && !hasCompany) ||
          cleanRole === 'commandsergeantmajor'
        );
      });

      // Enforce display ordering: BC -> XO -> CSM
      filteredTopThree.sort((a, b) => {
        const cleanA = sanitizeRole(a.role);
        const cleanB = sanitizeRole(b.role);

        const getOrderWeight = (role) => {
          if (role === 'battalioncommander') return 0;
          if (role === 'executiveofficer' || role === 'battalionxo') return 1;
          if (role === 'commandsergeantmajor') return 2;
          return 3;
        };

        return getOrderWeight(cleanA) - getOrderWeight(cleanB);
      });

      setTopThree(filteredTopThree);
      setTopThreeLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
    }, 8000);
    return () => clearInterval(timer);
  }, [slides.length]);

  useEffect(() => {
    const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limit(3));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setNews(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setNewsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const nextSlide = () => setCurrentIndex(currentIndex === slides.length - 1 ? 0 : currentIndex + 1);
  const prevSlide = () => setCurrentIndex(currentIndex === 0 ? slides.length - 1 : currentIndex - 1);

  return (
    <div className="bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 min-h-screen font-sans">
      
      {/* --- HERO SLIDESHOW --- */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="absolute inset-0 z-0"
          >
            <img
              src={slides[currentIndex].url}
              alt={[slides[currentIndex].title, slides[currentIndex].subtitle].filter(Boolean).join(' ') || 'PBHS JROTC Tornado Battalion'}
              className="w-full h-full object-cover"
              fetchpriority={currentIndex === 0 ? 'high' : undefined}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/80" />
          </motion.div>
        </AnimatePresence>
        
        <div className="relative z-10 text-center px-6">
          <motion.span
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-yellow-500 font-bold tracking-[0.4em] uppercase text-xs md:text-sm mb-6 block"
          >
            <ScrambleText text="Pompano Beach High School JROTC" trigger="mount" speed={8} />
          </motion.span>
          
          {/* Reserves height for the title block so switching slides doesn't
              shift the buttons/dots below it - title+subtitle line count
              varies per slide (e.g. "BATTALION" vs "READY FOR THE
              CHALLENGE"), which was causing real layout shift (flagged by
              PageSpeed Insights as CLS 0.138 on desktop). Heights below are
              measured worst-cases across all 8 slides at each breakpoint,
              not guessed - the md tier is tallest because text-9xl barely
              fits the 768-1023px range before lg-width gives it more room. */}
          <div className="min-h-[280px] md:min-h-[550px] lg:min-h-[420px] flex items-center justify-center">
            {/* Pure opacity fade, no y-transform: PageSpeed Insights flagged
                this exact element as the CLS culprit (0.147 on desktop) -
                the Layout Instability API counts any unexpected visible
                movement between frames, including transform-driven ones,
                since this re-animates on every auto-advance (every 8s,
                no user input) rather than just once on mount. The reserved-
                height wrapper above already stops the container from
                resizing; this stops the text itself from sliding. */}
            <motion.h1
              key={slides[currentIndex].title}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-6xl md:text-9xl font-black text-white mb-6 tracking-tighter leading-none"
            >
              {slides[currentIndex].title} <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-yellow-200 to-yellow-600">
                {slides[currentIndex].subtitle}
              </span>
            </motion.h1>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-10">
            {/* Visible text stays short ("Learn More"); the sr-only span extends
                the link's actual text content so both screen readers and SEO
                crawlers see real context instead of a generic phrase. An
                aria-label alone would fix accessibility but Lighthouse's SEO
                link-text check reads DOM textContent, not the accessible name. */}
            <Link to="/about" className="bg-yellow-500 text-slate-950 px-8 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-yellow-400 transition-colors shadow-lg shadow-yellow-500/20">
              Learn More <span className="sr-only">about PBHS JROTC</span>
            </Link>
            <Link to="/teams" className="bg-white/10 border border-white/20 text-white px-8 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-white/20 transition-colors backdrop-blur-sm">
              Battalion Teams
            </Link>
          </div>
        </div>
        <button onClick={prevSlide} aria-label="Previous slide" className="absolute left-6 z-20 p-2 text-white/30 hover:text-yellow-500 transition-colors hidden md:block">
          <ChevronLeft size={48} />
        </button>
        <button onClick={nextSlide} aria-label="Next slide" className="absolute right-6 z-20 p-2 text-white/30 hover:text-yellow-500 transition-colors hidden md:block">
          <ChevronRight size={48} />
        </button>
        <div className="absolute bottom-10 flex gap-2 z-20">
          {slides.map((slide, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              aria-label={`Go to slide ${i + 1}: ${slide.title}`}
              aria-current={i === currentIndex ? "true" : undefined}
              className={`h-1.5 transition-all duration-500 rounded-full ${i === currentIndex ? "w-12 bg-yellow-500" : "w-4 bg-white/20"}`}
            />
          ))}
        </div>
      </section>

      {/* --- LIVE BULLETINS ---
          Rendered while loading (as skeletons) as well as once populated,
          not just when news.length > 0 - mounting this whole section only
          after the Firestore fetch resolves was a real layout-shift source
          (PageSpeed flagged CLS 0.147 on desktop): everything below it
          jumped down the instant announcements loaded in. Reserving the
          section's space from first paint eliminates that. */}
      {(newsLoading || news.length > 0) && (
        <section className="py-12 bg-slate-100 dark:bg-slate-900/50 border-y border-slate-200 dark:border-white/5">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex items-center gap-3 mb-8">
              <Megaphone className="text-yellow-500" size={20} />
              <h2 className="text-xs font-black uppercase tracking-[0.3em] text-slate-900 dark:text-white">Battalion Bulletins</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {newsLoading ? (
                <>
                  <BulletinCardSkeleton />
                  <BulletinCardSkeleton />
                  <BulletinCardSkeleton />
                </>
              ) : (
                news.map((item) => (
                  <div key={item.id} className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/5 p-6 rounded-2xl">
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-3 font-bold uppercase tracking-widest">
                      <Clock size={12} />
                      {item.timestamp?.toDate().toLocaleDateString() || "Active Order"}
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed mb-4">{item.content}</p>
                    <div className="text-yellow-500/40 text-[9px] font-black uppercase tracking-widest">Signed: {item.issuer || 'Battalion Staff'}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* --- ARMY VALUES --- */}
      <section className="py-24 bg-white dark:bg-slate-900 text-slate-950 dark:text-white">
        <Reveal className="max-w-7xl mx-auto px-6 text-center">
          <h2 className="text-[10px] font-black tracking-[0.5em] text-slate-600 dark:text-slate-400 uppercase mb-4">
            <ScrambleText text="The Seven Army Values" trigger="inView" />
          </h2>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-12">Select a value to expand</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
            {ARMY_VALUES.map((val, i) => (
              <button
                key={i}
                onClick={() => setOpenValueIdx(prev => prev === i ? null : i)}
                aria-expanded={openValueIdx === i}
                aria-label={`${openValueIdx === i ? 'Collapse' : 'Expand'} ${val.name}`}
                className={`group border p-5 flex flex-col items-center transition-all duration-200 rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500 ${
                  openValueIdx === i
                    ? 'bg-slate-950 dark:bg-yellow-500 text-white dark:text-slate-950 border-slate-950 dark:border-yellow-500'
                    : 'border-slate-100 dark:border-slate-800 text-slate-950 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-600'
                }`}
              >
                <Star
                  className={`mb-3 transition-transform duration-200 text-yellow-500 ${openValueIdx === i ? 'scale-110' : 'group-hover:scale-110'}`}
                  size={18}
                />
                <span className="text-[10px] font-black uppercase tracking-widest leading-snug">{val.name}</span>
              </button>
            ))}
          </div>

          {/* Inline expansion panel — no overlay, no backdrop, instant feel */}
          <AnimatePresence mode="wait">
            {openValueIdx !== null && (
              <motion.div
                key={openValueIdx}
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden text-left"
              >
                <div className="bg-slate-950 text-white rounded-2xl px-7 py-6 flex items-center gap-5">
                  <div className="p-3 bg-yellow-500/10 rounded-xl shrink-0">
                    <Star className="text-yellow-500" size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Army Value</p>
                    <h3 className="text-lg font-black uppercase italic tracking-tight text-white mb-1">
                      {ARMY_VALUES[openValueIdx].full}
                    </h3>
                    <p className="text-slate-300 text-sm leading-relaxed">{ARMY_VALUES[openValueIdx].desc}</p>
                  </div>
                  <div className="ml-auto text-[9px] font-black uppercase tracking-widest text-slate-700 hidden lg:block shrink-0 self-center">
                    L · D · R · S · H · I · PC
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Reveal>
      </section>

      {/* --- TOP 3 COMMAND SECTION --- */}
      <section className="py-24 bg-slate-100 dark:bg-slate-950 border-t border-slate-200 dark:border-white/5 overflow-hidden">
        <Reveal className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-[10px] font-black tracking-[0.5em] text-yellow-500 uppercase mb-4">
              <ScrambleText text="Battalion Command" trigger="inView" />
            </h2>
            <h3 className="text-4xl md:text-5xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">Meet the Top 3</h3>
          </div>
          {/* Same reasoning as Battalion Bulletins above: skeleton cards
              while topThree is still loading reserve this grid's real
              height from first paint, instead of the grid collapsing to
              0px and then jumping to full card height once Firestore's
              leadership data arrives. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {topThreeLoading ? (
              <>
                <TopThreeCardSkeleton />
                <TopThreeCardSkeleton />
                <TopThreeCardSkeleton />
              </>
            ) : topThree.map((leader, i) => (
              <motion.div 
                key={i}
                whileHover={{ y: -10 }}
                className="group relative"
              >
                <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-300 dark:bg-slate-900 relative mb-6">
                  <img 
                    src={leader.image} 
                    alt={leader.name}
                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    loading="lazy" 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60" />
                </div>
                <div className="space-y-1 mb-4 text-center sm:text-left">
                  <h4 className="text-slate-900 dark:text-white font-black uppercase text-lg italic leading-tight tracking-tight">
                    {leader.name}
                  </h4>
                  <p className="text-yellow-500 font-bold uppercase text-[10px] tracking-widest">
                    {leader.rank} {leader.role ? `(${leader.role})` : ''}
                  </p>
                </div>
                <div className="relative">
                  <span className="text-4xl text-yellow-500/20 font-serif absolute -top-4 -left-2">"</span>
                  <p className="text-slate-500 dark:text-slate-400 text-xs italic leading-relaxed pl-4 border-l border-yellow-500/20">
                    {leader.quote}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* --- QUICK ACCESS --- */}
      {/* Icons are structural (non-editable content) — fixed by position */}
      <section className="py-32 max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-slate-200 dark:border-white/5">
        {homeContent.quickAccess.map((card, i) => {
          const ICONS = [<Shield />, <Users />, <Award />];
          return (
            <Reveal key={i} delay={i * 0.1}>
              <InfoCard icon={ICONS[i] || <Shield />} title={card.title} desc={card.desc} link={card.link} />
            </Reveal>
          );
        })}
      </section>
    </div>
  );
};

const InfoCard = ({ icon, title, desc, link }) => (
  <Link to={link} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 p-10 rounded-3xl hover:border-yellow-500/40 transition-all block group relative shadow-sm dark:shadow-none">
    <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity text-yellow-500">
      <ArrowRight size={20} />
    </div>
    <div className="mb-6 p-4 bg-yellow-500/5 text-yellow-500 rounded-xl w-fit group-hover:bg-yellow-500 group-hover:text-slate-950 transition-colors">
      {icon}
    </div>
    <h3 className="text-2xl font-black uppercase italic mb-4 text-slate-900 dark:text-white">{title}</h3>
    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{desc}</p>
  </Link>
);

export default Home;