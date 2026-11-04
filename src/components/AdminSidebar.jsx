// src/components/AdminSidebar.jsx

import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { db, auth } from '../firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import {
  LayoutDashboard,
  UserCircle,
  LogOut,
  Lock,
  Power,
  Megaphone,
  Home,
  Heart,
  Tag,
  Users2,
  Briefcase,
  Globe,
  X,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Award,
  ClipboardList,
  GraduationCap,
  Trophy,
  ClipboardCheck,
  Shield,
} from 'lucide-react';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import { clearDeviceTrust, isDeviceTrusted } from '../hooks/useIdleLogout';
import { getInitials } from '../utils/getInitials';
import ScrambleText from './ScrambleText';

const AdminSidebar = ({
  open = false,
  onClose = () => {},
  collapsed = false,
  onToggleCollapse = () => {},
}) => {
  const { userData, role, loading } = useAuth();
  const location = useLocation();
  const [requestCount, setRequestCount] = useState(0);
  const [supplyCount,  setSupplyCount]  = useState(0);
  const [isOnTeam, setIsOnTeam] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'uniform_requests'), (snapshot) => {
      const pending = snapshot.docs.filter(d => d.data().status === 'Pending').length;
      setRequestCount(pending);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const currentLevel = ROLE_HIERARCHY[role] || 0;
    if (currentLevel < ADMIN_LEVEL) return;
    const q = query(collection(db, 'supplyRequests'), where('status', '==', 'Pending'));
    const unsub = onSnapshot(q, snap => setSupplyCount(snap.size), () => {});
    return () => unsub();
  }, [role]);

  useEffect(() => {
    const email = userData?.email || auth.currentUser?.email;
    if (role !== 'sergeant_major' || !email) { setIsOnTeam(false); return; }
    const q = query(
      collection(db, 'specialTeams'),
      where('commanderEmails', 'array-contains', email)
    );
    const unsub = onSnapshot(q, snap => setIsOnTeam(!snap.empty));
    return () => unsub();
  }, [role, userData?.email]);

  const uid = userData?.uid || auth.currentUser?.uid;
  const deviceTrusted = isDeviceTrusted(uid);

  const handleLogout = () => {
    if (deviceTrusted) {
      sessionStorage.setItem('sessionLocked', '1');
      window.dispatchEvent(new CustomEvent('idle-session-lock'));
    } else {
      clearDeviceTrust();
      signOut(auth);
    }
  };

  const handleFullLogout = () => {
    clearDeviceTrust();
    signOut(auth);
  };

  const userLevel = ROLE_HIERARCHY[role] || 0;
  const isCommander    = userLevel >= COMMAND_LEVEL;
  const isTopFour      = userLevel >= ADMIN_LEVEL;
  const isStaffOrS4    = userLevel >= STAFF_LEVEL;
  const isS1S3Assistant = role === 'company_s1_assistant' || role === 'company_s3_assistant';
  const isRestrictedCmd = role === 'sergeant_major' || role === 'battalion_commander' || role === 'battalion_csm';

  const UNIFORM_ROLES = ['company_s4_assistant', 'company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant', 's4_logistics'];
  const canSeeUniforms = UNIFORM_ROLES.includes(role) || userLevel >= ADMIN_LEVEL;

  const CHALLENGE_ROLES = ['company_s1_assistant', 'company_s3_assistant'];

  const FUNDRAISER_FULL_ROLES = [
    's1_adjutant', 's3_operations',
    'battalion_xo', 'battalion_csm', 'battalion_commander',
    'company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant',
  ];
  const hasFullFundraiserAccess = FUNDRAISER_FULL_ROLES.includes(role) || userLevel >= STAFF_LEVEL;

  const S1_TRACKER_ROLES = [
    's1_adjutant', 's3_operations', 'battalion_xo',
    'company_s1_assistant', 'company_xo', 'company_1sg', 'company_commander',
    'company_master_sergeant', 'company_s3_assistant',
  ];
  const canSeeS1 = S1_TRACKER_ROLES.includes(role) || userLevel >= ADMIN_LEVEL;
  const canSeeS2 = role === 's2_intelligence' || role === 'company_s2_assistant' || userLevel >= ADMIN_LEVEL;
  const canSeeS4 = canSeeUniforms;
  const canSeeS5 = role === 's5_public_affairs' || role === 'company_s5_assistant' || (isTopFour && !isRestrictedCmd);
  const canSeeS6 = role === 's6_technology' || role === 'company_s6_assistant' || role === 's5_public_affairs' || userLevel >= ADMIN_LEVEL;

  const isActive = (path) => location.pathname === path;

  // ── Nav item helper ───────────────────────────────────────────────────────────
  // Accepts an Icon component (not element) so size can be conditional.
  const navLink = (to, Icon, label, badge = null) => (
    <Link
      to={to}
      onClick={onClose}
      className={`relative group flex items-center ${
        collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2'
      } rounded-lg font-semibold text-sm transition-colors ${
        isActive(to)
          ? 'bg-yellow-500 text-slate-950'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
      }`}
    >
      <Icon size={collapsed ? 20 : 16} className="shrink-0 opacity-70" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge}
      {/* Hover tooltip — only in collapsed (icon-only) mode */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-800 text-white text-xs font-bold rounded-lg whitespace-nowrap z-[200] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 shadow-lg">
          {label}
          {badge && <span className="ml-1.5">{badge}</span>}
        </span>
      )}
    </Link>
  );

  const pendingBadge = (count) => count > 0 ? (
    <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black shrink-0">{count}</span>
  ) : null;

  // ── Collapsed action button (logout etc.) ─────────────────────────────────────
  const actionBtn = (onClick, Icon, label, colorClass) => (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`w-full flex items-center justify-center p-2.5 rounded-lg transition-colors ${colorClass}`}
      >
        <Icon size={20} />
      </button>
      <span className="pointer-events-none absolute left-full ml-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-800 text-white text-xs font-bold rounded-lg whitespace-nowrap z-[200] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 shadow-lg">
        {label}
      </span>
    </div>
  );

  return (
    <aside
      className={`
        ${collapsed ? 'w-60 lg:w-[60px]' : 'w-60'}
        bg-white dark:bg-slate-950 border-r border-slate-100 dark:border-white/5
        ${collapsed ? 'lg:px-2' : 'px-3'} py-5 flex flex-col fixed h-full z-30
        transition-all duration-300 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}
    >
      {/* ── Header: branding + close/collapse toggle ─────────────────────────── */}
      <div className={`mb-4 px-1 flex items-start ${collapsed ? 'lg:justify-center' : 'justify-between'}`}>
        {/* Branding — hidden in collapsed desktop mode */}
        <div className={collapsed ? 'lg:hidden' : ''}>
          <h2 className="text-base font-black uppercase italic tracking-tighter text-yellow-500 leading-tight">
            <ScrambleText text="Battalion" trigger="hover" speed={25} />
          </h2>
          <p className="text-[9px] text-slate-400 dark:text-slate-600 uppercase font-bold tracking-[0.2em] mt-0.5">Admin Portal</p>
        </div>
        {/* Mobile: X close button */}
        <button
          onClick={onClose}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
        >
          <X size={16} />
        </button>
        {/* Desktop: collapse/expand chevron */}
        <button
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* ── Profile quick link ────────────────────────────────────────────────── */}
      {collapsed ? (
        /* Icon-only avatar in collapsed mode */
        <div className="hidden lg:flex justify-center mb-3">
          <Link
            to="/admin/profile"
            onClick={onClose}
            title="My Profile"
            className="w-9 h-9 rounded-full bg-yellow-500 text-slate-950 flex items-center justify-center text-xs font-black uppercase shrink-0 overflow-hidden hover:ring-2 hover:ring-yellow-400 transition-all"
          >
            {userData?.portrait ? (
              <img src={userData.portrait} alt="" className="w-full h-full object-cover" />
            ) : (
              getInitials(userData?.fullName) || <UserCircle size={16} />
            )}
          </Link>
        </div>
      ) : null}
      {/* Full profile card — always visible on mobile, visible on desktop only when expanded */}
      <Link
        to="/admin/profile"
        onClick={onClose}
        className={`${collapsed ? 'lg:hidden' : ''} flex items-center gap-2.5 mb-4 px-1 py-2 rounded-xl border border-slate-100 dark:border-white/5 hover:border-slate-200 dark:hover:border-white/10 transition-colors group`}
      >
        <div className="w-8 h-8 rounded-full bg-yellow-500 text-slate-950 flex items-center justify-center text-xs font-black uppercase shrink-0 overflow-hidden">
          {userData?.portrait ? (
            <img src={userData.portrait} alt="" className="w-full h-full object-cover" />
          ) : (
            getInitials(userData?.fullName) || <UserCircle size={16} />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase text-slate-400 dark:text-slate-500 leading-none mb-0.5">My Profile</p>
          <p className="text-xs font-bold text-slate-900 dark:text-white truncate uppercase tracking-tight">
            {userData?.fullName || 'Cadet'}
          </p>
        </div>
      </Link>

      {/* ── Navigation ───────────────────────────────────────────────────────── */}
      <nav className={`flex-1 ${collapsed ? 'lg:overflow-visible space-y-0.5' : 'overflow-y-auto -mx-1 px-1'}`}>
        {/* Back to home */}
        <Link
          to="/"
          onClick={onClose}
          className={`relative group flex items-center ${
            collapsed ? 'lg:justify-center lg:p-2.5' : 'gap-2.5 px-3 py-2'
          } rounded-lg font-semibold text-sm text-slate-500 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 transition-colors mb-1`}
        >
          <Home size={collapsed ? 20 : 16} className="opacity-60 shrink-0" />
          <span className={collapsed ? 'lg:hidden' : ''}>Back to Home</span>
          {collapsed && (
            <span className="hidden lg:block pointer-events-none absolute left-full ml-3 px-3 py-1.5 bg-slate-900 dark:bg-slate-800 text-white text-xs font-bold rounded-lg whitespace-nowrap z-[200] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 shadow-lg">
              Back to Home
            </span>
          )}
        </Link>

        {navLink('/admin/dashboard', LayoutDashboard, 'Dashboard')}
        {navLink('/admin/my', Award, 'My Record')}

        {loading ? (
          <div className="space-y-1.5 mt-3 px-1">
            <div className="h-8 bg-slate-100 dark:bg-white/5 animate-pulse rounded-lg" />
            <div className="h-8 bg-slate-100 dark:bg-white/5 animate-pulse rounded-lg" />
          </div>
        ) : isCommander && (
          <div className={`${collapsed ? '' : 'space-y-0.5'} mt-1`}>
            {navLink('/admin/personnel', Users2, 'Personnel Hub')}
            {(canSeeS1 || canSeeS2 || canSeeS4 || canSeeS5 || canSeeS6) && navLink('/admin/staff', Briefcase, 'Staff Shops')}
            {navLink('/admin/leadership-calendar', CalendarDays, 'Leadership Cal')}
{hasFullFundraiserAccess && navLink('/admin/fundraiser', Heart, 'Fundraiser')}
            {(role === 's5_public_affairs' || role === 's6_technology' || (isTopFour && !isRestrictedCmd) || isStaffOrS4) && navLink('/admin/publishing', Globe, 'Publishing Hub')}
            {userLevel < STAFF_LEVEL && userData?.company && navLink('/admin/announcements', Megaphone, 'Announcements')}
            {(role === 's5_public_affairs' || role === 's6_technology' || isTopFour) && navLink('/admin/announcements', Megaphone, 'Global Broadcast')}
          </div>
        )}

        {/* ── S1 / S3 ASSISTANT ──────────────────────────────── */}
        {isS1S3Assistant && (
          <div className={`${collapsed ? '' : 'space-y-0.5'} mt-1`}>
            {navLink('/admin/personnel', Users2, 'Personnel Hub')}
            {navLink('/admin/staff', Briefcase, 'Staff Shops')}
          </div>
        )}
        {(canSeeS1 || canSeeS2 || canSeeS4 || canSeeS5 || canSeeS6) && !isCommander && !isS1S3Assistant && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5 space-y-0.5">
            {navLink('/admin/staff', Briefcase, 'Staff Shops')}
          </div>
        )}

        {/* ── MY TOOLS ───────────────────────────────────────── */}
        <div className={`mt-3 pt-3 border-t border-slate-100 dark:border-white/5 ${collapsed ? '' : 'space-y-0.5'}`}>
          {navLink('/admin/service-hours', Award, 'Service Hours')}
          {navLink('/admin/scholarships', GraduationCap, 'Scholarships')}
          {navLink('/admin/achievements', Trophy, 'Achievement Wall')}
          {isCommander && navLink('/admin/attendance', ClipboardList, 'Attendance')}
          {isStaffOrS4 && navLink('/admin/afi-prep', ClipboardCheck, 'AFI Prep')}
          {isCommander && navLink('/admin/teams-private', Shield, 'Teams (Internal)')}
        </div>

        {/* ── PORTAL ─────────────────────────────────────────── */}
        <div className={`mt-3 pt-3 border-t border-slate-100 dark:border-white/5 ${collapsed ? '' : 'space-y-0.5'}`}>
          {navLink('/admin/changelog', Tag, 'Version History')}
        </div>
      </nav>

      {/* ── Logout area ──────────────────────────────────────────────────────── */}
      <div className={`mt-3 pt-3 border-t border-slate-100 dark:border-white/5 ${collapsed ? 'lg:space-y-1' : 'space-y-1'}`}>
        {deviceTrusted ? (
          <>
            {collapsed ? (
              /* Collapsed: icon-only buttons with tooltips */
              <div className="hidden lg:block space-y-1">
                {actionBtn(
                  handleLogout,
                  Lock,
                  'Lock Session',
                  'text-yellow-600 dark:text-yellow-500 hover:bg-yellow-500/10'
                )}
                {actionBtn(
                  handleFullLogout,
                  Power,
                  'Sign Out Completely',
                  'text-red-500 dark:text-red-400 hover:bg-red-500/10'
                )}
              </div>
            ) : null}
            {/* Expanded buttons — always shown on mobile, shown on desktop only when expanded */}
            <div className={collapsed ? 'lg:hidden' : ''}>
              <div className="group">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-yellow-600 dark:text-yellow-500 hover:bg-yellow-500/10 rounded-lg font-semibold text-sm transition-colors"
                >
                  <Lock size={16} className="shrink-0" />
                  Lock Session
                </button>
                <p className="max-h-0 overflow-hidden group-hover:max-h-8 transition-all duration-200 text-[9px] font-bold text-yellow-600/60 dark:text-yellow-500/50 px-4 uppercase tracking-widest leading-tight">
                  Pauses — password to resume
                </p>
              </div>
              <div className="group">
                <button
                  onClick={handleFullLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-red-500 dark:text-red-400 hover:bg-red-500/10 rounded-lg font-semibold text-sm transition-colors"
                >
                  <Power size={16} className="shrink-0" />
                  Sign Out Completely
                </button>
                <p className="max-h-0 overflow-hidden group-hover:max-h-8 transition-all duration-200 text-[9px] font-bold text-red-500/60 dark:text-red-400/50 px-4 uppercase tracking-widest leading-tight">
                  Ends session on this device
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            {collapsed ? (
              <div className="hidden lg:block">
                {actionBtn(
                  handleLogout,
                  LogOut,
                  'Log Out',
                  'text-red-500 hover:bg-red-500/10'
                )}
              </div>
            ) : null}
            <button
              onClick={handleLogout}
              className={`${collapsed ? 'lg:hidden' : ''} w-full flex items-center gap-2.5 px-3 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg font-semibold text-sm transition-colors`}
            >
              <LogOut size={16} className="shrink-0" />
              Log Out
            </button>
          </>
        )}
      </div>
    </aside>
  );
};

export default AdminSidebar;
