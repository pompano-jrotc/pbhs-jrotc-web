// src/pages/UniformGuide.jsx
//
// Interactive Army JROTC Uniform Placement Guide.
// Step 1: Select Class A / Class B and Male / Female.
// Step 2: Pick your ribbons, medals, and arcs.
// Step 3: Tap any zone on the SVG uniform to see placement instructions
//         and — when a videoId is set on a zone — an embedded tutorial video.

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, Check, Award, Shield, Info, Play, Star } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta';

// ── RIBBONS (sorted by precedence, 1 = most prestigious) ─────────────────────
// stripes: left-to-right colors rendered as equal-width vertical bands on a
// 44×24 px ribbon bar.  These match the standard Army JROTC ribbon colors.
const RIBBONS = [
  { id: 'r01', name: 'Distinguished Cadet Award',               precedence: 1,
    stripes: ['#1B3A6B','#B8962E','#1B3A6B','#B8962E','#1B3A6B','#B8962E','#1B3A6B'] },
  { id: 'r02', name: 'Superior Cadet Award',                    precedence: 2,
    stripes: ['#1B3A6B','#C8C8C8','#1B3A6B','#C8C8C8','#1B3A6B','#C8C8C8','#1B3A6B'] },
  { id: 'r03', name: 'Academic Excellence Ribbon',              precedence: 3,
    stripes: ['#B8962E','#FFFFFF','#B8962E','#1B3A6B','#B8962E','#FFFFFF','#B8962E'] },
  { id: 'r04', name: 'Physical Fitness Ribbon',                 precedence: 4,
    stripes: ['#2E6B3A','#B8962E','#FFFFFF','#B8962E','#2E6B3A'] },
  { id: 'r05', name: 'Drill Team Ribbon',                       precedence: 5,
    stripes: ['#B81C1C','#FFFFFF','#B81C1C','#FFFFFF','#B81C1C'] },
  { id: 'r06', name: 'Color Guard Ribbon',                      precedence: 6,
    stripes: ['#1B3A6B','#B8962E','#FFFFFF','#B8962E','#1B3A6B'] },
  { id: 'r07', name: 'Rifle Team Ribbon',                       precedence: 7,
    stripes: ['#3A4A28','#8A8A6A','#3A4A28','#8A8A6A','#3A4A28'] },
  { id: 'r08', name: 'Community Service Ribbon',                precedence: 8,
    stripes: ['#5B2D8E','#FFFFFF','#5B2D8E','#FFFFFF','#5B2D8E'] },
  { id: 'r09', name: 'Leadership Excellence Ribbon',            precedence: 9,
    stripes: ['#1B3A6B','#B8962E','#FFFFFF','#1B3A6B','#FFFFFF','#B8962E','#1B3A6B'] },
  { id: 'r10', name: 'Recruiting Ribbon',                       precedence: 10,
    stripes: ['#B81C1C','#1B3A6B','#FFFFFF','#1B3A6B','#B81C1C'] },
  { id: 'r11', name: 'Orienteering Ribbon',                     precedence: 11,
    stripes: ['#2E6B3A','#FFFFFF','#2E6B3A','#FFFFFF','#2E6B3A'] },
  { id: 'r12', name: 'Military Ball Ribbon',                    precedence: 12,
    stripes: ['#1A1A1A','#B8962E','#1A1A1A','#B8962E','#1A1A1A'] },
  { id: 'r13', name: 'JROTC Leadership & Academic Bowl Ribbon', precedence: 13,
    stripes: ['#B81C1C','#FFFFFF','#1B3A6B','#FFFFFF','#B81C1C'] },
  { id: 'r14', name: 'Attendance Ribbon',                       precedence: 14,
    stripes: ['#3A5240','#B8962E','#3A5240'] },
];

// medalRibbon: color of the suspension ribbon above the disc
// discOuter / discInner: medal face colors
const MEDALS = [
  { id: 'm01', name: 'JROTC Medal',                  precedence: 1,
    medalRibbon: ['#1B3A6B','#B8962E','#1B3A6B'], discOuter: '#B8962E', discInner: '#D4AF50' },
  { id: 'm02', name: 'Scholastic Excellence Medal',  precedence: 2,
    medalRibbon: ['#B8962E','#FFFFFF','#B8962E'], discOuter: '#B8962E', discInner: '#F0D060' },
  { id: 'm03', name: 'Athletic Achievement Medal',   precedence: 3,
    medalRibbon: ['#2E6B3A','#B8962E','#2E6B3A'], discOuter: '#B8962E', discInner: '#D4AF50' },
];

// arcFill: the background fill color of the arc tab patch
const ARCS = [
  { id: 'a01', name: 'Distinguished Cadet Arc', arcFill: '#1B3A6B', arcText: '#B8962E' },
  { id: 'a02', name: 'Academic Arc',            arcFill: '#B8962E', arcText: '#FFFFFF' },
  { id: 'a03', name: 'Drill Arc',               arcFill: '#B81C1C', arcText: '#FFFFFF' },
  { id: 'a04', name: 'Color Guard Arc',         arcFill: '#1A1A1A', arcText: '#B8962E' },
];

// ── VISUAL SWATCH COMPONENTS ──────────────────────────────────────────────────

// Horizontal-stripe ribbon bar (matches real ribbon proportions ≈ 44×24 px)
function RibbonSwatch({ stripes = ['#888'] }) {
  const W = 44, H = 24;
  const sw = W / stripes.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
         className="flex-shrink-0 rounded-[3px] border border-black/25 shadow-sm">
      {stripes.map((c, i) => (
        <rect key={i} x={i * sw} y={0} width={sw + 0.5} height={H} fill={c} />
      ))}
      {/* Subtle gloss overlay */}
      <rect x={0} y={0} width={W} height={H / 2.5} fill="white" opacity="0.08" />
    </svg>
  );
}

// Medal — suspension ribbon + disc
function MedalSwatch({ medalRibbon = ['#B8962E'], discOuter = '#B8962E', discInner = '#D4AF50' }) {
  const W = 28, H = 40;
  const stripes = medalRibbon;
  const sw = W / stripes.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="flex-shrink-0">
      {/* Suspension ribbon bar */}
      {stripes.map((c, i) => (
        <rect key={i} x={i * sw} y={0} width={sw + 0.5} height={14} fill={c} />
      ))}
      <rect x={0} y={0} width={W} height={14} fill="white" opacity="0.07" />
      <rect x={0} y={0} width={W} height={14} rx="2" ry="2"
            fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="0.6" />
      {/* Suspension wire */}
      <line x1={W / 2} y1={14} x2={W / 2} y2={22} stroke="#8A7A50" strokeWidth="1.5" />
      {/* Medal disc */}
      <circle cx={W / 2} cy={31} r={9}  fill={discOuter} />
      <circle cx={W / 2} cy={31} r={6}  fill={discInner} opacity="0.9" />
      <circle cx={W / 2} cy={31} r={3}  fill={discOuter} opacity="0.6" />
      <circle cx={W / 2} cy={29} r={9}  fill="white" opacity="0.06" />
    </svg>
  );
}

// Arc tab patch — curved shape with text label
function ArcSwatch({ arcFill = '#1B3A6B', arcText = '#FFFFFF', label = '' }) {
  const short = label.replace(' Arc', '').replace(' Cadet', '').slice(0, 6).toUpperCase();
  return (
    <svg width={52} height={22} viewBox="0 0 52 22" className="flex-shrink-0">
      {/* Arc background */}
      <path d="M 2 20 Q 26 2 50 20 Z" fill={arcFill} />
      <path d="M 2 20 Q 26 4 50 20" fill="none" stroke={arcFill} strokeWidth="8" />
      {/* Border */}
      <path d="M 2 20 Q 26 2 50 20" fill="none" stroke={arcText} strokeWidth="1" opacity="0.5" />
      {/* Label text along the arc */}
      <text
        x="26" y="17"
        textAnchor="middle"
        fontSize="6"
        fontWeight="800"
        fontFamily="system-ui, sans-serif"
        fill={arcText}
        letterSpacing="0.8"
      >
        {short}
      </text>
    </svg>
  );
}

// ── ZONE DEFINITIONS ─────────────────────────────────────────────────────────
// Set videoId to a YouTube video ID string to enable the Watch Tutorial button.
const ZONES = {
  beret: {
    id: 'beret',
    label: 'Beret',
    sublabel: 'Head',
    steps: [
      'Position the flash (unit shield) directly over your LEFT eye — centered above it.',
      'Beret drapes to the RIGHT — excess fabric falls to the right side of your head.',
      'Headband sits ⅝ inch above the left ear and ⅛ inch above the right ear.',
      'Rank disc is centered on the flash.',
      'Shape the top: tuck and smooth excess fabric until completely flat — no bumps or wrinkles visible.',
      'Check in a mirror — the left side should sit flush over the ear.',
    ],
    videoId: null,
  },
  leftCollar: {
    id: 'leftCollar',
    label: 'Rank Insignia',
    sublabel: 'Left Collar',
    steps: [
      'Cadet rank device goes on the LEFT collar tip.',
      'Position ½ inch from the front (opening) edge of the collar.',
      'Center the device vertically on the collar point.',
      'Device faces FORWARD — toward the collar opening, not inward.',
      'Clutch backs must be fully seated — no loose or missing pins.',
    ],
    videoId: null,
  },
  rightCollar: {
    id: 'rightCollar',
    label: '"U.S." Insignia',
    sublabel: 'Right Collar Only',
    steps: [
      '"U.S." brass letters go on the RIGHT collar tip ONLY.',
      'Position ½ inch from the front (opening) edge of the collar.',
      'Center the device vertically on the collar point.',
      'Gold brass finish — polish to a mirror shine before wearing.',
      'Never place any other device on the right collar.',
    ],
    videoId: null,
  },
  ribbons: {
    id: 'ribbons',
    label: 'Ribbons',
    sublabel: 'Above Left Breast Pocket',
    steps: [
      'Ribbons are worn ABOVE the left breast pocket.',
      'Highest precedence ribbon at the TOP-LEFT position.',
      'Read across each row left to right, then down to the next row.',
      'Maximum 3 ribbons per row (horizontal).',
      'Bottom of the lowest row sits ⅛ inch ABOVE the pocket flap.',
      'Center all rows over the pocket — use a ruler to align.',
      'Ribbons must be clean, straight, and level — no tilting.',
    ],
    videoId: null,
  },
  medals: {
    id: 'medals',
    label: 'Medals',
    sublabel: 'Below Ribbons — Class A Only',
    steps: [
      'Medals hang below ribbons on the LEFT chest.',
      'On formal occasions, medals are worn INSTEAD OF ribbons — do not wear both simultaneously.',
      'Highest precedence medal on the RIGHT side (closest to the center buttons).',
      'Suspend from a standard medal bar — all medals at the same height.',
      'Medal bar centered ¼ inch below the ribbon row.',
    ],
    videoId: null,
  },
  nameTag: {
    id: 'nameTag',
    label: 'Name Tag',
    sublabel: 'Above Right Breast Pocket',
    steps: [
      'Name tag is worn above the RIGHT breast pocket.',
      'Centered over the pocket — must not tilt.',
      'Bottom of name tag sits ⅛ inch ABOVE the pocket flap.',
      'Format: last name only in block capital letters.',
      'Pin straight — use a ruler or the pocket seam as a guide.',
    ],
    videoId: null,
  },
  sleeve: {
    id: 'sleeve',
    label: 'Sleeve Insignia',
    sublabel: 'Left Upper Sleeve',
    steps: [
      'JROTC shoulder sleeve insignia (SSI) on the LEFT upper sleeve.',
      'Centered on the outside (front-facing) of the sleeve.',
      '½ inch below the shoulder seam.',
      'Authorized arcs worn directly BELOW the SSI patch.',
      'Maximum one arc unless specifically authorized.',
      'Edges must lie flat — no bubbles or peeling at the border.',
    ],
    videoId: null,
  },
  belt: {
    id: 'belt',
    label: 'Belt',
    sublabel: 'Waistline',
    steps: [
      'Black dress belt with polished brass buckle.',
      'Thread through ALL belt loops — buckle centered at the front.',
      'Tip of belt passes through buckle and into the FIRST loop to the LEFT.',
      'No visible excess belt beyond that first left loop.',
      'Brass buckle polished to a mirror shine.',
      'Belt must be snug — must not shift during movement or inspection.',
    ],
    videoId: null,
  },
};

// ── STEP 1: CONFIGURE ─────────────────────────────────────────────────────────
function ConfigStep({ uniformType, setUniformType, gender, setGender, onNext }) {
  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 mb-4">
          Uniform Type
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { type: 'A', label: 'Class A', sub: 'Full dress coat — ribbons, medals, brass', emoji: '🎖️' },
            { type: 'B', label: 'Class B', sub: 'Shirt-sleeve — ribbons, no medals', emoji: '👕' },
          ].map(opt => (
            <button
              key={opt.type}
              onClick={() => setUniformType(opt.type)}
              className={`relative p-6 rounded-2xl border-2 text-left transition-all ${
                uniformType === opt.type
                  ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-500/10'
                  : 'border-slate-200 dark:border-white/10 hover:border-yellow-300 dark:hover:border-yellow-700'
              }`}
            >
              <div className="text-3xl mb-3">{opt.emoji}</div>
              <div className="font-black text-slate-900 dark:text-white text-lg">{opt.label}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{opt.sub}</div>
              {uniformType === opt.type && (
                <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-yellow-500 flex items-center justify-center">
                  <Check size={13} strokeWidth={3} className="text-slate-950" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 mb-4">
          Gender
        </h2>
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          {[
            { value: 'M', label: 'Male',   emoji: '♂️' },
            { value: 'F', label: 'Female', emoji: '♀️' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setGender(opt.value)}
              className={`relative p-6 rounded-2xl border-2 text-left transition-all ${
                gender === opt.value
                  ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-500/10'
                  : 'border-slate-200 dark:border-white/10 hover:border-yellow-300 dark:hover:border-yellow-700'
              }`}
            >
              <div className="text-3xl mb-3">{opt.emoji}</div>
              <div className="font-black text-slate-900 dark:text-white text-lg">{opt.label}</div>
              {gender === opt.value && (
                <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-yellow-500 flex items-center justify-center">
                  <Check size={13} strokeWidth={3} className="text-slate-950" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!uniformType || !gender}
        className="flex items-center gap-2 px-8 py-4 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 font-black uppercase tracking-widest text-sm rounded-2xl transition-all"
      >
        Select Your Items <ChevronRight size={18} />
      </button>
    </div>
  );
}

// ── STEP 2: ITEMS ─────────────────────────────────────────────────────────────
function ItemsStep({
  uniformType,
  selectedRibbons, setSelectedRibbons,
  selectedMedals,  setSelectedMedals,
  selectedArcs,    setSelectedArcs,
  onBack, onNext,
}) {
  const toggle = (setFn, id) => setFn(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const SectionHeader = ({ icon: Icon, label, count, color }) => (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} className={color} />
      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{label}</span>
      {count > 0 && (
        <span className="ml-auto text-[10px] font-black px-2 py-0.5 bg-yellow-500 text-slate-950 rounded-full">
          {count} selected
        </span>
      )}
    </div>
  );

  const ItemRow = ({ item, checked, onToggle, swatch }) => (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
        checked
          ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-500/10'
          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
      }`}
    >
      {/* Checkbox */}
      <div className={`w-5 h-5 rounded-md flex-shrink-0 border-2 flex items-center justify-center transition-all ${
        checked ? 'border-yellow-500 bg-yellow-500' : 'border-slate-300 dark:border-slate-600'
      }`}>
        {checked && <Check size={11} className="text-slate-950" strokeWidth={3} />}
      </div>
      {/* Item visual */}
      {swatch && <div className="flex-shrink-0">{swatch}</div>}
      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-snug">{item.name}</div>
        {item.precedence && (
          <div className="text-[10px] text-slate-400 mt-0.5">Precedence #{item.precedence}</div>
        )}
      </div>
    </button>
  );

  return (
    <div className="space-y-7 max-w-2xl">
      {/* Ribbons */}
      <div>
        <SectionHeader icon={Award} label="Ribbons" count={selectedRibbons.size} color="text-yellow-500" />
        <div className="space-y-2">
          {RIBBONS.map(r => (
            <ItemRow
              key={r.id}
              item={r}
              checked={selectedRibbons.has(r.id)}
              onToggle={() => toggle(setSelectedRibbons, r.id)}
              swatch={<RibbonSwatch stripes={r.stripes} />}
            />
          ))}
        </div>
      </div>

      {/* Medals — Class A only */}
      {uniformType === 'A' && (
        <div>
          <SectionHeader icon={Star} label="Medals" count={selectedMedals.size} color="text-yellow-500" />
          <div className="space-y-2">
            {MEDALS.map(m => (
              <ItemRow
                key={m.id}
                item={m}
                checked={selectedMedals.has(m.id)}
                onToggle={() => toggle(setSelectedMedals, m.id)}
                swatch={<MedalSwatch medalRibbon={m.medalRibbon} discOuter={m.discOuter} discInner={m.discInner} />}
              />
            ))}
          </div>
        </div>
      )}

      {/* Arcs */}
      <div>
        <SectionHeader icon={Shield} label="Arcs & Devices" count={selectedArcs.size} color="text-blue-400" />
        <div className="space-y-2">
          {ARCS.map(a => (
            <ItemRow
              key={a.id}
              item={a}
              checked={selectedArcs.has(a.id)}
              onToggle={() => toggle(setSelectedArcs, a.id)}
              swatch={<ArcSwatch arcFill={a.arcFill} arcText={a.arcText} label={a.name} />}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-3.5 rounded-2xl border-2 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-bold text-sm hover:border-slate-300 transition-colors"
        >
          <ChevronLeft size={15} /> Back
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-8 py-3.5 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black uppercase tracking-widest text-sm rounded-2xl transition-all"
        >
          View Placement <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ── UNIFORM SVG ───────────────────────────────────────────────────────────────
function UniformSVG({ activeZone, onZoneClick, assignedZones, uniformType }) {
  const isA = uniformType === 'A';

  const zStyle = (id) => {
    const active = activeZone === id;
    const has    = assignedZones.has(id);
    return {
      fill:        active ? '#F0C040' : has ? '#6ABF7A' : '#FFFFFF',
      fillOpacity: active ? 0.55     : has ? 0.38      : 0.10,
      stroke:      active ? '#F0C040' : has ? '#6ABF7A' : 'rgba(255,255,255,0.45)',
      strokeWidth: active ? 2.5      : has ? 1.5       : 0.8,
      cursor:      'pointer',
    };
  };

  const txt = {
    fill: 'white',
    fontSize: 7.5,
    fontWeight: 700,
    fontFamily: 'system-ui, sans-serif',
    pointerEvents: 'none',
    letterSpacing: 0.5,
  };

  const COAT_COLOR  = isA ? '#3A5240' : '#4A6850';
  const DARK_ACCENT = isA ? '#2A3F2A' : '#354A38';
  const POCKET_CLR  = isA ? '#2E4535' : '#3A5540';

  return (
    <svg
      viewBox="0 0 280 445"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full select-none"
      style={{ maxHeight: 510 }}
    >
      {/* ── BASE COAT / SHIRT ───────────────────────────────── */}
      {/* Main body */}
      <path d={`M 50 98 L 230 98 L 248 430 L 32 430 Z`} fill={COAT_COLOR} />
      {/* Left sleeve */}
      <path d="M 4 110 L 53 100 L 66 290 L 1 295 Z" fill={COAT_COLOR} />
      {/* Right sleeve */}
      <path d="M 276 110 L 227 100 L 214 290 L 279 295 Z" fill={COAT_COLOR} />
      {/* Left lapel */}
      <path d="M 50 98 L 111 98 L 140 192 Z" fill={DARK_ACCENT} />
      {/* Right lapel */}
      <path d="M 230 98 L 169 98 L 140 192 Z" fill={DARK_ACCENT} />
      {/* Lapel seam lines */}
      <line x1="111" y1="98"  x2="140" y2="192" stroke="#1C301C" strokeWidth="0.8" />
      <line x1="169" y1="98"  x2="140" y2="192" stroke="#1C301C" strokeWidth="0.8" />
      {/* Shoulder boards */}
      <rect x="45"  y="89" width="34" height="13" rx="3" fill="#4E6E50" />
      <rect x="201" y="89" width="34" height="13" rx="3" fill="#4E6E50" />
      {/* Chest pocket flaps */}
      <rect x="91"  y="200" width="47" height="8"  rx="1.5" fill={DARK_ACCENT} />
      <rect x="142" y="200" width="47" height="8"  rx="1.5" fill={DARK_ACCENT} />
      {/* Chest pockets */}
      <rect x="91"  y="200" width="47" height="43" rx="2" fill={POCKET_CLR} />
      <rect x="142" y="200" width="47" height="43" rx="2" fill={POCKET_CLR} />
      {/* Lower pockets — Class A */}
      {isA && <>
        <rect x="63"  y="315" width="54" height="50" rx="2" fill={POCKET_CLR} />
        <rect x="163" y="315" width="54" height="50" rx="2" fill={POCKET_CLR} />
        <rect x="63"  y="313" width="54" height="9"  rx="1.5" fill={DARK_ACCENT} />
        <rect x="163" y="313" width="54" height="9"  rx="1.5" fill={DARK_ACCENT} />
      </>}
      {/* Belt */}
      <rect x="32"  y="270" width="216" height="18" rx="1" fill="#1A1A1A" />
      {/* Belt buckle */}
      <rect x="126" y="267" width="28" height="24" rx="2" fill="#B8962E" />
      <rect x="129" y="270" width="22" height="18" rx="1" fill="#D4AF50" opacity="0.35" />
      {/* Buttons (Class A center line) */}
      {isA && [196, 220, 245, 265].map(y => (
        <circle key={y} cx="140" cy={y} r="4" fill="#B8962E" />
      ))}
      {/* Black neck tab (Class A) */}
      {isA && <rect x="133" y="182" width="14" height="22" rx="2" fill="#111111" />}

      {/* ── BERET ──────────────────────────────────────────── */}
      <g onClick={() => onZoneClick('beret')} style={{ cursor: 'pointer' }}>
        <ellipse cx="128" cy="53" rx="70" ry="23"  fill="#2A3820" />
        <path d="M 130 63 Q 184 72 222 60 Q 242 56 250 52"
              stroke="#1C2A18" strokeWidth="4" fill="none" />
        <ellipse cx="128" cy="68" rx="70" ry="9"  fill="#1A2A18" />
        <circle cx="106" cy="48" r="11" fill="#3A5240" stroke="#B8962E" strokeWidth="1.5" />
        <circle cx="106" cy="48" r="6"  fill="#B8962E" opacity="0.9" />
        {/* Beret clickable overlay */}
        <ellipse cx="128" cy="53" rx="70" ry="23" style={zStyle('beret')} />
        <text x="152" y="51" textAnchor="middle" style={txt}>BERET</text>
      </g>

      {/* ── LEFT COLLAR — RANK ────────────────────────────── */}
      <g onClick={() => onZoneClick('leftCollar')} style={{ cursor: 'pointer' }}>
        <polygon points="50,98 111,98 78,128" style={zStyle('leftCollar')} />
        <text x="72" y="115" textAnchor="middle" style={{ ...txt, fontSize: 6.5 }}>RANK</text>
      </g>

      {/* ── RIGHT COLLAR — U.S. INSIGNIA ─────────────────── */}
      <g onClick={() => onZoneClick('rightCollar')} style={{ cursor: 'pointer' }}>
        <polygon points="230,98 169,98 202,128" style={zStyle('rightCollar')} />
        <text x="203" y="115" textAnchor="middle" style={{ ...txt, fontSize: 6.5 }}>U.S.</text>
      </g>

      {/* ── RIBBONS — left chest ──────────────────────────── */}
      <g onClick={() => onZoneClick('ribbons')} style={{ cursor: 'pointer' }}>
        <rect x="87" y="190" width="55" height="55" rx="4" style={zStyle('ribbons')} />
        <text x="114" y="215" textAnchor="middle" style={txt}>RIBBONS</text>
        {assignedZones.has('ribbons') && (
          <circle cx="134" cy="196" r="6" fill="#6ABF7A" />
        )}
      </g>

      {/* ── NAME TAG — right chest ────────────────────────── */}
      <g onClick={() => onZoneClick('nameTag')} style={{ cursor: 'pointer' }}>
        <rect x="138" y="190" width="55" height="55" rx="4" style={zStyle('nameTag')} />
        <text x="165" y="212" textAnchor="middle" style={txt}>NAME</text>
        <text x="165" y="222" textAnchor="middle" style={txt}>TAG</text>
      </g>

      {/* ── MEDALS — below ribbons, Class A only ────────── */}
      {isA && (
        <g onClick={() => onZoneClick('medals')} style={{ cursor: 'pointer' }}>
          <rect x="87" y="248" width="55" height="20" rx="3" style={zStyle('medals')} />
          <text x="114" y="261" textAnchor="middle" style={{ ...txt, fontSize: 6.5 }}>MEDALS</text>
        </g>
      )}

      {/* ── BELT ──────────────────────────────────────────── */}
      <g onClick={() => onZoneClick('belt')} style={{ cursor: 'pointer' }}>
        <rect x="32" y="268" width="216" height="22" rx="3" style={zStyle('belt')} />
        <text x="140" y="282" textAnchor="middle" style={txt}>BELT</text>
      </g>

      {/* ── SLEEVE INSIGNIA — left sleeve ────────────────── */}
      <g onClick={() => onZoneClick('sleeve')} style={{ cursor: 'pointer' }}>
        <rect x="5" y="120" width="52" height="64" rx="4" style={zStyle('sleeve')} />
        <text x="31" y="147" textAnchor="middle" style={{ ...txt, fontSize: 6.5 }}>SLEEVE</text>
        <text x="31" y="157" textAnchor="middle" style={{ ...txt, fontSize: 6.5 }}>INSIGNIA</text>
      </g>
    </svg>
  );
}

// ── RIBBON ARRANGEMENT PREVIEW ────────────────────────────────────────────────
function RibbonGrid({ ribbons }) {
  if (!ribbons.length) return null;
  const rows = [];
  for (let i = 0; i < ribbons.length; i += 3) rows.push(ribbons.slice(i, i + 3));

  return (
    <div className="mb-5">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
        Arrangement Preview
      </p>
      <div className="space-y-1">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1">
            {row.map(r => (
              <div key={r.id} title={r.name}>
                <RibbonSwatch stripes={r.stripes} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">
        Top-left = highest precedence · Read left → right, then down.
      </p>
    </div>
  );
}

// ── ZONE DETAIL PANEL ─────────────────────────────────────────────────────────
function ZonePanel({ zoneId, selectedRibbons, selectedMedals, selectedArcs }) {
  const [showVideo, setShowVideo] = useState(false);
  const zone = ZONES[zoneId];
  if (!zone) return null;

  let items      = [];
  let ribbonList = [];

  if (zoneId === 'ribbons') {
    ribbonList = RIBBONS
      .filter(r => selectedRibbons.has(r.id))
      .sort((a, b) => a.precedence - b.precedence);
    items = ribbonList.map(r => ({ name: r.name, sub: `Precedence #${r.precedence}` }));
  } else if (zoneId === 'medals') {
    items = MEDALS
      .filter(m => selectedMedals.has(m.id))
      .sort((a, b) => a.precedence - b.precedence)
      .map(m => ({ name: m.name, sub: `Precedence #${m.precedence}` }));
  } else if (zoneId === 'sleeve') {
    items = ARCS.filter(a => selectedArcs.has(a.id)).map(a => ({ name: a.name }));
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <div className="w-1.5 h-7 rounded-full bg-yellow-500 flex-shrink-0" />
          <h3 className="text-xl font-black text-slate-900 dark:text-white">{zone.label}</h3>
        </div>
        {zone.sublabel && (
          <p className="text-xs text-slate-400 pl-3.5">{zone.sublabel}</p>
        )}
      </div>

      {/* Ribbon arrangement preview */}
      {zoneId === 'ribbons' && ribbonList.length > 0 && (
        <RibbonGrid ribbons={ribbonList} />
      )}

      {/* Items assigned to this zone */}
      {items.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Your Items Here</p>
          <div className="space-y-1.5">
            {items.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 p-2.5 rounded-xl bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200/60 dark:border-yellow-500/20"
              >
                <span className="text-[10px] font-black text-yellow-600 dark:text-yellow-400 w-4 text-right flex-shrink-0">
                  {i + 1}
                </span>
                <div>
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200">{item.name}</div>
                  {item.sub && <div className="text-[10px] text-slate-400">{item.sub}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step-by-step instructions */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">How To Place It</p>
        <ol className="space-y-3">
          {zone.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-black flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Video slot */}
      {zone.videoId ? (
        !showVideo ? (
          <button
            onClick={() => setShowVideo(true)}
            className="w-full p-4 bg-slate-900 dark:bg-black/50 rounded-2xl flex items-center gap-3 hover:bg-slate-800 dark:hover:bg-black/70 transition-colors border border-slate-800 dark:border-white/10"
          >
            <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center flex-shrink-0">
              <Play size={15} className="text-white ml-0.5" fill="white" />
            </div>
            <span className="text-white font-bold text-sm">Watch Tutorial</span>
          </button>
        ) : (
          <div className="aspect-video rounded-2xl overflow-hidden bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${zone.videoId}?autoplay=1`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title={`${zone.label} tutorial`}
            />
          </div>
        )
      ) : (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10">
          <Info size={14} className="text-slate-400 flex-shrink-0" />
          <p className="text-[11px] text-slate-500">Tutorial video coming soon — follow the steps above.</p>
        </div>
      )}
    </div>
  );
}

// ── STEP 3: PLACEMENT ─────────────────────────────────────────────────────────
function PlacementStep({ uniformType, gender, selectedRibbons, selectedMedals, selectedArcs, onBack }) {
  const [activeZone, setActiveZone] = useState(null);

  const assignedZones = useMemo(() => {
    const z = new Set(['beret', 'leftCollar', 'rightCollar', 'nameTag', 'belt']);
    if (selectedRibbons.size > 0) z.add('ribbons');
    if (selectedMedals.size > 0)  z.add('medals');
    if (selectedArcs.size > 0)    z.add('sleeve');
    return z;
  }, [selectedRibbons, selectedMedals, selectedArcs]);

  const handleZoneClick = (id) => setActiveZone(prev => prev === id ? null : id);

  const zoneOrder = uniformType === 'A'
    ? ['beret', 'leftCollar', 'rightCollar', 'ribbons', 'medals', 'nameTag', 'sleeve', 'belt']
    : ['beret', 'leftCollar', 'rightCollar', 'ribbons', 'nameTag', 'sleeve', 'belt'];

  return (
    <div className="space-y-6">
      {/* Tip */}
      <div className="flex items-center gap-3 bg-slate-100 dark:bg-white/5 rounded-xl p-3">
        <Info size={14} className="text-slate-400 flex-shrink-0" />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Tap any highlighted zone on the uniform to see placement instructions.
          <span className="inline-flex items-center gap-1 ml-2 font-bold">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#6ABF7A' }} />
            = has items assigned
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Uniform diagram */}
        <div className="flex justify-center">
          <div className="w-full max-w-[260px]">
            <UniformSVG
              activeZone={activeZone}
              onZoneClick={handleZoneClick}
              assignedZones={assignedZones}
              uniformType={uniformType}
            />
          </div>
        </div>

        {/* Zone detail */}
        <div>
          <AnimatePresence mode="wait">
            {activeZone ? (
              <motion.div
                key={activeZone}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/10 shadow-sm"
              >
                <ZonePanel
                  key={activeZone}
                  zoneId={activeZone}
                  selectedRibbons={selectedRibbons}
                  selectedMedals={selectedMedals}
                  selectedArcs={selectedArcs}
                />
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center p-10 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10 text-center min-h-[200px]"
              >
                <div className="text-4xl mb-3">👆</div>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Tap a zone on the uniform</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">to see where and how to place it</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Quick-access zone buttons */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5">Jump to Zone</p>
        <div className="flex flex-wrap gap-2">
          {zoneOrder.map(id => {
            const z        = ZONES[id];
            if (!z) return null;
            const isActive = activeZone === id;
            const hasItems = assignedZones.has(id);
            return (
              <button
                key={id}
                onClick={() => handleZoneClick(id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-yellow-500 text-slate-950'
                    : hasItems
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300 dark:border-green-700'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-500 border border-slate-200 dark:border-white/10 hover:border-slate-300'
                }`}
              >
                {z.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Female-specific note */}
      {gender === 'F' && (
        <div className="flex items-start gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-3">
          <Info size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-400">
            Female cadets: earrings must be gold ball studs ≤ 6 mm. Nail polish must be a single natural shade.
            Beret hair must be pinned up so no hair is visible below the headband.
          </p>
        </div>
      )}

      <button
        onClick={onBack}
        className="flex items-center gap-2 px-5 py-3 rounded-2xl border-2 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 font-bold text-sm hover:border-slate-300 transition-colors"
      >
        <ChevronLeft size={15} /> Back to Items
      </button>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function UniformGuide() {
  usePageMeta({
    title: 'Uniform Guide',
    description: 'Interactive Army JROTC uniform placement guide — select your type, input your ribbons and devices, and see exactly where each item goes.',
    path: '/cadet-info/uniform',
  });

  const [step, setStep] = useState(0);
  const [uniformType, setUniformType] = useState(null);
  const [gender, setGender] = useState(null);
  const [selectedRibbons, setSelectedRibbons] = useState(new Set());
  const [selectedMedals,  setSelectedMedals]  = useState(new Set());
  const [selectedArcs,    setSelectedArcs]    = useState(new Set());

  const STEP_LABELS = ['Configure', 'Your Items', 'Placement'];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="relative bg-slate-900 dark:bg-black overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 opacity-90" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,.03) 39px,rgba(255,255,255,.03) 40px),' +
              'repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,.03) 39px,rgba(255,255,255,.03) 40px)',
          }}
        />
        <div className="relative max-w-5xl mx-auto px-6 py-16">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-yellow-500 mb-4">
            Battalion Resources
          </p>
          <h1 className="text-4xl md:text-6xl font-black uppercase italic text-white leading-none mb-4">
            Uniform<br /><span className="text-yellow-500">Placement Guide</span>
          </h1>
          <p className="text-slate-400 text-sm max-w-xl leading-relaxed">
            Select your uniform type, enter your ribbons and devices — see exactly where each
            item goes and how to place it correctly.
          </p>
        </div>
      </div>

      {/* ── Step indicator ─────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={i}>
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i >= step}
                className={`flex items-center gap-2 text-xs font-bold transition-all ${
                  i < step
                    ? 'cursor-pointer text-yellow-600 dark:text-yellow-400 hover:text-yellow-500'
                    : i === step
                    ? 'text-slate-900 dark:text-white cursor-default'
                    : 'text-slate-400 cursor-default'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                  i < step
                    ? 'bg-yellow-500 text-slate-950'
                    : i === step
                    ? 'bg-slate-800 dark:bg-white text-white dark:text-slate-900'
                    : 'bg-slate-200 dark:bg-white/10 text-slate-500'
                }`}>
                  {i < step ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span className="hidden sm:block">{label}</span>
              </button>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 max-w-12 h-px rounded-full ${
                  i < step ? 'bg-yellow-500' : 'bg-slate-200 dark:bg-white/10'
                }`} />
              )}
            </React.Fragment>
          ))}
          {step > 0 && uniformType && gender && (
            <span className="ml-auto text-[10px] font-black text-slate-400 dark:text-slate-500 hidden md:block">
              Class {uniformType} · {gender === 'M' ? 'Male' : 'Female'}
            </span>
          )}
        </div>
      </div>

      {/* ── Step content ───────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22 }}
          >
            {step === 0 && (
              <ConfigStep
                uniformType={uniformType} setUniformType={setUniformType}
                gender={gender} setGender={setGender}
                onNext={() => setStep(1)}
              />
            )}
            {step === 1 && (
              <ItemsStep
                uniformType={uniformType}
                selectedRibbons={selectedRibbons} setSelectedRibbons={setSelectedRibbons}
                selectedMedals={selectedMedals}   setSelectedMedals={setSelectedMedals}
                selectedArcs={selectedArcs}       setSelectedArcs={setSelectedArcs}
                onBack={() => setStep(0)}
                onNext={() => setStep(2)}
              />
            )}
            {step === 2 && (
              <PlacementStep
                uniformType={uniformType}
                gender={gender}
                selectedRibbons={selectedRibbons}
                selectedMedals={selectedMedals}
                selectedArcs={selectedArcs}
                onBack={() => setStep(1)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

    </div>
  );
}
