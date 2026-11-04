import React, { useState, useEffect } from 'react';
import {
  collection, addDoc, getDocs, query, where, orderBy,
  onSnapshot, updateDoc, deleteDoc, doc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  History, Archive, Trash2, Edit3, ChevronDown, Loader2,
  X, AlertTriangle, CheckCircle, User, Trophy, BookOpen, Tent,
  GraduationCap, Plus,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY } from '../constants';

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMIN_LEVEL   = 80;
const COMMAND_LEVEL = 45;

const ROLE_LABELS = {
  senior_army_instructor: 'Senior Army Instructor',
  army_instructor: 'Army Instructor',
  battalion_commander: 'Battalion Commander',
  battalion_xo: 'Battalion XO',
  battalion_csm: 'Battalion CSM',
  sergeant_major: 'Sergeant Major',
  s1_staff: 'S1', s2_staff: 'S2', s3_staff: 'S3', s4_staff: 'S4',
  s5_staff: 'S5', s6_staff: 'S6', s7_staff: 'S7',
  company_commander: 'Company Commander',
  company_xo: 'Company XO',
  company_1sg: 'Company 1SG',
  company_master_sergeant: 'Master Sergeant',
};

// Compute current default school year based on date
function defaultSchoolYear() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-12
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function fmtScore(val, decimals = 0) {
  if (val === null || val === undefined || val === '') return '—';
  return Number(val).toFixed(decimals);
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Archive Modal ─────────────────────────────────────────────────────────────

function ArchiveModal({ onClose, adminUser }) {
  const [yearLabel, setYearLabel] = useState(defaultSchoolYear());
  const [step, setStep]           = useState('config'); // 'config' | 'preview' | 'done'
  const [preview, setPreview]     = useState([]);       // roster entries to archive
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [archived, setArchived]   = useState(0);

  async function loadPreview() {
    if (!yearLabel.trim()) { setError('Please enter a valid school year (e.g. 2025-2026).'); return; }
    setError('');
    setLoading(true);
    try {
      // Check if this year has already been archived
      const existing = await getDocs(
        query(collection(db, 'cadetYearlyHistory'), where('schoolYear', '==', yearLabel.trim()), where('archived', '==', true))
      );
      // Pull roster
      const rosterSnap = await getDocs(collection(db, 'roster'));
      const cadets = rosterSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => !c.graduated); // skip already-graduated cadets

      // Pull challenge records — group by cadetName, keep latest by date
      const challengeSnap = await getDocs(collection(db, 'cadetChallengeRecords'));
      const scoresByName = {};
      challengeSnap.docs.forEach(d => {
        const data = d.data();
        const name = data.cadetName;
        if (!name) return;
        const prev = scoresByName[name];
        const ts   = data.createdAt?.seconds || 0;
        if (!prev || ts > (prev._ts || 0)) {
          scoresByName[name] = { ...data, _ts: ts };
        }
      });

      setPreview(cadets.map(c => {
        const scores = scoresByName[c.fullName] || null;
        return { ...c, scores };
      }));
      setStep('preview');
    } catch (err) {
      setError('Failed to load roster. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function runArchive() {
    setSaving(true);
    setError('');
    try {
      const adminName = adminUser?.fullName || 'Admin';
      const adminUid  = adminUser?.uid      || '';
      const year      = yearLabel.trim();

      let count = 0;
      // Batch writes (Firestore limit: 500 per batch)
      const chunkSize = 400;
      for (let i = 0; i < preview.length; i += chunkSize) {
        const batch = writeBatch(db);
        const chunk = preview.slice(i, i + chunkSize);
        chunk.forEach(cadet => {
          const ref = doc(collection(db, 'cadetYearlyHistory'));
          const { scores } = cadet;
          batch.set(ref, {
            rosterId:       cadet.id,
            cadetName:      cadet.fullName || '',
            company:        cadet.company  || '',
            rank:           cadet.rank     || '',
            position:       cadet.role     || '',
            letLevel:       cadet.letLevel || '',
            awards:         '',
            campNotes:      '',
            scores: scores
              ? {
                  pushUps:      scores.pushUps      ?? null,
                  sitUps:       scores.sitUps       ?? null,
                  shuttleRun:   scores.shuttleRun   ?? null,
                  oneMile:      scores.oneMile      ?? null,
                  sitNReach:    scores.sitNReach    ?? null,
                  medicalExempt: scores.medicalExempt ?? false,
                }
              : null,
            schoolYear:       year,
            archivedAt:       serverTimestamp(),
            archivedByName:   adminName,
            archivedByUid:    adminUid,
            archived:         true,
          });
          count++;
        });
        await batch.commit();
      }

      setArchived(count);
      setStep('done');
      writeLog({
        type: 'history', action: 'archive',
        description: `Archived ${count} cadet records for school year ${year}`,
        userId: adminUid, userFullName: adminName,
        userRole: '', notes: `year:${year},count:${count}`,
      });
    } catch (err) {
      setError('Archive failed. Some records may not have been saved. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <Archive size={18} className="text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 dark:text-white">Archive School Year</h3>
              <p className="text-xs text-slate-400">
                {step === 'config'  && 'Set the school year label'}
                {step === 'preview' && `${preview.length} cadets will be archived`}
                {step === 'done'    && 'Archive complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* Config step */}
          {step === 'config' && (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                This will create a permanent snapshot of every active cadet's current rank, position, company, LET level, and most recent Cadet Challenge scores for the selected school year.
              </p>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  School Year Label <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={yearLabel}
                  onChange={e => setYearLabel(e.target.value)}
                  placeholder="2025-2026"
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl text-xs text-yellow-800 dark:text-yellow-300 leading-relaxed">
                <strong>Note:</strong> Graduated cadets are automatically excluded. Each cadet's challenge scores are pulled from their most recent recorded cycle. You can add awards and camp notes after archiving.
              </div>
            </>
          )}

          {/* Preview step */}
          {step === 'preview' && (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Review the cadets to be archived for <strong className="text-slate-900 dark:text-white">{yearLabel}</strong>. Click <em>Confirm Archive</em> to proceed.
              </p>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {preview.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{c.fullName}</span>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{c.rank || '—'}</span>
                      <span>·</span>
                      <span>{c.company ? `${c.company} Co.` : '—'}</span>
                      {c.scores && <span className="text-green-600 dark:text-green-400 font-semibold">✓ scores</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Done step */}
          {step === 'done' && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
                <CheckCircle size={32} className="text-green-600 dark:text-green-400" />
              </div>
              <h4 className="font-black text-slate-900 dark:text-white text-lg mb-1">Archive Complete</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {archived} cadet record{archived !== 1 ? 's' : ''} saved for <strong className="text-slate-700 dark:text-slate-300">{yearLabel}</strong>.
              </p>
              <p className="text-xs text-slate-400 mt-2">
                You can now add awards and camp notes by clicking into individual records.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-xs text-red-700 dark:text-red-300">
              <AlertTriangle size={13} className="shrink-0" /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-slate-100 dark:border-slate-800 shrink-0">
          {step === 'done' ? (
            <button onClick={onClose} className="px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold text-sm rounded-xl">
              Done
            </button>
          ) : step === 'config' ? (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                Cancel
              </button>
              <button
                onClick={loadPreview}
                disabled={loading || !yearLabel.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold text-sm rounded-xl disabled:opacity-60"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                Preview Cadets →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('config')} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                Back
              </button>
              <button
                onClick={runArchive}
                disabled={saving || preview.length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold text-sm rounded-xl disabled:opacity-60"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Confirm Archive ({preview.length} cadets)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edit Record Modal ─────────────────────────────────────────────────────────

function EditRecordModal({ record, onClose }) {
  const [awards,    setAwards]    = useState(record.awards    || '');
  const [campNotes, setCampNotes] = useState(record.campNotes || '');
  const [letLevel,  setLetLevel]  = useState(record.letLevel  || '');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const { user, userData, role } = useAuth();

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await updateDoc(doc(db, 'cadetYearlyHistory', record.id), {
        awards: awards.trim(),
        campNotes: campNotes.trim(),
        letLevel: letLevel.trim(),
      });
      writeLog({
        type: 'history', action: 'update',
        description: `Updated history record for ${record.cadetName} (${record.schoolYear})`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: record.id, targetName: record.cadetName,
      });
      onClose();
    } catch (err) {
      setError('Failed to save. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const s = record.scores;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-0.5">{record.schoolYear}</p>
            <h3 className="font-black text-slate-900 dark:text-white">{record.cadetName}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {record.rank && <span className="mr-1">{record.rank}</span>}
              {record.position && <span>· {ROLE_LABELS[record.position] || record.position}</span>}
              {record.company && <span> · {record.company} Co.</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Challenge Scores (read-only) */}
          {s && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                <Trophy size={11} /> Cadet Challenge Scores
              </p>
              {s.medicalExempt ? (
                <p className="text-xs text-slate-500 italic">Medical exemption on file</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Push-Ups',    val: fmtScore(s.pushUps) },
                    { label: 'Sit-Ups',     val: fmtScore(s.sitUps) },
                    { label: 'Shuttle Run', val: fmtScore(s.shuttleRun, 1) },
                    { label: '1-Mile Run',  val: s.oneMile || '—' },
                    { label: 'Sit & Reach', val: fmtScore(s.sitNReach, 1) },
                  ].map(({ label, val }) => (
                    <div key={label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5 text-center">
                      <div className="text-lg font-black text-slate-800 dark:text-white">{val}</div>
                      <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!s && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs text-slate-500 italic">
              No challenge scores recorded for this cadet.
            </div>
          )}

          {/* LET Level */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
              <BookOpen size={11} /> LET Level
            </label>
            <input
              type="text"
              value={letLevel}
              onChange={e => setLetLevel(e.target.value)}
              placeholder="LET 1, LET 2, etc."
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
          </div>

          {/* Awards */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Trophy size={11} /> Awards Earned
            </label>
            <textarea
              value={awards}
              onChange={e => setAwards(e.target.value)}
              placeholder="e.g. Academic Excellence Ribbon, Physical Fitness Badge…"
              rows={2}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
            />
          </div>

          {/* Camp Notes */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Tent size={11} /> Camp Attendance
            </label>
            <textarea
              value={campNotes}
              onChange={e => setCampNotes(e.target.value)}
              placeholder="Attended camps, leadership schools, special programs…"
              rows={2}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold text-sm rounded-xl disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />} Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminCadetHistory({ hideHeader = false }) {
  const { userData, role } = useAuth();
  const user  = userData;
  const level = ROLE_HIERARCHY[role] ?? 0;

  const isAdmin = level >= ADMIN_LEVEL;
  const canView = level >= COMMAND_LEVEL; // Company Leadership+

  const [records, setRecords]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [years, setYears]           = useState([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [showArchive, setShowArchive]   = useState(false);
  const [editRecord, setEditRecord]     = useState(null);
  const [deleteConf, setDeleteConf]     = useState(null); // {type:'record'|'year', id?, year?}
  const [deleting, setDeleting]         = useState(false);
  const [expandedId, setExpandedId]     = useState(null);

  // Realtime listener
  // Admin (80+) loads all records; company command (45–79) scopes to own company
  // to satisfy Firestore rules (which only allow per-company reads below level 80).
  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    const q = level >= ADMIN_LEVEL
      ? query(collection(db, 'cadetYearlyHistory'), orderBy('cadetName', 'asc'))
      : query(collection(db, 'cadetYearlyHistory'),
          where('company', '==', userData?.company || ''),
          orderBy('cadetName', 'asc'));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRecords(docs);

      // Derive unique years sorted desc
      const uniqueYears = [...new Set(docs.map(d => d.schoolYear).filter(Boolean))].sort().reverse();
      setYears(uniqueYears);
      if (uniqueYears.length > 0 && (!selectedYear || !uniqueYears.includes(selectedYear))) {
        setSelectedYear(uniqueYears[0]);
      }
      setLoading(false);
    }, err => {
      console.error('cadetYearlyHistory error:', err);
      setLoading(false);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  async function deleteRecord(id) {
    const rec = records.find(r => r.id === id);
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'cadetYearlyHistory', id));
      writeLog({
        type: 'history', action: 'delete',
        description: `Deleted history record for ${rec?.cadetName || id} (${rec?.schoolYear || ''})`,
        userId: userData?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id, targetName: rec?.cadetName,
      });
    }
    catch (err) { console.error(err); alert('Delete failed.'); }
    finally { setDeleting(false); setDeleteConf(null); }
  }

  async function deleteYear(year) {
    const toDelete = records.filter(r => r.schoolYear === year);
    setDeleting(true);
    try {
      const chunkSize = 400;
      for (let i = 0; i < toDelete.length; i += chunkSize) {
        const batch = writeBatch(db);
        toDelete.slice(i, i + chunkSize).forEach(r => batch.delete(doc(db, 'cadetYearlyHistory', r.id)));
        await batch.commit();
      }
      writeLog({
        type: 'history', action: 'delete',
        description: `Deleted all history records for school year ${year} (${toDelete.length} records)`,
        userId: userData?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', notes: `year:${year},count:${toDelete.length}`,
      });
    } catch (err) {
      console.error(err);
      alert('Delete failed.');
    } finally {
      setDeleting(false);
      setDeleteConf(null);
    }
  }

  if (!canView) {
    return (
      <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={History} title="Cadet History" meta="Year-End Archives" />}
        <div className="flex flex-col items-center py-24 text-center">
          <History size={40} className="text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Company Leadership access required to view cadet history.</p>
        </div>
      </div>
    );
  }

  const yearRecords = records.filter(r => r.schoolYear === selectedYear);

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && (
        <AdminPageHeader
          icon={History}
          title="Cadet History"
          meta={`Year-End Archives · ${ROLE_LABELS[role] || role}`}
        />
      )}

      {/* Toolbar */}
      {isAdmin && (
        <div className="flex justify-end -mt-4 mb-8">
          <button
            onClick={() => setShowArchive(true)}
            className="flex items-center gap-2 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold text-sm rounded-xl transition-colors"
          >
            <Archive size={14} /> Archive School Year
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-3 py-16 text-slate-400">
          <Loader2 size={18} className="animate-spin" /> Loading archives…
        </div>
      ) : years.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <History size={40} className="text-slate-300 dark:text-slate-600 mb-4" />
          <p className="font-semibold text-slate-600 dark:text-slate-300 mb-1">No archives yet</p>
          <p className="text-sm text-slate-400 mb-5">Year-end snapshots will appear here once you archive a school year.</p>
          {isAdmin && (
            <button
              onClick={() => setShowArchive(true)}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold text-sm rounded-xl"
            >
              <Archive size={14} /> Archive First Year
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Year picker + delete year */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div className="flex flex-wrap gap-2">
              {years.map(y => (
                <button
                  key={y}
                  onClick={() => setSelectedYear(y)}
                  className={`px-4 py-1.5 text-sm font-bold rounded-xl border transition-all ${
                    y === selectedYear
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                      : 'bg-transparent border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
            {isAdmin && selectedYear && (
              <button
                onClick={() => setDeleteConf({ type: 'year', year: selectedYear })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl transition-colors"
              >
                <Trash2 size={12} /> Delete Year
              </button>
            )}
          </div>

          {/* Records table */}
          {yearRecords.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No records for {selectedYear}.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Cadet</th>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Position</th>
                    <th className="px-4 py-3">LET</th>
                    <th className="px-4 py-3">Awards / Camp</th>
                    <th className="px-4 py-3">Scores</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {yearRecords.map(rec => (
                    <React.Fragment key={rec.id}>
                      <tr className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 font-semibold text-sm text-slate-800 dark:text-slate-200">
                          {rec.cadetName || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{rec.rank || '—'}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">
                          {rec.company ? `${rec.company} Co.` : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {ROLE_LABELS[rec.position] || rec.position || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{rec.letLevel || '—'}</td>
                        <td className="px-4 py-3">
                          {(rec.awards || rec.campNotes) ? (
                            <button
                              onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                              className="text-xs text-yellow-600 dark:text-yellow-400 hover:underline flex items-center gap-1"
                            >
                              View <ChevronDown size={10} className={`transition-transform ${expandedId === rec.id ? 'rotate-180' : ''}`} />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {rec.scores ? (
                            rec.scores.medicalExempt
                              ? <span className="text-xs text-slate-400 italic">Med. exempt</span>
                              : (
                                <button
                                  onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                >
                                  <Trophy size={11} /> View <ChevronDown size={10} className={`transition-transform ${expandedId === rec.id ? 'rotate-180' : ''}`} />
                                </button>
                              )
                          ) : (
                            <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 justify-end">
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => setEditRecord(rec)}
                                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                  title="Edit record"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  onClick={() => setDeleteConf({ type: 'record', id: rec.id, name: rec.cadetName })}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                  title="Delete record"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {expandedId === rec.id && (
                        <tr className="border-t border-yellow-100 dark:border-yellow-900/30 bg-yellow-50/50 dark:bg-yellow-900/10">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Scores */}
                              {rec.scores && !rec.scores.medicalExempt && (
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Trophy size={11} /> Challenge Scores</p>
                                  <div className="flex flex-wrap gap-2">
                                    {[
                                      { label: 'Push-Ups',    val: fmtScore(rec.scores.pushUps) },
                                      { label: 'Sit-Ups',     val: fmtScore(rec.scores.sitUps) },
                                      { label: 'Shuttle',     val: fmtScore(rec.scores.shuttleRun, 1) },
                                      { label: '1-Mile',      val: rec.scores.oneMile || '—' },
                                      { label: 'Sit & Reach', val: fmtScore(rec.scores.sitNReach, 1) },
                                    ].map(({ label, val }) => (
                                      <div key={label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-center min-w-[64px]">
                                        <div className="text-base font-black text-slate-900 dark:text-white">{val}</div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">{label}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* Awards + Camp */}
                              <div className="space-y-3">
                                {rec.awards && (
                                  <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><Trophy size={11} /> Awards</p>
                                    <p className="text-sm text-slate-700 dark:text-slate-300">{rec.awards}</p>
                                  </div>
                                )}
                                {rec.campNotes && (
                                  <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1"><Tent size={11} /> Camp</p>
                                    <p className="text-sm text-slate-700 dark:text-slate-300">{rec.campNotes}</p>
                                  </div>
                                )}
                                {!rec.awards && !rec.campNotes && (
                                  <p className="text-xs text-slate-400 italic">No awards or camp notes recorded.</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Archive modal */}
      {showArchive && (
        <ArchiveModal adminUser={user} onClose={() => setShowArchive(false)} />
      )}

      {/* Edit modal */}
      {editRecord && (
        <EditRecordModal record={editRecord} onClose={() => setEditRecord(null)} />
      )}

      {/* Delete confirmation */}
      {deleteConf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center">
                <Trash2 size={16} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h4 className="font-black text-slate-900 dark:text-white">
                  {deleteConf.type === 'year' ? 'Delete Entire Year?' : 'Delete Record?'}
                </h4>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
              {deleteConf.type === 'year'
                ? `All ${yearRecords.length} cadet records for ${deleteConf.year} will be permanently deleted.`
                : `The history record for ${deleteConf.name} will be permanently deleted.`
              }
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConf(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
              <button
                onClick={() => deleteConf.type === 'year' ? deleteYear(deleteConf.year) : deleteRecord(deleteConf.id)}
                disabled={deleting}
                className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 text-white font-bold text-sm rounded-xl disabled:opacity-60"
              >
                {deleting && <Loader2 size={13} className="animate-spin" />} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
