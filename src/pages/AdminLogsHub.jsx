// src/pages/AdminLogsHub.jsx
//
// Logs Hub — combines Meeting Logs, AAR Logs, and Activity Log into one tabbed page.
// Deep-link with ?tab=meeting | aar | activity

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, ADMIN_LEVEL, STAFF_LEVEL, COMMAND_LEVEL } from '../constants';
import { NotepadText, ClipboardCheck, ScrollText, BookOpen } from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import AdminMeetingLogs from './AdminMeetingLogs';
import AdminAARLogs from './AdminAARLogs';
import AdminLog from './AdminLog';

const MEETING_LOG_ROLES = ['company_commander', 'company_xo', 'company_1sg', 'company_master_sergeant'];

const AdminLogsHub = () => {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const userLevel = ROLE_HIERARCHY[role] || 0;

  const canSeeMeetingLogs = MEETING_LOG_ROLES.includes(role) || userLevel >= STAFF_LEVEL;
  const canSeeAARLogs     = userLevel >= COMMAND_LEVEL;
  const canSeeActivity    = userLevel >= STAFF_LEVEL;

  const tabs = [
    { key: 'meeting',  label: 'Meeting Logs',  icon: NotepadText,    show: canSeeMeetingLogs },
    { key: 'aar',      label: 'AAR Logs',       icon: ClipboardCheck, show: canSeeAARLogs },
    { key: 'activity', label: 'Activity Log',   icon: ScrollText,     show: canSeeActivity },
  ].filter(t => t.show);

  const defaultTab = tabs[0]?.key || 'meeting';
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
      <AdminPageHeader icon={BookOpen} title="Logs Hub" meta={tabLabels} />

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

      {activeTab === 'meeting'  && canSeeMeetingLogs && <AdminMeetingLogs hideHeader />}
      {activeTab === 'aar'      && canSeeAARLogs     && <AdminAARLogs hideHeader />}
      {activeTab === 'activity' && canSeeActivity    && <AdminLog hideHeader />}
    </div>
  );
};

export default AdminLogsHub;
