// src/components/S1PromotionBoard.jsx
//
// Promotion Board tab within the S1 Tracker page.
//
// WHO CAN DO WHAT
//   Create board : s1_adjutant + ADMIN_LEVEL (80+)
//   Enter scores : company_xo (own company only) + ADMIN_LEVEL
//   Submit company: company_xo (own company, board open, not yet submitted)
//   Close board  : s1_adjutant + ADMIN_LEVEL
//   View         : everyone who can reach /admin/s1
//
// SCORING
//   11 fixed knowledge categories × max 100 pts each = 1100 base
//   + extra credit (0–100) = 1200 max total
//   Each category score must be one of: 100 / 90 / 80 / 0
//
// DATA MODEL (Firestore)
//   promotionBoards/{id}:
//     title, boardDate (Timestamp), status ('open'|'closed'),
//     categories [{id, label}], maxExtraCredit, totalPossible,
//     createdBy, createdByName, createdAt (Timestamp),
//     companyStatus: { [company]: { submitted, submittedAt, submittedByName } },
//     totalCadets
//
//   promotionScores/{id}:
//     boardId, rosterDocId, linkedUid, cadetName, rank, company,
//     scores: { [categoryId]: 100|90|80|0|null },
//     extraCredit (0–100), totalScore,
//     notes, updatedAt, updatedByName

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db, auth } from '../firebase';
import {
  collection, query, where, onSnapshot,
  writeBatch, doc, getDocs, Timestamp, updateDoc, deleteDoc, setDoc,
} from 'firebase/firestore';
import {
  Trophy, Plus, ChevronLeft, ChevronRight, CheckCircle2, Clock,
  X, ChevronDown, ChevronUp, AlertCircle, Unlock, Lock,
  ClipboardList, Star, Eye, EyeOff, TrendingUp, BarChart2, Medal, Printer,
} from 'lucide-react';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, JROTC_RANKS, boardTargetRank, JROTC_POSITIONS, BATTALION_POSITIONS } from '../constants';
import { writeLog } from '../lib/writeLog';
import { useCompanies } from '../hooks/useCompanies';
import { normalizeCompany } from '../utils/normalizeCompany';
import { useConfirm } from '../contexts/ConfirmContext';
import { groupByLet } from '../utils/groupByLet';
import DatePicker from './DatePicker';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  { id: 'cadet_creed',       label: 'Cadet Creed'                       },
  { id: 'ldrship',           label: 'LDRSHIP (with Definitions)'         },
  { id: 'jrotc_meaning',     label: 'JROTC Meaning'                      },
  { id: 'let_meaning',       label: 'LET Meaning'                        },
  { id: 'mission_statement', label: 'Mission Statement'                  },
  { id: 'sai',               label: 'Who & What Is the SAI'              },
  { id: 'ai',                label: 'Who & What Is the AI'               },
  { id: 'all_duties',        label: 'List All Duties'                    },
  { id: 'chain_of_command',  label: 'Battalion Chain of Command'         },
  { id: 'cadet_ranks',       label: 'Cadet Ranks (Show Ranks)'           },
  { id: 'principles',        label: 'Principles of Leadership'           },
];

// Proctor answer keys — shown as a collapsible in testing mode.
// null = computed dynamically at render time (see testing mode JSX).
const ANSWER_KEY = {
  cadet_creed: {
    lines: [
      'I am an Army Junior R.O.T.C. Cadet.',
      'I will always conduct myself to bring credit to my family, country, school, and the Corps of Cadets.',
      'I am loyal and patriotic.',
      'I am the future of the United States of America.',
      'I do not lie, cheat, or steal, and will always be accountable for my actions and deeds.',
      'I will always practice good citizenship and patriotism.',
      'I will work hard to improve my mind and strengthen my body.',
      'I will seek the mantle of leadership and stand prepared to uphold the Constitution and the American Way of Life.',
      'May God always grant me the strength to always live by this creed.',
    ],
  },
  ldrship: {
    lines: [
      'L — Loyalty: To bear true faith and allegiance to the US Constitution and your peers.',
      'D — Duty: To fulfill all obligations.',
      'R — Respect: To treat others the way they should be treated.',
      'S — Selfless Service: To put the welfare of the nation…before your own.',
      'H — Honor: To live up to all values.',
      'I — Integrity: To do what is right, legally and morally.',
      'P — Personal Courage: To face fear, danger, or adversity.',
    ],
  },
  jrotc_meaning: {
    lines: ['Junior Reserve Officer Training Corps'],
  },
  let_meaning: {
    lines: ['Leadership Education Training'],
  },
  mission_statement: {
    lines: ['"To motivate young people to be better citizens."'],
  },
  cadet_ranks: {
    lines: [
      'Enlisted (low → high):',
      'C/PVT · C/PFC · C/CPL · C/SGT · C/SSG · C/SFC · C/MSG · C/1SG · C/SGM · C/CSM',
      'Officer (low → high):',
      'C/2LT · C/1LT · C/CPT · C/MAJ · C/LTC · C/COL',
    ],
  },
  principles: {
    lines: [
      '1. Know yourself and seek self-improvement.',
      '2. Be technically and tactically proficient.',
      '3. Set the example.',
      '4. Ensure the task is understood, supervised, and accomplished.',
      '5. Know your subordinates and look out for their welfare.',
      '6. Seek responsibility and take responsibility for your actions.',
      '7. Make sound and timely decisions.',
      '8. Keep your subordinates informed.',
      '9. Develop a sense of responsibility among your subordinates.',
      '10. Employ your subordinates in accordance with their capabilities.',
      '11. Train your subordinates as a team.',
    ],
  },
  // Computed dynamically at render (sai, ai, all_duties, chain_of_command)
  sai:              null,
  ai:               null,
  all_duties:       null,
  chain_of_command: null,
};

// Key positions included in the battalion chain of command answer key.
// Ordered high → low. Platoon/squad level omitted — too granular for board.
const COC_POSITIONS = [
  'Battalion Commander',
  'Battalion Deputy Commander',
  'Battalion XO',
  'Battalion CSM',
  'Sergeant Major',
  'Battalion Staff (S-1)',
  'Battalion Staff (S-2)',
  'Battalion Staff (S-3)',
  'Battalion Staff (S-4)',
  'Battalion Staff (S-5)',
  'Battalion Staff (S-6)',
  'Battalion Staff (S-7)',
  'Company Commander',
  'Company XO',
  'First Sergeant',
  'Master Sergeant',
  'Platoon Leader',
  'Platoon Sergeant',
  'Squad Leader',
  'Squad Member',
];

// Build a chain-of-command list from a full roster array.
// Returns lines ordered highest position → lowest (battalion & company command only).
function buildChainOfCommand(roster) {
  const byPos = {};
  roster.forEach(c => {
    if (!c.position || !c.fullName) return;
    if (!COC_POSITIONS.includes(c.position)) return;
    (byPos[c.position] = byPos[c.position] || []).push(
      `${c.rank ? c.rank + ' ' : ''}${c.fullName}${c.company ? ' — ' + c.company : ''}`
    );
  });
  const lines = [];
  COC_POSITIONS.forEach(pos => {
    if (byPos[pos]) byPos[pos].forEach(name => lines.push(`${pos}: ${name}`));
  });
  return lines;
}

// Short names for table column headers
const CAT_SHORT = {
  cadet_creed:       'Creed',
  ldrship:           'LDRSHIP',
  jrotc_meaning:     'JROTC',
  let_meaning:       'LET',
  mission_statement: 'Mission',
  sai:               'SAI',
  ai:                'AI',
  all_duties:        'Duties',
  chain_of_command:  'CoC',
  cadet_ranks:       'Ranks',
  principles:        'Principles',
};

const SCORE_OPTIONS  = [100, 90, 80, 0, 'na'];
const MAX_EC         = 100;
const BASE_MAX       = DEFAULT_CATEGORIES.length * 100; // 1100
const TOTAL_MAX      = BASE_MAX + MAX_EC;               // 1200

// Roles allowed to conduct the interactive Testing Mode
const TESTING_ROLES = [
  'company_commander', 'company_xo', 'company_1sg',
  'battalion_commander', 'battalion_xo', 'battalion_csm',
  'sergeant_major', 'senior_army_instructor', 'army_instructor',
];

// Extra-credit checklist items for Testing Mode.
// ptsEach: points awarded per "unit" (one rank, one duty, etc.)
// cap: per-item max (global MAX_EC=100 still applies regardless).
// CoC cap is set to 9999 because a cadet can theoretically list every person in every company;
// the global EC ceiling prevents any scoring exploit.
const EC_OPTIONS = [
  { id: 'ranks',      label: 'Named & described each rank',        sub: 'Without looking — 1 pt per rank',                                                          ptsEach: 1, cap:   11 },
  { id: 'duties',     label: 'Listed extra duties',                sub: 'Beyond required (your duties only) — 1 pt per extra duty',                                  ptsEach: 1, cap:   10 },
  { id: 'coc',        label: 'Chain of Command (in order)',        sub: '1 pt per person outside your CoC (in order: CC → XO → 1SG → Platoon Leaders…) — unlimited', ptsEach: 1, cap: 9999 },
  { id: 'principles', label: 'Extra Principles of Leadership',     sub: 'Beyond required — 1 pt per principle',                                                      ptsEach: 1, cap:   11 },
  { id: 'ldrship',    label: 'LDRSHIP definitions',                sub: 'If not required — 1 pt per definition with name',                                           ptsEach: 1, cap:    7 },
];

// ── Default per-position board requirements ────────────────────────────────────
// Pre-populated from the official score sheets. Battalion may edit these freely
// in the draft view. New boards are initialised with these values.
const _NOTES = 'Are they performing their duties? (Yes/No) — note in Comments';

const _mkItems = (duties, coc, principles) => [
  'Cadet Creed',
  'LDRSHIP (with definitions)',
  'JROTC Meaning',
  'LET Meaning',
  'Mission Statement',
  'Who & What Is the SAI',
  'Who & What Is the AI',
  duties,
  coc,
  'Cadet Ranks (Show Ranks)',
  principles,
];

const _mk = (items, notes = _NOTES, duties = []) => ({ items, duties, notes });
const _btnLeadership = (principles) =>
  _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', principles));
const _companyCoC    = 'Top 4 and company chain of command to platoon leaders';
const _platoonCoC    = 'Company Leadership to squad leaders of their platoon';

export const DEFAULT_POSITION_REQUIREMENTS = {
  // ── Squad / No leadership ────────────────────────────────────────────────────
  'Squad Member':         _mk(_mkItems('List your duties', 'Company Leadership to squad members', '5/11 Principles of Leadership')),
  'Squad Leader Assistant': _mk(_mkItems('List 3 duties', 'Company Leadership to squad members', '5/11 Principles of Leadership')),

  // ── Squad Leadership ─────────────────────────────────────────────────────────
  'Squad Leader': _mk(_mkItems('List 4 duties', 'Company Leadership to squad members', '5/11 Principles of Leadership')),

  // ── Platoon Leadership ───────────────────────────────────────────────────────
  'Platoon Sergeant': _mk(_mkItems('List 3 duties', _platoonCoC, '6/11 Principles of Leadership')),
  'Platoon Leader':   _mk(_mkItems('List 4 duties', _platoonCoC, '7/11 Principles of Leadership')),

  // ── Company Staff Assistants (S1-S7) ────────────────────────────────────────
  'Company S1 Assistant': _mk(_mkItems('List half of your duties', 'Battalion Chain of Command', '6/11 Principles of Leadership')),
  'Company S2 Assistant': _mk(_mkItems('List half of your duties', 'Battalion Chain of Command', '6/11 Principles of Leadership')),
  'Company S3 Assistant': _mk(_mkItems('List half of your duties', 'Battalion Chain of Command', '6/11 Principles of Leadership')),
  'Company S4 Assistant': _mk(_mkItems('List half of your duties', 'Battalion Chain of Command', '6/11 Principles of Leadership')),
  'Company S5 Assistant': _mk(_mkItems('List half of your duties', 'Battalion Chain of Command', '6/11 Principles of Leadership')),
  'Company S6 Assistant': _mk(_mkItems('List half of your duties', 'Battalion Chain of Command', '6/11 Principles of Leadership')),
  'Company S7 Assistant': _mk(_mkItems('List half of your duties', 'Battalion Chain of Command', '6/11 Principles of Leadership')),

  // ── Company Command ──────────────────────────────────────────────────────────
  'First Sergeant':    _mk(_mkItems('List 4 duties', _companyCoC, '8/11 Principles of Leadership')),
  'Master Sergeant':   _mk(_mkItems('List 4 duties', _companyCoC, '8/11 Principles of Leadership')),
  'Company XO':        _mk(_mkItems('List 4 duties', _companyCoC, '8/11 Principles of Leadership')),
  'Company Commander': _mk(_mkItems('List 6 duties', _companyCoC, '9/11 Principles of Leadership')),

  // ── Battalion Staff (S1-S7) ──────────────────────────────────────────────────
  'Battalion Staff (S-1)': _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', '9/11 Principles of Leadership')),
  'Battalion Staff (S-2)': _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', '9/11 Principles of Leadership')),
  'Battalion Staff (S-3)': _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', '9/11 Principles of Leadership')),
  'Battalion Staff (S-4)': _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', '9/11 Principles of Leadership')),
  'Battalion Staff (S-5)': _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', '9/11 Principles of Leadership')),
  'Battalion Staff (S-6)': _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', '9/11 Principles of Leadership')),
  'Battalion Staff (S-7)': _mk(_mkItems('List ALL duties', 'Battalion Chain of Command', '9/11 Principles of Leadership')),

  // ── Battalion Command ────────────────────────────────────────────────────────
  'Sergeant Major':             _btnLeadership('11/11 Principles of Leadership'),
  'Battalion XO':               _btnLeadership('11/11 Principles of Leadership'),
  'Battalion Deputy Commander': _btnLeadership('11/11 Principles of Leadership'),
  'Battalion CSM':              _btnLeadership('11/11 Principles of Leadership'),
  'Battalion Commander':        _btnLeadership('11/11 Principles of Leadership'),
};

// Scoring: 0 mistakes → 100, 1 → 90, 2 → 80, 3+ → 0
function mistakesToScore(n) {
  if (n === 'na') return 'na';
  if (n === 0) return 100;
  if (n === 1) return  90;
  if (n === 2) return  80;
  return 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function calcTotal(scores, extraCredit, categories = DEFAULT_CATEGORIES) {
  const base = categories.reduce((sum, cat) => {
    const s = scores?.[cat.id];
    if (s == null || s === '' || s === 'na') return sum;
    return sum + Number(s);
  }, 0);
  return base + (Number(extraCredit) || 0);
}

function calcPossible(scores, categories = DEFAULT_CATEGORIES) {
  const naCount = categories.filter(cat => scores?.[cat.id] === 'na').length;
  return (categories.length - naCount) * 100;
}

// Convert a Firestore Timestamp (or Date) to a YYYY-MM-DD string for <input type="date">
function tsToDateStr(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function scoreColor(pct) {
  if (pct >= 90) return 'text-green-600 dark:text-green-400';
  if (pct >= 80) return 'text-yellow-600 dark:text-yellow-500';
  if (pct > 0)   return 'text-orange-500 dark:text-orange-400';
  return 'text-slate-300 dark:text-slate-600';
}

// ── ECOtherForm ────────────────────────────────────────────────────────────────
// Isolated so it can hold its own "reason" + "pts" input state without
// triggering a re-render of the whole testing-mode overlay on each keystroke.
function ECOtherForm({ disabled, remaining, onAdd }) {
  const [reason, setReason] = React.useState('');
  const [pts,    setPts]    = React.useState(1);
  const canAdd = reason.trim() && pts >= 1 && !disabled;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(reason, pts);
    setReason('');
    setPts(1);
  };

  return (
    <div className={`bg-slate-900 border border-white/10 rounded-2xl p-4 space-y-3 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Other / unlisted item</p>
      <input
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        placeholder="Reason / description…"
        className="w-full bg-slate-800 border border-white/10 focus:border-yellow-500/40 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors"
      />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPts(p => Math.max(1, p - 1))} className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white font-black flex items-center justify-center transition-all">−</button>
          <span className="w-8 text-center font-black text-white tabular-nums">{pts}</span>
          <button type="button" onClick={() => setPts(p => Math.min(remaining, p + 1))} className="w-7 h-7 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/40 text-yellow-400 font-black flex items-center justify-center transition-all">+</button>
          <span className="text-[10px] text-slate-500">pt{pts !== 1 ? 's' : ''}</span>
        </div>
        <button
          type="button"
          disabled={!canAdd}
          onClick={handleAdd}
          className="ml-auto px-4 py-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-30 text-slate-950 text-xs font-black rounded-xl transition-colors"
        >Add</button>
      </div>
    </div>
  );
}

// ── ScoreTableRow ──────────────────────────────────────────────────────────────
// Renders one cadet row in the score entry / review table.
// Extra credit uses an uncontrolled input + onBlur save to avoid setState-in-effect.
function ScoreTableRow({ scoreDoc, canEdit, canEditEC, isLocked = false, formsOk, ccOk, onScoreChange, onExtraCreditBlur, categories = DEFAULT_CATEGORIES }) {
  const ecRef  = useRef(null);
  const total  = calcTotal(scoreDoc.scores, scoreDoc.extraCredit, categories);

  return (
    <tr className="border-b border-blue-50 dark:border-white/5 hover:bg-blue-50/20 dark:hover:bg-white/[0.02] transition-colors">
      {/* Cadet */}
      <td className="px-3 py-2 sticky left-0 bg-white dark:bg-slate-900 z-10 min-w-[160px]">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">{scoreDoc.cadetName || '—'}</p>
          {isLocked && (
            <span title="Score locked — contact Battalion XO to make changes" className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded px-1 py-0.5">
              <Lock size={7} /> Locked
            </span>
          )}
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase">{scoreDoc.rank}</p>
      </td>

      {/* Eligibility badges */}
      <td className="px-2 py-2">
        <div className="flex flex-col gap-0.5">
          <span title="Forms" className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${formsOk ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
            {formsOk ? '✓ Forms' : '✗ Forms'}
          </span>
          <span title="Cadet Challenge" className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${ccOk ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400'}`}>
            {ccOk ? '✓ CC' : '✗ CC'}
          </span>
        </div>
      </td>

      {/* Category scores */}
      {categories.map(cat => {
        const val = scoreDoc.scores?.[cat.id];
        return (
          <td key={cat.id} className="px-1.5 py-2 text-center">
            {canEdit ? (
              <select
                value={val ?? ''}
                onChange={e => onScoreChange(scoreDoc.id, cat.id, e.target.value)}
                className="w-14 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-bold text-center text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors px-0.5 py-1"
              >
                <option value="">—</option>
                {SCORE_OPTIONS.map(s => <option key={s} value={s}>{s === 'na' ? 'N/A' : s}</option>)}
              </select>
            ) : (
              <span className={`text-xs font-bold ${val === 'na' ? 'text-slate-400 dark:text-slate-500' : val != null ? (val >= 90 ? 'text-green-600 dark:text-green-400' : val >= 80 ? 'text-yellow-600 dark:text-yellow-500' : val === 0 ? 'text-red-500' : 'text-slate-600 dark:text-slate-400') : 'text-slate-300 dark:text-slate-600'}`}>
                {val === 'na' ? 'N/A' : (val ?? '—')}
              </span>
            )}
          </td>
        );
      })}

      {/* Extra credit */}
      <td className="px-1.5 py-2 text-center">
        {(canEdit || canEditEC) ? (
          <input
            ref={ecRef}
            type="number"
            min={0}
            max={MAX_EC}
            defaultValue={scoreDoc.extraCredit || 0}
            key={`${scoreDoc.id}-ec`}
            onBlur={() => {
              const v = Math.min(MAX_EC, Math.max(0, parseInt(ecRef.current?.value) || 0));
              onExtraCreditBlur(scoreDoc.id, v);
            }}
            className="w-14 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-bold text-center text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors px-0.5 py-1"
          />
        ) : (
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
            {scoreDoc.extraCredit || 0}
          </span>
        )}
      </td>

      {/* Total */}
      <td className="px-3 py-2 text-center">
        <span className="text-sm font-black text-slate-700 dark:text-slate-200">{total}</span>
        <p className="text-[9px] text-slate-300 dark:text-slate-600">/ {calcPossible(scoreDoc.scores, categories)}</p>
      </td>

      {/* Percent */}
      {(() => {
        const possible = calcPossible(scoreDoc.scores, categories);
        const pct = possible > 0 ? Math.round((total / possible) * 100) : 0;
        return (
          <td className="px-3 py-2 text-center">
            <span className={`text-sm font-black ${scoreColor(pct)}`}>{pct}%</span>
          </td>
        );
      })()}
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const S1PromotionBoard = ({ userData, role, userLevel, myCompany, isBattalionLevel, isS1 }) => {
  const { companies } = useCompanies();
  const confirm = useConfirm();

  // ── Access flags ─────────────────────────────────────────────────────────────
  const canCreateBoard = isS1;
  // Battalion staff (L70+) can edit all scores; company top-3 (CC/XO/1SG) edit own company only.
  const canEnterScores = ['company_xo', 'company_1sg', 'company_commander'].includes(role) || userLevel >= STAFF_LEVEL;
  const canCloseBoard  = isS1;
  const canUseTesting  = TESTING_ROLES.includes(role);

  // ── View state ────────────────────────────────────────────────────────────────
  const [view,          setView]          = useState('list'); // 'list' | 'detail'
  const [selectedBoard, setSelectedBoard] = useState(null);

  // ── Data state ────────────────────────────────────────────────────────────────
  const [boards,         setBoards]         = useState([]);
  const [scores,         setScores]         = useState([]);
  const [pendingFormMap, setPendingFormMap]  = useState({}); // rosterDocId -> true if pending in active form event
  const [ccCompleteMap,  setCcCompleteMap]   = useState({}); // rosterDocId -> true if CC complete
  const [loadingElig,    setLoadingElig]     = useState(false);
  const [showArchived,   setShowArchived]    = useState(false);

  const [savedFlash,   setSavedFlash]   = useState(false);
  const savedTimer = useRef(null);
  const showSaved = useCallback(() => {
    setSavedFlash(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 1800);
  }, []);

  // S1 filter controls
  const [minScore,     setMinScore]     = useState(0);
  const [maxScore,     setMaxScore]     = useState(TOTAL_MAX);
  const [companyFil,   setCompanyFil]   = useState('all');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', boardDate: '' });
  const [creating,   setCreating]   = useState(false);

  // Submit feedback
  const [submitting, setSubmitting] = useState(false);
  // Unlocking a company's submitted scores (S1 only)
  const [unlocking,  setUnlocking]  = useState(null); // company string being unlocked

  // LET grouping toggle for the score table
  const [groupLet, setGroupLet] = useState(false);

  // ── Run-Promotions modal (closed board only, S1) ──────────────────────────────
  const [promoModal,            setPromoModal]            = useState(false);
  const [promoNum,              setPromoNum]              = useState(1);
  const [promoRunning,          setPromoRunning]          = useState(false);
  const [rosterCache,           setRosterCache]           = useState(null); // { [rosterDocId]: rosterData }
  const [promoCustomConfirmed,  setPromoCustomConfirmed]  = useState({}); // { [req.id]: bool }

  // ── Testing Mode ──────────────────────────────────────────────────────────────
  // phase: 'pick' → 'question' → 'ec' → 'results'
  const [testMode, setTestMode] = useState(null);
  const [cadetSearch, setCadetSearch] = useState('');
  const [showCatAvgs, setShowCatAvgs] = useState(false);

  // ── Print Roster modal ────────────────────────────────────────────────────────
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printOpts, setPrintOpts] = useState({
    showCategories:   true,
    showEC:           true,
    showTotal:        true,
    showPct:          true,
    showElig:         false,
    sort:             'let',       // 'let' | 'alpha' | 'score'
    showNominations:  false,
  });

  const startTesting = () => {
    const cats = selectedBoard?.categories || DEFAULT_CATEGORIES;
    setTestMode({
      phase:       'pick',
      scoreDocId:  null,
      cadetName:   '',
      letLevel:    '',
      position:    '',   // cadet's position — used to look up positionRequirements
      categories:  cats,
      step:        0,
      mistakes:    {},   // { [categoryId]: number 0-3+ }
      extraCredit: 0,
      ecItems:     {},   // { [EC_OPTIONS id]: count }
      ecOther:     [],   // [{ reason, pts }]
    });
  };

  const exitTesting = () => { setTestMode(null); setCadetSearch(''); };

  const testPickCadet = (scoreDocId) => {
    const s = visibleScores.find(sc => sc.id === scoreDocId);
    const letLevel = s ? (s.letLevel || letLevelMap[s.rosterDocId] || '') : '';
    // Position: stored on score doc for boards opened after v1.6.84; fall back to positionMap
    const position = s ? (s.position || positionMap[s.rosterDocId] || '') : '';
    setTestMode(prev => ({
      ...prev,
      scoreDocId,
      cadetName: s?.cadetName || '',
      letLevel,
      position,
    }));
  };

  const testBeginQuestions = () => {
    if (!testMode?.scoreDocId) return;
    const posReq = posReqs[testMode.position] || DEFAULT_POSITION_REQUIREMENTS[testMode.position];
    const requiredCatIds = posReq?.requiredCategories;
    const cats = (requiredCatIds && requiredCatIds.length > 0)
      ? testMode.categories.filter(c => requiredCatIds.includes(c.id))
      : testMode.categories;
    setTestMode(prev => ({ ...prev, phase: 'question', step: 0, categories: cats }));
  };

  const testRecordMistakes = (n) => {
    const catId = testMode.categories[testMode.step]?.id;
    const isLast = testMode.step >= testMode.categories.length - 1;
    setTestMode(prev => ({
      ...prev,
      mistakes: { ...prev.mistakes, [catId]: n },
      phase:    isLast ? 'ec' : 'question',
      step:     isLast ? prev.step : prev.step + 1,
      // Seed EC state when entering the EC phase
      ...(isLast ? { ecItems: {}, ecOther: [] } : {}),
    }));
  };

  // Compute total EC from checklist selections (capped at MAX_EC)
  const calcEC = (ecItems = {}, ecOther = []) => {
    const standard = EC_OPTIONS.reduce((sum, opt) => sum + (ecItems[opt.id] || 0) * opt.ptsEach, 0);
    const other    = ecOther.reduce((sum, o) => sum + (o.pts || 0), 0);
    return Math.min(MAX_EC, standard + other);
  };

  // Increment / decrement a standard EC item
  const testIncrEC = (id) => {
    const opt = EC_OPTIONS.find(o => o.id === id);
    if (!opt) return;
    setTestMode(prev => {
      const cur = prev.ecItems[id] || 0;
      if (cur >= opt.cap) return prev;
      const ecItems = { ...prev.ecItems, [id]: cur + 1 };
      return { ...prev, ecItems, extraCredit: calcEC(ecItems, prev.ecOther) };
    });
  };
  const testDecrEC = (id) => {
    setTestMode(prev => {
      const cur = prev.ecItems[id] || 0;
      if (cur <= 0) return prev;
      const ecItems = { ...prev.ecItems, [id]: cur - 1 };
      return { ...prev, ecItems, extraCredit: calcEC(ecItems, prev.ecOther) };
    });
  };

  // Add / remove an "Other" entry
  const testAddOther = (reason, pts) => {
    setTestMode(prev => {
      const ecOther = [...prev.ecOther, { reason: reason.trim(), pts: Math.max(1, pts) }];
      return { ...prev, ecOther, extraCredit: calcEC(prev.ecItems, ecOther) };
    });
  };
  const testRemoveOther = (idx) => {
    setTestMode(prev => {
      const ecOther = prev.ecOther.filter((_, i) => i !== idx);
      return { ...prev, ecOther, extraCredit: calcEC(prev.ecItems, ecOther) };
    });
  };

  const testCalculate = () => setTestMode(prev => ({ ...prev, phase: 'results', revealed: false }));
  const testToggleReveal = () => setTestMode(prev => ({ ...prev, revealed: !prev.revealed }));

  const testSaveScore = async () => {
    if (!testMode?.scoreDocId || !selectedBoard) return;
    const scores = {};
    testMode.categories.forEach(cat => {
      scores[cat.id] = mistakesToScore(testMode.mistakes[cat.id] ?? 3);
    });
    const total = calcTotal(scores, testMode.extraCredit, testMode.categories);
    try {
      await updateDoc(doc(db, 'promotionScores', testMode.scoreDocId), {
        scores,
        extraCredit:          testMode.extraCredit,
        totalScore:           total,
        updatedAt:            Timestamp.now(),
        updatedByName:        userData?.fullName || '',
        testingComplete:      true,
        testingCompletedAt:   Timestamp.now(),
        testingCompletedBy:   userData?.fullName || '',
      });
      setTestMode(null);
    } catch (err) {
      console.error('Testing mode save error:', err);
      alert('Failed to save score. Please try again.');
    }
  };
  // rosterDocId → letLevel for boards opened before v1.6.58 (no letLevel on score docs).
  const [letLevelMap, setLetLevelMap] = useState({});

  // Draft board editing state (used when selectedBoard.status === 'draft')
  const [draftTitle,    setDraftTitle]    = useState('');
  const [draftDate,     setDraftDate]     = useState('');
  const [draftCats,     setDraftCats]     = useState(DEFAULT_CATEGORIES);
  const [draftCatInput, setDraftCatInput] = useState('');
  const [draftEligReqs,      setDraftEligReqs]      = useState({ requireForms: true, requireCC: true, custom: [] });
  const [draftCustomReqForm, setDraftCustomReqForm] = useState({ label: '', description: '' });
  // ── Standalone Position Requirements (always-visible, source of truth) ────────
  // Saved directly to pageContent/promotion-board — independent of any board.
  const [posReqs,         setPosReqs]         = useState(DEFAULT_POSITION_REQUIREMENTS);
  const [posReqPos,       setPosReqPos]       = useState(JROTC_POSITIONS[0]);
  const [posReqInput,     setPosReqInput]     = useState('');
  const [posReqDutiesInput, setPosReqDutiesInput] = useState('');
  const [posReqEditorTab,   setPosReqEditorTab]   = useState('requirements');
  const [savingPosReqs,   setSavingPosReqs]   = useState(false);

  // Legacy draft-board state (kept for backwards compat with open/closed boards)
  const [draftPosReqs,    setDraftPosReqs]    = useState({});
  const [draftPosReqPos,  setDraftPosReqPos]  = useState(JROTC_POSITIONS[0]);
  const [draftPosReqInput,setDraftPosReqInput]= useState('');
  // positionMap: rosterDocId → position (built from roster, used by Testing Mode)
  const [positionMap, setPositionMap] = useState({});
  const [savingDraft,        setSavingDraft]        = useState(false);
  const [openingBoard,  setOpeningBoard]  = useState(false);

  // ── Edit open/closed board settings (title + date) ──────────────────────────
  const [editBoardSettings, setEditBoardSettings] = useState(false);
  const [editBoardForm,     setEditBoardForm]     = useState({ title: '', boardDate: '' });

  // ── Subscribe: standalone position requirements (pageContent/promotion-board) ──
  useEffect(() => {
    return onSnapshot(doc(db, 'pageContent', 'promotion-board'), snap => {
      if (snap.exists() && snap.data().positionRequirements) {
        setPosReqs(prev => ({ ...DEFAULT_POSITION_REQUIREMENTS, ...snap.data().positionRequirements }));
      }
    });
  }, []);

  // ── Subscribe: instructors (for SAI/AI answer key in testing mode) ───────────
  const [instructors, setInstructors] = useState([]);
  useEffect(() => {
    return onSnapshot(collection(db, 'instructors'), snap => {
      setInstructors(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  // ── Subscribe: full roster (for chain of command answer key) ─────────────────
  const [rosterAll, setRosterAll] = useState([]);
  useEffect(() => {
    if (!isBattalionLevel) return;
    return onSnapshot(collection(db, 'roster'), snap => {
      setRosterAll(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [isBattalionLevel]);

  const savePosReqsToPage = async (next) => {
    setSavingPosReqs(true);
    try {
      await setDoc(doc(db, 'pageContent', 'promotion-board'),
        { positionRequirements: next }, { merge: true });
    } catch (err) {
      console.error('Save position requirements error:', err);
    } finally {
      setSavingPosReqs(false);
    }
  };

  // ── Subscribe: boards ─────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'promotionBoards'));
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => (b.boardDate?.seconds || 0) - (a.boardDate?.seconds || 0));
      setBoards(docs);
    });
  }, []);

  // Keep selectedBoard in sync when boards update from Firestore
  useEffect(() => {
    if (!selectedBoard) return;
    const updated = boards.find(b => b.id === selectedBoard.id);
    if (updated) setSelectedBoard(updated);
  }, [boards]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync draft editing state when a draft board is selected (or its id/status changes)
  useEffect(() => {
    if (selectedBoard?.status === 'draft') {
      setDraftTitle(selectedBoard.title || '');
      setDraftDate(tsToDateStr(selectedBoard.boardDate));
      setDraftCats(selectedBoard.categories || DEFAULT_CATEGORIES);
      setDraftEligReqs(selectedBoard.eligibilityReqs || { requireForms: true, requireCC: true, custom: [] });
      // Fall back to built-in defaults so new boards are pre-populated from the score sheets
      const posReqs = selectedBoard.positionRequirements
        || (Object.keys(selectedBoard).includes('positionRequirements') ? {} : DEFAULT_POSITION_REQUIREMENTS);
      setDraftPosReqs(posReqs);
      // Default selection: first position that already has items, else first position overall
      const existing = JROTC_POSITIONS.find(p => (posReqs[p]?.items || []).length > 0);
      setDraftPosReqPos(existing || JROTC_POSITIONS[0]);
    }
  }, [selectedBoard?.id, selectedBoard?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Subscribe: scores for selected board ──────────────────────────────────────
  // Battalion-level users see all companies; everyone else gets a company-scoped
  // query so the Firestore rules (which require company match for level < 70) pass.
  useEffect(() => {
    if (!selectedBoard) { setScores([]); return; }
    const q = isBattalionLevel
      ? query(collection(db, 'promotionScores'), where('boardId', '==', selectedBoard.id))
      : query(collection(db, 'promotionScores'),
          where('boardId', '==', selectedBoard.id),
          where('company', '==', myCompany || ''));
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => {
        const co = (a.company || '').localeCompare(b.company || '');
        return co !== 0 ? co : (a.cadetName || '').localeCompare(b.cadetName || '');
      });
      setScores(docs);
    });
  }, [selectedBoard?.id, isBattalionLevel, myCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load eligibility data + letLevel map when a board is selected ─────────────
  useEffect(() => {
    if (!selectedBoard) {
      setPendingFormMap({});
      setCcCompleteMap({});
      setLetLevelMap({});
      setPositionMap({});
      return;
    }
    (async () => {
      setLoadingElig(true);
      try {
        const now = new Date();

        // 0. Build letLevel map from roster so LET grouping works on boards that
        //    were opened before letLevel was stored on score docs (pre-v1.6.58).
        //    Battalion users load all roster docs; others load only their company.
        const rosterQ = isBattalionLevel
          ? query(collection(db, 'roster'))
          : query(collection(db, 'roster'), where('company', '==', myCompany || ''));
        const rosterSnap = await getDocs(rosterQ);
        const lMap   = {};
        const posMap = {};
        rosterSnap.docs.forEach(d => {
          lMap[d.id]   = d.data().letLevel  || '';
          posMap[d.id] = d.data().position  || '';
        });
        setLetLevelMap(lMap);
        setPositionMap(posMap);

        // 1. Active form events (dueDate >= now)
        const evSnap = await getDocs(collection(db, 'formEvents'));
        const activeEventIds = new Set(
          evSnap.docs
            .filter(d => {
              const ts = d.data().dueDate;
              if (!ts) return false;
              const dt = ts.toDate ? ts.toDate() : new Date(ts);
              return dt >= now;
            })
            .map(d => d.id),
        );

        // 2. Pending form submissions for active events — company-scoped for
        //    non-battalion users to satisfy Firestore security rules.
        const subSnap = await getDocs(
          isBattalionLevel
            ? query(collection(db, 'formSubmissions'), where('status', '==', 'pending'))
            : query(collection(db, 'formSubmissions'), where('company', '==', myCompany || '')),
        );
        const pMap = {};
        subSnap.docs.forEach(d => {
          const { eventId, rosterDocId, status } = d.data();
          // For company users the query is not status-filtered, so check client-side.
          if ((isBattalionLevel || status === 'pending') && activeEventIds.has(eventId) && rosterDocId) {
            pMap[rosterDocId] = true;
          }
        });
        setPendingFormMap(pMap);

        // 3. CC records — company-scoped for non-battalion users.
        //    cadetId = roster doc ID (set via { uid: d.id, ...d.data() } in AdminCadetChallenge).
        const ccSnap = await getDocs(
          isBattalionLevel
            ? collection(db, 'cadetChallengeRecords')
            : query(collection(db, 'cadetChallengeRecords'), where('company', '==', myCompany || '')),
        );
        const ccMap = {};
        ccSnap.docs.forEach(d => {
          const r = d.data();
          const id = r.cadetId;
          if (!id || id === 'manual' || ccMap[id]) return;
          const allFilled =
            (r.pushUps    != null && r.pushUps    !== '') &&
            (r.sitUps     != null && r.sitUps     !== '') &&
            (r.shuttleRun != null && r.shuttleRun !== '') &&
            (r.oneMile    != null && r.oneMile    !== '') &&
            (r.sitNReach  != null && r.sitNReach  !== '');
          if (r.medicalExempt === true || allFilled) ccMap[id] = true;
        });
        setCcCompleteMap(ccMap);
      } catch (err) {
        console.error('Eligibility load error:', err);
      } finally {
        setLoadingElig(false);
      }
    })();
  }, [selectedBoard?.id, isBattalionLevel, myCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────────────
  const draftBoard   = useMemo(() => boards.find(b => b.status === 'draft'),   [boards]);
  const openBoard    = useMemo(() => boards.find(b => b.status === 'open'),    [boards]);
  const closedBoards = useMemo(() => boards.filter(b => b.status === 'closed'), [boards]);

  const myCompanySubmitted = selectedBoard?.companyStatus?.[myCompany]?.submitted === true;
  const canEditThisBoard   = canEnterScores && !myCompanySubmitted && selectedBoard?.status === 'open';

  // Scores visible to this user.
  // Company commanders, 1SGs, and XOs are graded by battalion leadership —
  // they should not see their own score doc in the table.
  const SELF_HIDDEN_ROLES = ['company_commander', 'company_xo', 'company_1sg'];
  const visibleScores = useMemo(() => {
    const myUid = auth.currentUser?.uid;
    let list = isBattalionLevel ? scores : scores.filter(s => s.company === myCompany);
    if (SELF_HIDDEN_ROLES.includes(role) && myUid) {
      list = list.filter(s => s.linkedUid !== myUid);
    }
    return list;
  }, [scores, isBattalionLevel, myCompany, role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered/sorted scores for S1 review
  const filteredScores = useMemo(() => {
    let list = visibleScores;
    if (companyFil !== 'all') list = list.filter(s => s.company === companyFil);
    list = list.filter(s => {
      const t = s.totalScore || 0;
      return t >= minScore && t <= maxScore;
    });
    return [...list].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
  }, [visibleScores, companyFil, minScore, maxScore]);

  // Company submission status summary
  const companyStatusSummary = useMemo(() => {
    if (!selectedBoard?.companyStatus) return [];
    return Object.entries(selectedBoard.companyStatus).map(([co, st]) => ({ company: co, ...st }));
  }, [selectedBoard?.companyStatus]);

  const allSubmitted = companyStatusSummary.length > 0 && companyStatusSummary.every(cs => cs.submitted);
  const submittedCount = companyStatusSummary.filter(cs => cs.submitted).length;

  // Averages across the currently visible score list (non-zero totals only)
  const boardAvgStats = useMemo(() => {
    const list    = isBattalionLevel ? filteredScores : visibleScores;
    const scored  = list.filter(s => (s.totalScore || 0) > 0);
    if (!scored.length) return { n: 0 };
    const cats    = selectedBoard?.categories || DEFAULT_CATEGORIES;
    const totals  = scored.map(s => s.totalScore || 0);
    const ecVals  = scored.map(s => s.extraCredit || 0).filter(v => v > 0);
    const catAvgs = cats.map(cat => {
      const vals = scored.map(s => s.scores?.[cat.id]).filter(v => v != null && !isNaN(Number(v)));
      return {
        id:    cat.id,
        label: cat.label,
        avg:   vals.length ? (vals.reduce((a, b) => a + Number(b), 0) / vals.length).toFixed(1) : null,
      };
    });
    return {
      n:       scored.length,
      avg:     (totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1),
      highest: Math.max(...totals),
      lowest:  Math.min(...totals),
      ecAvg:   ecVals.length ? (ecVals.reduce((a, b) => a + b, 0) / ecVals.length).toFixed(1) : null,
      catAvgs,
      maxPossible: selectedBoard?.totalPossible || (cats.length * 100),
    };
  }, [isBattalionLevel, filteredScores, visibleScores, selectedBoard]);

  // ── Battalion Board Nominations ───────────────────────────────────────────────
  // For each company × position (excluding battalion-level positions), find the
  // cadet with the highest percentage score. Only cadets with pct > 0 qualify.
  // All Company S1-S7 Assistants are collapsed into one "Staff Assistant" slot.
  const STAFF_ASST_POSITIONS = new Set([
    'Company S1 Assistant', 'Company S2 Assistant', 'Company S3 Assistant',
    'Company S4 Assistant', 'Company S5 Assistant', 'Company S6 Assistant',
    'Company S7 Assistant',
  ]);
  // Positions that are appointed, not filled through the promotion board
  const APPOINTED_POSITIONS = new Set([
    'Company Commander', 'Company XO', 'First Sergeant', 'Master Sergeant',
  ]);
  const battalionNominations = useMemo(() => {
    const cats = selectedBoard?.categories || DEFAULT_CATEGORIES;
    const isBattalionPos = new Set(BATTALION_POSITIONS);
    // [company][posKey] → best scoring cadet
    const best = {};
    visibleScores.forEach(s => {
      const rawPos  = s.position || positionMap[s.rosterDocId] || '';
      if (!rawPos || isBattalionPos.has(rawPos) || APPOINTED_POSITIONS.has(rawPos)) return;
      const posKey  = STAFF_ASST_POSITIONS.has(rawPos) ? 'Staff Assistant' : rawPos;
      const company = s.company || 'Unknown';
      const total   = calcTotal(s.scores, s.extraCredit, cats);
      const possible = calcPossible(s.scores, cats);
      const pct = possible > 0 ? Math.round((total / possible) * 100) : 0;
      if (pct === 0) return;
      if (!best[company]) best[company] = {};
      const cur = best[company][posKey];
      if (!cur || pct > cur.pct || (pct === cur.pct && total > cur.total)) {
        best[company][posKey] = { cadetName: s.cadetName, rank: s.rank, pct, total, possible, originalPos: rawPos };
      }
    });
    return Object.entries(best)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([company, positions]) => ({
        company,
        nominees: Object.entries(positions)
          .sort(([a], [b]) => {
            const idxA = JROTC_POSITIONS.indexOf(a === 'Staff Assistant' ? 'Company S1 Assistant' : a);
            const idxB = JROTC_POSITIONS.indexOf(b === 'Staff Assistant' ? 'Company S1 Assistant' : b);
            return idxB - idxA;
          })
          .map(([posKey, data]) => ({ position: posKey, ...data })),
      }));
  }, [visibleScores, positionMap, selectedBoard]);

  // ── Print handler ─────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const cats    = selectedBoard?.categories || DEFAULT_CATEGORIES;
    const boardTitle = selectedBoard?.title || 'Promotion Board';
    const boardDate  = fmtDate(selectedBoard?.boardDate);
    const opts = printOpts;

    // Sort/group the scores
    let rows = [...visibleScores];
    if (opts.sort === 'alpha') {
      rows.sort((a, b) => (a.cadetName || '').localeCompare(b.cadetName || ''));
    } else if (opts.sort === 'score') {
      rows.sort((a, b) => {
        const pa = calcPossible(a.scores, cats);
        const pb = calcPossible(b.scores, cats);
        const pctA = pa > 0 ? calcTotal(a.scores, a.extraCredit, cats) / pa : 0;
        const pctB = pb > 0 ? calcTotal(b.scores, b.extraCredit, cats) / pb : 0;
        return pctB - pctA;
      });
    } else {
      rows.sort((a, b) => {
        const lA = Number(a.letLevel || letLevelMap[a.rosterDocId] || 99);
        const lB = Number(b.letLevel || letLevelMap[b.rosterDocId] || 99);
        return lA !== lB ? lA - lB : (a.cadetName || '').localeCompare(b.cadetName || '');
      });
    }

    // Build grouped sections
    const sections = [];
    if (opts.sort === 'let') {
      const groups = {};
      rows.forEach(r => {
        const lv = r.letLevel || letLevelMap[r.rosterDocId] || 'Unknown';
        const key = lv !== 'Unknown' ? `LET ${lv}` : 'Unknown';
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });
      const order = ['LET 1','LET 2','LET 3','LET 4'];
      const keys  = Object.keys(groups).sort((a, b) => {
        const ia = order.indexOf(a); const ib = order.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1; if (ib !== -1) return 1;
        return a.localeCompare(b);
      });
      keys.forEach(k => sections.push({ heading: k, rows: groups[k] }));
    } else {
      sections.push({ heading: null, rows });
    }

    const pctColor = pct => pct >= 90 ? '#16a34a' : pct >= 80 ? '#ca8a04' : pct > 0 ? '#ea580c' : '#94a3b8';

    const colHeaders = [
      ...(opts.showElig ? ['<th>Forms</th><th>CC</th>'] : []),
      ...(opts.showCategories ? cats.map(c => `<th>${CAT_SHORT[c.id] || c.label}</th>`) : []),
      ...(opts.showEC   ? ['<th>EC</th>']    : []),
      ...(opts.showTotal ? ['<th>Total</th>'] : []),
      ...(opts.showPct   ? ['<th>%</th>']     : []),
    ].join('');

    const rowHtml = r => {
      const total    = calcTotal(r.scores, r.extraCredit, cats);
      const possible = calcPossible(r.scores, cats);
      const pct      = possible > 0 ? Math.round((total / possible) * 100) : 0;
      const cells = [
        ...(opts.showElig ? [
          `<td style="text-align:center">${pendingFormMap[r.rosterDocId] ? '✗' : '✓'}</td>`,
          `<td style="text-align:center">${ccCompleteMap[r.rosterDocId] ? '✓' : '✗'}</td>`,
        ] : []),
        ...(opts.showCategories ? cats.map(c => {
          const v = r.scores?.[c.id];
          const display = v == null || v === '' ? '—' : v === 'na' ? 'N/A' : v;
          return `<td style="text-align:center">${display}</td>`;
        }) : []),
        ...(opts.showEC    ? [`<td style="text-align:center">${r.extraCredit || 0}</td>`] : []),
        ...(opts.showTotal ? [`<td style="text-align:center">${total} / ${possible}</td>`] : []),
        ...(opts.showPct   ? [`<td style="text-align:center;color:${pctColor(pct)};font-weight:900">${pct}%</td>`] : []),
      ].join('');
      return `<tr><td><strong>${r.rank || ''} ${r.cadetName || '—'}</strong></td>${cells}</tr>`;
    };

    const tableHtml = sections.map(({ heading, rows: sRows }) => `
      ${heading ? `<tr class="let-header"><td colspan="99">${heading}</td></tr>` : ''}
      ${sRows.map(rowHtml).join('')}
    `).join('');

    // Nominations section
    let nomHtml = '';
    if (opts.showNominations && battalionNominations.length > 0) {
      const companyNoms = isBattalionLevel
        ? battalionNominations
        : battalionNominations.filter(n => n.company === myCompany);
      nomHtml = `
        <div class="nominations">
          <h3>Battalion Board Nominations</h3>
          ${companyNoms.map(({ company, nominees }) => `
            <div class="nom-company">
              ${isBattalionLevel ? `<p class="nom-company-name">${company} Company</p>` : ''}
              <table class="nom-table">
                <thead><tr><th>Position</th><th>Cadet</th><th>%</th><th>Score</th></tr></thead>
                <tbody>
                  ${nominees.map(({ position, cadetName, rank, pct, total, possible, originalPos }) => {
                    const label = position === 'Staff Assistant' && originalPos ? `Staff Asst (${originalPos})` : position;
                    return `<tr>
                      <td>${label}</td>
                      <td><strong>${rank || ''} ${cadetName}</strong></td>
                      <td style="color:${pctColor(pct)};font-weight:900">${pct}%</td>
                      <td>${total} / ${possible}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${boardTitle} — Roster</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; padding: 16px; }
  h1 { font-size: 14pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
  .meta { font-size: 8pt; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 8pt; }
  th { background: #0f172a; color: #fff; padding: 4px 6px; text-align: center; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em; }
  th:first-child { text-align: left; }
  td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
  tr:nth-child(even) { background: #f8fafc; }
  tr.let-header td { background: #1e293b; color: #f1f5f9; font-weight: 900; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.1em; padding: 5px 6px; }
  .nominations { margin-top: 20px; border-top: 2px solid #eab308; padding-top: 12px; }
  .nominations h3 { font-size: 11pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; color: #92400e; margin-bottom: 8px; }
  .nom-company { margin-bottom: 12px; }
  .nom-company-name { font-weight: 900; font-size: 9pt; text-transform: uppercase; margin-bottom: 4px; color: #334155; }
  .nom-table { width: auto; min-width: 400px; }
  .nom-table th { font-size: 7pt; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>${boardTitle}</h1>
<p class="meta">Board Date: ${boardDate} · Printed: ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})} · ${visibleScores.length} cadet${visibleScores.length !== 1 ? 's' : ''}</p>
<table>
  <thead>
    <tr>
      <th>Cadet</th>
      ${colHeaders}
    </tr>
  </thead>
  <tbody>${tableHtml}</tbody>
</table>
${nomHtml}
</body>
</html>`;

    const w = window.open('', '_blank', 'width=1100,height=800');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
    setShowPrintModal(false);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────────
  // Creates the board as a DRAFT — no score docs yet, no roster fetch.
  // Battalion can edit title, date, and categories before opening to companies.
  const handleCreateBoard = async () => {
    if (!createForm.title.trim() || !createForm.boardDate) return;
    setCreating(true);
    try {
      const boardRef = doc(collection(db, 'promotionBoards'));
      await writeBatch(db).set(boardRef, {
        title:                createForm.title.trim(),
        boardDate:            Timestamp.fromDate(new Date(createForm.boardDate)),
        status:               'draft',
        categories:           DEFAULT_CATEGORIES,
        maxExtraCredit:       MAX_EC,
        totalPossible:        TOTAL_MAX,
        positionRequirements: DEFAULT_POSITION_REQUIREMENTS,
        createdBy:            auth.currentUser.uid,
        createdByName:        userData?.fullName || '',
        createdAt:            Timestamp.now(),
        // companyStatus and totalCadets are set when the board is opened
      }).commit();
      setShowCreate(false);
      setCreateForm({ title: '', boardDate: '' });
      // Navigate into the draft so battalion can prepare it
      setSelectedBoard({ id: boardRef.id, title: createForm.title.trim(),
        boardDate: Timestamp.fromDate(new Date(createForm.boardDate)),
        status: 'draft', categories: DEFAULT_CATEGORIES,
        maxExtraCredit: MAX_EC, totalPossible: TOTAL_MAX,
        positionRequirements: DEFAULT_POSITION_REQUIREMENTS });
      setView('detail');
    } catch (err) {
      console.error('Create board error:', err);
      alert('Failed to create promotion board draft.');
    } finally {
      setCreating(false);
    }
  };

  // Saves the current draft edits (title, date, categories, eligibility, position reqs) to Firestore.
  // Called on field blur and after add/remove category/requirement.
  const handleSaveDraft = async (catOverride, eligReqsOverride, posReqsOverride, dateOverride) => {
    if (!selectedBoard || selectedBoard.status !== 'draft') return;
    setSavingDraft(true);
    try {
      const cats    = catOverride     ?? draftCats;
      const reqs    = eligReqsOverride ?? draftEligReqs;
      const posReqs = posReqsOverride  ?? draftPosReqs;
      const dateVal = dateOverride ?? draftDate;
      const updates = {
        categories:            cats,
        totalPossible:         cats.length * 100 + MAX_EC,
        eligibilityReqs:       reqs,
        positionRequirements:  posReqs,
      };
      if (draftTitle.trim()) updates.title = draftTitle.trim();
      if (dateVal)           updates.boardDate = Timestamp.fromDate(new Date(dateVal));
      await updateDoc(doc(db, 'promotionBoards', selectedBoard.id), updates);
      // Mirror positionRequirements to pageContent so the public Promotion Board
      // page (which is publicly readable) shows the live board requirements.
      if (posReqs && Object.keys(posReqs).length > 0) {
        setDoc(doc(db, 'pageContent', 'promotion-board'),
          { positionRequirements: posReqs }, { merge: true })
          .catch(() => {}); // non-fatal — public page falls back gracefully
      }
    } catch (err) {
      console.error('Save draft error:', err);
      alert('Failed to save draft changes.');
    } finally {
      setSavingDraft(false);
    }
  };

  // Opens the board to companies: fetches roster, creates score docs, flips status to 'open'.
  const handleOpenBoard = async () => {
    if (!selectedBoard) return;
    if (!draftTitle.trim()) { alert('Please add a board title before opening.'); return; }
    if (!draftDate)          { alert('Please set a board date before opening.'); return; }
    if (draftCats.length === 0) { alert('At least one scoring category is required.'); return; }
    const ok = await confirm(
      `Open "${draftTitle.trim()}" to all companies? Cadets from the current roster will be added and every company will be able to view and enter scores. Categories cannot be changed after opening.`,
      { title: 'Open Promotion Board', destructive: false }
    );
    if (!ok) return;
    setOpeningBoard(true);
    try {
      const rosterSnap = await getDocs(collection(db, 'roster'));
      const cadets     = rosterSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (cadets.length > 495) {
        alert('Roster too large for a single batch (>495). Contact S6.');
        return;
      }

      const companyStatus = {};
      companies.forEach(co => { companyStatus[co] = { submitted: false }; });

      const batch = writeBatch(db);

      // Update board doc
      batch.update(doc(db, 'promotionBoards', selectedBoard.id), {
        title:                draftTitle.trim(),
        boardDate:            Timestamp.fromDate(new Date(draftDate)),
        status:               'open',
        categories:           draftCats,
        totalPossible:        draftCats.length * 100 + MAX_EC,
        eligibilityReqs:      draftEligReqs,
        positionRequirements: draftPosReqs,
        companyStatus,
        totalCadets:          cadets.length,
        openedAt:             Timestamp.now(),
        openedByName:         userData?.fullName || '',
      });

      // Create a score doc for every roster cadet
      const emptyScores = Object.fromEntries(draftCats.map(c => [c.id, null]));
      cadets.forEach(cadet => {
        const scoreRef = doc(collection(db, 'promotionScores'));
        batch.set(scoreRef, {
          boardId:       selectedBoard.id,
          rosterDocId:   cadet.id,
          linkedUid:     cadet.linkedUid || null,
          cadetName:     cadet.fullName  || '',
          rank:          cadet.rank      || '',
          position:      cadet.position  || '',
          company:       cadet.company   || '',
          letLevel:      cadet.letLevel  || '',
          scores:        { ...emptyScores },
          extraCredit:   0,
          totalScore:    0,
          notes:         '',
          updatedAt:     null,
          updatedByName: '',
        });
      });

      await batch.commit();
      // Mirror position requirements to pageContent so the public page reflects
      // whatever was configured in the draft.
      if (draftPosReqs && Object.keys(draftPosReqs).length > 0) {
        setDoc(doc(db, 'pageContent', 'promotion-board'),
          { positionRequirements: draftPosReqs }, { merge: true })
          .catch(() => {});
      }
      // selectedBoard will update from the onSnapshot/sync effect → view falls to open detail
    } catch (err) {
      console.error('Open board error:', err);
      alert('Failed to open promotion board.');
    } finally {
      setOpeningBoard(false);
    }
  };

  // Permanently deletes a board and all associated score records.
  const handleDeleteBoard = async () => {
    if (!selectedBoard) return;
    const isDraft = selectedBoard.status === 'draft';
    const msg = isDraft
      ? 'Delete this draft promotion board? This cannot be undone.'
      : `Delete "${selectedBoard.title || 'this board'}"? All score records for every cadet will also be permanently deleted. This cannot be undone.`;
    const ok = await confirm(msg, { title: isDraft ? 'Delete Draft Board' : 'Delete Board', destructive: true });
    if (!ok) return;

    // For open/closed boards, cascade-delete all promotionScores docs first.
    if (!isDraft) {
      const scoreSnap = await getDocs(
        query(collection(db, 'promotionScores'), where('boardId', '==', selectedBoard.id))
      );
      // writeBatch handles up to 500 ops; chunk if needed.
      const CHUNK = 499;
      const allDocs = scoreSnap.docs;
      for (let i = 0; i < allDocs.length; i += CHUNK) {
        const batch = writeBatch(db);
        allDocs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }

    await deleteDoc(doc(db, 'promotionBoards', selectedBoard.id));
    closeDetail();
  };

  const handleScoreChange = async (scoreDocId, catId, rawValue) => {
    const val = rawValue === '' || rawValue == null ? null
              : rawValue === 'na' ? 'na'
              : parseInt(rawValue);
    const current = scores.find(s => s.id === scoreDocId);
    if (!current) return;

    const cats      = selectedBoard?.categories || DEFAULT_CATEGORIES;
    const newScores = { ...(current.scores || {}), [catId]: val };
    const newTotal  = calcTotal(newScores, current.extraCredit, cats);
    const newPoss   = calcPossible(newScores, cats);

    await updateDoc(doc(db, 'promotionScores', scoreDocId), {
      [`scores.${catId}`]: val,
      totalScore:          newTotal,
      totalPossible:       newPoss,
      updatedAt:           Timestamp.now(),
      updatedByName:       userData?.fullName || '',
    }).then(() => showSaved()).catch(err => console.error('Score save error:', err));
  };

  const handleExtraCreditBlur = async (scoreDocId, value) => {
    const current = scores.find(s => s.id === scoreDocId);
    if (!current) return;

    const cats    = selectedBoard?.categories || DEFAULT_CATEGORIES;
    const newTotal = calcTotal(current.scores, value, cats);
    const newPoss  = calcPossible(current.scores, cats);
    await updateDoc(doc(db, 'promotionScores', scoreDocId), {
      extraCredit:   value,
      totalScore:    newTotal,
      totalPossible: newPoss,
      updatedAt:     Timestamp.now(),
      updatedByName: userData?.fullName || '',
    }).then(() => showSaved()).catch(err => console.error('Extra credit save error:', err));
  };

  const handleSaveBoardSettings = async () => {
    if (!selectedBoard || !editBoardForm.title.trim()) return;
    try {
      const updates = { title: editBoardForm.title.trim() };
      if (editBoardForm.boardDate) {
        updates.boardDate = Timestamp.fromDate(new Date(editBoardForm.boardDate + 'T12:00:00'));
      }
      await updateDoc(doc(db, 'promotionBoards', selectedBoard.id), updates);
      setEditBoardSettings(false);
    } catch (err) {
      console.error('Board settings save error:', err);
    }
  };

  const handleSubmitCompany = async () => {
    if (!selectedBoard || !myCompany) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'promotionBoards', selectedBoard.id), {
        [`companyStatus.${myCompany}.submitted`]:      true,
        [`companyStatus.${myCompany}.submittedAt`]:    Timestamp.now(),
        [`companyStatus.${myCompany}.submittedByName`]: userData?.fullName || '',
      });
    } catch (err) {
      console.error('Submit error:', err);
      alert('Failed to submit scores.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseBoard = async () => {
    if (!selectedBoard) return;
    const ok = await confirm('Close this promotion board? All scores will be locked. This cannot be undone.', { title: 'Close Board', destructive: true });
    if (!ok) return;
    await updateDoc(doc(db, 'promotionBoards', selectedBoard.id), { status: 'closed' });
  };

  // ── Run-Promotions helpers ────────────────────────────────────────────────────

  // Lazy-load (and cache) the full roster so the promo modal doesn't block render.
  const openPromoModal = async () => {
    if (!rosterCache) {
      const snap = await getDocs(collection(db, 'roster'));
      const map  = {};
      snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
      setRosterCache(map);
    }
    setPromoNum(1);
    setPromoCustomConfirmed({});
    setPromoModal(false); // reset then open so state is fresh
    setTimeout(() => setPromoModal(true), 0);
  };

  // Returns the list of cadets who completed the board, meet eligibility requirements,
  // and have a rank below their promotion target.
  const promoEligible = useMemo(() => {
    if (!promoModal || !rosterCache || !selectedBoard) return [];
    const cats = selectedBoard.categories || DEFAULT_CATEGORIES;
    const reqs = selectedBoard.eligibilityReqs || { requireForms: true, requireCC: true };
    return scores
      .filter(s => {
        // Must have a score for every category (board was completed for this cadet)
        const boardDone = cats.every(cat => s.scores?.[cat.id] != null && s.scores[cat.id] !== '');
        if (!boardDone) return false;
        // Eligibility requirements (forms + CC) per board configuration
        if (reqs.requireForms && pendingFormMap[s.rosterDocId]) return false;
        if (reqs.requireCC    && !ccCompleteMap[s.rosterDocId])  return false;
        // Roster entry must exist
        const entry = rosterCache[s.rosterDocId];
        if (!entry) return false;
        // Must have a valid promotion target above current rank
        const target = boardTargetRank(entry.position, promoNum);
        if (!target) return false;
        const curIdx = JROTC_RANKS.indexOf(entry.rank);
        const tgtIdx = JROTC_RANKS.indexOf(target);
        return curIdx >= 0 && curIdx < tgtIdx;
      })
      .map(s => {
        const entry = rosterCache[s.rosterDocId];
        return {
          ...s,
          rosterEntry: entry,
          targetRank: boardTargetRank(entry.position, promoNum),
        };
      })
      .sort((a, b) =>
        (a.rosterEntry?.company || '').localeCompare(b.rosterEntry?.company || '') ||
        a.cadetName.localeCompare(b.cadetName)
      );
  }, [promoModal, rosterCache, selectedBoard, scores, promoNum, pendingFormMap, ccCompleteMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const runPromo = async () => {
    if (!promoEligible.length) return;
    setPromoRunning(true);
    try {
      await Promise.all(promoEligible.map(async cadet => {
        await updateDoc(doc(db, 'roster', cadet.rosterDocId), { rank: cadet.targetRank });
        if (cadet.rosterEntry?.linkedUid) {
          try { await updateDoc(doc(db, 'users', cadet.rosterEntry.linkedUid), { rank: cadet.targetRank }); }
          catch { /* non-fatal */ }
        }
      }));
      await writeLog({
        type: 'roster', action: 'update',
        description: `Promotion Board ${promoNum} run from "${selectedBoard?.title}" — ${promoEligible.length} cadet${promoEligible.length !== 1 ? 's' : ''} promoted`,
        userId: auth.currentUser?.uid || '', userFullName: userData?.fullName || '', userRole: role || '',
        targetId: selectedBoard?.id || '', targetName: selectedBoard?.title || '',
      });
      setPromoModal(false);
    } catch (err) {
      console.error('Promotion failed:', err);
      alert('Promotion failed — check console and try again.');
    } finally {
      setPromoRunning(false);
    }
  };

  // S1 only: unlock (un-submit) a company's scores so the XO can make corrections
  const handleUnlockCompany = async (company) => {
    if (!selectedBoard || !isS1) return;
    const ok = await confirm(`Unlock ${company} Company's submitted scores? Their XO will be able to make changes again.`, { title: 'Unlock Company Scores', destructive: false });
    if (!ok) return;
    setUnlocking(company);
    try {
      await updateDoc(doc(db, 'promotionBoards', selectedBoard.id), {
        [`companyStatus.${company}.submitted`]:      false,
        [`companyStatus.${company}.unlockedAt`]:     Timestamp.now(),
        [`companyStatus.${company}.unlockedByName`]: userData?.fullName || '',
      });
    } catch (err) {
      console.error('Unlock error:', err);
      alert('Failed to unlock company scores.');
    } finally {
      setUnlocking(null);
    }
  };

  const openDetail = (board) => {
    setSelectedBoard(board);
    setView('detail');
    setMinScore(0);
    setMaxScore(TOTAL_MAX);
    setCompanyFil('all');
  };

  const closeDetail = () => {
    setView('list');
    setSelectedBoard(null);
    setScores([]);
    setEditBoardSettings(false);
  };

  // ════════════════════════════════════════════════════════════════════════════════
  // DRAFT DETAIL VIEW  (battalion only — company users never see draft boards)
  // ════════════════════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedBoard?.status === 'draft') {
    const totalMax = draftCats.length * 100 + MAX_EC;

    // Auto-save helpers called on explicit user actions (blur / add / remove)
    const saveDraft = (catOverride) => handleSaveDraft(catOverride);

    // ── Position-requirements helpers (draft view only) ──────────────────────
    const addPosReqItem = () => {
      const label = draftPosReqInput.trim();
      if (!label || !draftPosReqPos) return;
      const prev  = draftPosReqs[draftPosReqPos] || { items: [], notes: '' };
      const next  = { ...draftPosReqs, [draftPosReqPos]: { ...prev, items: [...prev.items, label] } };
      setDraftPosReqs(next);
      setDraftPosReqInput('');
      handleSaveDraft(undefined, undefined, next);
    };
    const removePosReqItem = (pos, idx) => {
      const prev  = draftPosReqs[pos] || { items: [], notes: '' };
      const items = prev.items.filter((_, i) => i !== idx);
      const next  = { ...draftPosReqs, [pos]: { ...prev, items } };
      setDraftPosReqs(next);
      handleSaveDraft(undefined, undefined, next);
    };
    // Edit the text of an existing item (saves on blur)
    const updatePosReqItem = (pos, idx, value) => {
      const prev  = draftPosReqs[pos] || { items: [], notes: '' };
      const items = prev.items.map((it, i) => i === idx ? value : it);
      const next  = { ...draftPosReqs, [pos]: { ...prev, items } };
      setDraftPosReqs(next);
      return next; // caller uses this to trigger save on blur
    };
    // Move an item up (-1) or down (+1) within the list
    const movePosReqItem = (pos, idx, dir) => {
      const prev  = draftPosReqs[pos] || { items: [], notes: '' };
      const items = [...prev.items];
      const target = idx + dir;
      if (target < 0 || target >= items.length) return;
      [items[idx], items[target]] = [items[target], items[idx]];
      const next  = { ...draftPosReqs, [pos]: { ...prev, items } };
      setDraftPosReqs(next);
      handleSaveDraft(undefined, undefined, next);
    };
    const updatePosReqNotes = (pos, notes) => {
      const prev = draftPosReqs[pos] || { items: [], notes: '' };
      const next = { ...draftPosReqs, [pos]: { ...prev, notes } };
      setDraftPosReqs(next);
      // will be saved on textarea blur via handleSaveDraft()
    };

    const handleAddCat = () => {
      const label = draftCatInput.trim();
      if (!label) return;
      const newCat  = { id: `cat_${Date.now()}`, label };
      const newCats = [...draftCats, newCat];
      setDraftCats(newCats);
      setDraftCatInput('');
      saveDraft(newCats);
    };

    const handleRemoveCat = (id) => {
      const newCats = draftCats.filter(c => c.id !== id);
      setDraftCats(newCats);
      saveDraft(newCats);
    };

    const handleRenameCat = (id, label) => {
      setDraftCats(prev => prev.map(c => c.id === id ? { ...c, label } : c));
    };

    return (
      <div>
        {/* Back */}
        <button
          onClick={closeDetail}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors mb-6"
        >
          <ChevronLeft size={13} /> Back to Boards
        </button>

        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-1 rounded-full">
                Draft
              </span>
              <span className="text-[9px] text-slate-400 dark:text-slate-500">
                Not visible to companies · Prepare and edit freely before opening
              </span>
              {savingDraft && (
                <span className="text-[9px] text-slate-400 dark:text-slate-500 animate-pulse">Saving…</span>
              )}
            </div>
            <input
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={() => saveDraft()}
              placeholder="Board title…"
              className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white bg-transparent border-b-2 border-dashed border-slate-200 dark:border-white/10 focus:border-yellow-500 dark:focus:border-yellow-500 outline-none w-full max-w-lg pb-1 transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDeleteBoard}
              className="text-xs font-black uppercase tracking-wider text-red-400 hover:text-red-600 dark:hover:text-red-400 px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
            >
              Delete Draft
            </button>
            <button
              onClick={handleOpenBoard}
              disabled={openingBoard || !draftTitle.trim() || !draftDate}
              className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-black uppercase tracking-wider px-5 py-2.5 rounded-xl transition-colors"
            >
              {openingBoard
                ? 'Opening…'
                : (<><Lock size={12} className="opacity-60" /> Open to Companies <ChevronRight size={13} /></>)
              }
            </button>
          </div>
        </div>

        {/* Edit panels */}
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">

          {/* Board Date */}
          <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-6">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Board Date</p>
            <DatePicker
              value={draftDate}
              onChange={v => { setDraftDate(v); handleSaveDraft(undefined, undefined, undefined, v); }}
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-3 leading-relaxed">
              All cadets in the current roster will be added when you open the board. The roster snapshot is taken at that moment.
            </p>
          </div>

          {/* Category editor */}
          <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-3 gap-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Scoring Categories
              </p>
              <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap">
                {draftCats.length} × 100 = {draftCats.length * 100} base + up to 100 EC
              </span>
            </div>

            <div className="space-y-1.5 mb-3 max-h-64 overflow-y-auto pr-1">
              {draftCats.map((cat, i) => (
                <div key={cat.id} className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-slate-300 dark:text-slate-600 w-5 shrink-0 text-right">{i + 1}.</span>
                  <input
                    value={cat.label}
                    onChange={e => handleRenameCat(cat.id, e.target.value)}
                    onBlur={() => saveDraft()}
                    className="flex-1 bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white outline-none focus:border-yellow-500/40 transition-colors"
                  />
                  <button
                    onClick={() => handleRemoveCat(cat.id)}
                    title="Remove category"
                    className="shrink-0 p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add category */}
            <div className="flex gap-2 pt-3 border-t border-slate-100 dark:border-white/5">
              <input
                value={draftCatInput}
                onChange={e => setDraftCatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddCat()}
                placeholder="New category name…"
                className="flex-1 bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
              />
              <button
                onClick={handleAddCat}
                disabled={!draftCatInput.trim()}
                className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-950 text-xs font-black rounded-lg transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* Eligibility Requirements */}
          <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-6 flex flex-col gap-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
                Promotion Eligibility
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                Cadets must meet these requirements to appear eligible when "Run Promotions" is triggered.
              </p>
            </div>

            {/* System gates (auto-checked against Firestore) */}
            <div className="space-y-3">
              {[
                { key: 'requireForms', label: 'Forms complete',           sub: 'No outstanding active form events' },
                { key: 'requireCC',    label: 'Cadet Challenge complete', sub: 'All CC events entered in the system' },
              ].map(({ key, label, sub }) => {
                const checked = draftEligReqs[key] !== false;
                const toggle = () => {
                  const next = { ...draftEligReqs, [key]: !checked };
                  setDraftEligReqs(next);
                  saveDraft(undefined, next);
                };
                return (
                  <label key={key} className="flex items-start gap-3 cursor-pointer group">
                    <button type="button" role="checkbox" aria-checked={checked} onClick={toggle}
                      className={`mt-0.5 w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-all ${checked ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-slate-600 bg-transparent group-hover:border-yellow-400'}`}>
                      {checked && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-900"/></svg>}
                    </button>
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-none">{label}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{sub}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Custom requirements (manual confirmation at promo time) */}
            {(draftEligReqs.custom || []).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-white/5">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Custom — confirmed manually at promotion time
                </p>
                {(draftEligReqs.custom || []).map(req => (
                  <div key={req.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-white/5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">{req.label}</p>
                      {req.description && <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{req.description}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...draftEligReqs, custom: (draftEligReqs.custom || []).filter(r => r.id !== req.id) };
                        setDraftEligReqs(next);
                        saveDraft(undefined, next);
                      }}
                      className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add custom requirement */}
            <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">Add requirement</p>
              <input
                value={draftCustomReqForm.label}
                onChange={e => setDraftCustomReqForm(f => ({ ...f, label: e.target.value }))}
                placeholder="Requirement label…"
                className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
              />
              <input
                value={draftCustomReqForm.description}
                onChange={e => setDraftCustomReqForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description…"
                className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
              />
              <button
                type="button"
                disabled={!draftCustomReqForm.label.trim()}
                onClick={() => {
                  const newReq = { id: `cust_${Date.now()}`, label: draftCustomReqForm.label.trim(), description: draftCustomReqForm.description.trim() };
                  const next   = { ...draftEligReqs, custom: [...(draftEligReqs.custom || []), newReq] };
                  setDraftEligReqs(next);
                  setDraftCustomReqForm({ label: '', description: '' });
                  saveDraft(undefined, next);
                }}
                className="w-full py-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-950 text-xs font-black rounded-lg transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Position Requirements panel */}
        <div className="mt-6 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-6">
          <div className="mb-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
              Position Requirements
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
              What each position must demonstrate at the board. Shown to proctors during Testing Mode and on the public Promotion Board page.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-0">
            {/* Position list */}
            <div className="md:border-r border-slate-100 dark:border-white/5 md:pr-5 mb-5 md:mb-0">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Positions</p>
              <div className="space-y-0.5 max-h-80 overflow-y-auto pr-1">
                {JROTC_POSITIONS.map(pos => {
                  const count = (draftPosReqs[pos]?.items || []).length;
                  const active = draftPosReqPos === pos;
                  return (
                    <button
                      key={pos}
                      onClick={() => { setDraftPosReqPos(pos); setDraftPosReqInput(''); }}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-all flex items-center justify-between gap-2 ${
                        active
                          ? 'bg-yellow-500 text-slate-950 font-black'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                      }`}
                    >
                      <span className="truncate">{pos}</span>
                      {count > 0 && (
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${
                          active
                            ? 'bg-slate-950/20 text-slate-950'
                            : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                        }`}>
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Requirements editor */}
            <div className="md:col-span-2 md:pl-5">
              {draftPosReqPos ? (
                <>
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <p className="text-sm font-black text-slate-900 dark:text-white truncate">{draftPosReqPos}</p>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 shrink-0">
                      {(draftPosReqs[draftPosReqPos]?.items || []).length} item{(draftPosReqs[draftPosReqPos]?.items || []).length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Item list */}
                  <div className="space-y-1.5 mb-3 max-h-64 overflow-y-auto pr-1">
                    {(draftPosReqs[draftPosReqPos]?.items || []).length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-600 italic py-2">No requirements set — add one below.</p>
                    ) : (
                      (draftPosReqs[draftPosReqPos]?.items || []).map((item, i, arr) => (
                        <div key={i} className="flex items-center gap-1.5">
                          {/* Reorder buttons */}
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button
                              type="button"
                              disabled={i === 0}
                              onClick={() => movePosReqItem(draftPosReqPos, i, -1)}
                              className="w-5 h-4 flex items-center justify-center rounded text-slate-300 dark:text-slate-600 hover:text-yellow-500 disabled:opacity-20 disabled:pointer-events-none transition-colors"
                              title="Move up"
                            >
                              <ChevronUp size={11} />
                            </button>
                            <button
                              type="button"
                              disabled={i === arr.length - 1}
                              onClick={() => movePosReqItem(draftPosReqPos, i, 1)}
                              className="w-5 h-4 flex items-center justify-center rounded text-slate-300 dark:text-slate-600 hover:text-yellow-500 disabled:opacity-20 disabled:pointer-events-none transition-colors"
                              title="Move down"
                            >
                              <ChevronDown size={11} />
                            </button>
                          </div>
                          <span className="text-[9px] font-bold text-slate-300 dark:text-slate-600 w-4 shrink-0 text-right">{i + 1}.</span>
                          <input
                            value={item}
                            onChange={e => updatePosReqItem(draftPosReqPos, i, e.target.value)}
                            onBlur={e => {
                              const next = updatePosReqItem(draftPosReqPos, i, e.target.value);
                              handleSaveDraft(undefined, undefined, next);
                            }}
                            className="flex-1 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-transparent focus:border-yellow-500/40 px-3 py-1.5 rounded-lg outline-none transition-colors"
                          />
                          <button
                            onClick={() => removePosReqItem(draftPosReqPos, i)}
                            className="shrink-0 p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                            title="Remove"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add item */}
                  <div className="flex gap-2 mb-4">
                    <input
                      value={draftPosReqInput}
                      onChange={e => setDraftPosReqInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addPosReqItem()}
                      placeholder="Add a requirement…"
                      className="flex-1 bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
                    />
                    <button
                      onClick={addPosReqItem}
                      disabled={!draftPosReqInput.trim()}
                      className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-950 text-xs font-black rounded-lg transition-colors"
                    >
                      Add
                    </button>
                  </div>

                  {/* Notes */}
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">Notes (optional)</p>
                    <textarea
                      value={draftPosReqs[draftPosReqPos]?.notes || ''}
                      onChange={e => updatePosReqNotes(draftPosReqPos, e.target.value)}
                      onBlur={() => handleSaveDraft(undefined, undefined, draftPosReqs)}
                      rows={2}
                      placeholder="Any special notes for this position…"
                      className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors resize-none leading-relaxed"
                    />
                  </div>
                </>
              ) : (
                <p className="text-slate-400 dark:text-slate-600 text-sm text-center py-12">Select a position to edit its requirements</p>
              )}
            </div>
          </div>
        </div>

        {/* Info notice */}
        <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl flex items-start gap-3">
          <AlertCircle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={15} />
          <div>
            <p className="text-xs font-black text-amber-700 dark:text-amber-400 mb-1">Ready to open?</p>
            <p className="text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
              Clicking <strong>Open to Companies</strong> will snapshot the current roster, create score entries for every cadet, and grant all companies access to view and input their scores. <strong>Categories cannot be changed after opening.</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // BOARD DETAIL VIEW  (open / closed)
  // ════════════════════════════════════════════════════════════════════════════════
  if (view === 'detail' && selectedBoard) {
    const isClosed    = selectedBoard.status === 'closed';
    const displayScores = isBattalionLevel ? filteredScores : visibleScores;

    return (
      <>
      <div>
        {/* Back + header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <button
              onClick={closeDetail}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors mb-3"
            >
              <ChevronLeft size={13} /> Back to Boards
            </button>
            {editBoardSettings ? (
              <div className="space-y-2 mt-1">
                <input
                  value={editBoardForm.title}
                  onChange={e => setEditBoardForm(f => ({ ...f, title: e.target.value }))}
                  className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm font-black text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors w-72 max-w-full"
                  placeholder="Board title"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="date"
                    value={editBoardForm.boardDate}
                    onChange={e => setEditBoardForm(f => ({ ...f, boardDate: e.target.value }))}
                    className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors"
                  />
                  <button onClick={handleSaveBoardSettings} className="px-3 py-1.5 rounded-xl bg-yellow-500 hover:bg-yellow-400 text-slate-950 text-xs font-black uppercase tracking-widest transition-colors">Save</button>
                  <button onClick={() => setEditBoardSettings(false)} className="px-3 py-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs font-black uppercase tracking-widest transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                  {selectedBoard.title}
                </h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${isClosed ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' : 'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-500'}`}>
                    {isClosed ? 'Closed' : 'Open'}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                    Board Date: {fmtDate(selectedBoard.boardDate)}
                  </span>
                  <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">
                    {selectedBoard.totalCadets ?? '—'} cadets
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Top 3: Testing Mode button */}
            {canUseTesting && !isClosed && (
              <button
                onClick={startTesting}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
              >
                <ClipboardList size={13} /> Testing Mode
              </button>
            )}
            {/* XO: submit button */}
            {canEnterScores && !isBattalionLevel && !isClosed && (
              myCompanySubmitted ? (
                <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-4 py-2 rounded-xl border border-green-200 dark:border-green-500/20">
                  <CheckCircle2 size={13} /> Scores Submitted
                </span>
              ) : (
                <button
                  onClick={handleSubmitCompany}
                  disabled={submitting}
                  className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-950 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
                >
                  {submitting ? 'Submitting…' : 'Submit Scores'}
                </button>
              )
            )}
            {/* S1: close board button */}
            {canCloseBoard && !isClosed && (
              <button
                onClick={handleCloseBoard}
                className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors border border-slate-200 dark:border-white/5"
              >
                Close Board
              </button>
            )}
            {/* S1: run promotions (closed board only) */}
            {canCreateBoard && isClosed && (
              <button
                onClick={openPromoModal}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
              >
                <TrendingUp size={13} /> Run Promotions
              </button>
            )}
            {/* S1: edit settings (title + date) */}
            {canCreateBoard && !editBoardSettings && (
              <button
                onClick={() => {
                  setEditBoardForm({ title: selectedBoard.title || '', boardDate: tsToDateStr(selectedBoard.boardDate) });
                  setEditBoardSettings(true);
                }}
                className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors border border-slate-200 dark:border-white/5"
              >
                Edit Settings
              </button>
            )}
            {/* Print roster */}
            <button
              onClick={() => setShowPrintModal(true)}
              className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors border border-slate-200 dark:border-white/5"
            >
              <Printer size={13} /> Print Roster
            </button>
            {/* S1: delete board (open or closed) */}
            {canCreateBoard && (
              <button
                onClick={handleDeleteBoard}
                className="text-xs font-black uppercase tracking-wider text-red-400 hover:text-red-600 dark:hover:text-red-400 px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
              >
                Delete Board
              </button>
            )}
          </div>
        </div>

        {/* Company submission status */}
        {companyStatusSummary.length > 0 && (
          <div className="mb-6">
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-600 mb-2">
              Company Submissions — {submittedCount}/{companyStatusSummary.length}
            </p>
            <div className="flex flex-wrap gap-2">
              {companyStatusSummary.map(cs => (
                <div key={cs.company} className="flex items-center gap-1">
                  <div
                    className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full border ${
                      cs.submitted
                        ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-white/5'
                    }`}
                  >
                    {cs.submitted ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                    {normalizeCompany(cs.company)}
                    {cs.submitted && cs.submittedByName && (
                      <span className="font-normal opacity-70">— {cs.submittedByName}</span>
                    )}
                  </div>
                  {/* S1 can unlock a submitted company so the XO can correct scores */}
                  {isS1 && cs.submitted && selectedBoard?.status === 'open' && (
                    <button
                      onClick={() => handleUnlockCompany(cs.company)}
                      disabled={unlocking === cs.company}
                      title={`Unlock ${cs.company} Company's scores`}
                      className="p-1 rounded-full text-slate-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-all disabled:opacity-40"
                    >
                      <Unlock size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All-submitted notice for S1 */}
        {allSubmitted && !isClosed && canCloseBoard && (
          <div className="mb-6 p-4 bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/20 rounded-2xl flex items-center gap-3">
            <CheckCircle2 className="text-green-600 dark:text-green-400 shrink-0" size={16} />
            <p className="text-xs font-bold text-green-700 dark:text-green-400">
              All companies have submitted their scores. You can now close the board.
            </p>
          </div>
        )}

        {/* Filter / grouping bar — battalion gets score + company filters; everyone gets Group by LET */}
        <div className="flex items-center gap-3 mb-4 flex-wrap bg-blue-50/50 dark:bg-slate-800/50 rounded-2xl p-3">
          {isBattalionLevel && (
            <>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mr-1">Filter:</p>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-400">Min Score</label>
                <input
                  type="number"
                  min={0} max={TOTAL_MAX}
                  value={minScore}
                  onChange={e => setMinScore(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-20 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors text-center"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-400">Max Score</label>
                <input
                  type="number"
                  min={0} max={TOTAL_MAX}
                  value={maxScore}
                  onChange={e => setMaxScore(Math.min(TOTAL_MAX, parseInt(e.target.value) || TOTAL_MAX))}
                  className="w-20 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-colors text-center"
                />
              </div>
              <select
                value={companyFil}
                onChange={e => setCompanyFil(e.target.value)}
                className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
              >
                <option value="all">All Companies</option>
                {companies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </>
          )}

          {/* Group by LET — available to all users */}
          <button
            onClick={() => setGroupLet(g => !g)}
            className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all ${
              groupLet
                ? 'bg-yellow-500 border-yellow-500 text-slate-950'
                : 'border-blue-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20'
            }`}
          >
            Group by LET
          </button>

          <p className="text-[10px] text-slate-400 ml-auto">{displayScores.length} cadet{displayScores.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Submitted warning for XO */}
        {myCompanySubmitted && canEnterScores && !isBattalionLevel && !isClosed && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20 rounded-2xl flex items-center gap-3">
            <AlertCircle className="text-blue-500 shrink-0" size={16} />
            <p className="text-xs font-bold text-blue-700 dark:text-blue-400">
              Your company's scores have been submitted and are now read-only.
              Contact the S1 Adjutant if you need to make changes.
            </p>
          </div>
        )}

        {/* ── TESTING MODE OVERLAY ─────────────────────────────────────────── */}
        {testMode && (
          <div className="fixed inset-0 z-50 bg-slate-950/95 flex flex-col items-center justify-center p-6">

            {/* ── PHASE: PICK CADET ──────────────────────────────────────────── */}
            {testMode.phase === 'pick' && (
              <div className="w-full max-w-md">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-400 mb-1">Testing Mode</p>
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Select Cadet</h2>
                  </div>
                  <button onClick={exitTesting} className="text-slate-500 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/5">
                    <X size={20} />
                  </button>
                </div>

                <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 mb-4">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-2">
                    Cadet Being Evaluated
                  </label>
                  {(() => {
                    const sorted = [...visibleScores].sort((a, b) => (a.cadetName || '').localeCompare(b.cadetName || ''));
                    const q = cadetSearch.trim().toLowerCase();
                    const filtered = q.length >= 2
                      ? sorted.filter(s => (s.cadetName || '').toLowerCase().includes(q))
                      : [];
                    const selected = sorted.find(s => s.id === testMode.scoreDocId);
                    return (
                      <div className="relative">
                        <input
                          type="text"
                          placeholder={selected ? selected.cadetName : 'Type a name…'}
                          value={cadetSearch}
                          onChange={e => { setCadetSearch(e.target.value); if (testMode.scoreDocId) testPickCadet(''); }}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-yellow-500 transition-colors"
                        />
                        {selected && !cadetSearch && (
                          <div className="mt-2 px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-sm font-bold text-yellow-300">
                            {selected.cadetName}{selected.rank ? ` · ${selected.rank}` : ''}{isBattalionLevel && selected.company ? ` · ${selected.company}` : ''}
                          </div>
                        )}
                        {filtered.length > 0 && (
                          <ul className="absolute z-10 mt-1 w-full bg-slate-800 border border-white/10 rounded-xl overflow-hidden shadow-xl max-h-56 overflow-y-auto">
                            {filtered.map(s => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  onClick={() => { testPickCadet(s.id); setCadetSearch(''); }}
                                  className="w-full text-left px-4 py-2.5 text-sm text-slate-200 hover:bg-yellow-500 hover:text-slate-950 transition-colors font-bold"
                                >
                                  {s.cadetName}{s.rank ? ` · ${s.rank}` : ''}{isBattalionLevel && s.company ? ` · ${s.company}` : ''}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {q.length >= 2 && filtered.length === 0 && (
                          <p className="mt-2 text-xs text-slate-500 italic px-1">No cadets found</p>
                        )}
                      </div>
                    );
                  })()}

                  {testMode.scoreDocId && (() => {
                    const testPosReqs = posReqs[testMode.position] ?? DEFAULT_POSITION_REQUIREMENTS[testMode.position];
                    const hasReqs = testPosReqs && (testPosReqs.items?.length > 0 || testPosReqs.notes);
                    const requiredCatIds = testPosReqs?.requiredCategories;
                    const effectiveCats = (requiredCatIds && requiredCatIds.length > 0)
                      ? testMode.categories.filter(c => requiredCatIds.includes(c.id))
                      : testMode.categories;
                    return (
                      <>
                        <div className="mt-4 p-3 bg-white/5 rounded-xl">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Board Overview</p>
                          <p className="text-xs text-slate-300">
                            {effectiveCats.length} categories · 100 pts each · up to 100 extra credit
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Base max: <span className="font-black text-yellow-500">{effectiveCats.length * 100}</span>
                            <span className="mx-1 text-slate-600">+</span>
                            <span className="text-slate-300">up to 100 EC</span>
                          </p>
                        </div>
                        {testMode.position && (
                          <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                            <p className="text-[9px] font-black uppercase tracking-widest text-yellow-400 mb-1">
                              Position: {testMode.position}
                            </p>
                            {hasReqs ? (
                              <>
                                {testPosReqs.items?.length > 0 && (
                                  <ul className="space-y-1 mb-1">
                                    {testPosReqs.items.map((item, i) => (
                                      <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                        <span className="text-yellow-500 mt-0.5 shrink-0">·</span>
                                        {item}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {testPosReqs.notes && (
                                  <p className="text-[10px] text-slate-400 italic mt-1 leading-snug">{testPosReqs.notes}</p>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-slate-500 italic">No specific requirements configured for this position.</p>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <button
                  onClick={testBeginQuestions}
                  disabled={!testMode.scoreDocId}
                  className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-colors flex items-center justify-center gap-2"
                >
                  Begin Board <ChevronRight size={16} />
                </button>
              </div>
            )}

            {/* ── PHASE: QUESTION (per category) ──────────────────────────────── */}
            {testMode.phase === 'question' && (() => {
              const cat  = testMode.categories[testMode.step];
              const total = testMode.categories.length;
              const pct   = Math.round((testMode.step / total) * 100);
              const testPosReqs2 = posReqs[testMode.position] ?? DEFAULT_POSITION_REQUIREMENTS[testMode.position];
              const hasReqs = testPosReqs2 && (testPosReqs2.items?.length > 0 || testPosReqs2.notes);
              const catCount    = testPosReqs2?.requiredCounts?.[cat?.id];
              const catTotal    = testPosReqs2?.requiredTotals?.[cat?.id];
              const catCoCPos   = (cat?.id === 'chain_of_command') ? (testPosReqs2?.requiredCoCPositions ?? []) : [];
              const OPTS  = [
                { n: 0, label: '0 mistakes',  score: 100, color: 'bg-green-500 hover:bg-green-400 text-white'  },
                { n: 1, label: '1 mistake',   score:  90, color: 'bg-yellow-500 hover:bg-yellow-400 text-slate-950' },
                { n: 2, label: '2 mistakes',  score:  80, color: 'bg-orange-500 hover:bg-orange-400 text-white'  },
                { n: 3, label: '3+ mistakes', score:   0, color: 'bg-red-600 hover:bg-red-500 text-white'   },
              ];
              return (
                <div className="w-full max-w-lg">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-400 mb-0.5">
                        Testing Mode · {testMode.cadetName}
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        Category {testMode.step + 1} of {total}
                      </p>
                    </div>
                    <button onClick={exitTesting} className="text-slate-500 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/5">
                      <X size={18} />
                    </button>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 bg-slate-800 rounded-full mb-8 overflow-hidden">
                    <div
                      className="h-full bg-yellow-500 rounded-full transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Category prompt */}
                  <div className="bg-slate-900 border border-white/10 rounded-2xl p-8 mb-6 text-center">
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">Ask the cadet</p>
                    <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white leading-tight">
                      {cat?.label}
                    </h2>
                    {catCount && (
                      <p className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-yellow-500/15 border border-yellow-500/30 rounded-full text-yellow-400 text-[10px] font-black uppercase tracking-wider">
                        Must know {catCount}{catTotal ? `/${catTotal}` : ''} items
                      </p>
                    )}
                    {catCoCPos.length > 0 && (
                      <div className="mt-3 text-left mx-auto max-w-xs">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Required positions</p>
                        <div className="space-y-1">
                          {catCoCPos.map(pos => (
                            <p key={pos} className="text-xs text-slate-300 flex items-center gap-2">
                              <span className="w-1 h-1 rounded-full bg-yellow-500 shrink-0" />
                              {pos}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Position requirements reference (collapsible) */}
                  {testMode.position && hasReqs && (
                    <details className="mb-4 group">
                      <summary className="cursor-pointer flex items-center justify-between px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-[9px] font-black uppercase tracking-widest text-yellow-400 select-none list-none">
                        <span>Requirements — {testMode.position}</span>
                        <span className="group-open:rotate-180 transition-transform duration-200 text-yellow-500">▾</span>
                      </summary>
                      <div className="mt-2 p-3 bg-white/5 rounded-xl space-y-1">
                        {testPosReqs2.items?.map((item, i) => (
                          <p key={i} className="flex items-start gap-2 text-xs text-slate-300">
                            <span className="text-yellow-500 shrink-0 mt-0.5">·</span>{item}
                          </p>
                        ))}
                        {testPosReqs2.notes && (
                          <p className="text-[10px] text-slate-400 italic mt-1 leading-snug pt-1 border-t border-white/5">{testPosReqs2.notes}</p>
                        )}
                      </div>
                    </details>
                  )}

                  {/* Answer key (collapsible) */}
                  {(() => {
                    let keyLines = ANSWER_KEY[cat?.id]?.lines ?? null;

                    if (cat?.id === 'sai' && instructors.length > 0) {
                      const sai = instructors.filter(i => i.type === 'SAI');
                      keyLines = [
                        'SAI (Senior Army Instructor) — Commissioned or warrant officer; commands the program.',
                        ...(sai.length ? sai.map(i => `SAI: ${i.name}`) : ['SAI: (none on record)']),
                      ];
                    }

                    if (cat?.id === 'ai' && instructors.length > 0) {
                      const ai = instructors.filter(i => i.type === 'AI');
                      keyLines = [
                        'AI (Army Instructor) — Non-commissioned officer; assists the SAI in day-to-day instruction.',
                        ...(ai.length ? ai.map(i => `AI: ${i.name}`) : ['AI: (none on record)']),
                      ];
                    }

                    if (cat?.id === 'all_duties') {
                      const pr = posReqs[testMode.position] || DEFAULT_POSITION_REQUIREMENTS[testMode.position];
                      const duties = pr?.duties || [];
                      if (duties.length > 0) keyLines = duties;
                    }

                    if (cat?.id === 'chain_of_command') {
                      const lines = buildChainOfCommand(rosterAll);
                      if (lines.length > 0) keyLines = lines;
                    }

                    if (!keyLines) return null;
                    return (
                      <details className="mb-4 group">
                        <summary className="cursor-pointer flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800 border border-white/10 text-[9px] font-black uppercase tracking-widest text-slate-300 select-none list-none hover:bg-slate-700 transition-colors">
                          <span>Answer Key</span>
                          <span className="group-open:rotate-180 transition-transform duration-200">▾</span>
                        </summary>
                        <div className="mt-2 p-3 bg-slate-900/80 border border-white/5 rounded-xl space-y-1.5">
                          {keyLines.map((line, i) => (
                            <p key={i} className="text-xs text-slate-200 leading-relaxed">{line}</p>
                          ))}
                        </div>
                      </details>
                    );
                  })()}

                  {/* Mistake buttons */}
                  <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3 text-center">
                    How many mistakes?
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {OPTS.map(opt => (
                      <button
                        key={opt.n}
                        onClick={() => testRecordMistakes(opt.n)}
                        className={`${opt.color} rounded-2xl py-5 flex flex-col items-center gap-1 font-black transition-colors`}
                      >
                        <span className="text-xl">{opt.label}</span>
                        <span className="text-[10px] uppercase tracking-widest opacity-70">→ {opt.score} pts</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => testRecordMistakes('na')}
                    className="mt-3 w-full py-3 rounded-2xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-black uppercase tracking-widest transition-colors"
                  >
                    N/A — Not required for this position
                  </button>

                  {/* Back button (if not on first category) */}
                  {testMode.step > 0 && (
                    <button
                      onClick={() => setTestMode(prev => ({ ...prev, step: prev.step - 1, phase: 'question' }))}
                      className="mt-4 w-full py-2.5 text-slate-500 hover:text-slate-300 text-xs font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-1"
                    >
                      <ChevronLeft size={13} /> Back to previous
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ── PHASE: EXTRA CREDIT ─────────────────────────────────────────── */}
            {testMode.phase === 'ec' && (() => {
              const isLet1 = testMode.letLevel?.toLowerCase().includes('let 1') || testMode.letLevel === '1';
              const ecItems = testMode.ecItems || {};
              const ecOther = testMode.ecOther || [];
              const totalEC = testMode.extraCredit || 0;
              const remaining = MAX_EC - totalEC;

              // "Other" inline form state lives outside testMode (local to this render)
              // We use a key-based input trick: track the form with useRef
              return (
                <div className="w-full max-w-lg">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-400 mb-0.5">Testing Mode · {testMode.cadetName}</p>
                      <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Extra Credit</h2>
                    </div>
                    <button onClick={exitTesting} className="text-slate-500 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/5">
                      <X size={18} />
                    </button>
                  </div>

                  {/* Full progress bar */}
                  <div className="h-1.5 bg-slate-800 rounded-full mb-5 overflow-hidden">
                    <div className="h-full bg-yellow-500 rounded-full" style={{ width: '100%' }} />
                  </div>

                  {/* Running total pill */}
                  <div className="flex items-center justify-between mb-4 px-1">
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Check off what the cadet earns</p>
                    <div className={`flex items-center gap-1.5 text-xs font-black tabular-nums px-3 py-1 rounded-full ${totalEC >= MAX_EC ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-slate-300'}`}>
                      <Star size={10} className="text-yellow-500" />
                      {totalEC} / {MAX_EC} pts
                    </div>
                  </div>

                  {/* LET 1 note */}
                  {isLet1 && (
                    <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-2">
                      <AlertCircle size={13} className="text-blue-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-300 font-bold leading-snug">
                        LET 1 — ask the 1SG for this cadet's extra credit guidance before proceeding.
                      </p>
                    </div>
                  )}

                  {/* EC option cards */}
                  <div className="space-y-2 mb-4">
                    {EC_OPTIONS.map(opt => {
                      const count   = ecItems[opt.id] || 0;
                      const pts     = count * opt.ptsEach;
                      const atCap   = count >= opt.cap;
                      const atTotal = totalEC >= MAX_EC;
                      return (
                        <div key={opt.id} className="bg-slate-900 border border-white/10 rounded-2xl p-4 flex items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-black text-white leading-tight">{opt.label}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{opt.sub}</p>
                            {pts > 0 && (
                              <p className="text-[10px] font-black text-yellow-500 mt-1">+{pts} pt{pts !== 1 ? 's' : ''}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => testDecrEC(opt.id)}
                              disabled={count === 0}
                              className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white font-black text-lg flex items-center justify-center transition-all"
                            >−</button>
                            <span className="w-6 text-center font-black text-white tabular-nums text-sm">{count}</span>
                            <button
                              onClick={() => testIncrEC(opt.id)}
                              disabled={atCap || atTotal}
                              title={atCap ? `Max ${opt.cap} for this item` : atTotal ? 'EC cap reached' : ''}
                              className="w-8 h-8 rounded-xl bg-yellow-500/20 hover:bg-yellow-500/40 disabled:opacity-30 text-yellow-400 font-black text-lg flex items-center justify-center transition-all"
                            >+</button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Other entries */}
                    {ecOther.map((entry, idx) => (
                      <div key={idx} className="bg-slate-900 border border-white/10 rounded-2xl p-4 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-0.5">Other</p>
                          <p className="text-sm font-bold text-white leading-tight">{entry.reason}</p>
                          <p className="text-[10px] font-black text-yellow-500 mt-1">+{entry.pts} pt{entry.pts !== 1 ? 's' : ''}</p>
                        </div>
                        <button
                          onClick={() => testRemoveOther(idx)}
                          className="text-slate-600 hover:text-red-400 transition-colors mt-0.5 p-1"
                        ><X size={13} /></button>
                      </div>
                    ))}

                    {/* Add Other form */}
                    <ECOtherForm
                      disabled={totalEC >= MAX_EC}
                      remaining={remaining}
                      onAdd={testAddOther}
                    />
                  </div>

                  <button
                    onClick={testCalculate}
                    className="w-full bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black uppercase tracking-widest py-4 rounded-2xl text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    Calculate Score <ChevronRight size={16} />
                  </button>

                  <button
                    onClick={() => setTestMode(prev => ({ ...prev, phase: 'question', step: prev.categories.length - 1 }))}
                    className="mt-3 w-full py-2.5 text-slate-500 hover:text-slate-300 text-xs font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-1"
                  >
                    <ChevronLeft size={13} /> Back to last category
                  </button>
                </div>
              );
            })()}

            {/* ── PHASE: RESULTS ──────────────────────────────────────────────── */}
            {testMode.phase === 'results' && (() => {
              const catScores = {};
              testMode.categories.forEach(cat => {
                catScores[cat.id] = mistakesToScore(testMode.mistakes[cat.id] ?? 3);
              });
              const naCount    = Object.values(catScores).filter(s => s === 'na').length;
              const baseMax    = (testMode.categories.length - naCount) * 100;
              const baseTotal  = Object.values(catScores).reduce((a, b) => b === 'na' ? a : a + b, 0);
              const ec         = testMode.extraCredit;
              const grandTotal = baseTotal + ec;
              const basePct    = baseMax > 0 ? Math.round((baseTotal / baseMax) * 100) : 100;

              const scoreCol = (s) =>
                s === 'na' ? 'text-slate-500' :
                s === 100 ? 'text-green-400' :
                s === 90  ? 'text-yellow-400' :
                s === 80  ? 'text-orange-400' :
                'text-red-500';

              const perfLabel =
                basePct >= 90 ? 'Excellent' :
                basePct >= 80 ? 'Proficient' :
                basePct >= 70 ? 'Needs Improvement' :
                'Unsatisfactory';

              return (
                <div className="w-full max-w-md max-h-[90vh] flex flex-col">
                  <div className="flex items-center justify-between mb-6 shrink-0">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-400 mb-0.5">Testing Mode · {testMode.cadetName}</p>
                      <h2 className="text-2xl font-black uppercase italic tracking-tighter text-white">Board Results</h2>
                    </div>
                    <button onClick={exitTesting} className="text-slate-500 hover:text-white transition-colors p-2 rounded-xl hover:bg-white/5">
                      <X size={18} />
                    </button>
                  </div>

                  {/* Total score card — blurred until revealed */}
                  <div className="shrink-0 bg-slate-900 border border-white/10 rounded-2xl p-6 mb-4 text-center relative">
                    {/* Reveal toggle */}
                    <button
                      onClick={testToggleReveal}
                      className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5"
                      title={testMode.revealed ? 'Hide score' : 'Reveal score'}
                    >
                      {testMode.revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>

                    {/* Base score */}
                    <p className={`text-6xl font-black tabular-nums transition-all duration-300 select-none ${testMode.revealed ? '' : 'blur-lg pointer-events-none'} ${
                      basePct >= 90 ? 'text-green-400' : basePct >= 80 ? 'text-yellow-400' : basePct >= 70 ? 'text-orange-400' : 'text-red-500'
                    }`}>
                      {baseTotal}
                    </p>
                    <p className={`text-slate-500 text-sm font-bold transition-all duration-300 ${testMode.revealed ? '' : 'blur-md select-none'}`}>
                      / {baseMax} pts · {basePct}%
                    </p>

                    {/* EC addend */}
                    {ec > 0 && (
                      <p className={`text-yellow-400 text-sm font-black mt-1 transition-all duration-300 ${testMode.revealed ? '' : 'blur-md select-none'}`}>
                        + {ec} extra credit = <span className="text-white">{grandTotal}</span>
                      </p>
                    )}

                    <p className={`text-slate-400 text-xs mt-1.5 uppercase tracking-widest font-black transition-all duration-300 ${testMode.revealed ? '' : 'blur-sm select-none'}`}>
                      {baseTotal === baseMax ? 'Perfect Score!' : perfLabel}
                    </p>

                    {!testMode.revealed && (
                      <p className="text-slate-500 text-[10px] mt-3 font-bold">
                        Click <Eye size={10} className="inline mx-0.5" /> to reveal
                      </p>
                    )}
                  </div>

                  {/* Category breakdown */}
                  <div className="flex-1 overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl mb-4">
                    <div className="p-4 space-y-1">
                      {testMode.categories.map((cat, i) => {
                        const s = catScores[cat.id];
                        const m = testMode.mistakes[cat.id] ?? 3;
                        return (
                          <div key={cat.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                            <span className="text-[9px] font-bold text-slate-600 w-5 shrink-0 text-right">{i+1}.</span>
                            <span className="text-xs text-slate-300 flex-1">{cat.label}</span>
                            <span className="text-[10px] text-slate-500 shrink-0">{m === 'na' ? 'N/A' : `${m >= 3 ? '3+' : m} mistake${m !== 1 ? 's' : ''}`}</span>
                            <span className={`text-sm font-black shrink-0 w-8 text-right tabular-nums ${scoreCol(s)}`}>{s === 'na' ? 'N/A' : s}</span>
                          </div>
                        );
                      })}
                      {/* EC row */}
                      <div className="flex items-center gap-3 py-2 pt-3 mt-1 border-t border-white/10">
                        <span className="text-[9px] font-bold text-slate-600 w-5" />
                        <span className="text-xs text-yellow-400 font-bold flex-1">Extra Credit</span>
                        <span className="text-sm font-black text-yellow-400 tabular-nums">+{ec}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 shrink-0">
                    <button
                      onClick={() => setTestMode(prev => ({ ...prev, phase: 'ec' }))}
                      className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors border border-white/5"
                    >
                      <ChevronLeft size={12} className="inline mr-1" /> Back
                    </button>
                    <button
                      onClick={testSaveScore}
                      className="flex-[2] py-3 rounded-xl text-sm font-black uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-slate-950 transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={14} /> Save Score
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Score table */}
        <div className="bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-3xl shadow-sm overflow-hidden">
          {scores.length === 0 ? (
            <div className="text-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-yellow-500 mx-auto" />
              <p className="text-slate-400 text-xs font-bold mt-4 uppercase tracking-widest">Loading cadets…</p>
            </div>
          ) : displayScores.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No cadets match the current filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-blue-100 dark:border-white/5 bg-blue-50/40 dark:bg-slate-800/30">
                    <th className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 sticky left-0 bg-blue-50/40 dark:bg-slate-800/30 z-10">Cadet</th>
                    <th className="px-2 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Elig.</th>
                    {(selectedBoard.categories || DEFAULT_CATEGORIES).map(cat => (
                      <th key={cat.id} className="px-1.5 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 text-center whitespace-nowrap">
                        {CAT_SHORT[cat.id] || cat.label}
                      </th>
                    ))}
                    <th className="px-1.5 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 text-center">EC</th>
                    <th className="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 text-center">Total</th>
                    <th className="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 text-center">%</th>
                  </tr>
                </thead>
                <tbody>
                  {groupLet
                    ? groupByLet(displayScores, s => s.letLevel || letLevelMap[s.rosterDocId] || '', s => s.cadetName).map(({ level, entries: group }) => (
                        <React.Fragment key={level}>
                          <tr>
                            <td colSpan={999} className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-500/10 border-y border-yellow-200 dark:border-yellow-500/20">
                              {level}
                            </td>
                          </tr>
                          {group.map(scoreDoc => (
                            <ScoreTableRow
                              key={scoreDoc.id}
                              scoreDoc={scoreDoc}
                              canEdit={
                                isBattalionLevel
                                  ? canEditThisBoard
                                  : canEditThisBoard && !scoreDoc.testingComplete
                              }
                              canEditEC={canEditThisBoard}
                              isLocked={!!scoreDoc.testingComplete && !isBattalionLevel}
                              formsOk={!pendingFormMap[scoreDoc.rosterDocId]}
                              ccOk={!!ccCompleteMap[scoreDoc.rosterDocId]}
                              onScoreChange={handleScoreChange}
                              onExtraCreditBlur={handleExtraCreditBlur}
                              categories={selectedBoard.categories || DEFAULT_CATEGORIES}
                            />
                          ))}
                        </React.Fragment>
                      ))
                    : displayScores.map(scoreDoc => (
                        <ScoreTableRow
                          key={scoreDoc.id}
                          scoreDoc={scoreDoc}
                          canEdit={
                            isBattalionLevel
                              ? canEditThisBoard
                              : canEditThisBoard && !scoreDoc.testingComplete
                          }
                          canEditEC={canEditThisBoard}
                          isLocked={!!scoreDoc.testingComplete && !isBattalionLevel}
                          formsOk={!pendingFormMap[scoreDoc.rosterDocId]}
                          ccOk={!!ccCompleteMap[scoreDoc.rosterDocId]}
                          onScoreChange={handleScoreChange}
                          onExtraCreditBlur={handleExtraCreditBlur}
                          categories={selectedBoard.categories || DEFAULT_CATEGORIES}
                        />
                      ))
                  }
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Board Averages ── */}
        {boardAvgStats.n > 0 && (
          <div className="mt-4 rounded-2xl border border-indigo-100 dark:border-white/10 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-3 bg-indigo-50/60 dark:bg-slate-800/40 border-b border-indigo-100 dark:border-white/5 text-left"
              onClick={() => setShowCatAvgs(v => !v)}
            >
              <div className="flex items-center gap-2">
                <BarChart2 size={13} className="text-indigo-500" />
                <p className="text-xs font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
                  Board Averages
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-500/15 px-2.5 py-1 rounded-full">
                  {boardAvgStats.n} cadet{boardAvgStats.n !== 1 ? 's' : ''} with scores
                </span>
                {showCatAvgs ? <ChevronUp size={13} className="text-indigo-400" /> : <ChevronDown size={13} className="text-indigo-400" />}
              </div>
            </button>
            {/* Summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-4">
              {[
                { label: 'Avg Score',    val: boardAvgStats.avg,     sub: `/ ${boardAvgStats.maxPossible}` },
                { label: 'Highest',      val: boardAvgStats.highest, sub: 'pts' },
                { label: 'Lowest',       val: boardAvgStats.lowest,  sub: 'pts' },
                { label: 'Avg Xtra Crd', val: boardAvgStats.ecAvg,   sub: 'pts' },
              ].map(({ label, val, sub }, i) => (
                <div key={label} className={`px-4 py-4 text-center ${i > 0 ? 'border-l border-indigo-100 dark:border-white/5' : ''}`}>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">{label}</p>
                  <p className="text-xl font-black text-slate-700 dark:text-white tabular-nums">
                    {val != null ? val : '—'}
                  </p>
                  {val != null && <p className="text-[9px] text-slate-400 mt-0.5">{sub}</p>}
                </div>
              ))}
            </div>
            {/* Per-category breakdown (collapsible) */}
            {showCatAvgs && (
              <div className="border-t border-indigo-100 dark:border-white/5 px-5 py-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Per-Category Averages</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {boardAvgStats.catAvgs.map(({ id, label, avg }) => (
                    <div key={id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2">
                      <p className="text-xs text-slate-600 dark:text-slate-400 truncate mr-2">{label}</p>
                      <p className="text-xs font-black text-slate-800 dark:text-white tabular-nums shrink-0">
                        {avg != null ? avg : '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Battalion Board Nominations ── */}
        {(() => {
          const visibleNoms = isBattalionLevel
            ? battalionNominations
            : battalionNominations.filter(n => n.company === myCompany);
          if (visibleNoms.length === 0) return null;
          return (
            <div className="mt-4 rounded-2xl border border-yellow-200 dark:border-yellow-500/20 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 bg-yellow-50/70 dark:bg-yellow-500/5 border-b border-yellow-200 dark:border-yellow-500/15">
                <Medal size={13} className="text-yellow-600 dark:text-yellow-400" />
                <p className="text-xs font-black uppercase tracking-widest text-yellow-700 dark:text-yellow-300">
                  Battalion Board Nominations
                </p>
                <span className="ml-auto text-[10px] text-yellow-600 dark:text-yellow-400 font-bold">
                  Highest scorer per position per company
                </span>
              </div>
              <div className="divide-y divide-yellow-100 dark:divide-yellow-500/10">
                {visibleNoms.map(({ company, nominees }) => (
                  <div key={company} className="px-5 py-4">
                    {isBattalionLevel && (
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
                        {company} Company
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {nominees.map(({ position, cadetName, rank, pct, total, possible, originalPos }) => (
                        <div key={position} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2.5 gap-2">
                          <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">
                              {position}
                              {position === 'Staff Assistant' && originalPos ? ` · ${originalPos}` : ''}
                            </p>
                            <p className="text-sm font-black text-slate-800 dark:text-white truncate">
                              {rank ? `${rank} ` : ''}{cadetName}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-base font-black tabular-nums ${scoreColor(pct)}`}>{pct}%</p>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500">{total} / {possible}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Eligibility legend */}
        {!loadingElig && (
          <p className="text-[9px] text-slate-400 dark:text-slate-600 mt-3 text-right">
            Forms: no pending active form events · CC: all Cadet Challenge events entered
          </p>
        )}
        {loadingElig && (
          <p className="text-[9px] text-slate-400 dark:text-slate-600 mt-3 text-right animate-pulse">
            Loading eligibility data…
          </p>
        )}
      </div>

      {/* ── Print Roster Modal ──────────────────────────────────────────────── */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-full max-w-md flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10">
              <div className="flex items-center gap-3">
                <Printer size={16} className="text-slate-500" />
                <p className="font-black uppercase text-sm tracking-widest text-slate-900 dark:text-white">Print Roster</p>
              </div>
              <button onClick={() => setShowPrintModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              {/* Columns */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Columns</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'showCategories', label: 'Category Scores' },
                    { key: 'showEC',         label: 'Extra Credit'    },
                    { key: 'showTotal',      label: 'Total Score'     },
                    { key: 'showPct',        label: 'Percent Grade'   },
                    { key: 'showElig',       label: 'Eligibility (Forms / CC)' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer select-none group">
                      <div
                        onClick={() => setPrintOpts(o => ({ ...o, [key]: !o[key] }))}
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${printOpts[key] ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-slate-600 group-hover:border-yellow-400'}`}
                      >
                        {printOpts[key] && <span className="text-slate-950 text-[10px] font-black leading-none">✓</span>}
                      </div>
                      <span className="text-xs text-slate-700 dark:text-slate-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Sort / Grouping */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Order</p>
                <div className="space-y-2">
                  {[
                    { val: 'let',   label: 'Grouped by LET' },
                    { val: 'alpha', label: 'Alphabetical (A–Z)' },
                    { val: 'score', label: 'By score (high → low)' },
                  ].map(({ val, label }) => (
                    <label key={val} className="flex items-center gap-2 cursor-pointer select-none group">
                      <div
                        onClick={() => setPrintOpts(o => ({ ...o, sort: val }))}
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${printOpts.sort === val ? 'border-yellow-500' : 'border-slate-300 dark:border-slate-600 group-hover:border-yellow-400'}`}
                      >
                        {printOpts.sort === val && <div className="w-2 h-2 rounded-full bg-yellow-500" />}
                      </div>
                      <span className="text-xs text-slate-700 dark:text-slate-300">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Nominations */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Extras</p>
                <label className="flex items-center gap-2 cursor-pointer select-none group">
                  <div
                    onClick={() => setPrintOpts(o => ({ ...o, showNominations: !o.showNominations }))}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${printOpts.showNominations ? 'bg-yellow-500 border-yellow-500' : 'border-slate-300 dark:border-slate-600 group-hover:border-yellow-400'}`}
                  >
                    {printOpts.showNominations && <span className="text-slate-950 text-[10px] font-black leading-none">✓</span>}
                  </div>
                  <span className="text-xs text-slate-700 dark:text-slate-300">Include Battalion Board Nominations</span>
                </label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex justify-end gap-2">
              <button onClick={() => setShowPrintModal(false)} className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:hover:text-white transition-colors">Cancel</button>
              <button onClick={handlePrint} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-900 dark:bg-white hover:bg-slate-700 dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-black uppercase tracking-wider transition-colors">
                <Printer size={12} /> Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Run-Promotions Modal ────────────────────────────────────────────── */}
      {promoModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="modal-enter bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-white/10">
              <div className="flex items-center gap-3">
                <TrendingUp size={18} className="text-indigo-500" />
                <div>
                  <p className="font-black uppercase text-sm tracking-widest text-slate-900 dark:text-white">Run Promotions</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Based on "{selectedBoard.title}"</p>
                </div>
              </div>
              <button onClick={() => setPromoModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Board selector */}
            <div className="px-6 pt-5 pb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Select Board</p>
              <div className="flex gap-3">
                {[1, 2].map(n => (
                  <button
                    key={n}
                    onClick={() => setPromoNum(n)}
                    className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest border transition-all ${promoNum === n ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-indigo-400'}`}
                  >
                    Board {n}
                    <span className="block text-[9px] font-bold normal-case tracking-normal mt-0.5 opacity-70">
                      {n === 1 ? 'Promote to one rank below max' : 'Promote to max authorized rank'}
                    </span>
                  </button>
                ))}
              </div>
              {(() => {
                const reqs   = selectedBoard?.eligibilityReqs || { requireForms: true, requireCC: true, custom: [] };
                const auto   = [reqs.requireForms !== false && 'Forms complete', reqs.requireCC !== false && 'CC complete'].filter(Boolean);
                const custom = reqs.custom || [];
                return (
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] text-slate-400 leading-relaxed">
                      Auto-checked: board complete (all categories scored){auto.length > 0 && <> · {auto.join(' · ')}</>}.
                      Ranks update in roster and linked portal accounts.
                    </p>
                    {custom.length > 0 && (
                      <div className="pt-2 border-t border-white/10">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-2">Confirm manual requirements before promoting</p>
                        <div className="space-y-2">
                          {custom.map(req => {
                            const confirmed = !!promoCustomConfirmed[req.id];
                            return (
                              <label key={req.id} className="flex items-start gap-3 cursor-pointer group p-2 rounded-xl hover:bg-white/5 transition-colors">
                                <button type="button" role="checkbox" aria-checked={confirmed}
                                  onClick={() => setPromoCustomConfirmed(p => ({ ...p, [req.id]: !confirmed }))}
                                  className={`mt-0.5 w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-all ${confirmed ? 'bg-yellow-500 border-yellow-500' : 'border-slate-600 bg-transparent group-hover:border-yellow-400'}`}>
                                  {confirmed && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-900"/></svg>}
                                </button>
                                <div>
                                  <p className="text-xs font-bold text-slate-200 leading-none">{req.label}</p>
                                  {req.description && <p className="text-[10px] text-slate-500 mt-0.5">{req.description}</p>}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Preview list */}
            <div className="flex-1 overflow-y-auto px-6 pb-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 mt-1">
                {promoEligible.length} cadet{promoEligible.length !== 1 ? 's' : ''} eligible for promotion
              </p>
              {promoEligible.length === 0 ? (
                <p className="text-sm text-slate-400 italic py-6 text-center">
                  No cadets are eligible — either no boards are complete, or all cadets are already at their Board {promoNum} target rank.
                </p>
              ) : (
                <div className="space-y-1">
                  {promoEligible.map(cadet => (
                    <div key={cadet.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 text-sm">
                      <div>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{cadet.cadetName}</span>
                        <span className="text-[10px] text-slate-400 ml-2">
                          {normalizeCompany(cadet.rosterEntry?.company)}{cadet.rosterEntry?.position ? ` · ${cadet.rosterEntry.position}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded">
                          {cadet.rosterEntry?.rank || '—'}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600 text-xs">→</span>
                        <span className="text-[10px] font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded">
                          {cadet.targetRank}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-white/10 flex gap-3">
              <button
                onClick={() => setPromoModal(false)}
                className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
              <button
                disabled={
                  promoEligible.length === 0 ||
                  promoRunning ||
                  (selectedBoard?.eligibilityReqs?.custom || []).some(r => !promoCustomConfirmed[r.id])
                }
                onClick={runPromo}
                className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                {promoRunning
                  ? <><Clock size={14} className="animate-spin" /> Promoting…</>
                  : <><TrendingUp size={14} /> Promote {promoEligible.length} Cadet{promoEligible.length !== 1 ? 's' : ''}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Save indicator */}
      <div
        className="fixed bottom-6 right-6 z-50 pointer-events-none transition-all duration-300"
        style={{ opacity: savedFlash ? 1 : 0, transform: savedFlash ? 'translateY(0)' : 'translateY(8px)' }}
      >
        <span className="inline-flex items-center gap-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-2xl shadow-xl">
          ✓ Saved
        </span>
      </div>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // BOARD LIST VIEW
  // ════════════════════════════════════════════════════════════════════════════════
  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white flex items-center gap-2">
            <Trophy className="text-yellow-500" size={20} /> Promotion Board
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mt-0.5">
            Score: 100 / 90 / 80 / 0 per category · 1100 base + up to 100 EC
          </p>
        </div>
        {canCreateBoard && (
          <button
            onClick={() => setShowCreate(true)}
            disabled={!!openBoard || !!draftBoard}
            title={
              openBoard   ? 'Close the current open board before creating a new one' :
              draftBoard  ? 'Finish or delete the current draft before creating a new one' :
              'Create a new promotion board'
            }
            className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus size={14} /> New Board
          </button>
        )}
      </div>

      {/* Draft board — only battalion can see drafts */}
      {isBattalionLevel && draftBoard && (
        <div className="mb-6">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-amber-500 dark:text-amber-600 mb-3">
            Draft — Not visible to companies
          </p>
          <BoardCard board={draftBoard} onClick={() => openDetail(draftBoard)} />
        </div>
      )}

      {/* Open board */}
      {openBoard ? (
        <div className="mb-8">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-300 dark:text-slate-600 mb-3">Open</p>
          <BoardCard board={openBoard} onClick={() => openDetail(openBoard)} />
        </div>
      ) : !draftBoard ? (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 dark:border-white/5 rounded-3xl mb-8">
          <Trophy className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={32} />
          <p className="text-slate-400 font-black uppercase tracking-widest text-sm">No open promotion board</p>
          {canCreateBoard && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-yellow-600 dark:text-yellow-500 text-xs font-black uppercase tracking-widest hover:underline"
            >
              Create one →
            </button>
          )}
        </div>
      ) : null}

      {/* ── Position Requirements (always visible, saves directly to public page) ── */}
      {isS1 && (() => {
        const cur = posReqs[posReqPos] || { items: [], duties: [], notes: '' };

        const saveReqs = (next) => savePosReqsToPage(next);

        const addItem = () => {
          const label = posReqInput.trim();
          if (!label) return;
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const next = { ...posReqs, [posReqPos]: { ...prev, items: [...(prev.items || []), label] } };
          setPosReqs(next);
          setPosReqInput('');
          saveReqs(next);
        };
        const removeItem = (idx) => {
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const next = { ...posReqs, [posReqPos]: { ...prev, items: prev.items.filter((_, i) => i !== idx) } };
          setPosReqs(next);
          saveReqs(next);
        };
        const updateItem = (idx, value) => {
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const items = prev.items.map((it, i) => i === idx ? value : it);
          const next = { ...posReqs, [posReqPos]: { ...prev, items } };
          setPosReqs(next);
          return next;
        };
        const moveItem = (idx, dir) => {
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const items = [...prev.items];
          const target = idx + dir;
          if (target < 0 || target >= items.length) return;
          [items[idx], items[target]] = [items[target], items[idx]];
          const next = { ...posReqs, [posReqPos]: { ...prev, items } };
          setPosReqs(next);
          saveReqs(next);
        };

        const addDuty = () => {
          const label = posReqDutiesInput.trim();
          if (!label) return;
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const next = { ...posReqs, [posReqPos]: { ...prev, duties: [...(prev.duties || []), label] } };
          setPosReqs(next);
          setPosReqDutiesInput('');
          saveReqs(next);
        };
        const removeDuty = (idx) => {
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const next = { ...posReqs, [posReqPos]: { ...prev, duties: (prev.duties || []).filter((_, i) => i !== idx) } };
          setPosReqs(next);
          saveReqs(next);
        };
        const updateDuty = (idx, value) => {
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const duties = (prev.duties || []).map((d, i) => i === idx ? value : d);
          const next = { ...posReqs, [posReqPos]: { ...prev, duties } };
          setPosReqs(next);
          return next;
        };
        const moveDuty = (idx, dir) => {
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          const duties = [...(prev.duties || [])];
          const target = idx + dir;
          if (target < 0 || target >= duties.length) return;
          [duties[idx], duties[target]] = [duties[target], duties[idx]];
          const next = { ...posReqs, [posReqPos]: { ...prev, duties } };
          setPosReqs(next);
          saveReqs(next);
        };
        const updateNotes = (notes) => {
          const prev = posReqs[posReqPos] || { items: [], duties: [], notes: '' };
          setPosReqs({ ...posReqs, [posReqPos]: { ...prev, notes } });
        };

        const itemRowClass = "flex items-center gap-1.5";
        const reorderBtnClass = (disabled) =>
          `w-5 h-4 flex items-center justify-center rounded transition-colors ${disabled ? 'opacity-20 pointer-events-none' : 'text-slate-400 dark:text-slate-600 hover:text-yellow-500'}`;

        return (
          <div className="mt-8 bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Position Requirements
              </p>
              {savingPosReqs && <span className="text-[9px] text-slate-400 animate-pulse">Saving…</span>}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed mb-5">
              Shown on the public Promotion Board page and to proctors in Testing Mode. Changes save automatically.
            </p>

            <div className="grid md:grid-cols-3 gap-0">
              {/* Position list */}
              <div className="md:border-r border-slate-100 dark:border-white/5 md:pr-5 mb-5 md:mb-0">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Positions</p>
                <div className="space-y-0.5 max-h-96 overflow-y-auto pr-1">
                  {JROTC_POSITIONS.map(pos => {
                    const r = posReqs[pos] || {};
                    const count = (r.items || []).length + (r.duties || []).length;
                    const active = posReqPos === pos;
                    return (
                      <button
                        key={pos}
                        onClick={() => { setPosReqPos(pos); setPosReqInput(''); setPosReqDutiesInput(''); setPosReqEditorTab('requirements'); }}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-all flex items-center justify-between gap-2 ${
                          active ? 'bg-yellow-500 text-slate-950 font-black' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate">{pos}</span>
                        {count > 0 && (
                          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${
                            active ? 'bg-slate-950/20 text-slate-950' : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                          }`}>{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Editor */}
              <div className="md:col-span-2 md:pl-5 space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-900 dark:text-white">{posReqPos}</p>
                  <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                    {[{ id: 'requirements', label: 'Requirements' }, { id: 'knowledge', label: 'Knowledge' }].map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPosReqEditorTab(tab.id)}
                        className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                          posReqEditorTab === tab.id
                            ? 'bg-yellow-500 text-slate-950'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                        }`}
                      >{tab.label}</button>
                    ))}
                  </div>
                </div>

                {posReqEditorTab === 'knowledge' && (() => {
                  // Categories where a count input doesn't apply — all-or-nothing knowledge
                  const NO_COUNT_CATS = new Set(['cadet_creed','ldrship','jrotc_meaning','let_meaning','mission_statement','sai','ai']);
                  const allCatIds   = DEFAULT_CATEGORIES.map(c => c.id);
                  const required    = cur.requiredCategories   ?? allCatIds;
                  const counts      = cur.requiredCounts       ?? {};
                  const totals      = cur.requiredTotals       ?? {};
                  const cocSelected = cur.requiredCoCPositions ?? [];
                  const save = (patch) => {
                    const next = { ...posReqs, [posReqPos]: { ...cur, requiredCategories: required, requiredCounts: counts, requiredTotals: totals, requiredCoCPositions: cocSelected, ...patch } };
                    setPosReqs(next);
                    saveReqs(next);
                  };
                  const toggleCat = (catId) => {
                    const next_cats = required.includes(catId) ? required.filter(id => id !== catId) : [...required, catId];
                    save({ requiredCategories: next_cats });
                  };
                  const setReq = (catId, val) => {
                    const n = parseInt(val, 10);
                    const next = { ...counts, [catId]: isNaN(n) || n < 1 ? undefined : n };
                    if (next[catId] === undefined) delete next[catId];
                    save({ requiredCounts: next });
                  };
                  const setTotal = (catId, val) => {
                    const n = parseInt(val, 10);
                    const next = { ...totals, [catId]: isNaN(n) || n < 1 ? undefined : n };
                    if (next[catId] === undefined) delete next[catId];
                    save({ requiredTotals: next });
                  };
                  const toggleCoCPos = (pos) => {
                    const next_coc = cocSelected.includes(pos) ? cocSelected.filter(p => p !== pos) : [...cocSelected, pos];
                    save({ requiredCoCPositions: next_coc });
                  };
                  return (
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
                        Required in Testing Mode <span className="font-normal normal-case tracking-normal">({required.length}/{allCatIds.length})</span>
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed mb-4">
                        Check each category this position must know. For countable categories enter required / total (e.g. 5/11 for Principles). For Chain of Command, select which positions they need to name.
                      </p>
                      <div className="space-y-1.5">
                        {DEFAULT_CATEGORIES.map(cat => {
                          const checked = required.includes(cat.id);
                          const isCoC   = cat.id === 'chain_of_command';
                          return (
                            <div key={cat.id}>
                              <div
                                className={`flex items-center gap-3 px-3 py-2 rounded-xl border transition-all ${
                                  checked
                                    ? 'bg-yellow-500/10 border-yellow-500/30'
                                    : 'bg-slate-50 dark:bg-slate-800/50 border-transparent'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleCat(cat.id)}
                                  className={`w-4 h-4 rounded shrink-0 flex items-center justify-center border transition-all ${
                                    checked
                                      ? 'bg-yellow-500 border-yellow-500 text-slate-950'
                                      : 'border-slate-300 dark:border-slate-600'
                                  }`}
                                >
                                  {checked && <span className="text-[10px] font-black leading-none">✓</span>}
                                </button>
                                <span className={`flex-1 text-xs font-bold transition-colors ${checked ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                                  {cat.label}
                                </span>
                                {checked && !isCoC && !NO_COUNT_CATS.has(cat.id) && (
                                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                    <input
                                      type="number"
                                      min="1"
                                      placeholder="—"
                                      value={counts[cat.id] ?? ''}
                                      onChange={e => setReq(cat.id, e.target.value)}
                                      className="w-10 bg-slate-800 border border-white/10 focus:border-yellow-500/50 rounded-lg px-1.5 py-1 text-xs text-white placeholder-slate-600 outline-none text-center tabular-nums transition-colors"
                                    />
                                    <span className="text-[9px] text-slate-500 font-bold">/</span>
                                    <input
                                      type="number"
                                      min="1"
                                      placeholder="—"
                                      value={totals[cat.id] ?? ''}
                                      onChange={e => setTotal(cat.id, e.target.value)}
                                      className="w-10 bg-slate-800 border border-white/10 focus:border-yellow-500/50 rounded-lg px-1.5 py-1 text-xs text-white placeholder-slate-600 outline-none text-center tabular-nums transition-colors"
                                    />
                                  </div>
                                )}
                                {checked && isCoC && (
                                  <span className="text-[9px] text-yellow-500/80 font-black shrink-0">
                                    {cocSelected.length > 0 ? `${cocSelected.length} pos.` : 'All'}
                                  </span>
                                )}
                              </div>
                              {checked && isCoC && (
                                <details className="mt-1 ml-7 group" open={cocSelected.length === 0}>
                                  <summary className="cursor-pointer list-none flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors select-none">
                                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 flex-1">
                                      {cocSelected.length === 0 ? 'Select positions…' : `${cocSelected.length} position${cocSelected.length !== 1 ? 's' : ''} selected`}
                                    </span>
                                    <span className="text-slate-600 group-open:rotate-180 transition-transform duration-200 text-[10px]">▾</span>
                                  </summary>
                                  <div className="pl-3 border-l-2 border-yellow-500/20 space-y-0.5 mt-1 pb-1">
                                    {COC_POSITIONS.map(pos => {
                                      const sel = cocSelected.includes(pos);
                                      return (
                                        <button
                                          key={pos}
                                          type="button"
                                          onClick={() => toggleCoCPos(pos)}
                                          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-all ${
                                            sel
                                              ? 'bg-yellow-500/10 text-slate-900 dark:text-white'
                                              : 'text-slate-400 dark:text-slate-500 hover:bg-white/5'
                                          }`}
                                        >
                                          <span className={`w-3 h-3 rounded shrink-0 flex items-center justify-center border transition-all ${
                                            sel ? 'bg-yellow-500 border-yellow-500 text-slate-950' : 'border-slate-400 dark:border-slate-600'
                                          }`}>
                                            {sel && <span className="text-[8px] font-black leading-none">✓</span>}
                                          </span>
                                          <span className="text-[11px] font-bold">{pos}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {posReqEditorTab === 'requirements' && <>{/* ── Checklist Items ── */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                    Checklist Items <span className="font-normal normal-case tracking-normal">({(cur.items || []).length})</span>
                  </p>
                  <div className="space-y-1.5 mb-2 max-h-52 overflow-y-auto pr-1">
                    {(cur.items || []).length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-600 italic py-1">No items — add one below.</p>
                    ) : (
                      (cur.items || []).map((item, i, arr) => (
                        <div key={i} className={itemRowClass}>
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button type="button" onClick={() => moveItem(i, -1)} className={reorderBtnClass(i === 0)}><ChevronUp size={11} /></button>
                            <button type="button" onClick={() => moveItem(i, 1)} className={reorderBtnClass(i === arr.length - 1)}><ChevronDown size={11} /></button>
                          </div>
                          <span className="text-[9px] font-bold text-slate-300 dark:text-slate-600 w-4 shrink-0 text-right">{i + 1}.</span>
                          <input
                            value={item}
                            onChange={e => updateItem(i, e.target.value)}
                            onBlur={e => saveReqs(updateItem(i, e.target.value))}
                            className="flex-1 text-xs bg-slate-50 dark:bg-slate-800 border border-transparent focus:border-yellow-500/40 px-3 py-1.5 rounded-lg outline-none transition-colors text-slate-700 dark:text-slate-300"
                          />
                          <button onClick={() => removeItem(i)} className="shrink-0 p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                            <X size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={posReqInput}
                      onChange={e => setPosReqInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addItem()}
                      placeholder="Add a requirement…"
                      className="flex-1 bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
                    />
                    <button onClick={addItem} disabled={!posReqInput.trim()} className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-950 text-xs font-black rounded-lg transition-colors">Add</button>
                  </div>
                </div>

                {/* ── Duties ── */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                    Duties &amp; Responsibilities <span className="font-normal normal-case tracking-normal">({(cur.duties || []).length})</span>
                  </p>
                  <div className="space-y-1.5 mb-2 max-h-52 overflow-y-auto pr-1">
                    {(cur.duties || []).length === 0 ? (
                      <p className="text-xs text-slate-400 dark:text-slate-600 italic py-1">No duties — add one below.</p>
                    ) : (
                      (cur.duties || []).map((duty, i, arr) => (
                        <div key={i} className={itemRowClass}>
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button type="button" onClick={() => moveDuty(i, -1)} className={reorderBtnClass(i === 0)}><ChevronUp size={11} /></button>
                            <button type="button" onClick={() => moveDuty(i, 1)} className={reorderBtnClass(i === arr.length - 1)}><ChevronDown size={11} /></button>
                          </div>
                          <span className="text-[9px] font-bold text-slate-300 dark:text-slate-600 w-4 shrink-0 text-right">{i + 1}.</span>
                          <input
                            value={duty}
                            onChange={e => updateDuty(i, e.target.value)}
                            onBlur={e => saveReqs(updateDuty(i, e.target.value))}
                            className="flex-1 text-xs bg-slate-50 dark:bg-slate-800 border border-transparent focus:border-yellow-500/40 px-3 py-1.5 rounded-lg outline-none transition-colors text-slate-700 dark:text-slate-300"
                          />
                          <button onClick={() => removeDuty(i)} className="shrink-0 p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all">
                            <X size={11} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={posReqDutiesInput}
                      onChange={e => setPosReqDutiesInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addDuty()}
                      placeholder="Add a duty…"
                      className="flex-1 bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors"
                    />
                    <button onClick={addDuty} disabled={!posReqDutiesInput.trim()} className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-950 text-xs font-black rounded-lg transition-colors">Add</button>
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">Notes (optional)</p>
                  <textarea
                    value={cur.notes || ''}
                    onChange={e => updateNotes(e.target.value)}
                    onBlur={() => saveReqs(posReqs)}
                    rows={2}
                    placeholder="Any proctor notes for this position…"
                    className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none focus:border-yellow-500/40 transition-colors resize-none leading-relaxed"
                  />
                </div>
              </>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Archived (closed) boards */}
      {closedBoards.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(s => !s)}
            className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-600 mb-3 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
          >
            {showArchived ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            Archived — {closedBoards.length}
          </button>
          {showArchived && (
            <div className="space-y-3 opacity-70">
              {closedBoards.map(b => (
                <BoardCard key={b.id} board={b} onClick={() => openDetail(b)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 w-full max-w-md shadow-2xl border border-blue-100 dark:border-white/5">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">
                New Promotion Board <span className="text-amber-500 text-sm normal-case font-bold italic not-italic ml-1">— Draft</span>
              </h3>
              <button onClick={() => setShowCreate(false)} aria-label="Cancel new board" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 mb-6">
              {/* Categories preview */}
              <div className="bg-blue-50/50 dark:bg-slate-800 rounded-2xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
                  11 Scoring Categories (100 pts each) = 1100 base + Up to 100 Extra Credit
                </p>
                <div className="flex flex-wrap gap-1">
                  {DEFAULT_CATEGORIES.map(cat => (
                    <span key={cat.id} className="text-[9px] bg-white dark:bg-slate-900 border border-blue-100 dark:border-white/5 rounded px-1.5 py-0.5 text-slate-500 dark:text-slate-400">
                      {cat.label}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Board Title</label>
                <input
                  value={createForm.title}
                  onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., Fall 2026 Promotion Board"
                  className="w-full bg-blue-50/50 dark:bg-slate-800 border border-blue-100 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-yellow-500/40 transition-colors"
                />
              </div>

              <div>
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 block mb-1.5">Board Date</label>
                <DatePicker
                  value={createForm.boardDate}
                  onChange={v => setCreateForm(f => ({ ...f, boardDate: v }))}
                />
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                  This creates a <strong>draft</strong> — companies won't see it yet. After creating, you can rename the board, change the date, and edit categories. Click <em>Open to Companies</em> when it's ready.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-blue-50/50 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-slate-700 transition-colors border border-blue-100 dark:border-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBoard}
                disabled={!createForm.title.trim() || !createForm.boardDate || creating}
                className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating…' : 'Create Draft →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save indicator */}
      <div
        className="fixed bottom-6 right-6 z-50 pointer-events-none transition-all duration-300"
        style={{ opacity: savedFlash ? 1 : 0, transform: savedFlash ? 'translateY(0)' : 'translateY(8px)' }}
      >
        <span className="inline-flex items-center gap-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-2xl shadow-xl">
          ✓ Saved
        </span>
      </div>
    </div>
  );
};

// ── BoardCard ──────────────────────────────────────────────────────────────────
function BoardCard({ board, onClick }) {
  const companyStatus = board.companyStatus || {};
  const companies     = Object.keys(companyStatus);
  const submitted     = companies.filter(c => companyStatus[c]?.submitted).length;
  const total         = companies.length;
  const pct           = total > 0 ? Math.round((submitted / total) * 100) : 0;
  const isDraft       = board.status === 'draft';
  const isClosed      = board.status === 'closed';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group ${
        isDraft
          ? 'border-amber-200 dark:border-amber-500/20 hover:border-amber-400 dark:hover:border-amber-500/40'
          : isClosed
            ? 'border-blue-100/50 dark:border-white/[0.03] hover:border-slate-300 dark:hover:border-white/10'
            : 'border-yellow-200 dark:border-yellow-500/20 hover:border-yellow-400 dark:hover:border-yellow-500/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className={`text-sm font-black leading-tight ${
          isDraft  ? 'text-amber-700 dark:text-amber-400 group-hover:text-amber-600 dark:group-hover:text-amber-300' :
          isClosed ? 'text-slate-500 dark:text-slate-400' :
                     'text-slate-900 dark:text-white group-hover:text-yellow-600 dark:group-hover:text-yellow-500'
        } transition-colors`}>
          {board.title}
        </h3>
        <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
          isDraft  ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' :
          isClosed ? 'bg-slate-100 dark:bg-slate-800 text-slate-400' :
                     'bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-500'
        }`}>
          {isDraft ? 'Draft' : isClosed ? 'Closed' : 'Open'}
        </span>
      </div>
      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
        Board Date: {fmtDate(board.boardDate)}
        {!isDraft && ` · ${board.totalCadets ?? '—'} cadets`}
        {isDraft && ` · ${(board.categories || []).length} categories`}
      </p>
      {!isDraft && total > 0 && (
        <div>
          <div className="flex justify-between text-[9px] font-bold text-slate-400 mb-1">
            <span>Companies submitted</span>
            <span>{submitted}/{total}</span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-500 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      {isDraft && (
        <p className="text-[9px] text-amber-600 dark:text-amber-500 font-bold">
          Click to edit and open to companies →
        </p>
      )}
    </button>
  );
}

// Missing ChevronLeft import — add it here as a simple inline fallback
// (Already imported above from lucide-react)

export default S1PromotionBoard;
