// src/pages/AdminTeamsPrivate.jsx
// Teams private side — roster management, competition results, internal notes per team.

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY } from '../constants';
import AdminPageHeader from '../components/AdminPageHeader';
import { writeLog } from '../lib/writeLog';
import {
  Shield, Plus, Trash2, Users, Trophy, ChevronDown, ChevronUp,
  Medal, Loader2, Edit3, CheckCircle, X,
} from 'lucide-react';

const STAFF_LEVEL_L = 70;
const COMMAND_L = 45;

// ── Competition Result form ────────────────────────────────────────────────────
const AddResultForm = ({ teamId, teamName, user, onDone }) => {
  const [form, setForm] = useState({ event: '', date: '', placement: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.event) { setErr('Event name is required.'); return; }
    setSaving(true); setErr('');
    try {
      await addDoc(collection(db, `specialTeams/${teamId}/results`), {
        ...form,
        event: form.event.trim(),
        notes: form.notes.trim(),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      writeLog(`Added competition result for ${teamName}: ${form.event}`);
      onDone();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-slate-50 dark:bg-white/2.5 rounded-xl p-4 space-y-3">
      <h4 className="text-xs font-black uppercase text-slate-600 dark:text-slate-400">Add Competition Result</h4>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Event <span className="text-red-500">*</span></label>
          <input value={form.event} onChange={e=>set('event',e.target.value)} placeholder="Competition name" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Date</label>
          <input type="date" value={form.date} onChange={e=>set('date',e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Placement</label>
          <input value={form.placement} onChange={e=>set('placement',e.target.value)} placeholder="e.g. 1st Place" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Notes</label>
          <input value={form.notes} onChange={e=>set('notes',e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500" />
        </div>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
          Add Result
        </button>
        <button onClick={onDone} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10">
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── Team card ──────────────────────────────────────────────────────────────────
const TeamCard = ({ team, canEdit }) => {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState([]);
  const [roster, setRoster] = useState([]);
  const [showResultForm, setShowResultForm] = useState(false);
  const [notes, setNotes] = useState(team.internalNotes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!expanded) return;
    const q1 = query(collection(db, `specialTeams/${team.id}/results`), orderBy('createdAt', 'desc'));
    const q2 = getDocs(query(collection(db, 'roster')));
    const unsub = onSnapshot(q1, snap => setResults(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    q2.then(snap => {
      const emails = new Set([...(team.commanderEmails || []), ...(team.memberEmails || [])]);
      setRoster(snap.docs.filter(d => emails.has(d.data().email)).map(d => ({ id: d.id, ...d.data() })));
    }).catch(() => {});
    return () => unsub();
  }, [expanded, team.id]);

  const saveNotes = async () => {
    setSavingNotes(true);
    await updateDoc(doc(db, 'specialTeams', team.id), { internalNotes: notes });
    setSavingNotes(false);
  };

  const removeResult = async (id) => {
    if (!confirm('Delete this result?')) return;
    await deleteDoc(doc(db, `specialTeams/${team.id}/results`, id));
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
          <Shield size={16} className="text-yellow-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{team.name}</p>
          <p className="text-xs text-slate-500">{team.commanderEmails?.length || 0} commanders · {team.memberEmails?.length || 0} members</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${team.status === 'Open Practice' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{team.status}</span>
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-white/5 p-4 space-y-5">
          {/* Roster */}
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 mb-2 flex items-center gap-1.5"><Users size={11} />Roster ({roster.length})</p>
            {roster.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No roster linked. Assign commander/member emails in team settings.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {roster.map(c => (
                  <div key={c.id} className="flex items-center gap-2 bg-slate-50 dark:bg-white/2.5 rounded-lg px-3 py-1.5">
                    <div className="w-5 h-5 rounded-full bg-yellow-500/20 flex items-center justify-center text-[8px] font-black text-yellow-700 dark:text-yellow-400">
                      {(c.fullName||'?').charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{c.fullName}</p>
                      <p className="text-[9px] text-slate-400">{c.rank || ''}</p>
                    </div>
                    {team.commanderEmails?.includes(c.email) && (
                      <span className="ml-auto text-[8px] font-black bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded">CMD</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Competition Results */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1.5"><Trophy size={11} />Competition Results</p>
              {canEdit && (
                <button onClick={() => setShowResultForm(f => !f)} className="text-[10px] font-black text-yellow-600 dark:text-yellow-400 hover:underline flex items-center gap-1">
                  <Plus size={10} />{showResultForm ? 'Cancel' : 'Add Result'}
                </button>
              )}
            </div>
            {showResultForm && (
              <AddResultForm teamId={team.id} teamName={team.name} user={user} onDone={() => setShowResultForm(false)} />
            )}
            {results.length === 0 && !showResultForm ? (
              <p className="text-xs text-slate-400 italic">No competition results yet.</p>
            ) : (
              <div className="space-y-2">
                {results.map(r => (
                  <div key={r.id} className="flex items-center gap-3 bg-slate-50 dark:bg-white/2.5 rounded-lg px-3 py-2">
                    <Medal size={13} className="text-yellow-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{r.event}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        {r.date && <span>{r.date}</span>}
                        {r.placement && <span className="font-bold text-yellow-600 dark:text-yellow-400">{r.placement}</span>}
                      </div>
                    </div>
                    {canEdit && (
                      <button onClick={() => removeResult(r.id)} aria-label="Delete result" className="text-slate-400 hover:text-red-500 transition-colors p-1">
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Internal Notes */}
          {canEdit && (
            <div>
              <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Internal Notes (staff only)</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Practices, goals, issues..."
                className="w-full bg-slate-50 dark:bg-white/2.5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
              />
              <button onClick={saveNotes} disabled={savingNotes} className="mt-2 flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {savingNotes ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                Save Notes
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AdminTeamsPrivate() {
  const { role } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canEdit = userLevel >= COMMAND_L;

  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'specialTeams'), orderBy('name'));
    const unsub = onSnapshot(q, snap => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Teams — Internal"
        subtitle="Roster management, competition results, and staff notes per team"
        icon={Shield}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Teams" value={teams.length} />
        <Stat label="Active" value={teams.filter(t=>t.status==='Open Practice').length} accent />
        <Stat label="Closed" value={teams.filter(t=>t.status!=='Open Practice').length} />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-yellow-500" /></div>
      ) : teams.length === 0 ? (
        <div className="text-center py-12 text-slate-400 dark:text-slate-600">
          <Shield size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold">No teams found</p>
          <p className="text-xs mt-1">Create teams in the Publishing Hub → Teams tab</p>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map(t => <TeamCard key={t.id} team={t} canEdit={canEdit} />)}
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, value, accent }) => (
  <div className={`rounded-xl p-3 border ${accent ? 'bg-yellow-50 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10'}`}>
    <p className={`text-lg font-black ${accent ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-800 dark:text-slate-200'}`}>{value}</p>
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">{label}</p>
  </div>
);
