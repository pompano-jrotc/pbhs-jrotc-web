import React, { useState, useEffect } from 'react';
import SmoothInput from '../components/SmoothInput';
import { useCompanies } from '../hooks/useCompanies';
import { normalizeCompany } from '../utils/normalizeCompany';
import { auth, db } from '../firebase';
import { createUserWithEmailAndPassword, deleteUser } from 'firebase/auth';
import {
  getDocs,
  getDoc,
  doc,
  collection,
  query,
  where
} from 'firebase/firestore';
import { useNavigate, Link } from 'react-router-dom';
import { 
  ShieldCheck, 
  Mail, 
  Lock, 
  User, 
  Phone, 
  Briefcase, 
  Medal, 
  KeyRound, 
  ArrowLeft,
  Loader2,
  UserCheck,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  JROTC_RANKS, JROTC_POSITIONS, BATTALION_POSITIONS, POSITION_RANKS,
  COMPANY_HQ_LOCKED_POSITIONS, COMPANY_HQ_DEFAULT_POSITIONS, NO_SQUAD_POSITIONS,
  rankExceedsMax,
  MILITARY_RANKS, INSTRUCTOR_POSITIONS,
} from '../constants';
import { usePageMeta } from '../hooks/usePageMeta';

// Requires the military roster convention: "LASTNAME, FIRSTNAME" (each side
// may be multiple words, e.g. "DE ALMEIDA, ARTHURO").
const FULL_NAME_PATTERN = /^[A-Za-z'-]+(?:\s+[A-Za-z'-]+)*,\s*[A-Za-z'-]+(?:\s+[A-Za-z'-]+)*$/;

// Firebase's own minimum is just 6 characters with no complexity requirement.
const isStrongPassword = (pw) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);

// Site key is public by design — it's embedded in the page source.
// The Google Cloud API key that verifies tokens lives server-side only
// in api/verify-captcha.js. Enterprise score-based: no checkbox shown,
// runs invisibly in the background and returns a 0–1 human likelihood score.
const RECAPTCHA_SITE_KEY = '6Ld3tXwtAAAAAP7tu9bJa3fpwpju6LLDe9T2ujWO';

// Fallback hash used when Firestore is unreachable or no custom code is set.
// Change the code via the admin portal (Content → Access Code tab) — it writes
// the SHA-256 hash to settings/signupCode so this value is only a last resort.
const FALLBACK_SECRET_HASH = "587059e56cc6592a6054a0606758a821cc9eb7657635eb13f4b7c88a17e7ad7a";

const SignUp = () => {
  usePageMeta({ title: 'Create Account' });

  // Active secret-code hash — loaded from Firestore on mount; falls back to the
  // compile-time constant if the doc is missing or the read fails.
  const [activeSecretHash, setActiveSecretHash] = useState(FALLBACK_SECRET_HASH);
  useEffect(() => {
    getDoc(doc(db, 'settings', 'signupCode'))
      .then(snap => {
        if (snap.exists() && snap.data().hash) setActiveSecretHash(snap.data().hash);
      })
      .catch(() => { /* network error — stay on fallback */ });
  }, []);

  // Load the reCAPTCHA Enterprise script lazily so it's only present while the
  // signup page is mounted. Loading it globally in index.html conflicts with
  // Firebase's own RecaptchaVerifier (used for MFA SMS on the login page) because
  // both compete for window.grecaptcha. Lazy-loading here isolates the scopes.
  useEffect(() => {
    const SCRIPT_ID = 'recaptcha-enterprise-script';
    if (document.getElementById(SCRIPT_ID)) return; // already loaded
    const script = document.createElement('script');
    script.id   = SCRIPT_ID;
    script.src  = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
    // Not cleaned up on unmount intentionally: removing a <script> tag doesn't
    // un-execute it or clear window.grecaptcha — leave it for the session so that
    // if the user navigates back to signup the script is already ready. The id
    // guard above prevents duplicates.
  }, []);
  const [accountType, setAccountType] = useState('cadet'); // 'cadet' | 'instructor'
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    rank: '',
    position: '',
    letLevel: 'LET 1',
    company: '',
    platoon: '1st Platoon',
    squad: '1st Squad',
    secondaryCompany: '',
    phone: '',
    secretCode: ''
  });

  // Battalion members are HQ staff — they don't belong to a lettered company,
  // but they still attend a class period with one (secondaryCompany).
  // Legacy 'Zulu' entries are treated the same as 'Battalion'.
  const BATTALION_COMPANIES = ['Battalion', 'Zulu'];
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [linkData, setLinkData] = useState(null);
  const navigate = useNavigate();

  // Obtains a reCAPTCHA Enterprise token silently (no checkbox shown).
  // enterprise.ready() ensures the script has fully initialised before
  // execute() is called; the resulting token is verified server-side.
  const getEnterpriseToken = () =>
    new Promise((resolve, reject) => {
      if (!window.grecaptcha?.enterprise) {
        reject(new Error('reCAPTCHA not loaded'));
        return;
      }
      window.grecaptcha.enterprise.ready(async () => {
        try {
          const token = await window.grecaptcha.enterprise.execute(
            RECAPTCHA_SITE_KEY,
            { action: 'SIGNUP' }
          );
          resolve(token);
        } catch (err) {
          reject(err);
        }
      });
    });

  const sha256Hex = async (text) => {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };


  // JROTC_RANKS and JROTC_POSITIONS imported from constants.js (single source of truth).
  const { companies } = useCompanies();
  const platoons = ["1st Platoon", "2nd Platoon", "3rd Platoon", "Company HQ"];
  const squads = ["1st Squad", "2nd Squad", "3rd Squad", "4th Squad", "Staff"];

  const handleSignUpAttempt = async (e) => {
    e.preventDefault();
    setError('');

    if (!FULL_NAME_PATTERN.test(formData.name.trim())) {
      setError("FULL NAME MUST BE FORMATTED AS: LASTNAME, FIRSTNAME");
      return;
    }

    const enteredHash = await sha256Hex(formData.secretCode.trim());
    if (enteredHash !== activeSecretHash) {
      setError("INVALID SECRET CODE: ACCESS DENIED.");
      return;
    }

    if (!isStrongPassword(formData.password)) {
      setError("PASSWORD MUST BE AT LEAST 8 CHARACTERS AND INCLUDE A LETTER AND A NUMBER.");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("PASSWORDS DO NOT MATCH.");
      return;
    }

    if (accountType === 'cadet') {
      // LET 1 → Squad Member only; LET 2+ → cannot be Squad Member.
      if (formData.letLevel === 'LET 1' && formData.position !== 'Squad Member') {
        setError("LET 1 CADETS MAY ONLY SELECT SQUAD MEMBER AS THEIR POSITION.");
        return;
      }
      if (formData.letLevel !== 'LET 1' && formData.position === 'Squad Member') {
        setError("SQUAD MEMBER IS ONLY AVAILABLE FOR LET 1 CADETS. LET 2–4 CADETS MUST SELECT A DIFFERENT POSITION.");
        return;
      }
      // Rank ceiling: selected rank cannot exceed the authorized max for position
      if (rankExceedsMax(formData.rank, formData.position)) {
        setError(`${formData.rank} EXCEEDS THE AUTHORIZED MAX RANK (${POSITION_RANKS[formData.position]}) FOR ${formData.position}. PLEASE SELECT A LOWER RANK.`);
        return;
      }
    }

    setLoading(true);

    let captchaToken;
    try {
      captchaToken = await getEnterpriseToken();
    } catch {
      setError("CAPTCHA CHECK FAILED. PLEASE REFRESH AND TRY AGAIN.");
      setLoading(false);
      return;
    }
    const targetEmail = formData.email.trim().toLowerCase();

    try {
      // Verified server-side, not just checked for presence client-side -
      // a bot can fake calling this function, but it can't fake solving the
      // widget, and Google invalidates a token the moment it's checked once.
      const captchaRes = await fetch('/api/verify-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: captchaToken })
      });
      if (!captchaRes.ok) {
        const captchaErr = await captchaRes.json().catch(() => ({}));
        console.error('CAPTCHA failed — detail:', captchaErr);
        setError("CAPTCHA VERIFICATION FAILED. TRY AGAIN.");
        setLoading(false);
        return;
      }

      // The account has to exist (and be signed in) before Firestore rules
      // will allow even reading the users collection, so this now happens
      // before the shadow-record lookup - not after it, like it used to.
      const userCredential = await createUserWithEmailAndPassword(auth, targetEmail, formData.password);
      const user = userCredential.user;

      const manualQuery = query(
        collection(db, "users"),
        where("email", "==", targetEmail),
        where("isManual", "==", true)
      );

      const manualSnap = await getDocs(manualQuery);

      if (!manualSnap.empty) {
        setLinkData({ id: manualSnap.docs[0].id, ...manualSnap.docs[0].data() });
        setLoading(false);
      } else {
        await finalizeAccountCreation(user);
      }
    } catch (err) {
      setError(err.code === 'auth/email-already-in-use' ? "EMAIL ALREADY REGISTERED." : err.message.toUpperCase());
      setLoading(false);
    }
  };

  // The auth account already exists by the time this runs (see above) - all
  // that's left is the privileged Firestore write, which now goes through
  // the server since a fresh signup isn't trusted to self-report a shadow-
  // record match or set its own role/approved status directly.
  const finalizeAccountCreation = async (user) => {
    setLoading(true);

    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          type: 'complete-signup',
          targetUid: user.uid,
          profile: accountType === 'instructor'
            ? {
                accountType: 'instructor',
                fullName: formData.name.toUpperCase(),
                phone: formData.phone,
                rank: formData.rank,
                position: formData.position,
              }
            : {
                fullName: formData.name.toUpperCase(),
                phone: formData.phone,
                rank: formData.rank,
                position: formData.position,
                letLevel: formData.letLevel,
                company: formData.company,
                platoon: formData.platoon,
                squad: formData.squad,
                secondaryCompany: formData.secondaryCompany || null,
              }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to finish creating your account');

      navigate('/admin/dashboard');
    } catch (err) {
      setError((err.message || 'Failed to finish creating your account').toUpperCase());
    } finally {
      setLoading(false);
      setLinkData(null);
    }
  };

  // "No, this is a mistake": the auth account created in handleSignUpAttempt
  // is otherwise left orphaned (no Firestore profile) with its email now
  // stuck in "already in use" for any retry. Deleting your own just-created
  // account is always allowed by Firebase Auth itself, no Firestore rule
  // involved, so this cleanly undoes it.
  const rejectLinkMatch = async () => {
    try {
      if (auth.currentUser) await deleteUser(auth.currentUser);
    } catch (err) {
      console.error('Failed to clean up the unmatched signup attempt:', err);
    }
    setLinkData(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-2xl">
        <Link to="/admin" className="text-slate-500 hover:text-white flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest transition-all">
          <ArrowLeft size={14} /> Back to Login
        </Link>

        <form onSubmit={handleSignUpAttempt} className="bg-slate-900 p-8 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-500 to-transparent opacity-50"></div>

          <div className="mb-8">
            <h2 className="text-3xl font-black uppercase italic text-yellow-500 tracking-tighter">Sign Up</h2>
            <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] mt-1">
              {accountType === 'instructor' ? 'Create Your Instructor Account' : 'Create Your Cadet Account'}
            </p>
          </div>

          {/* Account type toggle */}
          <div className="flex gap-2 mb-6 p-1 bg-black/40 border border-white/5 rounded-xl">
            {[
              { key: 'cadet', label: 'Cadet' },
              { key: 'instructor', label: 'Instructor / Cadre' },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setAccountType(key);
                  setFormData(f => ({ ...f, rank: '', position: '', letLevel: 'LET 1', company: '', platoon: '1st Platoon', squad: '1st Squad', secondaryCompany: '' }));
                  setError('');
                }}
                className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  accountType === key
                    ? 'bg-yellow-500 text-slate-950'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl text-[10px] font-black mb-6 flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative col-span-full">
              <User className="absolute left-3 top-3 text-slate-600" size={18} />
              <SmoothInput type="text" placeholder="FULL NAME (LAST, FIRST)" required className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none transition-all uppercase font-bold text-white" onChange={(e) => setFormData({...formData, name: e.target.value})} />
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-3 text-slate-600" size={18} />
              <SmoothInput type="email" placeholder="EMAIL ADDRESS" required className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none transition-all font-bold text-white" onChange={(e) => setFormData({...formData, email: e.target.value})} />
            </div>

            <div className="relative">
              <Phone className="absolute left-3 top-3 text-slate-600" size={18} />
              <SmoothInput type="tel" placeholder="PHONE NUMBER" required className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none transition-all font-bold text-white" onChange={(e) => setFormData({...formData, phone: e.target.value})} />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-3 text-slate-600" size={18} />
              <SmoothInput type="password" placeholder="PASSWORD" required minLength={8} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none transition-all font-bold text-white" onChange={(e) => setFormData({...formData, password: e.target.value})} />
              <p className="text-slate-600 text-[9px] font-bold uppercase tracking-widest mt-1.5 ml-1">8+ Characters, 1 Letter, 1 Number</p>
            </div>

            <div className="relative">
              <KeyRound className="absolute left-3 top-3 text-slate-600" size={18} />
              <SmoothInput type="password" placeholder="CONFIRM PASSWORD" required className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none transition-all font-bold text-white" onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})} />
            </div>

            {/* Rank — cadet ranks vs. military ranks */}
            <div className="relative">
              <Medal className="absolute left-3 top-3 text-slate-600" size={18} />
              <select required value={formData.rank} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none appearance-none font-bold text-white" onChange={(e) => setFormData({...formData, rank: e.target.value})}>
                <option value="" disabled>SELECT RANK</option>
                {accountType === 'instructor'
                  ? MILITARY_RANKS.map(r => <option key={r} value={r} className="bg-slate-900">{r}</option>)
                  : JROTC_RANKS.map(r => <option key={r} value={r} className="bg-slate-900">{r}</option>)
                }
              </select>
              {accountType === 'cadet' && (
                <p className="text-amber-400 text-[9px] font-black uppercase tracking-widest mt-1.5 ml-1">
                  ⚠ Enter your current issued rank — not your max rank or position-associated rank. If unsure, select C/PVT.
                </p>
              )}
            </div>

            {/* LET level — cadets only */}
            {accountType === 'cadet' && (
              <div className="relative">
                <select required value={formData.letLevel} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-yellow-500 outline-none appearance-none font-bold text-white" onChange={(e) => setFormData(f => ({...f, letLevel: e.target.value}))}>
                  <option value="" disabled>SELECT LET LEVEL</option>
                  {["LET 1", "LET 2", "LET 3", "LET 4"].map(l => <option key={l} value={l} className="bg-slate-900">{l}</option>)}
                </select>
              </div>
            )}

            {/* Position — cadet positions vs. instructor positions */}
            <div className={`relative ${accountType === 'instructor' ? 'col-span-full md:col-span-1' : ''}`}>
              <Briefcase className="absolute left-3 top-3 text-slate-600" size={18} />
              {accountType === 'instructor' ? (
                <select
                  required
                  value={formData.position}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none appearance-none font-bold text-white"
                  onChange={(e) => setFormData(f => ({ ...f, position: e.target.value }))}
                >
                  <option value="" disabled>SELECT POSITION</option>
                  {INSTRUCTOR_POSITIONS.map(p => <option key={p} value={p} className="bg-slate-900">{p}</option>)}
                </select>
              ) : (
                <select
                  required
                  value={formData.position}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none appearance-none font-bold text-white"
                  onChange={(e) => {
                    const newPos = e.target.value;
                    const isHqPos   = COMPANY_HQ_LOCKED_POSITIONS.includes(newPos) || COMPANY_HQ_DEFAULT_POSITIONS.includes(newPos);
                    const isNoSquad = NO_SQUAD_POSITIONS.includes(newPos);
                    setFormData(f => ({
                      ...f,
                      position: newPos,
                      ...(isHqPos && !BATTALION_COMPANIES.includes(f.company)
                        ? { platoon: 'Company HQ', squad: '' }
                        : {}),
                      ...(!isHqPos && isNoSquad ? { squad: '' } : {}),
                    }));
                  }}
                >
                  <option value="" disabled>SELECT POSITION</option>
                  {JROTC_POSITIONS
                    .filter(p => !BATTALION_POSITIONS.includes(p))
                    .map(p => <option key={p} value={p} className="bg-slate-900">{p}</option>)}
                </select>
              )}
              {accountType === 'cadet' && (() => {
                const authRank = POSITION_RANKS[formData.position] || '';
                if (!authRank) return null;
                const isOver = formData.rank && rankExceedsMax(formData.rank, formData.position);
                return (
                  <p className={`text-[9px] font-black uppercase tracking-widest mt-1.5 ml-1 ${isOver ? 'text-rose-400' : 'text-slate-500'}`}>
                    {isOver
                      ? `⛔ ${formData.rank} exceeds max rank for this position (${authRank})`
                      : `Max authorized rank for this position: ${authRank}`
                    }
                  </p>
                );
              })()}
            </div>

            {/* Platoon / Squad — hidden for Battalion members and instructors */}
            {accountType === 'cadet' && !BATTALION_COMPANIES.includes(formData.company) && (
              <div className="relative">
                <select required value={formData.platoon} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-yellow-500 outline-none appearance-none font-bold text-white" onChange={(e) => {
                  const newPlatoon = e.target.value;
                  setFormData(f => ({
                    ...f,
                    platoon: newPlatoon,
                    // Clear squad when platoon is Company HQ — no squad for HQ
                    ...(newPlatoon === 'Company HQ' ? { squad: '' } : {})
                  }));
                }}>
                  {platoons.map(p => <option key={p} value={p} className="bg-slate-900">{p}</option>)}
                </select>
              </div>
            )}

            {accountType === 'cadet' && !BATTALION_COMPANIES.includes(formData.company) && formData.platoon !== 'Company HQ' && !NO_SQUAD_POSITIONS.includes(formData.position) && (
              <div className="relative">
                <select required value={formData.squad} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-yellow-500 outline-none appearance-none font-bold text-white" onChange={(e) => setFormData({...formData, squad: e.target.value})}>
                  {squads.map(s => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
                </select>
              </div>
            )}

            {/* Secondary Company — only for Battalion cadet members */}
            {accountType === 'cadet' && BATTALION_COMPANIES.includes(formData.company) && (
              <div className="relative col-span-full">
                <select
                  required
                  value={formData.secondaryCompany}
                  className="w-full bg-black/40 border border-yellow-500/20 rounded-xl p-3 text-sm focus:border-yellow-500 outline-none appearance-none font-bold text-yellow-400"
                  onChange={(e) => setFormData({...formData, secondaryCompany: e.target.value})}
                >
                  <option value="" disabled>— CLASS PERIOD (SECONDARY COMPANY) —</option>
                  {companies.map(c => (
                    <option key={c} value={c} className="bg-slate-900 text-white">{c} Company (Class Period)</option>
                  ))}
                </select>
                <p className="text-[9px] text-slate-500 font-bold uppercase mt-1.5 ml-1 tracking-widest">
                  The company whose class you attend — you observe, not a member.
                </p>
              </div>
            )}

            {/* Company — cadets only */}
            {accountType === 'cadet' && <div className="relative col-span-full">
              <select required value={formData.company} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-yellow-500 outline-none appearance-none text-center font-black text-white" onChange={(e) => {
                const nextCompany = e.target.value;
                const isNextBattalion = BATTALION_COMPANIES.includes(nextCompany);
                const isPrevBattalion = BATTALION_COMPANIES.includes(formData.company);
                setFormData({
                  ...formData,
                  company: nextCompany,
                  secondaryCompany: isNextBattalion ? formData.secondaryCompany : '',
                  ...(isNextBattalion
                    ? { platoon: 'Company HQ', squad: 'Staff' }
                    : (isPrevBattalion ? { platoon: '1st Platoon', squad: '1st Squad' } : {}))
                });
              }}>
                <option value="" disabled>— ASSIGN COMPANY —</option>
                {/* Battalion is not a company — separate HQ designation */}
                <option value="Battalion" className="bg-slate-900">Battalion (HQ)</option>
                {companies.map(c => <option key={c} value={c} className="bg-slate-900">{c} Company</option>)}
              </select>
            </div>}

            <div className="relative col-span-full">
              <ShieldCheck className="absolute left-3 top-3 text-yellow-500" size={18} />
              <SmoothInput type="text" placeholder="BATTALION SECRET CODE" required className="w-full bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 pl-10 text-sm focus:border-yellow-500 outline-none text-yellow-500 font-black" onChange={(e) => setFormData({...formData, secretCode: e.target.value})} />
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-4 rounded-xl mt-6 hover:bg-yellow-400 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="animate-spin" size={18} /> : "Request Access"}
          </button>
        </form>
      </div>

      <AnimatePresence>
        {linkData && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-950/90">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-slate-900 border border-yellow-500/20 p-10 rounded-[3rem] max-w-md w-full shadow-2xl text-center">
              <div className="w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center mx-auto mb-6 text-yellow-500">
                <UserCheck size={40} />
              </div>
              <h2 className="text-3xl font-black uppercase italic tracking-tighter mb-2">Personnel File Found</h2>
              <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-8">An official record exists. Is this you?</p>
              
              <div className="bg-black/40 border border-white/5 p-6 rounded-2xl text-left mb-8">
                <h4 className="text-white font-black uppercase italic text-lg">{linkData.fullName}</h4>
                <div className="flex flex-wrap gap-2 mt-1">
                  <span className="text-yellow-500 font-black text-[10px] uppercase">{linkData.rank}</span>
                  <span className="text-slate-400 font-black text-[10px] uppercase">{normalizeCompany(linkData.company)} Co.</span>
                  <span className="text-slate-500 font-black text-[10px] uppercase">{linkData.platoon} / {linkData.squad}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => finalizeAccountCreation(auth.currentUser)}
                  disabled={loading}
                  className="w-full bg-yellow-500 text-slate-950 py-4 rounded-2xl font-black uppercase flex items-center justify-center gap-2 hover:bg-yellow-400 transition-all"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <>Yes, This is me <ChevronRight size={18} /></>}
                </button>
                <button onClick={rejectLinkMatch} disabled={loading} className="text-slate-500 hover:text-white font-black uppercase text-[10px] py-2 disabled:opacity-50">
                  No, This is a mistake
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SignUp;