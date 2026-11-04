// src/pages/AdminPersonnelHub.jsx
//
// Personnel Hub — combines Battalion Roster, Cadet History, Accounts, and
// Cadet Challenge into one tabbed page.
// Deep-link with ?tab=roster | history | accounts | challenge

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, COMMAND_LEVEL, ADMIN_LEVEL } from '../constants';
import { BookUser, History, UserCog, Activity, Users2 } from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import AdminRoster from './AdminRoster';
import AdminCadetHistory from './AdminCadetHistory';
import AdminUsers from './AdminUsers';
import AdminCadetChallenge from './AdminCadetChallenge';

const CHALLENGE_ROLES = ['company_s1_assistant', 'company_s3_assistant'];

const AdminPersonnelHub = () => {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const userLevel = ROLE_HIERARCHY[role] || 0;

  const canSeeRoster    = userLevel >= COMMAND_LEVEL || CHALLENGE_ROLES.includes(role);
  const canSeeHistory   = userLevel >= COMMAND_LEVEL;
  const canSeeAccounts  = role === 's1_adjutant' || role === 's6_technology' || userLevel >= ADMIN_LEVEL;
  const canSeeChallenge = CHALLENGE_ROLES.includes(role) || userLevel >= COMMAND_LEVEL;
  const tabs = [
    { key: 'roster',    label: 'Battalion Roster', icon: BookUser, show: canSeeRoster },
    { key: 'history',   label: 'Cadet History',    icon: History,  show: canSeeHistory },
    { key: 'accounts',  label: 'Accounts',          icon: UserCog,  show: canSeeAccounts },
    { key: 'challenge', label: 'Cadet Challenge',   icon: Activity, show: canSeeChallenge },
  ].filter(t => t.show);

  const defaultTab = tabs[0]?.key || 'roster';
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

  return (
    <div className="flex-1 p-6 md:p-10 w-full">
      <AdminPageHeader icon={Users2} title="Personnel Hub" meta={tabLabels} />

      {tabs.length > 1 && (
        <div className="flex gap-2 mb-8 flex-wrap -mt-4">
          {tabs.map(({ key, label, icon: Icon }) => (
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
            </button>
          ))}
        </div>
      )}

      {activeTab === 'roster'    && canSeeRoster    && <AdminRoster hideHeader />}
      {activeTab === 'history'   && canSeeHistory   && <AdminCadetHistory hideHeader />}
      {activeTab === 'accounts'  && canSeeAccounts   && <AdminUsers hideHeader />}
      {activeTab === 'challenge' && canSeeChallenge  && <AdminCadetChallenge hideHeader />}
    </div>
  );
};

export default AdminPersonnelHub;
