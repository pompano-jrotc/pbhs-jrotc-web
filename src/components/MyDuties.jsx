import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot,
  doc, updateDoc, orderBy,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { CheckCircle2, Circle, Megaphone, ClipboardCheck, AlertTriangle, Clock, FileText, ExternalLink } from 'lucide-react';
import { ROLE_HIERARCHY } from '../constants';
import PollDisplay from './PollDisplay';

const PRIORITY_COLOR = {
  high:   'text-rose-500',
  medium: 'text-amber-500',
  low:    'text-slate-400',
};

const isOverdue = (dueDate) => {
  if (!dueDate) return false;
  return new Date(dueDate + 'T23:59:59') < new Date();
};

const fmtDue = (dueDate) => {
  if (!dueDate) return null;
  const d = new Date(dueDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const MyDuties = () => {
  const { userData, role } = useAuth();
  const [leadershipTasks, setLeadershipTasks] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingTasks, setLoadingTasks]   = useState(true);

  const myCompany  = userData?.company  || '';
  const myPosition = userData?.position || '';
  const userLevel  = ROLE_HIERARCHY[role] || 0;
  const isBattalion = userLevel >= 70;
  const canToggle   = !!myCompany && !isBattalion;

  const isCompletedByMe = (t) => t.completedByCompany?.[myCompany] === true;

  // Filter to tasks assigned to this user's company + position
  const visibleTasks = leadershipTasks.filter(t => {
    if (t.assignedCompanies !== undefined) {
      const cos = t.assignedCompanies || [];
      const pos = t.assignedPositions || [];
      const compOk = cos.length === 0 || cos.includes(myCompany);
      const posOk  = pos.length === 0 || pos.includes(myPosition);
      return compOk && posOk;
    }
    // old schema backward-compat
    if (t.assignedScope === 'all') return true;
    if (t.assignedScope === 'company') return t.assignedCompany === myCompany;
    if (t.assignedScope === 'position') return (t.assignedPositions || []).includes(myPosition);
    return false;
  });

  const pendingTasks = visibleTasks.filter(t => !isCompletedByMe(t));
  const doneTasks    = visibleTasks.filter(t =>  isCompletedByMe(t));

  useEffect(() => {
    if (!role || !userData?.company) return;

    // Leadership tasks — assigned only; Firestore rules scope to what this user can read
    const qTasks = query(
      collection(db, 'leadershipTasks'),
      where('isAssigned', '==', true),
      orderBy('dueDate'),
    );

    // Global broadcasts — active announcements addressed to everyone
    const qAnnouncements = query(
      collection(db, 'announcements'),
      where('active', '==', true),
      where('target', '==', 'All'),
      orderBy('timestamp', 'desc'),
    );

    const unsubTasks = onSnapshot(
      qTasks,
      (snap) => {
        setLeadershipTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoadingTasks(false);
      },
      (err) => { console.error('Task query failed:', err); setLoadingTasks(false); },
    );

    const unsubAnnouncements = onSnapshot(
      qAnnouncements,
      (snap) => {
        const now = Date.now();
        const active = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(a => !a.expiresAt || a.expiresAt > now);
        setAnnouncements(active);
        setLoadingOrders(false);
      },
      (err) => { console.error('Announcements query failed:', err); setLoadingOrders(false); },
    );

    return () => { unsubTasks(); unsubAnnouncements(); };
  }, [role, myCompany, myPosition]);

  const toggleTask = async (task) => {
    if (!canToggle) return;
    const done = task.completedByCompany?.[myCompany] === true;
    try {
      await updateDoc(doc(db, 'leadershipTasks', task.id), {
        [`completedByCompany.${myCompany}`]: !done,
      });
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  const loading = loadingOrders || loadingTasks;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-6 h-6 border-2 border-yellow-500/20 border-t-yellow-500 rounded-full animate-spin" />
        <p className="text-slate-400 dark:text-slate-500 animate-pulse text-[10px] font-black uppercase tracking-[0.2em]">
          Syncing HQ Transmissions...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* ── GLOBAL BROADCASTS ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-yellow-500 rounded-full" />
          <h4 className="text-[10px] font-black text-yellow-500 uppercase tracking-widest flex items-center gap-2">
            <Megaphone size={14} /> Global Broadcasts
          </h4>
        </div>

        <div className="space-y-3">
          {announcements.length === 0 ? (
            <div className="pl-4 py-4 border-l border-slate-200 dark:border-white/5">
              <p className="text-slate-400 text-[10px] uppercase font-bold tracking-tight">No active broadcasts.</p>
            </div>
          ) : (
            announcements.map(a => (
              <div
                key={a.id}
                className="group relative bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-white/5 p-5 rounded-2xl transition-all shadow-sm"
              >
                <div className="absolute left-0 top-4 bottom-4 w-[3px] bg-yellow-500 rounded-r-full shadow-[0_0_8px_rgba(212,175,55,0.3)]" />
                <div className="pl-3 space-y-2">
                  {a.title && (
                    <p className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">{a.title}</p>
                  )}
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {a.content}
                  </p>
                  <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest flex-wrap">
                    <span className="text-slate-400 dark:text-slate-500">By: {a.issuer}</span>
                    {a.expiresAt && (
                      <>
                        <span className="w-1 h-1 bg-slate-300 dark:bg-slate-700 rounded-full" />
                        <span className="text-slate-400">Ends {new Date(a.expiresAt).toLocaleDateString()}</span>
                      </>
                    )}
                    {a.pdfUrl && (
                      <a
                        href={a.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-yellow-500 hover:text-yellow-400 transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <FileText size={10} /> {a.pdfFileName || 'View PDF'} <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                  {a.poll && (
                    <PollDisplay poll={a.poll} announcementId={a.id} collectionName="announcements" />
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── ASSIGNED TASKS ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-violet-500 rounded-full" />
            <h4 className="text-[10px] font-black text-violet-400 uppercase tracking-widest flex items-center gap-2">
              <ClipboardCheck size={14} /> My Action Items
            </h4>
          </div>
          {visibleTasks.length > 0 && (
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
              {pendingTasks.length} pending · {doneTasks.length} done
            </span>
          )}
        </div>

        {isBattalion ? (
          // Battalion: they assign tasks, not complete them — link to calendar
          <div className="text-center py-8 border-2 border-dashed border-white/5 bg-white/[0.02] rounded-3xl">
            <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest">
              Manage assigned tasks in the Leadership Calendar.
            </p>
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] rounded-3xl">
            <p className="text-slate-300 dark:text-slate-800 text-[10px] uppercase font-black tracking-widest">
              No tasks assigned to your company.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Pending tasks */}
            {pendingTasks.map(task => {
              const overdue = isOverdue(task.dueDate);
              return (
                <div
                  key={task.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    overdue
                      ? 'bg-rose-500/5 border-rose-500/15'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/5 shadow-sm'
                  }`}
                >
                  <div className="flex gap-3 items-center">
                    <button
                      onClick={() => toggleTask(task)}
                      disabled={!canToggle}
                      className="shrink-0 transition-transform active:scale-90 disabled:cursor-default"
                    >
                      <Circle
                        className={`transition-colors ${
                          canToggle
                            ? 'text-slate-300 dark:text-slate-700 hover:text-violet-500'
                            : 'text-slate-200 dark:text-slate-800'
                        }`}
                        size={20}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight truncate">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {overdue ? (
                          <span className="flex items-center gap-1 text-[9px] font-black text-rose-500 uppercase tracking-widest">
                            <AlertTriangle size={9} /> Overdue · {fmtDue(task.dueDate)}
                          </span>
                        ) : task.dueDate && (
                          <span className="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                            <Clock size={9} /> Due {fmtDue(task.dueDate)}
                          </span>
                        )}
                        {task.priority && task.priority !== 'medium' && (
                          <span className={`text-[9px] font-black uppercase tracking-widest ${PRIORITY_COLOR[task.priority]}`}>
                            · {task.priority}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Completed tasks (collapsed under a divider) */}
            {doneTasks.length > 0 && (
              <div className="pt-2 space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600 pl-1">
                  Completed
                </p>
                {doneTasks.map(task => (
                  <div
                    key={task.id}
                    className="p-4 rounded-2xl border border-emerald-500/10 bg-emerald-500/5 opacity-60"
                  >
                    <div className="flex gap-3 items-center">
                      <button
                        onClick={() => toggleTask(task)}
                        disabled={!canToggle}
                        className="shrink-0 transition-transform active:scale-90 disabled:cursor-default"
                      >
                        <CheckCircle2 className="text-emerald-500" size={20} />
                      </button>
                      <p className="text-sm font-bold text-slate-400 line-through leading-tight truncate flex-1">
                        {task.title}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyDuties;
