// src/pages/AdminMeetingLogs.jsx
//
// Meeting Logs — create/view/edit official battalion meeting records.
//
// WHO CAN DO WHAT
//   Create / Edit / Delete : battalion_xo  + ADMIN_LEVEL (80+)
//   View (read-only)       : s1_adjutant, battalion_commander, and the editors above
//
// FIELDS PER LOG
//   Meeting number  — auto-incremented (user may override)
//   Date            — calendar date picker
//   Meeting name    — free text
//   Attendance      — free text paragraph
//   Agenda          — bullet-point list
//   Notes           — bullet-point list
//
// DATA MODEL (Firestore)
//   meetingLogs/{id}:
//     meetingNumber  (number)
//     meetingDate    (Timestamp)
//     meetingName    (string)
//     attendance     (string)
//     agendaItems    (BulletItem[])  — { text: string, children: string[] }[]; old docs use string[] (auto-upgraded on save)
//     noteItems      (BulletItem[])
//     createdBy      (uid)
//     createdByName  (string)
//     createdAt      (Timestamp)
//     updatedAt      (Timestamp | null)
//     updatedByName  (string)
//
// GOOGLE SHEETS SYNC
//   After every successful Firestore write, the client POSTs to /api/sync-meeting-logs
//   which rewrites the linked Google Sheet.  Requires:
//     MEETING_LOGS_SHEET_ID env var in Vercel
//     Google Sheets API enabled in the GCP project
//     The sheet shared with the Firebase service-account email (Editor)

import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { db, auth, storage } from '../firebase';
import {
  collection, query, where, onSnapshot,
  doc, addDoc, updateDoc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { uploadFileToPath } from '../utils/storageUploadPhoto';
import {
  NotepadText, Plus, X, Pencil, Trash2,
  Eye, CheckCircle2, AlertCircle, Loader2,
  Paperclip, FileText, Download,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';
import BulletListEditor, { normalizeBullets, flattenBullets } from '../components/BulletListEditor';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL } from '../constants';
import DatePicker from '../components/DatePicker';

// ── Role constants ─────────────────────────────────────────────────────────────
// Who can edit ANYONE's log and delete:
const ELEVATED_EDIT_ROLES = ['battalion_xo', 'battalion_csm', 'sergeant_major', 'battalion_commander', 's1_adjutant'];
// Legacy company-view roles (kept for backward compat):
const COMPANY_VIEW_ROLES = ['company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant'];
// Company top-3 roles (for company_top_3 access group):
const COMPANY_TOP_3_ROLES = ['company_commander', 'company_xo', 'company_1sg'];

// ── Battalion access group definitions ───────────────────────────────────────
// Shown to battalion-level creators (L70+).
const ACCESS_GROUPS = [
  { key: 'battalion_staff',     label: 'Battalion Staff',      desc: 'All S1–S7 staff',        roles: null, minLevel: 70 },
  { key: 'top_3',               label: 'Top 3 Only',           desc: 'BC, CSM & XO',            roles: ['battalion_commander', 'battalion_csm', 'battalion_xo'] },
  { key: 'company_leadership',  label: 'Company Leadership',   desc: 'Commanders, XOs, 1SGs',   roles: ['company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant'] },
  { key: 's1_adjutant',         label: 'S1 Adjutant',          desc: 'S1 – Personnel',          roles: ['s1_adjutant'] },
  { key: 's2_intelligence',     label: 'S2 Intelligence',      desc: 'S2 – Intelligence',        roles: ['s2_intelligence'] },
  { key: 's3_operations',       label: 'S3 Operations',        desc: 'S3 – Operations',          roles: ['s3_operations'] },
  { key: 's4_logistics',        label: 'S4 Logistics',         desc: 'S4 – Logistics',           roles: ['s4_logistics'] },
  { key: 's5_public_affairs',   label: 'S5 Public Affairs',    desc: 'S5 – Public Affairs',      roles: ['s5_public_affairs'] },
  { key: 's6_technology',       label: 'S6 Technology',        desc: 'S6 – Technology',          roles: ['s6_technology'] },
  { key: 's7_special_projects', label: 'S7 Special Projects',  desc: 'S7 – Special Projects',    roles: ['s7_special_projects'] },
];

// ── Company access group definitions ─────────────────────────────────────────
// Shown to company-level creators (L45–69). Logs created with these groups are
// always company-scoped (only visible to members of the creator's company).
const COMPANY_ACCESS_GROUPS = [
  { key: 'whole_company',  label: 'Whole Company',  desc: 'All company members',        minLevel: 5,  maxLevel: 69 },
  { key: 'plt_ldr_sgt',   label: 'PLT LDR + SGT',  desc: 'Platoon leaders & sergeants', minLevel: 20, maxLevel: 29 },
  { key: 'company_staff', label: 'Company Staff',   desc: 'Company S-staff assistants', minLevel: 35, maxLevel: 44 },
  { key: 'company_top_3', label: 'Top 3 Only',      desc: 'Commander, XO, 1st SGT',    roles: COMPANY_TOP_3_ROLES },
];

const COMPANY_GROUP_KEYS = COMPANY_ACCESS_GROUPS.map(g => g.key);

// All groups combined (for display in view mode):
const ALL_ACCESS_GROUPS = [...ACCESS_GROUPS, ...COMPANY_ACCESS_GROUPS];

// Returns the access group key(s) a given role belongs to (for battalion groups).
function roleToGroupKeys(role, level) {
  const keys = [];
  ACCESS_GROUPS.forEach(g => {
    if (g.minLevel && level >= g.minLevel) keys.push(g.key);
    else if (g.roles && g.roles.includes(role)) keys.push(g.key);
  });
  return keys;
}

// Can this user see a given log? Admins (80+) always can.
// accessGroups: [] means visible to all battalion staff 70+ (default/unrestricted).
// accessGroups with battalion group keys: restrict to those groups.
// accessGroups with company group keys: restrict to company members matching the group.
function isLogAccessible(log, role, level, uid, userCompany) {
  if (level >= ADMIN_LEVEL) return true;
  if (log.createdBy === uid) return true;

  const groups = log.accessGroups;
  if (!groups || groups.length === 0) {
    if (log.companyAccess && COMPANY_VIEW_ROLES.includes(role)) return true;
    return level >= STAFF_LEVEL;
  }

  // Company-scoped log (contains company group keys)?
  const hasCompanyGroups = groups.some(k => COMPANY_GROUP_KEYS.includes(k));
  if (hasCompanyGroups) {
    // Must be in the same company as the log creator
    if (log.logCompany && userCompany !== log.logCompany) return false;
    // Check group membership
    for (const key of groups) {
      if (key === 'whole_company' && level >= 5 && level < STAFF_LEVEL) return true;
      if (key === 'plt_ldr_sgt'   && (level === 20 || level === 25)) return true;
      if (key === 'company_staff' && level === 35) return true;
      if (key === 'company_top_3' && COMPANY_TOP_3_ROLES.includes(role)) return true;
    }
    return false;
  }

  // Battalion-level groups
  const userKeys = roleToGroupKeys(role, level);
  return userKeys.some(k => groups.includes(k));
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateForSheets(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Convert a date string "YYYY-MM-DD" (from <input type="date">) to Timestamp
function dateStrToTimestamp(str) {
  if (!str) return null;
  // Parse without timezone shift by using UTC date, then set local midnight
  const [y, m, d] = str.split('-').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0));
}

function timestampToDateStr(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// ── Attachment validation ──────────────────────────────────────────────────────
// Accepted: PDF (%PDF magic), PPTX (ZIP magic + .pptx ext), PPT (OLE2 + .ppt ext)
// Hard cap: 10 MB — reasonable for a meeting document
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

async function validateMeetingAttachment(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { valid: false, error: `File too large — max 10 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB).` };
  }
  const buf   = await file.slice(0, 8).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const ext   = file.name.split('.').pop().toLowerCase();

  // PDF: %PDF
  const isPdf  = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  // PPTX: ZIP (PK\x03\x04) with .pptx extension
  const isPptx = bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04 && ext === 'pptx';
  // PPT: OLE2 compound document (D0 CF 11 E0) with .ppt extension
  const isPpt  = bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0 && ext === 'ppt';

  if (!isPdf && !isPptx && !isPpt) {
    return { valid: false, error: 'Only PDF, PPTX, or PPT files are accepted.' };
  }
  return { valid: true };
}

// ── Empty log template ─────────────────────────────────────────────────────────
const EMPTY_FORM = {
  meetingNumber:  '',
  meetingDate:    '',
  meetingName:    '',
  attendance:     '',
  agendaItems:    [],
  noteItems:      [],
  accessGroups:   [], // which groups can view; [] = battalion staff only (default)
};

// ── Main page ──────────────────────────────────────────────────────────────────
const AdminMeetingLogs = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  const userLevel = ROLE_HIERARCHY[role] || 0;

  // ── Access flags ─────────────────────────────────────────────────────────────
  // All users L5+ may access the meeting logs tab (per new permissions).
  const isAuthorized     = userLevel >= 5;
  // Company command (L45+) and battalion staff (L70+) may create logs.
  const canCreate        = userLevel >= 45;
  // Company creators (L45–69) produce company-scoped logs.
  const isCompanyCreator = userLevel >= 45 && userLevel < STAFF_LEVEL;
  // XO/CSM/BC/S1 may edit anyone's log and delete.
  const canElevatedEdit  = ELEVATED_EDIT_ROLES.includes(role) || userLevel >= 85;
  const canDelete        = canElevatedEdit;
  // Anyone below battalion staff (L70) only sees company-scoped logs.
  const isCompanyViewer  = userLevel < STAFF_LEVEL;
  // uid reference for per-log ownership check.
  const uid              = auth.currentUser?.uid;

  // ── Data state ────────────────────────────────────────────────────────────────
  const [logs,       setLogs]       = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // ── Modal state ───────────────────────────────────────────────────────────────
  // modalMode: null (closed) | 'create' | 'edit' | 'view'
  const [modalMode, setModalMode] = useState(null);
  const [activeLog, setActiveLog] = useState(null); // log being edited/viewed
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(null); // id being deleted

  // ── Attachment state ──────────────────────────────────────────────────────────
  const [attachFile,    setAttachFile]    = useState(null);  // File object pending upload
  const [attachError,   setAttachError]   = useState('');
  const [clearAttach,   setClearAttach]   = useState(false); // flag to remove existing attachment on save

  // ── Sync state ────────────────────────────────────────────────────────────────
  // 'idle' | 'syncing' | 'ok' | 'error'
  const [syncStatus,  setSyncStatus]  = useState('idle');
  const [syncMessage, setSyncMessage] = useState('');

  // ── Firestore subscription ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthorized) return;
    const uid         = auth.currentUser?.uid;
    const userCompany = userData?.company;
    const q = userLevel >= 70
      ? query(collection(db, 'meetingLogs'))
      : query(collection(db, 'meetingLogs'), where('companyAccess', '==', true));
    return onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(log => isLogAccessible(log, role, userLevel, uid, userCompany));
      docs.sort((a, b) => (b.meetingNumber || 0) - (a.meetingNumber || 0));
      setLogs(docs);
      setLoadingLogs(false);
    });
  }, [isAuthorized, role, userLevel, userData?.company]);

  // ── Derived ───────────────────────────────────────────────────────────────────
  const nextMeetingNumber = useMemo(() => {
    if (logs.length === 0) return 1;
    return Math.max(...logs.map(l => l.meetingNumber || 0)) + 1;
  }, [logs]);

  // ── Sync to Google Sheets ─────────────────────────────────────────────────────
  // Sends all current logs (sorted ascending by meeting number) to the Sheets API
  // via /api/sync-meeting-logs.
  const syncToSheets = async (currentLogs) => {
    setSyncStatus('syncing');
    setSyncMessage('');
    try {
      const idToken = await auth.currentUser.getIdToken();
      const sorted  = [...currentLogs].sort((a, b) => (a.meetingNumber || 0) - (b.meetingNumber || 0));

      const payload = sorted.map(l => ({
        meetingNumber: l.meetingNumber,
        meetingDate:   fmtDateForSheets(l.meetingDate),
        meetingName:   l.meetingName   || '',
        attendance:    l.attendance    || '',
        agendaItems:   flattenBullets(l.agendaItems),
        noteItems:     flattenBullets(l.noteItems),
      }));

      const res  = await fetch('/api/sync-meeting-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, logs: payload }),
      });
      const data = await res.json();

      if (data.ok) {
        setSyncStatus('ok');
        setSyncMessage('Synced to Google Sheets');
      } else {
        setSyncStatus('error');
        setSyncMessage(data.error || 'Sync failed');
      }
    } catch (err) {
      console.error('Sheets sync error:', err);
      setSyncStatus('error');
      setSyncMessage('Sync failed — check network');
    }
    // Clear status after a few seconds
    setTimeout(() => { setSyncStatus('idle'); setSyncMessage(''); }, 5000);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm({ ...EMPTY_FORM, meetingNumber: nextMeetingNumber });
    setActiveLog(null);
    setModalMode('create');
  };

  const openEdit = (log) => {
    setForm({
      meetingNumber:  log.meetingNumber ?? '',
      meetingDate:    timestampToDateStr(log.meetingDate),
      meetingName:    log.meetingName  || '',
      attendance:     log.attendance   || '',
      agendaItems:    normalizeBullets(log.agendaItems),
      noteItems:      normalizeBullets(log.noteItems),
      accessGroups:   log.accessGroups || (log.companyAccess ? ['company_leadership'] : []),
    });
    setActiveLog(log);
    setModalMode('edit');
  };

  const openView = (log) => {
    setActiveLog(log);
    setModalMode('view');
  };

  const closeModal = () => {
    setModalMode(null);
    setActiveLog(null);
    setForm(EMPTY_FORM);
    setAttachFile(null);
    setAttachError('');
    setClearAttach(false);
  };

  const handleSave = async () => {
    if (!form.meetingDate || !form.meetingName.trim()) return;
    setSaving(true);
    try {
      // ── Handle attachment ──────────────────────────────────────────────────
      let attachmentUrl         = activeLog?.attachmentUrl         || null;
      let attachmentName        = activeLog?.attachmentName        || null;
      let attachmentStoragePath = activeLog?.attachmentStoragePath || null;

      if (attachFile) {
        // Upload new file
        const path = `meeting-attachments/${Date.now()}_${attachFile.name.replace(/\s+/g, '_')}`;
        const result = await uploadFileToPath(attachFile, path);
        // Delete old attachment from Storage if replacing
        if (activeLog?.attachmentStoragePath) {
          try { await deleteObject(storageRef(storage, activeLog.attachmentStoragePath)); } catch { /* best-effort */ }
        }
        attachmentUrl         = result.url;
        attachmentName        = attachFile.name;
        attachmentStoragePath = result.storagePath;
      } else if (clearAttach) {
        // User removed the attachment
        if (activeLog?.attachmentStoragePath) {
          try { await deleteObject(storageRef(storage, activeLog.attachmentStoragePath)); } catch { /* best-effort */ }
        }
        attachmentUrl = null; attachmentName = null; attachmentStoragePath = null;
      }

      const payload = {
        meetingNumber:        parseInt(form.meetingNumber) || nextMeetingNumber,
        meetingDate:          dateStrToTimestamp(form.meetingDate),
        meetingName:          form.meetingName.trim(),
        attendance:           form.attendance.trim(),
        agendaItems:          form.agendaItems,
        noteItems:            form.noteItems,
        accessGroups:         form.accessGroups || [],
        companyAccess:        (form.accessGroups || []).includes('company_leadership'),
        // logCompany scopes company-level logs to the creator's company.
        // Only set on create; on edit preserve whatever the log had.
        logCompany:           modalMode === 'create'
          ? (isCompanyCreator ? (userData?.company || null) : null)
          : (activeLog?.logCompany ?? null),
        attachmentUrl,
        attachmentName,
        attachmentStoragePath,
        updatedAt:            Timestamp.now(),
        updatedByName:        userData?.fullName || '',
      };

      let updatedLogs;
      if (modalMode === 'create') {
        const docRef = await addDoc(collection(db, 'meetingLogs'), {
          ...payload,
          createdBy:    auth.currentUser.uid,
          createdByName: userData?.fullName || '',
          createdAt:    Timestamp.now(),
        });
        // Optimistically build the new log for sheets sync
        // (actual Firestore snapshot will also update `logs` state via listener)
        updatedLogs = [
          ...logs,
          { id: docRef.id, ...payload, createdAt: Timestamp.now() },
        ];
      } else {
        await updateDoc(doc(db, 'meetingLogs', activeLog.id), payload);
        updatedLogs = logs.map(l => l.id === activeLog.id ? { ...l, ...payload } : l);
      }

      closeModal();
      // Sync to Sheets with updated list
      syncToSheets(updatedLogs);
      writeLog({
        type: 'meeting_log', action: modalMode === 'create' ? 'create' : 'update',
        description: `${modalMode === 'create' ? 'Created' : 'Updated'} Meeting Log #${payload.meetingNumber} — "${payload.meetingName}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: payload.meetingName,
      });
    } catch (err) {
      console.error('Save error:', err);
      alert('Failed to save meeting log. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAttachmentChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttachError('');
    const { valid, error } = await validateMeetingAttachment(file);
    if (!valid) { setAttachError(error); return; }
    setAttachFile(file);
    setClearAttach(false);
  };

  const handleDelete = async (log) => {
    const ok = await confirm(`Delete Meeting #${log.meetingNumber} — "${log.meetingName}"? This cannot be undone.`, { title: 'Delete Meeting Log', destructive: true });
    if (!ok) return;
    setDeleting(log.id);
    try {
      if (log.attachmentStoragePath) {
        try { await deleteObject(storageRef(storage, log.attachmentStoragePath)); } catch { /* best-effort */ }
      }
      await deleteDoc(doc(db, 'meetingLogs', log.id));
      const updatedLogs = logs.filter(l => l.id !== log.id);
      syncToSheets(updatedLogs);
      writeLog({
        type: 'meeting_log', action: 'delete',
        description: `Deleted Meeting Log #${log.meetingNumber} — "${log.meetingName}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: log.id, targetName: log.meetingName,
      });
    } catch (err) {
      console.error('Delete error:', err);
      alert('Failed to delete meeting log.');
    } finally {
      setDeleting(null);
    }
  };

  // ── Guards ────────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500" />
    </div>
  );

  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  // ════════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════════
  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={NotepadText} title="Meeting Logs" />}

        {/* ── Header actions ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 mb-10">
          <div className="flex items-center gap-3">
            {/* Sync status indicator */}
            {syncStatus !== 'idle' && (
              <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-xl border transition-all ${
                syncStatus === 'syncing' ? 'bg-blue-50 dark:bg-blue-500/5 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20' :
                syncStatus === 'ok'      ? 'bg-green-50 dark:bg-green-500/5 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20' :
                                           'bg-red-50 dark:bg-red-500/5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20'
              }`}>
                {syncStatus === 'syncing' && <Loader2 size={11} className="animate-spin" />}
                {syncStatus === 'ok'      && <CheckCircle2 size={11} />}
                {syncStatus === 'error'   && <AlertCircle size={11} />}
                {syncMessage || (syncStatus === 'syncing' ? 'Syncing…' : '')}
              </div>
            )}
            {canCreate && (
              <button
                onClick={openCreate}
                className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
              >
                <Plus size={14} /> New Meeting Log
              </button>
            )}
          </div>
        </div>

        {/* ── Access notice for company-level viewers ──────────────────────────── */}
        {isCompanyViewer && (
          <div className="mb-6 p-4 bg-blue-50/60 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/10 rounded-2xl flex items-center gap-3">
            <Eye className="text-blue-400 shrink-0" size={15} />
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400">
              You can view meeting logs shared with{userData?.company ? ` ${userData.company} company` : ' your company'}.
            </p>
          </div>
        )}

        {/* ── Meeting logs table ────────────────────────────────────────────────────── */}
        {loadingLogs ? (
          <div className="text-center py-24">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-yellow-500 mx-auto" />
            <p className="text-slate-400 text-xs font-bold mt-4 uppercase tracking-widest">Loading logs…</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-24 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
            <NotepadText className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={40} />
            {isCompanyViewer ? (
              <>
                <p className="text-slate-400 font-black uppercase tracking-widest text-sm">Nothing to see here yet</p>
                <p className="text-slate-300 dark:text-slate-600 text-xs mt-2 font-medium">
                  Meeting logs shared with company leadership will appear here.
                </p>
              </>
            ) : (
              <>
                <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No meeting logs yet</p>
                {canCreate && (
                  <button
                    onClick={openCreate}
                    className="mt-4 text-yellow-600 dark:text-yellow-500 text-xs font-black uppercase tracking-widest hover:underline"
                  >
                    Create the first one →
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-3xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-blue-100 dark:border-white/5 bg-blue-50/40 dark:bg-slate-800/30">
                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 w-16">#</th>
                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Date</th>
                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Meeting Name</th>
                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden md:table-cell">Agenda</th>
                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden md:table-cell">Notes</th>
                    {!isCompanyViewer && (
                      <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hidden lg:table-cell">Shared</th>
                    )}
                    <th className="px-4 py-3 text-right text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr
                      key={log.id}
                      className="border-b border-blue-50 dark:border-white/5 hover:bg-blue-50/20 dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="text-xs font-black text-slate-400 dark:text-slate-500 tabular-nums">#{log.meetingNumber}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{fmtDate(log.meetingDate)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{log.meetingName || '—'}</p>
                          {log.attachmentUrl && (
                            <Paperclip size={11} className="text-yellow-500 shrink-0" title="Has attachment" />
                          )}
                        </div>
                        {log.attendance && (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-[180px]">{log.attendance}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {(log.agendaItems || []).length > 0 ? (() => {
                          const first = normalizeBullets(log.agendaItems)[0];
                          return (
                            <div>
                              <p className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[150px]">
                                • {first?.text}
                              </p>
                              {log.agendaItems.length > 1 && (
                                <p className="text-[9px] text-slate-400 dark:text-slate-500">+{log.agendaItems.length - 1} more</p>
                              )}
                            </div>
                          );
                        })() : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {(log.noteItems || []).length > 0 ? (() => {
                          const first = normalizeBullets(log.noteItems)[0];
                          return (
                            <div>
                              <p className="text-xs text-slate-600 dark:text-slate-400 truncate max-w-[150px]">
                                • {first?.text}
                              </p>
                              {log.noteItems.length > 1 && (
                                <p className="text-[9px] text-slate-400 dark:text-slate-500">+{log.noteItems.length - 1} more</p>
                              )}
                            </div>
                          );
                        })() : (
                          <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      {!isCompanyViewer && (
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {log.accessGroups && log.accessGroups.length > 0 ? (
                            <span className="inline-block text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                              {log.accessGroups.length} Group{log.accessGroups.length > 1 ? 's' : ''}
                            </span>
                          ) : log.companyAccess ? (
                            <span className="inline-block text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                              Shared
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => openView(log)}
                            title="View details"
                            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 bg-blue-50/50 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-all"
                          >
                            <Eye size={10} /> View
                          </button>
                          {(canElevatedEdit || log.createdBy === uid) && (
                            <button
                              onClick={() => openEdit(log)}
                              title="Edit"
                              className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-yellow-600 dark:hover:text-yellow-500 bg-yellow-50/50 dark:bg-slate-800 hover:bg-yellow-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-all"
                            >
                              <Pencil size={10} /> Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(log)}
                              disabled={deleting === log.id}
                              title="Delete"
                              className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-300 hover:text-red-600 dark:text-slate-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 px-2 py-1.5 rounded-lg transition-all disabled:opacity-40"
                            >
                              {deleting === log.id
                                ? <Loader2 size={10} className="animate-spin" />
                                : <Trash2 size={10} />
                              }
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* ════════════════════════════════════════════════════════════════════════════
          CREATE / EDIT / VIEW MODAL
      ════════════════════════════════════════════════════════════════════════════ */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-10 bg-black/50 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-2xl shadow-2xl border border-blue-100 dark:border-white/5 my-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-0 mb-6">
              <h2 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                {modalMode === 'create' ? 'New Meeting Log'
                 : modalMode === 'edit' ? `Edit Meeting #${activeLog?.meetingNumber}`
                 : `Meeting #${activeLog?.meetingNumber} — ${activeLog?.meetingName}`}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="px-8 pb-8 space-y-6">
              {/* ── Meeting Info ───────────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                {/* Meeting number */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">
                    Meeting #
                    {modalMode === 'create' && (
                      <span className="ml-1.5 text-slate-300 dark:text-slate-600 normal-case font-medium tracking-normal">
                        (auto-filled, can override)
                      </span>
                    )}
                  </label>
                  {modalMode === 'view' ? (
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">#{activeLog?.meetingNumber}</p>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      value={form.meetingNumber}
                      onChange={e => setForm(f => ({ ...f, meetingNumber: e.target.value }))}
                      className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                    />
                  )}
                </div>

                {/* Date */}
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Date</label>
                  {modalMode === 'view' ? (
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{fmtDate(activeLog?.meetingDate)}</p>
                  ) : (
                    <DatePicker
                      value={form.meetingDate}
                      onChange={v => setForm(f => ({ ...f, meetingDate: v }))}
                    />
                  )}
                </div>
              </div>

              {/* Meeting name */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Meeting Name</label>
                {modalMode === 'view' ? (
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{activeLog?.meetingName || '—'}</p>
                ) : (
                  <input
                    value={form.meetingName}
                    onChange={e => setForm(f => ({ ...f, meetingName: e.target.value }))}
                    placeholder="e.g., Weekly Commander's Call, Staff Sync…"
                    className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                  />
                )}
              </div>

              {/* Attendance */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Attendance</label>
                {modalMode === 'view' ? (
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{activeLog?.attendance || '—'}</p>
                ) : (
                  <textarea
                    value={form.attendance}
                    onChange={e => setForm(f => ({ ...f, attendance: e.target.value }))}
                    rows={3}
                    placeholder="e.g., All company XOs present. Alpha 1SG absent. 42 cadets total."
                    className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors resize-none"
                  />
                )}
              </div>

              {/* Agenda */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-2">Agenda</label>
                {modalMode === 'view' ? (
                  <BulletListEditor items={activeLog?.agendaItems || []} onChange={() => {}} readOnly />
                ) : (
                  <BulletListEditor
                    items={form.agendaItems}
                    onChange={items => setForm(f => ({ ...f, agendaItems: items }))}
                    placeholder="Add agenda item… (press Enter)"
                  />
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-2">Notes</label>
                {modalMode === 'view' ? (
                  <BulletListEditor items={activeLog?.noteItems || []} onChange={() => {}} readOnly />
                ) : (
                  <BulletListEditor
                    items={form.noteItems}
                    onChange={items => setForm(f => ({ ...f, noteItems: items }))}
                    placeholder="Add note… (press Enter)"
                  />
                )}
              </div>

              {/* ── Attachment ─────────────────────────────────────────────── */}
              {modalMode === 'view' ? (
                activeLog?.attachmentUrl && (
                  <div className="flex items-center gap-3 py-3 border-t border-slate-100 dark:border-white/5">
                    <FileText size={15} className="text-yellow-500 shrink-0" />
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate flex-1">
                      {activeLog.attachmentName || 'Attachment'}
                    </span>
                    <a
                      href={activeLog.attachmentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 hover:bg-yellow-500 hover:text-slate-950 transition-all border border-yellow-500/20"
                    >
                      <Download size={11} /> Open
                    </a>
                  </div>
                )
              ) : (
                <div className="border-t border-slate-100 dark:border-white/5 pt-4">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-2">
                    Attachment <span className="normal-case font-medium tracking-normal text-slate-300 dark:text-slate-600">— PDF, PPTX, or PPT · max 10 MB</span>
                  </label>

                  {/* Show existing attachment */}
                  {activeLog?.attachmentUrl && !clearAttach && !attachFile && (
                    <div className="flex items-center gap-3 mb-2 px-3 py-2.5 bg-blue-50/50 dark:bg-slate-800 rounded-xl border border-blue-100 dark:border-white/5">
                      <FileText size={14} className="text-yellow-500 shrink-0" />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate flex-1">
                        {activeLog.attachmentName || 'Existing attachment'}
                      </span>
                      <button
                        type="button"
                        onClick={() => { setClearAttach(true); setAttachFile(null); }}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Remove attachment"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* Show pending new file */}
                  {attachFile && (
                    <div className="flex items-center gap-3 mb-2 px-3 py-2.5 bg-yellow-50 dark:bg-yellow-500/5 rounded-xl border border-yellow-200 dark:border-yellow-500/20">
                      <FileText size={14} className="text-yellow-500 shrink-0" />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate flex-1">
                        {attachFile.name}
                        <span className="ml-2 font-medium text-slate-400">({(attachFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setAttachFile(null)}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {attachError && (
                    <p className="text-xs text-red-500 font-bold mb-2 flex items-center gap-1.5">
                      <AlertCircle size={12} /> {attachError}
                    </p>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer w-fit">
                    <input
                      type="file"
                      accept=".pdf,.pptx,.ppt"
                      onChange={handleAttachmentChange}
                      className="hidden"
                    />
                    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-yellow-500/40 hover:text-yellow-600 dark:hover:text-yellow-500 transition-all">
                      <Paperclip size={12} />
                      {attachFile ? 'Replace file' : activeLog?.attachmentUrl && !clearAttach ? 'Replace file' : 'Attach file'}
                    </span>
                  </label>
                </div>
              )}

              {/* Access Groups */}
              {modalMode === 'view' ? (
                <div className="py-3 border-t border-slate-100 dark:border-white/5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Visible To</p>
                  {(() => {
                    const groups = activeLog?.accessGroups;
                    if (!groups || groups.length === 0) {
                      return <p className="text-[10px] text-slate-400 dark:text-slate-500">All battalion staff (default)</p>;
                    }
                    const labels = ALL_ACCESS_GROUPS.filter(g => groups.includes(g.key)).map(g => g.label);
                    const scopeNote = activeLog?.logCompany ? ` · ${activeLog.logCompany} company only` : '';
                    return (
                      <div>
                        <div className="flex flex-wrap gap-1.5">
                          {labels.map(l => (
                            <span key={l} className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">{l}</span>
                          ))}
                        </div>
                        {scopeNote && (
                          <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1.5 font-medium">{scopeNote}</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : canCreate ? (
                <div className="py-3 border-t border-slate-100 dark:border-white/5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">Who Can View This Log</p>
                  {isCompanyCreator ? (
                    <>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">
                        This log will be visible only to members of <span className="font-bold text-slate-600 dark:text-slate-300">{userData?.company || 'your company'}</span>.
                        {form.accessGroups.length === 0
                          ? ' Select a group below to restrict further.'
                          : ` Restricted to ${form.accessGroups.length} selected group${form.accessGroups.length > 1 ? 's' : ''}.`}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {COMPANY_ACCESS_GROUPS.map(group => {
                          const checked = form.accessGroups.includes(group.key);
                          return (
                            <button
                              key={group.key}
                              type="button"
                              onClick={() => setForm(f => ({
                                ...f,
                                accessGroups: checked
                                  ? f.accessGroups.filter(k => k !== group.key)
                                  : [...f.accessGroups, group.key],
                              }))}
                              className={`flex items-start gap-2 p-2.5 rounded-xl border text-left transition-all ${
                                checked
                                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
                                  : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
                              }`}
                            >
                              <div className={`mt-0.5 w-3.5 h-3.5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${
                                checked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-slate-600'
                              }`}>
                                {checked && <span className="text-white text-[8px] font-black leading-none">✓</span>}
                              </div>
                              <div>
                                <p className={`text-[9px] font-black uppercase tracking-wider leading-tight ${
                                  checked ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'
                                }`}>{group.label}</p>
                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight">{group.desc}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mb-3">
                        {form.accessGroups.length === 0
                          ? 'Currently visible to all battalion staff (70+). Select groups below to restrict access.'
                          : `Restricted to ${form.accessGroups.length} selected group${form.accessGroups.length > 1 ? 's' : ''}.`}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {ACCESS_GROUPS.map(group => {
                          const checked = form.accessGroups.includes(group.key);
                          return (
                            <button
                              key={group.key}
                              type="button"
                              onClick={() => setForm(f => ({
                                ...f,
                                accessGroups: checked
                                  ? f.accessGroups.filter(k => k !== group.key)
                                  : [...f.accessGroups, group.key],
                              }))}
                              className={`flex items-start gap-2 p-2.5 rounded-xl border text-left transition-all ${
                                checked
                                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30'
                                  : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
                              }`}
                            >
                              <div className={`mt-0.5 w-3.5 h-3.5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${
                                checked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-slate-600'
                              }`}>
                                {checked && <span className="text-white text-[8px] font-black leading-none">✓</span>}
                              </div>
                              <div>
                                <p className={`text-[9px] font-black uppercase tracking-wider leading-tight ${
                                  checked ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'
                                }`}>{group.label}</p>
                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 leading-tight">{group.desc}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {/* Last saved info */}
              {modalMode === 'view' && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  Created by {activeLog?.createdByName || '—'}
                  {activeLog?.updatedAt && ` · Last updated ${fmtDate(activeLog.updatedAt)} by ${activeLog.updatedByName || '—'}`}
                </p>
              )}

              {/* ── Action buttons ─────────────────────────────────────────────── */}
              {modalMode !== 'view' && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={closeModal}
                    className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-blue-50/50 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 transition-colors border border-blue-100 dark:border-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!form.meetingDate || !form.meetingName.trim() || saving}
                    className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? 'Saving…' : modalMode === 'create' ? 'Create Log' : 'Save Changes'}
                  </button>
                </div>
              )}

              {modalMode === 'view' && (canElevatedEdit || activeLog?.createdBy === uid) && (
                <div className="pt-2">
                  <button
                    onClick={() => { closeModal(); openEdit(activeLog); }}
                    className="w-full py-3 rounded-xl text-xs font-black uppercase tracking-wider bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 hover:bg-yellow-500 hover:text-slate-950 transition-all border border-yellow-200/50 dark:border-yellow-500/20"
                  >
                    <span className="flex items-center justify-center gap-2"><Pencil size={12} /> Edit This Log</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMeetingLogs;
