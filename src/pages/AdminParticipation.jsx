import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection, doc, addDoc, deleteDoc, onSnapshot,
  query, orderBy, where, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import { ListChecks, Plus, Trash2, X, Loader2, Users, ChevronRight, CalendarDays } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import AdminPageHeader from '../components/AdminPageHeader';
import CadetSearch from '../components/CadetSearch';
import DatePicker from '../components/DatePicker';

const ic = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white';
const lc = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1';

const EVENT_TYPES = [
  'Swim Meet', 'Community Service', 'Color Guard', 'STEM Event',
  'Academic Competition', 'Physical Fitness', 'Field Trip', 'Other',
];

const COMPANY_COLORS = {
  Alpha: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-300',
  Bravo: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40 text-blue-700 dark:text-blue-300',
  Charlie: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/40 text-green-700 dark:text-green-300',
  Delta: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800/40 text-purple-700 dark:text-purple-300',
  Echo: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/40 text-orange-700 dark:text-orange-300',
};
const companyColor = (co) => COMPANY_COLORS[co] || 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

// School-year quarter inference (Aug–Oct = Q1, Nov–Jan = Q2, Feb–Mar = Q3, Apr–Jul = Q4)
function quarterFromDate(dateStr) {
  if (!dateStr) return 'Q1';
  const month = new Date(dateStr + 'T12:00:00').getMonth() + 1;
  if (month >= 8 && month <= 10) return 'Q1';
  if (month === 11 || month === 12 || month === 1) return 'Q2';
  if (month >= 2 && month <= 3) return 'Q3';
  return 'Q4';
}

function currentQuarter() {
  return quarterFromDate(new Date().toISOString().slice(0, 10));
}

const emptyEventForm = { name: '', eventType: EVENT_TYPES[0], date: '', notes: '', quarter: currentQuarter() };

const AdminParticipation = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const myLevel = ROLE_HIERARCHY[role] || 0;
  const canLog  = myLevel >= STAFF_LEVEL;

  const [events,   setEvents]   = useState([]);
  const [entries,  setEntries]  = useState([]);
  const [cadets,   setCadets]   = useState([]);
  const [loading,  setLoading]  = useState(true);

  const [activeQuarter, setActiveQuarter] = useState(() => currentQuarter());

  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [savingEvent, setSavingEvent] = useState(false);

  const [addCadetId, setAddCadetId] = useState('');
  const [addingCadet, setAddingCadet] = useState(false);
  const [addError, setAddError] = useState('');

  const [deletingEntry, setDeletingEntry] = useState(null);
  const [deletingEvent, setDeletingEvent] = useState(null);

  const [status, setStatus] = useState(null);

  const showStatus = (msg) => { setStatus(msg); setTimeout(() => setStatus(null), 3000); };

  // Load events
  useEffect(() => {
    if (!canLog && myLevel < 45) return;
    const unsub = onSnapshot(
      query(collection(db, 'participationEvents'), orderBy('date', 'desc')),
      snap => {
        const evts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setEvents(evts);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [canLog, myLevel]);

  // Load all entries
  useEffect(() => {
    if (!canLog && myLevel < 45) return;
    return onSnapshot(
      query(collection(db, 'participationEntries'), orderBy('loggedAt', 'asc')),
      snap => setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [canLog, myLevel]);

  // Load roster cadets (all active) for the add-cadet search
  useEffect(() => {
    if (!canLog) return;
    getDocs(query(collection(db, 'roster'), orderBy('fullName', 'asc')))
      .then(snap => setCadets(
        snap.docs
          .map(d => ({ uid: d.id, ...d.data() }))
          .filter(c => c.fullName && !c.graduated)
      ));
  }, [canLog]);

  // Entries for the currently selected event
  const eventEntries = useMemo(
    () => entries.filter(e => e.eventId === selectedEvent?.id),
    [entries, selectedEvent]
  );

  // Company breakdown for selected event
  const companyBreakdown = useMemo(() => {
    const counts = {};
    eventEntries.forEach(e => {
      const co = e.company || 'Unknown';
      counts[co] = (counts[co] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [eventEntries]);

  // Events filtered to the active quarter tab
  const filteredEvents = useMemo(
    () => events.filter(e => (e.quarter || quarterFromDate(e.date)) === activeQuarter),
    [events, activeQuarter]
  );

  // Quarter participation leaderboard: top 5 overall + top 3 per company
  const quarterLeaderboard = useMemo(() => {
    const quarterEventIds = new Set(filteredEvents.map(e => e.id));
    const quarterEntries  = entries.filter(e => quarterEventIds.has(e.eventId));
    const byId = {};
    quarterEntries.forEach(e => {
      const key = e.cadetId || e.cadetName;
      if (!byId[key]) byId[key] = { cadetName: e.cadetName, company: e.company, count: 0 };
      byId[key].count++;
    });
    const all = Object.values(byId).sort((a, b) => b.count - a.count);
    const byCompany = {};
    all.forEach(d => {
      const co = d.company || 'Unknown';
      if (!byCompany[co]) byCompany[co] = [];
      if (byCompany[co].length < 3) byCompany[co].push(d);
    });
    return { top5: all.slice(0, 5), byCompany };
  }, [filteredEvents, entries]);

  // Company breakdown per event for the event list sidebar
  const eventCounts = useMemo(() => {
    const map = {};
    entries.forEach(e => {
      if (!map[e.eventId]) map[e.eventId] = 0;
      map[e.eventId]++;
    });
    return map;
  }, [entries]);

  // ── Create event ────────────────────────────────────────────────────────────
  const handleSaveEvent = async (ev) => {
    ev.preventDefault();
    if (!eventForm.name.trim() || !eventForm.date) return;
    setSavingEvent(true);
    try {
      const quarter = eventForm.quarter || quarterFromDate(eventForm.date);
      const payload = {
        name:          eventForm.name.trim(),
        eventType:     eventForm.eventType,
        date:          eventForm.date,
        notes:         eventForm.notes.trim(),
        quarter,
        createdBy:     user.uid,
        createdByName: userData?.fullName || '',
        createdAt:     serverTimestamp(),
      };
      const ref = await addDoc(collection(db, 'participationEvents'), payload);
      writeLog({
        type: 'participation', action: 'create_event',
        description: `Created participation event: ${payload.name} (${payload.eventType}, ${payload.date})`,
        userId: user.uid, userFullName: userData?.fullName || '',
        userRole: role || '', targetId: ref.id, targetName: payload.name,
      });
      setActiveQuarter(quarter);
      setShowEventModal(false);
      setEventForm(emptyEventForm);
      showStatus('Event created');
    } catch (err) {
      console.error('Create event error:', err);
      showStatus('Failed to create event');
    } finally {
      setSavingEvent(false);
    }
  };

  // ── Delete event (and its entries) ──────────────────────────────────────────
  const handleDeleteEvent = async (evt) => {
    if (!canLog) return;
    setDeletingEvent(evt.id);
    try {
      // Delete all entries for this event first
      const entriesSnap = await getDocs(
        query(collection(db, 'participationEntries'), where('eventId', '==', evt.id))
      );
      await Promise.all(entriesSnap.docs.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'participationEvents', evt.id));
      if (selectedEvent?.id === evt.id) setSelectedEvent(null);
      writeLog({
        type: 'participation', action: 'delete_event',
        description: `Deleted participation event: ${evt.name} (${entriesSnap.size} entries removed)`,
        userId: user.uid, userFullName: userData?.fullName || '',
        userRole: role || '', targetId: evt.id, targetName: evt.name,
      });
      showStatus('Event deleted');
    } catch (err) {
      console.error('Delete event error:', err);
      showStatus('Failed to delete event');
    } finally {
      setDeletingEvent(null);
    }
  };

  // ── Add cadet to event ──────────────────────────────────────────────────────
  const handleAddCadet = async () => {
    if (!addCadetId || !selectedEvent) return;
    setAddError('');
    setAddingCadet(true);
    try {
      // Duplicate check
      const existing = entries.find(
        e => e.eventId === selectedEvent.id && e.cadetId === addCadetId
      );
      if (existing) {
        const name = cadets.find(c => c.uid === addCadetId)?.fullName || 'This cadet';
        setAddError(`${name} is already logged for this event.`);
        setAddingCadet(false);
        return;
      }
      const cadet = cadets.find(c => c.uid === addCadetId);
      const payload = {
        eventId:      selectedEvent.id,
        cadetId:      addCadetId,
        cadetName:    cadet?.fullName || '',
        company:      cadet?.company || '',
        loggedBy:     user.uid,
        loggedByName: userData?.fullName || '',
        loggedAt:     serverTimestamp(),
      };
      await addDoc(collection(db, 'participationEntries'), payload);
      writeLog({
        type: 'participation', action: 'add_entry',
        description: `Logged ${payload.cadetName} (${payload.company}) for event: ${selectedEvent.name}`,
        userId: user.uid, userFullName: userData?.fullName || '',
        userRole: role || '', targetId: addCadetId, targetName: payload.cadetName,
      });
      setAddCadetId('');
    } catch (err) {
      console.error('Add cadet error:', err);
      setAddError('Failed to add cadet. Try again.');
    } finally {
      setAddingCadet(false);
    }
  };

  // ── Remove cadet entry ───────────────────────────────────────────────────────
  const handleRemoveEntry = async (entry) => {
    if (!canLog) return;
    setDeletingEntry(entry.id);
    try {
      await deleteDoc(doc(db, 'participationEntries', entry.id));
      writeLog({
        type: 'participation', action: 'remove_entry',
        description: `Removed ${entry.cadetName} (${entry.company}) from event: ${selectedEvent?.name}`,
        userId: user.uid, userFullName: userData?.fullName || '',
        userRole: role || '', targetId: entry.id, targetName: entry.cadetName,
      });
    } catch (err) {
      console.error('Remove entry error:', err);
    } finally {
      setDeletingEntry(null);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950">
        <Loader2 className="animate-spin text-yellow-500" size={32} />
      </div>
    );
  }

  return (
    <div className={hideHeader ? 'w-full' : 'min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white'}>
      {!hideHeader && (
        <AdminPageHeader
          title="Participation Tracker"
          icon={ListChecks}
          meta="Log cadets for events and track company totals"
        />
      )}

      {/* Actions bar */}
      {canLog && (
        <div className="max-w-7xl mx-auto px-4 -mt-4 mb-2 flex justify-end">
          <button
            onClick={() => { setEventForm(emptyEventForm); setShowEventModal(true); }}
            className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-sm px-4 py-2 rounded-xl transition-colors"
          >
            <Plus size={16} /> New Event
          </button>
        </div>
      )}

      {/* Status toast */}
      <AnimatePresence>
        {status && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="fixed top-20 right-4 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold px-4 py-3 rounded-xl shadow-xl"
          >
            {status}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">

        {/* ── Event list ────────────────────────────────────────────── */}
        <div className="w-full lg:w-80 shrink-0">
          {/* Quarter tabs */}
          <div className="flex gap-1 mb-4 bg-slate-100 dark:bg-white/5 p-1 rounded-xl">
            {QUARTERS.map(q => (
              <button
                key={q}
                onClick={() => { setActiveQuarter(q); setSelectedEvent(null); }}
                className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${
                  activeQuarter === q
                    ? 'bg-yellow-500 text-slate-950 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white'
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3 ml-1">
            {activeQuarter} Events ({filteredEvents.length})
          </p>

          {filteredEvents.length === 0 ? (
            <div className="bg-slate-50 dark:bg-white/5 rounded-2xl p-6 text-center text-slate-400 dark:text-slate-500 text-sm">
              No {activeQuarter} events yet.{canLog && ' Click "New Event" to get started.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEvents.map(evt => {
                const total = eventCounts[evt.id] || 0;
                const isSelected = selectedEvent?.id === evt.id;
                return (
                  <button
                    key={evt.id}
                    onClick={() => setSelectedEvent(isSelected ? null : evt)}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
                      isSelected
                        ? 'bg-yellow-500 border-yellow-500 text-slate-950'
                        : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-yellow-500/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-black text-sm truncate">{evt.name}</p>
                        <p className={`text-[11px] mt-0.5 ${isSelected ? 'text-slate-800' : 'text-slate-400 dark:text-slate-500'}`}>
                          {evt.eventType} · {evt.date}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full ${
                          isSelected ? 'bg-slate-950/10 text-slate-950' : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400'
                        }`}>
                          <Users size={10} /> {total}
                        </span>
                        {!isSelected && <ChevronRight size={14} className="text-slate-400" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Event detail ────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {!selectedEvent ? (
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3 ml-1">
                  {activeQuarter} Leaderboard
                </p>
                {quarterLeaderboard.top5.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-400 dark:text-slate-600 gap-3">
                    <ListChecks size={36} strokeWidth={1.2} />
                    <p className="text-sm font-bold">No entries yet for {activeQuarter}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Top 5 overall */}
                    <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden max-w-lg">
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-white/5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Top 5 Overall</p>
                      </div>
                      {quarterLeaderboard.top5.map((d, i) => (
                        <div key={d.cadetName} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 dark:border-white/5 last:border-0">
                          <span className={`w-6 text-center text-xs font-black ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-600' : 'text-slate-400 dark:text-slate-500'}`}>
                            {i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`}
                          </span>
                          <span className="flex-1 text-xs font-black text-slate-900 dark:text-white truncate">{d.cadetName}</span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${companyColor(d.company)}`}>{d.company || '—'}</span>
                          <span className="text-xs font-black text-slate-600 dark:text-slate-300 tabular-nums">{d.count} event{d.count !== 1 ? 's' : ''}</span>
                        </div>
                      ))}
                    </div>

                    {/* Top 3 per company */}
                    {Object.keys(quarterLeaderboard.byCompany).length > 0 && (
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 ml-1">Top 3 Per Company</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {Object.entries(quarterLeaderboard.byCompany).sort(([a], [b]) => a.localeCompare(b)).map(([co, donors]) => (
                            <div key={co} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden">
                              <div className={`px-3 py-2 border-b border-slate-100 dark:border-white/5 ${companyColor(co)}`}>
                                <p className="text-[10px] font-black uppercase tracking-wider">{co}</p>
                              </div>
                              {donors.map((d, i) => (
                                <div key={d.cadetName} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-white/5 last:border-0">
                                  <span className="text-[10px] font-black text-slate-400 w-4">{i + 1}.</span>
                                  <span className="flex-1 text-[11px] font-black text-slate-900 dark:text-white truncate">{d.cadetName}</span>
                                  <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 tabular-nums">{d.count}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              {/* Event header */}
              <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
                <div>
                  <h2 className="text-xl font-black">{selectedEvent.name}</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={13} /> {selectedEvent.date}
                    </span>
                    <span className="mx-2 opacity-40">·</span>
                    {selectedEvent.eventType}
                    {selectedEvent.notes && (
                      <span className="mx-2 opacity-40">·</span>
                    )}
                    {selectedEvent.notes && (
                      <span className="italic">{selectedEvent.notes}</span>
                    )}
                  </p>
                </div>
                {canLog && (
                  <button
                    onClick={() => handleDeleteEvent(selectedEvent)}
                    disabled={deletingEvent === selectedEvent.id}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors px-3 py-2 rounded-xl border border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
                  >
                    {deletingEvent === selectedEvent.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Trash2 size={13} />
                    }
                    Delete Event
                  </button>
                )}
              </div>

              {/* Company breakdown */}
              {companyBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-5">
                  {companyBreakdown.map(([co, count]) => (
                    <div key={co} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-black ${companyColor(co)}`}>
                      <span>{co}</span>
                      <span className="opacity-60">·</span>
                      <span>{count}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 text-sm font-black">
                    Total · {eventEntries.length}
                  </div>
                </div>
              )}

              {/* Add cadet */}
              {canLog && (
                <div className="bg-slate-50 dark:bg-white/5 rounded-2xl p-4 mb-5 border border-slate-200 dark:border-white/10">
                  <p className={lc}>Add Cadet</p>
                  <div className="flex gap-2 items-start">
                    <div className="flex-1">
                      <CadetSearch
                        cadets={cadets.map(c => ({ uid: c.uid, fullName: c.fullName }))}
                        value={addCadetId}
                        onChange={(uid) => { setAddCadetId(uid); setAddError(''); }}
                        placeholder="Type 2+ letters to search…"
                        inputClass={ic}
                      />
                    </div>
                    <button
                      onClick={handleAddCadet}
                      disabled={!addCadetId || addingCadet}
                      className="flex items-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black text-sm px-4 py-3 rounded-xl transition-colors shrink-0"
                    >
                      {addingCadet ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      Add
                    </button>
                  </div>
                  {addError && (
                    <p className="mt-2 text-xs font-bold text-red-500 dark:text-red-400">{addError}</p>
                  )}
                </div>
              )}

              {/* Cadet list */}
              {eventEntries.length === 0 ? (
                <div className="text-center py-10 text-slate-400 dark:text-slate-600 text-sm">
                  No cadets logged yet.
                </div>
              ) : (
                <div className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        <th className="text-left p-3 pl-4 text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                        <th className="text-left p-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Cadet</th>
                        <th className="text-left p-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden sm:table-cell">Company</th>
                        <th className="text-left p-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Logged By</th>
                        {canLog && <th className="p-3 w-10" />}
                      </tr>
                    </thead>
                    <tbody>
                      {eventEntries.map((entry, i) => (
                        <tr key={entry.id} className="border-b border-slate-100 dark:border-white/5 last:border-0 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                          <td className="p-3 pl-4 text-slate-400 font-bold tabular-nums">{i + 1}</td>
                          <td className="p-3 font-bold text-slate-900 dark:text-white">{entry.cadetName}</td>
                          <td className="p-3 hidden sm:table-cell">
                            <span className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${companyColor(entry.company)}`}>
                              {entry.company || '—'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500 dark:text-slate-400 text-xs hidden md:table-cell">
                            {entry.loggedByName || '—'}
                          </td>
                          {canLog && (
                            <td className="p-3 text-right">
                              <button
                                onClick={() => handleRemoveEntry(entry)}
                                disabled={deletingEntry === entry.id}
                                className="text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-40"
                                title="Remove"
                              >
                                {deletingEntry === entry.id
                                  ? <Loader2 size={14} className="animate-spin" />
                                  : <X size={14} />
                                }
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── New Event Modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showEventModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowEventModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-200 dark:border-white/10"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-black text-lg">New Event</h3>
                <button onClick={() => setShowEventModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveEvent} className="space-y-4">
                <div>
                  <label className={lc}>Event Name *</label>
                  <input
                    className={ic} required
                    placeholder="e.g. Swim Meet Oct 4"
                    value={eventForm.name}
                    onChange={e => setEventForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className={lc}>Event Type *</label>
                    <select
                      className={ic}
                      value={eventForm.eventType}
                      onChange={e => setEventForm(f => ({ ...f, eventType: e.target.value }))}
                    >
                      {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="w-24">
                    <label className={lc}>Quarter *</label>
                    <select
                      className={ic}
                      value={eventForm.quarter}
                      onChange={e => setEventForm(f => ({ ...f, quarter: e.target.value }))}
                    >
                      {QUARTERS.map(q => <option key={q}>{q}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={lc}>Date *</label>
                  <DatePicker
                    value={eventForm.date}
                    onChange={v => setEventForm(f => ({ ...f, date: v }))}
                  />
                </div>

                <div>
                  <label className={lc}>Notes (optional)</label>
                  <input
                    className={ic}
                    placeholder="Location, notes, etc."
                    value={eventForm.notes}
                    onChange={e => setEventForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowEventModal(false)}
                    className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 font-bold text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={savingEvent}
                    className="flex-1 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 font-black text-sm text-slate-950 flex items-center justify-center gap-2 transition-colors">
                    {savingEvent ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    Create Event
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminParticipation;
