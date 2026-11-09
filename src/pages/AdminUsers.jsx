import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, doc, updateDoc, onSnapshot, query, where,
  addDoc, serverTimestamp, deleteDoc, getDocs, getDoc, setDoc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import {
  UserCog, Search, CheckCircle2,
  Loader2, UserPlus, User, X, Edit3, KeyRound, Ban, Trash2,
  ShieldCheck, ShieldOff, ShieldAlert, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ROLE_HIERARCHY, ROLE_LABELS, ADMIN_LEVEL, STAFF_LEVEL,
  JROTC_RANKS, JROTC_POSITIONS, POSITION_RANKS,
  COMPANY_HQ_LOCKED_POSITIONS, COMPANY_HQ_DEFAULT_POSITIONS, NO_SQUAD_POSITIONS,
  rankExceedsMax,
  MILITARY_RANKS, INSTRUCTOR_POSITIONS,
} from '../constants';
import { useCompanies } from '../hooks/useCompanies';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';
import { RosterRowSkeleton } from '../components/Skeleton';

// ── BC Role Override Panel ─────────────────────────────────────────────────────
// Shown to the Battalion Commander only. Allows temporary dual-role permission
// for XO and/or CSM (e.g. during a transition year with 2 XOs).
// The override is stored in settings/roleOverrides and read by handleAction.
function BcRoleOverridePanel() {
  const [overrides, setOverrides]   = useState({ allowDualXO: false, allowDualCSM: false });
  const [saving,    setSaving]      = useState(null); // 'allowDualXO' | 'allowDualCSM' | null

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'roleOverrides'), (snap) => {
      if (snap.exists()) setOverrides(snap.data());
    });
    return () => unsub();
  }, []);

  const toggle = async (key) => {
    setSaving(key);
    try {
      const next = !overrides[key];
      await setDoc(doc(db, 'settings', 'roleOverrides'), { ...overrides, [key]: next }, { merge: true });
    } catch (err) {
      console.error('Override toggle failed:', err);
    } finally {
      setSaving(null);
    }
  };

  const OverrideRow = ({ roleKey, label, settingKey }) => {
    const active  = overrides[settingKey];
    const loading = saving === settingKey;
    return (
      <div className="flex items-center justify-between gap-4 py-2.5">
        <div>
          <p className="text-xs font-black text-slate-800 dark:text-slate-200">{label}</p>
          <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
            {active ? 'Dual assignment permitted this cycle' : 'Single-holder limit enforced'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggle(settingKey)}
          disabled={loading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
            active
              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30'
              : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10'
          }`}
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          {active ? 'ON' : 'OFF'}
        </button>
      </div>
    );
  };

  return (
    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-4 mt-1">
      <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-3">
        <ShieldCheck size={10} /> BC Override — Dual Role Permissions
      </p>
      <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-3 leading-relaxed">
        Enabling an override allows a second account to hold that role temporarily (e.g. during a leadership transition). The override is global and affects all assignments until you turn it off.
      </p>
      <div className="divide-y divide-amber-200 dark:divide-amber-500/20">
        <OverrideRow label="Allow 2nd Battalion XO" settingKey="allowDualXO" />
        <OverrideRow label="Allow 2nd Battalion CSM" settingKey="allowDualCSM" />
      </div>
    </div>
  );
}

// Requires the military roster convention: "LASTNAME, FIRSTNAME" (each side
// may be multiple words, e.g. "DE ALMEIDA, ARTHURO").
const FULL_NAME_PATTERN = /^[A-Za-z'-]+(?:\s+[A-Za-z'-]+)*,\s*[A-Za-z'-]+(?:\s+[A-Za-z'-]+)*$/;

const formatCooldown = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const AdminUsers = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  
  const [personnel, setPersonnel] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginEmailStatus, setLoginEmailStatus] = useState(null);
  const [resetPasswordStatus, setResetPasswordStatus] = useState(null);
  const [resetMfaStatus, setResetMfaStatus] = useState(null);
  const [suspendStatus, setSuspendStatus] = useState(null);
  const [deleteAccountStatus, setDeleteAccountStatus] = useState(null);
  // Keyed by target uid, not global - resetting one cadet's password
  // shouldn't block resetting a different cadet's right after.
  const [resetCooldowns, setResetCooldowns] = useState({});
  const [now, setNow] = useState(Date.now());
  const [isSaving, setIsSaving] = useState(false);

  // Access code management (admin only)
  const [codeInput, setCodeInput] = useState('');
  const [codeSaving, setCodeSaving] = useState(false);
  const [codeStatus, setCodeStatus] = useState(null); // null | 'saved' | 'error'

  const resetCooldownSeconds = editingRecord
    ? Math.max(0, Math.ceil(((resetCooldowns[editingRecord.id] || 0) - now) / 1000))
    : 0;

  useEffect(() => {
    if (resetCooldownSeconds <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resetCooldownSeconds > 0]);

  const userLevel = ROLE_HIERARCHY[role] || 0;
  const isAuthorized = userLevel >= STAFF_LEVEL;
  const isBattalionStaff = userLevel >= ADMIN_LEVEL || role === 's6_technology' || role === 's1_adjutant';

  // Mirrors api/admin-update-account.js's EMAIL_MANAGER_ROLES - this is just
  // a UI convenience gate, the endpoint itself is the real enforcement.
  const EMAIL_MANAGER_ROLES = [
    'senior_army_instructor', 'army_instructor',
    'battalion_commander', 'battalion_xo', 'battalion_csm', 'sergeant_major',
    's1_adjutant', 's6_technology'
  ];
  const canManageLoginFor = (targetRole) =>
    EMAIL_MANAGER_ROLES.includes(role) && (ROLE_HIERARCHY[targetRole] || 0) < userLevel;

  // Only show roles strictly below the current user's own level — prevents
  // privilege-cloning (setting someone to your own or a higher role).
  const ROLE_OPTIONS = Object.entries(ROLE_LABELS)
    .filter(([slug]) => (ROLE_HIERARCHY[slug] || 0) < userLevel);
  const { companies: COMPANIES } = useCompanies();

  // Dropdown Constants (JROTC_RANKS and POSITION_RANKS imported from constants.js)
  const LET_LEVELS = ["LET 1", "LET 2", "LET 3", "LET 4"];
  const PLATOONS = ["1st Platoon", "2nd Platoon", "3rd Platoon", "Company HQ"];
  const SQUADS = ["1st Squad", "2nd Squad", "3rd Squad", "4th Squad"];
  // JROTC_POSITIONS imported from constants.js — do not duplicate here.

  // Battalion members are HQ staff — they don't belong to a lettered company
  // platoon/squad structure, but they may still attend a class period with
  // one (secondaryCompany). Legacy records with company:"Zulu" are treated
  // identically to "Battalion" throughout.
  const BATTALION_COMPANIES = ['Battalion', 'Zulu'];

  const initialFormState = {
    fullName: '', email: '', company: user?.company || COMPANIES[0] || 'Alpha',
    platoon: '1st Platoon', squad: '1st Squad', rank: 'C/PVT',
    position: 'Squad Member', letLevel: 'LET 1', status: 'Active',
    gender: 'Male', isManual: true, role: 'cadet', secondaryCompany: ''
  };

  const [formData, setFormData] = useState(initialFormState);

  // Must come AFTER formData useState — const is not hoisted, so placing this
  // before its dependency causes a TDZ crash in the production bundle where
  // esbuild preserves declaration order (same fix applied to AdminRoster).
  const platoonAutoLocked = COMPANY_HQ_LOCKED_POSITIONS.includes(formData.position);

  useEffect(() => {
    if (!authLoading && isAuthorized) {
      // No orderBy here on purpose: Firestore silently excludes any document
      // missing the sorted field from the results, so a doc without fullName
      // (e.g. one created via an older path that only set `name`) would
      // vanish from the roster entirely. Sort client-side instead so every
      // account always shows up.
      const q = query(collection(db, "users"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Pending-approval accounts float to the top so they're never
        // missed in a long roster; alphabetical within each group.
        allDocs.sort((a, b) => {
          const pendingDiff = (a.approved === false ? 0 : 1) - (b.approved === false ? 0 : 1);
          if (pendingDiff !== 0) return pendingDiff;
          return (a.fullName || a.name || '').localeCompare(b.fullName || b.name || '');
        });

        const roster = isBattalionStaff
          ? allDocs
          : allDocs.filter(p => p.company === user?.company);

        setPersonnel(roster);
        setRosterLoading(false);
      }, () => setRosterLoading(false));
      return () => unsubscribe();
    }
  }, [authLoading, isAuthorized, user?.company, isBattalionStaff]);

  const handleAction = async (e) => {
    e.preventDefault();

    // Prevent double-submission (double-click on Approve / Add to Roster would
    // pass both byUid and byName empty-checks concurrently and create two roster entries).
    if (isSaving) return;
    setIsSaving(true);

    if (!FULL_NAME_PATTERN.test(formData.fullName.trim())) {
      setIsSaving(false);
      showStatus("Full Name Must Be: LASTNAME, FIRSTNAME");
      return;
    }

    // A staff member saving an edit is treated as reviewing/approving the
    // account - a self-registered signup starts `approved: false` (see
    // SignUp.jsx) and flips to true the first time staff touches the
    // record here, which is also when the welcome email goes out.
    const wasPendingApproval = !!editingRecord && editingRecord.approved === false;
    const roleChanged = !!editingRecord && editingRecord.role !== formData.role;

    const isInstructorRole = ['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role);

    if (!isInstructorRole) {
      // ── LET level / position cross-validation ───────────────────────────────
      // LET 1 → Squad Member only; LET 2+ → cannot be Squad Member.
      if (formData.letLevel === 'LET 1' && formData.position !== 'Squad Member') {
        setIsSaving(false);
        showStatus('LET 1 CADETS CAN ONLY HOLD THE SQUAD MEMBER POSITION. Please correct the position before saving.');
        return;
      }
      if (formData.letLevel && formData.letLevel !== 'LET 1' && formData.position === 'Squad Member') {
        setIsSaving(false);
        showStatus('SQUAD MEMBER IS ONLY AVAILABLE FOR LET 1 CADETS. LET 2–4 CADETS MUST HAVE A DIFFERENT POSITION.');
        return;
      }
      // ── Rank ceiling enforcement ────────────────────────────────────────────
      if (rankExceedsMax(formData.rank, formData.position)) {
        setIsSaving(false);
        showStatus(`${formData.rank} exceeds the authorized max rank (${POSITION_RANKS[formData.position]}) for ${formData.position}. Please select a lower rank.`);
        return;
      }
    }

    // ── Self-approval block ────────────────────────────────────────────────────
    // Prevent a user manager from approving an account whose linkedUid points to
    // their own roster entry — blocks the "create a second account and approve
    // it yourself" exploit. Firestore rules enforce the same check server-side.
    if (wasPendingApproval && editingRecord.linkedUid && editingRecord.linkedUid === user?.uid) {
      setIsSaving(false);
      showStatus('BLOCKED: You cannot approve an account linked to your own roster entry. Ask another staff member to review this account.');
      return;
    }

    // ── Role-limit enforcement for top-level roles ─────────────────────────────
    if (editingRecord && roleChanged) {
      const newRole = formData.role;
      const LIMITED_ROLES = ['battalion_commander', 'battalion_xo', 'battalion_csm'];
      if (LIMITED_ROLES.includes(newRole)) {
        // Count existing accounts already holding this role (excluding the record being edited)
        const snap = await getDocs(
          query(collection(db, 'users'), where('role', '==', newRole))
        );
        const existingHolders = snap.docs.filter(d => d.id !== editingRecord.id);

        if (existingHolders.length >= 1) {
          const holderName = existingHolders[0]?.data()?.fullName || 'another account';
          if (newRole === 'battalion_commander') {
            // Hard block — no override
            setIsSaving(false);
            showStatus(`BLOCKED: Battalion Commander is already assigned to ${holderName}. That role must be revoked before it can be reassigned.`);
            return;
          } else {
            // XO/CSM — check for BC override setting
            const overrideSnap = await getDocs(
              query(collection(db, 'settings'), where('__name__', '==', 'roleOverrides'))
            );
            const overrides = overrideSnap.docs[0]?.data() || {};
            const overrideKey = newRole === 'battalion_xo' ? 'allowDualXO' : 'allowDualCSM';
            if (!overrides[overrideKey]) {
              setIsSaving(false);
              showStatus(`BLOCKED: ${newRole === 'battalion_xo' ? 'Battalion XO' : 'Battalion CSM'} is already assigned to ${holderName}. The Battalion Commander must enable a role override first.`);
              return;
            }
            // Override is active — allow but flag in activity log
            writeLog({
              type: 'account', action: 'duplicate-role-warning',
              description: `⚠️ DUAL ROLE: ${formData.fullName} assigned ${newRole} — ${holderName} already holds this role. BC override is active.`,
              userId: user?.uid || '', userFullName: userData?.fullName || '',
              userRole: role || '', targetId: editingRecord.id, targetName: formData.fullName,
              category: 'security',
            });
          }
        }
      }
    }

    try {
      if (editingRecord) {
        // Route the users-doc write through the server-side Admin SDK so it
        // bypasses the Firestore client security rules. The rules require a
        // cross-document get() of the actor's role; that get() can fail when
        // Firebase Installations is degraded, cascading into permission-denied
        // for legitimate admins. The endpoint re-validates the role ceiling
        // server-side, so we lose no security by moving the write there.
        const saveToken = await user.getIdToken();
        const saveRes = await fetch('/api/admin-update-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saveToken}` },
          body: JSON.stringify({
            type: 'update-user-fields',
            targetUid: editingRecord.id,
            updateFields: formData,
          }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveData.error || 'Failed to save account');
        setEditingRecord(null);
        showStatus("Record Updated");

        // ── Account-change logging ─────────────────────────────────────────
        if (wasPendingApproval) {
          writeLog({
            type: 'account', action: 'approve',
            description: `Approved account for ${formData.fullName} (${formData.role || 'cadet'})`,
            userId: user?.uid || '', userFullName: userData?.fullName || '',
            userRole: role || '', targetId: editingRecord.id, targetName: formData.fullName,
          });
        } else if (roleChanged) {
          writeLog({
            type: 'account', action: 'role_change',
            description: `Changed ${formData.fullName}'s role from ${editingRecord.role} to ${formData.role}`,
            userId: user?.uid || '', userFullName: userData?.fullName || '',
            userRole: role || '', targetId: editingRecord.id, targetName: formData.fullName,
          });
        } else {
          writeLog({
            type: 'account', action: 'update',
            description: `Updated account record for ${formData.fullName}`,
            userId: user?.uid || '', userFullName: userData?.fullName || '',
            userRole: role || '', targetId: editingRecord.id, targetName: formData.fullName,
          });
        }

        // ── Portal-is-master sync ─────────────────────────────────────────
        // If this user account is the master for a linked roster entry, push
        // personal-info fields to that roster doc so both stay in sync.
        // Company/platoon/squad/secondaryCompany are NOT pushed from portal →
        // roster: those are organisational assignments managed exclusively in
        // the roster. Battalion entries (Zulu/Battalion) always have null
        // platoon/squad regardless of what the portal doc says.
        try {
          const BATTALION_COMPANIES = ['Battalion', 'Zulu'];
          const rosterSnap = await getDocs(
            query(collection(db, 'roster'), where('linkedUid', '==', editingRecord.id))
          );
          for (const rosterDoc of rosterSnap.docs) {
            // Account page is always the source of truth for linked roster entries —
            // push all shared fields regardless of syncMaster setting.
            const existingCompany = rosterDoc.data().company;
            const isBn = BATTALION_COMPANIES.includes(existingCompany);
            await updateDoc(rosterDoc.ref, {
              fullName: (formData.fullName || '').trim().toUpperCase() || rosterDoc.data().fullName,
              rank:     formData.rank     || null,
              position: formData.position || null,
              gender:   formData.gender   || null,
              letLevel: formData.letLevel || null,
              // Platoon and squad: pull from account for company entries;
              // battalion entries always have null platoon/squad.
              ...(isBn
                ? { platoon: null, squad: null }
                : { platoon: formData.platoon || null, squad: formData.squad || null }),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (syncErr) {
          // Non-fatal — portal save succeeded; just log the sync miss
          console.warn('Portal→roster sync failed:', syncErr);
        }

        if (wasPendingApproval) {
          try {
            const idToken = await user.getIdToken();
            await fetch('/api/admin-update-account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
              body: JSON.stringify({ type: 'welcome-notification', targetUid: editingRecord.id })
            });
          } catch (notifyErr) {
            console.error('Welcome email failed:', notifyErr);
          }

          // ── Auto-add to battalion roster on first approval ────────────────
          // Check by linkedUid first, then fall back to a name match so we
          // don't create a duplicate if they were already added manually.
          try {
            const [byUid, byName] = await Promise.all([
              getDocs(query(collection(db, 'roster'), where('linkedUid', '==', editingRecord.id))),
              getDocs(query(collection(db, 'roster'),
                where('fullName', '==', (formData.fullName || '').trim().toUpperCase()),
                where('company',  '==', formData.company || '')
              )),
            ]);

            if (byUid.empty && byName.empty) {
              const BATTALION_COMPANIES = ['Battalion', 'Zulu'];
              const isBn = BATTALION_COMPANIES.includes(formData.company || '');
              await addDoc(collection(db, 'roster'), {
                fullName:         (formData.fullName || '').trim().toUpperCase(),
                rank:             formData.rank      || null,
                position:         formData.position  || null,
                company:          formData.company   || null,
                platoon:          isBn ? null : (formData.platoon || null),
                squad:            isBn ? null : (formData.squad   || null),
                gender:           formData.gender    || null,
                letLevel:         formData.letLevel  || null,
                notes:            null,
                linkedUid:        editingRecord.id,
                syncMaster:       'portal',          // portal account is master
                secondaryCompany: null,
                createdAt:        serverTimestamp(),
                updatedAt:        serverTimestamp(),
                createdBy:        user?.uid || '',
              });
            } else if (byUid.empty && !byName.empty) {
              // An unlinked roster entry exists with the same name — just link it.
              await updateDoc(byName.docs[0].ref, {
                linkedUid:  editingRecord.id,
                syncMaster: byName.docs[0].data().syncMaster || 'roster',
                updatedAt:  serverTimestamp(),
              });
            }
          } catch (rosterErr) {
            // Non-fatal — the portal account was approved; roster sync is best-effort.
            console.warn('Auto-roster on approval failed:', rosterErr);
          }
        }
      } else {
        // Staff manually added a new user account — also add them to the roster.
        const newUserRef = await addDoc(collection(db, "users"), {
          ...formData,
          approved: true,
          createdAt: serverTimestamp(),
          createdBy: user.uid
        });

        try {
          const [byUid, byName] = await Promise.all([
            getDocs(query(collection(db, 'roster'), where('linkedUid', '==', newUserRef.id))),
            getDocs(query(collection(db, 'roster'),
              where('fullName', '==', (formData.fullName || '').trim().toUpperCase()),
              where('company',  '==', formData.company || '')
            )),
          ]);

          if (byUid.empty && byName.empty) {
            const BATTALION_COMPANIES = ['Battalion', 'Zulu'];
            const isBn = BATTALION_COMPANIES.includes(formData.company || '');
            await addDoc(collection(db, 'roster'), {
              fullName:         (formData.fullName || '').trim().toUpperCase(),
              rank:             formData.rank      || null,
              position:         formData.position  || null,
              company:          formData.company   || null,
              platoon:          isBn ? null : (formData.platoon || null),
              squad:            isBn ? null : (formData.squad   || null),
              gender:           formData.gender    || null,
              letLevel:         formData.letLevel  || null,
              notes:            null,
              linkedUid:        newUserRef.id,
              syncMaster:       'portal',
              secondaryCompany: null,
              createdAt:        serverTimestamp(),
              updatedAt:        serverTimestamp(),
              createdBy:        user?.uid || '',
            });
          } else if (byUid.empty && !byName.empty) {
            await updateDoc(byName.docs[0].ref, {
              linkedUid:  newUserRef.id,
              syncMaster: byName.docs[0].data().syncMaster || 'roster',
              updatedAt:  serverTimestamp(),
            });
          }
        } catch (rosterErr) {
          console.warn('Auto-roster on manual add failed:', rosterErr);
        }

        setShowAddModal(false);
        showStatus("Cadet Added");
        writeLog({
          type: 'account', action: 'create',
          description: `Manually created account for ${formData.fullName} (${formData.role || 'cadet'}, ${formData.company || ''})`,
          userId: user?.uid || '', userFullName: userData?.fullName || '',
          userRole: role || '', targetId: newUserRef.id, targetName: formData.fullName,
        });
      }
      setFormData(initialFormState);
    } catch (err) {
      console.error('[AdminUsers] Save failed:', err?.code, err?.message, err);
      const code = err?.code || '';
      if (code === 'permission-denied') {
        showStatus('Permission denied — your session may have expired. Sign out and back in.');
      } else {
        showStatus(`Error Saving Record (${code || err?.message || 'unknown'})`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const showStatus = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  };

  // Changes the cadet's actual Firebase Auth login email via a server-side
  // Admin SDK call - the client SDK can only update the signed-in user's own
  // email, not another account's, so this can't be done from the browser
  // alone. The endpoint also sends both notification emails itself.
  const handleUpdateLoginEmail = async (e) => {
    e.preventDefault();
    if (!editingRecord || !loginEmail.trim()) return;
    setLoginEmailStatus('saving');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ targetUid: editingRecord.id, newEmail: loginEmail.trim().toLowerCase() })
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
  // server-side (api/admin-update-account.js, gated the same as Update
  // Login Email) - the raw link never reaches this browser, since it's a
  // live account-takeover credential otherwise. The endpoint resolves the
  // target's real current email itself rather than trusting
  // editingRecord.email, so this always lands on the account that's
  // actually signed in.
  const handleResetPassword = async () => {
    if (!editingRecord || resetCooldownSeconds > 0) return;
    setResetPasswordStatus('sending');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'reset-password', targetUid: editingRecord.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate reset link');
      setResetPasswordStatus('success');
      setNow(Date.now());
      setResetCooldowns(prev => ({ ...prev, [editingRecord.id]: Date.now() + 60_000 }));
      setTimeout(() => setResetPasswordStatus(null), 3000);
    } catch (err) {
      // Firebase's own server-side rate limit on generating reset links -
      // separate from (and outlasting) our 60s cooldown above. There's no
      // way to know its exact remaining window, so show a longer active
      // countdown instead of a raw error code sitting there indefinitely.
      if ((err.message || '').includes('EXCEED_LIMIT')) {
        setResetPasswordStatus(null);
        setNow(Date.now());
        setResetCooldowns(prev => ({ ...prev, [editingRecord.id]: Date.now() + 5 * 60_000 }));
        return;
      }
      setResetPasswordStatus(err.message || 'error');
    }
  };

  // Strips all enrolled phone MFA factors from the account so the cadet
  // can sign in with email + password only until they re-enroll 2FA.
  const handleResetMfa = async () => {
    if (!editingRecord) return;
    const ok = await confirm(`Remove 2FA enrollment for ${editingRecord.fullName || 'this account'}? They will be able to sign in with just their password until they re-enroll.`, { title: 'Remove 2FA', destructive: false });
    if (!ok) return;
    setResetMfaStatus('working');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'reset-mfa', targetUid: editingRecord.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove 2FA');
      setResetMfaStatus('success');
      setTimeout(() => setResetMfaStatus(null), 3000);
    } catch (err) {
      setResetMfaStatus(err.message || 'error');
    }
  };

  // Disables/re-enables the account's actual Firebase Auth login (blocks
  // sign-in entirely, not just a soft in-app flag) and mirrors the state to
  // Firestore for the roster badge below.
  const handleToggleSuspend = async () => {
    if (!editingRecord) return;
    const suspending = !editingRecord.suspended;
    const ok = await confirm(`${suspending ? 'Suspend' : 'Reactivate'} ${editingRecord.fullName || 'this account'}?`, { title: suspending ? 'Suspend Account' : 'Reactivate Account', destructive: suspending });
    if (!ok) return;
    setSuspendStatus('working');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'suspend-account', targetUid: editingRecord.id, suspend: suspending })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update suspension status');
      setEditingRecord(prev => prev && ({ ...prev, suspended: suspending }));
      setSuspendStatus('success');
      setTimeout(() => setSuspendStatus(null), 3000);
      writeLog({
        type: 'account', action: suspending ? 'suspend' : 'reactivate',
        description: `${suspending ? 'Suspended' : 'Reactivated'} account for ${editingRecord.fullName}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: editingRecord.id, targetName: editingRecord.fullName,
      });
    } catch (err) {
      setSuspendStatus(err.message || 'error');
    }
  };

  // Shared deletion core — used by both handleDeleteAccount and handleDenyAccount.
  // Removes Firebase Auth + Firestore user doc via the Admin SDK endpoint, then
  // scrubs the email from every team's leadership array.
  // logAction: 'delete' | 'deny'
  const _doDeleteAccount = async (successToast, logAction = 'delete') => {
    setDeleteAccountStatus('working');
    const targetId   = editingRecord.id;
    const targetName = editingRecord.fullName;
    try {
      if (editingRecord.isManual) {
        await deleteDoc(doc(db, 'users', editingRecord.id));
        setEditingRecord(null);
        showStatus(successToast);
        writeLog({
          type: 'account', action: logAction,
          description: logAction === 'deny'
            ? `Denied registration request for ${targetName}`
            : `Deleted account for ${targetName}`,
          userId: user?.uid || '', userFullName: userData?.fullName || '',
          userRole: role || '', targetId, targetName,
        });
        return;
      }
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-update-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ type: 'delete-account', targetUid: editingRecord.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove account');

      // Scrub the deleted email from every special team's leadership array.
      const deletedEmail = editingRecord.email;
      if (deletedEmail) {
        const teamsSnap = await getDocs(collection(db, 'specialTeams'));
        const cleanups = [];
        teamsSnap.forEach(teamDoc => {
          const { leadership = [] } = teamDoc.data();
          const filtered = leadership.filter(l => l.email !== deletedEmail);
          if (filtered.length !== leadership.length)
            cleanups.push(updateDoc(doc(db, 'specialTeams', teamDoc.id), { leadership: filtered }));
        });
        await Promise.all(cleanups);
      }

      setEditingRecord(null);
      showStatus(successToast);
      writeLog({
        type: 'account', action: logAction,
        description: logAction === 'deny'
          ? `Denied registration request for ${targetName}`
          : `Deleted account for ${targetName}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId, targetName,
      });
    } catch (err) {
      setDeleteAccountStatus(err.message || 'error');
    }
  };

  // Permanently deletes an approved account from the Danger Zone.
  const handleDeleteAccount = async () => {
    if (!editingRecord) return;
    const ok = await confirm(`Permanently delete ${editingRecord.fullName || 'this account'}? This cannot be undone.`, { title: 'Delete Account', destructive: true });
    if (!ok) return;
    await _doDeleteAccount('Account Deleted', 'delete');
  };

  // Denies a pending account registration — same deletion logic, different
  // confirmation text and toast so the action reads clearly as a denial.
  const handleDenyAccount = async () => {
    if (!editingRecord) return;
    const ok = await confirm(`Deny ${editingRecord.fullName || 'this account'}'s registration request? This cannot be undone.`, { title: 'Deny Registration', destructive: true });
    if (!ok) return;
    await _doDeleteAccount('Registration Denied', 'deny');
  };

  if (authLoading) return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-yellow-600">
      <Loader2 className="animate-spin" />
    </div>
  );
  
  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={UserCog} title="Accounts" />}
        <div className="flex justify-end -mt-4 mb-8">
          <button
            onClick={() => { setFormData(initialFormState); setShowAddModal(true); }}
            className="bg-yellow-500 text-slate-950 px-6 py-3 rounded-2xl font-black uppercase text-xs flex items-center gap-2 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20 transition-all"
          >
            <UserPlus size={18} /> New Entry
          </button>
        </div>

        {personnel.some(p => p.approved === false) && (
          <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4 flex items-center gap-3">
            <UserPlus size={18} className="text-yellow-600 dark:text-yellow-500 shrink-0" />
            <p className="text-xs font-bold text-yellow-700 dark:text-yellow-500">
              {personnel.filter(p => p.approved === false).length} account{personnel.filter(p => p.approved === false).length === 1 ? '' : 's'} pending approval - review and edit their record below to assign a rank and approve them.
            </p>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search roster by name..." 
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-4 pl-12 rounded-2xl outline-none focus:ring-2 ring-yellow-500/20 transition-all font-bold text-slate-900 dark:text-white shadow-sm"
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Roster List */}
        <div className="grid gap-4">
          {rosterLoading ? (
            <>
              <RosterRowSkeleton />
              <RosterRowSkeleton />
              <RosterRowSkeleton />
              <RosterRowSkeleton />
              <RosterRowSkeleton />
            </>
          ) : personnel.filter(p => (p.fullName || '').toLowerCase().includes(searchTerm.toLowerCase())).map(p => (
             <div key={p.id} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-6 rounded-[2rem] flex flex-wrap items-center justify-between gap-6 hover:shadow-md transition-all">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center border border-slate-200 dark:border-white/5 text-slate-400 dark:text-slate-500">
                        <User size={20}/>
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-black uppercase italic text-lg">{p.fullName || "Unnamed Account"}</h3>
                            {!p.isManual && (
                                <div className="flex items-center gap-1 text-green-600 dark:text-green-500 text-[9px] font-black uppercase">
                                  <CheckCircle2 size={14} /> Verified
                                </div>
                            )}
                            {p.suspended && (
                                <div className="flex items-center gap-1 text-orange-500 text-[9px] font-black uppercase">
                                  <Ban size={14} /> Suspended
                                </div>
                            )}
                            {p.approved === false && (
                                <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-500 text-[9px] font-black uppercase animate-pulse">
                                  <UserPlus size={14} /> Pending Approval
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-[9px] font-black text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded uppercase">{p.rank}</span>
                            <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded uppercase">{p.position}</span>
                            <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded uppercase">{p.platoon}</span>
                            <span className="text-[9px] font-black text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded uppercase">{p.squad}</span>
                            <span className="text-[9px] font-black text-green-700 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded uppercase">
                              {ROLE_LABELS[p.role] || p.role || 'Cadet (Unassigned)'} · Lvl {ROLE_HIERARCHY[p.role] || 0}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button title="Edit personnel record" onClick={() => { setEditingRecord(p); setFormData(p); setLoginEmail(p.email || ''); setLoginEmailStatus(null); setResetPasswordStatus(null); setResetMfaStatus(null); setSuspendStatus(null); setDeleteAccountStatus(null); }} className="p-3 bg-slate-100 dark:bg-white/5 rounded-xl hover:bg-yellow-500 hover:text-slate-950 transition-all text-slate-500">
                      <Edit3 size={18} />
                    </button>
                </div>
             </div>
          ))}
        </div>

      {/* ─── Access Code Management (Admin-level only) ─── */}
      {userLevel >= ADMIN_LEVEL && (
        <div className="mt-12 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-5">
          <div className="flex items-center gap-3 mb-1">
            <ShieldAlert size={18} className="text-yellow-600 dark:text-yellow-500 shrink-0" />
            <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">Battalion Access Code</h3>
          </div>

          <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-[11px] text-yellow-700 dark:text-yellow-300">
            <ShieldAlert size={14} className="flex-shrink-0 mt-0.5" />
            This code gates who can create an account. Changing it is a security event — leadership will be notified via push notification and the activity log will be flagged. Store the new code somewhere safe (e.g. a secure note shared with the SAI) before applying it.
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            The code is never stored as plain text — only its SHA-256 hash is written to Firestore. After saving, the plain text you typed is not recoverable from the portal.
          </p>

          <div className="space-y-2">
            <label className="block text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">New Access Code</label>
            <div className="relative">
              <KeyRound size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Type new code…"
                value={codeInput}
                onChange={e => { setCodeInput(e.target.value); setCodeStatus(null); }}
                className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 pl-10 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white"
              />
            </div>
            {codeStatus === 'saved' && <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mt-1">✓ Code updated — leadership has been notified</p>}
            {codeStatus === 'error' && <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mt-1">✕ Save failed — check your connection and try again</p>}
          </div>

          <button
            disabled={codeSaving || !codeInput.trim()}
            onClick={async () => {
              setCodeSaving(true);
              setCodeStatus(null);
              try {
                // Hash client-side — plaintext never leaves the browser
                const encoded = new TextEncoder().encode(codeInput.trim());
                const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
                const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

                await setDoc(doc(db, 'settings', 'signupCode'), {
                  hash,
                  updatedAt: new Date().toISOString(),
                  updatedBy: userData?.fullName || 'admin',
                });

                // Security-flagged log entry — visible in Admin Log under Security
                writeLog({
                  type: 'account',
                  action: 'access_code_changed',
                  description: `⚑ Battalion signup access code was changed by ${userData?.fullName || 'an admin'}.`,
                  userId: user?.uid || '',
                  userFullName: userData?.fullName || 'admin',
                  userRole: role || '',
                  category: 'security',
                });

                // Push notification to all staff (70+) — non-blocking
                user?.getIdToken?.().then(idToken => {
                  fetch('/api/send-push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      idToken,
                      title: '🔐 Security Alert',
                      body: `Battalion access code was changed by ${userData?.fullName || 'an admin'}. Update your records.`,
                    }),
                  }).catch(() => { /* push failure is non-fatal */ });
                }).catch(() => { /* token error is non-fatal */ });

                setCodeInput('');
                setCodeStatus('saved');
              } catch (err) {
                console.error('Access code save failed:', err);
                setCodeStatus('error');
              } finally {
                setCodeSaving(false);
              }
            }}
            className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {codeSaving ? <Loader2 size={18} className="animate-spin" /> : <ShieldAlert size={18} />}
            {codeSaving ? 'Saving…' : 'Update Access Code'}
          </button>
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {(showAddModal || editingRecord) && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80" onClick={() => { setShowAddModal(false); setEditingRecord(null); }} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-8 md:p-10 rounded-[3rem] max-w-2xl w-full shadow-2xl overflow-y-auto max-h-[90vh]">
              <h2 className="text-3xl font-black uppercase italic mb-8 tracking-tighter text-slate-900 dark:text-white">
                {editingRecord ? 'Edit Personnel' : 'New Personnel Record'}
              </h2>
              
              <form onSubmit={handleAction} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Full Legal Name</label>
                  <input required className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white" placeholder="LASTNAME, FIRSTNAME" value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value.toUpperCase()})} />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Contact Email (matches signups to this record - not their login)</label>
                  <input required className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white" placeholder="cadet@email.com" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value.toLowerCase()})} />
                </div>

                {/* ── Company / LET / Platoon / Squad — hidden for instructor roles ── */}
                {!['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role) && <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Company</label>
                  <select disabled={!isBattalionStaff} className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white disabled:opacity-50 appearance-none" value={formData.company} onChange={e => {
                    const nextCompany = e.target.value;
                    const isNextBn = BATTALION_COMPANIES.includes(nextCompany);
                    const isPrevBn = BATTALION_COMPANIES.includes(formData.company);
                    setFormData({
                      ...formData,
                      company: nextCompany,
                      secondaryCompany: isNextBn ? (formData.secondaryCompany || '') : '',
                      ...(isNextBn
                        ? { platoon: null, squad: null }
                        : (isPrevBn ? { platoon: '1st Platoon', squad: '1st Squad' } : {}))
                    });
                  }}>
                    {/* Battalion is not a company — it is a separate fixed designation */}
                    <option value="Battalion" className="bg-white dark:bg-slate-900">Battalion (HQ)</option>
                    {COMPANIES.map(c => <option key={c} value={c} className="bg-white dark:bg-slate-900">{c} Company</option>)}
                  </select>
                </div>}

                {!['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role) && <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">LET Level</label>
                  <select className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none" value={formData.letLevel} onChange={e => setFormData({...formData, letLevel: e.target.value})}>
                    {LET_LEVELS.map(l => <option key={l} value={l} className="bg-white dark:bg-slate-900">{l}</option>)}
                  </select>
                </div>}

                {/* Platoon / Squad — hidden for Battalion members and instructor roles */}
                {!['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role) && !BATTALION_COMPANIES.includes(formData.company) && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">
                      Platoon
                      {platoonAutoLocked && (
                        <span className="ml-2 text-slate-400 normal-case font-bold tracking-normal">— fixed for this position</span>
                      )}
                    </label>
                    {/* Auto-locked when position forces Company HQ (Commander, XO, 1SG, MSG). */}
                    <select
                      className={`w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none ${platoonAutoLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                      value={formData.platoon}
                      disabled={platoonAutoLocked}
                      onChange={platoonAutoLocked ? undefined : e => {
                        const next = e.target.value;
                        setFormData({
                          ...formData,
                          platoon: next,
                          ...(next === 'Company HQ' ? { squad: '' } : {}),
                        });
                      }}
                    >
                      {PLATOONS.map(p => <option key={p} value={p} className="bg-white dark:bg-slate-900">{p}</option>)}
                    </select>
                  </div>
                )}

                {!['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role) && !BATTALION_COMPANIES.includes(formData.company) && formData.platoon !== 'Company HQ' && !NO_SQUAD_POSITIONS.includes(formData.position) && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Squad</label>
                    <select className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none" value={formData.squad} onChange={e => setFormData({...formData, squad: e.target.value})}>
                      {SQUADS.map(s => <option key={s} value={s} className="bg-white dark:bg-slate-900">{s}</option>)}
                    </select>
                  </div>
                )}

                {/* Secondary Company — Battalion cadet members only */}
                {!['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role) && BATTALION_COMPANIES.includes(formData.company) && (
                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">
                      Class Period Company (Secondary)
                    </label>
                    <select
                      className="w-full bg-slate-50 dark:bg-black/50 border border-yellow-500/30 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none focus:border-yellow-500"
                      value={formData.secondaryCompany || ''}
                      onChange={e => setFormData({...formData, secondaryCompany: e.target.value})}
                    >
                      <option value="">— No class period assigned —</option>
                      {COMPANIES.filter(c => !BATTALION_COMPANIES.includes(c)).map(c => (
                        <option key={c} value={c} className="bg-white dark:bg-slate-900">{c} Company (Class Period)</option>
                      ))}
                    </select>
                    <p className="text-[9px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest ml-1">
                      Company whose class this cadet attends — they observe, not a member.
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Rank</label>
                  <select className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none" value={formData.rank} onChange={e => setFormData({...formData, rank: e.target.value})}>
                    {['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role)
                      ? MILITARY_RANKS.map(r => <option key={r} value={r} className="bg-white dark:bg-slate-900">{r}</option>)
                      : (<>
                          {/* A legacy value that predates this dropdown (e.g. free-typed "CDT MAJ")
                              won't match any option below - show it as-is instead of the <select>
                              silently defaulting to whichever option happens to be first. */}
                          {formData.rank && !JROTC_RANKS.includes(formData.rank) && !MILITARY_RANKS.includes(formData.rank) && (
                            <option value={formData.rank} className="bg-white dark:bg-slate-900">{formData.rank} (legacy - please update)</option>
                          )}
                          {JROTC_RANKS.map(r => <option key={r} value={r} className="bg-white dark:bg-slate-900">{r}</option>)}
                        </>)
                    }
                  </select>
                  {(() => {
                    const authRank = POSITION_RANKS[formData.position] || '';
                    const isOver   = authRank && formData.rank && rankExceedsMax(formData.rank, formData.position);
                    const isUnder  = authRank && formData.rank && !isOver && formData.rank !== authRank;
                    if (!authRank) return null;
                    return (
                      <p className={`text-[10px] font-bold flex items-center flex-wrap gap-1.5 mt-1 ml-1 ${isOver ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>
                        {isOver
                          ? <span className="font-black">⛔ OVER RANK — max for this position is {authRank}.</span>
                          : <><span>Max rank for this position:</span><span className="font-black">{authRank}</span></>
                        }
                        {(isOver || isUnder) && (
                          <button type="button" onClick={() => setFormData(f => ({...f, rank: authRank}))}
                            className="ml-1 underline underline-offset-2 hover:opacity-70 transition-opacity">
                            Use {authRank}
                          </button>
                        )}
                      </p>
                    );
                  })()}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Gender</label>
                  <select className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none" value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})}>
                    <option value="">— Select —</option>
                    {['Male', 'Female', 'Other'].map(g => <option key={g} value={g} className="bg-white dark:bg-slate-900">{g}</option>)}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Position</label>
                  <select
                    className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none"
                    value={formData.position}
                    onChange={e => {
                      const newPos = e.target.value;
                      const isHqLocked   = COMPANY_HQ_LOCKED_POSITIONS.includes(newPos);
                      const isHqDefault  = COMPANY_HQ_DEFAULT_POSITIONS.includes(newPos);
                      const isNoSquad    = NO_SQUAD_POSITIONS.includes(newPos);
                      const authRank     = POSITION_RANKS[newPos] || '';
                      setFormData({
                        ...formData,
                        position: newPos,
                        // Auto-fill rank when blank and regulation specifies one
                        ...(!formData.rank && authRank ? { rank: authRank } : {}),
                        // Auto-assign Company HQ for command/staff roles; lock for forced positions.
                        ...(isHqLocked || isHqDefault ? { platoon: 'Company HQ', squad: '' } : {}),
                        // Platoon Leaders / Platoon Sergeants belong to a platoon but not a squad.
                        ...(isNoSquad && !(isHqLocked || isHqDefault) ? { squad: '' } : {}),
                      });
                    }}
                  >
                    {['senior_army_instructor', 'army_instructor', 'district_army_instructor'].includes(formData.role)
                      ? INSTRUCTOR_POSITIONS.map(p => <option key={p} value={p} className="bg-white dark:bg-slate-900">{p}</option>)
                      : JROTC_POSITIONS.map(p => <option key={p} value={p} className="bg-white dark:bg-slate-900">{p}</option>)
                    }
                  </select>
                </div>

                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Access Role (Determines Permission Level)</label>
                  <select className="w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none text-sm font-bold text-slate-900 dark:text-white appearance-none" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}>
                    {ROLE_OPTIONS.map(([slug, label]) => (
                      <option key={slug} value={slug} className="bg-white dark:bg-slate-900">
                        {label} (Level {ROLE_HIERARCHY[slug]})
                      </option>
                    ))}
                  </select>
                  {/* Role limit notice for high-level roles */}
                  {['battalion_commander', 'battalion_xo', 'battalion_csm'].includes(formData.role) && (
                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400 ml-1 mt-1">
                      ⚠ {formData.role === 'battalion_commander' ? 'Hard limit: 1 BC only. Current BC must be revoked first.' : 'Limit: 1 per role. BC can enable a temporary dual-role override in settings.'}
                    </p>
                  )}
                </div>

                {/* ── BC Override Toggle (Battalion Commander only) ── */}
                {role === 'battalion_commander' && (
                  <div className="md:col-span-2">
                    <BcRoleOverridePanel />
                  </div>
                )}

                {editingRecord?.approved === false ? (
                  /* ── Pending-approval flow: green Approve + red Deny ── */
                  <div className="md:col-span-2 flex gap-3 mt-4">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="flex-1 bg-green-600 hover:bg-green-500 text-white font-black uppercase py-5 rounded-2xl transition-all text-sm shadow-lg shadow-green-600/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isSaving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}
                      {isSaving ? 'Saving…' : 'Approve Account'}
                    </button>
                    <button
                      type="button"
                      onClick={handleDenyAccount}
                      disabled={isSaving}
                      className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black uppercase py-5 rounded-2xl transition-all text-sm shadow-lg shadow-red-600/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <X size={17} /> Deny Account
                    </button>
                  </div>
                ) : (
                  <button type="submit" disabled={isSaving} className="md:col-span-2 w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all mt-4 text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : null}
                    {isSaving ? 'Saving…' : editingRecord ? 'Update Record' : 'Authorize & Add to Roster'}
                  </button>
                )}
              </form>

              {/* Real Firebase Auth login email - separate from the contact-email field above.
                  Only meaningful for an already-linked account. Changing your OWN login lives
                  in My Profile instead; this is only for changing someone else's. */}
              {editingRecord && editingRecord.id === user?.uid && (
                <p className="mt-8 pt-8 border-t border-slate-100 dark:border-white/5 text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest text-center">
                  Manage your own login email from My Profile.
                </p>
              )}
              {editingRecord && editingRecord.id !== user?.uid && !editingRecord.isManual && canManageLoginFor(editingRecord.role) && (
                <div className="mt-8 pt-8 border-t border-slate-100 dark:border-white/5">
                  <h3 className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest mb-1">Login Credentials</h3>
                  <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold mb-4 leading-relaxed">
                    Changes the email this cadet actually signs in with. Use this when someone loses access to their old inbox or is leaving the account to a successor.
                  </p>
                  <form onSubmit={handleUpdateLoginEmail} className="flex gap-3">
                    <input
                      type="email"
                      required
                      className="flex-1 bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-4 rounded-2xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white"
                      placeholder="new-login@email.com"
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={loginEmailStatus === 'saving'}
                      className={`px-6 rounded-2xl font-black uppercase text-xs whitespace-nowrap transition-all ${loginEmailStatus === 'success' ? 'bg-green-500 text-white' : 'bg-slate-900 dark:bg-white/10 text-white hover:bg-slate-800 dark:hover:bg-white/20 disabled:opacity-50'}`}
                    >
                      {loginEmailStatus === 'saving' ? 'Saving...' : loginEmailStatus === 'success' ? 'Updated' : 'Update Login Email'}
                    </button>
                  </form>
                  {loginEmailStatus && loginEmailStatus !== 'saving' && loginEmailStatus !== 'success' && (
                    <p className="text-[10px] text-red-500 font-bold mt-2">{loginEmailStatus}</p>
                  )}

                  <div className="flex items-center justify-between gap-4 mt-6 pt-6 border-t border-slate-100 dark:border-white/5 flex-wrap">
                    <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">
                      Sends a password reset link to {editingRecord.email}
                    </p>
                    <button
                      type="button"
                      onClick={handleResetPassword}
                      disabled={resetPasswordStatus === 'sending' || resetCooldownSeconds > 0}
                      className={`px-6 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 whitespace-nowrap transition-all ${resetPasswordStatus === 'success' ? 'bg-green-500 text-white' : 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-50'}`}
                    >
                      <KeyRound size={14} />
                      {resetPasswordStatus === 'sending' ? 'Sending...' : resetPasswordStatus === 'success' ? 'Email Sent' : resetCooldownSeconds > 0 ? `Wait ${formatCooldown(resetCooldownSeconds)}` : 'Reset Password'}
                    </button>
                  </div>
                  {resetPasswordStatus && resetPasswordStatus !== 'sending' && resetPasswordStatus !== 'success' && (
                    <p className="text-[10px] text-red-500 font-bold mt-2">{resetPasswordStatus}</p>
                  )}

                  <div className="flex items-center justify-between gap-4 mt-6 pt-6 border-t border-slate-100 dark:border-white/5 flex-wrap">
                    <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">
                      Removes enrolled 2FA phone — they sign in with password only until they re-enroll
                    </p>
                    <button
                      type="button"
                      onClick={handleResetMfa}
                      disabled={resetMfaStatus === 'working'}
                      className={`px-6 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 whitespace-nowrap transition-all ${resetMfaStatus === 'success' ? 'bg-green-500 text-white' : 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-50'}`}
                    >
                      <ShieldOff size={14} />
                      {resetMfaStatus === 'working' ? 'Removing...' : resetMfaStatus === 'success' ? '2FA Removed' : 'Reset 2FA'}
                    </button>
                  </div>
                  {resetMfaStatus && resetMfaStatus !== 'working' && resetMfaStatus !== 'success' && (
                    <p className="text-[10px] text-red-500 font-bold mt-2">{resetMfaStatus}</p>
                  )}

                  {/* DANGER ZONE */}
                  <div className="mt-8 pt-8 border-t border-red-500/20 space-y-4">
                    <h3 className="text-[10px] font-black uppercase text-red-500 tracking-widest">Danger Zone</h3>

                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">
                        {editingRecord.suspended ? 'Account is suspended - blocked from signing in.' : 'Blocks this account from signing in until reactivated.'}
                      </p>
                      <button
                        type="button"
                        onClick={handleToggleSuspend}
                        disabled={suspendStatus === 'working'}
                        className="px-6 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 whitespace-nowrap transition-all bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 disabled:opacity-50"
                      >
                        <Ban size={14} />
                        {suspendStatus === 'working' ? 'Working...' : editingRecord.suspended ? 'Reactivate Account' : 'Suspend Account'}
                      </button>
                    </div>
                    {suspendStatus && suspendStatus !== 'working' && suspendStatus !== 'success' && (
                      <p className="text-[10px] text-red-500 font-bold">{suspendStatus}</p>
                    )}

                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">
                        Permanently deletes this account. Cannot be undone.
                      </p>
                      <button
                        type="button"
                        onClick={handleDeleteAccount}
                        disabled={deleteAccountStatus === 'working'}
                        className="px-6 py-3 rounded-xl font-black uppercase text-xs flex items-center gap-2 whitespace-nowrap transition-all bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        {deleteAccountStatus === 'working' ? 'Deleting...' : 'Delete Account'}
                      </button>
                    </div>
                    {deleteAccountStatus && deleteAccountStatus !== 'working' && (
                      <p className="text-[10px] text-red-500 font-bold">{deleteAccountStatus}</p>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success/Error Status Toast */}
      <AnimatePresence>
        {status && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="fixed bottom-8 right-8 bg-yellow-500 text-slate-950 px-8 py-4 rounded-2xl font-black uppercase text-xs flex items-center gap-3 shadow-2xl z-[200]">
            <CheckCircle2 size={18} /> {status}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminUsers;