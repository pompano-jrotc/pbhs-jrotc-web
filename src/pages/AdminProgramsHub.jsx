// src/pages/AdminProgramsHub.jsx
//
// Programs Hub — combines Camp Attendance and Participation Tracker into one tabbed page.
// Deep-link with ?tab=camps | participation

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Tent, ListChecks, FolderOpen } from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import AdminCamps from './AdminCamps';
import AdminParticipation from './AdminParticipation';

const AdminProgramsHub = () => {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canSeeCamps = role !== 's6_technology';

  const tabs = [
    { key: 'camps',         label: 'Camp Attendance',      icon: Tent,       show: canSeeCamps },
    { key: 'participation', label: 'Participation Tracker', icon: ListChecks, show: true },
  ].filter(t => t.show);

  const defaultTab = tabs[0]?.key || 'camps';
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
      <AdminPageHeader icon={FolderOpen} title="Programs Hub" meta={tabLabels} />

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

      {activeTab === 'camps'         && canSeeCamps && <AdminCamps hideHeader />}
      {activeTab === 'participation' && <AdminParticipation hideHeader />}
    </div>
  );
};

export default AdminProgramsHub;
