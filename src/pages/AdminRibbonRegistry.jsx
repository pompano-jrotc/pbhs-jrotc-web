// src/pages/AdminRibbonRegistry.jsx
//
// Ribbon Registry — two sub-tabs:
//   Catalog   — create/manage ribbon types (STAFF 70+ create, ADMIN 80+ delete)
//   Mass Award — pick a ribbon type, select cadets, award in one batch (STAFF 70+)
// Embedded inside S1 area via hideHeader prop.

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  serverTimestamp, query, orderBy, getDocs, where, writeBatch, updateDoc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import {
  Award, Plus, Trash2, Pencil, X, Loader2, AlertTriangle, Users, CheckSquare, Square, Download,
  GripVertical, ListOrdered, Check,
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import AdminPageHeader from '../components/AdminPageHeader';
import { usePageMeta } from '../hooks/usePageMeta';

const CATEGORY_OPTIONS = [
  { value: '',            label: 'Uncategorized'  },
  { value: 'achievement', label: 'Achievement'    },
  { value: 'academic',    label: 'Academic'       },
  { value: 'military',    label: 'Military'       },
  { value: 'service',     label: 'Service'        },
  { value: 'physical',    label: 'Physical'       },
  { value: 'leadership',  label: 'Leadership'     },
];

const CAT_CHIP = {
  achievement: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  academic:    'bg-blue-500/10  text-blue-600  dark:text-blue-400  border-blue-500/20',
  military:    'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
  service:     'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  physical:    'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  leadership:  'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
};

const BLANK_RT = { name: '', code: '', description: '', category: '' };

// ── Drag-and-drop sortable row ─────────────────────────────────────────────────
const SortableRow = ({ rt }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rt.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex:  isDragging ? 10 : 'auto',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl"
    >
      <button
        {...attributes}
        {...listeners}
        className="text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical size={16} />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{rt.name}</p>
        {rt.code && <p className="text-[10px] font-mono text-slate-400">{rt.code}</p>}
      </div>
      {rt.category && (
        <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${CAT_CHIP[rt.category] || 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'}`}>
          {rt.category}
        </span>
      )}
    </div>
  );
};

const STANDARD_JROTC_RIBBONS = [
  // N-1-x  Achievement / Academic
  { name: 'Distinguished Cadet Award',      code: 'N-1-1',  category: 'achievement' },
  { name: 'Academic Excellence Award',      code: 'N-1-2',  category: 'academic'    },
  { name: 'Academic Achievement Award',     code: 'N-1-3',  category: 'academic'    },
  { name: 'Perfect Attendance Award',       code: 'N-1-4',  category: 'academic'    },
  { name: 'Student Government Award',       code: 'N-1-5',  category: 'leadership'  },
  { name: 'Leadership Education & Training',code: 'N-1-6',  category: 'leadership'  },
  { name: 'Superior Instructor',            code: 'N-1-7',  category: 'leadership'  },
  { name: 'CPR First Aid',                  code: 'N-1-8',  category: 'service'     },
  { name: 'Distinguished Cadet',            code: 'N-1-9',  category: 'achievement' },
  { name: 'Honor Cadet',                    code: 'N-1-10', category: 'achievement' },
  // N-2-x  Athletic
  { name: 'Varsity Athletics',              code: 'N-2-1',  category: 'physical'    },
  { name: 'Physical Fitness',               code: 'N-2-2',  category: 'physical'    },
  { name: 'JROTC Athletics',                code: 'N-2-3',  category: 'physical'    },
  { name: 'Junior Varsity Athletics',       code: 'N-2-4',  category: 'physical'    },
  { name: 'Athletic Service',               code: 'N-2-5',  category: 'physical'    },
  // N-3-x  Activity
  { name: 'Dai/Sai Instructor Leadership',  code: 'N-3-1',  category: 'leadership'  },
  { name: 'Personal Appearance',            code: 'N-3-2',  category: 'military'    },
  { name: 'Proficiency',                    code: 'N-3-3',  category: 'achievement' },
  { name: 'Drill Team',                     code: 'N-3-4',  category: 'military'    },
  { name: 'Orienteering',                   code: 'N-3-5',  category: 'military'    },
  { name: 'Color/Honor Guard',              code: 'N-3-6',  category: 'military'    },
  { name: 'Rifle/Marksmanship Team',        code: 'N-3-7',  category: 'military'    },
  { name: 'Adventure Training Team',        code: 'N-3-8',  category: 'military'    },
  { name: 'Commendation',                   code: 'N-3-9',  category: 'achievement' },
  { name: 'Good Conduct',                   code: 'N-3-10', category: 'military'    },
  { name: 'JCLC Participation',             code: 'N-3-11', category: 'military'    },
  { name: 'Championship Drill Team',        code: 'N-3-12', category: 'military'    },
  { name: 'Raider Team',                    code: 'N-3-13', category: 'military'    },
  { name: 'Recondo/Rappelling',             code: 'N-3-14', category: 'military'    },
  { name: 'Meritorious Actions',            code: 'N-3-15', category: 'achievement' },
  // N-4-x  Service / Community
  { name: 'Parade',                         code: 'N-4-1',  category: 'service'     },
  { name: 'Recruiting',                     code: 'N-4-2',  category: 'service'     },
  { name: 'School Support',                 code: 'N-4-3',  category: 'service'     },
  { name: 'Community Service',              code: 'N-4-4',  category: 'service'     },
  { name: 'Confidence Course',              code: 'N-4-5',  category: 'military'    },
  { name: 'Service Learning',               code: 'N-4-6',  category: 'service'     },
  { name: 'Excellent Staff Performance',    code: 'N-4-7',  category: 'leadership'  },
  // Battalion-specific / uncoded
  { name: 'Medal for Heroism',                              code: '', category: 'achievement' },
  { name: 'Superior Cadet Award',                           code: '', category: 'achievement' },
  { name: 'Military Appreciation Ribbon',                   code: '', category: 'military'    },
  { name: 'Q1 Company Cadet of the Quarter',                code: '', category: 'achievement' },
  { name: 'Q1 Company of the Quarter',                      code: '', category: 'achievement' },
  { name: 'Q2 Company Cadet of the Quarter',                code: '', category: 'achievement' },
  { name: 'Q2 Company of the Quarter',                      code: '', category: 'achievement' },
  { name: 'Q3 Company Cadet of the Quarter',                code: '', category: 'achievement' },
  { name: 'Q3 Company of the Quarter',                      code: '', category: 'achievement' },
  { name: 'Q4 Company Cadet of the Quarter',                code: '', category: 'achievement' },
  { name: 'Q4 Company of the Quarter',                      code: '', category: 'achievement' },
  { name: 'Funeral Ribbon',                                 code: '', category: 'service'     },
  { name: 'Honor Company Ribbon',                           code: '', category: 'achievement' },
  { name: 'Experience Camp Attendance Ribbon',              code: '', category: 'military'    },
  { name: 'Experience Camp Honor Cadet Ribbon',             code: '', category: 'achievement' },
  { name: 'Experience Camp Honor Company Ribbon',           code: '', category: 'achievement' },
  { name: 'Company Flag Requirements Ribbon',               code: '', category: 'military'    },
  { name: 'Company Commander of the Quarter Ribbon',        code: '', category: 'leadership'  },
  { name: 'Company XO of the Quarter Ribbon',               code: '', category: 'leadership'  },
  { name: 'Company First Sergeant of the Quarter Ribbon',   code: '', category: 'leadership'  },
  { name: 'Platoon Leader of the Quarter Ribbon',           code: '', category: 'leadership'  },
  { name: 'Platoon Sergeant of the Quarter Ribbon',         code: '', category: 'leadership'  },
  { name: 'Squad Leader of the Quarter Ribbon',             code: '', category: 'leadership'  },
  { name: 'Squad Member of the Quarter Ribbon',             code: '', category: 'achievement' },
  { name: 'Company Platoon Leader of the Quarter Ribbon',   code: '', category: 'leadership'  },
  { name: 'Company Platoon Sergeant of the Quarter Ribbon', code: '', category: 'leadership'  },
  { name: 'Company Squad Leader of the Quarter Ribbon',     code: '', category: 'leadership'  },
  { name: 'Company Squad Member of the Quarter Ribbon',     code: '', category: 'achievement' },
  { name: 'Experience Camp Cadet Cadre Ribbon',             code: '', category: 'leadership'  },
  { name: 'JPA Ribbon',                                     code: '', category: 'service'     },
  { name: 'DAI Award Ribbon',                               code: '', category: 'achievement' },
  { name: '100 Flags Ribbon',                               code: '', category: 'service'     },
  { name: 'Highest Amount of Flags Ribbon',                 code: '', category: 'service'     },
];

const AdminRibbonRegistry = ({ hideHeader = false }) => {
  const { user, role, userData, authLoading } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canView   = userLevel >= COMMAND_LEVEL;
  const canManage = userLevel >= STAFF_LEVEL;
  const canDelete = userLevel >= ADMIN_LEVEL;

  usePageMeta({
    title: 'Ribbon Registry',
    description: 'Manage the catalog of ribbon types.',
    path: '/admin/ribbons',
  });

  const [subTab,       setSubTab]       = useState('catalog'); // 'catalog' | 'mass'
  const [ribbonTypes,  setRibbonTypes]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showModal,    setShowModal]    = useState(false);
  const [form,         setForm]         = useState(BLANK_RT);
  const [saving,       setSaving]       = useState(false);
  const [importing,    setImporting]    = useState(false);
  const [toast,        setToast]        = useState(null);
  const [editingRibbon, setEditingRibbon] = useState(null);
  const [editForm,     setEditForm]     = useState(BLANK_RT);
  const [editSaving,   setEditSaving]   = useState(false);
  const [reordering,   setReordering]   = useState(false);
  const [reorderList,  setReorderList]  = useState([]);
  const [reorderSaving, setReorderSaving] = useState(false);

  // Mass award state
  const [roster,          setRoster]          = useState([]);
  const [rosterLoading,   setRosterLoading]   = useState(false);
  const [companyFilter,   setCompanyFilter]   = useState('All');
  const [selectedType,    setSelectedType]    = useState('');
  const [selectedCadets,  setSelectedCadets]  = useState(new Set());
  const [massForm,        setMassForm]        = useState({ awardedDate: '', cycleNumber: '', citation: '', recommendedBy: '', status: 'pending' });
  const [awarding,        setAwarding]        = useState(false);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Live ribbon types ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!canView || authLoading) return;
    const q = query(collection(db, 'ribbonTypes'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, snap => {
      setRibbonTypes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
  }, [canView, authLoading]);

  // ── Roster for mass award ─────────────────────────────────────────────────
  useEffect(() => {
    if (subTab !== 'mass' || !canManage) return;
    setRosterLoading(true);
    getDocs(collection(db, 'roster'))
      .then(snap => {
        setRoster(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setRosterLoading(false);
      })
      .catch(() => setRosterLoading(false));
  }, [subTab, canManage]);

  // ── Filtered roster for mass award ───────────────────────────────────────
  const filteredRoster = useMemo(() => {
    const active = roster.filter(c => c.status !== 'alumni' && c.status !== 'inactive');
    if (companyFilter === 'All') return active;
    return active.filter(c => c.company === companyFilter);
  }, [roster, companyFilter]);

  const companies = useMemo(() => {
    const set = new Set(roster.filter(c => c.company).map(c => c.company));
    return ['All', ...Array.from(set).sort()];
  }, [roster]);

  const sortedRibbonTypes = useMemo(() => {
    return [...ribbonTypes].sort((a, b) => {
      const pa = a.precedence ?? 99999;
      const pb = b.precedence ?? 99999;
      if (pa !== pb) return pa - pb;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [ribbonTypes]);

  // ── Create ribbon type ────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!form.name.trim()) { showToast('Ribbon name is required', 'err'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, 'ribbonTypes'), {
        name:          form.name.trim(),
        code:          form.code.trim(),
        description:   form.description.trim(),
        category:      form.category,
        precedence:    null,
        createdAt:     serverTimestamp(),
        createdByUid:  user?.uid || '',
        createdByName: userData?.fullName || '',
      });
      showToast('Ribbon type created');
      setForm(BLANK_RT);
      setShowModal(false);
    } catch {
      showToast('Save failed — try again', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ribbon type ────────────────────────────────────────────────────
  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete ribbon type "${name}"?\n\nExisting awards of this type will remain but will show a missing type.`)) return;
    try {
      await deleteDoc(doc(db, 'ribbonTypes', id));
      showToast('Ribbon type deleted');
    } catch {
      showToast('Delete failed', 'err');
    }
  };

  // ── Edit ribbon type ──────────────────────────────────────────────────────
  const openEdit = rt => {
    setEditForm({
      name:        rt.name || '',
      code:        rt.code || '',
      description: rt.description || '',
      category:    rt.category || '',
    });
    setEditingRibbon(rt);
  };

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { showToast('Ribbon name is required', 'err'); return; }
    setEditSaving(true);
    try {
      await updateDoc(doc(db, 'ribbonTypes', editingRibbon.id), {
        name:        editForm.name.trim(),
        code:        editForm.code.trim(),
        description: editForm.description.trim(),
        category:    editForm.category,
      });
      showToast('Ribbon updated');
      setEditingRibbon(null);
    } catch {
      showToast('Update failed — try again', 'err');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Import standard JROTC ribbons ────────────────────────────────────────
  const handleImportStandard = async () => {
    if (!window.confirm(`Import all ${STANDARD_JROTC_RIBBONS.length} standard US Army JROTC regulation ribbons?\n\nRibbons already in the catalog (matched by name) will be skipped.`)) return;
    setImporting(true);
    try {
      const existingSnap = await getDocs(collection(db, 'ribbonTypes'));
      const existingNames = new Set(existingSnap.docs.map(d => (d.data().name || '').toLowerCase()));
      const toAdd = STANDARD_JROTC_RIBBONS.filter(r => !existingNames.has(r.name.toLowerCase()));
      if (toAdd.length === 0) {
        showToast('All standard ribbons are already in the catalog');
        return;
      }
      const CHUNK = 499;
      for (let i = 0; i < toAdd.length; i += CHUNK) {
        const batch = writeBatch(db);
        toAdd.slice(i, i + CHUNK).forEach(r => {
          const stdIdx = STANDARD_JROTC_RIBBONS.findIndex(s => s.name === r.name);
          batch.set(doc(collection(db, 'ribbonTypes')), {
            name:          r.name,
            code:          r.code,
            description:   '',
            category:      r.category,
            precedence:    stdIdx >= 0 ? stdIdx + 1 : null,
            createdAt:     serverTimestamp(),
            createdByUid:  user?.uid || '',
            createdByName: userData?.fullName || 'System Import',
          });
        });
        await batch.commit();
      }
      showToast(`Imported ${toAdd.length} ribbon${toAdd.length !== 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Ribbon import error:', err);
      showToast('Import failed — try again', 'err');
    } finally {
      setImporting(false);
    }
  };

  // ── Mass award ────────────────────────────────────────────────────────────
  const handleMassAward = async () => {
    if (!selectedType) { showToast('Select a ribbon type first', 'err'); return; }
    if (selectedCadets.size === 0) { showToast('Select at least one cadet', 'err'); return; }
    const rt = ribbonTypes.find(r => r.id === selectedType);
    if (!rt) return;
    if (!window.confirm(`Award "${rt.name}" to ${selectedCadets.size} cadet${selectedCadets.size !== 1 ? 's' : ''}?`)) return;
    setAwarding(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      Array.from(selectedCadets).forEach(rosterDocId => {
        const ref = doc(collection(db, 'ribbonAwards'));
        batch.set(ref, {
          rosterDocId,
          ribbonTypeId:  rt.id,
          ribbonName:    rt.name,
          ribbonCode:    rt.code || '',
          cycleNumber:   massForm.cycleNumber ? Number(massForm.cycleNumber) : null,
          awardedDate:   massForm.awardedDate || null,
          citation:      massForm.citation.trim() || null,
          recommendedBy: massForm.recommendedBy.trim() || null,
          awardedByUid:  user?.uid || '',
          awardedByName: userData?.fullName || '',
          status:        massForm.status,
          createdAt:     now,
        });
      });
      await batch.commit();
      showToast(`Awarded "${rt.name}" to ${selectedCadets.size} cadet${selectedCadets.size !== 1 ? 's' : ''}`);
      setSelectedCadets(new Set());
      setMassForm({ awardedDate: '', cycleNumber: '', citation: '', recommendedBy: '', status: 'pending' });
      setSelectedType('');
    } catch {
      showToast('Batch award failed — try again', 'err');
    } finally {
      setAwarding(false);
    }
  };

  const toggleCadet = id => setSelectedCadets(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (selectedCadets.size === filteredRoster.length && filteredRoster.length > 0) {
      setSelectedCadets(new Set());
    } else {
      setSelectedCadets(new Set(filteredRoster.map(c => c.id)));
    }
  };

  // ── Drag-and-drop reorder ─────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const enterReorder = () => {
    setReorderList([...sortedRibbonTypes]);
    setReordering(true);
  };

  const cancelReorder = () => {
    setReordering(false);
    setReorderList([]);
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setReorderList(items => {
      const oldIdx = items.findIndex(i => i.id === active.id);
      const newIdx = items.findIndex(i => i.id === over.id);
      return arrayMove(items, oldIdx, newIdx);
    });
  };

  const saveReorder = async () => {
    setReorderSaving(true);
    try {
      const CHUNK = 499;
      for (let i = 0; i < reorderList.length; i += CHUNK) {
        const batch = writeBatch(db);
        reorderList.slice(i, i + CHUNK).forEach((rt, j) => {
          batch.update(doc(db, 'ribbonTypes', rt.id), { precedence: i + j + 1 });
        });
        await batch.commit();
      }
      showToast('Order saved');
      setReordering(false);
      setReorderList([]);
    } catch {
      showToast('Save failed — try again', 'err');
    } finally {
      setReorderSaving(false);
    }
  };

  // ── Access guard ──────────────────────────────────────────────────────────
  if (!authLoading && !canView) {
    return (
      <div className="flex-1 p-6 md:p-10 w-full">
        <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <AlertTriangle className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Access Restricted</p>
        </div>
      </div>
    );
  }

  return (
    <div className={hideHeader ? '' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && (
        <AdminPageHeader
          icon={Award}
          title="Ribbon Registry"
          meta="Define and award ribbon types to cadets."
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-xs font-black shadow-xl ${
          toast.type === 'err' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ── Sub-tab bar ── */}
      <div className="flex gap-1 mb-6 bg-blue-50/70 dark:bg-slate-800/50 rounded-2xl p-1 max-w-xs">
        {[
          { key: 'catalog', label: 'Catalog',    Icon: Award  },
          { key: 'mass',    label: 'Mass Award',  Icon: Users  },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
              subTab === key
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
          >
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          CATALOG TAB
      ══════════════════════════════════════════════════════════ */}
      {subTab === 'catalog' && (<>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {ribbonTypes.length} type{ribbonTypes.length !== 1 ? 's' : ''} in catalog
          </p>
          {canManage && !reordering && (
            <div className="flex items-center gap-2 flex-wrap">
              {ribbonTypes.length > 1 && (
                <button
                  onClick={enterReorder}
                  className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 text-slate-700 dark:text-slate-200 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors"
                >
                  <ListOrdered size={13} /> Reorder
                </button>
              )}
              <button
                onClick={handleImportStandard}
                disabled={importing}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-white/10 dark:hover:bg-white/15 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors disabled:opacity-50"
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {importing ? 'Importing…' : 'Import Standard Ribbons'}
              </button>
              <button
                onClick={() => { setForm(BLANK_RT); setShowModal(true); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm shadow-yellow-500/20"
              >
                <Plus size={13} /> New Ribbon Type
              </button>
            </div>
          )}
          {reordering && (
            <div className="flex items-center gap-2">
              <button
                onClick={cancelReorder}
                disabled={reorderSaving}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveReorder}
                disabled={reorderSaving}
                className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors"
              >
                {reorderSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {reorderSaving ? 'Saving…' : 'Save Order'}
              </button>
            </div>
          )}
        </div>

        {/* ── Reorder mode ── */}
        {reordering && (
          <>
            <p className="text-[10px] text-slate-400 mb-3">Drag ribbons into wear order — most prestigious first. Click <strong>Save Order</strong> when done.</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={reorderList.map(r => r.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {reorderList.map((rt, idx) => (
                    <div key={rt.id} className="flex items-center gap-3">
                      <span className="w-6 text-right text-[10px] font-black text-slate-300 dark:text-slate-600 shrink-0">{idx + 1}</span>
                      <div className="flex-1">
                        <SortableRow rt={rt} />
                      </div>
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}

        {/* ── Normal catalog grid ── */}
        {!reordering && (
          loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
            </div>
          ) : ribbonTypes.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
              <Award className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No ribbon types yet</p>
              {canManage && <p className="text-xs text-slate-400 mt-2">Click "New Ribbon Type" to add the first one.</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedRibbonTypes.map(rt => (
                <div key={rt.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-slate-800 dark:text-white leading-snug">{rt.name}</p>
                      {rt.code && <p className="text-[10px] font-mono text-slate-400 mt-0.5">{rt.code}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canManage && (
                        <button
                          onClick={() => openEdit(rt)}
                          className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-yellow-500 hover:bg-yellow-500/10 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(rt.id, rt.name)}
                          className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {rt.description && <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{rt.description}</p>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {rt.precedence != null && (
                      <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">
                        #{rt.precedence}
                      </span>
                    )}
                    {rt.category && (
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${CAT_CHIP[rt.category] || 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'}`}>
                        {rt.category}
                      </span>
                    )}
                    {rt.createdByName && <span className="text-[9px] text-slate-400">Added by {rt.createdByName}</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </>)}

      {/* ══════════════════════════════════════════════════════════
          MASS AWARD TAB
      ══════════════════════════════════════════════════════════ */}
      {subTab === 'mass' && (<>
        {!canManage ? (
          <div className="text-center py-16 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
            <AlertTriangle className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={36} />
            <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Staff access required</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">

            {/* Left — cadet selector */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex-1">
                  Select Cadets
                  {selectedCadets.size > 0 && (
                    <span className="ml-2 text-yellow-500">{selectedCadets.size} selected</span>
                  )}
                </p>
                {/* Company filter */}
                <select
                  value={companyFilter}
                  onChange={e => { setCompanyFilter(e.target.value); setSelectedCadets(new Set()); }}
                  className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                >
                  {companies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Companies' : `${c} Co.`}</option>)}
                </select>
                {/* Select all */}
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors"
                >
                  {selectedCadets.size === filteredRoster.length && filteredRoster.length > 0
                    ? <CheckSquare size={13} />
                    : <Square size={13} />
                  }
                  {selectedCadets.size === filteredRoster.length && filteredRoster.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {rosterLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-yellow-500" size={28} /></div>
              ) : filteredRoster.length === 0 ? (
                <div className="text-center py-10 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-2xl">
                  <p className="text-slate-400 text-xs font-bold">No cadets found</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden max-h-[480px] overflow-y-auto">
                  {filteredRoster
                    .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))
                    .map((cadet, i) => {
                      const checked = selectedCadets.has(cadet.id);
                      return (
                        <button
                          key={cadet.id}
                          onClick={() => toggleCadet(cadet.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-100 dark:border-white/5 last:border-0 ${
                            checked
                              ? 'bg-yellow-500/5 dark:bg-yellow-500/10'
                              : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                            checked
                              ? 'bg-yellow-500 border-yellow-500'
                              : 'border-slate-300 dark:border-white/20'
                          }`}>
                            {checked && <span className="text-slate-950 text-[10px] font-black">✓</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{cadet.fullName}</p>
                            <p className="text-[9px] text-slate-400">
                              {[cadet.rank, cadet.company ? `${cadet.company} Co.` : null, cadet.letLevel].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Right — award details */}
            <div className="space-y-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Award Details</p>

              {/* Ribbon type */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  Ribbon Type <span className="text-red-500">*</span>
                </label>
                {ribbonTypes.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No ribbon types in catalog yet. Add them in the Catalog tab.</p>
                ) : (
                  <select
                    value={selectedType}
                    onChange={e => setSelectedType(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                  >
                    <option value="">— Select type —</option>
                    {ribbonTypes.map(rt => (
                      <option key={rt.id} value={rt.id}>{rt.name}{rt.code ? ` (${rt.code})` : ''}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Date + Cycle */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Award Date</label>
                  <input type="date" value={massForm.awardedDate} onChange={e => setMassForm(f => ({ ...f, awardedDate: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Cycle #</label>
                  <input type="number" min="1" value={massForm.cycleNumber} onChange={e => setMassForm(f => ({ ...f, cycleNumber: e.target.value }))}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
                </div>
              </div>

              {/* Recommended by */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Recommended By</label>
                <input value={massForm.recommendedBy} onChange={e => setMassForm(f => ({ ...f, recommendedBy: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
              </div>

              {/* Citation */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Citation</label>
                <textarea value={massForm.citation} onChange={e => setMassForm(f => ({ ...f, citation: e.target.value }))}
                  rows={2} placeholder="Optional"
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 resize-none" />
              </div>

              {/* Status */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Status</label>
                <div className="flex gap-2">
                  {['pending', 'issued'].map(s => (
                    <button key={s} onClick={() => setMassForm(f => ({ ...f, status: s }))}
                      className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors ${
                        massForm.status === s
                          ? s === 'issued'
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : 'bg-yellow-500 text-slate-950 border-yellow-500'
                          : 'border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <button
                onClick={handleMassAward}
                disabled={awarding || !selectedType || selectedCadets.size === 0}
                className="w-full py-3 rounded-2xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-950 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                {awarding ? <Loader2 size={14} className="animate-spin" /> : <Award size={14} />}
                {awarding
                  ? 'Awarding…'
                  : selectedCadets.size > 0
                    ? `Award to ${selectedCadets.size} Cadet${selectedCadets.size !== 1 ? 's' : ''}`
                    : 'Award Ribbon'
                }
              </button>

              <p className="text-[9px] text-slate-400 text-center">
                Awarded by: <span className="font-black">{userData?.fullName || 'You'}</span>
              </p>
            </div>
          </div>
        )}
      </>)}

      {/* ── Edit ribbon type modal ── */}
      {editingRibbon && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4">

            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-800 dark:text-white">Edit Ribbon Type</h2>
              <button onClick={() => setEditingRibbon(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                Ribbon Name <span className="text-red-500">*</span>
              </label>
              <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. JROTC Athletic Ribbon"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Code / Abbreviation</label>
              <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))}
                placeholder="e.g. N-2-3"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Category</label>
              <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40">
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Description</label>
              <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                rows={2} placeholder="Optional — criteria or notes"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 resize-none" />
            </div>

            <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
              <ListOrdered size={11} className="shrink-0" />
              Use <strong>Reorder</strong> in the catalog to set wear order.
            </p>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditingRibbon(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveEdit} disabled={editSaving || !editForm.name.trim()}
                className="flex-1 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
                {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create ribbon type modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4">

            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-800 dark:text-white">New Ribbon Type</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                Ribbon Name <span className="text-red-500">*</span>
              </label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. JROTC Athletic Ribbon"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Code / Abbreviation</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder="e.g. N-2-3"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40">
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2} placeholder="Optional — criteria or notes"
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 resize-none" />
            </div>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={saving || !form.name.trim()}
                className="flex-1 py-2.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRibbonRegistry;
