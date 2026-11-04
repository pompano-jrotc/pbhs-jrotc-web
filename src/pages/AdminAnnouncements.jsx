import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, deleteDoc, doc, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { Megaphone, Trash2, AlertTriangle, CheckCircle2, Paperclip, X, FileText, Clock, ExternalLink, Building2, Send, Image, BarChart2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY, COMMAND_LEVEL, STAFF_LEVEL } from '../constants';
import { useCompanies } from '../hooks/useCompanies';
import AdminPageHeader from '../components/AdminPageHeader';
import { uploadAnnouncementAttachment } from '../utils/storageUpload';
import DatePicker from '../components/DatePicker';
import PollCompose from '../components/PollCompose';
import PollDisplay from '../components/PollDisplay';
import FormCompose from '../components/FormCompose';
import FormDisplay from '../components/FormDisplay';

const AdminAnnouncements = () => {
  const { user, userData, role } = useAuth();
  const { companies } = useCompanies();
  const [text, setText]           = useState('');
  const [title, setTitle]         = useState('');
  const [expiresDate, setExpiresDate] = useState('');
  const [pdfFile, setPdfFile]     = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [sent, setSent]           = useState(false);
  const [emailStats, setEmailStats] = useState(null);
  const [existingAnnouncements, setExistingAnnouncements] = useState([]);
  const fileInputRef = useRef(null);

  const userPower = ROLE_HIERARCHY[role] || 1;
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, issuerLevel }
  const [toast, setToast] = useState(null);
  const [poll, setPoll]               = useState(null); // global broadcast poll
  const [companyPoll, setCompanyPoll] = useState(null); // company post poll
  const [form, setForm]               = useState(null); // global broadcast form
  const [companyForm, setCompanyForm] = useState(null); // company post form

  // Company announcements
  const [companyPosts,       setCompanyPosts]       = useState([]);
  const [companyPostText,    setCompanyPostText]    = useState('');
  const [companyTitle,       setCompanyTitle]       = useState('');
  const [postingCompany,     setPostingCompany]     = useState(false);
  const [companyPdfFile,     setCompanyPdfFile]     = useState(null);
  const [companyPdfPreviewUrl, setCompanyPdfPreviewUrl] = useState(null);
  const [companyPdfProgress, setCompanyPdfProgress] = useState(null);
  const [companyPdfError,    setCompanyPdfError]    = useState('');
  const companyTextRef   = useRef(null);
  const companyFileRef   = useRef(null);
  const canPostCompany    = userPower >= COMMAND_LEVEL && userPower < STAFF_LEVEL && !!userData?.company;
  const canManageCompany  = userPower >= STAFF_LEVEL;
  const [selectedCompany, setSelectedCompany] = useState('');

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const q = query(collection(db, "announcements"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setExistingAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error(err));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!userData) return;
    const q = query(collection(db, 'companyAnnouncements'), orderBy('timestamp', 'desc'), limit(50));
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const now = Date.now();
      const filtered = all
        .filter(p => !p.expiresAt || p.expiresAt > now)
        .filter(p => userPower >= STAFF_LEVEL || p.company === userData.company);
      setCompanyPosts(filtered);
    }, () => {});
  }, [userData, userPower]);

  useEffect(() => {
    if (!pdfFile?.type.startsWith('image/')) { setPdfPreviewUrl(null); return; }
    const reader = new FileReader();
    reader.onload = e => setPdfPreviewUrl(e.target.result);
    reader.readAsDataURL(pdfFile);
  }, [pdfFile]);

  useEffect(() => {
    if (!companyPdfFile?.type.startsWith('image/')) { setCompanyPdfPreviewUrl(null); return; }
    const reader = new FileReader();
    reader.onload = e => setCompanyPdfPreviewUrl(e.target.result);
    reader.readAsDataURL(companyPdfFile);
  }, [companyPdfFile]);

  const handleCompanyPost = async (e) => {
    e.preventDefault();
    const trimmed = companyPostText.trim();
    const targetCompany = canManageCompany ? selectedCompany : userData?.company;
    if (!trimmed || !targetCompany || postingCompany) return;
    setCompanyPdfError('');
    setPostingCompany(true);
    try {
      const issuer = `${userData?.rank || ''} ${userData?.fullName || 'Battalion Staff'}`.trim();

      let pdfUrl = null, pdfFileName = null, attachmentType = null;
      if (companyPdfFile) {
        try {
          setCompanyPdfProgress(0);
          const result = await uploadAnnouncementAttachment(companyPdfFile, 'company-announcements', p => setCompanyPdfProgress(p));
          pdfUrl = result.url;
          pdfFileName = companyPdfFile.name;
          attachmentType = result.type;
        } catch (err) {
          setCompanyPdfError(err.message || 'Upload failed.');
          setCompanyPdfProgress(null);
          setPostingCompany(false);
          return;
        }
        setCompanyPdfProgress(null);
      }

      await addDoc(collection(db, 'companyAnnouncements'), {
        content:     trimmed,
        company:     targetCompany,
        issuer,
        issuerLevel: userPower,
        issuerUid:   user?.uid || '',
        timestamp:   serverTimestamp(),
        active:      true,
        ...(companyTitle.trim() && { title: companyTitle.trim() }),
        ...(pdfUrl && { pdfUrl, pdfFileName, attachmentType }),
        ...(companyPoll && companyPoll.question.trim() && companyPoll.options.filter(o => o.text.trim()).length >= 2 && {
          poll: {
            ...companyPoll,
            options: companyPoll.options.filter(o => o.text.trim()),
          }
        }),
        ...(companyForm && companyForm.questions.filter(q => q.text.trim()).length >= 1 && {
          form: {
            ...companyForm,
            questions: companyForm.questions
              .filter(q => q.text.trim())
              .map(q => ({
                ...q,
                options: (q.options || []).filter(o => o.text.trim()),
              })),
          }
        }),
      });
      setCompanyPostText('');
      setCompanyTitle('');
      setCompanyPdfFile(null);
      setCompanyPdfPreviewUrl(null);
      setCompanyPoll(null);
      setCompanyForm(null);
      if (companyFileRef.current) companyFileRef.current.value = '';
      writeLog({
        type: 'announcement', action: 'create',
        description: `Company post (${targetCompany}): "${trimmed.substring(0, 80)}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });

      // Email notification — surface rate-limit errors to the user.
      user?.getIdToken().then(async idToken => {
        try {
          const r = await fetch('/api/send-push', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              idToken,
              announcementType: 'company',
              content: trimmed, issuer, company: targetCompany,
              ...(pdfUrl && { pdfUrl, pdfFileName: companyPdfFile?.name }),
            }),
          });
          if (r.status === 429) {
            const data = await r.json().catch(() => ({}));
            if (data.error === 'cooldown') {
              showToast('error', data.message || 'Please wait before sending another announcement.');
            } else if (data.error === 'email_daily_limit') {
              showToast('error', 'Daily email limit reached — notifications will resume tomorrow. Post was saved.');
            } else {
              showToast('error', 'Too many requests — please try again later.');
            }
          }
        } catch (err) {
          console.warn('send-push (company email) failed (non-critical):', err);
        }
      }).catch(() => {});
    } catch (err) { console.error('Company post error:', err); }
    finally { setPostingCompany(false); }
  };

  const handleDeleteCompanyPost = async (postId, postIssuerLevel) => {
    if (userPower < postIssuerLevel && userPower < STAFF_LEVEL) return;
    try { await deleteDoc(doc(db, 'companyAnnouncements', postId)); } catch (err) { console.error(err); }
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    setUploadError('');
    setEmailStats(null);
    try {
      const issuer = `${userData?.rank || ''} ${userData?.fullName || userData?.name || 'Staff'}`.trim();

      // Optional attachment upload (PDF or image)
      let pdfUrl = null, pdfFileName = null, attachmentType = null;
      if (pdfFile) {
        try {
          setUploadProgress(0);
          const result = await uploadAnnouncementAttachment(pdfFile, 'announcements', p => setUploadProgress(p));
          pdfUrl = result.url;
          pdfFileName = pdfFile.name;
          attachmentType = result.type;
        } catch (err) {
          setUploadError(err.message || 'Upload failed.');
          setUploadProgress(null);
          return;
        }
        setUploadProgress(null);
      }

      // Optional expiry — store as unix ms so client-side comparison stays simple
      const expiresAt = expiresDate
        ? new Date(expiresDate + 'T23:59:59').getTime()
        : null;

      const payload = {
        content: text,
        timestamp: serverTimestamp(),
        issuer,
        issuerLevel: userPower,
        target: 'All',
        active: true,
        ...(title.trim()  && { title: title.trim() }),
        ...(expiresAt     && { expiresAt }),
        ...(pdfUrl        && { pdfUrl, pdfFileName, attachmentType }),
        ...(poll && poll.question.trim() && poll.options.filter(o => o.text.trim()).length >= 2 && {
          poll: {
            ...poll,
            options: poll.options.filter(o => o.text.trim()),
          }
        }),
        ...(form && form.questions.filter(q => q.text.trim()).length >= 1 && {
          form: {
            ...form,
            questions: form.questions
              .filter(q => q.text.trim())
              .map(q => ({
                ...q,
                options: (q.options || []).filter(o => o.text.trim()),
              })),
          }
        }),
      };
      await addDoc(collection(db, "announcements"), payload);
      setText('');
      setTitle('');
      setExpiresDate('');
      setPdfFile(null);
      setPdfPreviewUrl(null);
      setPoll(null);
      setForm(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSent(true);
      setTimeout(() => setSent(false), 3000);
      writeLog({
        type: 'announcement', action: 'create',
        description: `Broadcast sent: "${text.substring(0, 80)}"`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '',
      });

      // Push + email notifications — await to surface rate-limit errors to the user.
      user?.getIdToken().then(async idToken => {
        const notifIssuer = `${userData?.rank || ''} ${userData?.fullName || 'Staff'}`.trim();
        try {
          const r = await fetch('/api/send-push', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              idToken,
              title: 'Broadcast — PBHS JROTC',
              body:  `${issuer}: ${text.substring(0, 160)}`,
              announcementType: 'global',
              content: text, issuer: notifIssuer,
              ...(pdfUrl && { pdfUrl, pdfFileName: pdfFile?.name }),
            }),
          });
          const data = await r.json();
          if (r.status === 429) {
            if (data.error === 'cooldown') {
              showToast('error', data.message || 'Please wait before sending another announcement.');
            } else if (data.error === 'email_daily_limit') {
              showToast('error', 'Daily email limit reached — notifications will resume tomorrow. Announcement was posted.');
            } else {
              showToast('error', 'Too many requests — please try again later.');
            }
            return;
          }
          if (data.emailStats) setEmailStats(data.emailStats);
        } catch (err) {
          console.warn('send-push failed (non-critical):', err);
        }
      }).catch(() => {});
    } catch (err) {
      console.error("Broadcast Error:", err);
      showToast('error', 'Broadcast failed. Try again.');
    }
  };

  const requestDelete = (id, issuerLevel) => {
    if (userPower < issuerLevel) {
      showToast('error', 'Priority Restriction: Cannot delete a broadcast from a superior officer.');
      return;
    }
    setDeleteConfirm({ id, issuerLevel });
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteDoc(doc(db, "announcements", deleteConfirm.id));
      setDeleteConfirm(null);
      showToast('success', 'Broadcast removed.');
      writeLog({
        type: 'announcement', action: 'delete',
        description: `Deleted broadcast`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: deleteConfirm.id,
      });
    } catch (err) {
      console.error("Delete error:", err);
      setDeleteConfirm(null);
      showToast('error', 'Delete failed — check Firestore rules.');
    }
  };

  const canGlobalBroadcast = userPower >= STAFF_LEVEL || role === 's5_public_affairs' || role === 's6_technology';

  return (
    <div className="flex-1 p-6 md:p-10 w-full">
      <div className="max-w-6xl mx-auto">

        <AdminPageHeader icon={Megaphone} title={canGlobalBroadcast ? 'Global Broadcast' : 'Announcements'} />

        {canGlobalBroadcast && <div className="grid lg:grid-cols-2 gap-8">
          {/* CREATE ANNOUNCEMENT CARD */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-xl dark:shadow-none h-fit">
            <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest mb-8 flex items-center gap-2">
              <Megaphone className="text-yellow-500" size={20} /> Send Broadcast
            </h2>

            <form onSubmit={handleBroadcast} className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Title (optional)</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Announcement title…"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl px-4 py-3 text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-all text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Details</label>
                <textarea required value={text} onChange={(e) => setText(e.target.value)} className="w-full h-32 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-slate-900 dark:text-white resize-none outline-none focus:border-yellow-500 transition-all" placeholder="Enter broadcast details..." />
              </div>

              {/* Expiry date — optional */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 flex items-center gap-1.5">
                  <Clock size={10} /> Expires (optional)
                </label>
                <DatePicker
                  value={expiresDate}
                  onChange={setExpiresDate}
                  placeholder="No expiry"
                />
                {expiresDate && (
                  <p className="text-[10px] text-slate-400 ml-1">
                    Broadcast hides from the feed after {new Date(expiresDate + 'T23:59:59').toLocaleDateString()}.
                  </p>
                )}
              </div>

              {/* Attachment — PDF or image, optional */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 flex items-center gap-1.5">
                  <Paperclip size={10} /> Attach PDF or Image (optional)
                </label>
                {pdfFile ? (
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl px-4 py-3">
                    {pdfFile.type.startsWith('image/') ? (
                      <img src={pdfPreviewUrl || ''} alt="preview" className="h-10 w-10 object-cover rounded-lg shrink-0" />
                    ) : (
                      <FileText size={16} className="text-yellow-500 shrink-0" />
                    )}
                    <span className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate flex-1">{pdfFile.name}</span>
                    <button type="button" onClick={() => { setPdfFile(null); setPdfPreviewUrl(null); if (fileInputRef.current) fileInputRef.current.value = ''; }} className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-white/10 rounded-2xl px-4 py-4 cursor-pointer hover:border-yellow-500/50 transition-all">
                    <Paperclip size={16} className="text-slate-400 shrink-0" />
                    <span className="text-sm text-slate-400">Click to attach a PDF or image</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf,.webp,.jpg,.jpeg,.png,image/webp,image/jpeg,image/png"
                      className="hidden"
                      onChange={e => { setPdfFile(e.target.files?.[0] || null); setUploadError(''); }}
                    />
                  </label>
                )}
                {uploadProgress !== null && (
                  <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden mt-1">
                    <div className="h-full bg-yellow-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
                {uploadError && <p className="text-[10px] text-red-500 ml-1">{uploadError}</p>}
              </div>

              <PollCompose value={poll} onChange={setPoll} />
              <FormCompose value={form} onChange={setForm} />

              <button type="submit" disabled={sent || uploadProgress !== null} className={`w-full font-black py-4 rounded-xl uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all ${sent ? "bg-green-600 text-white" : "bg-yellow-500 text-slate-950 hover:bg-yellow-400 shadow-lg shadow-yellow-500/20 disabled:opacity-60"}`}>
                {sent ? "SENT" : uploadProgress !== null ? `Uploading… ${uploadProgress}%` : "SEND BROADCAST"}
              </button>

              {/* Email recipient breakdown — shown after a broadcast is sent */}
              {emailStats && (
                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 px-4 py-3 space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Email Delivery Breakdown</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Approved users</span>
                    <span className="font-black text-slate-900 dark:text-white">{emailStats.approved}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">No email on file</span>
                    <span className={`font-black ${emailStats.noEmail > 0 ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}>{emailStats.noEmail}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Opted out</span>
                    <span className={`font-black ${emailStats.optedOut > 0 ? 'text-amber-500' : 'text-slate-400 dark:text-slate-500'}`}>{emailStats.optedOut}</span>
                  </div>
                  <div className="border-t border-slate-200 dark:border-white/10 pt-1.5 flex justify-between text-xs">
                    <span className="font-black text-slate-700 dark:text-slate-300">Emails sent</span>
                    <span className="font-black text-green-600 dark:text-green-400">{emailStats.willReceive}</span>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* HISTORY CARD */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-xl dark:shadow-none overflow-y-auto max-h-[700px]">
            <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest mb-6 px-2">Broadcast History</h2>
            <div className="space-y-4">
              {existingAnnouncements.map(item => (
                <div key={item.id} className="bg-slate-50 dark:bg-slate-950 p-5 rounded-2xl border border-slate-200 dark:border-white/5 flex justify-between items-start hover:border-yellow-500/30 transition-all shadow-sm dark:shadow-none">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded border border-yellow-500/50 text-yellow-500 bg-white dark:bg-slate-900">{item.eventType}</span>
                      <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-400">To: {item.target}</span>
                    </div>
                    {item.title && <p className="text-sm font-black text-slate-900 dark:text-white mb-1">{item.title}</p>}
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pr-4 font-medium whitespace-pre-wrap">{item.content}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-tight">By: {item.issuer}</p>
                      <span className="text-[8px] text-slate-400 dark:text-slate-500 font-black px-1 rounded bg-slate-200 dark:bg-white/10">LVL {item.issuerLevel}</span>
                      {item.expiresAt && (
                        <span className="text-[8px] font-black text-amber-500 flex items-center gap-0.5">
                          <Clock size={8} /> Expires {new Date(item.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      {item.pdfUrl && item.attachmentType === 'image' ? (
                        <a href={item.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[8px] font-black text-yellow-500 flex items-center gap-0.5 hover:underline">
                          <Image size={8} /> {item.pdfFileName || 'Image'} <ExternalLink size={7} />
                        </a>
                      ) : item.pdfUrl ? (
                        <a href={item.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[8px] font-black text-yellow-500 flex items-center gap-0.5 hover:underline">
                          <FileText size={8} /> {item.pdfFileName || 'PDF'} <ExternalLink size={7} />
                        </a>
                      ) : null}
                    </div>
                    {item.poll && (
                      <PollDisplay poll={item.poll} announcementId={item.id} collectionName="announcements" />
                    )}
                    {item.form && (
                      <FormDisplay form={item.form} announcementId={item.id} collectionName="announcements" />
                    )}
                  </div>
                  <button title="Delete announcement" onClick={() => requestDelete(item.id, item.issuerLevel)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 p-2 transition-colors">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {existingAnnouncements.length === 0 && (
                <p className="text-center text-slate-400 dark:text-slate-600 text-xs font-bold uppercase tracking-widest py-10">No records found</p>
              )}
            </div>
          </div>
        </div>}
      </div>

      {/* ── Company Announcements ── */}
      {(companyPosts.length > 0 || canPostCompany || canManageCompany) && (
        <div className="mt-10">
          <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest mb-6 flex items-center gap-2">
            <Building2 className="text-yellow-500" size={20} />
            {canManageCompany ? 'Company Announcements' : `${userData?.company} Company Announcements`}
          </h2>
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Compose — company command or battalion staff */}
            {(canPostCompany || canManageCompany) && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-xl dark:shadow-none h-fit">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-5 flex items-center gap-2">
                  <Send size={14} className="text-yellow-500" />
                  {canManageCompany ? 'Post to Company' : `Post to ${userData?.company} Company`}
                </h3>
                <form onSubmit={handleCompanyPost} className="space-y-4">
                  {/* Company selector — staff only */}
                  {canManageCompany && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Target Company</label>
                      <select
                        required
                        value={selectedCompany}
                        onChange={e => setSelectedCompany(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl px-4 py-3 text-slate-900 dark:text-white text-sm outline-none focus:border-yellow-500 transition-all"
                      >
                        <option value="">Select a company…</option>
                        {(companies || []).map(co => (
                          <option key={co} value={co}>{co} Company</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Title (optional)</label>
                    <input
                      type="text"
                      value={companyTitle}
                      onChange={e => setCompanyTitle(e.target.value)}
                      placeholder="Announcement title…"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl px-4 py-3 text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-all text-sm"
                    />
                  </div>
                  <textarea
                    ref={companyTextRef}
                    value={companyPostText}
                    onChange={e => setCompanyPostText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCompanyPost(e); }}
                    rows={4}
                    placeholder={canManageCompany ? `Message to selected company…` : `Message ${userData?.company} Company…`}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl p-4 text-slate-900 dark:text-white resize-none outline-none focus:border-yellow-500 transition-all"
                  />

                  {/* Attachment — PDF or image, optional */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 flex items-center gap-1.5">
                      <Paperclip size={10} /> Attach PDF or Image (optional)
                    </label>
                    {companyPdfFile ? (
                      <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-2xl px-4 py-3">
                        {companyPdfFile.type.startsWith('image/') ? (
                          <img src={companyPdfPreviewUrl || ''} alt="preview" className="h-10 w-10 object-cover rounded-lg shrink-0" />
                        ) : (
                          <FileText size={16} className="text-yellow-500 shrink-0" />
                        )}
                        <span className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate flex-1">{companyPdfFile.name}</span>
                        <button type="button" onClick={() => { setCompanyPdfFile(null); setCompanyPdfPreviewUrl(null); if (companyFileRef.current) companyFileRef.current.value = ''; }} className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-3 bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-white/10 rounded-2xl px-4 py-4 cursor-pointer hover:border-yellow-500/50 transition-all">
                        <Paperclip size={16} className="text-slate-400 shrink-0" />
                        <span className="text-sm text-slate-400">Click to attach a PDF or image</span>
                        <input
                          ref={companyFileRef}
                          type="file"
                          accept=".pdf,application/pdf,.webp,.jpg,.jpeg,.png,image/webp,image/jpeg,image/png"
                          className="hidden"
                          onChange={e => { setCompanyPdfFile(e.target.files?.[0] || null); setCompanyPdfError(''); }}
                        />
                      </label>
                    )}
                    {companyPdfProgress !== null && (
                      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden mt-1">
                        <div className="h-full bg-yellow-500 transition-all" style={{ width: `${companyPdfProgress}%` }} />
                      </div>
                    )}
                    {companyPdfError && <p className="text-[10px] text-red-500 ml-1">{companyPdfError}</p>}
                  </div>

                  <PollCompose value={companyPoll} onChange={setCompanyPoll} />
                  <FormCompose value={companyForm} onChange={setCompanyForm} />

                  <button
                    type="submit"
                    disabled={!companyPostText.trim() || postingCompany || companyPdfProgress !== null || (canManageCompany && !selectedCompany)}
                    className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black py-4 rounded-xl uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2"
                  >
                    <Send size={14} />
                    {companyPdfProgress !== null ? `Uploading… ${companyPdfProgress}%` : postingCompany ? 'Posting…' : 'Post Announcement'}
                  </button>
                </form>
              </div>
            )}

            {/* Posts history */}
            <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 shadow-xl dark:shadow-none overflow-y-auto max-h-[600px] ${(!canPostCompany && !canManageCompany) ? 'lg:col-span-2' : ''}`}>
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-5">
                {userPower >= STAFF_LEVEL ? 'All Companies' : 'Recent Posts'}
              </h3>
              {companyPosts.length === 0 ? (
                <p className="text-center text-slate-400 dark:text-slate-600 text-xs font-bold uppercase tracking-widest py-10">No posts yet</p>
              ) : (
                <div className="space-y-4">
                  {companyPosts.map(post => {
                    const canDelete = userPower >= STAFF_LEVEL || post.issuerUid === user?.uid;
                    const ts = post.timestamp?.toDate?.();
                    const timeStr = ts
                      ? ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
                        ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                      : '';
                    return (
                      <div key={post.id} className="bg-slate-50 dark:bg-slate-950 p-5 rounded-2xl border border-slate-200 dark:border-white/5 flex justify-between items-start hover:border-yellow-500/30 transition-all">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded border border-yellow-500/50 text-yellow-500 bg-white dark:bg-slate-900">{post.company}</span>
                          </div>
                          {post.title && <p className="text-sm font-black text-slate-900 dark:text-white mb-1">{post.title}</p>}
                          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pr-4 font-medium whitespace-pre-wrap">{post.content}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-tight">By: {post.issuer} · {timeStr}</p>
                            {post.pdfUrl && post.attachmentType === 'image' ? (
                              <a href={post.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[8px] font-black text-yellow-500 flex items-center gap-0.5 hover:underline">
                                <Image size={8} /> {post.pdfFileName || 'Image'} <ExternalLink size={7} />
                              </a>
                            ) : post.pdfUrl ? (
                              <a href={post.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[8px] font-black text-yellow-500 flex items-center gap-0.5 hover:underline">
                                <FileText size={8} /> {post.pdfFileName || 'PDF'} <ExternalLink size={7} />
                              </a>
                            ) : null}
                          </div>
                          {post.poll && (
                            <PollDisplay poll={post.poll} announcementId={post.id} collectionName="companyAnnouncements" />
                          )}
                          {post.form && (
                            <FormDisplay form={post.form} announcementId={post.id} collectionName="companyAnnouncements" />
                          )}
                        </div>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDeleteCompanyPost(post.id, post.issuerLevel)}
                            className="text-slate-300 dark:text-slate-600 hover:text-red-500 p-2 transition-colors shrink-0"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/90">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-10 rounded-[2.5rem] max-w-sm w-full text-center shadow-2xl">
            <Trash2 size={40} className="text-red-500 mx-auto mb-6" />
            <h3 className="text-xl font-black uppercase italic mb-3 text-slate-900 dark:text-white">Delete Broadcast?</h3>
            <p className="text-slate-500 text-xs mb-8 leading-relaxed">This announcement will be permanently removed.</p>
            <div className="flex flex-col gap-3">
              <button onClick={handleDelete} className="w-full bg-red-600 py-4 rounded-xl font-black text-white uppercase text-[10px] tracking-widest hover:bg-red-500 transition-all">Confirm Delete</button>
              <button onClick={() => setDeleteConfirm(null)} className="w-full py-4 rounded-xl font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all uppercase text-[10px] tracking-widest bg-slate-100 dark:bg-white/5">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
            className={`fixed bottom-8 right-8 px-8 py-4 rounded-2xl font-black uppercase text-xs flex items-center gap-3 shadow-2xl z-[200] ${
              toast.type === 'success' ? 'bg-yellow-500 text-slate-950' : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminAnnouncements;
