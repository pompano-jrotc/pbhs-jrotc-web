// src/pages/AdminAwardsRegistry.jsx
//
// Awards Registry — Arcs, Medals, and Cords.
// Same Catalog + Mass Award + Reorder pattern as AdminRibbonRegistry.
// Three item types share this page via a type selector; each has its own
// Firestore collection (arcTypes / medalTypes / cordTypes) and awards
// collection (arcAwards / medalAwards / cordAwards).

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  serverTimestamp, query, orderBy, getDocs, where, writeBatch, updateDoc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import {
  Plus, Trash2, Pencil, X, Loader2, AlertTriangle, Users, CheckSquare, Square,
  GripVertical, ListOrdered, Check, Circle, Medal, Star, Gem,
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

// ── Item type definitions ──────────────────────────────────────────────────────
const ITEM_TYPES = {
  arc: {
    label:        'Arc',
    plural:       'Arcs',
    Icon:         Circle,
    color:        'text-sky-500',
    accentBg:     'bg-sky-500/10',
    accentBorder: 'border-sky-500/20',
    collection:   'arcTypes',
    awards:       'arcAwards',
    itemLabel:    'Arc Type',
  },
  medal: {
    label:        'Medal',
    plural:       'Medals',
    Icon:         Medal,
    color:        'text-amber-500',
    accentBg:     'bg-amber-500/10',
    accentBorder: 'border-amber-500/20',
    collection:   'medalTypes',
    awards:       'medalAwards',
    itemLabel:    'Medal Type',
  },
  cord: {
    label:        'Cord',
    plural:       'Cords',
    Icon:         Gem,
    color:        'text-violet-400',
    accentBg:     'bg-violet-500/10',
    accentBorder: 'border-violet-500/20',
    collection:   'cordTypes',
    awards:       'cordAwards',
    itemLabel:    'Cord Type',
  },
};

// ── Category options shared across all three types ─────────────────────────────
const CATEGORY_OPTIONS = [
  { value: '',            label: 'Uncategorized' },
  { value: 'achievement', label: 'Achievement'   },
  { value: 'academic',    label: 'Academic'      },
  { value: 'military',    label: 'Military'      },
  { value: 'service',     label: 'Service'       },
  { value: 'physical',    label: 'Physical'      },
  { value: 'leadership',  label: 'Leadership'    },
];

const CAT_CHIP = {
  achievement: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  academic:    'bg-blue-500/10  text-blue-600  dark:text-blue-400  border-blue-500/20',
  military:    'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
  service:     'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  physical:    'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
  leadership:  'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
};

const BLANK = { name: '', code: '', description: '', category: '' };

// ── Standard items for each type ───────────────────────────────────────────────
const STANDARD_ITEMS = {
  arc: [
    { name: 'Achievement Arc',           code: '', category: 'achievement' },
    { name: 'Academic Arc',              code: '', category: 'academic'    },
    { name: 'Drill Team Arc',            code: '', category: 'military'    },
    { name: 'Raider Team Arc',           code: '', category: 'military'    },
    { name: 'Rifle Team Arc',            code: '', category: 'military'    },
    { name: 'Color Guard Arc',           code: '', category: 'military'    },
    { name: 'Honor Guard Arc',           code: '', category: 'military'    },
    { name: 'Service Arc',               code: '', category: 'service'     },
    { name: 'Leadership Arc',            code: '', category: 'leadership'  },
    { name: 'Athletic Arc',              code: '', category: 'physical'    },
  ],
  medal: [
    { name: 'DAI Medal',                                 code: '', category: 'achievement' },
    { name: 'JROTC Outstanding Cadet Medal',             code: '', category: 'achievement' },
    { name: 'Army Achievement Medal (JROTC)',            code: '', category: 'achievement' },
    { name: 'Academic Excellence Medal',                 code: '', category: 'academic'    },
    { name: 'Distinguished Cadet Medal',                 code: '', category: 'achievement' },
    { name: 'Physical Fitness Medal',                    code: '', category: 'physical'    },
    { name: 'Drill Excellence Medal',                    code: '', category: 'military'    },
    { name: 'Community Service Medal',                   code: '', category: 'service'     },
    { name: 'Leadership Excellence Medal',               code: '', category: 'leadership'  },
    { name: 'Cadet of the Year Medal',                   code: '', category: 'achievement' },
  ],
  cord: [
    { name: 'Gold Cord',                 code: '', category: 'achievement' },
    { name: 'Silver Cord',               code: '', category: 'achievement' },
    { name: 'Blue Cord',                 code: '', category: 'military'    },
    { name: 'Red Cord',                  code: '', category: 'leadership'  },
    { name: 'White Cord',                code: '', category: 'academic'    },
    { name: 'Green Cord',                code: '', category: 'service'     },
    { name: 'Purple Cord',               code: '', category: 'leadership'  },
    { name: 'Black Cord',                code: '', category: 'military'    },
    { name: 'Maroon Cord',               code: '', category: 'achievement' },
    { name: 'Orange Cord',               code: '', category: 'physical'    },
  ],
};

// ── Drag-and-drop sortable row ─────────────────────────────────────────────────
const SortableRow = ({ item }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
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
        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{item.name}</p>
        {item.code && <p className="text-[10px] font-mono text-slate-400">{item.code}</p>}
      </div>
      {item.category && (
        <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${CAT_CHIP[item.category] || 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'}`}>
          {item.category}
        </span>
      )}
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const AdminAwardsRegistry = ({ hideHeader = false }) => {
  const { user, role, userData, authLoading } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const canView   = userLevel >= COMMAND_LEVEL;
  const canManage = userLevel >= STAFF_LEVEL;
  const canDelete = userLevel >= ADMIN_LEVEL;

  usePageMeta({
    title: 'Awards Registry',
    description: 'Manage arcs, medals, and cords.',
    path: '/admin/awards',
  });

  // ── Item type ──────────────────────────────────────────────────────────────
  const [itemType,    setItemType]    = useState('arc'); // 'arc' | 'medal' | 'cord'
  const cfg = ITEM_TYPES[itemType];

  // ── Sub-tab ────────────────────────────────────────────────────────────────
  const [subTab, setSubTab] = useState('catalog'); // 'catalog' | 'mass'

  // ── Catalog state ──────────────────────────────────────────────────────────
  const [items,         setItems]         = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [showModal,     setShowModal]     = useState(false);
  const [form,          setForm]          = useState(BLANK);
  const [saving,        setSaving]        = useState(false);
  const [importing,     setImporting]     = useState(false);
  const [toast,         setToast]         = useState(null);
  const [editingItem,   setEditingItem]   = useState(null);
  const [editForm,      setEditForm]      = useState(BLANK);
  const [editSaving,    setEditSaving]    = useState(false);
  const [reordering,    setReordering]    = useState(false);
  const [reorderList,   setReorderList]   = useState([]);
  const [reorderSaving, setReorderSaving] = useState(false);

  // ── Mass award state ───────────────────────────────────────────────────────
  const [roster,         setRoster]         = useState([]);
  const [rosterLoading,  setRosterLoading]  = useState(false);
  const [companyFilter,  setCompanyFilter]  = useState('All');
  const [selectedType,   setSelectedType]   = useState('');
  const [selectedCadets, setSelectedCadets] = useState(new Set());
  const [massForm,       setMassForm]       = useState({ awardedDate: '', cycleNumber: '', citation: '', recommendedBy: '', status: 'pending' });
  const [awarding,       setAwarding]       = useState(false);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Reset list + selection when item type changes
  useEffect(() => {
    setItems([]);
    setLoading(true);
    setReordering(false);
    setReorderList([]);
    setSelectedType('');
    setSelectedCadets(new Set());
    setSubTab('catalog');
  }, [itemType]);

  // ── Live items ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canView || authLoading) return;
    const q = query(collection(db, cfg.collection), orderBy('createdAt', 'asc'));
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
  }, [canView, authLoading, cfg.collection]);

  // ── Roster for mass award ──────────────────────────────────────────────────
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

  // ── Filtered roster ────────────────────────────────────────────────────────
  const filteredRoster = useMemo(() => {
    const active = roster.filter(c => c.status !== 'alumni' && c.status !== 'inactive');
    if (companyFilter === 'All') return active;
    return active.filter(c => c.company === companyFilter);
  }, [roster, companyFilter]);

  const companies = useMemo(() => {
    const set = new Set(roster.filter(c => c.company).map(c => c.company));
    return ['All', ...Array.from(set).sort()];
  }, [roster]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const pa = a.precedence ?? 99999;
      const pb = b.precedence ?? 99999;
      if (pa !== pb) return pa - pb;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [items]);

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!form.name.trim()) { showToast(`${cfg.label} name is required`, 'err'); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, cfg.collection), {
        name:          form.name.trim(),
        code:          form.code.trim(),
        description:   form.description.trim(),
        category:      form.category,
        precedence:    null,
        createdAt:     serverTimestamp(),
        createdByUid:  user?.uid || '',
        createdByName: userData?.fullName || '',
      });
      showToast(`${cfg.label} type created`);
      setForm(BLANK);
      setShowModal(false);
    } catch {
      showToast('Save failed — try again', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?\n\nExisting awards of this type will remain but will show a missing type.`)) return;
    try {
      await deleteDoc(doc(db, cfg.collection, id));
      showToast(`${cfg.label} type deleted`);
    } catch {
      showToast('Delete failed', 'err');
    }
  };

  const openEdit = item => {
    setEditForm({ name: item.name || '', code: item.code || '', description: item.description || '', category: item.category || '' });
    setEditingItem(item);
  };

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { showToast(`${cfg.label} name is required`, 'err'); return; }
    setEditSaving(true);
    try {
      await updateDoc(doc(db, cfg.collection, editingItem.id), {
        name:        editForm.name.trim(),
        code:        editForm.code.trim(),
        description: editForm.description.trim(),
        category:    editForm.category,
      });
      showToast(`${cfg.label} updated`);
      setEditingItem(null);
    } catch {
      showToast('Update failed — try again', 'err');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Import standard items ──────────────────────────────────────────────────
  const handleImportStandard = async () => {
    const standards = STANDARD_ITEMS[itemType];
    if (!window.confirm(`Import ${standards.length} standard ${cfg.plural.toLowerCase()}?\n\nItems already in the catalog (matched by name) will be skipped.`)) return;
    setImporting(true);
    try {
      const existingSnap = await getDocs(collection(db, cfg.collection));
      const existingNames = new Set(existingSnap.docs.map(d => (d.data().name || '').toLowerCase()));
      const toAdd = standards.filter(r => !existingNames.has(r.name.toLowerCase()));
      if (toAdd.length === 0) { showToast(`All standard ${cfg.plural.toLowerCase()} are already in the catalog`); return; }
      const batch = writeBatch(db);
      toAdd.forEach((r, idx) => {
        batch.set(doc(collection(db, cfg.collection)), {
          name:          r.name,
          code:          r.code,
          description:   '',
          category:      r.category,
          precedence:    idx + 1,
          createdAt:     serverTimestamp(),
          createdByUid:  user?.uid || '',
          createdByName: userData?.fullName || 'System Import',
        });
      });
      await batch.commit();
      showToast(`Imported ${toAdd.length} ${toAdd.length !== 1 ? cfg.plural.toLowerCase() : cfg.label.toLowerCase()}`);
    } catch (err) {
      console.error('Import error:', err);
      showToast('Import failed — try again', 'err');
    } finally {
      setImporting(false);
    }
  };

  // ── Mass award ─────────────────────────────────────────────────────────────
  const handleMassAward = async () => {
    if (!selectedType) { showToast(`Select a ${cfg.label.toLowerCase()} type first`, 'err'); return; }
    if (selectedCadets.size === 0) { showToast('Select at least one cadet', 'err'); return; }
    const it = items.find(r => r.id === selectedType);
    if (!it) return;
    if (!window.confirm(`Award "${it.name}" to ${selectedCadets.size} cadet${selectedCadets.size !== 1 ? 's' : ''}?`)) return;
    setAwarding(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();
      Array.from(selectedCadets).forEach(rosterDocId => {
        batch.set(doc(collection(db, cfg.awards)), {
          rosterDocId,
          itemTypeId:    it.id,
          itemName:      it.name,
          itemCode:      it.code || '',
          itemType:      itemType,
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
      showToast(`Awarded "${it.name}" to ${selectedCadets.size} cadet${selectedCadets.size !== 1 ? 's' : ''}`);
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
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const toggleAll = () => {
    if (selectedCadets.size === filteredRoster.length && filteredRoster.length > 0) setSelectedCadets(new Set());
    else setSelectedCadets(new Set(filteredRoster.map(c => c.id)));
  };

  // ── Reorder ────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const enterReorder  = () => { setReorderList([...sortedItems]); setReordering(true); };
  const cancelReorder = () => { setReordering(false); setReorderList([]); };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setReorderList(list => {
      const oldIdx = list.findIndex(i => i.id === active.id);
      const newIdx = list.findIndex(i => i.id === over.id);
      return arrayMove(list, oldIdx, newIdx);
    });
  };

  const saveReorder = async () => {
    setReorderSaving(true);
    try {
      const CHUNK = 499;
      for (let i = 0; i < reorderList.length; i += CHUNK) {
        const batch = writeBatch(db);
        reorderList.slice(i, i + CHUNK).forEach((it, j) => {
          batch.update(doc(db, cfg.collection, it.id), { precedence: i + j + 1 });
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

  // ── Access guard ───────────────────────────────────────────────────────────
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
          icon={Star}
          title="Awards Registry"
          meta="Manage arcs, medals, and cords."
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

      {/* ── Item type selector ── */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {Object.entries(ITEM_TYPES).map(([key, t]) => (
          <button
            key={key}
            onClick={() => setItemType(key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              itemType === key
                ? 'bg-yellow-500 text-slate-950 shadow-md shadow-yellow-500/20'
                : 'bg-white dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-white/5 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
          >
            <t.Icon size={13} />
            {t.plural}
          </button>
        ))}
      </div>

      {/* ── Sub-tab bar ── */}
      <div className="flex gap-1 mb-6 bg-blue-50/70 dark:bg-slate-800/50 rounded-2xl p-1 max-w-xs">
        {[
          { key: 'catalog', label: 'Catalog',    Icon: cfg.Icon },
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
            {items.length} type{items.length !== 1 ? 's' : ''} in catalog
          </p>
          {canManage && !reordering && (
            <div className="flex items-center gap-2 flex-wrap">
              {items.length > 1 && (
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
                {importing ? <Loader2 size={13} className="animate-spin" /> : <cfg.Icon size={13} />}
                {importing ? 'Importing…' : `Import Standard ${cfg.plural}`}
              </button>
              <button
                onClick={() => { setForm(BLANK); setShowModal(true); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shadow-sm shadow-yellow-500/20"
              >
                <Plus size={13} /> New {cfg.label} Type
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

        {/* Reorder mode */}
        {reordering && (
          <>
            <p className="text-[10px] text-slate-400 mb-3">
              Drag {cfg.plural.toLowerCase()} into wear order — most prestigious first. Click <strong>Save Order</strong> when done.
            </p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={reorderList.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {reorderList.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <span className="w-6 text-right text-[10px] font-black text-slate-300 dark:text-slate-600 shrink-0">{idx + 1}</span>
                      <div className="flex-1"><SortableRow item={item} /></div>
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}

        {/* Normal catalog grid */}
        {!reordering && (
          loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-yellow-500" size={32} />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
              <cfg.Icon className={`mx-auto mb-4 ${cfg.color}`} size={36} />
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">No {cfg.plural.toLowerCase()} yet</p>
              {canManage && <p className="text-xs text-slate-400 mt-2">Click "New {cfg.label} Type" to add the first one.</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedItems.map(item => (
                <div key={item.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-black text-slate-800 dark:text-white leading-snug">{item.name}</p>
                      {item.code && <p className="text-[10px] font-mono text-slate-400 mt-0.5">{item.code}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canManage && (
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-yellow-500 hover:bg-yellow-500/10 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(item.id, item.name)}
                          className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {item.description && <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{item.description}</p>}
                  <div className="flex items-center gap-2 flex-wrap">
                    {item.precedence != null && (
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.accentBg} ${cfg.color} ${cfg.accentBorder}`}>
                        #{item.precedence}
                      </span>
                    )}
                    {item.category && (
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${CAT_CHIP[item.category] || 'bg-slate-100 dark:bg-white/5 text-slate-500 border-slate-200 dark:border-white/10'}`}>
                        {item.category}
                      </span>
                    )}
                    {item.createdByName && <span className="text-[9px] text-slate-400">Added by {item.createdByName}</span>}
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
                  {selectedCadets.size > 0 && <span className="ml-2 text-yellow-500">{selectedCadets.size} selected</span>}
                </p>
                <select
                  value={companyFilter}
                  onChange={e => { setCompanyFilter(e.target.value); setSelectedCadets(new Set()); }}
                  className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 font-bold focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                >
                  {companies.map(c => <option key={c} value={c}>{c === 'All' ? 'All Companies' : `${c} Co.`}</option>)}
                </select>
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors"
                >
                  {selectedCadets.size === filteredRoster.length && filteredRoster.length > 0
                    ? <CheckSquare size={13} /> : <Square size={13} />}
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
                    .map(cadet => {
                      const checked = selectedCadets.has(cadet.id);
                      return (
                        <button
                          key={cadet.id}
                          onClick={() => toggleCadet(cadet.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-100 dark:border-white/5 last:border-0 ${
                            checked ? 'bg-yellow-500/5 dark:bg-yellow-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                          }`}
                        >
                          <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                            checked ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-white/20'
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

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                  {cfg.label} Type <span className="text-red-500">*</span>
                </label>
                {items.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No {cfg.plural.toLowerCase()} in catalog yet. Add them in the Catalog tab.</p>
                ) : (
                  <select
                    value={selectedType}
                    onChange={e => setSelectedType(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
                  >
                    <option value="">— Select type —</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>{it.name}{it.code ? ` (${it.code})` : ''}</option>
                    ))}
                  </select>
                )}
              </div>

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

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Recommended By</label>
                <input value={massForm.recommendedBy} onChange={e => setMassForm(f => ({ ...f, recommendedBy: e.target.value }))}
                  placeholder="Optional"
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Citation</label>
                <textarea value={massForm.citation} onChange={e => setMassForm(f => ({ ...f, citation: e.target.value }))}
                  rows={2} placeholder="Optional"
                  className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40 resize-none" />
              </div>

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

              <button
                onClick={handleMassAward}
                disabled={awarding || !selectedType || selectedCadets.size === 0}
                className="w-full py-3 rounded-2xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-950 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
              >
                {awarding ? <Loader2 size={14} className="animate-spin" /> : <cfg.Icon size={14} />}
                {awarding
                  ? 'Awarding…'
                  : selectedCadets.size > 0
                    ? `Award to ${selectedCadets.size} Cadet${selectedCadets.size !== 1 ? 's' : ''}`
                    : `Award ${cfg.label}`
                }
              </button>

              <p className="text-[9px] text-slate-400 text-center">
                Awarded by: <span className="font-black">{userData?.fullName || 'You'}</span>
              </p>
            </div>
          </div>
        )}
      </>)}

      {/* ── Edit modal ── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-800 dark:text-white">Edit {cfg.label} Type</h2>
              <button onClick={() => setEditingItem(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                {cfg.label} Name <span className="text-red-500">*</span>
              </label>
              <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Code / Abbreviation</label>
              <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value }))}
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
              <button onClick={() => setEditingItem(null)}
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

      {/* ── Create modal ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-800 dark:text-white">New {cfg.label} Type</h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">
                {cfg.label} Name <span className="text-red-500">*</span>
              </label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={`e.g. Gold ${cfg.label}`}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500/40" />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Code / Abbreviation</label>
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder="Optional"
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

export default AdminAwardsRegistry;
