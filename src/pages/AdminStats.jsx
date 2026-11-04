import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { useCompanies } from '../hooks/useCompanies';
import { isHQCompany } from '../utils/normalizeCompany';
import { Navigate, useNavigate } from 'react-router-dom';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import {
  BarChart3, Loader2, Users, ClipboardCheck, Shirt, Shield, Tent,
  TrendingUp, CheckCircle2, Clock, DollarSign, Flag, SlidersHorizontal,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';

const DEFAULT_FLAG_REQUIREMENT = 30;

const RANK_ORDER = ["C/PVT", "C/PFC", "C/CPL", "C/SGT", "C/SSG", "C/SFC", "C/MSG", "C/1SG", "C/SGM", "C/CSM", "C/2LT", "C/1LT", "C/CPT", "C/MAJ", "C/LTC", "C/COL"];
const LET_ORDER = ["LET 1", "LET 2", "LET 3", "LET 4"];

const groupCount = (items, keyFn) => {
  const counts = {};
  items.forEach(item => {
    const key = keyFn(item) || 'Unassigned';
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
};

// Single-series magnitude-by-category: one accent color, no legend needed
// (the section title already names the series) - see dataviz skill guidance.
const BarRow = ({ label, count, max, color = 'bg-yellow-500' }) => (
  <div className="flex items-center gap-3">
    <span className="w-28 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 truncate flex-shrink-0">{label}</span>
    <div className="flex-1 h-5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: max > 0 ? `${Math.max((count / max) * 100, count > 0 ? 4 : 0)}%` : '0%' }} />
    </div>
    <span className="w-8 text-right text-xs font-black text-slate-900 dark:text-white flex-shrink-0">{count}</span>
  </div>
);

const StatTile = ({ icon: Icon, label, value, sub }) => (
  <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-5">
    <div className="flex items-center gap-2 mb-2 text-yellow-600 dark:text-yellow-500">
      <Icon size={16} />
      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</span>
    </div>
    <p className="text-3xl font-black italic text-slate-900 dark:text-white leading-none">{value}</p>
    {sub && <p className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase mt-1">{sub}</p>}
  </div>
);

const SectionCard = ({ icon: Icon, title, children, action }) => (
  <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-[2rem] p-6 md:p-8">
    <div className="flex items-center gap-2 mb-6">
      <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest flex items-center gap-2 flex-1">
        <Icon size={16} /> {title}
      </h3>
      {action}
    </div>
    {children}
  </div>
);

const AdminStats = ({ hideHeader = false }) => {
  const { role, loading: authLoading } = useAuth();
  const { companies: FUNDRAISER_COMPANIES } = useCompanies();
  const navigate = useNavigate();
  const isAuthorized = (ROLE_HIERARCHY[role] || 0) >= STAFF_LEVEL;

  // roster = full battalion roster (source of truth for headcounts)
  // users  = portal accounts (subset — used for growth-over-time only)
  const [roster, setRoster] = useState([]);
  const [users, setUsers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [orders, setOrders] = useState([]);
  const [events, setEvents] = useState([]);
  const [uniformRequests, setUniformRequests] = useState([]);
  const [camps, setCamps] = useState([]);
  const [fundraiserEntries, setFundraiserEntries] = useState([]);
  const [positionReqs, setPositionReqs] = useState({});
  const [defaultReq, setDefaultReq] = useState(DEFAULT_FLAG_REQUIREMENT);
  const [fundraiserStart, setFundraiserStart] = useState('');
  const [fundraiserEnd, setFundraiserEnd] = useState('');
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!isAuthorized) return;
    const unsubs = [
      onSnapshot(collection(db, "roster"), snap => { setRoster(snap.docs.map(d => d.data())); setDataLoading(false); }),
      onSnapshot(collection(db, "users"),  snap => setUsers(snap.docs.map(d => d.data()))),
      onSnapshot(collection(db, "tasks"),  snap => setTasks(snap.docs.map(d => d.data()))),
      onSnapshot(collection(db, "orders"), snap => setOrders(snap.docs.map(d => d.data()))),
      onSnapshot(collection(db, "events"), snap => setEvents(snap.docs.map(d => d.data()))),
      onSnapshot(collection(db, "uniform_requests"), snap => setUniformRequests(snap.docs.map(d => d.data()))),
      onSnapshot(collection(db, "camps"),             snap => setCamps(snap.docs.map(d => d.data()))),
      onSnapshot(collection(db, "fundraiserEntries"), snap => setFundraiserEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(doc(db, "settings", "fundraiserGoal"), snap => {
        if (snap.exists()) {
          const d = snap.data();
          setPositionReqs(d.positionRequirements || {});
          setDefaultReq(d.defaultRequirement ?? DEFAULT_FLAG_REQUIREMENT);
          setFundraiserStart(d.startDate || '');
          setFundraiserEnd(d.endDate || '');
        }
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [isAuthorized]);

  if (authLoading || (dataLoading && isAuthorized)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-yellow-600">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  // --- ROSTER BREAKDOWN (uses full `roster` collection, not portal accounts) ---
  // "Zulu" is the legacy company name — it maps to "Battalion" site-wide.
  const normalizeCompany = (co) => (co === 'Zulu' ? 'Battalion' : (co || 'Unassigned'));

  // Defined company order: Alpha → Delta, then Battalion, then any extras.
  const COMPANY_ORDER = [...(FUNDRAISER_COMPANIES || []), 'Battalion'];

  const byCompanyRaw = groupCount(roster, u => normalizeCompany(u.company));
  // Build ordered company list: known order first, then any unlisted extras alphabetically.
  const companyKeys = [
    ...COMPANY_ORDER.filter(c => byCompanyRaw[c]),
    ...Object.keys(byCompanyRaw).filter(c => !COMPANY_ORDER.includes(c)).sort(),
  ];

  const byRank = groupCount(roster, u => u.rank);
  const byLet  = groupCount(roster, u => u.letLevel);
  const rankKeys = [...RANK_ORDER.filter(r => byRank[r]), ...Object.keys(byRank).filter(r => !RANK_ORDER.includes(r))];
  const letKeys  = [...LET_ORDER.filter(l => byLet[l]),  ...Object.keys(byLet).filter(l => !LET_ORDER.includes(l))];
  const maxCompany = Math.max(1, ...Object.values(byCompanyRaw));
  const maxRank    = Math.max(1, ...Object.values(byRank));
  const maxLet     = Math.max(1, ...Object.values(byLet));

  // Portal accounts (not full roster) — used for growth chart because
  // roster entries don't carry a createdAt timestamp the same way.
  const portalCount = users.length;

  // --- GROWTH OVER TIME (cumulative, by month of portal account creation) ---
  const monthBuckets = {};
  users.forEach(u => {
    const d = u.createdAt?.toDate ? u.createdAt.toDate() : null;
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthBuckets[key] = (monthBuckets[key] || 0) + 1;
  });
  const sortedMonths = Object.keys(monthBuckets).sort();
  const growthPoints = sortedMonths.reduce((points, key) => {
    const running = (points[points.length - 1]?.total || 0) + monthBuckets[key];
    const [y, m] = key.split('-');
    points.push({ key, label: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m) - 1]} '${y.slice(2)}`, total: running });
    return points;
  }, []);

  // --- TASK / ORDER ACTIVITY ---
  const tasksCompleted = tasks.filter(t => t.status === 'completed').length;
  const tasksPending = tasks.length - tasksCompleted;

  // --- UNIFORM LOGISTICS ---
  const uniformCompleted = uniformRequests.filter(r => r.status === 'Completed').length;
  const uniformPending = uniformRequests.length - uniformCompleted;
  const byItem = groupCount(uniformRequests, r => r.item);
  const maxItem = Math.max(1, ...Object.values(byItem));

  // --- CAMP ATTENDANCE ---
  const totalAttendanceRecords = camps.reduce((sum, c) => sum + (c.attendeeCount ?? c.attendees?.length ?? 0), 0);
  const mostRecentCamp = [...camps].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

  // --- FUNDRAISER ---
  const activeEntries = fundraiserEntries.filter(e => !e.voided);
  const fundraiserTotal = activeEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const fundraiserFlags = activeEntries.reduce((s, e) => s + Math.floor((Number(e.amount) || 0) / 2), 0);
  const fundraiserByCompany = Object.fromEntries(
    FUNDRAISER_COMPANIES.map(co => [
      co,
      activeEntries.filter(e => e.company === co).reduce((s, e) => s + (Number(e.amount) || 0), 0),
    ])
  );

  // Weeks from configured date range
  const numWeeks = (fundraiserStart && fundraiserEnd)
    ? Math.max(1, Math.ceil((new Date(fundraiserEnd) - new Date(fundraiserStart)) / (7 * 24 * 60 * 60 * 1000)))
    : 0;

  // Position-based company goals (same logic as AdminFundraiser.jsx)
  const companyTotalFlags = (co) => {
    const cadetsInCo = roster.filter(c => !c.graduated && (c.company === co || (co === 'Battalion' && isHQCompany(c.company))));
    return cadetsInCo.reduce((sum, c) => sum + (positionReqs[c.position] ?? defaultReq), 0);
  };
  const companyWeeklyGoal = (co) => {
    const total = companyTotalFlags(co);
    return numWeeks > 0 && total > 0 ? Math.ceil(total / numWeeks) : 0;
  };
  // Dollar equivalents ($2 = 1 flag)
  const companyWeeklyDollarGoal = (co) => companyWeeklyGoal(co) * 2;

  const fundraiserMaxVal = Math.max(
    ...FUNDRAISER_COMPANIES.map(co => Math.max(fundraiserByCompany[co] || 0, companyWeeklyDollarGoal(co))),
    1
  );

  return (
    <>
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      <div className="max-w-6xl mx-auto">

        {!hideHeader && <AdminPageHeader icon={BarChart3} title="Battalion Stats" />}

        {/* HEADLINE TILES */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatTile icon={Users} label="Total Roster" value={roster.length} sub={`${portalCount} portal accounts`} />
          <StatTile icon={ClipboardCheck} label="Tasks Completed" value={`${tasksCompleted}/${tasks.length}`} />
          <StatTile icon={Shirt} label="Uniform Pending" value={uniformPending} />
          <StatTile icon={Tent} label="Camps Logged" value={camps.length} sub={`${totalAttendanceRecords} attendance records`} />
        </div>

        <div className="grid md:grid-cols-2 gap-6">

          {/* ROSTER BY COMPANY */}
          <SectionCard icon={Users} title="Roster by Company">
            <div className="space-y-3">
              {companyKeys.map(key => (
                <BarRow key={key} label={key} count={byCompanyRaw[key]} max={maxCompany} />
              ))}
            </div>
          </SectionCard>

          {/* ROSTER BY LET LEVEL */}
          <SectionCard icon={Shield} title="Roster by LET Level">
            <div className="space-y-3">
              {letKeys.map(key => (
                <BarRow key={key} label={key} count={byLet[key]} max={maxLet} />
              ))}
            </div>
          </SectionCard>

          {/* ROSTER BY RANK */}
          <SectionCard icon={Shield} title="Roster by Rank">
            <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
              {rankKeys.map(key => (
                <BarRow key={key} label={key} count={byRank[key]} max={maxRank} />
              ))}
            </div>
          </SectionCard>

          {/* GROWTH OVER TIME */}
          <SectionCard icon={TrendingUp} title="Battalion Growth Over Time">
            {growthPoints.length > 1 ? (
              <>
                <svg viewBox="0 0 300 100" className="w-full h-32" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#eab308" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#eab308" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {(() => {
                    const maxTotal = Math.max(...growthPoints.map(p => p.total));
                    const stepX = 300 / (growthPoints.length - 1);
                    const coords = growthPoints.map((p, i) => [i * stepX, 96 - (p.total / maxTotal) * 90]);
                    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0]} ${c[1]}`).join(' ');
                    const areaPath = `${linePath} L ${coords[coords.length - 1][0]} 100 L 0 100 Z`;
                    return (
                      <>
                        <path d={areaPath} fill="url(#growthFill)" />
                        <path d={linePath} fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </>
                    );
                  })()}
                </svg>
                <div className="flex justify-between text-[9px] font-black uppercase text-slate-400 dark:text-slate-600 mt-2">
                  <span>{growthPoints[0].label}</span>
                  <span>{growthPoints[growthPoints.length - 1].label} &middot; {growthPoints[growthPoints.length - 1].total} total</span>
                </div>
                <p className="text-[9px] text-slate-400 dark:text-slate-600 italic mt-3">
                  Reflects when portal accounts were created — not the full battalion roster or the battalion's founding.
                </p>
              </>
            ) : (
              <p className="text-slate-400 dark:text-slate-600 text-xs italic py-8 text-center">Not enough data yet to chart growth.</p>
            )}
          </SectionCard>

          {/* TASK & ORDER ACTIVITY */}
          <SectionCard icon={ClipboardCheck} title="Task & Order Activity">
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
                <CheckCircle2 size={20} className="text-green-600 dark:text-green-500" />
                <div>
                  <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{tasksCompleted}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Tasks Completed</p>
                </div>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3">
                <Clock size={20} className="text-yellow-600 dark:text-yellow-500" />
                <div>
                  <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{tasksPending}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Tasks Pending</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-white/5 pt-4">
              <span>{orders.length} Orders Issued</span>
              <span>{events.length} Events Scheduled</span>
            </div>
          </SectionCard>

          {/* UNIFORM LOGISTICS */}
          <SectionCard icon={Shirt} title="Uniform Logistics">
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
                <CheckCircle2 size={20} className="text-green-600 dark:text-green-500" />
                <div>
                  <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{uniformCompleted}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Issued</p>
                </div>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3">
                <Clock size={20} className="text-yellow-600 dark:text-yellow-500" />
                <div>
                  <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{uniformPending}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Pending</p>
                </div>
              </div>
            </div>
            {Object.keys(byItem).length > 0 && (
              <div className="space-y-3 border-t border-slate-100 dark:border-white/5 pt-4">
                {Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, count]) => (
                  <BarRow key={key} label={key} count={count} max={maxItem} color="bg-blue-500" />
                ))}
              </div>
            )}
          </SectionCard>

          {/* CAMP ATTENDANCE */}
          <SectionCard icon={Tent} title="Camp Attendance">
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-white/5 rounded-xl p-4">
                <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{camps.length}</p>
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Camps Logged</p>
              </div>
              <div className="bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-white/5 rounded-xl p-4">
                <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{totalAttendanceRecords}</p>
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Attendance Records</p>
              </div>
            </div>
            {mostRecentCamp ? (
              <div className="border-t border-slate-100 dark:border-white/5 pt-4">
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mb-1">Most Recent</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{mostRecentCamp.name} &middot; {mostRecentCamp.date}</p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold mt-1">{mostRecentCamp.attendeeCount ?? mostRecentCamp.attendees?.length ?? 0} attendees</p>
              </div>
            ) : (
              <p className="text-slate-400 dark:text-slate-600 text-xs italic">No camps logged yet.</p>
            )}
          </SectionCard>

          {/* FUNDRAISER PERFORMANCE */}
          <SectionCard
            icon={DollarSign}
            title="Fallen Heroes Fundraiser"
            action={
              <button
                onClick={() => navigate('/admin/fundraiser')}
                className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors ml-auto"
              >
                <SlidersHorizontal size={11} /> Manage
              </button>
            }
          >
            {/* Summary tiles */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <p className="text-xl font-black text-slate-900 dark:text-white leading-none">
                  ${fundraiserTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Total Raised</p>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center gap-3">
                <Flag size={18} className="text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
                <div>
                  <p className="text-xl font-black text-slate-900 dark:text-white leading-none">{fundraiserFlags.toLocaleString()}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mt-1">Total Flags</p>
                </div>
              </div>
            </div>

            {/* Timeline info */}
            {fundraiserStart && fundraiserEnd ? (
              <div className="flex items-center gap-3 bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-white/5 rounded-xl px-4 py-3 mb-4">
                <div className="flex-1">
                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500">Fundraiser Period</p>
                  <p className="text-[10px] font-bold text-slate-900 dark:text-white mt-0.5">
                    {new Date(fundraiserStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' → '}
                    {new Date(fundraiserEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-yellow-600 dark:text-yellow-500 leading-none">{numWeeks}</p>
                  <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500">Weeks</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-xl px-4 py-3 mb-4">
                <SlidersHorizontal size={12} className="text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
                <p className="text-[9px] font-black uppercase text-yellow-600 dark:text-yellow-500">
                  Set dates &amp; per-cadet goal to enable weekly targets
                </p>
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 mb-4">
              <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-slate-500">
                <div className="w-3 h-3 rounded-sm bg-emerald-500" /> Raised
              </div>
              {numWeeks > 0 && (
                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-slate-500">
                  <div className="w-3 h-3 rounded-sm border-2 border-yellow-500" /> Weekly Target
                </div>
              )}
            </div>

            {/* Per-company bars */}
            <div className="space-y-4">
              {FUNDRAISER_COMPANIES.map(co => {
                const actual  = fundraiserByCompany[co] || 0;
                const wDollar = companyWeeklyDollarGoal(co);
                const wFlags  = companyWeeklyGoal(co);
                const pct     = (actual / fundraiserMaxVal) * 100;
                const gPct    = wDollar > 0 ? (wDollar / fundraiserMaxVal) * 100 : 0;
                const ahead   = wDollar > 0 ? actual >= wDollar : false;
                return (
                  <div key={co}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">{co}</span>
                      <div className="flex items-center gap-2">
                        {wFlags > 0 && (
                          <span className="text-[9px] font-black text-slate-400 dark:text-slate-600">
                            {wFlags} flags/wk · ${wDollar.toLocaleString()}
                          </span>
                        )}
                        <span className={`text-[10px] font-black ${ahead ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
                          ${actual.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{ahead && ' ✓'}
                        </span>
                      </div>
                    </div>
                    <div className="relative h-4 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                      {gPct > 0 && (
                        <div
                          className="absolute inset-y-0 border-r-2 border-yellow-500"
                          style={{ left: `${Math.min(gPct, 100)}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>

    </>
  );
};

export default AdminStats;
