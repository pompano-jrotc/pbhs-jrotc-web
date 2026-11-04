// src/pages/RecommendRibbon.jsx
// Public ribbon recommendation portal — anyone (guests + logged-in) can
// recommend a cadet for a ribbon. Logged-in users are pre-filled.

import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import { collection, getDocs, addDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Shield, Award, CheckCircle, Search, User, ChevronDown, Loader2, X } from 'lucide-react';

const RELATIONS = [
  { value: 'parent',    label: 'Parent / Guardian' },
  { value: 'peer',      label: 'Fellow Cadet'       },
  { value: 'staff',     label: 'Faculty / Staff'    },
  { value: 'community', label: 'Community Member'   },
  { value: 'other',     label: 'Other'              },
];

const RecommendRibbon = () => {
  const { user, userData } = useAuth();

  // ── Data loaders ─────────────────────────────────────────────────────────────
  const [ribbonTypes, setRibbonTypes] = useState([]);
  const [roster,      setRoster]      = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getDocs(collection(db, 'ribbonTypes')),
      getDocs(collection(db, 'roster')),
    ]).then(([rtSnap, rSnap]) => {
      if (cancelled) return;
      setRibbonTypes(rtSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      const active = rSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => !['alumni', 'inactive', 'archived'].includes(c.status))
        .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
      setRoster(active);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoadingData(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Form state ────────────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState('');
  const [selectedCadet,  setSelectedCadet]  = useState(null);
  const [selectedRibbon, setSelectedRibbon] = useState(null);
  const [reason,         setReason]         = useState('');
  const [recommenderName,  setRecommenderName]  = useState('');
  const [recommenderEmail, setRecommenderEmail] = useState('');
  const [relation,         setRelation]         = useState('');

  // Pre-fill for logged-in users
  useEffect(() => {
    if (userData?.fullName)  setRecommenderName(userData.fullName);
    if (user?.email)         setRecommenderEmail(user.email);
    if (!relation)           setRelation('peer');
  }, [userData?.fullName, user?.email]); // eslint-disable-line

  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState(null);
  const [cadetOpen,  setCadetOpen]  = useState(false);
  const [ribbonOpen, setRibbonOpen] = useState(false);

  // ── Filtered cadet list ───────────────────────────────────────────────────────
  const filteredCadets = useMemo(() => {
    if (!search.trim()) return roster;
    const q = search.toLowerCase();
    return roster.filter(c =>
      (c.fullName || '').toLowerCase().includes(q) ||
      (c.company  || '').toLowerCase().includes(q) ||
      (c.rank     || '').toLowerCase().includes(q)
    );
  }, [roster, search]);

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCadet)        { setError('Please select a cadet.'); return; }
    if (!selectedRibbon)       { setError('Please select a ribbon.'); return; }
    if (!reason.trim())        { setError('Please describe why this cadet deserves this ribbon.'); return; }
    if (!recommenderName.trim()) { setError('Your name is required.'); return; }
    if (!relation)             { setError('Please select your relation to the cadet.'); return; }

    setSubmitting(true);
    setError(null);
    try {
      await addDoc(collection(db, 'ribbonRecommendations'), {
        rosterDocId:      selectedCadet.id,
        cadetDisplayName: selectedCadet.fullName || '',
        cadetCompany:     selectedCadet.company  || '',
        ribbonTypeId:     selectedRibbon.id,
        ribbonName:       selectedRibbon.name,
        ribbonCode:       selectedRibbon.code || '',
        reason:           reason.trim(),
        recommenderName:  recommenderName.trim(),
        recommenderEmail: recommenderEmail.trim() || null,
        recommenderRelation: relation,
        submittedByUid:   user?.uid || null,
        status:           'pending',
        createdAt:        serverTimestamp(),
        reviewedByUid:    null,
        reviewedByName:   null,
        reviewedAt:       null,
        convertedToAwardId: null,
      });
      setSubmitted(true);
    } catch (err) {
      setError('Something went wrong — please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedCadet(null);
    setSelectedRibbon(null);
    setReason('');
    setSearch('');
    setSubmitted(false);
    setError(null);
  };

  // ── Input class ───────────────────────────────────────────────────────────────
  const inputCls = 'w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40';

  return (
    <div className="min-h-screen bg-[#0a0c12] text-white">
      <Navbar />

      {/* ── Hero ── */}
      <section className="pt-32 pb-16 px-6 md:px-14 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-[10px] font-black uppercase tracking-widest mb-6">
          <Award size={12} /> Ribbon Recommendation Portal
        </div>
        <h1 className="text-4xl md:text-5xl font-black uppercase italic tracking-tighter leading-none mb-4">
          Recognize a <span className="text-yellow-500">Cadet</span>
        </h1>
        <p className="text-slate-400 text-base leading-relaxed max-w-xl mx-auto">
          Submit a recommendation for a PBHS JROTC cadet to receive a ribbon award.
          Battalion staff will review all submissions.
        </p>
      </section>

      {/* ── Main content ── */}
      <section className="pb-24 px-6 md:px-14 max-w-2xl mx-auto">
        {submitted ? (
          /* ── Success state ── */
          <div className="bg-slate-900 border border-white/10 rounded-3xl p-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="text-emerald-400" size={32} />
            </div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white mb-3">
              Recommendation Submitted
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-2">
              Your recommendation for <span className="text-white font-black">{selectedCadet?.fullName}</span> to receive the{' '}
              <span className="text-yellow-400 font-black">{selectedRibbon?.name}</span> has been submitted.
            </p>
            <p className="text-slate-500 text-xs mb-8">
              Battalion staff will review it and take action. Thank you for recognizing our cadets.
            </p>
            <button
              onClick={resetForm}
              className="px-8 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black uppercase text-xs tracking-widest transition-all"
            >
              Submit Another
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* ── Cadet selection ── */}
            <div className="bg-slate-900 border border-white/10 rounded-3xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <User size={15} className="text-yellow-500" />
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Who are you recommending?
                </h2>
              </div>

              {loadingData ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                  <Loader2 size={14} className="animate-spin" /> Loading cadet roster…
                </div>
              ) : selectedCadet ? (
                <div className="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 rounded-2xl px-4 py-3">
                  <div>
                    <p className="text-sm font-black text-white">{selectedCadet.fullName}</p>
                    <p className="text-[10px] text-yellow-500 uppercase tracking-widest">
                      {selectedCadet.rank}{selectedCadet.rank && selectedCadet.company ? ' · ' : ''}{selectedCadet.company ? `${selectedCadet.company} Co.` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => setSelectedCadet(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search by name or company…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/10 bg-slate-800/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                    {filteredCadets.length === 0 ? (
                      <p className="text-slate-500 text-xs p-4 text-center italic">No cadets found</p>
                    ) : filteredCadets.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setSelectedCadet(c); setSearch(''); }}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors text-left"
                      >
                        <div>
                          <p className="text-sm font-bold text-white">{c.fullName}</p>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                            {c.rank}{c.rank && c.company ? ' · ' : ''}{c.company ? `${c.company} Co.` : ''}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Ribbon selection ── */}
            <div className="bg-slate-900 border border-white/10 rounded-3xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Award size={15} className="text-yellow-500" />
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Which ribbon?
                </h2>
              </div>

              {loadingData ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                  <Loader2 size={14} className="animate-spin" /> Loading ribbons…
                </div>
              ) : selectedRibbon ? (
                <div className="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 rounded-2xl px-4 py-3">
                  <div>
                    <p className="text-sm font-black text-white">{selectedRibbon.name}</p>
                    {selectedRibbon.code && (
                      <p className="text-[10px] text-yellow-500 uppercase tracking-widest">{selectedRibbon.code}</p>
                    )}
                    {selectedRibbon.description && (
                      <p className="text-[10px] text-slate-500 mt-0.5">{selectedRibbon.description}</p>
                    )}
                  </div>
                  <button type="button" onClick={() => setSelectedRibbon(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {ribbonTypes.length === 0 ? (
                    <p className="text-slate-500 text-xs italic">No ribbon types defined yet.</p>
                  ) : ribbonTypes.map(rt => (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => setSelectedRibbon(rt)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-2xl border border-white/5 hover:border-yellow-500/30 hover:bg-yellow-500/5 transition-all text-left"
                    >
                      <div>
                        <p className="text-sm font-bold text-white">{rt.name}</p>
                        {rt.code && <p className="text-[10px] text-slate-500 uppercase tracking-wider">{rt.code}</p>}
                        {rt.description && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{rt.description}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Reason ── */}
            <div className="bg-slate-900 border border-white/10 rounded-3xl p-6">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4">
                Why does this cadet deserve this ribbon? <span className="text-red-400">*</span>
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={4}
                placeholder="Describe the specific actions, character, or achievements that merit this recognition…"
                className="w-full rounded-xl border border-white/10 bg-slate-800/50 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 resize-none"
              />
              <p className="text-[10px] text-slate-600 mt-2">Minimum detail helps staff make an informed decision.</p>
            </div>

            {/* ── Your info ── */}
            <div className="bg-slate-900 border border-white/10 rounded-3xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Shield size={15} className="text-yellow-500" />
                <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  About you
                </h2>
                {user && (
                  <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    Signed in
                  </span>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                    Your Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={recommenderName}
                    onChange={e => setRecommenderName(e.target.value)}
                    placeholder="Full name"
                    className="w-full rounded-xl border border-white/10 bg-slate-800/50 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                    Email <span className="text-slate-600">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={recommenderEmail}
                    onChange={e => setRecommenderEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full rounded-xl border border-white/10 bg-slate-800/50 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                    Your relation to the cadet <span className="text-red-400">*</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {RELATIONS.map(r => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setRelation(r.value)}
                        className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          relation === r.value
                            ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                            : 'border-white/10 text-slate-400 hover:text-white hover:border-white/20'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-xs font-bold text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || loadingData}
              className="w-full py-4 rounded-2xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 font-black uppercase text-sm tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-yellow-500/20"
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> Submitting…</>
                : <><Award size={16} /> Submit Recommendation</>
              }
            </button>

            <p className="text-center text-[10px] text-slate-600 uppercase tracking-widest">
              All recommendations are reviewed by battalion staff before any award is made.
            </p>
          </form>
        )}
      </section>

      <Footer />
    </div>
  );
};

export default RecommendRibbon;
