// src/pages/MyAnnouncements.jsx
// Authenticated announcements view — global announcements relevant to the user's
// level plus company-specific announcements from their company.

import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { db } from '../firebase';
import {
  collection, query, where, orderBy, onSnapshot,
} from 'firebase/firestore';
import { Megaphone, Building2 } from 'lucide-react';
import { ROLE_HIERARCHY } from '../constants';
import AdminPageHeader from '../components/AdminPageHeader';
import { usePageMeta } from '../hooks/usePageMeta';

const fmt = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const AnnouncementCard = ({ ann, companyBadge }) => {
  const text = ann.content || ann.body || ann.message || ann.text || '';
  const dateStr = fmt(ann.timestamp);
  return (
    <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl shadow-sm">
      {companyBadge && (
        <span className="inline-flex items-center gap-1 text-[9px] font-black text-blue-500 uppercase tracking-widest bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-full px-2 py-0.5 mb-2">
          <Building2 size={8} /> {ann.company} Co.
        </span>
      )}
      <div className="flex items-start justify-between gap-3 mb-2">
        {ann.title && (
          <p className="text-sm font-black text-slate-900 dark:text-white leading-tight">{ann.title}</p>
        )}
        {dateStr && (
          <span className="shrink-0 text-[10px] font-bold text-slate-400">{dateStr}</span>
        )}
      </div>
      {text && (
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{text}</p>
      )}
    </div>
  );
};

export default function MyAnnouncements() {
  const { user, userData, role, loading: authLoading } = useAuth();
  const userLevel = ROLE_HIERARCHY[role] || 0;

  const [globalAnns, setGlobalAnns] = useState([]);
  const [companyAnns, setCompanyAnns] = useState([]);
  const [loadingGlobal, setLoadingGlobal] = useState(true);
  const [loadingCompany, setLoadingCompany] = useState(true);

  usePageMeta({
    title: 'Announcements',
    description: 'Your battalion and company announcements.',
    path: '/admin/my/announcements',
  });

  // Global announcements
  useEffect(() => {
    if (authLoading || !user) return;
    const q = query(
      collection(db, 'announcements'),
      orderBy('timestamp', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      setGlobalAnns(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoadingGlobal(false);
    }, () => setLoadingGlobal(false));
    return () => unsub();
  }, [authLoading, user]);

  // Company announcements (filtered client-side by expiresAt)
  useEffect(() => {
    if (authLoading || !user) return;
    const co = userData?.company || '';
    if (!co) { setLoadingCompany(false); return; }
    const q = query(
      collection(db, 'companyAnnouncements'),
      where('company', '==', co),
      orderBy('timestamp', 'desc'),
    );
    const now = Date.now();
    const unsub = onSnapshot(q, snap => {
      setCompanyAnns(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => !p.expiresAt || p.expiresAt > now),
      );
      setLoadingCompany(false);
    }, () => setLoadingCompany(false));
    return () => unsub();
  }, [authLoading, user, userData?.company]);

  const loading = authLoading || loadingGlobal || loadingCompany;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      <AdminPageHeader
        title="Announcements"
        subtitle="Battalion-wide and company updates relevant to you"
        icon={Megaphone}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-yellow-500" />
        </div>
      ) : (
        <>
          {/* Company announcements */}
          {companyAnns.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-500 flex items-center gap-2">
                <Building2 size={12} /> {userData?.company} Company
              </h2>
              {companyAnns.map(a => (
                <AnnouncementCard key={a.id} ann={a} companyBadge />
              ))}
            </section>
          )}

          {/* Global announcements */}
          <section className="space-y-3">
            {companyAnns.length > 0 && (
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <Megaphone size={12} /> Battalion-Wide
              </h2>
            )}
            {globalAnns.length === 0 && companyAnns.length === 0 ? (
              <div className="text-center py-16 space-y-2">
                <Megaphone size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">No announcements yet.</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">Check back later for updates from battalion staff and your company leadership.</p>
              </div>
            ) : globalAnns.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">No battalion-wide announcements.</p>
            ) : (
              globalAnns.map(a => (
                <AnnouncementCard key={a.id} ann={a} />
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
