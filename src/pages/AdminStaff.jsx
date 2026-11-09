// src/pages/AdminStaff.jsx
//
// Staff Shops — S1, S2, S3, S4, S5, S6 tabs.
// S1 has sub-tabs: Tracker · Meeting Logs
// S3 tab: AAR Logs
// S6 has sub-tabs: Checklist · Activity Log · Feedback Hub
// Deep-link with ?tab=s1 | s2 | s3 | s4 | s5 | s6

import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import {
  ClipboardList, Shield, Sparkles, Laptop, Users2, Package,
  Ruler, ShoppingCart, Shirt, NotepadText, ClipboardCheck,
  ScrollText, MessageSquare, Swords, Trophy, BarChart3, CalendarDays,
  Tent, ListChecks, Bell, Lock, Star, Clock,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import AdminS1 from './AdminS1';
import AdminAwardsRegistry from './AdminAwardsRegistry';
import AdminS2 from './AdminS2';
import AdminS5 from './AdminS5';
import AdminS6 from './AdminS6';
import AdminUniformSizes from './AdminUniformSizes';
import AdminSupplyRequests from './AdminSupplyRequests';
import AdminMeetingLogs from './AdminMeetingLogs';
import AdminCamps from './AdminCamps';
import AdminParticipation from './AdminParticipation';
import AdminAARLogs from './AdminAARLogs';
import AdminEvents from './AdminEvents';
import AdminLog from './AdminLog';
import AdminFeedback from './AdminFeedback';
import AdminStats from './AdminStats';
import AdminHonorCompany from './AdminHonorCompany';
import AdminLoginNotification from './AdminLoginNotification';
import AdminServiceHours from './AdminServiceHours';
import AdminAttendance from './AdminAttendance';
import AdminAFIPrep from './AdminAFIPrep';

const AdminStaff = () => {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const userLevel = ROLE_HIERARCHY[role] || 0;
  const isBattalionStaff = userLevel >= STAFF_LEVEL;

  // ── Tab visibility ────────────────────────────────────────────────────────────
  const canSeeS1 = userLevel >= 5;
  const canSeeS2 = ['company_s2_assistant', 'company_master_sergeant', 'company_1sg'].includes(role) || userLevel >= 50;
  const canSeeS3 = userLevel >= 20;
  const canSeeS4 = userLevel >= 12;
  const canSeeS5 = ['company_s5_assistant', 'company_1sg'].includes(role) || userLevel >= 50;
  const canSeeS6 = ['company_s6_assistant', 'company_1sg'].includes(role) || userLevel >= 50;

  // ── S1 sub-tab visibility ─────────────────────────────────────────────────────
  const canSeeFormTracker    = ['company_s7_assistant', 'company_s4_assistant', 'company_s2_assistant', 'company_s1_assistant'].includes(role) || userLevel >= 45;
  const canSeePromotionBoard = ['company_1sg', 'company_xo', 'company_commander', 's7_special_projects', 's2_intelligence', 's1_adjutant', 'sergeant_major'].includes(role) || userLevel >= 85;
  const canSeeMeetingLogs    = userLevel >= 5;
  const canSeeCamps          = isBattalionStaff;
  const canSeeParticipation  = isBattalionStaff;
  const canSeeAwardsRegistry   = userLevel >= 45;
  const canSeeServiceHours     = userLevel >= 5;
  const canSeeAttendance       = userLevel >= 45;
  const canSeeAFIPrep          = userLevel >= 45;

  // ── S3 sub-tab visibility ─────────────────────────────────────────────────────
  const canSeeAAR                  = userLevel >= 20;
  const canSeeCalendarEvents       = isBattalionStaff;
  const canSeeHonorCompanyTab      = isBattalionStaff;

  // ── S4 sub-tab visibility ─────────────────────────────────────────────────────
  const canSeeUniformSizes    = ['company_s4_assistant', 'company_s3_assistant', 'company_s1_assistant'].includes(role) || userLevel >= 45;
  const canSeeSupplyRequests  = userLevel >= 12;
  const canSeeUniformItems    = role === 'company_s4_assistant' || userLevel >= 45;

  // ── S6 sub-tab visibility ─────────────────────────────────────────────────────
  const canSeeChecklist          = ['company_s6_assistant', 'company_1sg'].includes(role) || userLevel >= 50;
  const canSeeBattalionStats     = isBattalionStaff;
  const canSeeLoginNotification  = ['s6_technology', 's5_public_affairs', 's3_operations', 's1_adjutant'].includes(role) || userLevel >= 85;
  const canSeeActivityLog        = isBattalionStaff;
  const canSeeFeedbackHub        = ['s6_technology', 's5_public_affairs', 's4_logistics', 's2_intelligence'].includes(role) || userLevel >= 85;

  const tabs = [
    { key: 's1', label: 'S1 Shop',  icon: ClipboardList,  show: canSeeS1 },
    { key: 's2', label: 'S2 Shop',  icon: Shield,         show: canSeeS2 },
    { key: 's3', label: 'S3 Shop',  icon: Swords,         show: canSeeS3, tag: 'SGM' },
    { key: 's4', label: 'S4 Shop',  icon: Package,        show: canSeeS4 },
    { key: 's5', label: 'S5 Shop',  icon: Sparkles,       show: canSeeS5 },
    { key: 's6', label: 'S6 Shop',  icon: Laptop,         show: canSeeS6 },
  ].filter(t => t.show);

  const defaultTab = tabs[0]?.key || 's1';
  const paramTab   = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    tabs.find(t => t.key === paramTab) ? paramTab : defaultTab
  );

  const switchTab = (key) => {
    setActiveTab(key);
    setSearchParams({ tab: key }, { replace: true });
  };

  useEffect(() => {
    if (paramTab && tabs.find(t => t.key === paramTab)) {
      setActiveTab(paramTab);
    }
  }, [paramTab]); // eslint-disable-line

  const tabLabels = tabs.map(t => t.label).join(' · ');

  // ── S1 sub-tabs ──────────────────────────────────────────────────────────────
  const s1SubTabs = [
    { key: 'form-tracker',     label: 'Form Tracker',        icon: ClipboardList, show: canSeeFormTracker },
    { key: 'promotion-board',  label: 'Promotion Board',     icon: Trophy,        show: canSeePromotionBoard },
    { key: 'meeting-logs',     label: 'Meeting Logs',        icon: NotepadText,   show: canSeeMeetingLogs },
    { key: 'camps',            label: 'Camp Attendance',     icon: Tent,          show: canSeeCamps },
    { key: 'participation',    label: 'Participation',       icon: ListChecks,    show: canSeeParticipation },
    { key: 'awards-registry',  label: 'Awards Registry',     icon: Star,           show: canSeeAwardsRegistry },
    { key: 'service-hours',    label: 'Service Hours',       icon: Clock,          show: canSeeServiceHours },
    { key: 'attendance',       label: 'Attendance',          icon: ClipboardList,  show: canSeeAttendance },
    { key: 'afi-prep',         label: 'AFI Prep',            icon: ClipboardCheck, show: canSeeAFIPrep },
  ].filter(t => t.show);
  const [s1SubTab, setS1SubTab] = useState(s1SubTabs[0]?.key || '');

  // ── S3 sub-tabs ──────────────────────────────────────────────────────────────
  const s3SubTabs = [
    { key: 'aar-logs',      label: 'AAR Logs',        icon: ClipboardCheck, show: canSeeAAR },
    { key: 'events',        label: 'Calendar Events', icon: CalendarDays,   show: canSeeCalendarEvents },
    { key: 'honor-company', label: 'Honor Company',   icon: Trophy,         show: canSeeHonorCompanyTab },
  ].filter(t => t.show);
  const [s3SubTab, setS3SubTab] = useState(s3SubTabs[0]?.key || '');
  const s3ActiveTab = s3SubTab || s3SubTabs[0]?.key || '';

  // ── S4 sub-tabs ──────────────────────────────────────────────────────────────
  const s4SubTabs = [
    { key: 'uniform-sizes',   label: 'Uniform Sizes',   icon: Ruler,        show: canSeeUniformSizes },
    { key: 'supply-requests', label: 'Supply Requests', icon: ShoppingCart, show: canSeeSupplyRequests },
    { key: 'uniform-items',   label: 'Uniform Items',   icon: Shirt,        show: canSeeUniformItems },
  ].filter(t => t.show);
  const [s4SubTab, setS4SubTab] = useState(s4SubTabs[0]?.key || '');

  // ── S6 sub-tabs ──────────────────────────────────────────────────────────────
  const s6SubTabs = [
    { key: 's6-checklist',        label: 'S6 Checklist',       icon: Laptop,        show: canSeeChecklist },
    { key: 'battalion-stats',     label: 'Battalion Stats',    icon: BarChart3,     show: canSeeBattalionStats },
    { key: 'login-notification',  label: 'Login Notification', icon: Bell,          show: canSeeLoginNotification },
    { key: 'activity-log',        label: 'Activity Log',       icon: ScrollText,    show: canSeeActivityLog },
    { key: 'feedback',            label: 'Feedback Hub',       icon: MessageSquare, show: canSeeFeedbackHub },
  ].filter(t => t.show);
  const [s6SubTab, setS6SubTab] = useState(s6SubTabs[0]?.key || '');

  const subTabClass = (active) =>
    `flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
      active
        ? 'bg-slate-800 dark:bg-white/10 text-white shadow-sm'
        : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
    }`;

  return (
    <div className="flex-1 p-6 md:p-10 w-full">
      <AdminPageHeader icon={Users2} title="Staff Shops" meta={tabLabels} />

      {/* Tab bar */}
      {tabs.length > 1 && (
        <div className="flex gap-2 mb-8 flex-wrap -mt-4">
          {tabs.map(({ key, label, icon: Icon, tag }) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === key
                  ? 'bg-yellow-500 text-slate-950 shadow-md shadow-yellow-500/20'
                  : 'bg-white dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-white/5 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <Icon size={13} />
              {label}
              {tag && (
                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md tracking-widest ${
                  activeTab === key
                    ? 'bg-slate-950/20 text-slate-950'
                    : 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-500'
                }`}>
                  {tag}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── S1: Tracker + Meeting Logs ── */}
      {activeTab === 's1' && canSeeS1 && (
        <div>
          {s1SubTabs.length > 1 && (
            <div className="flex gap-2 mb-6 flex-wrap">
              {s1SubTabs.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setS1SubTab(key)} className={subTabClass(s1SubTab === key)}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          )}
          {s1SubTab === 'form-tracker'    && canSeeFormTracker && <AdminS1 hideHeader forceTab="forms" />}
          {s1SubTab === 'promotion-board' && canSeePromotionBoard && <AdminS1 hideHeader forceTab="board" />}
          {s1SubTab === 'meeting-logs'    && canSeeMeetingLogs && <AdminMeetingLogs hideHeader />}
          {s1SubTab === 'camps'           && canSeeCamps && <AdminCamps hideHeader />}
          {s1SubTab === 'participation'   && canSeeParticipation && <AdminParticipation hideHeader />}
          {s1SubTab === 'awards-registry' && canSeeAwardsRegistry && <AdminAwardsRegistry hideHeader />}
          {s1SubTab === 'service-hours'   && canSeeServiceHours && <AdminServiceHours hideHeader />}
          {s1SubTab === 'attendance'      && canSeeAttendance && <AdminAttendance hideHeader />}
          {s1SubTab === 'afi-prep'        && canSeeAFIPrep && <AdminAFIPrep hideHeader />}
        </div>
      )}

      {/* ── S2 ── */}
      {activeTab === 's2' && canSeeS2 && <AdminS2 hideHeader />}

      {/* ── S3: AAR Logs · Honor Company ── */}
      {activeTab === 's3' && canSeeS3 && (
        <div>
          {s3SubTabs.length > 1 && (
            <div className="flex gap-2 mb-6 flex-wrap">
              {s3SubTabs.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setS3SubTab(key)} className={subTabClass(s3ActiveTab === key)}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          )}
          {s3ActiveTab === 'aar-logs'      && canSeeAAR && <AdminAARLogs hideHeader />}
          {s3ActiveTab === 'events'        && canSeeCalendarEvents && <AdminEvents hideHeader />}
          {s3ActiveTab === 'honor-company' && canSeeHonorCompanyTab && <AdminHonorCompany hideHeader />}
        </div>
      )}

      {/* ── S4: Uniform Sizes · Supply Requests · Uniform Items ── */}
      {activeTab === 's4' && canSeeS4 && (
        <div>
          {s4SubTabs.length > 1 && (
            <div className="flex gap-2 mb-6 flex-wrap">
              {s4SubTabs.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setS4SubTab(key)} className={subTabClass(s4SubTab === key)}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          )}
          {s4SubTab === 'uniform-sizes'   && canSeeUniformSizes && <AdminUniformSizes hideHeader />}
          {s4SubTab === 'supply-requests' && canSeeSupplyRequests && <AdminSupplyRequests hideHeader />}
          {s4SubTab === 'uniform-items'   && canSeeUniformItems && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mb-5">
                <Shirt className="text-yellow-500" size={28} />
              </div>
              <h3 className="text-lg font-black uppercase italic tracking-tighter text-slate-900 dark:text-white mb-2">
                Uniform Items
              </h3>
              <p className="text-slate-400 dark:text-slate-500 text-sm font-medium mb-6 max-w-xs">
                Log and manage uniform issuance requests for cadets.
              </p>
              <Link
                to="/uniform-requests"
                className="bg-yellow-500 hover:bg-yellow-400 text-slate-950 px-6 py-3 rounded-xl font-black uppercase text-xs tracking-widest transition-all shadow-lg shadow-yellow-500/20"
              >
                Open Uniform Items →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── S5 ── */}
      {activeTab === 's5' && canSeeS5 && <AdminS5 hideHeader />}

      {/* ── S6: Checklist · Activity Log · Feedback Hub ── */}
      {activeTab === 's6' && canSeeS6 && (
        <div>
          {s6SubTabs.length > 1 && (
            <div className="flex gap-2 mb-6 flex-wrap">
              {s6SubTabs.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setS6SubTab(key)} className={subTabClass(s6SubTab === key)}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          )}
          {s6SubTab === 's6-checklist'       && canSeeChecklist && <AdminS6 hideHeader />}
          {s6SubTab === 'battalion-stats'    && canSeeBattalionStats && <AdminStats hideHeader />}
          {s6SubTab === 'login-notification' && canSeeLoginNotification && <AdminLoginNotification hideHeader />}
          {s6SubTab === 'activity-log'       && canSeeActivityLog && <AdminLog hideHeader />}
          {s6SubTab === 'feedback'           && canSeeFeedbackHub && <AdminFeedback hideHeader />}
        </div>
      )}
    </div>
  );
};

export default AdminStaff;
