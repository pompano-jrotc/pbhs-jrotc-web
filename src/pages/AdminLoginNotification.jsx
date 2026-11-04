// src/pages/AdminLoginNotification.jsx
//
// S6 admin page to compose and publish login notifications.
// Notifications are stored in Firestore at settings/loginNotification
// and shown as a modal to all logged-in users once per notificationId.

import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Bell, Plus, Trash2, Eye, EyeOff, Send, CheckCircle2, Zap, Wrench, Shield, Info, ChevronUp, ChevronDown, X, PenLine, History } from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';

const SECTION_STYLES = {
  feat:      { icon: Zap,    text: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', dot: 'bg-yellow-500' },
  fix:       { icon: Wrench, text: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   dot: 'bg-blue-400'   },
  sec:       { icon: Shield, text: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    dot: 'bg-red-400'    },
  important: { icon: Shield, text: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20',    dot: 'bg-red-400'    },
  info:      { icon: Info,   text: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/20',  dot: 'bg-slate-400'  },
};

const SECTION_TYPE_OPTIONS = [
  { value: 'feat',      label: 'New',       description: 'Features & additions (yellow)' },
  { value: 'fix',       label: 'Fixed',     description: 'Bug fixes (blue)'              },
  { value: 'important', label: 'Important', description: 'Rules & warnings (red)'        },
  { value: 'sec',       label: 'Security',  description: 'Security notes (red)'          },
  { value: 'info',      label: 'Info',      description: 'General info (gray)'           },
];

// ── Version presets pulled from changelog ────────────────────────────────────
const VERSION_PRESETS = [
  {
    version: 'v1.8.8',
    date: 'Oct 11',
    releaseTitle: 'Battalion Leaderboard Public Access Fix',
    title: "What's New in v1.8.8",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'fix',
        label: 'Fixed',
        items: [
          'Battalion Leaderboard (/leaderboard) now loads for unauthenticated visitors — Firestore security rules no longer block public users; logged-in cadets still receive real-time updates',
        ],
      },
    ],
  },
  {
    version: 'v1.8.7',
    date: 'Oct 8',
    releaseTitle: 'Fix Infinite Page Reload on Login',
    title: "What's New in v1.8.7",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'fix',
        label: 'Fixed',
        items: [
          'Fixed infinite reload loop that affected specific accounts after a new deploy — the page now only attempts one reload per session, then stops rather than looping',
        ],
      },
    ],
  },
  {
    version: 'v1.8.6',
    date: 'Oct 8',
    releaseTitle: 'Leadership Calendar Live Subscription',
    title: "What's New in v1.8.6",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'feat',
        label: 'New',
        items: [
          'Leadership calendar is now a live auto-updating subscription — subscribe in Apple Calendar, Google Calendar, or Outlook; events sync automatically every 6 hours',
          'Subscribe modal on Leadership Calendar mirrors the public calendar\'s subscribe UX — one-tap Apple Calendar button, Google Calendar link, and a copyable URL for Outlook',
        ],
      },
      {
        type: 'fix',
        label: 'Fixed',
        items: [
          'Snapshot download still available as a fallback for cases where the subscription URL cannot be used',
        ],
      },
    ],
  },
  {
    version: 'v1.8.5',
    date: 'Oct 8',
    releaseTitle: 'Leadership Calendar Export & Blue/Gold Days',
    title: "What's New in v1.8.5",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'feat',
        label: 'New',
        items: [
          'Leadership Calendar now shows Blue/Gold day indicators (B/G) in each school-day cell — reads from the same settings as the public calendar',
          '"Today is a Blue/Gold Day" banner at the top of the leadership calendar on school days',
          'Export button on the Leadership Calendar toolbar — downloads a private .ics file with all events for import into iPhone, Google Calendar, or Outlook; private events are marked with a lock emoji',
        ],
      },
    ],
  },
  {
    version: 'v1.8.4',
    date: 'Oct 8',
    releaseTitle: 'Public Calendar Redesign & iCal Subscription',
    title: "What's New in v1.8.4",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'feat',
        label: 'New',
        items: [
          'Public Events calendar (/events) redesigned — full-width month grid with event title chips on each day cell, colour-coded by category',
          'Public calendar now includes a Subscribe button — one-tap "Add to Apple Calendar", "Add to Google Calendar", and a copyable URL for Outlook',
          'Monthly Agenda grid below the calendar — events shown in a responsive card grid with type badge, location, time, and description',
        ],
      },
    ],
  },
  {
    version: 'v1.8.3',
    date: 'Oct 8',
    releaseTitle: 'Footer on All Pages, Calendar View & Merged Event Creation',
    title: "What's New in v1.8.3",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'feat',
        label: 'New',
        items: [
          'Leadership Calendar (S3 sub-tab) rewritten as a proper month-grid calendar view — public and private events colour-coded; private events carry a lock icon',
          'Calendar Events (S3 sub-tab) now supports creating private events directly — a toggle marks an event as private, visible only to L45+',
          'Personnel Hub and Staff Shops now have distinct sidebar icons',
        ],
      },
      {
        type: 'fix',
        label: 'Fixed',
        items: [
          'Footer now appears on every admin page — moved into AdminLayout so no page can be missing it',
          'Login Notifications reworked — empty state now shows "Create from Scratch" and "Announce an Update" buttons',
          'Fundraiser sidebar link now correctly visible to all battalion staff L70+',
        ],
      },
    ],
  },
  {
    version: 'v1.8.2',
    date: 'Oct 8',
    releaseTitle: 'Collapsible Sidebar, Fundraiser Permissions & Staff Tab Labels',
    title: "What's New in v1.8.2",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'feat',
        label: 'New',
        items: [
          'Sidebar now collapses to icon-only mode on desktop — click the chevron to toggle; preference persists across reloads',
          'Leadership Calendar now accessible as a dedicated route from the sidebar — no longer buried inside Staff Shops → S3',
          'All battalion staff (L70+) can now view the cross-company fundraiser and log payments for any company',
          'Staff Shops tab labels renamed: S1 Personnel · S2 Intel · S3 Operations · S4 Supply · S5 Affairs · S6 Technology',
        ],
      },
      {
        type: 'fix',
        label: 'Fixed',
        items: [
          'Leadership Calendar now loads correctly — Firestore permission error resolved',
          'Fundraiser period open/close now restricted to S1, S3, and Top 3 only',
          'S6 Login Notification "Load Preset" crash fixed',
          '"Back to Dashboard" link removed from page headers — use the sidebar Dashboard icon instead',
        ],
      },
    ],
  },
  {
    version: 'v1.8.0',
    date: 'Oct 6',
    releaseTitle: 'Navigation Overhaul, Permissions, Leadership Calendar & Fundraiser',
    title: "What's New in v1.8",
    subtitle: 'PBHS Battalion Command Portal',
    buttonLabel: 'Got It — Continue to Dashboard',
    sections: [
      {
        type: 'feat',
        label: 'New',
        items: [
          'Staff Shops expanded — S3 includes Calendar Events & Honor Company; S1 includes Camp Attendance & Participation Tracker; S6 includes Battalion Stats',
          'Admin sidebar categories removed — navigation is now clean and flat',
          'Battalion Leaderboard is now public — visible to all visitors under the Battalion menu',
          'Private Leadership Calendar added in S3 — company leadership can view; battalion staff can create, edit, and delete events',
          'Participation Tracker — log cadets for events (swim meets, community service, etc.) with company breakdown',
          'Role-based tab visibility — each Staff Shops tab and sub-tab is shown or hidden based on your role level',
          'Zulu company renamed to Battalion across the entire portal',
        ],
      },
      {
        type: 'fix',
        label: 'Fixed',
        items: [
          'Home page Bulletins "Signed:" label now correctly shows the issuer\'s name',
          'Fundraiser: voided donations no longer count toward cadet totals on My Profile',
          'Sub-tab default selection now picks the first accessible tab for your role instead of always defaulting to the first slot',
        ],
      },
    ],
  },
];

const emptyForm = () => ({
  version: '',
  date: '',
  title: "What's New",
  subtitle: 'PBHS Battalion Command Portal',
  buttonLabel: 'Got It — Continue to Dashboard',
  sections: [{ type: 'feat', label: 'New', items: [''] }],
});

const emptySection = () => ({ type: 'feat', label: 'New', items: [''] });

const SectionTypeIcon = ({ type, size = 13 }) => {
  const style = SECTION_STYLES[type] || SECTION_STYLES.info;
  const Icon = style.icon;
  return <Icon size={size} className={style.text} />;
};

// ── Version picker modal ──────────────────────────────────────────────────────
const VersionPickerModal = ({ onSelect, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
    <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 dark:border-white/5">
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-tighter text-slate-900 dark:text-white flex items-center gap-2">
            <History size={16} className="text-yellow-500" /> Select Version to Announce
          </h2>
          <p className="text-[10px] text-slate-400 mt-0.5">Pick a release from version history — the form will be pre-filled</p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
          <X size={18} />
        </button>
      </div>
      <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
        {VERSION_PRESETS.map(preset => (
          <button
            key={preset.version}
            onClick={() => onSelect(preset)}
            className="w-full text-left p-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/3 hover:border-yellow-500/40 hover:bg-yellow-500/5 transition-all group"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-block bg-yellow-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded leading-none">
                  {preset.version}
                </span>
                <span className="text-[10px] text-slate-400">{preset.date}</span>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                Use this →
              </span>
            </div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">{preset.releaseTitle}</p>
            <div className="flex flex-wrap gap-1.5">
              {preset.sections.map((s, i) => {
                const style = SECTION_STYLES[s.type] || SECTION_STYLES.info;
                return (
                  <span key={i} className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
                    <SectionTypeIcon type={s.type} size={9} />
                    {s.items.length} {s.label}
                  </span>
                );
              })}
            </div>
          </button>
        ))}
      </div>
    </div>
  </div>
);

const AdminLoginNotification = ({ hideHeader = false }) => {
  const [live, setLive]                     = useState(null);
  const [liveLoading, setLiveLoading]       = useState(true);
  const [form, setForm]                     = useState(null);
  const [saving, setSaving]                 = useState(false);
  const [saved, setSaved]                   = useState(false);
  const [pickerOpen, setPickerOpen]         = useState(false);
  const formInitialized                     = useRef(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'loginNotification'),
      snap => {
        const data = snap.exists() ? snap.data() : null;
        setLive(data);
        setLiveLoading(false);
        if (data && !formInitialized.current) {
          formInitialized.current = true;
          setForm({
            version:     data.version     || '',
            date:        data.date        || '',
            title:       data.title       || "What's New",
            subtitle:    data.subtitle    || 'PBHS Battalion Command Portal',
            buttonLabel: data.buttonLabel || 'Got It — Continue to Dashboard',
            sections:    data.sections    ? JSON.parse(JSON.stringify(data.sections)) : [],
          });
        }
      },
      () => setLiveLoading(false)
    );
    return () => unsub();
  }, []);

  const loadPreset = (preset) => {
    formInitialized.current = true;
    setForm({ ...preset, sections: JSON.parse(JSON.stringify(preset.sections)) });
    setPickerOpen(false);
  };

  const loadLive = () => {
    if (!live) return;
    setForm({
      version:     live.version     || '',
      date:        live.date        || '',
      title:       live.title       || "What's New",
      subtitle:    live.subtitle    || 'PBHS Battalion Command Portal',
      buttonLabel: live.buttonLabel || 'Got It — Continue to Dashboard',
      sections:    live.sections    ? JSON.parse(JSON.stringify(live.sections)) : [],
    });
  };

  const startBlank = () => {
    formInitialized.current = true;
    setForm(emptyForm());
  };

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const addSection    = () => setForm(f => ({ ...f, sections: [...f.sections, emptySection()] }));
  const removeSection = (i) => setForm(f => ({ ...f, sections: f.sections.filter((_, idx) => idx !== i) }));
  const moveSection   = (i, dir) => setForm(f => {
    const s = [...f.sections];
    const j = i + dir;
    if (j < 0 || j >= s.length) return f;
    [s[i], s[j]] = [s[j], s[i]];
    return { ...f, sections: s };
  });
  const setSectionField = (i, key, val) => setForm(f => {
    const s = [...f.sections];
    s[i] = { ...s[i], [key]: val };
    if (key === 'type') {
      const opt = SECTION_TYPE_OPTIONS.find(o => o.value === val);
      if (opt) s[i].label = opt.label;
    }
    return { ...f, sections: s };
  });

  const addItem    = (si) => setForm(f => {
    const s = [...f.sections];
    s[si] = { ...s[si], items: [...(s[si].items || []), ''] };
    return { ...f, sections: s };
  });
  const removeItem = (si, ii) => setForm(f => {
    const s = [...f.sections];
    s[si] = { ...s[si], items: s[si].items.filter((_, idx) => idx !== ii) };
    return { ...f, sections: s };
  });
  const setItem    = (si, ii, val) => setForm(f => {
    const s = [...f.sections];
    const items = [...(s[si].items || [])];
    items[ii] = val;
    s[si] = { ...s[si], items };
    return { ...f, sections: s };
  });

  const handlePublish = async (enabled = true) => {
    if (!form) return;
    setSaving(true);
    try {
      const notificationId = `${form.version || 'notif'}_${Date.now()}`;
      await setDoc(doc(db, 'settings', 'loginNotification'), {
        enabled,
        notificationId,
        version:     form.version,
        date:        form.date,
        title:       form.title,
        subtitle:    form.subtitle,
        buttonLabel: form.buttonLabel,
        sections:    form.sections.map(s => ({
          type:  s.type,
          label: s.label,
          items: (s.items || []).filter(i => i.trim() !== ''),
        })),
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert('Error saving: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    if (!live) return;
    await setDoc(doc(db, 'settings', 'loginNotification'), { ...live, enabled: !live.enabled });
  };

  if (liveLoading) return <div className="py-10 text-center text-slate-400 text-sm">Loading…</div>;

  // ── Empty state — no form yet ──────────────────────────────────────────────
  if (!form) {
    return (
      <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={Bell} title="Login Notification" />}
        <div className="py-16 px-8 text-center border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl">
          <Bell className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={32} />
          <p className="font-black uppercase tracking-widest text-slate-500 text-sm mb-2">No notification active</p>
          <p className="text-xs text-slate-400 mb-8">Create a new notification or announce a recent portal update</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={startBlank}
              className="flex items-center gap-2 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-black uppercase text-xs tracking-widest px-6 py-3 rounded-xl transition-all border border-slate-200 dark:border-white/10"
            >
              <PenLine size={14} /> Create from Scratch
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black uppercase text-xs tracking-widest px-6 py-3 rounded-xl transition-all shadow-lg shadow-yellow-500/20"
            >
              <History size={14} /> Announce an Update
            </button>
          </div>
        </div>
        {pickerOpen && <VersionPickerModal onSelect={loadPreset} onClose={() => setPickerOpen(false)} />}
      </div>
    );
  }

  const isEnabled = live?.enabled ?? false;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && <AdminPageHeader icon={Bell} title="Login Notification" />}

      {/* Status bar */}
      <div className="flex items-center gap-3 mb-6 p-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/40 flex-wrap">
        <div className={`w-2 h-2 rounded-full shrink-0 ${isEnabled ? 'bg-emerald-400' : 'bg-slate-400'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-slate-800 dark:text-slate-200">
            {isEnabled ? `Active — ${live?.version || ''}` : 'Notification disabled'}
          </p>
          {live?.updatedAt && (
            <p className="text-[10px] text-slate-400 mt-0.5">Last published {new Date(live.updatedAt).toLocaleString()}</p>
          )}
        </div>
        {live && (
          <button
            onClick={handleToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              isEnabled
                ? 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-red-500'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
            }`}
          >
            {isEnabled ? <><EyeOff size={11} /> Hide</> : <><Eye size={11} /> Show</>}
          </button>
        )}
        {live && (
          <button onClick={loadLive} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors px-2">
            Reset
          </button>
        )}
        <button
          onClick={startBlank}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors px-2"
        >
          <PenLine size={11} /> New
        </button>
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-yellow-600 dark:text-yellow-500 hover:text-yellow-500 transition-colors px-2"
        >
          <History size={11} /> Use Update Preset
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Left: Editor ── */}
        <div className="space-y-5">
          {/* Meta fields */}
          <div className="rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/40 p-5 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">Header</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Version</label>
                <input
                  value={form.version}
                  onChange={e => setField('version', e.target.value)}
                  placeholder="v1.8.2"
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                />
              </div>
              <div>
                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Date</label>
                <input
                  value={form.date}
                  onChange={e => setField('date', e.target.value)}
                  placeholder="Oct 8"
                  className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Title</label>
              <input
                value={form.title}
                onChange={e => setField('title', e.target.value)}
                placeholder="What's New"
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-yellow-500"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Subtitle</label>
              <input
                value={form.subtitle}
                onChange={e => setField('subtitle', e.target.value)}
                placeholder="PBHS Battalion Command Portal"
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-yellow-500"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Button Label</label>
              <input
                value={form.buttonLabel}
                onChange={e => setField('buttonLabel', e.target.value)}
                placeholder="Got It — Continue to Dashboard"
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-yellow-500"
              />
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-3">
            {form.sections.map((section, si) => {
              const style = SECTION_STYLES[section.type] || SECTION_STYLES.info;
              return (
                <div key={si} className={`rounded-2xl border ${style.border} bg-white dark:bg-slate-900/40 overflow-hidden`}>
                  <div className={`flex items-center gap-3 px-4 py-3 ${style.bg}`}>
                    <SectionTypeIcon type={section.type} />
                    <select
                      value={section.type}
                      onChange={e => setSectionField(si, 'type', e.target.value)}
                      className="bg-transparent text-[10px] font-black uppercase tracking-widest focus:outline-none cursor-pointer"
                    >
                      {SECTION_TYPE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label} — {o.description}</option>
                      ))}
                    </select>
                    <div className="ml-auto flex items-center gap-1">
                      <button onClick={() => moveSection(si, -1)} disabled={si === 0} className="p-1 rounded hover:bg-black/10 disabled:opacity-30 transition-colors">
                        <ChevronUp size={12} />
                      </button>
                      <button onClick={() => moveSection(si, 1)} disabled={si === form.sections.length - 1} className="p-1 rounded hover:bg-black/10 disabled:opacity-30 transition-colors">
                        <ChevronDown size={12} />
                      </button>
                      <button onClick={() => removeSection(si)} className="p-1 rounded hover:bg-red-500/20 text-red-400 transition-colors ml-1">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    <div>
                      <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Section Label</label>
                      <input
                        value={section.label}
                        onChange={e => setSectionField(si, 'label', e.target.value)}
                        className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-yellow-500"
                      />
                    </div>

                    <div className="space-y-2">
                      {(section.items || []).map((item, ii) => (
                        <div key={ii} className="flex gap-2 items-start">
                          <textarea
                            value={item}
                            onChange={e => setItem(si, ii, e.target.value)}
                            rows={2}
                            placeholder="Bullet point text…"
                            className="flex-1 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-yellow-500 resize-none leading-relaxed"
                          />
                          <button onClick={() => removeItem(si, ii)} className="mt-1 p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors shrink-0">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addItem(si)}
                        className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors py-1"
                      >
                        <Plus size={11} /> Add Bullet
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <button
              onClick={addSection}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-white/20 transition-colors"
            >
              <Plus size={13} /> Add Section
            </button>
          </div>

          {/* Publish */}
          <button
            onClick={() => handlePublish(true)}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-slate-950 font-black uppercase text-xs tracking-widest py-3.5 rounded-xl transition-all shadow-lg shadow-yellow-500/20"
          >
            {saved ? <><CheckCircle2 size={14} /> Published!</> : saving ? 'Saving…' : <><Send size={14} /> Publish &amp; Show on Next Login</>}
          </button>
          <p className="text-center text-[10px] text-slate-400 -mt-2">
            Publishing gives every user a fresh notification — even if they dismissed a previous one with the same version.
          </p>
        </div>

        {/* ── Right: Live Preview ── */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3 px-1">Preview</p>
          <div className="relative bg-slate-900 rounded-3xl border border-white/10 shadow-2xl overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-yellow-500/70 to-transparent" />

            <div className="flex items-start justify-between px-6 pt-6 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  {form.version && (
                    <span className="inline-flex items-center text-[9px] font-black uppercase tracking-[0.3em] text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                      {form.version}
                    </span>
                  )}
                  {form.date && (
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">{form.date}</span>
                  )}
                </div>
                <h2 className="text-[1.4rem] font-black uppercase italic tracking-tighter text-white leading-none">
                  {form.title || "What's New"}
                </h2>
                <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mt-1">
                  {form.subtitle || 'PBHS Battalion Command Portal'}
                </p>
              </div>
              <div className="p-2 rounded-xl text-slate-700">
                <X size={15} />
              </div>
            </div>

            <div className="px-6 pb-2 space-y-3 max-h-[380px] overflow-y-auto">
              {form.sections.map((section, idx) => {
                const style = SECTION_STYLES[section.type] || SECTION_STYLES.info;
                const Icon = style.icon;
                const validItems = (section.items || []).filter(i => i.trim());
                if (validItems.length === 0) return null;
                return (
                  <div key={idx} className={`rounded-2xl border ${style.border} ${style.bg} p-4`}>
                    <div className={`flex items-center gap-2 mb-3 ${style.text}`}>
                      <Icon size={12} strokeWidth={2.5} />
                      <span className="text-[9px] font-black uppercase tracking-[0.3em]">{section.label || 'Section'}</span>
                    </div>
                    <ul className="space-y-2">
                      {validItems.map((item, i) => (
                        <li key={i} className="flex gap-2.5 text-[11px] text-slate-300 leading-relaxed font-medium">
                          <span className={`mt-[7px] w-1 h-1 rounded-full shrink-0 ${style.dot}`} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <div className="px-6 pt-4 pb-6">
              <div className="w-full bg-yellow-500 text-slate-950 font-black uppercase text-[11px] tracking-widest py-3.5 rounded-xl text-center">
                {form.buttonLabel || 'Got It — Continue to Dashboard'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen && <VersionPickerModal onSelect={loadPreset} onClose={() => setPickerOpen(false)} />}
    </div>
  );
};

export default AdminLoginNotification;
