// src/pages/MyLeadership.jsx
// Full battalion chain of command — authenticated portal members only.
// Pulls every roster entry and organises them top-down:
//   Battalion Command → Battalion Staff → per-Company sections
//   (Company HQ → Staff Assistants → per-Platoon → per-Squad)

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { Shield, ChevronDown, ChevronRight, Users } from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { usePageMeta } from '../hooks/usePageMeta';
import { JROTC_RANKS } from '../constants';

// ── Position tier ordering ────────────────────────────────────────────────────
const POSITION_ORDER = [
  'Battalion Commander', 'Battalion XO', 'Battalion Deputy Commander',
  'Battalion CSM', 'Sergeant Major',
  'Battalion Staff (S-1)', 'Battalion Staff (S-2)', 'Battalion Staff (S-3)',
  'Battalion Staff (S-4)', 'Battalion Staff (S-5)', 'Battalion Staff (S-6)',
  'Battalion Staff (S-7)',
  'Company Commander', 'Company XO', 'First Sergeant', 'Master Sergeant',
  'Company S1 Assistant', 'Company S2 Assistant', 'Company S3 Assistant',
  'Company S4 Assistant', 'Company S5 Assistant', 'Company S6 Assistant',
  'Company S7 Assistant',
  'Platoon Leader', 'Platoon Sergeant',
  'Squad Leader', 'Squad Leader Assistant',
  'Squad Member', 'Cadet',
];
const posOrd = (p) => { const i = POSITION_ORDER.indexOf(p); return i < 0 ? 99 : i; };
const rankOrd = (r) => { const i = JROTC_RANKS.indexOf(r); return i < 0 ? -1 : i; };

const BATTALION_COMPANIES = new Set(['Battalion', 'Zulu', 'HQ', '']);

const COMPANY_ORDER = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

const BN_POSITIONS = new Set([
  'Battalion Commander', 'Battalion XO', 'Battalion Deputy Commander',
  'Battalion CSM', 'Sergeant Major',
  'Battalion Staff (S-1)', 'Battalion Staff (S-2)', 'Battalion Staff (S-3)',
  'Battalion Staff (S-4)', 'Battalion Staff (S-5)', 'Battalion Staff (S-6)',
  'Battalion Staff (S-7)',
]);

const COMPANY_HQ_POSITIONS = new Set([
  'Company Commander', 'Company XO', 'First Sergeant', 'Master Sergeant',
  'Company S1 Assistant', 'Company S2 Assistant', 'Company S3 Assistant',
  'Company S4 Assistant', 'Company S5 Assistant', 'Company S6 Assistant',
  'Company S7 Assistant',
]);

// ── Colour scheme per battalion tier ─────────────────────────────────────────
const TIER_STYLE = {
  bn_command: 'border-yellow-500/40 bg-yellow-500/5',
  bn_staff:   'border-yellow-500/20 bg-yellow-500/3',
  co_hq:      'border-blue-500/30 bg-blue-500/5',
  co_staff:   'border-blue-500/15 bg-blue-500/3',
  platoon:    'border-slate-300/20 bg-white/3 dark:bg-white/2',
  squad:      'border-slate-200/10 bg-transparent',
};
const tierOf = (pos) => {
  if (!pos) return 'squad';
  if (['Battalion Commander','Battalion XO','Battalion Deputy Commander','Battalion CSM','Sergeant Major'].includes(pos)) return 'bn_command';
  if (pos.startsWith('Battalion Staff')) return 'bn_staff';
  if (['Company Commander','Company XO','First Sergeant','Master Sergeant'].includes(pos)) return 'co_hq';
  if (pos.includes('Assistant')) return 'co_staff';
  if (['Platoon Leader','Platoon Sergeant'].includes(pos)) return 'platoon';
  return 'squad';
};

// ── CadetRow ──────────────────────────────────────────────────────────────────
const CadetRow = ({ entry }) => {
  const tier = tierOf(entry.position);
  const style = TIER_STYLE[tier];
  const isBnCommand = tier === 'bn_command';
  const isCoHQ = tier === 'co_hq';
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${style} transition-colors`}>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`text-xs font-black truncate ${isBnCommand ? 'text-yellow-400' : isCoHQ ? 'text-blue-400' : 'text-slate-200 dark:text-slate-200'}`}>
          {entry.fullName || '—'}
        </span>
        <span className="text-[10px] text-slate-400 truncate">
          {[entry.rank, entry.position].filter(Boolean).join(' · ')}
          {entry.secondaryPosition ? ` · ${entry.secondaryPosition}` : ''}
        </span>
      </div>
      {entry.letLevel && (
        <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded-md">
          {entry.letLevel}
        </span>
      )}
    </div>
  );
};

// ── CollapsibleSection ────────────────────────────────────────────────────────
const Section = ({ title, accent, count, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 py-1.5 text-left group"
      >
        {open
          ? <ChevronDown size={12} className="shrink-0 text-slate-500" />
          : <ChevronRight size={12} className="shrink-0 text-slate-500" />}
        <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${accent || 'text-slate-400'}`}>
          {title}
        </span>
        <span className="text-[9px] font-bold text-slate-600 ml-1">({count})</span>
      </button>
      {open && <div className="space-y-1 ml-3">{children}</div>}
    </div>
  );
};

// ── CompanyBlock ──────────────────────────────────────────────────────────────
const CompanyBlock = ({ company, entries }) => {
  const [open, setOpen] = useState(true);

  const hq = entries.filter(e => COMPANY_HQ_POSITIONS.has(e.position))
    .sort((a, b) => posOrd(a.position) - posOrd(b.position));

  // Group the rest by platoon, then by squad within platoon
  const byPlatoon = {};
  entries
    .filter(e => !COMPANY_HQ_POSITIONS.has(e.position))
    .forEach(e => {
      const pl = e.platoon || 'Unassigned';
      if (!byPlatoon[pl]) byPlatoon[pl] = {};
      const sq = e.squad || 'Unassigned';
      if (!byPlatoon[pl][sq]) byPlatoon[pl][sq] = [];
      byPlatoon[pl][sq].push(e);
    });

  const platoons = Object.keys(byPlatoon).sort((a, b) => {
    if (a === 'Company HQ') return -1;
    if (b === 'Company HQ') return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 mb-3 text-left"
      >
        <span className="text-sm font-black uppercase tracking-widest text-white">
          {company} Company
        </span>
        <span className="text-[10px] font-bold text-slate-500">({entries.length})</span>
        <span className="ml-auto">
          {open
            ? <ChevronDown size={14} className="text-slate-500" />
            : <ChevronRight size={14} className="text-slate-500" />}
        </span>
      </button>

      {open && (
        <div className="space-y-3 pl-2 border-l-2 border-slate-700/50">
          {/* Company HQ */}
          {hq.length > 0 && (
            <Section title="Company HQ" accent="text-blue-400" count={hq.length}>
              {hq.map(e => <CadetRow key={e.id} entry={e} />)}
            </Section>
          )}

          {/* Platoons */}
          {platoons.map(pl => {
            const squads = byPlatoon[pl];
            const squadKeys = Object.keys(squads).sort((a, b) => {
              if (a === 'Unassigned') return 1;
              if (b === 'Unassigned') return -1;
              return a.localeCompare(b, undefined, { numeric: true });
            });
            const platoonTotal = Object.values(squads).flat().length;
            return (
              <Section key={pl} title={pl} accent="text-slate-300" count={platoonTotal} defaultOpen={false}>
                {squadKeys.map(sq => {
                  const members = squads[sq].sort((a, b) => {
                    const po = posOrd(a.position) - posOrd(b.position);
                    if (po !== 0) return po;
                    return rankOrd(b.rank) - rankOrd(a.rank);
                  });
                  return (
                    <Section key={sq} title={sq} accent="text-slate-500" count={members.length} defaultOpen={false}>
                      {members.map(e => <CadetRow key={e.id} entry={e} />)}
                    </Section>
                  );
                })}
              </Section>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MyLeadership() {
  const { user, loading: authLoading } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  usePageMeta({
    title: 'Chain of Command',
    description: 'Full battalion chain of command — every position and unit.',
    path: '/admin/my/leadership',
  });

  useEffect(() => {
    if (authLoading || !user) return;
    const q = query(collection(db, 'roster'), orderBy('fullName', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingData(false);
    }, () => setLoadingData(false));
    return () => unsub();
  }, [authLoading, user]);

  const { bnCommand, bnStaff, byCompany } = useMemo(() => {
    const bnCommand = [], bnStaff = [], byCompany = {};

    for (const e of entries) {
      const co = e.company || '';
      if (BATTALION_COMPANIES.has(co)) {
        if (BN_POSITIONS.has(e.position)) {
          if (['Battalion Commander','Battalion XO','Battalion Deputy Commander','Battalion CSM','Sergeant Major'].includes(e.position)) {
            bnCommand.push(e);
          } else {
            bnStaff.push(e);
          }
        }
        // Battalion cadets with no leadership position aren't shown in a company block
      } else {
        const key = co || 'Unknown';
        if (!byCompany[key]) byCompany[key] = [];
        byCompany[key].push(e);
      }
    }

    bnCommand.sort((a, b) => posOrd(a.position) - posOrd(b.position) || rankOrd(b.rank) - rankOrd(a.rank));
    bnStaff.sort((a, b) => posOrd(a.position) - posOrd(b.position));

    return { bnCommand, bnStaff, byCompany };
  }, [entries]);

  const companies = [
    ...COMPANY_ORDER.filter(c => byCompany[c]),
    ...Object.keys(byCompany).filter(c => !COMPANY_ORDER.includes(c)).sort(),
  ];

  if (authLoading || loadingData) {
    return (
      <div className="flex justify-center items-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-yellow-500" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <AdminPageHeader
        title="Chain of Command"
        subtitle={`Full battalion hierarchy — ${entries.length} roster entries`}
        icon={Shield}
      />

      {/* Battalion Command */}
      {bnCommand.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-yellow-500 mb-3 flex items-center gap-2">
            <Shield size={11} /> Battalion Command
          </p>
          <div className="space-y-1.5">
            {bnCommand.map(e => <CadetRow key={e.id} entry={e} />)}
          </div>
        </div>
      )}

      {/* Battalion Staff */}
      {bnStaff.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-yellow-500/70 mb-3 flex items-center gap-2">
            <Users size={11} /> Battalion Staff
          </p>
          <div className="space-y-1.5">
            {bnStaff.map(e => <CadetRow key={e.id} entry={e} />)}
          </div>
        </div>
      )}

      {/* Companies */}
      {companies.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-5 flex items-center gap-2">
            <Users size={11} /> Companies
          </p>
          {companies.map(co => (
            <CompanyBlock key={co} company={co} entries={byCompany[co]} />
          ))}
        </div>
      )}

      {entries.length === 0 && (
        <div className="text-center py-16 space-y-2">
          <Shield size={32} className="mx-auto text-slate-300 dark:text-slate-700" />
          <p className="text-sm font-bold text-slate-500">No roster entries found.</p>
        </div>
      )}
    </div>
  );
}
