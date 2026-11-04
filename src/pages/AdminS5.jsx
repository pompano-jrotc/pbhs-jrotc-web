// src/pages/AdminS5.jsx
//
// S5 Public Affairs — Shop (Task Tracker)
//
// ── Access model ─────────────────────────────────────────────────────────────
// s5_public_affairs (70) — full management: create/edit/delete, publish, toggle anyone
// company_s5_assistant — self-service: published items only, mark own completions
// Staff 70+ / admin — management view, cannot create/delete
//
// ── Firestore schema ─────────────────────────────────────────────────────────
// Collection: s5Shop
//   Common: type, title, description, startDate, dueDate, published,
//           pdfUrl, pdfName, createdAt, createdBy, createdByName
//   Assignments / Posts:
//     completions: { [rosterDocId]: { completed, completedAt, name, company } }
//   Special Projects:
//     tasks: [{ id, title, subtasks: [{ id, title }] }]
//     taskCompletions:    { [taskId]: { [rosterDocId]: { completed, completedAt } } }
//     subtaskCompletions: { [subtaskId]: { [rosterDocId]: { completed, completedAt } } }

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, where, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { uploadPdfToStorage } from '../utils/storageUpload';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY } from '../constants';
import {
  ClipboardList, Image, Sparkles, Plus, Trash2, X,
  Loader2, CheckCircle2, Circle, ChevronDown, ChevronRight,
  CalendarDays, FileText, Upload, Eye, EyeOff, Pencil,
  ListTodo, GripVertical,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { normalizeCompany } from '../utils/normalizeCompany';
import DatePicker from '../components/DatePicker';

// ── Constants ─────────────────────────────────────────────────────────────────

const S5_ROLE       = 's5_public_affairs';
const ASST_ROLE     = 'company_s5_assistant';
const ASST_POSITION = 'Company S5 Assistant';
const ADMIN_LEVEL   = 80;
const STAFF_LEVEL   = 70;

const TABS = [
  { key: 'assignment',     label: 'Assignments',     icon: ClipboardList, color: 'blue'   },
  { key: 'post',           label: 'Posts',           icon: Image,         color: 'purple' },
  { key: 'specialProject', label: 'Special Projects', icon: Sparkles,     color: 'yellow' },
];

const COLOR = {
  blue:   { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/20' },
  yellow: { bg: 'bg-yellow-500/10', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-500/20' },
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate  = d => d ? new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const nanoid   = () => Math.random().toString(36).slice(2, 10);

const ic = 'w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white transition-all';
const lc = 'text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1 tracking-widest';

// ── Main component ────────────────────────────────────────────────────────────

const AdminS5 = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;

  const isS5      = role === S5_ROLE;
  const isAsst    = role === ASST_ROLE;
  const isStaff   = userLevel >= STAFF_LEVEL;
  const canManage = isS5 || userLevel >= ADMIN_LEVEL;
  const canView   = canManage || isStaff || isAsst;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('assignment');

  // ── Assistants ────────────────────────────────────────────────────────────
  const [assistants, setAssistants] = useState([]);
  const [myRosterId, setMyRosterId] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'roster'), where('position', '==', ASST_POSITION)),
      snap => setAssistants(
        snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(c => !c.graduated)
          .sort((a, b) => (a.company || '').localeCompare(b.company || ''))
      ),
      () => setAssistants([]),
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAsst || !user) return;
    getDocs(query(collection(db, 'roster'), where('linkedUid', '==', user.uid)))
      .then(snap => { if (!snap.empty) setMyRosterId(snap.docs[0].id); })
      .catch(() => {});
  }, [isAsst, user]);

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 's5Shop'), orderBy('createdAt', 'desc')),
      snap => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      () => setTasks([]),
    );
    return () => unsub();
  }, []);

  const tasksByType = useMemo(() => {
    const map = { assignment: [], post: [], specialProject: [] };
    tasks.forEach(t => { if (map[t.type]) map[t.type].push(t); });
    return map;
  }, [tasks]);

  // ── Create form ───────────────────────────────────────────────────────────
  const [showCreate, setShowCreate]   = useState(false);
  const [form, setForm]               = useState({ title: '', description: '', startDate: '', dueDate: '' });
  const [pdfFile, setPdfFile]         = useState(null);
  const [uploadPct, setUploadPct]     = useState(0);
  const [saving, setSaving]           = useState(false);
  const fileInputRef                  = useRef(null);

  const [toast, setToast] = useState(null);
  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  };

  const resetCreate = () => {
    setForm({ title: '', description: '', startDate: '', dueDate: '' });
    setPdfFile(null);
    setUploadPct(0);
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      let pdfUrl = '', pdfName = '';
      if (pdfFile) {
        const result = await uploadPdfToStorage(pdfFile, 's5-shop', pct => setUploadPct(pct));
        pdfUrl  = result.url;
        pdfName = result.fileName;
      }

      const isProject = activeTab === 'specialProject';
      await addDoc(collection(db, 's5Shop'), {
        type:          activeTab,
        title:         form.title.trim(),
        description:   form.description.trim(),
        startDate:     form.startDate,
        dueDate:       form.dueDate,
        published:     false,
        pdfUrl,
        pdfName,
        createdAt:     serverTimestamp(),
        createdBy:     user?.uid || '',
        createdByName: userData?.fullName || '',
        ...(isProject
          ? { tasks: [], taskCompletions: {}, subtaskCompletions: {} }
          : { completions: {} }
        ),
      });

      writeLog({
        type: 's5_shop', action: 'create',
        description: `Created ${activeTab} "${form.title.trim()}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '', userRole: role || '',
      });
      resetCreate();
      showToast('Item saved as draft');
    } catch (err) {
      console.error('S5 create error:', err);
      const reason = err?.code === 'permission-denied'
        ? 'Permission denied — check your role'
        : err?.message || 'Unknown error';
      showToast(`Save failed: ${reason}`, true);
    } finally {
      setSaving(false);
    }
  };

  // ── Publish toggle ────────────────────────────────────────────────────────
  const [publishing, setPublishing] = useState(null);

  const handlePublish = async (task) => {
    if (!canManage || publishing) return;
    setPublishing(task.id);
    try {
      await updateDoc(doc(db, 's5Shop', task.id), { published: !task.published });
      showToast(task.published ? 'Set to Draft' : 'Published');
    } catch (err) {
      console.error('S5 publish error:', err);
      showToast('Failed to update — try again', true);
    } finally {
      setPublishing(null);
    }
  };

  // ── Completion toggles ────────────────────────────────────────────────────
  const [toggling, setToggling] = useState({});

  const withToggle = async (key, fn) => {
    if (toggling[key]) return;
    setToggling(p => ({ ...p, [key]: true }));
    try { await fn(); } catch (err) { console.error('Toggle error:', err); }
    finally { setToggling(p => { const n = { ...p }; delete n[key]; return n; }); }
  };

  // Assignment / Post completion
  const handleToggle = (task, rosterId, name, company) => {
    if (isAsst && !canManage && rosterId !== myRosterId) return;
    const current = task.completions?.[rosterId]?.completed || false;
    withToggle(`${task.id}_${rosterId}`, () =>
      updateDoc(doc(db, 's5Shop', task.id), {
        [`completions.${rosterId}`]: {
          completed: !current,
          completedAt: !current ? new Date().toISOString() : null,
          name, company,
        },
      })
    );
  };

  // Project task completion
  const handleToggleTask = (task, taskId, rosterId) => {
    if (isAsst && !canManage && rosterId !== myRosterId) return;
    const current = task.taskCompletions?.[taskId]?.[rosterId]?.completed || false;
    withToggle(`${task.id}_t_${taskId}_${rosterId}`, () =>
      updateDoc(doc(db, 's5Shop', task.id), {
        [`taskCompletions.${taskId}.${rosterId}`]: {
          completed: !current,
          completedAt: !current ? new Date().toISOString() : null,
        },
      })
    );
  };

  // Project subtask completion
  const handleToggleSubtask = (task, subtaskId, rosterId) => {
    if (isAsst && !canManage && rosterId !== myRosterId) return;
    const current = task.subtaskCompletions?.[subtaskId]?.[rosterId]?.completed || false;
    withToggle(`${task.id}_s_${subtaskId}_${rosterId}`, () =>
      updateDoc(doc(db, 's5Shop', task.id), {
        [`subtaskCompletions.${subtaskId}.${rosterId}`]: {
          completed: !current,
          completedAt: !current ? new Date().toISOString() : null,
        },
      })
    );
  };

  // ── Project task editing ──────────────────────────────────────────────────
  const [editingProject, setEditingProject] = useState(null); // task id
  const [newTaskInput,   setNewTaskInput]   = useState('');
  const [newSubInputs,   setNewSubInputs]   = useState({}); // { taskId: '' }

  const handleAddTask = async (project) => {
    if (!newTaskInput.trim()) return;
    const newTask = { id: nanoid(), title: newTaskInput.trim(), subtasks: [] };
    await updateDoc(doc(db, 's5Shop', project.id), {
      tasks: [...(project.tasks || []), newTask],
    });
    setNewTaskInput('');
  };

  const handleDeleteTask = async (project, taskId) => {
    const updated = (project.tasks || []).filter(t => t.id !== taskId);
    // Also clean up completions for this task's subtasks
    const taskObj = (project.tasks || []).find(t => t.id === taskId);
    const taskCompletions     = { ...(project.taskCompletions     || {}) };
    const subtaskCompletions  = { ...(project.subtaskCompletions  || {}) };
    delete taskCompletions[taskId];
    (taskObj?.subtasks || []).forEach(s => delete subtaskCompletions[s.id]);
    await updateDoc(doc(db, 's5Shop', project.id), {
      tasks: updated, taskCompletions, subtaskCompletions,
    });
  };

  const handleAddSubtask = async (project, taskId) => {
    const title = (newSubInputs[taskId] || '').trim();
    if (!title) return;
    const updated = (project.tasks || []).map(t =>
      t.id === taskId
        ? { ...t, subtasks: [...(t.subtasks || []), { id: nanoid(), title }] }
        : t
    );
    await updateDoc(doc(db, 's5Shop', project.id), { tasks: updated });
    setNewSubInputs(p => ({ ...p, [taskId]: '' }));
  };

  const handleDeleteSubtask = async (project, taskId, subtaskId) => {
    const updated = (project.tasks || []).map(t =>
      t.id === taskId
        ? { ...t, subtasks: (t.subtasks || []).filter(s => s.id !== subtaskId) }
        : t
    );
    const subtaskCompletions = { ...(project.subtaskCompletions || {}) };
    delete subtaskCompletions[subtaskId];
    await updateDoc(doc(db, 's5Shop', project.id), { tasks: updated, subtaskCompletions });
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const [deleteConf, setDeleteConf] = useState(null);
  const [deleting,   setDeleting]   = useState(null);

  const handleDelete = async (taskId) => {
    setDeleting(taskId);
    try {
      await deleteDoc(doc(db, 's5Shop', taskId));
      writeLog({
        type: 's5_shop', action: 'delete',
        description: `Deleted S5 Shop item ${taskId}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '', userRole: role || '',
      });
    } catch (err) {
      console.error('S5 delete error:', err);
    } finally {
      setDeleting(null);
      setDeleteConf(null);
    }
  };

  // ── Expanded ──────────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState({});
  const [expandedTasks, setExpandedTasks] = useState({});

  const isOverdue = d => d && d < todayStr();

  // ─────────────────────────────────────────────────────────────────────────
  if (authLoading) return (
    <div className="flex-1 p-6 flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-yellow-500" />
    </div>
  );

  // ── Assistant self-service view ───────────────────────────────────────────
  if (isAsst && !canManage) {
    const myName    = userData?.fullName || '';
    const myCompany = userData?.company  || '';

    return (
      <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={Sparkles} title="S5 Shop" />}

        <div className="space-y-6">
          {TABS.map(tab => {
            const tabTasks = (tasksByType[tab.key] || []).filter(t => t.published);
            const Icon = tab.icon;
            const isProject = tab.key === 'specialProject';
            const doneCount = isProject
              ? 0
              : tabTasks.filter(t => t.completions?.[myRosterId]?.completed).length;

            return (
              <div key={tab.key} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden">
                {/* Section header */}
                <div className="px-6 py-4 border-b border-slate-100 dark:border-white/5 flex items-center gap-3">
                  <Icon size={16} className={`text-${tab.color}-500`} />
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">
                    {tab.label}
                  </h3>
                  {!isProject && (
                    <span className="ml-auto text-[10px] font-black text-slate-400">
                      {doneCount}/{tabTasks.length} done
                    </span>
                  )}
                </div>

                {tabTasks.length === 0 ? (
                  <p className="px-6 py-5 text-xs text-slate-400 italic">No {tab.label.toLowerCase()} assigned yet.</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {tabTasks.map(task => {
                      const over = isOverdue(task.dueDate);

                      if (isProject) {
                        // Project view for assistant
                        const isExp = expanded[task.id];
                        return (
                          <div key={task.id}>
                            <button
                              onClick={() => setExpanded(p => ({ ...p, [task.id]: !p[task.id] }))}
                              className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                            >
                              <span className="text-slate-400 flex-shrink-0">
                                {isExp ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{task.title}</p>
                                {task.dueDate && (
                                  <p className={`text-[10px] font-black mt-0.5 flex items-center gap-1 ${over ? 'text-red-500' : 'text-slate-400'}`}>
                                    <CalendarDays size={9} /> Due {fmtDate(task.dueDate)}{over ? ' · OVERDUE' : ''}
                                  </p>
                                )}
                              </div>
                              {/* Task progress for this assistant */}
                              {(task.tasks || []).length > 0 && (() => {
                                const done = (task.tasks || []).filter(t =>
                                  task.taskCompletions?.[t.id]?.[myRosterId]?.completed
                                ).length;
                                return (
                                  <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border flex-shrink-0 ${
                                    done === task.tasks.length
                                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                                      : done > 0
                                        ? 'bg-yellow-50 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20'
                                        : 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                                  }`}>
                                    {done}/{task.tasks.length} tasks
                                  </span>
                                );
                              })()}
                            </button>

                            {isExp && (
                              <div className="bg-slate-50 dark:bg-black/20 border-t border-slate-100 dark:border-white/5 px-6 py-4 space-y-3">
                                {task.description && (
                                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">{task.description}</p>
                                )}
                                {task.pdfUrl && (
                                  <a href={task.pdfUrl} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    <FileText size={12} /> {task.pdfName || 'View PDF'}
                                  </a>
                                )}
                                {(task.tasks || []).length === 0 ? (
                                  <p className="text-xs text-slate-400 italic">No tasks added yet.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {(task.tasks || []).map(t => {
                                      const taskDone = task.taskCompletions?.[t.id]?.[myRosterId]?.completed || false;
                                      const isTaskExp = expandedTasks[t.id];
                                      return (
                                        <div key={t.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden">
                                          <div className="flex items-center gap-3 px-4 py-3">
                                            <button
                                              onClick={() => myRosterId && handleToggleTask(task, t.id, myRosterId)}
                                              disabled={!myRosterId || !!toggling[`${task.id}_t_${t.id}_${myRosterId}`]}
                                              className="flex-shrink-0 transition-transform hover:scale-110"
                                            >
                                              {toggling[`${task.id}_t_${t.id}_${myRosterId}`]
                                                ? <Loader2 size={18} className="animate-spin text-yellow-500" />
                                                : taskDone
                                                  ? <CheckCircle2 size={18} className="text-emerald-500" />
                                                  : <Circle size={18} className="text-slate-300 dark:text-slate-600" />
                                              }
                                            </button>
                                            <span className={`flex-1 text-xs font-bold ${taskDone ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                              {t.title}
                                            </span>
                                            {(t.subtasks || []).length > 0 && (
                                              <button
                                                onClick={() => setExpandedTasks(p => ({ ...p, [t.id]: !p[t.id] }))}
                                                className="text-slate-400 flex-shrink-0"
                                              >
                                                {isTaskExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                              </button>
                                            )}
                                          </div>
                                          {isTaskExp && (t.subtasks || []).length > 0 && (
                                            <div className="border-t border-slate-100 dark:border-white/5 divide-y divide-slate-100 dark:divide-white/5">
                                              {(t.subtasks || []).map(s => {
                                                const subDone = task.subtaskCompletions?.[s.id]?.[myRosterId]?.completed || false;
                                                return (
                                                  <div key={s.id} className="flex items-center gap-3 pl-10 pr-4 py-2.5">
                                                    <button
                                                      onClick={() => myRosterId && handleToggleSubtask(task, s.id, myRosterId)}
                                                      disabled={!myRosterId || !!toggling[`${task.id}_s_${s.id}_${myRosterId}`]}
                                                      className="flex-shrink-0 transition-transform hover:scale-110"
                                                    >
                                                      {toggling[`${task.id}_s_${s.id}_${myRosterId}`]
                                                        ? <Loader2 size={15} className="animate-spin text-yellow-500" />
                                                        : subDone
                                                          ? <CheckCircle2 size={15} className="text-emerald-500" />
                                                          : <Circle size={15} className="text-slate-300 dark:text-slate-600" />
                                                      }
                                                    </button>
                                                    <span className={`text-xs ${subDone ? 'line-through text-slate-400' : 'text-slate-600 dark:text-slate-400'}`}>
                                                      {s.title}
                                                    </span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }

                      // Assignment / Post row
                      const done = task.completions?.[myRosterId]?.completed || false;
                      return (
                        <div key={task.id} className="flex items-start gap-4 px-6 py-4">
                          <button
                            onClick={() => myRosterId && handleToggle(task, myRosterId, myName, myCompany)}
                            disabled={!myRosterId || !!toggling[`${task.id}_${myRosterId}`]}
                            className="mt-0.5 flex-shrink-0 transition-transform hover:scale-110"
                          >
                            {toggling[`${task.id}_${myRosterId}`]
                              ? <Loader2 size={20} className="animate-spin text-yellow-500" />
                              : done
                                ? <CheckCircle2 size={20} className="text-emerald-500" />
                                : <Circle size={20} className="text-slate-300 dark:text-slate-600" />
                            }
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-bold ${done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{task.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              {task.startDate && (
                                <p className="text-[10px] font-black text-slate-400 flex items-center gap-1">
                                  <CalendarDays size={9} /> Starts {fmtDate(task.startDate)}
                                </p>
                              )}
                              {task.dueDate && (
                                <p className={`text-[10px] font-black flex items-center gap-1 ${over && !done ? 'text-red-500' : 'text-slate-400'}`}>
                                  <CalendarDays size={9} /> Due {fmtDate(task.dueDate)}{over && !done ? ' · OVERDUE' : ''}
                                </p>
                              )}
                            </div>
                            {task.pdfUrl && (
                              <a href={task.pdfUrl} target="_blank" rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                <FileText size={10} /> {task.pdfName || 'View PDF'}
                              </a>
                            )}
                          </div>
                          {done && (
                            <span className="flex-shrink-0 text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg">
                              Done
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── S5 / Staff management view ────────────────────────────────────────────
  const currentTasks = tasksByType[activeTab] || [];
  const tab = TABS.find(t => t.key === activeTab);
  const TabIcon = tab?.icon || Sparkles;
  const isProjectTab = activeTab === 'specialProject';

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={Sparkles} title="S5 Shop" />}

      {/* Subheader */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Create and publish tasks for your assistants. Items stay as drafts until you publish them.
        </p>
        {canManage && (
          <button
            onClick={() => { setShowCreate(true); setForm({ title: '', description: '', startDate: '', dueDate: '' }); setPdfFile(null); }}
            className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black text-xs uppercase tracking-widest px-5 py-3 rounded-xl transition-all shadow-lg shadow-yellow-500/20"
          >
            <Plus size={15} /> New {isProjectTab ? 'Project' : tab?.label.slice(0, -1)}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          const all = tasksByType[t.key]?.length || 0;
          const draft = tasksByType[t.key]?.filter(x => !x.published).length || 0;
          return (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setShowCreate(false); setEditingProject(null); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                activeTab === t.key
                  ? 'bg-yellow-500 text-slate-950 shadow-lg shadow-yellow-500/20'
                  : 'bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 text-slate-500 dark:text-slate-400 hover:border-yellow-500/30'
              }`}
            >
              <Icon size={14} /> {t.label}
              {all > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${activeTab === t.key ? 'bg-black/20 text-slate-950' : 'bg-slate-100 dark:bg-white/10 text-slate-500'}`}>
                  {all}{draft > 0 ? ` · ${draft} draft` : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Create form */}
      {showCreate && canManage && (
        <div className="bg-white dark:bg-slate-900 border border-yellow-200 dark:border-yellow-500/20 rounded-2xl p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 flex items-center gap-2">
              <Plus size={13} /> New {isProjectTab ? 'Project' : tab?.label.slice(0, -1)}
            </h3>
            <button onClick={resetCreate} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={16} /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className={lc}>Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={isProjectTab ? 'e.g. Org Day Media Campaign' : activeTab === 'post' ? 'e.g. Instagram — Org Day recap' : 'e.g. Write news article about X'}
                className={ic}
              />
            </div>
            <div>
              <label className={lc}>Description (optional)</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Additional details, guidelines, or requirements…"
                className={ic + ' resize-none'}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lc}>Start Date</label>
                <DatePicker value={form.startDate} onChange={v => setForm(f => ({ ...f, startDate: v }))} />
              </div>
              <div>
                <label className={lc}>Due Date</label>
                <DatePicker value={form.dueDate} onChange={v => setForm(f => ({ ...f, dueDate: v }))} />
              </div>
            </div>
            {/* PDF upload */}
            <div>
              <label className={lc}>Attach PDF (optional)</label>
              <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={e => setPdfFile(e.target.files?.[0] || null)} />
              {pdfFile ? (
                <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl">
                  <FileText size={16} className="text-blue-500 flex-shrink-0" />
                  <span className="flex-1 text-xs font-bold text-blue-700 dark:text-blue-400 truncate">{pdfFile.name}</span>
                  <button onClick={() => { setPdfFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-blue-400 hover:text-red-500 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold text-slate-400 hover:border-yellow-500/50 hover:text-yellow-600 dark:hover:text-yellow-500 transition-all"
                >
                  <Upload size={14} /> Upload PDF
                </button>
              )}
              {saving && pdfFile && uploadPct > 0 && uploadPct < 100 && (
                <div className="mt-2 h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-500 rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              )}
            </div>
            {isProjectTab && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 italic flex items-center gap-1.5">
                <ListTodo size={11} /> Tasks and subtasks can be added after creating the project.
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={resetCreate} className="flex-1 py-3 rounded-xl text-xs font-black uppercase text-slate-500 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !form.title.trim()}
                className="flex-1 py-3 rounded-xl text-xs font-black uppercase text-slate-950 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {saving ? <><Loader2 size={13} className="animate-spin" /> {pdfFile && uploadPct < 100 ? `Uploading ${uploadPct}%…` : 'Saving…'}</> : 'Save as Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {currentTasks.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-10 text-center">
          <TabIcon size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-bold text-slate-400">No {tab?.label.toLowerCase()} yet.</p>
          {canManage && (
            <button
              onClick={() => { setShowCreate(true); setForm({ title: '', description: '', startDate: '', dueDate: '' }); setPdfFile(null); }}
              className="mt-4 text-xs font-black text-yellow-600 dark:text-yellow-500 hover:underline"
            >
              + Create the first one
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {currentTasks.map(task => {
            const isExp = expanded[task.id];
            const over  = isOverdue(task.dueDate);
            const isEditing = editingProject === task.id;

            // Progress calculation
            let completedCount = 0, total = 0;
            if (isProjectTab) {
              total = (task.tasks || []).length;
              completedCount = total > 0
                ? (task.tasks || []).filter(t =>
                    assistants.every(a => task.taskCompletions?.[t.id]?.[a.id]?.completed)
                  ).length
                : 0;
            } else {
              total = assistants.length;
              completedCount = assistants.filter(a => task.completions?.[a.id]?.completed).length;
            }
            const allDone = total > 0 && completedCount === total;

            return (
              <div key={task.id} className={`bg-white dark:bg-slate-900 border rounded-2xl overflow-hidden transition-all ${
                allDone ? 'border-emerald-200 dark:border-emerald-500/20' : 'border-slate-200 dark:border-white/5'
              }`}>
                {/* Header row */}
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpanded(p => ({ ...p, [task.id]: !p[task.id] }))}
                >
                  <span className="text-slate-400 flex-shrink-0">
                    {isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-black ${allDone ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>
                        {task.title}
                      </p>
                      {!task.published && (
                        <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {task.startDate && (
                        <p className="text-[10px] text-slate-400 flex items-center gap-1">
                          <CalendarDays size={9} /> {fmtDate(task.startDate)}
                        </p>
                      )}
                      {task.dueDate && (
                        <p className={`text-[10px] font-black flex items-center gap-1 ${over && !allDone ? 'text-red-500' : 'text-slate-400'}`}>
                          <CalendarDays size={9} /> Due {fmtDate(task.dueDate)}{over && !allDone ? ' · OVERDUE' : ''}
                        </p>
                      )}
                      {task.pdfUrl && (
                        <span className="text-[10px] text-blue-500 flex items-center gap-1">
                          <FileText size={9} /> PDF attached
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {/* Progress pill */}
                    {total > 0 && (
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${
                        allDone
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20'
                          : completedCount > 0
                            ? 'bg-yellow-50 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-500/20'
                            : 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'
                      }`}>
                        {isProjectTab ? `${completedCount}/${total} tasks` : `${completedCount}/${total}`}
                      </span>
                    )}

                    {/* Publish toggle */}
                    {canManage && (
                      <button
                        onClick={() => handlePublish(task)}
                        disabled={publishing === task.id}
                        title={task.published ? 'Unpublish (move to draft)' : 'Publish to assistants'}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                          task.published
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                            : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-yellow-50 hover:text-yellow-700 dark:hover:bg-yellow-500/10 dark:hover:text-yellow-400'
                        }`}
                      >
                        {publishing === task.id
                          ? <Loader2 size={11} className="animate-spin" />
                          : task.published ? <Eye size={11} /> : <EyeOff size={11} />
                        }
                        {task.published ? 'Live' : 'Publish'}
                      </button>
                    )}

                    {/* Edit tasks (projects only) */}
                    {canManage && isProjectTab && (
                      <button
                        onClick={() => {
                          setEditingProject(isEditing ? null : task.id);
                          setExpanded(p => ({ ...p, [task.id]: true }));
                        }}
                        title="Edit tasks"
                        className={`p-1.5 rounded-lg transition-colors ${
                          isEditing
                            ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                            : 'text-slate-400 hover:text-yellow-600 hover:bg-yellow-50 dark:hover:bg-yellow-500/10'
                        }`}
                      >
                        <Pencil size={13} />
                      </button>
                    )}

                    {/* Delete */}
                    {canManage && (
                      <button
                        onClick={() => setDeleteConf(task.id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded body */}
                {isExp && (
                  <div className="border-t border-slate-100 dark:border-white/5 px-5 py-4 space-y-5">
                    {/* Description + meta */}
                    {task.description && (
                      <p className="text-xs text-slate-600 dark:text-slate-400">{task.description}</p>
                    )}
                    {task.pdfUrl && (
                      <a href={task.pdfUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <FileText size={12} /> {task.pdfName || 'Attached PDF'}
                      </a>
                    )}

                    {/* Special Project: tasks section */}
                    {isProjectTab && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Tasks</p>
                          {isEditing && (
                            <span className="text-[9px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500">
                              Editing mode
                            </span>
                          )}
                        </div>

                        {(task.tasks || []).length === 0 && !isEditing && (
                          <p className="text-xs text-slate-400 italic">No tasks yet.{canManage ? ' Click the pencil icon to add tasks.' : ''}</p>
                        )}

                        {/* Task list */}
                        {(task.tasks || []).map(t => {
                          const isTaskExp = expandedTasks[t.id];
                          const taskAllDone = assistants.length > 0 &&
                            assistants.every(a => task.taskCompletions?.[t.id]?.[a.id]?.completed);

                          return (
                            <div key={t.id} className="border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden">
                              {/* Task header */}
                              <div
                                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                                onClick={() => setExpandedTasks(p => ({ ...p, [t.id]: !p[t.id] }))}
                              >
                                <span className="text-slate-400 flex-shrink-0">
                                  {isTaskExp ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                </span>
                                <span className={`flex-1 text-xs font-bold ${taskAllDone ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                  {t.title}
                                </span>
                                {/* Sub-task count */}
                                {(t.subtasks || []).length > 0 && (
                                  <span className="text-[9px] font-black text-slate-400 mr-2">
                                    {(t.subtasks || []).length} subtask{(t.subtasks || []).length !== 1 ? 's' : ''}
                                  </span>
                                )}
                                {isEditing && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleDeleteTask(task, t.id); }}
                                    className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>

                              {/* Expanded: assistant completions + subtasks */}
                              {isTaskExp && (
                                <div className="border-t border-slate-100 dark:border-white/5 px-4 py-3 space-y-3">
                                  {/* Subtasks */}
                                  {(t.subtasks || []).length > 0 && (
                                    <div className="space-y-1.5">
                                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Subtasks</p>
                                      {(t.subtasks || []).map(s => {
                                        return (
                                          <div key={s.id} className="flex items-center gap-2 pl-2">
                                            <GripVertical size={10} className="text-slate-200 dark:text-slate-700 flex-shrink-0" />
                                            <span className="flex-1 text-xs text-slate-600 dark:text-slate-400">{s.title}</span>
                                            {isEditing && (
                                              <button
                                                onClick={() => handleDeleteSubtask(task, t.id, s.id)}
                                                className="p-0.5 text-slate-300 hover:text-red-500 transition-colors rounded"
                                              >
                                                <X size={11} />
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {/* Add subtask input */}
                                  {isEditing && (
                                    <div className="flex gap-2">
                                      <input
                                        type="text"
                                        value={newSubInputs[t.id] || ''}
                                        onChange={e => setNewSubInputs(p => ({ ...p, [t.id]: e.target.value }))}
                                        onKeyDown={e => e.key === 'Enter' && handleAddSubtask(task, t.id)}
                                        placeholder="Add subtask…"
                                        className="flex-1 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-all"
                                      />
                                      <button
                                        onClick={() => handleAddSubtask(task, t.id)}
                                        disabled={!(newSubInputs[t.id] || '').trim()}
                                        className="px-3 py-2 bg-slate-100 dark:bg-white/5 hover:bg-yellow-500 hover:text-slate-950 text-slate-500 rounded-lg text-xs font-black transition-all disabled:opacity-40"
                                      >
                                        <Plus size={13} />
                                      </button>
                                    </div>
                                  )}

                                  {/* Assistant completion grid */}
                                  {assistants.length > 0 && (
                                    <div>
                                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                        {isProjectTab ? 'Task Completion' : 'Assistant Completion'}
                                      </p>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {assistants.map(asst => {
                                          const done = task.taskCompletions?.[t.id]?.[asst.id]?.completed || false;
                                          const tKey = `${task.id}_t_${t.id}_${asst.id}`;
                                          const canToggle = canManage || (isAsst && asst.id === myRosterId);
                                          return (
                                            <button
                                              key={asst.id}
                                              onClick={() => canToggle && handleToggleTask(task, t.id, asst.id)}
                                              disabled={!canToggle || !!toggling[tKey]}
                                              className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                                                done
                                                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                                                  : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5 hover:border-yellow-500/40'
                                              } ${canToggle ? 'cursor-pointer' : 'cursor-default'}`}
                                            >
                                              <span className="flex-shrink-0">
                                                {toggling[tKey]
                                                  ? <Loader2 size={16} className="animate-spin text-yellow-500" />
                                                  : done ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-slate-300 dark:text-slate-600" />
                                                }
                                              </span>
                                              <div className="flex-1 min-w-0">
                                                <p className={`text-xs font-black truncate ${done ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                                  {asst.fullName}
                                                </p>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{normalizeCompany(asst.company)} Company</p>
                                              </div>
                                              {done && task.taskCompletions?.[t.id]?.[asst.id]?.completedAt && (
                                                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap flex-shrink-0">
                                                  {new Date(task.taskCompletions[t.id][asst.id].completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </span>
                                              )}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Subtask completion grid (if subtasks exist) */}
                                  {(t.subtasks || []).length > 0 && assistants.length > 0 && (
                                    <div>
                                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Subtask Completion</p>
                                      {(t.subtasks || []).map(s => (
                                        <div key={s.id} className="mb-3">
                                          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 pl-1">{s.title}</p>
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {assistants.map(asst => {
                                              const done = task.subtaskCompletions?.[s.id]?.[asst.id]?.completed || false;
                                              const sKey = `${task.id}_s_${s.id}_${asst.id}`;
                                              const canToggle = canManage || (isAsst && asst.id === myRosterId);
                                              return (
                                                <button
                                                  key={asst.id}
                                                  onClick={() => canToggle && handleToggleSubtask(task, s.id, asst.id)}
                                                  disabled={!canToggle || !!toggling[sKey]}
                                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                                                    done
                                                      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                                                      : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5 hover:border-yellow-500/40'
                                                  } ${canToggle ? 'cursor-pointer' : 'cursor-default'}`}
                                                >
                                                  <span className="flex-shrink-0">
                                                    {toggling[sKey]
                                                      ? <Loader2 size={13} className="animate-spin text-yellow-500" />
                                                      : done ? <CheckCircle2 size={13} className="text-emerald-500" /> : <Circle size={13} className="text-slate-300 dark:text-slate-600" />
                                                    }
                                                  </span>
                                                  <span className={`text-xs font-bold truncate ${done ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                                    {asst.fullName}
                                                  </span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Add task input (edit mode) */}
                        {isEditing && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newTaskInput}
                              onChange={e => setNewTaskInput(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleAddTask(task)}
                              placeholder="Add new task…"
                              className="flex-1 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-all"
                            />
                            <button
                              onClick={() => handleAddTask(task)}
                              disabled={!newTaskInput.trim()}
                              className="px-4 py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-950 rounded-xl text-xs font-black transition-all disabled:opacity-40 flex items-center gap-2"
                            >
                              <Plus size={14} /> Add
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Assignments / Posts: assistant completion grid */}
                    {!isProjectTab && assistants.length > 0 && (
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Assistant Completion</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {assistants.map(asst => {
                            const comp = task.completions?.[asst.id] || {};
                            const done = comp.completed || false;
                            const tKey = `${task.id}_${asst.id}`;
                            const canToggle = canManage || (isAsst && asst.id === myRosterId);
                            return (
                              <button
                                key={asst.id}
                                onClick={() => canToggle && handleToggle(task, asst.id, asst.fullName, asst.company)}
                                disabled={!canToggle || !!toggling[tKey]}
                                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                                  done
                                    ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                                    : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-white/5 hover:border-yellow-500/40'
                                } ${canToggle ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                <span className="flex-shrink-0">
                                  {toggling[tKey]
                                    ? <Loader2 size={18} className="animate-spin text-yellow-500" />
                                    : done ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className="text-slate-300 dark:text-slate-600" />
                                  }
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs font-black truncate ${done ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                    {asst.fullName}
                                  </p>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{normalizeCompany(asst.company)} Company</p>
                                </div>
                                {done && comp.completedAt && (
                                  <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap flex-shrink-0">
                                    {new Date(comp.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {!isProjectTab && assistants.length === 0 && (
                      <p className="text-xs text-slate-400 italic">No Company S5 Assistants in roster yet.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteConf && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setDeleteConf(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-sm font-black text-slate-900 dark:text-white mb-2">Delete permanently?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
              This will delete the {isProjectTab ? 'project, all its tasks,' : 'item'} and all completion records. Cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConf(null)} className="flex-1 py-3 rounded-xl text-xs font-black uppercase text-slate-500 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConf)}
                disabled={!!deleting}
                className="flex-1 py-3 rounded-xl text-xs font-black uppercase text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-2xl shadow-xl z-50 ${
          toast.isError ? 'bg-rose-600 text-white' : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default AdminS5;
