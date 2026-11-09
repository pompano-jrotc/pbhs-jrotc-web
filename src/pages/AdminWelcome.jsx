import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { auth, db } from '../firebase';
import {
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import { Mail, Smartphone, CheckCircle, Loader2, ShieldCheck, RefreshCw, ArrowRight, Shield, CheckCircle2 } from 'lucide-react';
import SmoothInput from '../components/SmoothInput';
import { CURRENT_TOS_VERSION } from '../components/TosGate';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const formatPhoneDisplay = (raw) => {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  let display = '';
  if (digits.length > 0) display = '(' + digits.slice(0, 3);
  if (digits.length > 3) display += ') ' + digits.slice(3, 6);
  if (digits.length > 6) display += '-' + digits.slice(6, 10);
  return { display, firebase: digits.length === 10 ? `+1${digits}` : '' };
};

// ─────────────────────────────────────────────
// Step indicator pip
// ─────────────────────────────────────────────
const StepPip = ({ number, active, done, label }) => (
  <div className="flex flex-col items-center gap-1.5">
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black transition-all
      ${done ? 'bg-green-500 text-white' : active ? 'bg-yellow-500 text-slate-950' : 'bg-white/10 text-slate-500'}`}>
      {done ? <CheckCircle size={14} /> : number}
    </div>
    <span className={`text-[9px] font-black uppercase tracking-widest transition-colors
      ${active ? 'text-yellow-500' : done ? 'text-green-500' : 'text-slate-600'}`}>
      {label}
    </span>
  </div>
);

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
const AdminWelcome = () => {
  const { user, userData, role } = useAuth();
  const navigate = useNavigate();
  const recaptchaRef = useRef(null);
  const emailSentRef = useRef(false); // prevents duplicate auto-sends this session

  // 'loading' | 'email' | 'phone' | 'completing'
  const [step, setStep] = useState('loading');
  const [emailStatus, setEmailStatus] = useState(null); // null | 'sending' | 'sent' | 'checking' | 'not-yet' | 'resent' | 'send-error' | 'rate-limited'
  const [resendCooldown, setResendCooldown] = useState(0); // seconds remaining before resend is allowed
  const [phoneDisplay, setPhoneDisplay] = useState('');
  const [mfaPhone, setMfaPhone] = useState('');
  const [mfaStep, setMfaStep] = useState('entering-phone'); // 'entering-phone' | 'entering-code'
  const [mfaCode, setMfaCode] = useState('');
  const [mfaVerificationId, setMfaVerificationId] = useState('');
  const [mfaStatus, setMfaStatus] = useState(null); // null | 'sending' | 'verifying' | error string
  // Reauthentication — Firebase requires a recent login before MFA enrollment.
  // If the email-verification step took >5 min the session is considered stale;
  // we catch auth/requires-recent-login and prompt for password before retrying.
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthError, setReauthError] = useState(null);
  const [reauthStatus, setReauthStatus] = useState(null); // null | 'loading'

  // TOS step state
  const [tosChecked,     setTosChecked]     = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [tosScrolled,    setTosScrolled]    = useState(false);
  const [tosCountdown,   setTosCountdown]   = useState(30);
  const tosScrollRef = useRef(null);

  // Countdown starts when TOS step becomes active
  useEffect(() => {
    if (step !== 'tos') return;
    if (tosCountdown <= 0) return;
    const id = setTimeout(() => setTosCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [step, tosCountdown]);

  const userLevel = ROLE_HIERARCHY[role] || 0;
  const mfaMandatory = userLevel >= STAFF_LEVEL;

  // ── Determine starting step ──────────────────
  // Order: TOS → email verify → MFA enrollment.
  useEffect(() => {
    if (!user) return;
    // TOS is step 1 — if not yet accepted, start there.
    if (userData?.tosAccepted !== true) {
      setStep('tos');
      return;
    }
    const alreadyVerified = auth.currentUser?.emailVerified ?? user.emailVerified;
    const alreadyEnrolled = multiFactor(user).enrolledFactors.length > 0;
    if (alreadyVerified && alreadyEnrolled) {
      // All steps done — finish immediately.
      finishOnboarding();
      return;
    }
    setStep(alreadyVerified ? 'phone' : 'email');
  }, [user, userData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resend cooldown ticker ───────────────────
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  // ── Auto-send verification email once ────────
  useEffect(() => {
    if (step !== 'email' || emailSentRef.current || !user) return;
    emailSentRef.current = true;
    setEmailStatus('sending');
    setResendCooldown(60); // 60s cooldown after auto-send
    user.getIdToken().then(async (idToken) => {
      try {
        const res = await fetch('/api/admin-update-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ type: 'send-verify-email', targetUid: user.uid }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error('send-verify-email failed:', res.status, err);
          setEmailStatus(res.status === 429 ? 'rate-limited' : 'send-error');
        } else {
          setEmailStatus('sent');
        }
      } catch (err) {
        console.error('send-verify-email network error:', err);
        setEmailStatus('send-error');
      }
    });
  }, [step, user]);

  // ── Finish onboarding ────────────────────────
  // Called after MFA enrollment (or skip) — TOS was accepted in step 1.
  const finishOnboarding = async () => {
    setStep('completing');
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        onboardingComplete: true,
        tosAccepted:        true,  // safety net in case TOS write was missed
        tosAcceptedAt:      serverTimestamp(),
        tosVersion:         CURRENT_TOS_VERSION,
      });
    } catch { /* best-effort */ }
    navigate('/admin/dashboard');
  };

  // ── Accept TOS and advance to email step ─────
  // Persists tosAccepted immediately so a page reload resumes at the email step.
  const acceptTos = async () => {
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        tosAccepted:   true,
        tosAcceptedAt: serverTimestamp(),
        tosVersion:    CURRENT_TOS_VERSION,
      });
    } catch { /* best-effort */ }
    setStep('email');
  };

  // ── Email step handlers ──────────────────────
  const handleCheckVerified = async () => {
    setEmailStatus('checking');
    try {
      await user.reload();
      if (auth.currentUser?.emailVerified) {
        setStep('phone');
        setEmailStatus(null);
      } else {
        setEmailStatus('not-yet');
      }
    } catch {
      setEmailStatus('not-yet');
    }
  };

  const handleForceVerify = async () => {
    setEmailStatus('sending');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'force-verify-email', targetUid: user.uid }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('force-verify-email failed:', res.status, err);
        setEmailStatus('send-error');
        return;
      }
      // Reload so the client sees emailVerified: true, then advance
      await user.reload();
      setStep('phone');
      setEmailStatus(null);
    } catch (err) {
      console.error('force-verify-email network error:', err);
      setEmailStatus('send-error');
    }
  };

  const handleResendEmail = async () => {
    setEmailStatus('sending');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'send-verify-email', targetUid: user.uid }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('resend failed:', res.status, err);
        setEmailStatus(res.status === 429 ? 'rate-limited' : 'send-error');
      } else {
        setEmailStatus('resent');
        setResendCooldown(60);
        setTimeout(() => setEmailStatus('sent'), 3000);
      }
    } catch (err) {
      console.error('resend network error:', err);
      setEmailStatus('send-error');
    }
  };

  // ── Phone step handlers ──────────────────────
  const handlePhoneInput = (e) => {
    const { display, firebase } = formatPhoneDisplay(e.target.value);
    setPhoneDisplay(display);
    setMfaPhone(firebase);
  };

  // Core send-code logic — called both from the form submit and after
  // a successful reauthentication so we don't duplicate the reCAPTCHA setup.
  const doSendCode = async () => {
    setMfaStatus('sending');
    try {
      const session = await multiFactor(user).getSession();
      if (recaptchaRef.current) {
        recaptchaRef.current.clear();
        recaptchaRef.current = null;
      }
      const verifier = new RecaptchaVerifier(auth, 'welcome-recaptcha-container', { size: 'invisible' });
      recaptchaRef.current = verifier;
      const provider = new PhoneAuthProvider(auth);
      const vid = await provider.verifyPhoneNumber({ phoneNumber: mfaPhone, session }, verifier);
      setMfaVerificationId(vid);
      setMfaStep('entering-code');
      setMfaStatus(null);
    } catch (err) {
      // Firebase requires a recent sign-in before enrolling MFA. The email-
      // verification step can take long enough to expire that window — ask the
      // user to re-enter their password so we can reauthenticate silently.
      if (err.code === 'auth/requires-recent-login') {
        setNeedsReauth(true);
        setMfaStatus(null);
      } else {
        setMfaStatus(err.message || 'Failed to send code. Try again.');
      }
    }
  };

  const handleSendCode = async (e) => {
    e.preventDefault();
    await doSendCode();
  };

  const handleReauth = async (e) => {
    e.preventDefault();
    setReauthError(null);
    setReauthStatus('loading');
    try {
      const credential = EmailAuthProvider.credential(user.email, reauthPassword);
      await reauthenticateWithCredential(user, credential);
      setNeedsReauth(false);
      setReauthPassword('');
      setReauthStatus(null);
      // Session is fresh — retry sending the code automatically.
      await doSendCode();
    } catch (err) {
      setReauthStatus(null);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setReauthError('Incorrect password. Try again.');
      } else {
        setReauthError(err.message || 'Re-authentication failed. Try again.');
      }
    }
  };

  const handleConfirmCode = async (e) => {
    e.preventDefault();
    setMfaStatus('verifying');
    try {
      const cred = PhoneAuthProvider.credential(mfaVerificationId, mfaCode);
      const assertion = PhoneMultiFactorGenerator.assertion(cred);
      await multiFactor(user).enroll(assertion, 'Phone');

      // Fire-and-forget confirmation email
      user.getIdToken().then((idToken) => {
        const enrolled = multiFactor(auth.currentUser).enrolledFactors;
        fetch('/api/admin-update-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            type: 'mfa-enrolled',
            targetUid: user.uid,
            maskedPhone: enrolled[0]?.phoneNumber ?? '',
          }),
        }).catch(console.error);
      });

      finishOnboarding();
    } catch (err) {
      setMfaStatus(
        err.code === 'auth/invalid-verification-code'
          ? 'Incorrect code — check your SMS and try again.'
          : err.message || 'Verification failed. Try again.'
      );
    }
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  if (step === 'loading' || step === 'completing') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      {/* reCAPTCHA mount point — kept off-screen so injected content never flashes visibly */}
      <div id="welcome-recaptcha-container" style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: 0, height: 0, overflow: 'hidden' }} />

      {/* Wordmark */}
      <div className="mb-8 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-1">PBHS</p>
        <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">
          Battalion <span className="text-yellow-500">Portal</span>
        </h1>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-slate-900 border border-white/5 rounded-3xl p-6 shadow-2xl">

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-8">
          <StepPip number={1} active={step === 'tos'} done={step === 'email' || step === 'phone'} label="Terms" />
          <div className="flex-1 h-px bg-white/10" />
          <StepPip number={2} active={step === 'email'} done={step === 'phone'} label="Email" />
          <div className="flex-1 h-px bg-white/10" />
          <StepPip number={3} active={step === 'phone'} done={false} label="2FA" />
        </div>

        {/* ── Step 2: Email Verification ── */}
        {step === 'email' && (
          <div className="space-y-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500 mb-1">Step 2 of 3</p>
              <h2 className="text-xl font-black uppercase italic tracking-tight text-white">Verify Your Email</h2>
              <p className="text-xs text-slate-400 font-medium mt-1">
                We sent a verification link to <span className="text-white font-bold">{user?.email}</span>. Open it, then come back.
              </p>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex gap-3">
              <Mail className="text-blue-400 shrink-0 mt-0.5" size={16} />
              <div>
                <p className="text-xs font-black text-blue-300 mb-0.5">Check your inbox</p>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  The email came from our system — check spam if you don't see it. Click the link, then return here.
                </p>
              </div>
            </div>

            {emailStatus === 'sending' && (
              <p className="text-[10px] font-bold text-slate-400 text-center flex items-center justify-center gap-1.5">
                <Loader2 className="animate-spin" size={10} /> Sending verification email…
              </p>
            )}
            {emailStatus === 'sent' && (
              <p className="text-[10px] font-bold text-green-400 text-center">✓ Verification email sent — check your inbox.</p>
            )}
            {emailStatus === 'not-yet' && (
              <p className="text-[10px] font-bold text-red-400 text-center">
                Email not verified yet — check your inbox and click the link first.
              </p>
            )}
            {emailStatus === 'resent' && (
              <p className="text-[10px] font-bold text-green-400 text-center">✓ Verification email resent.</p>
            )}
            {emailStatus === 'send-error' && (
              <p className="text-[10px] font-bold text-red-400 text-center">
                Failed to send verification email. Try the resend button below.
              </p>
            )}
            {emailStatus === 'rate-limited' && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-yellow-500 text-center">
                  Firebase has rate-limited this email address. Use the button below to verify instantly instead.
                </p>
                <button
                  onClick={handleForceVerify}
                  className="w-full py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 transition-all"
                >
                  <CheckCircle size={12} /> Verify Without Email
                </button>
              </div>
            )}

            <button
              onClick={handleCheckVerified}
              disabled={emailStatus === 'checking' || emailStatus === 'sending'}
              className="w-full py-3.5 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50 transition-all"
            >
              {emailStatus === 'checking'
                ? <><Loader2 className="animate-spin" size={14} /> Checking…</>
                : <><CheckCircle size={14} /> I've Verified My Email</>}
            </button>

            <button
              onClick={handleResendEmail}
              disabled={emailStatus === 'sending' || resendCooldown > 0}
              className="w-full text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-yellow-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <RefreshCw size={10} />
              {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : 'Resend verification email'}
            </button>
          </div>
        )}

        {/* ── Step 3: Phone 2FA ── */}
        {step === 'phone' && (
          <div className="space-y-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500 mb-1">Step 3 of 3</p>
              <h2 className="text-xl font-black uppercase italic tracking-tight text-white">Secure Your Account</h2>
              <p className="text-xs text-slate-400 font-medium mt-1">
                {mfaMandatory
                  ? 'Two-step verification is required for your role. Add your phone to continue.'
                  : 'Add your phone number to get a code every time you sign in.'}
              </p>
            </div>

            {mfaMandatory && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500">Required for your role</p>
              </div>
            )}

            {/* Reauthentication prompt — shown when Firebase's recent-login window
                has expired during the email-verification step. */}
            {needsReauth && (
              <form onSubmit={handleReauth} className="space-y-4">
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500 mb-0.5">Session expired</p>
                  <p className="text-xs text-slate-400 font-medium">Re-enter your password to continue setting up 2FA.</p>
                </div>
                <div className="relative">
                  <SmoothInput
                    type="password"
                    required
                    autoFocus
                    placeholder="Password"
                    value={reauthPassword}
                    onChange={(e) => setReauthPassword(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-sm font-bold text-white focus:border-yellow-500 outline-none transition-all"
                  />
                </div>
                {reauthError && (
                  <p className="text-[10px] font-bold text-red-400">{reauthError}</p>
                )}
                <button
                  type="submit"
                  disabled={reauthStatus === 'loading' || !reauthPassword}
                  className="w-full py-3.5 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50 transition-all"
                >
                  {reauthStatus === 'loading'
                    ? <><Loader2 className="animate-spin" size={14} /> Verifying…</>
                    : <><ArrowRight size={14} /> Continue</>}
                </button>
              </form>
            )}

            {/* Phone entry */}
            {!needsReauth && mfaStep === 'entering-phone' && (
              <form onSubmit={handleSendCode} className="space-y-4">
                <div className="relative">
                  <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <SmoothInput
                    type="tel"
                    required
                    placeholder="(555) 000-0000"
                    value={phoneDisplay}
                    onChange={handlePhoneInput}
                    className="w-full bg-black/40 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-bold text-white focus:border-yellow-500 outline-none transition-all"
                    autoFocus
                  />
                </div>
                <p className="text-[10px] text-slate-500 font-bold -mt-2">
                  US number — +1 country code added automatically
                </p>

                {mfaStatus && mfaStatus !== 'sending' && (
                  <p className="text-[10px] font-bold text-red-400">{mfaStatus}</p>
                )}

                <button
                  type="submit"
                  disabled={mfaStatus === 'sending' || !mfaPhone}
                  className="w-full py-3.5 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50 transition-all"
                >
                  {mfaStatus === 'sending'
                    ? <><Loader2 className="animate-spin" size={14} /> Sending…</>
                    : <><Smartphone size={14} /> Send Code</>}
                </button>

                {!mfaMandatory && (
                  <button
                    type="button"
                    onClick={finishOnboarding}
                    className="w-full text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Skip for now
                  </button>
                )}
              </form>
            )}

            {/* Code entry */}
            {mfaStep === 'entering-code' && (
              <form onSubmit={handleConfirmCode} className="space-y-4">
                <p className="text-[10px] text-slate-400 font-bold">
                  Enter the 6-digit code sent to <span className="text-white">{mfaPhone}</span>.
                </p>
                <SmoothInput
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-2xl font-black text-white text-center tracking-[0.5em] focus:border-yellow-500 outline-none transition-all"
                  autoFocus
                />

                {mfaStatus && mfaStatus !== 'verifying' && (
                  <p className="text-[10px] font-bold text-red-400">{mfaStatus}</p>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => { setMfaStep('entering-phone'); setMfaCode(''); setMfaStatus(null); }}
                    className="flex-1 py-3 rounded-xl font-black uppercase text-xs bg-white/5 hover:bg-white/10 text-slate-300 transition-all"
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    disabled={mfaStatus === 'verifying' || mfaCode.length < 6}
                    className="flex-1 py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50 transition-all"
                  >
                    {mfaStatus === 'verifying'
                      ? <><Loader2 className="animate-spin" size={12} /> Verifying…</>
                      : <><ShieldCheck size={12} /> Confirm</>}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ── Step 1: Terms of Service ── */}
        {step === 'tos' && (
          <div className="space-y-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500 mb-1">Step 1 of 3</p>
              <h2 className="text-xl font-black uppercase italic tracking-tight text-white">Terms & Privacy</h2>
              <p className="text-xs text-slate-400 font-medium mt-1">
                Review and agree before entering the portal.
              </p>
            </div>

            {/* Scrollable summary */}
            <div
              ref={tosScrollRef}
              onScroll={() => {
                const el = tosScrollRef.current;
                if (!el) return;
                if (el.scrollTop / (el.scrollHeight - el.clientHeight) >= 0.85) setTosScrolled(true);
              }}
              className="h-44 overflow-y-auto bg-black/30 border border-white/8 rounded-2xl px-4 py-3 text-xs text-slate-400 leading-relaxed space-y-3"
            >
              <p><strong className="text-white">Restricted Access —</strong> This portal is for authorized PBHS JROTC personnel only. Unauthorized access is prohibited and may result in school disciplinary action.</p>
              <p><strong className="text-white">Credential Security —</strong> Your login credentials are yours alone. Never share your password or allow anyone else to use your account. Treat this portal the same way you treat Canvas or Focus Student Portal.</p>
              <p><strong className="text-white">Cadet Data Confidentiality —</strong> The portal contains personally identifiable information (PII). You must not share cadet data, screenshots, or records outside the portal in any form. Violations may constitute a FERPA breach.</p>
              <p><strong className="text-white">Acceptable Use —</strong> Use the portal only for its intended JROTC operational purposes. Submitting false information, bypassing security controls, or harassing cadets or staff is strictly prohibited.</p>
              <p><strong className="text-white">Privacy —</strong> Your actions are logged for accountability. Data is stored securely in Firebase (Google Cloud) and is not sold or shared with third parties.</p>
              <p><strong className="text-white">Violations</strong> may result in immediate access suspension, school disciplinary referral, and JROTC chain-of-command proceedings.</p>
              <p className="text-slate-600 text-[10px] pt-1">Version {CURRENT_TOS_VERSION} · August 2026</p>
            </div>

            {/* Countdown / scroll status */}
            {tosCountdown > 0 ? (
              <div className="flex items-center justify-between bg-white/3 border border-white/8 rounded-xl px-3 py-2">
                <span className="text-[10px] font-bold text-slate-500">Please read before agreeing</span>
                <span className="text-sm font-black text-yellow-500 tabular-nums">{tosCountdown}s</span>
              </div>
            ) : !tosScrolled ? (
              <p className="text-[10px] text-slate-600 font-bold text-center">↓ Scroll to the bottom to enable</p>
            ) : null}

            {/* TOS checkbox */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="mt-0.5 shrink-0">
                <input type="checkbox" checked={tosChecked} onChange={e => setTosChecked(e.target.checked)} disabled={!(tosScrolled && tosCountdown === 0)} className="sr-only" />
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                  tosChecked ? 'bg-yellow-500 border-yellow-500' : (tosScrolled && tosCountdown === 0) ? 'border-slate-500 group-hover:border-yellow-500/60' : 'border-slate-700 opacity-40 cursor-not-allowed'
                }`}>
                  {tosChecked && <CheckCircle2 size={10} className="text-slate-950" />}
                </div>
              </div>
              <span className={`text-xs leading-relaxed ${(tosScrolled && tosCountdown === 0) ? 'text-slate-300' : 'text-slate-600'}`}>
                I agree to the <strong className="text-white">Terms of Use</strong> — no sharing cadet data, screenshots, or credentials.
              </span>
            </label>

            {/* Privacy checkbox */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="mt-0.5 shrink-0">
                <input type="checkbox" checked={privacyChecked} onChange={e => setPrivacyChecked(e.target.checked)} disabled={!(tosScrolled && tosCountdown === 0)} className="sr-only" />
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                  privacyChecked ? 'bg-yellow-500 border-yellow-500' : (tosScrolled && tosCountdown === 0) ? 'border-slate-500 group-hover:border-yellow-500/60' : 'border-slate-700 opacity-40 cursor-not-allowed'
                }`}>
                  {privacyChecked && <CheckCircle2 size={10} className="text-slate-950" />}
                </div>
              </div>
              <span className={`text-xs leading-relaxed ${(tosScrolled && tosCountdown === 0) ? 'text-slate-300' : 'text-slate-600'}`}>
                I acknowledge the <strong className="text-white">Privacy Policy</strong> — I understand my actions are logged.
              </span>
            </label>

            <button
              onClick={acceptTos}
              disabled={!tosChecked || !privacyChecked || !tosScrolled || tosCountdown > 0}
              className="w-full py-3.5 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <Shield size={14} /> Agree &amp; Continue
            </button>
          </div>
        )}
      </div>

      {/* Battalion footer */}
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-700 mt-8">
        Above and Beyond
      </p>
    </div>
  );
};

export default AdminWelcome;
