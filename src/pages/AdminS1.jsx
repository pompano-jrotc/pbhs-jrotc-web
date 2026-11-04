// src/pages/AdminS1.jsx
//
// S1 Tracker — form turn-in tracking + quick link to Battalion Roster.
//
// WHO CAN SEE THIS PAGE
//   View:   s1_adjutant, s3_operations, battalion_xo, company_s1_assistant,
//           company_xo, company_1sg, company_commander, company_s3_assistant,
//           and anyone at ADMIN_LEVEL (80+).
//   Create: s1_adjutant (battalion-wide or company), company_xo, company_1sg,
//           company_commander, and anyone at ADMIN_LEVEL.
//   Mark:   same as view minus battalion_xo (read-only).
//
// SCOPE
//   S1 Adjutant creates battalion-wide events (all cadets) or company-specific.
//   Company XO/CC/1SG creates company-scoped events (own company only).
//   Company assistants see only their company's submissions inside events.
//   Battalion-level users see all submissions across all companies.
//
// DATA MODEL (Firestore)
//   formEvents/{id}:
//     title, dueDate, scope ('battalion'|'company'), company (null if bn-wide),
//     createdBy (uid), createdByName, createdByRole, createdAt, totalCadets
//
//   formSubmissions/{id}:
//     eventId, rosterDocId, linkedUid, cadetName, rank, company,
//     status ('pending'|'turned_in'), turnedInAt, turnedInBy, turnedInByName,
//     notes, fileUrl, fileStoragePath

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { db, auth, storage } from '../firebase';
import {
  collection, query, where, onSnapshot,
  writeBatch, doc, getDocs, Timestamp, updateDoc, deleteDoc, increment,
} from 'firebase/firestore';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { validateCadetDocument } from '../utils/validateUpload';
import { uploadFileToPath } from '../utils/storageUploadPhoto';
import {
  ClipboardList, Plus, ChevronLeft, CheckCircle2, Clock,
  Search, ChevronDown, ChevronUp, BookUser, Upload,
  Mail, X, FileText, Paperclip, Trophy, GraduationCap,
  Trash2, RotateCcw, Pencil, Check,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import { useCompanies } from '../hooks/useCompanies';
import S1PromotionBoard from '../components/S1PromotionBoard';
import { groupByLet } from '../utils/groupByLet';
import DatePicker from '../components/DatePicker';

// ── Role constants ─────────────────────────────────────────────────────────────
// Only S1 adjutant and Company XO can create events / mark submissions.
// CC and 1SG are VIEW-ONLY — this enforces that S1 and XO do the data-entry work.
// MSgt is also view-only (edit rights limited to Cadet Challenge only).
const CAN_CREATE_ROLES = [
  's1_adjutant', 'company_xo',
];
const CAN_MARK_ROLES = [
  's1_adjutant', 's3_operations',
  'company_s1_assistant', 'company_xo', 'company_s3_assistant',
];
const CAN_VIEW_ROLES = [
  ...CAN_MARK_ROLES,
  'battalion_xo',
  'company_commander', 'company_1sg', 'company_master_sergeant',
];

// Companies that are battalion HQ, not line companies.
// Legacy 'Zulu' is kept for backward compat — old Firestore records still carry it.
const BATTALION_COMPANIES = ['Battalion', 'Zulu'];

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isPast(ts) {
  if (!ts) return false;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d < new Date();
}

// ── SubmissionRow ──────────────────────────────────────────────────────────────
// Renders a single cadet row in the event detail table.
// Note editing is inline: click the notes cell to edit, blur/Enter to save.
function SubmissionRow({ sub, canMark, showCompany, onToggle, onUpdateNotes, onUpload, uploadingId }) {
  const [editNotes, setEditNotes] = useState(false);
  // notesVal is only the in-progress edit value — we DON'T try to sync it
  // with sub.notes via an effect. Instead we initialise it from sub.notes
  // at the moment the user opens the input (onClick below). While not editing
  // we render sub.notes directly, so Firestore updates always show through.
  const [notesVal, setNotesVal]   = useState('');
  const fileRef      = useRef(null);
  const isUploading  = uploadingId === sub.id;
  const isTurnedIn   = sub.status === 'turned_in';

  const startEditing = () => {
    if (!canMark) return;
    setNotesVal(sub.notes || '');
    setEditNotes(true);
  };

  const handleNotesBlur = () => {
    setEditNotes(false);
    if (notesVal !== (sub.notes || '')) onUpdateNotes(sub.id, notesVal);
  };

  return (
    <tr className={`border-b border-blue-50 dark:border-white/5 hover:bg-blue-50/30 dark:hover:bg-white/[0.02] transition-colors ${isTurnedIn ? 'opacity-60' : ''}`}>
      {/* Cadet */}
      <td className="px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{sub.cadetName || '—'}</p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">{sub.rank}</p>
        </div>
      </td>

      {/* Company (battalion-level only) */}
      {showCompany && (
        <td className="px-4 py-3">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{sub.company || '—'}</span>
        </td>
      )}

      {/* Status chip */}
      <td className="px-4 py-3">
        {isTurnedIn ? (
          <span className="inline-flex items-center gap-1.5 bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400 text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap">
            <CheckCircle2 size={9} /> Turned In
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 bg-orange-100 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap">
            <Clock size={9} /> Pending
          </span>
        )}
      </td>

      {/* Date + who marked */}
      <td className="px-4 py-3">
        {isTurnedIn ? (
          <div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{fmtDate(sub.turnedInAt)}</p>
            {sub.turnedInByName && (
              <p className="text-[9px] text-slate-400 dark:text-slate-500">{sub.turnedInByName}</p>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>

      {/* Notes — click to edit */}
      <td className="px-4 py-3 max-w-[160px]">
        {editNotes ? (
          <input
            autoFocus
            value={notesVal}
            onChange={e => setNotesVal(e.target.value)}
            onBlur={handleNotesBlur}
            onKeyDown={e => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') { setNotesVal(sub.notes || ''); setEditNotes(false); }
            }}
            className="w-full bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs text-slate-900 dark:text-white outline-none focus:border-yellow-500/40"
            placeholder="Add note…"
          />
        ) : (
          <button
            onClick={startEditing}
            className={`text-xs text-left w-full truncate leading-snug ${
              canMark
                ? 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-text'
                : 'text-slate-400 dark:text-slate-500 cursor-default'
            }`}
            title={sub.notes || (canMark ? 'Click to add note' : '')}
          >
            {sub.notes
              ? sub.notes
              : <span className="italic text-slate-300 dark:text-slate-600">{canMark ? 'Add note…' : '—'}</span>
            }
          </button>
        )}
      </td>

      {/* Proof file */}
      <td className="px-4 py-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onUpload(sub, f);
            e.target.value = '';
          }}
        />
        {sub.fileUrl ? (
          <div className="flex items-center gap-1.5">
            <a
              href={sub.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:underline"
            >
              <FileText size={10} /> View
            </a>
            {canMark && (
              <button
                onClick={() => fileRef.current?.click()}
                title="Replace file"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <Upload size={10} />
              </button>
            )}
          </div>
        ) : canMark ? (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors disabled:opacity-40"
          >
            {isUploading
              ? <span className="animate-pulse">…</span>
              : <><Paperclip size={10} /> Attach</>
            }
          </button>
        ) : (
          <span className="text-[10px] text-slate-300 dark:text-slate-600">—</span>
        )}
      </td>

      {/* Action toggle */}
      {canMark && (
        <td className="px-4 py-3">
          <button
            onClick={() => onToggle(sub)}
            className={`text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
              isTurnedIn
                ? 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400'
                : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-500 hover:bg-yellow-500 hover:text-slate-950'
            }`}
          >
            {isTurnedIn ? 'Unmark' : 'Mark Turned In'}
          </button>
        </td>
      )}
    </tr>
  );
}

// ── EventCard ──────────────────────────────────────────────────────────────────
function EventCard({ event, archived = false, onClick, onDelete, onArchive, onUnarchive }) {
  const pastDue = isPast(event.dueDate);

  return (
    <div
      className={`w-full bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group ${
        archived
          ? 'border-blue-100/50 dark:border-white/[0.03] hover:border-slate-300 dark:hover:border-white/10'
          : pastDue
            ? 'border-red-200 dark:border-red-500/20 hover:border-red-400 dark:hover:border-red-500/40'
            : 'border-blue-100 dark:border-white/5 hover:border-yellow-500/40 dark:hover:border-yellow-500/20'
      }`}
    >
      {/* Clickable body */}
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className={`text-sm font-black leading-tight transition-colors ${
            archived
              ? 'text-slate-500 dark:text-slate-400'
              : 'text-slate-900 dark:text-white group-hover:text-yellow-600 dark:group-hover:text-yellow-500'
          }`}>
            {event.title}
          </h3>
          {pastDue && !archived && (
            <span className="shrink-0 text-[9px] font-black uppercase bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">
              Past Due
            </span>
          )}
        </div>

        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
          Due {fmtDate(event.dueDate)}
        </p>
        <p className="text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-wider">
          {event.scope === 'battalion' ? 'Battalion-Wide' : `${event.company} Co`}
          {' · '}
          {event.totalCadets ?? '—'} cadets
        </p>
      </button>

      {/* Action row */}
      {(onDelete || onArchive || onUnarchive) && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
          {onArchive && !archived && (
            <button
              onClick={(ev) => { ev.stopPropagation(); onArchive(event); }}
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <RotateCcw size={11} /> Archive
            </button>
          )}
          {onUnarchive && archived && (
            <button
              onClick={(ev) => { ev.stopPropagation(); onUnarchive(event); }}
              className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-400 hover:text-yellow-500 transition-colors"
            >
              <RotateCcw size={11} /> Restore
            </button>
          )}
          {onDelete && (
            <button
              onClick={(ev) => { ev.stopPropagation(); onDelete(event); }}
              className="ml-auto flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-red-500 dark:text-red-400 hover:text-red-400 transition-colors"
            >
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
const AdminS1 = ({ hideHeader = false, forceTab = null }) => {
  const { userData, role, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  const { companies }  = useCompanies();

  const userLevel  = ROLE_HIERARCHY[role] || 0;
  const myCompany  = userData?.company;

  // ── Access flags ─────────────────────────────────────────────────────────────
  const isAuthorized     = CAN_VIEW_ROLES.includes(role) || userLevel >= ADMIN_LEVEL;
  const canCreate        = CAN_CREATE_ROLES.includes(role) || userLevel >= ADMIN_LEVEL;
  const canMark          = CAN_MARK_ROLES.includes(role) || userLevel >= ADMIN_LEVEL;
  // Battalion-level users (L70+) see all companies; company roles see only their own.
  const isBattalionLevel = userLevel >= STAFF_LEVEL;
  // Only S1 Adjutant (+ instructors) can create battalion-wide events.
  const isS1 = role === 's1_adjutant' || userLevel >= ADMIN_LEVEL;
  // Promotion Board is restricted — S1/S3 assistants and Master Sergeants see Forms tab only.
  const BOARD_BLOCKED_ROLES = ['company_s1_assistant', 'company_s3_assistant', 'company_master_sergeant'];
  const canViewBoard = !BOARD_BLOCKED_ROLES.includes(role);

  // ── State ────────────────────────────────────────────────────────────────────
  const [view,            setView]            = useState('list'); // 'list' | 'detail'
  const [selectedEvent,   setSelectedEvent]   = useState(null);
  const [events,          setEvents]          = useState([]);
  const [submissions,     setSubmissions]     = useState([]);
  const [showArchived,    setShowArchived]    = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [groupLet,        setGroupLet]        = useState(false);
  const [statusFilter,    setStatusFilter]    = useState('all'); // 'all' | 'pending' | 'turned_in'
  const [companyFilter,   setCompanyFilter]   = useState('all');
  const [uploadingId,     setUploadingId]     = useState(null);
  const [sendingEmail,    setSendingEmail]    = useState(false);
  const [emailFeedback,   setEmailFeedback]   = useState('');  // success/error message
  const [creating,        setCreating]        = useState(false);
  const [activeTab,       setActiveTab]       = useState(forceTab || 'forms'); // 'forms' | 'board'

  const [bnRoster, setBnRoster]       = useState([]); // roster members whose secondaryCompany === active company
  const [editDueDate,  setEditDueDate]  = useState(false);   // inline due-date editor open
  const [newDueDate,   setNewDueDate]   = useState('');       // value for the date <input>
  const [savingDate,   setSavingDate]   = useState(false);

  const [createForm, setCreateForm] = useState({
    title:   '',
    dueDate: '',
    scope:   'battalion',
    company: '',
  });

  // ── Firestore: form events ────────────────────────────────────────────────────
  useEffect(() => {
    if (!userData || !isAuthorized) return;
    const unsubs = [];

    if (isBattalionLevel) {
      // Single query — battalion users see everything
      const q = query(collection(db, 'formEvents'));
      unsubs.push(onSnapshot(q, snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        docs.sort((a, b) => (b.dueDate?.seconds || 0) - (a.dueDate?.seconds || 0));
        setEvents(docs);
      }));
    } else {
      // Two queries merged client-side: battalion-wide events + own company events.
      // Firestore doesn't support OR across different fields in one query.
      let bnEvts = [], coEvts = [];

      const merge = () => {
        const all = [...bnEvts, ...coEvts];
        all.sort((a, b) => (b.dueDate?.seconds || 0) - (a.dueDate?.seconds || 0));
        setEvents(all);
      };

      const q1 = query(collection(db, 'formEvents'), where('scope', '==', 'battalion'));
      const q2 = query(
        collection(db, 'formEvents'),
        where('scope', '==', 'company'),
        where('company', '==', myCompany || ''),
      );

      unsubs.push(onSnapshot(q1, snap => {
        bnEvts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        merge();
      }));
      unsubs.push(onSnapshot(q2, snap => {
        coEvts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        merge();
      }));
    }

    return () => unsubs.forEach(u => u());
  }, [userData, isAuthorized, isBattalionLevel, myCompany]);

  // ── Firestore: submissions for selected event ─────────────────────────────────
  useEffect(() => {
    if (!selectedEvent) { setSubmissions([]); return; }

    const merge = (parts) => {
      const flat = parts.flat();
      flat.sort((a, b) => {
        const co = (a.company || '').localeCompare(b.company || '');
        return co !== 0 ? co : (a.cadetName || '').localeCompare(b.cadetName || '');
      });
      setSubmissions(flat);
    };

    const unsubs = [];

    if (isBattalionLevel) {
      // Battalion: one listener for all submissions in this event
      let all = [];
      unsubs.push(onSnapshot(
        query(collection(db, 'formSubmissions'), where('eventId', '==', selectedEvent.id)),
        snap => { all = snap.docs.map(d => ({ id: d.id, ...d.data() })); merge([all]); }
      ));
    } else {
      // Company: own company subs + battalion member subs assigned to this company
      let compSubs = [], bnSubs = [];
      const rebuild = () => merge([compSubs, bnSubs]);

      unsubs.push(onSnapshot(
        query(collection(db, 'formSubmissions'),
          where('eventId', '==', selectedEvent.id),
          where('company', '==', myCompany || '')),
        snap => { compSubs = snap.docs.map(d => ({ id: d.id, ...d.data() })); rebuild(); }
      ));
      // Battalion members whose secondaryCompany === myCompany (requires updated Firestore rule).
      // Error handler is required — without it a query failure (missing index / permission)
      // throws an unhandled error that can wipe compSubs from the merged submissions state.
      unsubs.push(onSnapshot(
        query(collection(db, 'formSubmissions'),
          where('eventId', '==', selectedEvent.id),
          where('secondaryCompany', '==', myCompany || '')),
        snap => { bnSubs = snap.docs.map(d => ({ id: d.id, ...d.data() })); rebuild(); },
        err => { console.warn('S1 bn-sub listener (non-fatal):', err); }
      ));
    }

    return () => unsubs.forEach(u => u());
  }, [selectedEvent?.id, isBattalionLevel, myCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Roster-sync safety net ────────────────────────────────────────────────────
  // When any canMark user opens an event, compare the roster (scoped to their
  // company) against existing submissions and silently create missing entries.
  // This covers:
  //   • Cadets added to the roster after the event was created
  //   • Cadets who slipped through the AdminRoster auto-sync (failure / company change)
  // Battalion users see the full event; company users see only their company.
  // totalCadets is updated only by level-45+ users (company command and above);
  // below that the count will be corrected the next time a battalion user opens.
  useEffect(() => {
    if (!selectedEvent || !canMark) return;
    let cancelled = false;
    (async () => {
      try {
        // 1. Roster slice: battalion users check the event's full scope;
        //    company users check only their own company.
        let rq;
        if (isBattalionLevel) {
          rq = selectedEvent.scope === 'battalion'
            ? query(collection(db, 'roster'))
            : query(collection(db, 'roster'), where('company', '==', selectedEvent.company || ''));
        } else {
          rq = query(collection(db, 'roster'), where('company', '==', myCompany || ''));
        }
        const rosterSnap = await getDocs(rq);
        if (cancelled) return;

        // 2. Submissions slice: battalion users query the full event;
        //    company users scope to their company (matches their read permission).
        const subQ = isBattalionLevel
          ? query(collection(db, 'formSubmissions'), where('eventId', '==', selectedEvent.id))
          : query(collection(db, 'formSubmissions'),
              where('eventId', '==', selectedEvent.id),
              where('company', '==', myCompany || ''));
        const subSnap = await getDocs(subQ);
        if (cancelled) return;

        // Build a map from rosterDocId → { subDocId, current fields } for update checks
        const existingMap = {};
        subSnap.docs.forEach(d => {
          const data = d.data();
          if (data.rosterDocId) existingMap[data.rosterDocId] = { docId: d.id, ...data };
        });

        const rosterCadets = rosterSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const rosterIds    = new Set(rosterCadets.map(c => c.id));
        const missing = rosterCadets.filter(c => !existingMap[c.id]);

        // Stale: existing submission whose cadetName, rank, letLevel, or secondaryCompany no longer matches
        const stale = rosterCadets.filter(c => {
          const ex = existingMap[c.id];
          if (!ex) return false;
          return (
            (c.fullName         || '') !== (ex.cadetName        || '') ||
            (c.rank             || '') !== (ex.rank             || '') ||
            (c.letLevel         || '') !== (ex.letLevel         || '') ||
            (c.secondaryCompany || '') !== (ex.secondaryCompany || '')
          );
        });

        // Orphaned: submissions whose rosterDocId no longer exists in the roster.
        // Only staff (70+) can delete formSubmissions per Firestore rules.
        const orphaned = userLevel >= 70
          ? subSnap.docs.filter(d => !rosterIds.has(d.data().rosterDocId || ''))
          : [];

        if (missing.length === 0 && stale.length === 0 && orphaned.length === 0) return;

        const batch = writeBatch(db);

        // Create submissions for new cadets
        missing.forEach(cadet => {
          const subRef = doc(collection(db, 'formSubmissions'));
          batch.set(subRef, {
            eventId:          selectedEvent.id,
            rosterDocId:      cadet.id,
            linkedUid:        cadet.linkedUid       || null,
            cadetName:        cadet.fullName        || '',
            rank:             cadet.rank            || '',
            company:          cadet.company         || '',
            secondaryCompany: cadet.secondaryCompany || '',
            letLevel:         cadet.letLevel        || '',
            status:           'pending',
            turnedInAt:       null,
            turnedInBy:       null,
            turnedInByName:   null,
            notes:            '',
            fileUrl:          null,
            fileStoragePath:  null,
          });
        });

        // Patch stale submissions with current name / rank / letLevel / secondaryCompany
        stale.forEach(cadet => {
          const subDocRef = doc(db, 'formSubmissions', existingMap[cadet.id].docId);
          batch.update(subDocRef, {
            cadetName:        cadet.fullName         || '',
            rank:             cadet.rank             || '',
            letLevel:         cadet.letLevel         || '',
            secondaryCompany: cadet.secondaryCompany || '',
          });
        });

        // Delete orphaned submissions (cadets no longer on the roster for this event scope).
        orphaned.forEach(d => batch.delete(d.ref));

        // Keep totalCadets accurate.
        const countDelta = missing.length - orphaned.length;
        if (countDelta !== 0) {
          batch.update(doc(db, 'formEvents', selectedEvent.id), {
            totalCadets: increment(countDelta),
          });
        }

        await batch.commit();
        if (missing.length  > 0) console.log(`S1 sync: added ${missing.length} missing cadet(s) to "${selectedEvent.title}"`);
        if (stale.length    > 0) console.log(`S1 sync: updated ${stale.length} stale submission(s) in "${selectedEvent.title}"`);
        if (orphaned.length > 0) console.log(`S1 sync: removed ${orphaned.length} orphaned submission(s) from "${selectedEvent.title}"`);
      } catch (err) {
        console.warn('S1 event roster sync failed (non-fatal):', err);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Battalion observer roster ─────────────────────────────────────────────────
  // Load roster members whose secondaryCompany matches the active company view.
  // Used to populate the "Battalion Members" section at the bottom of detail view.
  useEffect(() => {
    if (!selectedEvent) { setBnRoster([]); return; }
    const activeCompany = (isBattalionLevel ? companyFilter : myCompany) || '';
    if (!activeCompany) { setBnRoster([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const rSnap = await getDocs(
          query(collection(db, 'roster'), where('secondaryCompany', '==', activeCompany))
        );
        if (!cancelled) setBnRoster(rSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch { setBnRoster([]); }
    })();
    return () => { cancelled = true; };
  }, [selectedEvent?.id, isBattalionLevel, companyFilter, myCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  // Battalion member submissions for the active company — derived from `submissions`
  // (which for company users now also contains secondaryCompany-matched battalion subs).
  const bnSubs = useMemo(() => {
    if (!bnRoster.length) return [];
    const bnIds = new Set(bnRoster.map(c => c.id));
    return submissions.filter(s =>
      BATTALION_COMPANIES.includes(s.company) && bnIds.has(s.rosterDocId)
    );
  }, [submissions, bnRoster]);

  // ── Event handlers ───────────────────────────────────────────────────────────
  const handleDeleteEvent = async (event) => {
    if (userLevel < 70) return; // staff (70+) only
    const ok = await confirm(`Delete "${event.title}"? All submissions will be permanently removed. This cannot be undone.`, { title: 'Delete Form Event', destructive: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'formEvents', event.id));
    } catch (err) {
      console.error('Failed to delete event:', err);
    }
  };

  // S1 can archive any event; Company XO can archive their company-scoped events.
  const canArchiveEvent = (event) => {
    if (!canCreate) return false;
    if (isBattalionLevel) return true;
    return event.scope === 'company' && event.company === myCompany;
  };

  const handleArchiveEvent = async (event) => {
    if (!canArchiveEvent(event)) return;
    try {
      await updateDoc(doc(db, 'formEvents', event.id), { archived: true });
    } catch (err) {
      console.error('Failed to archive event:', err);
    }
  };

  const handleUnarchiveEvent = async (event) => {
    if (!canArchiveEvent(event)) return;
    try {
      await updateDoc(doc(db, 'formEvents', event.id), { archived: false });
    } catch (err) {
      console.error('Failed to unarchive event:', err);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  // Events stay visible (active) until explicitly archived — past-due events
  // show a "Past Due" badge but are NOT automatically hidden.
  const activeEvents   = events.filter(e => !e.archived);
  const archivedEvents = events.filter(e =>  e.archived);

  // Submissions scoped to this user's company (or all if battalion-level).
  // Battalion/Zulu company submissions are always excluded from the main table —
  // they appear in the dedicated "Battalion Members" section below.
  const visibleSubs  = isBattalionLevel
    ? submissions.filter(s => !BATTALION_COMPANIES.includes(s.company))
    : submissions.filter(s => s.company === myCompany);

  // Stats respect the company filter so the cards show per-company numbers when filtered.
  // 'Battalion' filter shows only battalion-company (Battalion/Zulu) submissions.
  const statSubs = companyFilter === 'Battalion'
    ? submissions.filter(s => BATTALION_COMPANIES.includes(s.company))
    : companyFilter !== 'all'
      ? visibleSubs.filter(s => s.company === companyFilter)
      : visibleSubs;
  const turnedInCount = statSubs.filter(s => s.status === 'turned_in').length;
  const pendingCount  = statSubs.filter(s => s.status === 'pending').length;

  const filteredSubs = useMemo(() => {
    // 'Battalion' filter — show battalion-company submissions in main table
    if (companyFilter === 'Battalion') {
      let list = submissions.filter(s => BATTALION_COMPANIES.includes(s.company));
      if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        list = list.filter(s => (s.cadetName || '').toLowerCase().includes(q));
      }
      return list;
    }
    let list = visibleSubs;
    if (statusFilter  !== 'all') list = list.filter(s => s.status === statusFilter);
    if (companyFilter !== 'all') list = list.filter(s => s.company === companyFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => (s.cadetName || '').toLowerCase().includes(q));
    }
    return list;
  }, [submissions, visibleSubs, statusFilter, companyFilter, searchQuery]);

  const uniqueCompanies = useMemo(
    () => [...new Set(
      submissions.map(s => s.company).filter(c => c && !BATTALION_COMPANIES.includes(c))
    )].sort(),
    [submissions],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleCreateEvent = async () => {
    if (!createForm.title.trim() || !createForm.dueDate) return;
    setCreating(true);

    try {
      const eventScope   = isS1 ? createForm.scope : 'company';
      const eventCompany = eventScope === 'company'
        ? (isS1 && createForm.company ? createForm.company : myCompany)
        : null;

      // Fetch relevant roster entries
      const rq = eventScope === 'battalion'
        ? query(collection(db, 'roster'))
        : query(collection(db, 'roster'), where('company', '==', eventCompany));
      const rosterSnap = await getDocs(rq);
      const cadets     = rosterSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Firestore WriteBatch limit: 500 ops. With one event doc, we have room for 499 cadets.
      // JROTC companies are typically <100; the full battalion is <300.
      if (cadets.length > 498) {
        alert('Too many cadets to batch write at once. Please contact your S6 to split by company.');
        return;
      }

      const batch    = writeBatch(db);
      const eventRef = doc(collection(db, 'formEvents'));

      batch.set(eventRef, {
        title:        createForm.title.trim(),
        dueDate:      Timestamp.fromDate(new Date(createForm.dueDate + 'T23:59:59')),
        scope:        eventScope,
        company:      eventCompany,
        createdBy:    auth.currentUser.uid,
        createdByName: userData?.fullName || '',
        createdByRole: role,
        createdAt:    Timestamp.now(),
        totalCadets:  cadets.length,
      });

      cadets.forEach(cadet => {
        const subRef = doc(collection(db, 'formSubmissions'));
        batch.set(subRef, {
          eventId:          eventRef.id,
          rosterDocId:      cadet.id,
          linkedUid:        cadet.linkedUid        || null,
          cadetName:        cadet.fullName || cadet.name || '',
          rank:             cadet.rank              || '',
          company:          cadet.company           || '',
          secondaryCompany: cadet.secondaryCompany  || '',
          letLevel:         cadet.letLevel          || '',
          status:           'pending',
          turnedInAt:       null,
          turnedInBy:       null,
          turnedInByName:   null,
          notes:            '',
          fileUrl:          null,
          fileStoragePath:  null,
        });
      });

      await batch.commit();

      setShowCreateModal(false);
      setCreateForm({ title: '', dueDate: '', scope: 'battalion', company: '' });
      writeLog({
        type: 's1', action: 'create',
        description: `Created form event: "${createForm.title}" (${eventScope === 'battalion' ? 'battalion-wide' : eventCompany})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetName: createForm.title,
        notes: `cadets:${cadets.length},due:${createForm.dueDate}`,
      });
    } catch (err) {
      console.error('Error creating form event:', err);
      alert('Failed to create form event. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (sub) => {
    if (!canMark) return;
    const newStatus = sub.status === 'pending' ? 'turned_in' : 'pending';
    await updateDoc(doc(db, 'formSubmissions', sub.id), {
      status:          newStatus,
      turnedInAt:      newStatus === 'turned_in' ? Timestamp.now()             : null,
      turnedInBy:      newStatus === 'turned_in' ? auth.currentUser.uid        : null,
      turnedInByName:  newStatus === 'turned_in' ? (userData?.fullName || '')  : null,
    });
    writeLog({
      type: 's1', action: newStatus === 'turned_in' ? 'mark_complete' : 'mark_pending',
      description: `Marked form ${newStatus === 'turned_in' ? 'turned in' : 'pending'} for ${sub.cadetName}`,
      userId: user?.uid || '', userFullName: userData?.fullName || '',
      userRole: role || '', targetId: sub.id, targetName: sub.cadetName,
    });
  };

  const handleUpdateNotes = async (subId, notes) => {
    await updateDoc(doc(db, 'formSubmissions', subId), { notes });
  };

  const handleUploadFile = async (sub, file) => {
    if (!file) return;
    setUploadingId(sub.id);
    try {
      // Validate type/size and silently convert PNG → JPEG before uploading.
      // Files land under form-submissions/ (organised by event) so the S1 can
      // find them by event ID if needed outside the portal.
      const { valid, error, file: outFile } = await validateCadetDocument(file);
      if (!valid) { alert(error); return; }

      const safeName   = outFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path       = `form-submissions/${sub.eventId}/${sub.id}_${Date.now()}_${safeName}`;
      const { url }    = await uploadFileToPath(outFile, path);

      // Clean up old file if there was one, then update the submission record.
      if (sub.fileStoragePath) {
        try { await deleteObject(storageRef(storage, sub.fileStoragePath)); } catch { /* non-fatal */ }
      }
      await updateDoc(doc(db, 'formSubmissions', sub.id), {
        fileUrl:         url,
        fileStoragePath: path,
      });
    } catch (err) {
      console.error('File upload error:', err);
      alert('Upload failed. Please try again.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleSaveDueDate = async () => {
    if (!selectedEvent || !newDueDate) return;
    setSavingDate(true);
    try {
      const newTs = Timestamp.fromDate(new Date(newDueDate + 'T23:59:59'));
      await updateDoc(doc(db, 'formEvents', selectedEvent.id), { dueDate: newTs });
      setSelectedEvent(ev => ({ ...ev, dueDate: newTs }));
      setEditDueDate(false);
    } catch (err) {
      console.error('Failed to update due date:', err);
      alert('Failed to update due date. Please try again.');
    } finally {
      setSavingDate(false);
    }
  };

  const handleSendReminder = async () => {
    if (!selectedEvent) return;
    setSendingEmail(true);
    setEmailFeedback('');

    try {
      const idToken = await auth.currentUser.getIdToken();

      // Build the list of overdue cadets to include in the email
      const pendingCadets = visibleSubs
        .filter(s => s.status === 'pending')
        .map(s => ({ name: s.cadetName, company: s.company, rank: s.rank }));

      const res = await fetch('/api/notify-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          eventId:     selectedEvent.id,
          eventTitle:  selectedEvent.title,
          eventScope:  selectedEvent.scope,
          eventCompany: selectedEvent.company,
          dueDate:     fmtDate(selectedEvent.dueDate),
          pendingCadets,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        setEmailFeedback(`✓ Reminder sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''}.`);
      } else {
        setEmailFeedback(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch {
      setEmailFeedback('Failed to send reminder. Please try again.');
    } finally {
      setSendingEmail(false);
      setTimeout(() => setEmailFeedback(''), 5000);
    }
  };

  const openDetail = (event) => {
    setSelectedEvent(event);
    setView('detail');
    setSearchQuery('');
    setStatusFilter('all');
    setCompanyFilter('all');
    setEmailFeedback('');
  };

  const closeDetail = () => {
    setView('list');
    setSelectedEvent(null);
    setSubmissions([]);
    setEditDueDate(false);
  };

  // ── Guards ────────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="flex-1 flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500" />
    </div>
  );

  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  // ════════════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW  (forms tab only)
  // ════════════════════════════════════════════════════════════════════════════════
  if (activeTab === 'forms' && view === 'detail' && selectedEvent) {
    const isPastDue  = isPast(selectedEvent.dueDate);
    const hasOverdue = isPastDue && pendingCount > 0;

    // Who may change the due date:
    //   Battalion-wide events → S1 Adjutant, Battalion XO, or admin
    //   Company-scoped events → S1 Adjutant, Company XO, or Company S1 Assistant (own company only), or admin
    const canEditDueDateNow = userLevel >= ADMIN_LEVEL || role === 's1_adjutant' ||
      (selectedEvent.scope === 'battalion' && role === 'battalion_xo') ||
      (selectedEvent.scope === 'company' && selectedEvent.company === myCompany &&
        (role === 'company_xo' || role === 'company_s1_assistant'));
    const pct        = statSubs.length > 0
      ? Math.round((turnedInCount / statSubs.length) * 100)
      : 0;

    return (
      <div className="flex-1 p-6 md:p-10 w-full">

          {/* ── Header ─────────────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div>
              <button
                onClick={closeDetail}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors mb-3"
              >
                <ChevronLeft size={13} /> Back to Forms
              </button>
              <h1 className="text-3xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                {selectedEvent.title}
              </h1>
              <div className="flex items-center flex-wrap gap-2 mt-2">
                {/* Due date — static pill or inline editor */}
                {editDueDate ? (
                  <div className="flex items-center gap-1.5">
                    <DatePicker value={newDueDate} onChange={setNewDueDate} placeholder="Pick a date" />
                    <button
                      onClick={handleSaveDueDate}
                      disabled={savingDate || !newDueDate}
                      className="flex items-center gap-1 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg transition-colors"
                    >
                      <Check size={11} /> {savingDate ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditDueDate(false)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${
                      isPastDue
                        ? 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-500'
                    }`}>
                      {isPastDue ? 'Past Due' : 'Active'} — {fmtDate(selectedEvent.dueDate)}
                    </span>
                    {canEditDueDateNow && (
                      <button
                        onClick={() => {
                          // Seed the input with the current due date in YYYY-MM-DD format
                          const d = selectedEvent.dueDate?.toDate
                            ? selectedEvent.dueDate.toDate()
                            : new Date(selectedEvent.dueDate);
                          setNewDueDate(d.toISOString().slice(0, 10));
                          setEditDueDate(true);
                        }}
                        className="text-slate-400 hover:text-yellow-500 transition-colors"
                        title="Edit due date"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                )}
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                  {selectedEvent.scope === 'battalion' ? 'Battalion-Wide' : `${selectedEvent.company} Company`}
                </span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500">
                  Created by {selectedEvent.createdByName || '—'}
                </span>
              </div>
            </div>

            {/* Overdue reminder button (S1 / admin only, when past due and there are pending cadets) */}
            {hasOverdue && isBattalionLevel && (
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={handleSendReminder}
                  disabled={sendingEmail}
                  className="flex items-center gap-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
                >
                  <Mail size={14} />
                  {sendingEmail ? 'Sending…' : 'Send Overdue Reminder'}
                </button>
                {emailFeedback && (
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{emailFeedback}</p>
                )}
              </div>
            )}
          </div>

          {/* ── Stats ──────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Total Cadets', value: statSubs.length,    color: 'text-slate-900 dark:text-white'  },
              { label: 'Turned In',    value: turnedInCount,       color: 'text-green-600 dark:text-green-400' },
              { label: 'Pending',      value: pendingCount,        color: pendingCount > 0 ? 'text-orange-500' : 'text-slate-400 dark:text-slate-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-5 text-center">
                <p className={`text-3xl font-black tracking-tighter ${color}`}>{value}</p>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* ── Progress bar ────────────────────────────────────────────────────── */}
          {statSubs.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-5 mb-6">
              <div className="flex justify-between text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">
                <span>Progress</span>
                <span>{turnedInCount} / {statSubs.length} — {pct}%</span>
              </div>
              <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100 ? '#22c55e' : 'linear-gradient(to right, #eab308, #22c55e)',
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Filters ─────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search cadets…"
                className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
              />
            </div>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="turned_in">Turned In</option>
            </select>

            {isBattalionLevel && (
              <select
                value={companyFilter}
                onChange={e => setCompanyFilter(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
              >
                <option value="all">All Companies</option>
                {uniqueCompanies.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="Battalion">Battalion</option>
              </select>
            )}
            <button
              onClick={() => setGroupLet(g => !g)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all border ${
                groupLet
                  ? 'bg-yellow-500 text-slate-950 border-yellow-500'
                  : 'bg-white dark:bg-slate-900 border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400'
              }`}
            >
              <GraduationCap size={13} /> Group by LET
            </button>
          </div>

          {/* ── Cadet table ─────────────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-3xl overflow-hidden shadow-sm">
            {submissions.length === 0 ? (
              <div className="text-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-yellow-500 mx-auto" />
                <p className="text-slate-400 text-xs font-bold mt-4 uppercase tracking-widest">Loading cadets…</p>
              </div>
            ) : filteredSubs.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No cadets match your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-blue-100 dark:border-white/5">
                      <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Cadet</th>
                      {isBattalionLevel && <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Company</th>}
                      <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Status</th>
                      <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Date</th>
                      <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Notes</th>
                      <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Proof</th>
                      {canMark && <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const renderSub = sub => (
                        <SubmissionRow
                          key={sub.id}
                          sub={sub}
                          canMark={canMark}
                          showCompany={isBattalionLevel}
                          onToggle={handleToggleStatus}
                          onUpdateNotes={handleUpdateNotes}
                          onUpload={handleUploadFile}
                          uploadingId={uploadingId}
                        />
                      );
                      if (groupLet) {
                        return groupByLet(filteredSubs, s => s.letLevel, s => s.cadetName).map(({ level, entries: group }) => (
                          <React.Fragment key={level}>
                            <tr>
                              <td colSpan={999} className="px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-y border-yellow-200 dark:border-yellow-500/20">
                                {level}
                              </td>
                            </tr>
                            {group.map(renderSub)}
                          </React.Fragment>
                        ));
                      }
                      return filteredSubs.map(renderSub);
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Battalion Members section ────────────────────────────────────────
              Shows when there are battalion-staff cadets whose secondaryCompany
              matches the company being viewed. Always at the bottom, separate
              from the company roster so stats and LET grouping are unaffected.  */}
          {bnSubs.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Battalion Members
                </span>
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  {bnSubs.filter(s => s.status === 'turned_in').length} / {bnSubs.length} turned in
                </span>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-3xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-blue-100 dark:border-white/5">
                        <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Cadet</th>
                        <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Status</th>
                        <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Date</th>
                        <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Notes</th>
                        <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Proof</th>
                        {canMark && <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {bnSubs
                        .slice()
                        .sort((a, b) => (a.cadetName || '').localeCompare(b.cadetName || ''))
                        .map(sub => (
                          <SubmissionRow
                            key={sub.id}
                            sub={sub}
                            canMark={canMark}
                            showCompany={false}
                            onToggle={handleToggleStatus}
                            onUpdateNotes={handleUpdateNotes}
                            onUpload={handleUploadFile}
                            uploadingId={uploadingId}
                          />
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════════════════════════
  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={ClipboardList} title="S1 Tracker" meta="Personnel &amp; Form Tracking" />}

        {/* ── Action bar ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 justify-end -mt-4 mb-8">
            <Link
              to="/admin/roster"
              className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 text-slate-700 dark:text-slate-300 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl hover:border-yellow-500/40 dark:hover:border-yellow-500/20 transition-colors"
            >
              <BookUser size={14} /> Battalion Roster
            </Link>
            {activeTab === 'forms' && canCreate && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
              >
                <Plus size={14} /> New Form Event
              </button>
            )}
        </div>

        {/* ── Tab bar (hidden when forceTab is set by parent) ──────────────────────── */}
        {!forceTab && (
          <div className="flex gap-1 mb-8 bg-blue-50/70 dark:bg-slate-800/50 rounded-2xl p-1 max-w-xs">
            {[
              { key: 'forms', label: 'Form Tracker',    Icon: ClipboardList },
              ...(canViewBoard ? [{ key: 'board', label: 'Promotion Board', Icon: Trophy }] : []),
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => {
                  setActiveTab(key);
                  if (key === 'board' && view === 'detail') closeDetail();
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                  activeTab === key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════════
            FORM TRACKER (list view)
        ══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'forms' && (<>

        {/* ── Active events ───────────────────────────────────────────────────────── */}
        <section className="mb-10">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-300 dark:text-slate-600 mb-4">
            Active — {activeEvents.length}
          </p>

          {activeEvents.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
              <ClipboardList className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
              <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No active form events</p>
              {canCreate && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="mt-4 text-yellow-600 dark:text-yellow-500 text-xs font-black uppercase tracking-widest hover:underline"
                >
                  Create one →
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeEvents.map(e => (
                <EventCard
                  key={e.id}
                  event={e}
                  onClick={() => openDetail(e)}
                  onDelete={userLevel >= 70 ? handleDeleteEvent : undefined}
                  onArchive={canArchiveEvent(e) ? handleArchiveEvent : undefined}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Archived events ─────────────────────────────────────────────────────── */}
        {archivedEvents.length > 0 && (
          <section>
            <button
              onClick={() => setShowArchived(s => !s)}
              className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-600 mb-4 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
            >
              {showArchived ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              Archived — {archivedEvents.length}
            </button>
            {showArchived && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-70">
                {archivedEvents.map(e => (
                  <EventCard
                    key={e.id}
                    event={e}
                    archived
                    onClick={() => openDetail(e)}
                    onDelete={userLevel >= 70 ? handleDeleteEvent : undefined}
                    onUnarchive={canArchiveEvent(e) ? handleUnarchiveEvent : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        </>)} {/* end activeTab === 'forms' */}

        {/* ══════════════════════════════════════════════════════════════════════════
            PROMOTION BOARD
        ══════════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'board' && canViewBoard && (
          <S1PromotionBoard
            userData={userData}
            role={role}
            userLevel={userLevel}
            myCompany={myCompany}
            isBattalionLevel={isBattalionLevel}
            isS1={isS1}
          />
        )}


      {/* ════════════════════════════════════════════════════════════════════════════
          CREATE MODAL  (form tracker only)
      ════════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'forms' && showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-blue-100 dark:border-white/5">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                New Form Event
              </h2>
              <button
                onClick={() => { setShowCreateModal(false); setCreateForm({ title: '', dueDate: '', scope: 'battalion', company: '' }); }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">
                  Form Title
                </label>
                <input
                  value={createForm.title}
                  onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., DODAJ 3320, Field Trip Permission Slip…"
                  className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                />
              </div>

              {/* Due date */}
              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">
                  Due Date
                </label>
                <DatePicker
                  value={createForm.dueDate}
                  onChange={v => setCreateForm(f => ({ ...f, dueDate: v }))}
                />
              </div>

              {/* Scope — S1 Adjutant + admin level only */}
              {isS1 ? (
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">
                    Scope
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setCreateForm(f => ({ ...f, scope: 'battalion', company: '' }))}
                      className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                        createForm.scope === 'battalion'
                          ? 'bg-yellow-500 text-slate-950'
                          : 'bg-blue-50/50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-blue-100 dark:border-white/5 hover:border-yellow-500/30'
                      }`}
                    >
                      Battalion-Wide
                    </button>
                    <button
                      onClick={() => setCreateForm(f => ({ ...f, scope: 'company', company: companies[0] || '' }))}
                      className={`py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                        createForm.scope === 'company'
                          ? 'bg-yellow-500 text-slate-950'
                          : 'bg-blue-50/50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-blue-100 dark:border-white/5 hover:border-yellow-500/30'
                      }`}
                    >
                      Specific Company
                    </button>
                  </div>
                  {createForm.scope === 'company' && (
                    <select
                      value={createForm.company || companies[0] || ''}
                      onChange={e => setCreateForm(f => ({ ...f, company: e.target.value }))}
                      className="mt-2 w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                    >
                      {companies.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
              ) : (
                // Company-role users: company is locked
                <div className="bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    Company
                  </p>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mt-0.5">{myCompany || '—'}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => { setShowCreateModal(false); setCreateForm({ title: '', dueDate: '', scope: 'battalion', company: '' }); }}
                className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-blue-50/50 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 transition-colors border border-blue-100 dark:border-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateEvent}
                disabled={!createForm.title.trim() || !createForm.dueDate || creating}
                className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating…' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminS1;
