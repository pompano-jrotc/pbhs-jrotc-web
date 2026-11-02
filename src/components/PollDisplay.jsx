import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import { BarChart2, CheckCircle2, Eye, Users, ChevronDown, ChevronUp } from 'lucide-react';

const PollDisplay = ({ poll, announcementId, collectionName = 'announcements' }) => {
  const { user, role, userData } = useAuth();
  const userId    = user?.uid;
  const userPower = ROLE_HIERARCHY[role] || 1;
  const isStaff   = userPower >= STAFF_LEVEL;

  // undefined=loading, null=hasn't voted, string[]=voted option IDs
  const [myVote,       setMyVote]       = useState(undefined);
  const [selected,     setSelected]     = useState([]);
  const [votes,        setVotes]        = useState(null);
  const [voting,       setVoting]       = useState(false);
  const [voteErr,      setVoteErr]      = useState('');
  const [peekResults,  setPeekResults]  = useState(false);
  const [showVoters,   setShowVoters]   = useState(false);

  // Check if current user has already voted
  useEffect(() => {
    if (!userId) { setMyVote(null); return; }
    getDoc(doc(db, 'pollVotes', `${announcementId}_${userId}`))
      .then(snap => setMyVote(snap.exists() ? snap.data().optionIds : null))
      .catch(() => setMyVote(null));
  }, [userId, announcementId]);

  const hasVoted    = Array.isArray(myVote);
  // Staff always see results after voting (even if resultsVisibility='never').
  // Staff may also peek at results before voting via the peekResults toggle.
  const showResults = (hasVoted && (poll.resultsVisibility !== 'never' || isStaff))
    || poll.resultsVisibility === 'always'
    || (isStaff && peekResults);

  // Subscribe to all votes for this poll when results need to be shown
  useEffect(() => {
    if (!showResults) return;
    const q = query(collection(db, 'pollVotes'), where('pollId', '==', announcementId));
    return onSnapshot(q, snap => setVotes(snap.docs.map(d => d.data())));
  }, [showResults, announcementId]);

  const toggleOption = (id) => {
    if (poll.type === 'single') {
      setSelected([id]);
    } else {
      setSelected(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      );
    }
  };

  const submitVote = async () => {
    if (!userId || !selected.length || voting) return;
    setVoting(true);
    setVoteErr('');
    try {
      await setDoc(doc(db, 'pollVotes', `${announcementId}_${userId}`), {
        pollId: announcementId,
        collectionName,
        userId,
        voterName: userData?.fullName || '',
        optionIds: selected,
        timestamp: serverTimestamp(),
      });
      setMyVote(selected);
    } catch {
      setVoteErr('Vote failed — try again.');
    }
    setVoting(false);
  };

  // Compute tallies from loaded votes
  const tallies = {};
  const totalVoters = votes ? votes.length : 0;
  if (votes) {
    votes.forEach(v => {
      v.optionIds.forEach(id => { tallies[id] = (tallies[id] || 0) + 1; });
    });
  }

  if (myVote === undefined) return null; // still loading vote status

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5">
      <div className="flex items-center gap-2 mb-3">
        <BarChart2 size={13} className="text-yellow-500 shrink-0" />
        <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Poll</p>
        {votes !== null && totalVoters > 0 && (
          <span className="text-[9px] font-black text-slate-400 dark:text-slate-500">
            {totalVoters} response{totalVoters !== 1 ? 's' : ''}
          </span>
        )}
        {isStaff && !hasVoted && poll.resultsVisibility !== 'always' && (
          <button
            onClick={() => setPeekResults(p => !p)}
            className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors"
          >
            <Eye size={10} /> {peekResults ? 'Vote' : 'Results'}
          </button>
        )}
        {isStaff && !poll.anonymous && votes !== null && totalVoters > 0 && (hasVoted || peekResults) && (
          <button
            onClick={() => setShowVoters(v => !v)}
            className={`${(!hasVoted && !peekResults) ? 'ml-auto' : ''} flex items-center gap-1 text-[9px] font-black uppercase tracking-widest transition-colors ${showVoters ? 'text-yellow-500' : 'text-slate-400 hover:text-yellow-500'}`}
          >
            <Users size={10} /> {showVoters ? 'Hide' : 'Who Voted'}
            {showVoters ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          </button>
        )}
        {hasVoted && votes !== null && totalVoters === 0 && (
          <span className="ml-auto text-[9px] font-black text-slate-400 dark:text-slate-500">0 responses yet</span>
        )}
      </div>

      <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">{poll.question}</p>

      <div className="space-y-2">
        {poll.options.map((opt, i) => {
          const count   = tallies[opt.id] || 0;
          const pct     = totalVoters > 0 ? Math.round((count / totalVoters) * 100) : 0;
          const isMyPick = hasVoted && myVote.includes(opt.id);

          if (showResults && votes !== null && (hasVoted || peekResults || poll.resultsVisibility === 'always')) {
            return (
              <div
                key={opt.id}
                className={`relative rounded-xl overflow-hidden border transition-all ${isMyPick ? 'border-yellow-500/50' : 'border-slate-200 dark:border-white/5'}`}
              >
                <div
                  className={`absolute inset-y-0 left-0 transition-all duration-700 ${isMyPick ? 'bg-yellow-500/20' : 'bg-slate-100 dark:bg-white/5'}`}
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex items-center gap-3 px-3 py-2.5">
                  <span className="text-[9px] font-black text-slate-400 w-4 shrink-0 text-center">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{opt.text}</span>
                  {isMyPick && <CheckCircle2 size={12} className="text-yellow-500 shrink-0" />}
                  <span className={`text-[10px] font-black shrink-0 ${isMyPick ? 'text-yellow-500' : 'text-slate-400 dark:text-slate-500'}`}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          }

          // Voting interface
          const isSelected = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => !hasVoted && userId && toggleOption(opt.id)}
              disabled={hasVoted || !userId}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-yellow-500 bg-yellow-500/10'
                  : 'border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 hover:border-yellow-500/40 disabled:opacity-60 disabled:cursor-default'
              }`}
            >
              <span className="text-[9px] font-black text-slate-400 w-4 shrink-0 text-center">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{opt.text}</span>
              {poll.type === 'multi' ? (
                <span className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-all ${isSelected ? 'border-yellow-500 bg-yellow-500' : 'border-slate-300 dark:border-white/20'}`}>
                  {isSelected && <span className="text-white text-[8px] font-black leading-none">✓</span>}
                </span>
              ) : (
                <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${isSelected ? 'border-yellow-500' : 'border-slate-300 dark:border-white/20'}`}>
                  {isSelected && <span className="block w-2 h-2 rounded-full bg-yellow-500" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Staff voter list ── */}
      {isStaff && !poll.anonymous && showVoters && votes !== null && (
        <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
          {poll.options.map((opt, i) => {
            const optVoters = votes.filter(v => v.optionIds.includes(opt.id));
            if (optVoters.length === 0) return null;
            return (
              <div key={opt.id} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                <p className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-white/[0.02]">
                  {String.fromCharCode(65 + i)}: {opt.text} — {optVoters.length}
                </p>
                <div className="px-3 py-2 flex flex-wrap gap-1.5">
                  {optVoters.map(v => (
                    <span key={v.userId} className="text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md">
                      {v.voterName || v.userId}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {totalVoters === 0 && (
            <p className="px-3 py-3 text-[10px] text-slate-400 text-center">No votes yet</p>
          )}
        </div>
      )}

      {/* Submit / sign-in nudge / voted confirmation */}
      {!hasVoted && (
        !userId ? (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold mt-3 text-center">
            Sign in to vote
          </p>
        ) : (
          <div className="mt-3 space-y-1">
            <button
              type="button"
              onClick={submitVote}
              disabled={!selected.length || voting}
              className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black py-2.5 rounded-xl uppercase tracking-widest text-[10px] transition-all"
            >
              {voting ? 'Submitting…' : 'Submit Vote'}
            </button>
            {voteErr && <p className="text-[10px] text-red-500 text-center">{voteErr}</p>}
          </div>
        )
      )}

      {hasVoted && poll.resultsVisibility === 'never' && !isStaff && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold mt-3 text-center flex items-center justify-center gap-1.5">
          <CheckCircle2 size={10} className="text-yellow-500" /> Vote recorded
        </p>
      )}

      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-2.5">
        {poll.type === 'multi' ? 'Select all that apply' : 'Select one'}
        {' · '}
        {poll.anonymous ? 'Anonymous' : 'Responses attributed'}
      </p>
    </div>
  );
};

export default PollDisplay;
