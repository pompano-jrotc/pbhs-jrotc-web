// src/pages/AdminPublishingHub.jsx
//
// Publishing Hub — combines Leadership, Content, Documents, Newsletters,
// Photo Gallery, Battalion Stats, Teams, and Companies (Customization).
// Deep-link with ?tab=leadership | content | documents | newsletters |
// photos | stats | teams | companies

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import {
  Users, FileText, FolderOpen, Newspaper, Image, Building2, Globe, ShieldAlert
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import AdminLeadership from './AdminLeadership';
import AdminContent from './AdminContent';
import AdminDocuments from './AdminDocuments';
import AdminNewsletters from './AdminNewsletters';
import AdminPhotos from './AdminPhotos';
import AdminTeams from './AdminTeams';
import AdminCompanies from './AdminCompanies';

const RESTRICTED_CMD = ['sergeant_major', 'battalion_commander', 'battalion_csm'];

const AdminPublishingHub = () => {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const userLevel = ROLE_HIERARCHY[role] || 0;

  const isTopFour       = userLevel >= 70;
  const isRestrictedCmd = RESTRICTED_CMD.includes(role);
  const isStaffOrS4     = userLevel >= STAFF_LEVEL;

  const canSeeLeadership  = role === 's5_public_affairs' || (isTopFour && !isRestrictedCmd);
  const canSeeContent     = role === 's5_public_affairs' || role === 's6_technology' || (isTopFour && !isRestrictedCmd);
  const canSeeDocuments   = role === 's5_public_affairs' || role === 's6_technology' || (isTopFour && !isRestrictedCmd);
  const canSeeNewsletters = role === 's5_public_affairs' || (isTopFour && !isRestrictedCmd);
  const canSeePhotos      = role === 's5_public_affairs' || role === 's6_technology' || (isTopFour && !isRestrictedCmd);
  const canSeeTeams       = isStaffOrS4 && role !== 's1_adjutant';
  const canSeeCompanies   = role === 's6_technology' || (isTopFour && !isRestrictedCmd);

  const tabs = [
    { key: 'leadership',  label: 'Leadership',    icon: Users,        show: canSeeLeadership },
    { key: 'content',     label: 'Content',        icon: FileText,     show: canSeeContent },
    { key: 'documents',   label: 'Documents',      icon: FolderOpen,   show: canSeeDocuments },
    { key: 'newsletters', label: 'Newsletters',    icon: Newspaper,    show: canSeeNewsletters },
    { key: 'photos',      label: 'Photo Gallery',  icon: Image,        show: canSeePhotos },
    { key: 'teams',       label: 'Teams',          icon: ShieldAlert,  show: canSeeTeams },
    { key: 'companies',   label: 'Customization',  icon: Building2,    show: canSeeCompanies },
  ].filter(t => t.show);

  const defaultTab = tabs[0]?.key || 'content';
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
      <AdminPageHeader icon={Globe} title="Publishing Hub" meta={tabLabels} />

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

      {activeTab === 'leadership'  && canSeeLeadership  && <AdminLeadership hideHeader />}
      {activeTab === 'content'     && canSeeContent      && <AdminContent hideHeader />}
      {activeTab === 'documents'   && canSeeDocuments    && <AdminDocuments hideHeader />}
      {activeTab === 'newsletters' && canSeeNewsletters  && <AdminNewsletters hideHeader />}
      {activeTab === 'photos'      && canSeePhotos       && <AdminPhotos hideHeader />}
      {activeTab === 'teams'       && canSeeTeams        && <AdminTeams hideHeader />}
      {activeTab === 'companies'   && canSeeCompanies    && <AdminCompanies hideHeader />}
    </div>
  );
};

export default AdminPublishingHub;
