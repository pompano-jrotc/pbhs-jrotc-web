// src/pages/MyLeadership.jsx
// Interactive zoomable/pannable battalion org chart.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { Search, Shield, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
// Shield kept for the empty-state fallback
import { usePageMeta } from '../hooks/usePageMeta';

// ── Layout constants ──────────────────────────────────────────────────────────
const NW = 114;   // node width
const NH = 54;    // node height
const HG = 10;    // horizontal gap between siblings
const VG = 44;    // vertical gap between levels

const BATTALION_CO = new Set(['Battalion', 'Zulu', 'HQ', '', null, undefined]);
const COMPANY_ORDER = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

const ASST_ORDER = {
  'Company S1 Assistant': 1, 'Company S2 Assistant': 2,
  'Company S3 Assistant': 3, 'Company S4 Assistant': 4,
  'Company S5 Assistant': 5, 'Company S6 Assistant': 6,
  'Company S7 Assistant': 7,
};

// ── Build org-tree from flat roster entries ───────────────────────────────────
let _uid = 0;
const makeNode = (entry, children = []) => ({
  id: entry?.id || `v-${++_uid}`,
  entry: entry || null,
  children,
  x: 0, y: 0, _w: 0,
});

function buildTree(entries) {
  _uid = 0;

  const findFirst = (pos, co = null) =>
    entries.find(e =>
      e.position === pos &&
      (co !== null ? e.company === co : BATTALION_CO.has(e.company))
    );

  const findAll = (pos, co = null) =>
    entries.filter(e =>
      e.position === pos &&
      (co !== null ? e.company === co : BATTALION_CO.has(e.company))
    );

  // ── Company subtree ─────────────────────────────────────────────────────────
  function buildCompany(co) {
    const coEntries = entries.filter(e => e.company === co);
    if (coEntries.length === 0) return null;

    const cc   = coEntries.find(e => e.position === 'Company Commander');
    const xo   = coEntries.find(e => e.position === 'Company XO');
    const isg  = coEntries.find(e => e.position === 'First Sergeant');
    const msg  = coEntries.find(e => e.position === 'Master Sergeant');
    // Only Company S1–S7 assistants go under XO — NOT Squad Leader Assistants
    const asst = coEntries
      .filter(e => e.position in ASST_ORDER)
      .sort((a, b) => (ASST_ORDER[a.position] ?? 99) - (ASST_ORDER[b.position] ?? 99));

    // Field entries: everything except HQ command and company staff assistants
    // Squad Leader Assistants ARE field entries — they belong in their squad
    const HQ_POS = new Set(['Company Commander','Company XO','First Sergeant','Master Sergeant']);
    const field  = coEntries.filter(e => !HQ_POS.has(e.position) && !(e.position in ASST_ORDER));

    // Group field entries by platoon
    const byPlatoon = {};
    for (const e of field) {
      const pl = e.platoon || 'Unassigned';
      if (!byPlatoon[pl]) byPlatoon[pl] = [];
      byPlatoon[pl].push(e);
    }

    const platoonNodes = Object.entries(byPlatoon)
      .sort(([a], [b]) =>
        a === 'Company HQ' ? -1 : b === 'Company HQ' ? 1 :
        a === 'Unassigned'  ?  1 : b === 'Unassigned'  ? -1 :
        a.localeCompare(b, undefined, { numeric: true })
      )
      .map(([pl, plEs]) => {
        const plLeader = plEs.find(e => e.position === 'Platoon Leader');
        const plSgt    = plEs.find(e => e.position === 'Platoon Sergeant');
        const rest     = plEs.filter(e => !['Platoon Leader','Platoon Sergeant'].includes(e.position));

        // Group remaining by squad
        const bySquad = {};
        for (const e of rest) {
          const sq = e.squad || 'Unassigned';
          if (!bySquad[sq]) bySquad[sq] = [];
          bySquad[sq].push(e);
        }

        const squadNodes = Object.entries(bySquad)
          .sort(([a], [b]) =>
            a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 :
            a.localeCompare(b, undefined, { numeric: true })
          )
          .map(([, sqEs]) => {
            const sl      = sqEs.find(e => e.position === 'Squad Leader');
            const slas    = sqEs.filter(e => e.position === 'Squad Leader Assistant');
            const members = sqEs.filter(e => !['Squad Leader','Squad Leader Assistant'].includes(e.position));
            const memberNodes = members.map(e => makeNode(e));
            // SLAs sit between SL and squad members
            let slChildren;
            if (slas.length === 1) {
              slChildren = [makeNode(slas[0], memberNodes)];
            } else if (slas.length > 1) {
              slChildren = slas.map((sla, i) => makeNode(sla, i === 0 ? memberNodes : []));
            } else {
              slChildren = memberNodes;
            }
            return makeNode(sl, slChildren);
          });

        // PS → squads, PL → [PS] or squads directly
        const psNode = plSgt ? makeNode(plSgt, squadNodes) : null;
        return makeNode(plLeader, psNode ? [psNode] : squadNodes);
      });

    // XO has company staff assistants as children
    const xoNode = makeNode(xo, asst.map(e => makeNode(e)));

    // 1SG has MSG + platoons as children
    const msgNode = msg ? makeNode(msg) : null;
    const isgChildren = [msgNode, ...platoonNodes].filter(Boolean);
    const isgNode = isg ? makeNode(isg, isgChildren) : null;

    // CC children: XO (with assistants), 1SG (with MSG + platoons)
    const ccChildren = [
      xoNode,
      isgNode ?? (isgChildren.length ? makeNode(null, isgChildren) : null),
    ].filter(Boolean);

    return makeNode(cc, ccChildren);
  }

  // ── Battalion backbone ──────────────────────────────────────────────────────
  const bc  = findFirst('Battalion Commander');
  const xo  = findFirst('Battalion XO');
  const csm = findFirst('Battalion CSM');
  const sgm = findFirst('Sergeant Major');
  const dco = findFirst('Battalion Deputy Commander');

  const staffPositions = [
    'Battalion Staff (S-1)', 'Battalion Staff (S-2)', 'Battalion Staff (S-3)',
    'Battalion Staff (S-4)', 'Battalion Staff (S-5)', 'Battalion Staff (S-6)',
    'Battalion Staff (S-7)',
  ];
  const staff = staffPositions.flatMap(pos => findAll(pos).map(e => makeNode(e)));

  const xoNode  = makeNode(xo,  staff);
  const csmNode = makeNode(csm, [sgm ? makeNode(sgm) : null].filter(Boolean));
  const dcoNode = dco ? makeNode(dco) : null;

  const companyNodes = COMPANY_ORDER.map(buildCompany).filter(Boolean);

  const bcChildren = [xoNode, csmNode, dcoNode, ...companyNodes].filter(Boolean);
  return makeNode(bc, bcChildren);
}

// ── Tree layout (Reingold-Tilford style) ──────────────────────────────────────
function layoutTree(root) {
  // Bottom-up: measure each subtree's total width
  function measure(node) {
    if (!node.children || node.children.length === 0) {
      node._w = NW;
      return;
    }
    node.children.forEach(measure);
    const total = node.children.reduce((s, c) => s + c._w, 0)
                + HG * (node.children.length - 1);
    node._w = Math.max(NW, total);
  }

  // Top-down: assign x (center) and y (depth row)
  function place(node, left, depth) {
    node.x = left + node._w / 2;
    node.y = depth * (NH + VG) + VG / 2;
    if (!node.children || node.children.length === 0) return;

    // Centre the children group under the node's subtree
    const childrenTotalW = node.children.reduce((s, c) => s + c._w, 0)
                         + HG * (node.children.length - 1);
    let cx = left + (node._w - childrenTotalW) / 2;
    for (const child of node.children) {
      place(child, cx, depth + 1);
      cx += child._w + HG;
    }
  }

  measure(root);
  place(root, 0, 0);
  return root;
}

// ── Flatten to { nodes[], edges[] } ──────────────────────────────────────────
function flatten(root) {
  const nodes = [], edges = [];
  function walk(node, parentId) {
    nodes.push(node);
    if (parentId !== null) edges.push({ from: parentId, to: node.id });
    if (node.children) node.children.forEach(c => walk(c, node.id));
  }
  walk(root, null);
  return { nodes, edges };
}

// ── Node colour by position tier ─────────────────────────────────────────────
function nodeStyle(entry) {
  const pos = entry?.position || '';
  if (['Battalion Commander','Battalion XO','Battalion Deputy Commander',
       'Battalion CSM','Sergeant Major'].includes(pos))
    return { bg: '#1c1500', border: '#f59e0b', label: '#fbbf24', sub: '#d97706' };
  if (pos.startsWith('Battalion Staff'))
    return { bg: '#121a10', border: '#f59e0b60', label: '#86efac', sub: '#4ade80' };
  if (['Company Commander','Company XO','First Sergeant','Master Sergeant'].includes(pos))
    return { bg: '#0f1726', border: '#3b82f6', label: '#93c5fd', sub: '#60a5fa' };
  if (pos.includes('Assistant'))
    return { bg: '#13162a', border: '#6366f160', label: '#a5b4fc', sub: '#818cf8' };
  if (['Platoon Leader','Platoon Sergeant'].includes(pos))
    return { bg: '#121a12', border: '#22c55e60', label: '#86efac', sub: '#4ade80' };
  if (['Squad Leader','Squad Leader Assistant'].includes(pos))
    return { bg: '#161616', border: '#ffffff30', label: '#d1d5db', sub: '#9ca3af' };
  // Squad member / cadet / vacant
  return { bg: '#111111', border: '#ffffff14', label: '#9ca3af', sub: '#6b7280' };
}

// ── Elbow edge path ───────────────────────────────────────────────────────────
function edgePath(fn, tn) {
  const x1 = fn.x, y1 = fn.y + NH / 2;
  const x2 = tn.x, y2 = tn.y - NH / 2;
  const mid = (y1 + y2) / 2;
  return `M${x1},${y1} L${x1},${mid} L${x2},${mid} L${x2},${y2}`;
}

// ── Text truncation ───────────────────────────────────────────────────────────
const trunc = (s, n) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);

// ── Page component ────────────────────────────────────────────────────────────
export default function MyLeadership() {
  const { user, loading: authLoading } = useAuth();
  const [entries, setEntries]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [vp, setVp]               = useState({ x: 0, y: 40, scale: 1 });
  const [selected, setSelected]   = useState(null); // { node, x, y }

  const containerRef = useRef(null);
  const dragRef      = useRef(null);
  const wasDragRef   = useRef(false);
  const vpRef        = useRef(vp);

  usePageMeta({
    title: 'Chain of Command',
    description: 'Full battalion chain of command — interactive org chart.',
    path: '/admin/my/leadership',
  });

  // Keep ref in sync for event handlers
  useEffect(() => { vpRef.current = vp; }, [vp]);

  // ── Fetch roster ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || !user) return;
    const q = query(collection(db, 'roster'), orderBy('fullName', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [authLoading, user]);

  // ── Build + layout tree ─────────────────────────────────────────────────────
  const { nodes, edges, nodeMap, totalW, totalH } = useMemo(() => {
    if (entries.length === 0) return { nodes: [], edges: [], nodeMap: {}, totalW: 0, totalH: 0 };
    const root = buildTree(entries);
    layoutTree(root);
    const { nodes, edges } = flatten(root);
    const nodeMap = {};
    for (const n of nodes) nodeMap[n.id] = n;
    const totalW = Math.max(...nodes.map(n => n.x)) + NW / 2 + HG;
    const totalH = Math.max(...nodes.map(n => n.y)) + NH / 2 + VG;
    return { nodes, edges, nodeMap, totalW, totalH };
  }, [entries]);

  // ── Auto-fit on load ────────────────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const scale = Math.min(1, r.width / (totalW + 40), r.height / (totalH + 40)) * 0.9;
    setVp({ x: (r.width - totalW * scale) / 2, y: 40, scale });
  }, [nodes.length, totalW, totalH]);

  // ── Search highlight ────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!q) return new Set();
    return new Set(nodes.filter(n => n.entry?.fullName?.toLowerCase().includes(q)).map(n => n.id));
  }, [nodes, q]);

  // Pan to first match
  useEffect(() => {
    if (!q || matchIds.size === 0 || !containerRef.current) return;
    const first = nodes.find(n => matchIds.has(n.id));
    if (!first) return;
    const r = containerRef.current.getBoundingClientRect();
    setVp(v => ({
      ...v,
      x: r.width  / 2 - first.x * v.scale,
      y: r.height / 2 - first.y * v.scale,
    }));
  }, [matchIds, q]);

  // ── Wheel zoom ──────────────────────────────────────────────────────────────
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setVp(v => {
      const ns = Math.max(0.04, Math.min(3, v.scale * factor));
      return { scale: ns, x: mx - (mx - v.x) * (ns / v.scale), y: my - (my - v.y) * (ns / v.scale) };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Mouse drag ──────────────────────────────────────────────────────────────
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    wasDragRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: vpRef.current.x, vy: vpRef.current.y };
  };
  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const { sx, sy, vx, vy } = dragRef.current;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragRef.current = true;
    setVp(v => ({ ...v, x: vx + dx, y: vy + dy }));
  };
  const onMouseUp = () => { dragRef.current = null; };

  // ── Touch pan ───────────────────────────────────────────────────────────────
  const touchRef = useRef(null);
  const onTouchStart = (e) => {
    if (e.touches.length === 1) {
      touchRef.current = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, vx: vpRef.current.x, vy: vpRef.current.y };
    }
  };
  const onTouchMove = (e) => {
    if (!touchRef.current || e.touches.length !== 1) return;
    const { sx, sy, vx, vy } = touchRef.current;
    setVp(v => ({ ...v, x: vx + (e.touches[0].clientX - sx), y: vy + (e.touches[0].clientY - sy) }));
  };
  const onTouchEnd = () => { touchRef.current = null; };

  // ── Fit to screen ───────────────────────────────────────────────────────────
  const fitToScreen = () => {
    if (!containerRef.current || nodes.length === 0) return;
    const r = containerRef.current.getBoundingClientRect();
    const scale = Math.min(1, r.width / (totalW + 40), r.height / (totalH + 40)) * 0.9;
    setVp({ x: (r.width - totalW * scale) / 2, y: 40, scale });
  };

  const zoom = (dir) => {
    if (!containerRef.current) return;
    const r = containerRef.current.getBoundingClientRect();
    const mx = r.width / 2, my = r.height / 2;
    setVp(v => {
      const ns = Math.max(0.04, Math.min(3, v.scale * (dir > 0 ? 1.3 : 1 / 1.3)));
      return { scale: ns, x: mx - (mx - v.x) * (ns / v.scale), y: my - (my - v.y) * (ns / v.scale) };
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-yellow-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 64px)' }}>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 bg-slate-950 shrink-0 flex-wrap">
        <img src="/battalion-logo.png" alt="PBHS JROTC" className="w-5 h-5 object-contain shrink-0" />
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-200">Chain of Command</span>
        <span className="text-[10px] text-slate-500 font-bold">{entries.length} personnel</span>

        <div className="ml-auto relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="pl-7 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg outline-none focus:border-yellow-500 transition-colors w-44 text-white placeholder:text-slate-500"
          />
          {search && matchIds.size > 0 && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-yellow-400 font-black pointer-events-none">
              {matchIds.size}
            </span>
          )}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button onClick={() => zoom(1)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <ZoomIn size={12} />
          </button>
          <button onClick={() => zoom(-1)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <ZoomOut size={12} />
          </button>
          <button onClick={fitToScreen} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <Maximize2 size={12} />
          </button>
          <span className="text-[10px] text-slate-600 ml-1 select-none w-10 text-right tabular-nums">
            {Math.round(vp.scale * 100)}%
          </span>
        </div>

        <span className="text-[9px] text-slate-600 hidden sm:block">scroll to zoom · drag to pan</span>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-slate-950 select-none cursor-grab active:cursor-grabbing relative"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => setSelected(null)}
      >
        <svg
          width="100%"
          height="100%"
          style={{ display: 'block' }}
        >
          <g transform={`translate(${vp.x},${vp.y}) scale(${vp.scale})`}>

            {/* Edges */}
            {edges.map(({ from, to }) => {
              const fn = nodeMap[from], tn = nodeMap[to];
              if (!fn || !tn) return null;
              return (
                <path
                  key={`e-${from}-${to}`}
                  d={edgePath(fn, tn)}
                  stroke="#ffffff12"
                  strokeWidth={1.2}
                  fill="none"
                />
              );
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const c    = nodeStyle(node.entry);
              const hit  = matchIds.has(node.id);
              const name = node.entry?.fullName || '(Vacant)';
              const rank = node.entry?.rank     || '';
              const pos  = node.entry?.position || '';
              const nx   = node.x - NW / 2;
              const ny   = node.y - NH / 2;

              const isSelected = selected?.node?.id === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${nx},${ny})`}
                  style={{ cursor: node.entry ? 'pointer' : 'default' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (wasDragRef.current || !node.entry) return;
                    setSelected(isSelected ? null : { node, x: e.clientX, y: e.clientY });
                  }}
                >
                  {/* Background rect */}
                  <rect
                    width={NW} height={NH} rx={7} ry={7}
                    fill={c.bg}
                    stroke={isSelected ? '#38bdf8' : hit ? '#fbbf24' : c.border}
                    strokeWidth={isSelected || hit ? 2 : 1}
                  />
                  {/* Highlight overlays */}
                  {hit        && <rect width={NW} height={NH} rx={7} ry={7} fill="#fbbf2422" />}
                  {isSelected && <rect width={NW} height={NH} rx={7} ry={7} fill="#38bdf822" />}

                  {/* Name */}
                  <text
                    x={NW / 2} y={19}
                    textAnchor="middle"
                    fill={hit ? '#fbbf24' : c.label}
                    fontSize={9.5}
                    fontWeight="800"
                    fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
                    letterSpacing="0.01em"
                  >
                    {trunc(name, 16)}
                  </text>

                  {/* Rank */}
                  {rank && (
                    <text
                      x={NW / 2} y={31}
                      textAnchor="middle"
                      fill={c.sub}
                      fontSize={8}
                      fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
                      letterSpacing="0.04em"
                    >
                      {rank}
                    </text>
                  )}

                  {/* Position */}
                  <text
                    x={NW / 2} y={rank ? 43 : 36}
                    textAnchor="middle"
                    fill="#6b7280"
                    fontSize={7.5}
                    fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
                  >
                    {trunc(pos, 19)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Info popup card */}
        {selected && (() => {
          const e   = selected.node.entry;
          const sty = nodeStyle(e);
          const containerRect = containerRef.current?.getBoundingClientRect();
          const rawX = selected.x - (containerRect?.left ?? 0) + 12;
          const rawY = selected.y - (containerRect?.top  ?? 0) - 10;
          const popW = 220;
          const left = rawX + popW > (containerRect?.width ?? 9999) ? rawX - popW - 24 : rawX;
          const rows = [
            { label: 'Position',           value: e.position },
            { label: 'Rank',               value: e.rank },
            { label: 'Company',            value: e.company },
            { label: 'Platoon',            value: e.platoon },
            { label: 'Squad',              value: e.squad },
            { label: 'LET Level',          value: e.letLevel != null ? String(e.letLevel) : null },
            { label: 'Secondary Position', value: e.secondaryPosition },
          ].filter(r => r.value);
          return (
            <div
              onClick={ev => ev.stopPropagation()}
              style={{
                position: 'absolute',
                left,
                top: rawY,
                width: popW,
                background: '#0d1117',
                border: `1.5px solid ${sty.border}`,
                borderRadius: 10,
                boxShadow: '0 8px 32px #00000080',
                zIndex: 50,
                overflow: 'hidden',
              }}
            >
              {/* Header */}
              <div style={{ background: sty.bg, padding: '10px 12px 8px', borderBottom: `1px solid ${sty.border}40` }}>
                <div style={{ color: sty.label, fontSize: 12, fontWeight: 800, lineHeight: 1.2, letterSpacing: '0.01em' }}>
                  {e.fullName}
                </div>
                {e.rank && (
                  <div style={{ color: sty.sub, fontSize: 10, marginTop: 2 }}>{e.rank}</div>
                )}
              </div>
              {/* Body */}
              <div style={{ padding: '8px 12px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {rows.map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, paddingTop: 1 }}>{label}</span>
                    <span style={{ fontSize: 10, color: '#d1d5db', textAlign: 'right', lineHeight: 1.3 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Empty state */}
        {entries.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-600">
            <Shield size={32} />
            <p className="text-sm font-bold">No roster entries found.</p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-white/5 bg-slate-950 shrink-0 overflow-x-auto">
        {[
          { color: '#f59e0b', label: 'Battalion Cmd' },
          { color: '#86efac', label: 'Battalion Staff' },
          { color: '#93c5fd', label: 'Company Cmd' },
          { color: '#a5b4fc', label: 'Company Staff' },
          { color: '#86efac50', label: 'Platoon' },
          { color: '#6b7280',  label: 'Squad' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5 shrink-0">
            <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
            <span className="text-[9px] text-slate-500 font-medium">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
