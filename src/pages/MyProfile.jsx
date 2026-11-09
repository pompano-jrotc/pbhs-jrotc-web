import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getInitials } from '../utils/getInitials';
import { normalizeCompany, isHQCompany } from '../utils/normalizeCompany';
import { db, auth } from '../firebase';
import { doc, getDoc, updateDoc, getDocs, query, collection, where, orderBy, serverTimestamp } from 'firebase/firestore';
import {
  signOut,
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
} from 'firebase/auth';
import { deleteField } from 'firebase/firestore';
import { ROLE_LABELS, ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import Footer from '../components/Footer';
import { ArrowLeft, Mail, Phone, Save, KeyRound, CheckCircle, Trash2, Camera, Loader2, Sun, Moon, Monitor, Smartphone, ShieldCheck, ShieldOff, BookOpen, Calendar, FileText, Activity, DollarSign, Shirt, Bell, BellOff, MailCheck, MailX, UploadCloud, X, Award, ClipboardList } from 'lucide-react';
import { requestAndStoreToken, removeAndClearToken, getCurrentToken } from '../lib/fcm';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import { useThemeContext } from '../contexts/ThemeContext';
import ScrambleText from '../components/ScrambleText';
import { useConfirm } from '../contexts/ConfirmContext';

const formatCooldown = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const MyProfile = () => {
  const { user, userData, role } = useAuth();
  const confirm = useConfirm();
  const { theme, setTheme } = useThemeContext();
  const navigate = useNavigate();
  const location = useLocation();

  // mfaRequired: redirected here because 2FA enrollment is mandatory for this role
  const mfaRequired = new URLSearchParams(location.search).get('mfa') === 'required';
  // mfaMandatory: this user's level requires 2FA regardless of how they got here
  const mfaMandatory = (ROLE_HIERARCHY[role] || 0) >= STAFF_LEVEL;
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetStatus, setResetStatus] = useState(null); // null | 'sending' | 'success' | error string
  const [loginEmail, setLoginEmail] = useState('');
  const [loginEmailStatus, setLoginEmailStatus] = useState(null);
  const [resetCooldownUntil, setResetCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [deleteAccountStatus, setDeleteAccountStatus] = useState(null);
  const [uploadingPortrait, setUploadingPortrait] = useState(false);
  const [portraitError, setPortraitError] = useState(null);
  const [removingPortrait, setRemovingPortrait] = useState(false);
  const [cancellingPending, setCancellingPending] = useState(false);

  // Dossier — bio and availability synced from Firestore userData
  const [dossier, setDossier] = useState({ bio: '', practiceDays: '' });
  const [dossierSaving, setDossierSaving] = useState(false);
  const [dossierSaved, setDossierSaved] = useState(false);

  // My Records — read-only view of the cadet's own operational records
  const [myRecords, setMyRecords] = useState(null); // null = loading, {} = loaded
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchMyRecords() {
      try {
        // Step 1: find this user's roster document via linkedUid
        const rosterSnap = await getDocs(
          query(collection(db, 'roster'), where('linkedUid', '==', user.uid))
        );
        const rosterDoc = rosterSnap.docs[0];
        const rosterDocId = rosterDoc?.id ?? null;

        // Step 2: fetch all record types concurrently
        const [sizesSnap, fitnessSnap, fundraiserSnap, boardScoresSnap, ribbonsSnap] = await Promise.all([
          rosterDocId
            ? getDocs(query(collection(db, 'uniformSizes'), where('cadetId', '==', rosterDocId)))
            : Promise.resolve({ docs: [] }),
          rosterDocId
            ? getDocs(query(collection(db, 'cadetChallengeRecords'), where('cadetId', '==', rosterDocId)))
            : Promise.resolve({ docs: [] }),
          getDocs(query(collection(db, 'fundraiserEntries'), where('linkedUid', '==', user.uid))),
          rosterDocId
            ? getDocs(query(collection(db, 'promotionScores'), where('rosterDocId', '==', rosterDocId)))
            : Promise.resolve({ docs: [] }),
          rosterDocId
            ? getDocs(query(collection(db, 'ribbonAwards'), where('rosterDocId', '==', rosterDocId)))
            : Promise.resolve({ docs: [] }),
        ]);

        if (cancelled) return;

        // Uniform sizes — take the most recent/only record
        const sizeRecord = sizesSnap.docs[0]?.data() ?? null;

        // Cadet Challenge — group by cycle, show all cycles with data
        const fitnessByCycle = {};
        fitnessSnap.docs.forEach((d) => {
          const r = d.data();
          const cycle = r.cycleNum ?? r.cycle ?? '?';
          fitnessByCycle[cycle] = r;
        });

        // Fundraiser — sum total and count non-voided entries only
        let fundraiserTotal = 0;
        let fundraiserCount = 0;
        fundraiserSnap.docs.forEach((d) => {
          const r = d.data();
          if (r.voided) return;
          fundraiserTotal += parseFloat(r.amount) || 0;
          fundraiserCount += 1;
        });

        // Promotion board scores — fetch board metadata for titles/dates
        const boardScores = boardScoresSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const boardIds    = [...new Set(boardScores.map(s => s.boardId).filter(Boolean))];
        const boardMap    = {};
        if (boardIds.length > 0) {
          try {
            const boardSnaps = await Promise.all(boardIds.map(id => getDoc(doc(db, 'promotionBoards', id))));
            boardSnaps.forEach(s => { if (s.exists()) boardMap[s.id] = { id: s.id, ...s.data() }; });
          } catch (_) {}
        }
        const sortedBoardScores = boardScores.sort((a, b) => {
          const ta = boardMap[a.boardId]?.boardDate?.toMillis?.() || 0;
          const tb = boardMap[b.boardId]?.boardDate?.toMillis?.() || 0;
          return tb - ta;
        });

        // Ribbon awards
        const ribbons = ribbonsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        setMyRecords({ sizeRecord, fitnessByCycle, fundraiserTotal, fundraiserCount, boardScores: sortedBoardScores, boardMap, ribbons });
      } catch (err) {
        console.warn('My Records fetch failed:', err);
        if (!cancelled) setMyRecords({});
      }
    }

    fetchMyRecords();
    return () => { cancelled = true; };
  }, [user]);

  // Persisted across retries so we can .clear() before creating a new instance.
  const enrollRecaptchaRef = useRef(null);

  // MFA / 2FA enrollment state
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaFactor, setMfaFactor] = useState(null);
  // 'idle' | 'entering-phone' | 'entering-code'
  const [mfaStep, setMfaStep] = useState('idle');
  const [mfaPhone, setMfaPhone] = useState('');    // Firebase format: +1XXXXXXXXXX
  const [phoneDisplay, setPhoneDisplay] = useState(''); // formatted display: (XXX) XXX-XXXX
  const [mfaCode, setMfaCode] = useState('');
  const [mfaVerificationId, setMfaVerificationId] = useState('');
  const [mfaStatus, setMfaStatus] = useState(null); // null | 'sending' | 'verifying' | 'success' | error string

  // Push notifications
  // 'checking' | 'unsupported' | 'blocked' | 'enabled' | 'disabled'
  const [notifStatus,  setNotifStatus]  = useState('checking');
  const [notifLoading, setNotifLoading] = useState(false);
  const [activeToken,  setActiveToken]  = useState(null); // current FCM token for this device

  // Email announcement preference — absent field means opted in (true)
  const [emailAnnouncements, setEmailAnnouncements] = useState(true);
  const [emailAnnouncementsLoading, setEmailAnnouncementsLoading] = useState(false);
  useEffect(() => {
    if (userData) setEmailAnnouncements(userData.emailAnnouncements !== false);
  }, [userData?.emailAnnouncements]);

  const resetCooldownSeconds = Math.max(0, Math.ceil((resetCooldownUntil - now) / 1000));

  // Only ticks while an actual cooldown is running - not on every render.
  useEffect(() => {
    if (resetCooldownSeconds <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resetCooldownSeconds > 0]);

  useEffect(() => {
    setPhone(userData?.phone || '');
  }, [userData?.phone]);

  useEffect(() => {
    if (userData) {
      setDossier({ bio: userData.bio || '', practiceDays: userData.practiceDays || '' });
    }
  }, [userData?.bio, userData?.practiceDays]);

  useEffect(() => {
    setLoginEmail(user?.email || '');
  }, [user?.email]);

  // Detect push notification support and current opt-in state on mount.
  useEffect(() => {
    if (!user) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setNotifStatus('unsupported');
      return;
    }
    const perm = Notification.permission;
    if (perm === 'denied') { setNotifStatus('blocked'); return; }
    if (perm === 'granted') {
      // Silently refresh the stored token so stale tokens don't linger.
      getCurrentToken().then(tok => {
        if (tok) {
          setActiveToken(tok);
          setNotifStatus('enabled');
          // Ensure the token is stored (handles the case where storage was
          // cleared but the browser still has the same granted permission).
          import('../lib/fcm').then(({ requestAndStoreToken: store }) =>
            store(user.uid).catch(() => {})
          );
        } else {
          setNotifStatus('disabled');
        }
      }).catch(() => setNotifStatus('disabled'));
    } else {
      setNotifStatus('disabled');
    }
  }, [user?.uid]);

  // Reflect current MFA enrollment whenever the auth user object updates.
  useEffect(() => {
    if (!user) return;
    const factors = multiFactor(user).enrolledFactors;
    if (factors.length > 0) {
      setMfaEnrolled(true);
      setMfaFactor(factors[0]);
    } else {
      setMfaEnrolled(false);
      setMfaFactor(null);
    }
  }, [user]);

  const handleUpdateDossier = async (e) => {
    e.preventDefault();
    if (!user) return;
    setDossierSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { ...dossier, updatedAt: new Date() });
      setDossierSaved(true);
      setTimeout(() => setDossierSaved(false), 3000);
    } catch (err) {
      console.error('Dossier update failed:', err);
    } finally {
      setDossierSaving(false);
    }
  };

  const handlePortraitUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;
    setUploadingPortrait(true);
    setPortraitError(null);
    try {
      const data = await uploadToCloudinary(file, 'image');
      if (userData?.portraitAssignedByStaff) {
        // Staff-assigned photo is authoritative — new uploads go pending for approval
        await updateDoc(doc(db, 'users', user.uid), {
          portraitPending: data.secure_url,
          portraitPendingAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "users", user.uid), { portrait: data.secure_url });
      }
    } catch (err) {
      console.error("Portrait upload failed:", err);
      setPortraitError(err.message || 'Upload failed. Try a JPEG, PNG, WebP, or HEIC image.');
    } finally {
      setUploadingPortrait(false);
    }
  };

  const handleCancelPendingPortrait = async () => {
    if (!user) return;
    setCancellingPending(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        portraitPending: deleteField(),
        portraitPendingAt: deleteField(),
      });
    } catch (err) {
      console.error('Cancel pending portrait failed:', err);
    } finally {
      setCancellingPending(false);
    }
  };

  const handleRemovePortrait = async () => {
    if (!user) return;
    const ok = await confirm('Remove your profile photo? Your initials will show instead.', { title: 'Remove Photo', destructive: true });
    if (!ok) return;
    setRemovingPortrait(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { portrait: deleteField() });
    } catch (err) {
      console.error('Portrait remove failed:', err);
    } finally {
      setRemovingPortrait(false);
    }
  };

  const handleSavePhone = async (e) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { phone });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Profile update failed:", err);
    } finally {
      setSaving(false);
    }
  };

  // Changes the actual Firebase Auth email you sign in with, via a
  // server-side endpoint (the client SDK can't change a user's own email
  // without a very recent re-login, and this avoids that friction). The
  // endpoint also sends both notification emails itself.
  const handleUpdateLoginEmail = async (e) => {
    e.preventDefault();
    if (!user || !loginEmail.trim()) return;
    setLoginEmailStatus('saving');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ targetUid: user.uid, newEmail: loginEmail.trim().toLowerCase() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update login email');
      setLoginEmailStatus('success');
      setTimeout(() => setLoginEmailStatus(null), 3000);
    } catch (err) {
      setLoginEmailStatus(err.message || 'error');
    }
  };

  // Generates the reset link AND sends it via a custom HTML template, both
  // server-side (api/admin-update-account.js) - the raw link never reaches
  // this browser, since it's a live account-takeover credential otherwise.
  const handlePasswordReset = async () => {
    if (!user || resetStatus === 'sending' || resetCooldownSeconds > 0) return;
    // Set immediately, before any network call - otherwise the button looks
    // unresponsive during the request and invites exactly the repeated
    // clicking that caused a burst of duplicate emails last time.
    setResetStatus('sending');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'reset-password', targetUid: user.uid })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate reset link');
      setResetStatus('success');
      setNow(Date.now());
      setResetCooldownUntil(Date.now() + 60_000);
      setTimeout(() => setResetStatus(null), 5000);
    } catch (err) {
      // Firebase's own server-side rate limit on generating reset links -
      // separate from (and outlasting) our 60s cooldown above. There's no
      // way to know its exact remaining window, so show a longer active
      // countdown instead of a raw error code sitting there indefinitely.
      if ((err.message || '').includes('EXCEED_LIMIT')) {
        setResetStatus(null);
        setNow(Date.now());
        setResetCooldownUntil(Date.now() + 5 * 60_000);
        return;
      }
      setResetStatus(err.message || 'error');
    }
  };

  // Permanently deletes your own account (Firebase Auth user + Firestore
  // record) via the same server endpoint used for admin actions - typed
  // confirmation since this is irreversible, then sign out and leave.
  const handleDeleteAccount = async () => {
    if (!user) return;
    const typed = window.prompt('This permanently deletes your account and cannot be undone. Type DELETE to confirm.');
    if (typed !== 'DELETE') return;
    setDeleteAccountStatus('working');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'delete-account', targetUid: user.uid })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete account');
      await signOut(auth);
      navigate('/');
    } catch (err) {
      setDeleteAccountStatus(err.message || 'error');
    }
  };

  // ── MFA enrollment ───────────────────────────────────────────────────────

  // Step 1 — send SMS to the supplied phone number.
  // Formats a raw phone input into (XXX) XXX-XXXX and derives the Firebase
  // +1XXXXXXXXXX format in parallel. Strips the leading country code if the
  // user pastes in a +1 or 1-prefixed number (11 digits).
  const handlePhoneInput = (e) => {
    let digits = e.target.value.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    digits = digits.slice(0, 10);

    let display = '';
    if (digits.length > 0) display = '(' + digits.slice(0, 3);
    if (digits.length > 3) display += ') ' + digits.slice(3, 6);
    if (digits.length > 6) display += '-' + digits.slice(6, 10);

    setPhoneDisplay(display);
    setMfaPhone(digits.length === 10 ? `+1${digits}` : '');
  };

  const handleSendEnrollCode = async (e) => {
    e.preventDefault();
    if (!user) return;
    setMfaStatus('sending');
    try {
      const session = await multiFactor(user).getSession();
      // Clear any stale verifier before creating a new one.
      if (enrollRecaptchaRef.current) {
        enrollRecaptchaRef.current.clear();
        enrollRecaptchaRef.current = null;
      }
      const recaptchaVerifier = new RecaptchaVerifier(auth, 'enroll-recaptcha-container', { size: 'invisible' });
      enrollRecaptchaRef.current = recaptchaVerifier;
      const phoneAuthProvider = new PhoneAuthProvider(auth);
      const verificationId = await phoneAuthProvider.verifyPhoneNumber(
        { phoneNumber: mfaPhone, session },
        recaptchaVerifier
      );
      setMfaVerificationId(verificationId);
      setMfaStep('entering-code');
      setMfaStatus(null);
    } catch (err) {
      if (err.code === 'auth/unverified-email') {
        // Firebase requires a verified email before enrolling phone MFA.
        // Generate the OOB link server-side and send via our branded EmailJS
        // template — bypasses Firebase's own plain verification email.
        try {
          const idToken = await user.getIdToken();
          await fetch('/api/admin-update-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ type: 'send-verify-email', targetUid: user.uid }),
          });
          setMfaStatus('verify-email');
        } catch {
          setMfaStatus('Your email must be verified before enabling 2FA. Check your inbox for a verification email.');
        }
      } else if (err.code === 'auth/requires-recent-login') {
        setMfaStatus('Please sign out and sign back in, then try enrolling again.');
      } else {
        setMfaStatus(err.message || 'Failed to send code. Check the number and try again.');
      }
    }
  };

  // Step 2 — verify the SMS code and finalize enrollment.
  const handleConfirmEnroll = async (e) => {
    e.preventDefault();
    setMfaStatus('verifying');
    try {
      const cred = PhoneAuthProvider.credential(mfaVerificationId, mfaCode);
      const assertion = PhoneMultiFactorGenerator.assertion(cred);
      await multiFactor(user).enroll(assertion, 'Phone');
      const enrolled = multiFactor(user).enrolledFactors;
      setMfaEnrolled(true);
      setMfaFactor(enrolled[0] ?? null);
      setMfaStep('idle');
      setMfaCode('');
      setMfaPhone('');
      setPhoneDisplay('');
      setMfaStatus('success');

      // Fire-and-forget confirmation email — don't block the UI on it.
      user.getIdToken().then((idToken) =>
        fetch('/api/admin-update-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            type: 'mfa-enrolled',
            targetUid: user.uid,
            maskedPhone: enrolled[0]?.phoneNumber ?? '',
          }),
        }).catch((err) => console.error('MFA enrollment email failed:', err))
      );

      setTimeout(() => {
        setMfaStatus(null);
        // If they were redirected here because 2FA is required, send them
        // back to the dashboard now that enrollment is complete.
        if (mfaRequired) navigate('/admin/dashboard');
      }, 1500);
    } catch (err) {
      setMfaStatus(
        err.code === 'auth/invalid-verification-code'
          ? 'Incorrect code — check your SMS and try again.'
          : err.message || 'Enrollment failed. Please try again.'
      );
    }
  };

  // Unenroll — removes the enrolled phone factor.
  const handleUnenroll = async () => {
    if (!user || !mfaFactor) return;
    const confirmed = await confirm('Remove two-factor authentication? You can re-enroll at any time from your profile.', { title: 'Remove 2FA', destructive: false });
    if (!confirmed) return;
    setMfaStatus('working');
    try {
      await multiFactor(user).unenroll(mfaFactor);
      setMfaEnrolled(false);
      setMfaFactor(null);
      setMfaStep('idle');
      setMfaStatus(null);
    } catch (err) {
      setMfaStatus(err.message || 'Failed to remove 2FA. Try again.');
    }
  };

  // ── Push notification handlers ──────────────────────────────────────────────

  const handleEnableNotifications = async () => {
    if (!user) return;
    setNotifLoading(true);
    try {
      const token = await requestAndStoreToken(user.uid);
      if (token) {
        setActiveToken(token);
        setNotifStatus('enabled');
      } else if (Notification.permission === 'denied') {
        setNotifStatus('blocked');
      }
    } catch (err) {
      console.error('FCM enable failed:', err);
    } finally {
      setNotifLoading(false);
    }
  };

  const handleDisableNotifications = async () => {
    if (!user) return;
    setNotifLoading(true);
    try {
      await removeAndClearToken(user.uid, activeToken);
      setActiveToken(null);
      setNotifStatus('disabled');
    } catch (err) {
      console.error('FCM disable failed:', err);
    } finally {
      setNotifLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-blue-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 pt-24 px-6 pb-20 transition-colors duration-300">
      <div className="max-w-2xl mx-auto">
        <Link to="/admin/dashboard" className="flex items-center gap-2 text-slate-400 dark:text-slate-500 hover:text-yellow-600 dark:hover:text-yellow-500 mb-8 text-[10px] font-black uppercase tracking-widest transition-colors">
          <ArrowLeft size={14} /> Back to Command
        </Link>

        <div className="flex items-center gap-5 mb-8">
          <label className="relative w-16 h-16 shrink-0 rounded-full cursor-pointer group" title={userData?.portraitAssignedByStaff ? 'Request photo change' : 'Change portrait'}>
            {userData?.portraitPending ? (
              <img src={userData.portraitPending} alt="" className="w-16 h-16 rounded-full object-cover opacity-70 ring-2 ring-yellow-500/50" />
            ) : userData?.portrait ? (
              <img src={userData.portrait} alt="" className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-yellow-500 text-slate-950 flex items-center justify-center text-xl font-black uppercase">
                {getInitials(userData?.fullName) || '?'}
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
              {uploadingPortrait ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} />}
            </div>
            {!userData?.portraitPending && (
              <input type="file" accept="image/*" className="hidden" onChange={handlePortraitUpload} disabled={uploadingPortrait} />
            )}
          </label>
          <div>
            <h1 className="text-3xl font-black uppercase italic tracking-tighter"><ScrambleText text="My Profile" trigger="mount" /></h1>
            {portraitError && (
              <p className="text-red-500 text-[10px] font-bold mt-1 max-w-xs">{portraitError}</p>
            )}
            <p className="text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
              {userData?.rank} &middot; {ROLE_LABELS[role] || role?.replace('_', ' ')}
            </p>
          </div>
        </div>

        {/* PERSONNEL RECORD */}
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none mb-6">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-6">Personnel Record</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Full Name</p>
              <p className="text-sm font-bold">{userData?.fullName || '—'}</p>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Rank</p>
              <p className="text-sm font-bold">{userData?.rank || '—'}</p>
            </div>
            {userData?.accountType !== 'instructor' && (
              <div>
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Company</p>
                <p className="text-sm font-bold">
                  {normalizeCompany(userData?.company) || '—'}
                </p>
              </div>
            )}
            {userData?.accountType !== 'instructor' && userData?.company && !isHQCompany(userData.company) && (
              <div>
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Platoon / Squad</p>
                <p className="text-sm font-bold">{userData?.platoon || '—'} &middot; {userData?.squad || '—'}</p>
              </div>
            )}
            {userData?.accountType !== 'instructor' && isHQCompany(userData?.company) && userData?.secondaryCompany && (
              <div>
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Class Period Company</p>
                <p className="text-sm font-bold">{userData.secondaryCompany} Company
                  <span className="ml-2 text-[9px] font-black uppercase text-slate-400 dark:text-slate-500">(Observer)</span>
                </p>
              </div>
            )}
            <div className="sm:col-span-2 flex items-center gap-2">
              <Mail size={14} className="text-slate-400 dark:text-slate-500" />
              <p className="text-sm font-bold">{user?.email}</p>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest mt-6 pt-6 border-t border-slate-100 dark:border-white/5">
            {userData?.accountType === 'instructor'
              ? 'Rank and role are managed by portal administrators.'
              : 'Rank, role, and unit assignment are managed by battalion staff. Contact S1 to request a change.'}
          </p>
        </div>

        {/* PROFILE PICTURE */}
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none mb-6">
          <div className="flex items-center gap-3 mb-6">
            <Camera size={16} className="text-yellow-500" />
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Profile Photo</h2>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Large portrait preview */}
            <div className="relative shrink-0">
              {userData?.portraitPending ? (
                <div className="relative">
                  <img src={userData.portraitPending} alt="Pending" className="w-28 h-28 rounded-2xl object-cover border-2 border-yellow-500/40 shadow-md opacity-80" />
                  <div className="absolute inset-0 rounded-2xl bg-yellow-500/20 flex items-end justify-center pb-2">
                    <span className="text-[8px] font-black uppercase tracking-widest bg-yellow-500 text-slate-950 px-2 py-0.5 rounded-full">
                      Pending
                    </span>
                  </div>
                </div>
              ) : userData?.portrait ? (
                <img src={userData.portrait} alt={userData?.fullName || ''} className="w-28 h-28 rounded-2xl object-cover border border-slate-200 dark:border-white/10 shadow-md" />
              ) : (
                <div className="w-28 h-28 rounded-2xl bg-yellow-500 text-slate-950 flex items-center justify-center text-4xl font-black uppercase shadow-md">
                  {getInitials(userData?.fullName) || '?'}
                </div>
              )}
            </div>

            {/* Actions + description */}
            <div className="flex-1 min-w-0 flex flex-col gap-3 w-full">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Your photo appears on the <strong className="text-slate-700 dark:text-slate-300">public Leadership page</strong> if you hold a command or staff position, and is visible to battalion staff in the Command Portal.
              </p>

              {userData?.portraitPending ? (
                <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 space-y-2">
                  <p className="text-[10px] font-black text-yellow-600 dark:text-yellow-400 uppercase tracking-widest">
                    Photo Pending Staff Approval
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Your submitted photo is waiting for a staff member to review it. Your current photo will continue showing until it's approved.
                  </p>
                  <button
                    onClick={handleCancelPendingPortrait}
                    disabled={cancellingPending}
                    className="flex items-center gap-1.5 text-[10px] font-black uppercase text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {cancellingPending ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                    {cancellingPending ? 'Cancelling…' : 'Cancel Submission'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <label className={`flex items-center gap-2 px-5 py-3 rounded-xl font-black uppercase text-xs cursor-pointer transition-all shadow-md shadow-yellow-500/20 ${uploadingPortrait ? 'bg-yellow-500/50 text-slate-950 cursor-not-allowed' : 'bg-yellow-500 hover:bg-yellow-400 text-slate-950'}`}>
                    {uploadingPortrait
                      ? <Loader2 size={14} className="animate-spin" />
                      : <UploadCloud size={14} />
                    }
                    {uploadingPortrait
                      ? 'Uploading…'
                      : userData?.portraitAssignedByStaff
                        ? 'Request Photo Change'
                        : userData?.portrait ? 'Replace Photo' : 'Upload Photo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePortraitUpload}
                      disabled={uploadingPortrait || removingPortrait}
                    />
                  </label>

                  {userData?.portrait && !userData?.portraitAssignedByStaff && (
                    <button
                      onClick={handleRemovePortrait}
                      disabled={removingPortrait || uploadingPortrait}
                      className="flex items-center gap-2 px-5 py-3 rounded-xl font-black uppercase text-xs transition-all bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                    >
                      {removingPortrait ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      {removingPortrait ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
              )}

              {userData?.portraitAssignedByStaff && !userData?.portraitPending && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                  This photo was assigned by staff. A replacement request will go through a quick review.
                </p>
              )}

              {portraitError && (
                <p className="text-[10px] text-red-500 font-bold">{portraitError}</p>
              )}

              <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">
                JPEG, PNG, HEIC, or WebP · Recommended: square crop
              </p>
            </div>
          </div>
        </div>

        {/* MY RECORDS */}
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none mb-6">
          <div className="flex items-center gap-3 mb-6">
            <FileText size={16} className="text-yellow-500" />
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">My Records</h2>
          </div>

          {myRecords === null ? (
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-600 text-xs font-bold">
              <Loader2 size={14} className="animate-spin" /> Loading your records…
            </div>
          ) : (
            <div className="space-y-6">

              {/* Fundraiser */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Fallen Heroes Fundraiser</span>
                </div>
                {myRecords.fundraiserCount > 0 ? (
                  <div className="flex gap-6">
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Total Raised</p>
                      <p className="text-sm font-black text-yellow-500">${myRecords.fundraiserTotal.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Entries</p>
                      <p className="text-sm font-bold">{myRecords.fundraiserCount}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-600 font-bold">No fundraiser entries recorded yet.</p>
                )}
              </div>

              {/* Cadet Challenge */}
              <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Cadet Challenge Fitness</span>
                </div>
                {Object.keys(myRecords.fitnessByCycle ?? {}).length > 0 ? (
                  <div className="space-y-4">
                    {Object.entries(myRecords.fitnessByCycle)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([cycle, r]) => (
                        <div key={cycle} className="bg-slate-50 dark:bg-black/30 rounded-2xl p-4">
                          <p className="text-[9px] font-black uppercase text-yellow-500 tracking-widest mb-3">Cycle {cycle}</p>
                          {r.medicalExempt ? (
                            <p className="text-xs text-slate-400 font-bold">Medical exemption on file.</p>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {[
                                ['Push-Ups', r.pushUps],
                                ['Sit-Ups', r.sitUps],
                                ['Shuttle Run', r.shuttleRun ? `${r.shuttleRun}s` : null],
                                ['One Mile', r.oneMile],
                                ['Sit-N-Reach', r.sitNReach ? `${r.sitNReach} cm` : null],
                              ].map(([label, val]) => val != null && val !== '' ? (
                                <div key={label}>
                                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-0.5">{label}</p>
                                  <p className="text-sm font-bold">{val}</p>
                                </div>
                              ) : null)}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-600 font-bold">No fitness records on file yet.</p>
                )}
              </div>

              {/* Promotion Boards */}
              <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <ClipboardList size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Promotion Board History</span>
                </div>
                {(myRecords.boardScores ?? []).length > 0 ? (
                  <div className="space-y-3">
                    {myRecords.boardScores.map(score => {
                      const board = myRecords.boardMap?.[score.boardId];
                      const dateStr = board?.boardDate?.toDate
                        ? board.boardDate.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : null;
                      const cats = board?.categories || [];
                      return (
                        <div key={score.id} className="bg-slate-50 dark:bg-black/30 rounded-2xl p-4">
                          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <div>
                              <p className="text-xs font-black text-slate-700 dark:text-slate-200">{board?.title || 'Board'}</p>
                              {dateStr && <p className="text-[9px] text-slate-400">{dateStr}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full tabular-nums">
                                {score.totalScore ?? 0} pts
                              </span>
                              {score.extraCredit > 0 && (
                                <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                  +{score.extraCredit} XC
                                </span>
                              )}
                            </div>
                          </div>
                          {cats.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {cats.map(cat => {
                                const val = score.scores?.[cat.id];
                                return (
                                  <div key={cat.id} className="flex items-center justify-between bg-white dark:bg-slate-900/60 rounded-xl px-3 py-1.5">
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mr-2">{cat.label}</p>
                                    <p className={`text-[10px] font-black tabular-nums shrink-0 ${
                                      val === 100 ? 'text-emerald-600 dark:text-emerald-400'
                                      : val === 90  ? 'text-blue-600 dark:text-blue-400'
                                      : val === 80  ? 'text-yellow-600 dark:text-yellow-400'
                                      : val === 0   ? 'text-red-500'
                                      : 'text-slate-300 dark:text-slate-600'
                                    }`}>
                                      {val != null ? val : '—'}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-600 font-bold">No promotion board scores on file yet.</p>
                )}
              </div>

              {/* Ribbon Awards */}
              <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <Award size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Ribbon Awards</span>
                </div>
                {(myRecords.ribbons ?? []).length > 0 ? (
                  <div className="space-y-2">
                    {myRecords.ribbons.map(r => {
                      const isAth = r.ribbon === 'athletic';
                      return (
                        <div key={r.id} className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${isAth ? 'bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20' : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/10'}`}>
                          <div>
                            <p className={`text-xs font-black ${isAth ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                              {isAth ? 'JROTC Athletic Ribbon' : r.ribbon === 'physical_fitness' ? 'JROTC Physical Fitness Ribbon' : (r.ribbon || 'Ribbon')}
                            </p>
                            {r.cycleNumber && <p className="text-[9px] text-slate-400 mt-0.5">Cycle #{r.cycleNumber}</p>}
                          </div>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${r.status === 'issued' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20'}`}>
                            {r.status === 'issued' ? 'Issued' : 'Pending'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-600 font-bold">No ribbon awards on record yet.</p>
                )}
              </div>

              {/* Uniform Sizes */}
              <div className="pt-4 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <Shirt size={13} className="text-slate-400 dark:text-slate-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Uniform Sizes on File</span>
                </div>
                {myRecords.sizeRecord ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {[
                      ['Class B Shirt', myRecords.sizeRecord.classB_shirt],
                      ['Class B Pants', myRecords.sizeRecord.classB_pants],
                      ['PT Shirt', myRecords.sizeRecord.pt_shirt],
                      ['Shoes', myRecords.sizeRecord.shoes],
                      ['Company Shirt', myRecords.sizeRecord.co_shirt],
                      ['Class A Jacket', myRecords.sizeRecord.classA_jacket],
                    ].map(([label, val]) => val ? (
                      <div key={label}>
                        <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-0.5">{label}</p>
                        <p className="text-sm font-bold">{val}</p>
                      </div>
                    ) : null)}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 dark:text-slate-600 font-bold">No uniform sizes on file yet.</p>
                )}
              </div>

              <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest pt-4 border-t border-slate-100 dark:border-white/5">
                To request a correction or deletion of any record above, contact <a href="mailto:info@pbhsjrotc.com" className="text-yellow-500 hover:underline">info@pbhsjrotc.com</a>.
              </p>
            </div>
          )}
        </div>

        {/* PERSONNEL DOSSIER */}
        <form onSubmit={handleUpdateDossier} className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none mb-6 space-y-6">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Personnel Dossier</h2>
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 flex items-center gap-2 tracking-widest">
              <BookOpen size={12} /> Command Biography
            </label>
            <textarea
              value={dossier.bio}
              onChange={(e) => setDossier({ ...dossier, bio: e.target.value })}
              rows={5}
              placeholder="Document your leadership history, achievements, and goals..."
              className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl py-3 px-4 text-sm font-medium resize-none focus:border-yellow-500 outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700"
            />
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 flex items-center gap-2 tracking-widest">
              <Calendar size={12} /> Availability Window
            </label>
            <input
              type="text"
              value={dossier.practiceDays}
              onChange={(e) => setDossier({ ...dossier, practiceDays: e.target.value })}
              placeholder="e.g. Mon–Fri 1500–1630"
              className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl py-3 px-4 text-sm font-bold focus:border-yellow-500 outline-none transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={dossierSaving}
            className={`w-full py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
              dossierSaved ? 'bg-green-500 text-white' : 'bg-yellow-500 text-slate-950 hover:bg-yellow-400'
            }`}
          >
            {dossierSaving ? <Loader2 className="animate-spin" size={14} /> : dossierSaved ? <CheckCircle size={14} /> : <Save size={14} />}
            {dossierSaving ? 'Saving…' : dossierSaved ? 'Saved' : 'Save Dossier'}
          </button>
        </form>

        {/* SETTINGS */}
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none space-y-8">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Settings</h2>

          <form onSubmit={handleSavePhone} className="space-y-3">
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Phone Number</label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600" size={16} />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-bold focus:border-yellow-500 outline-none transition-all"
                />
              </div>
              <button type="submit" disabled={saving} className={`px-6 rounded-xl font-black uppercase text-xs flex items-center gap-2 transition-all ${saved ? 'bg-green-500 text-white' : 'bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50'}`}>
                {saved ? <CheckCircle size={16} /> : <Save size={16} />} {saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </form>

          <form onSubmit={handleUpdateLoginEmail} className="space-y-3 pt-6 border-t border-slate-100 dark:border-white/5">
            <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Login Email</label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600" size={16} />
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-bold focus:border-yellow-500 outline-none transition-all"
                />
              </div>
              <button type="submit" disabled={loginEmailStatus === 'saving'} className={`px-6 rounded-xl font-black uppercase text-xs flex items-center gap-2 whitespace-nowrap transition-all ${loginEmailStatus === 'success' ? 'bg-green-500 text-white' : 'bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50'}`}>
                {loginEmailStatus === 'saving' ? 'Saving...' : loginEmailStatus === 'success' ? <><CheckCircle size={16} /> Updated</> : 'Update'}
              </button>
            </div>
            {loginEmailStatus && loginEmailStatus !== 'saving' && loginEmailStatus !== 'success' && (
              <p className="text-[10px] text-red-500 font-bold">{loginEmailStatus}</p>
            )}
          </form>

          <div className="pt-6 border-t border-slate-100 dark:border-white/5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold">Password</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Reset link sent to {user?.email}</p>
            </div>
            <button onClick={handlePasswordReset} disabled={resetStatus === 'sending' || resetCooldownSeconds > 0} className={`px-6 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 transition-all disabled:opacity-50 ${resetStatus === 'success' ? 'bg-green-500 text-white' : 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
              {resetStatus === 'success' ? <CheckCircle size={16} /> : <KeyRound size={16} />}
              {resetStatus === 'sending' ? 'Sending...' : resetStatus === 'success' ? 'Email Sent' : resetCooldownSeconds > 0 ? `Wait ${formatCooldown(resetCooldownSeconds)}` : 'Reset Password'}
            </button>
          </div>
          {resetStatus && resetStatus !== 'sending' && resetStatus !== 'success' && (
            <p className="text-[10px] text-red-500 font-bold -mt-4">{resetStatus}</p>
          )}
        </div>

        {/* TWO-FACTOR AUTHENTICATION */}
        <div className={`bg-white dark:bg-slate-900 rounded-3xl p-8 shadow-sm dark:shadow-none mt-6 border ${mfaRequired && !mfaEnrolled ? 'border-red-400 dark:border-red-500/40' : 'border-blue-100 dark:border-white/10'}`}>

          {/* Required banner — shown when redirected here by the MFA gate */}
          {mfaRequired && !mfaEnrolled && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6">
              <ShieldOff size={16} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-red-500">Action Required</p>
                <p className="text-[10px] text-red-400 font-bold mt-0.5">
                  Two-factor authentication is required for your role. Enroll below to access the command dashboard.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Two-Factor Authentication</h2>
              {mfaMandatory && (
                <span className="text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                  Required for your role
                </span>
              )}
            </div>
            {mfaEnrolled && (
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-green-500 bg-green-500/10 px-3 py-1 rounded-full">
                <ShieldCheck size={12} /> Active
              </span>
            )}
          </div>

          {/* ── Enrolled: show phone hint + optional unenroll ── */}
          {mfaEnrolled && mfaStep === 'idle' && (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-bold">SMS Verification</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                  {mfaFactor?.phoneInfo
                    ? `Enrolled: ${mfaFactor.phoneInfo.replace(/\d(?=\d{4})/g, '•')}`
                    : 'Phone number enrolled'}
                </p>
              </div>
              {/* Mandatory-role accounts can't unenroll themselves */}
              {mfaMandatory ? (
                <span className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">
                  Contact SAI to remove
                </span>
              ) : (
                <button
                  onClick={handleUnenroll}
                  disabled={mfaStatus === 'working'}
                  className="px-5 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 transition-all disabled:opacity-50 bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-red-500/10 hover:text-red-500"
                >
                  <ShieldOff size={14} />
                  {mfaStatus === 'working' ? 'Removing…' : 'Remove 2FA'}
                </button>
              )}
            </div>
          )}

          {/* ── Not enrolled + idle: prompt to enable ── */}
          {!mfaEnrolled && mfaStep === 'idle' && (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-bold">SMS Verification</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-0.5">
                  {mfaMandatory ? 'Required — enroll your phone number below' : 'Require a one-time code at login'}
                </p>
              </div>
              <button
                onClick={() => setMfaStep('entering-phone')}
                className={`px-5 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 transition-all ${mfaMandatory ? 'bg-yellow-500 text-slate-950 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20' : 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 hover:bg-yellow-500/10 hover:text-yellow-600 dark:hover:text-yellow-500'}`}
              >
                <Smartphone size={14} /> {mfaMandatory ? 'Enroll Now' : 'Enable 2FA'}
              </button>
            </div>
          )}

          {/* ── Step 1: Enter phone number ── */}
          {mfaStep === 'entering-phone' && (
            <form onSubmit={handleSendEnrollCode} className="space-y-4">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                Enter the phone number that will receive verification codes.
              </p>
              <div className="relative">
                <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600" size={16} />
                <input
                  type="tel"
                  required
                  placeholder="(555) 000-0000"
                  value={phoneDisplay}
                  onChange={handlePhoneInput}
                  className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm font-bold focus:border-yellow-500 outline-none transition-all"
                  autoFocus
                />
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold -mt-2">
                US number — +1 country code added automatically
              </p>
              <div className="flex gap-3">
                {/* Only show cancel if not in required-enrollment flow */}
                {!mfaRequired && (
                  <button
                    type="button"
                    onClick={() => { setMfaStep('idle'); setMfaStatus(null); setMfaPhone(''); setPhoneDisplay(''); }}
                    className="flex-1 py-3 rounded-xl font-black uppercase text-xs bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={mfaStatus === 'sending'}
                  className="flex-1 py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50 transition-all"
                >
                  {mfaStatus === 'sending' ? <Loader2 className="animate-spin" size={14} /> : <Smartphone size={14} />}
                  {mfaStatus === 'sending' ? 'Sending…' : 'Send Code'}
                </button>
              </div>
              {/* Invisible reCAPTCHA anchor for enrollment */}
              <div id="enroll-recaptcha-container" />
            </form>
          )}

          {/* ── Step 2: Enter SMS code ── */}
          {mfaStep === 'entering-code' && (
            <form onSubmit={handleConfirmEnroll} className="space-y-4">
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                Enter the 6-digit code sent to {mfaPhone}.
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-DIGIT CODE"
                maxLength={6}
                required
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl py-3 px-4 text-sm font-black tracking-[0.4em] text-center focus:border-yellow-500 outline-none transition-all"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setMfaStep('entering-phone'); setMfaStatus(null); setMfaCode(''); }}
                  className="flex-1 py-3 rounded-xl font-black uppercase text-xs bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 transition-all"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={mfaStatus === 'verifying' || mfaCode.length < 6}
                  className="flex-1 py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 bg-yellow-500 text-slate-950 hover:bg-yellow-400 disabled:opacity-50 transition-all"
                >
                  {mfaStatus === 'verifying' ? <Loader2 className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
                  {mfaStatus === 'verifying' ? 'Verifying…' : 'Enable 2FA'}
                </button>
              </div>
            </form>
          )}

          {/* Email verification required banner */}
          {mfaStatus === 'verify-email' && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-4 mt-3 space-y-2">
              <p className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500">Verify your email first</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold leading-relaxed">
                A verification link was sent to <span className="text-slate-900 dark:text-white">{user?.email}</span>. Click it, then come back and try enrolling again.
              </p>
              <button
                onClick={async () => {
                  const idToken = await user.getIdToken();
                  await fetch('/api/admin-update-account', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                    body: JSON.stringify({ type: 'send-verify-email', targetUid: user.uid }),
                  });
                }}
                className="text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 hover:underline"
              >
                Resend email
              </button>
            </div>
          )}

          {/* Status messages */}
          {mfaStatus && mfaStatus !== 'sending' && mfaStatus !== 'verifying' && mfaStatus !== 'working' && mfaStatus !== 'verify-email' && (
            <p className={`text-[10px] font-bold mt-3 ${mfaStatus === 'success' ? 'text-green-500' : 'text-red-500'}`}>
              {mfaStatus === 'success' ? '✓ Two-factor authentication enabled.' : mfaStatus}
            </p>
          )}

          {mfaStep === 'idle' && (
            <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest mt-5 pt-5 border-t border-slate-100 dark:border-white/5">
              {mfaMandatory
                ? 'Required for battalion staff (S1–S7) and all command ranks. Contact SAI to remove an enrolled factor.'
                : "When enabled, you'll be asked for a code from your phone each time you log in."}
            </p>
          )}
        </div>

        {/* APPEARANCE */}
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none mt-6">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">Appearance</h2>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mb-4">Color Theme</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'light', label: 'Light', Icon: Sun },
              { value: 'system', label: 'System', Icon: Monitor },
              { value: 'dark', label: 'Dark', Icon: Moon },
            ].map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex flex-col items-center gap-2 py-4 rounded-2xl border text-xs font-black uppercase tracking-widest transition-all ${
                  theme === value
                    ? 'bg-yellow-500 border-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                    : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/10 text-slate-500 hover:border-yellow-500/40'
                }`}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* PUSH NOTIFICATIONS */}
        {notifStatus !== 'unsupported' && (
          <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none mt-6">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">Push Notifications</h2>
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div className="flex-1 min-w-0">
                {notifStatus === 'enabled' && (
                  <>
                    <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Bell size={15} className="text-yellow-500 shrink-0" /> Notifications enabled
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
                      This device will receive announcements and alerts from command staff.
                    </p>
                  </>
                )}
                {notifStatus === 'disabled' && (
                  <>
                    <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <BellOff size={15} className="text-slate-400 shrink-0" /> Notifications off
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
                      Enable to receive announcements directly on this device.
                    </p>
                  </>
                )}
                {notifStatus === 'blocked' && (
                  <>
                    <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <BellOff size={15} className="text-red-500 shrink-0" /> Notifications blocked
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
                      Your browser is blocking notifications. Go to your browser settings → Site permissions → Notifications → allow pbhsjrotc.com.
                    </p>
                  </>
                )}
                {notifStatus === 'checking' && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" /> Checking…
                  </p>
                )}
              </div>
              {notifStatus === 'enabled' && (
                <button
                  onClick={handleDisableNotifications}
                  disabled={notifLoading}
                  className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-50"
                >
                  {notifLoading ? <Loader2 size={12} className="animate-spin" /> : <BellOff size={13} />}
                  Disable
                </button>
              )}
              {notifStatus === 'disabled' && (
                <button
                  onClick={handleEnableNotifications}
                  disabled={notifLoading}
                  className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all bg-yellow-500 text-slate-950 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20 disabled:opacity-50"
                >
                  {notifLoading ? <Loader2 size={12} className="animate-spin" /> : <Bell size={13} />}
                  Enable
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Email Announcements ── */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-sm dark:shadow-none mt-6">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">Email Announcements</h2>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="flex-1 min-w-0">
              {emailAnnouncements ? (
                <>
                  <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <MailCheck size={15} className="text-yellow-500 shrink-0" /> Email notifications on
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
                    You will receive an email when a broadcast or company announcement is posted.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <MailX size={15} className="text-slate-400 shrink-0" /> Email notifications off
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest mt-1">
                    You will not receive announcement emails. Push notifications are unaffected.
                  </p>
                </>
              )}
            </div>
            <button
              disabled={emailAnnouncementsLoading}
              onClick={async () => {
                setEmailAnnouncementsLoading(true);
                try {
                  const next = !emailAnnouncements;
                  await updateDoc(doc(db, 'users', user.uid), { emailAnnouncements: next });
                  setEmailAnnouncements(next);
                } catch (err) { console.error('Email pref update failed:', err); }
                finally { setEmailAnnouncementsLoading(false); }
              }}
              className={`shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 ${
                emailAnnouncements
                  ? 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10'
                  : 'bg-yellow-500 text-slate-950 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20'
              }`}
            >
              {emailAnnouncementsLoading ? <Loader2 size={12} className="animate-spin" /> : emailAnnouncements ? <MailX size={13} /> : <MailCheck size={13} />}
              {emailAnnouncements ? 'Opt Out' : 'Opt In'}
            </button>
          </div>
        </div>

        {/* DANGER ZONE */}
        <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-500/20 rounded-3xl p-8 shadow-sm dark:shadow-none mt-6">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-red-500 mb-6">Danger Zone</h2>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold">Delete Account</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">Permanently removes your login and personnel record. Cannot be undone.</p>
            </div>
            <button
              onClick={handleDeleteAccount}
              disabled={deleteAccountStatus === 'working'}
              className="px-6 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 transition-all disabled:opacity-50 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white"
            >
              <Trash2 size={16} /> {deleteAccountStatus === 'working' ? 'Deleting...' : 'Delete My Account'}
            </button>
          </div>
          {deleteAccountStatus && deleteAccountStatus !== 'working' && (
            <p className="text-[10px] text-red-500 font-bold mt-4">{deleteAccountStatus}</p>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default MyProfile;
