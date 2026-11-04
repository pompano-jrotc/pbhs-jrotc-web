import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate } from 'react-router-dom';
import { ROLE_HIERARCHY, ADMIN_LEVEL } from '../constants';
import { DEFAULT_ABOUT, DEFAULT_CADET_INFO, DEFAULT_HOME, DEFAULT_PHOTOS } from '../data/defaultPageContent';
import { DEFAULT_VISIBILITY } from '../hooks/usePageVisibility';
import {
  FileText, Save, ChevronDown, CheckCircle2, Loader2, Info,
  Eye, EyeOff, LayoutDashboard, Plus, Trash2, X, UploadCloud, ImageIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import ScrambleText from '../components/ScrambleText';
import AdminPageHeader from '../components/AdminPageHeader';
import { useConfirm } from '../contexts/ConfirmContext';

const TABS = [
  { id: 'home',           label: 'Home' },
  { id: 'about',          label: 'About' },
  { id: 'cadet-info',     label: 'General Info' },
  { id: 'photos',         label: 'Photo Gallery' },
  { id: 'visibility',     label: 'Visibility' },
];

const PAGE_VISIBILITY_LABELS = {
  about:             'About JROTC',
  'cadet-info':      'Cadet Info (General)',
  'promotion-board': 'Promotion Board',
  'winning-colors':  'Winning Colors',
  uniform:           'Uniform Guide',
  quizzes:           'Quizzes',
  documents:         'Documents & Regs',
  announcements:     'Announcements',
  teams:             'Battalion Teams',
  leadership:        'Leadership',
  photos:            'Photo Gallery',
};

const linesToArray = (text) => (text || '').split('\n').map(s => s.trim()).filter(Boolean);

const inputClass = "w-full bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-white/10 p-3 rounded-xl outline-none focus:border-yellow-500 text-sm font-bold text-slate-900 dark:text-white";
const labelClass = "text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1 block mb-1";

const AdminContent = ({ hideHeader = false }) => {
  const { user, userData, role, loading: authLoading } = useAuth();
  const confirm = useConfirm();
  const isAuthorized = role === 's5_public_affairs' || role === 's6_technology' || (ROLE_HIERARCHY[role] || 0) >= ADMIN_LEVEL;

  const [activeTab, setActiveTab] = useState('about');
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const [homeForm, setHomeForm] = useState(DEFAULT_HOME);
  const [photosForm, setPhotosForm] = useState(DEFAULT_PHOTOS);
  const [aboutForm, setAboutForm] = useState(DEFAULT_ABOUT);
  const [cadetInfoForm, setCadetInfoForm] = useState(DEFAULT_CADET_INFO);
  const [visibilityForm, setVisibilityForm] = useState(DEFAULT_VISIBILITY);


  useEffect(() => {
    if (!isAuthorized) return;
    const unsubs = [
      onSnapshot(doc(db, "pageContent", "home"), (snap) => {
        if (snap.exists()) setHomeForm({ ...DEFAULT_HOME, ...snap.data() });
        setDataLoading(false);
      }),
      onSnapshot(doc(db, "pageContent", "photos"), (snap) => {
        if (snap.exists()) setPhotosForm({ ...DEFAULT_PHOTOS, ...snap.data() });
      }),
      onSnapshot(doc(db, "pageContent", "about"), (snap) => {
        if (snap.exists()) setAboutForm({ ...DEFAULT_ABOUT, ...snap.data() });
      }),
      onSnapshot(doc(db, "pageContent", "cadet-info"), (snap) => {
        if (snap.exists()) setCadetInfoForm({ ...DEFAULT_CADET_INFO, ...snap.data() });
      }),
      onSnapshot(doc(db, "settings", "pageVisibility"), (snap) => {
        if (snap.exists()) setVisibilityForm({ ...DEFAULT_VISIBILITY, ...snap.data() });
        else setVisibilityForm(DEFAULT_VISIBILITY);
      })
    ];
    return () => unsubs.forEach(u => u());
  }, [isAuthorized]);

  const showStatus = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  };

  const saveTab = async (id, data) => {
    setSaving(true);
    try {
      await setDoc(doc(db, "pageContent", id), data);
      showStatus("Saved and live on the site now");
      writeLog({
        type: 'content', action: 'update',
        description: `Updated page content: ${id}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: id,
      });
    } catch (err) {
      console.error("Save failed:", err);
      showStatus("Save Failed");
    } finally {
      setSaving(false);
    }
  };

  // --- HOME helpers ---
  const updateSlide = (index, field, value) => {
    const slides = [...homeForm.slides];
    slides[index] = { ...slides[index], [field]: value };
    setHomeForm({ ...homeForm, slides });
  };
  const addSlide = () => setHomeForm({ ...homeForm, slides: [...homeForm.slides, { url: '', title: '', subtitle: '' }] });
  const removeSlide = (i) => setHomeForm({ ...homeForm, slides: homeForm.slides.filter((_, idx) => idx !== i) });

  // Per-slide upload state: { [index]: boolean }
  const [slideUploading, setSlideUploading] = useState({});

  const handleSlideUpload = async (i, file) => {
    if (!file) return;
    setSlideUploading(prev => ({ ...prev, [i]: true }));
    try {
      const { secure_url } = await uploadToCloudinary(file, 'image');
      updateSlide(i, 'url', secure_url);
    } catch (err) {
      showStatus(err.message || 'Upload failed');
    } finally {
      setSlideUploading(prev => ({ ...prev, [i]: false }));
    }
  };
  const updateQuickAccess = (index, field, value) => {
    const quickAccess = [...homeForm.quickAccess];
    quickAccess[index] = { ...quickAccess[index], [field]: value };
    setHomeForm({ ...homeForm, quickAccess });
  };

  // --- PHOTOS helpers ---
  const updateAlbum = (index, field, value) => {
    const albums = [...photosForm.albums];
    albums[index] = { ...albums[index], [field]: value };
    setPhotosForm({ ...photosForm, albums });
  };
  const addAlbum = () => setPhotosForm({
    ...photosForm,
    albums: [...photosForm.albums, { id: Date.now(), title: '', count: '', coverImage: '', albumUrl: '' }]
  });
  const removeAlbum = (i) => setPhotosForm({ ...photosForm, albums: photosForm.albums.filter((_, idx) => idx !== i) });

  // --- ABOUT helpers ---
  const updateHistory = (index, field, value) => {
    const history = [...aboutForm.history];
    history[index] = { ...history[index], [field]: value };
    setAboutForm({ ...aboutForm, history });
  };
  const updatePillar = (index, field, value) => {
    const pillars = [...aboutForm.pillars];
    pillars[index] = { ...pillars[index], [field]: value };
    setAboutForm({ ...aboutForm, pillars });
  };

  // --- CADET INFO helpers ---
  const updateArmyValue = (index, field, value) => {
    const armyValues = [...cadetInfoForm.armyValues];
    armyValues[index] = { ...armyValues[index], [field]: value };
    setCadetInfoForm({ ...cadetInfoForm, armyValues });
  };

  if (authLoading || (dataLoading && isAuthorized)) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center text-yellow-600">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (!isAuthorized) return <Navigate to="/admin/dashboard" />;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      <div className="max-w-4xl mx-auto">

        {!hideHeader && <AdminPageHeader icon={FileText} title="Content" />}

        {/* Tabs */}
        <div className="flex bg-slate-200/50 dark:bg-white/5 p-1 rounded-2xl w-fit border border-slate-200 dark:border-white/5 mb-8">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-yellow-500 text-slate-950 shadow-lg' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* --- HOME TAB --- */}
        {activeTab === 'home' && (
          <div className="space-y-6">
            {/* Slideshow */}
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">Hero Slideshow ({homeForm.slides.length} slides)</h3>
                <button onClick={addSlide} className="flex items-center gap-1.5 text-[10px] font-black uppercase text-yellow-600 dark:text-yellow-500 hover:opacity-70 transition-opacity">
                  <Plus size={14} /> Add Slide
                </button>
              </div>
              <div className="space-y-4">
                {homeForm.slides.map((slide, i) => (
                  <div key={i} className="bg-slate-50 dark:bg-black/30 border border-slate-100 dark:border-white/5 p-4 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500">Slide {i + 1}</span>
                      {homeForm.slides.length > 1 && (
                        <button onClick={() => removeSlide(i)} className="text-red-400 hover:text-red-500 transition-colors p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    {/* Image upload / preview */}
                    {slide.url ? (
                      <div className="relative rounded-xl overflow-hidden h-32 bg-black/30 group">
                        <img src={slide.url} alt={`Slide ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <label className={`cursor-pointer flex items-center gap-1.5 text-[10px] font-black uppercase text-white bg-white/20 hover:bg-white/30 px-3 py-2 rounded-lg transition-all ${slideUploading[i] ? 'opacity-50 pointer-events-none' : ''}`}>
                            {slideUploading[i] ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                            {slideUploading[i] ? 'Uploading…' : 'Replace'}
                            <input type="file" accept="image/*" className="hidden" onChange={e => handleSlideUpload(i, e.target.files[0])} disabled={!!slideUploading[i]} />
                          </label>
                          <button
                            onClick={() => updateSlide(i, 'url', '')}
                            className="text-[10px] font-black uppercase text-white bg-red-500/40 hover:bg-red-500/60 px-3 py-2 rounded-lg transition-all"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className={`cursor-pointer border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl flex flex-col items-center justify-center h-28 gap-2 hover:border-yellow-500/50 transition-colors ${slideUploading[i] ? 'opacity-60 pointer-events-none' : ''}`}>
                        {slideUploading[i] ? (
                          <>
                            <Loader2 size={22} className="text-yellow-500 animate-spin" />
                            <span className="text-[10px] font-black uppercase text-slate-400">Uploading…</span>
                          </>
                        ) : (
                          <>
                            <UploadCloud size={22} className="text-slate-300 dark:text-slate-600" />
                            <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500">Upload Slide Image</span>
                            <span className="text-[9px] text-slate-300 dark:text-slate-600 uppercase">JPG, PNG, WebP — auto-converted</span>
                          </>
                        )}
                        <input type="file" accept="image/*" className="hidden" onChange={e => handleSlideUpload(i, e.target.files[0])} disabled={!!slideUploading[i]} />
                      </label>
                    )}

                    <div className="grid md:grid-cols-2 gap-3">
                      <input className={inputClass} placeholder="Title (e.g. TORNADO)" value={slide.title} onChange={e => updateSlide(i, 'title', e.target.value)} />
                      <input className={inputClass} placeholder="Subtitle (e.g. BATTALION)" value={slide.subtitle} onChange={e => updateSlide(i, 'subtitle', e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Access Cards */}
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-5">
              <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">Quick Access Cards</h3>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest -mt-2">
                The three cards at the bottom of the homepage. Icons are fixed (Cadet Info → Shield, Leadership → Users, Teams → Award).
              </p>
              {homeForm.quickAccess.map((card, i) => (
                <div key={i} className="grid md:grid-cols-3 gap-3 pb-4 border-b border-slate-100 dark:border-white/5 last:border-0 last:pb-0">
                  <input className={inputClass} placeholder="Title" value={card.title} onChange={e => updateQuickAccess(i, 'title', e.target.value)} />
                  <input className={inputClass} placeholder="Description" value={card.desc} onChange={e => updateQuickAccess(i, 'desc', e.target.value)} />
                  <input className={inputClass} placeholder="Link (e.g. /cadet-info)" value={card.link} onChange={e => updateQuickAccess(i, 'link', e.target.value)} />
                </div>
              ))}
            </div>

            <button disabled={saving} onClick={() => saveTab('home', homeForm)} className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 flex items-center justify-center gap-2">
              <Save size={18} /> Save Homepage
            </button>
          </div>
        )}

        {/* --- ABOUT TAB --- */}
        {activeTab === 'about' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-5">
              <div>
                <label className={labelClass}>Mission Statement</label>
                <textarea className={`${inputClass} h-24 resize-none`} value={aboutForm.missionText} onChange={e => setAboutForm({ ...aboutForm, missionText: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>The Student-Led Experience</label>
                <textarea className={`${inputClass} h-24 resize-none`} value={aboutForm.studentLedText} onChange={e => setAboutForm({ ...aboutForm, studentLedText: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Call to Action Title</label>
                <input className={inputClass} value={aboutForm.ctaTitle} onChange={e => setAboutForm({ ...aboutForm, ctaTitle: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Call to Action Text</label>
                <textarea className={`${inputClass} h-20 resize-none`} value={aboutForm.ctaText} onChange={e => setAboutForm({ ...aboutForm, ctaText: e.target.value })} />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-5">
              <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">Historical Context Cards</h3>
              {aboutForm.history.map((card, i) => (
                <div key={i} className="grid md:grid-cols-2 gap-3 pb-4 border-b border-slate-100 dark:border-white/5 last:border-0 last:pb-0">
                  <input className={inputClass} placeholder="Card Title" value={card.title} onChange={e => updateHistory(i, 'title', e.target.value)} />
                  <textarea className={`${inputClass} h-20 resize-none`} placeholder="Card Text" value={card.text} onChange={e => updateHistory(i, 'text', e.target.value)} />
                </div>
              ))}
            </div>

            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-5">
              <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">Program Pillar Cards</h3>
              {aboutForm.pillars.map((card, i) => (
                <div key={i} className="grid md:grid-cols-2 gap-3 pb-4 border-b border-slate-100 dark:border-white/5 last:border-0 last:pb-0">
                  <input className={inputClass} placeholder="Pillar Title" value={card.title} onChange={e => updatePillar(i, 'title', e.target.value)} />
                  <textarea className={`${inputClass} h-20 resize-none`} placeholder="Pillar Description" value={card.desc} onChange={e => updatePillar(i, 'desc', e.target.value)} />
                </div>
              ))}
            </div>

            <button disabled={saving} onClick={() => saveTab('about', aboutForm)} className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 flex items-center justify-center gap-2">
              <Save size={18} /> Save About Page
            </button>
          </div>
        )}

        {/* --- GENERAL INFO (CADET INFO) TAB --- */}
        {activeTab === 'cadet-info' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-5">
              <div>
                <label className={labelClass}>Mission Statement</label>
                <input className={inputClass} value={cadetInfoForm.missionText} onChange={e => setCadetInfoForm({ ...cadetInfoForm, missionText: e.target.value })} />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>JROTC Definition</label>
                  <input className={inputClass} value={cadetInfoForm.jrotcDefinition} onChange={e => setCadetInfoForm({ ...cadetInfoForm, jrotcDefinition: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>LET Definition</label>
                  <input className={inputClass} value={cadetInfoForm.letDefinition} onChange={e => setCadetInfoForm({ ...cadetInfoForm, letDefinition: e.target.value })} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Leadership Definition</label>
                <textarea className={`${inputClass} h-20 resize-none`} value={cadetInfoForm.leadershipDefinition} onChange={e => setCadetInfoForm({ ...cadetInfoForm, leadershipDefinition: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Cadet Creed (one line each)</label>
                <textarea className={`${inputClass} h-40 resize-none`} value={cadetInfoForm.cadetCreed} onChange={e => setCadetInfoForm({ ...cadetInfoForm, cadetCreed: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>11 Principles of Leadership (one per line)</label>
                <textarea className={`${inputClass} h-48 resize-none`} value={(cadetInfoForm.principles || []).join('\n')} onChange={e => setCadetInfoForm({ ...cadetInfoForm, principles: e.target.value.split('\n') })} />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-4">
              <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">Army Values</h3>
              {cadetInfoForm.armyValues.map((item, i) => (
                <div key={i} className="grid grid-cols-[50px_1fr_2fr] gap-3 items-center">
                  <input className={`${inputClass} text-center`} maxLength={1} value={item.l} onChange={e => updateArmyValue(i, 'l', e.target.value)} />
                  <input className={inputClass} placeholder="Value" value={item.v} onChange={e => updateArmyValue(i, 'v', e.target.value)} />
                  <input className={inputClass} placeholder="Description" value={item.d} onChange={e => updateArmyValue(i, 'd', e.target.value)} />
                </div>
              ))}
            </div>

            <button disabled={saving} onClick={() => saveTab('cadet-info', { ...cadetInfoForm, principles: linesToArray(cadetInfoForm.principles.join('\n')) })} className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 flex items-center justify-center gap-2">
              <Save size={18} /> Save General Info
            </button>
          </div>
        )}

        {/* --- PHOTOS TAB --- */}
        {activeTab === 'photos' && (
          <div className="space-y-6">
            <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-[11px] text-blue-700 dark:text-blue-300">
              <Info size={16} className="flex-shrink-0 mt-0.5" />
              Each album links to an external Google Photos URL. Cover images should be file paths from <code className="bg-blue-500/10 px-1 rounded">/public/covers/</code> (e.g. <code className="bg-blue-500/10 px-1 rounded">/covers/Yuletide2025.webp</code>).
            </div>

            <div className="space-y-4">
              {photosForm.albums.map((album, i) => (
                <div key={album.id ?? i} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black uppercase text-yellow-600 dark:text-yellow-500 tracking-widest">Album {i + 1}</span>
                    <button onClick={() => removeAlbum(i)} className="text-slate-400 hover:text-red-500 transition-colors" title="Remove album">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div>
                    <label className={labelClass}>Album Title</label>
                    <input className={inputClass} value={album.title} onChange={e => updateAlbum(i, 'title', e.target.value)} placeholder="e.g. Military Ball 2025-2026" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Photo Count</label>
                      <input className={inputClass} value={album.count} onChange={e => updateAlbum(i, 'count', e.target.value)} placeholder="e.g. 248 Photos" />
                    </div>
                    <div>
                      <label className={labelClass}>Cover Image Path</label>
                      <input className={inputClass} value={album.coverImage} onChange={e => updateAlbum(i, 'coverImage', e.target.value)} placeholder="/covers/filename.webp" />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Google Photos Album URL</label>
                    <input className={inputClass} value={album.albumUrl} onChange={e => updateAlbum(i, 'albumUrl', e.target.value)} placeholder="https://photos.app.goo.gl/…" />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addAlbum}
              className="w-full py-4 border-2 border-dashed border-slate-300 dark:border-white/10 rounded-2xl text-xs font-black uppercase text-slate-400 hover:border-yellow-500 hover:text-yellow-600 dark:hover:text-yellow-500 transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={14} /> Add Album
            </button>

            <button
              disabled={saving}
              onClick={() => saveTab('photos', photosForm)}
              className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save size={18} /> Save Photo Gallery
            </button>
          </div>
        )}

        {/* --- VISIBILITY TAB --- */}
        {activeTab === 'visibility' && (
          <div className="space-y-6">
            <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-[11px] text-blue-700 dark:text-blue-300">
              <Info size={16} className="flex-shrink-0 mt-0.5" />
              Hiding a page removes it from the navigation bar on the public site. The page URL still works — this is a nav-level control, not a security gate.
            </div>

            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 rounded-[2rem] space-y-3">
              <h3 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest mb-5">Public Navigation Links</h3>
              {Object.entries(PAGE_VISIBILITY_LABELS).map(([key, label]) => {
                const visible = visibilityForm[key] !== false;
                return (
                  <div key={key} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 dark:border-white/5 bg-slate-50 dark:bg-black/20 hover:border-yellow-500/30 transition-colors">
                    <div>
                      <p className="font-black uppercase text-sm text-slate-800 dark:text-slate-200">{label}</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">/{key}</p>
                    </div>
                    <button
                      onClick={() => setVisibilityForm({ ...visibilityForm, [key]: !visible })}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${
                        visible
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 hover:bg-green-500/20'
                          : 'bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-white/5 hover:border-yellow-500/30'
                      }`}
                    >
                      {visible ? <Eye size={14} /> : <EyeOff size={14} />}
                      {visible ? 'Visible' : 'Hidden'}
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await setDoc(doc(db, 'settings', 'pageVisibility'), visibilityForm);
                  showStatus('Visibility saved — live on the site now');
                } catch (err) {
                  console.error('Visibility save failed:', err);
                  showStatus('Save Failed');
                } finally {
                  setSaving(false);
                }
              }}
              className="w-full bg-yellow-500 text-slate-950 font-black uppercase py-5 rounded-2xl hover:bg-yellow-400 transition-all text-sm shadow-lg shadow-yellow-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save size={18} /> Save Visibility Settings
            </button>
          </div>
        )}

      </div>

      {/* STATUS TOAST */}
      <AnimatePresence>
        {status && (
          <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="fixed bottom-8 right-8 bg-yellow-500 text-slate-950 px-8 py-4 rounded-2xl font-black uppercase text-xs flex items-center gap-3 shadow-2xl z-[200]">
            <CheckCircle2 size={18} /> {status}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminContent;
