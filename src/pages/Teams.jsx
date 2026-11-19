import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import {
  Crosshair, Shield, Flag, Trophy, Target,
  ChevronRight, Clock, MapPin
} from 'lucide-react';
import { TeamsPageSkeleton } from '../components/Skeleton';
import { usePageMeta } from '../hooks/usePageMeta';
import Reveal from '../components/Reveal';
import ScrambleText from '../components/ScrambleText';

const Teams = () => {
  usePageMeta({
    title: 'Teams',
    description: 'Extracurricular battalion teams - Drill, Raiders, Color Guard, and more. See schedules and joining requirements.',
    path: '/teams',
  });
  const [activeTeam, setActiveTeam] = useState(null);
  const [teamsData, setTeamsData] = useState({});
  const [loading, setLoading] = useState(true);

  // Map icons to strings stored in Database
  const iconMap = {
    Shield: <Shield className="text-yellow-500" size={32} />,
    Trophy: <Trophy className="text-orange-500" size={32} />,
    Flag: <Flag className="text-blue-500" size={32} />,
    Crosshair: <Crosshair className="text-red-500" size={32} />,
    Target: <Target className="text-purple-500" size={32} />,
  };

  useEffect(() => {
    // Listen to the 'specialTeams' collection in Firestore
    const q = query(collection(db, "specialTeams"), orderBy("name", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const teams = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        // We use the name as the key for the state object
        teams[data.name] = {
          id: doc.id, // This captures 'drones-team'
          ...data,
          icon: iconMap[data.iconName] || <Shield size={32} />
        };
      });

      setTeamsData(teams);

      // Set the first team as active if none is selected
      if (snapshot.docs.length > 0 && !activeTeam) {
        setActiveTeam(snapshot.docs[0].data().name);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const currentTeam = teamsData[activeTeam];


  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pt-32 pb-20 px-6 text-left font-sans">
      <div className="max-w-6xl mx-auto">

        <Reveal>
        <header className="mb-12">
          <h2 className="text-xs font-black text-yellow-500 tracking-[0.4em] uppercase mb-4"><ScrambleText text="Extracurricular Activites" trigger="mount" speed={20} /></h2>
          <h1 className="text-5xl md:text-7xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter font-military">
            <ScrambleText text="Teams" trigger="mount" />
          </h1>
        </header>
        </Reveal>

        {loading ? (
          <TeamsPageSkeleton />
        ) : (
        <div className="grid lg:grid-cols-4 gap-8">

          {/* Sidebar Navigation */}
          <div className="space-y-2">
            {Object.keys(teamsData).map((team) => (
              <button
                key={team}
                onClick={() => setActiveTeam(team)}
                className={`w-full p-4 rounded-xl border text-left transition-all flex items-center justify-between group ${
                  activeTeam === team
                  ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                  : 'bg-white dark:bg-slate-900/50 border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <span className="font-black uppercase italic tracking-wider text-sm">{team}</span>
                <ChevronRight size={16} className={activeTeam === team ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 transition-opacity'} />
              </button>
            ))}
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-3">
            <AnimatePresence mode="wait">
              {currentTeam && (
                <motion.div
                  key={activeTeam}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 p-8 rounded-3xl border-t-4 shadow-lg dark:shadow-2xl relative overflow-hidden ${currentTeam.color}`}
                >
                  {/* Status Badge */}
                  <div className={`absolute top-6 right-8 px-3 py-1 rounded-full border border-slate-200 dark:border-white/10 flex items-center gap-2 text-[10px] font-black uppercase tracking-tighter ${currentTeam.statusColor}`}>
                    {currentTeam.status}
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8">
                    {currentTeam.photo ? (
                      <img
                        src={currentTeam.photo}
                        alt={`${activeTeam} team photo`}
                        className="w-20 h-20 rounded-2xl object-cover border border-slate-200 dark:border-white/10 shrink-0"
                      />
                    ) : (
                      <div className="p-4 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-2xl w-fit">
                        {currentTeam.icon}
                      </div>
                    )}
                    <div>
                      <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight">{activeTeam}</h3>
                      <p className="text-yellow-500/80 text-[10px] font-bold uppercase tracking-widest mb-1">{currentTeam.seasonText}</p>
                      <p className="text-slate-500 dark:text-slate-400 text-sm max-w-xl leading-relaxed">{currentTeam.description}</p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <div>
                        <h4 className="text-[10px] font-black text-yellow-500 uppercase tracking-[0.2em] mb-3">Schedule & Intel</h4>
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-xs">
                            <Clock size={14} className="text-slate-400 dark:text-slate-500" /> {currentTeam.practice}
                          </div>
                          <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-xs">
                            <MapPin size={14} className="text-slate-400 dark:text-slate-500" /> {currentTeam.location}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[10px] font-black text-yellow-500 uppercase tracking-[0.2em] mb-3">Core Disciplines</h4>
                        <div className="flex flex-wrap gap-2">
                          {currentTeam.highlights?.map((h, i) => (
                            <span key={i} className="px-3 py-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/5 rounded-full text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase">
                              {h}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-100 dark:bg-slate-950/50 rounded-2xl p-6 border border-slate-200 dark:border-white/5">
                      <h4 className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-[0.2em] mb-4">Joining Requirements</h4>
                      <ul className="space-y-3">
                        {currentTeam.requirements?.map((req, i) => (
                          <li key={i} className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-xs">
                            <div className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                            {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default Teams;
