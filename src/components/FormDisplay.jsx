import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import { ClipboardList, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

const FormDisplay = ({ form, announcementId, collectionName = 'announcements' }) => {
  const { user, role, userData } = useAuth();
  const userId    = user?.uid;
  const userPower = ROLE_HIERARCHY[role] || 1;
  const isStaff   = userPower >= STAFF_LEVEL;

  // undefined=loading, null=not submitted, object=submitted response data
  const [myResponse,     setMyResponse]     = useState(undefined);
  const [answers,        setAnswers]        = useState({});
  const [submitting,     setSubmitting]     = useState(false);
  const [submitErr,      setSubmitErr]      = useState('');
  const [showResponses,  setShowResponses]  = useState(false);
  const [allResponses,   setAllResponses]   = useState(null);

  // Check if user has already submitted
  useEffect(() => {
    if (!userId) { setMyResponse(null); return; }
    getDoc(doc(db, 'formResponses', `${announcementId}_${userId}`))
      .then(snap => setMyResponse(snap.exists() ? snap.data() : null))
      .catch(() => setMyResponse(null));
  }, [userId, announcementId]);

  // Load all responses when staff opens the panel
  useEffect(() => {
    if (!showResponses || !isStaff) return;
    const q = query(collection(db, 'formResponses'), where('announcementId', '==', announcementId));
    return onSnapshot(q, snap => setAllResponses(snap.docs.map(d => d.data())));
  }, [showResponses, isStaff, announcementId]);

  const setAnswer = (qId, val) => setAnswers(prev => ({ ...prev, [qId]: val }));

  const toggleCheckbox = (qId, optId) => {
    setAnswers(prev => {
      const curr = Array.isArray(prev[qId]) ? prev[qId] : [];
      return { ...prev, [qId]: curr.includes(optId) ? curr.filter(x => x !== optId) : [...curr, optId] };
    });
  };

  const handleSubmit = async () => {
    if (!userId || submitting) return;
    for (const q of form.questions) {
      if (!q.required) continue;
      const ans = answers[q.id];
      const empty = !ans || (Array.isArray(ans) && ans.length === 0) || (typeof ans === 'string' && !ans.trim());
      if (empty) {
        setSubmitErr(`"${q.text || `Question ${form.questions.indexOf(q) + 1}`}" is required.`);
        return;
      }
    }
    setSubmitting(true);
    setSubmitErr('');
    try {
      const displayName = !form.anonymous
        ? `${userData?.rank || ''} ${userData?.fullName || user.displayName || ''}`.trim() || undefined
        : undefined;
      const data = {
        announcementId,
        collectionName,
        userId,
        ...(displayName && { displayName }),
        answers,
        timestamp: serverTimestamp(),
      };
      await setDoc(doc(db, 'formResponses', `${announcementId}_${userId}`), data);
      setMyResponse(data);
    } catch {
      setSubmitErr('Submission failed — try again.');
    }
    setSubmitting(false);
  };

  const getOptText = (q, optId) => q.options?.find(o => o.id === optId)?.text || optId;

  const renderAnswerText = (q, ans) => {
    if (!ans && ans !== 0) return null;
    return Array.isArray(ans) ? ans.map(id => getOptText(q, id)).join(', ') : ans;
  };

  if (myResponse === undefined) return null;

  const hasSubmitted = myResponse !== null;

  return (
    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={13} className="text-yellow-500 shrink-0" />
          <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Form</p>
          {hasSubmitted && (
            <span className="flex items-center gap-1 text-[9px] font-black text-green-600 dark:text-green-400">
              <CheckCircle2 size={9} /> Submitted
            </span>
          )}
        </div>
        {isStaff && (
          <button
            type="button"
            onClick={() => setShowResponses(v => !v)}
            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors"
          >
            Responses{allResponses !== null ? ` (${allResponses.length})` : ''}
            {showResponses ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        )}
      </div>

      {/* Staff: all responses panel */}
      {showResponses && isStaff && (
        <div className="mb-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-950 p-3 space-y-3">
          {allResponses === null ? (
            <p className="text-[10px] text-slate-400 text-center py-2">Loading…</p>
          ) : allResponses.length === 0 ? (
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center py-2">No responses yet</p>
          ) : (
            allResponses.map((r, ri) => (
              <div key={ri} className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200 dark:border-white/5 space-y-2">
                {!form.anonymous && r.displayName && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-yellow-500">{r.displayName}</p>
                )}
                {form.questions.map(q => {
                  const display = renderAnswerText(q, r.answers?.[q.id]);
                  if (!display) return null;
                  return (
                    <div key={q.id}>
                      <p className="text-[9px] font-black text-slate-500 dark:text-slate-400">{q.text}</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{display}</p>
                    </div>
                  );
                })}
                {r.timestamp?.toDate && (
                  <p className="text-[8px] text-slate-400 dark:text-slate-600 font-bold">
                    {r.timestamp.toDate().toLocaleString()}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* My submitted answers */}
      {hasSubmitted && (
        <div className="space-y-2">
          {form.questions.map((q, qi) => {
            const display = renderAnswerText(q, myResponse.answers?.[q.id]);
            if (!display) return null;
            return (
              <div key={q.id} className="bg-slate-50 dark:bg-slate-950 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-white/5">
                <p className="text-[9px] font-black text-slate-500 dark:text-slate-400 mb-0.5">{q.text || `Q${qi + 1}`}</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{display}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Form fill UI */}
      {!hasSubmitted && (
        !userId ? (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold text-center">Sign in to respond</p>
        ) : (
          <div className="space-y-4">
            {form.questions.map((q, qi) => (
              <div key={q.id} className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {q.text || `Question ${qi + 1}`}
                  {q.required && <span className="text-red-500 ml-1 font-black">*</span>}
                </p>

                {q.type === 'short' && (
                  <input
                    type="text"
                    value={answers[q.id] || ''}
                    onChange={e => setAnswer(q.id, e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm outline-none focus:border-yellow-500 transition-all"
                  />
                )}

                {q.type === 'paragraph' && (
                  <textarea
                    value={answers[q.id] || ''}
                    onChange={e => setAnswer(q.id, e.target.value)}
                    rows={3}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm outline-none focus:border-yellow-500 transition-all resize-none"
                  />
                )}

                {q.type === 'radio' && (q.options || []).map((opt, oi) => (
                  <label key={opt.id} className="flex items-center gap-2.5 cursor-pointer py-0.5">
                    <span
                      className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${answers[q.id] === opt.id ? 'border-yellow-500' : 'border-slate-300 dark:border-white/20'}`}
                      onClick={() => setAnswer(q.id, opt.id)}
                    >
                      {answers[q.id] === opt.id && <span className="block w-2 h-2 rounded-full bg-yellow-500" />}
                    </span>
                    <span className="text-sm text-slate-700 dark:text-slate-300" onClick={() => setAnswer(q.id, opt.id)}>
                      {opt.text}
                    </span>
                  </label>
                ))}

                {q.type === 'checkbox' && (q.options || []).map((opt) => {
                  const checked = Array.isArray(answers[q.id]) && answers[q.id].includes(opt.id);
                  return (
                    <label key={opt.id} className="flex items-center gap-2.5 cursor-pointer py-0.5">
                      <span
                        className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-all ${checked ? 'border-yellow-500 bg-yellow-500' : 'border-slate-300 dark:border-white/20'}`}
                        onClick={() => toggleCheckbox(q.id, opt.id)}
                      >
                        {checked && <span className="text-white text-[8px] font-black leading-none">✓</span>}
                      </span>
                      <span className="text-sm text-slate-700 dark:text-slate-300" onClick={() => toggleCheckbox(q.id, opt.id)}>
                        {opt.text}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}

            {submitErr && <p className="text-[10px] text-red-500">{submitErr}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black py-2.5 rounded-xl uppercase tracking-widest text-[10px] transition-all"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>

            <p className="text-[9px] text-slate-400 dark:text-slate-500">
              {form.anonymous ? 'Responses are anonymous' : 'Responses are attributed to your account'}
            </p>
          </div>
        )
      )}
    </div>
  );
};

export default FormDisplay;
