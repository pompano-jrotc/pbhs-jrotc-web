import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Download, File, ImageIcon, X, ZoomIn } from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { DocumentRowSkeleton } from '../components/Skeleton';
import { usePageMeta } from '../hooks/usePageMeta';
import Reveal from '../components/Reveal';

const formatBytes = (bytes) => {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

const isWebp = (d) =>
  d.fileName?.toLowerCase().endsWith('.webp') || d.fileUrl?.includes('/image/upload/');

// Raw Cloudinary uploads require admin-signed URLs due to account access control;
// proxy through our Vercel function which generates a 1-hour signed link.
const docHref = (url) =>
  url?.includes('/raw/upload/')
    ? `/api/cloudinary-sign?download=1&url=${encodeURIComponent(url)}`
    : url;

// Force Cloudinary to serve the file as a download attachment (for WebP images)
const toDownloadUrl = (url) => url?.replace('/upload/', '/upload/fl_attachment/') ?? url;

const Documents = () => {
  usePageMeta({
    title: 'Documents & Regulations',
    description: 'Published reference documents and regulations for PBHS JROTC Tornado Battalion.',
    path: '/documents',
  });
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  const closeLightbox = useCallback(() => setLightbox(null), []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, closeLightbox]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "documents"), (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => {
        if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder;
        if (a.sortOrder != null) return -1;
        if (b.sortOrder != null) return 1;
        return (b.uploadedAt?.seconds || 0) - (a.uploadedAt?.seconds || 0);
      });
      setDocuments(docs);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsubscribe();
  }, []);

  const grouped = documents.reduce((acc, doc) => {
    const cat = doc.category || 'Other';
    (acc[cat] = acc[cat] || []).push(doc);
    return acc;
  }, {});

  return (
    <div className="min-h-screen transition-colors duration-300 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-sans selection:bg-yellow-500/30">

      {/* Hero Section */}
      <div className="relative h-[40vh] flex items-center justify-center overflow-hidden border-b border-slate-200 dark:border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-yellow-500/10 via-transparent to-transparent opacity-50" />
        <div className="z-10 text-center px-6">
          <h1 className="text-5xl md:text-7xl font-black uppercase italic tracking-tighter">
            <span className="text-yellow-500">Documents</span> & Regs
          </h1>
          <p className="text-slate-500 font-bold uppercase tracking-[0.4em] mt-4 text-xs md:text-sm">
            Battalion Reference Library
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-20">
        {loading && (
          <div className="space-y-4">
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
          </div>
        )}

        {!loading && documents.length === 0 && (
          <div className="text-center py-20">
            <FileText className="mx-auto text-slate-300 dark:text-slate-700 mb-4" size={48} />
            <p className="text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest text-sm">
              No documents published yet
            </p>
          </div>
        )}

        <div className="space-y-16">
          {Object.entries(grouped).map(([category, docs], i) => (
            <Reveal key={category} delay={i * 0.08}>
            <section>
              <h2 className="text-2xl font-black uppercase italic border-l-4 border-yellow-500 pl-6 mb-6">
                {category}
              </h2>
              <div className="grid gap-4">
                {docs.map(d => isWebp(d) ? (
                  <div
                    key={d.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl shadow-sm dark:shadow-none hover:border-yellow-500/50 transition-all overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setLightbox(d)}
                      className="w-full group relative block focus:outline-none"
                      aria-label={`View ${d.title} full size`}
                    >
                      <img
                        src={d.fileUrl}
                        alt={d.title}
                        className="w-full max-h-96 object-contain bg-slate-100 dark:bg-slate-800"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                        <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transition-all drop-shadow-lg" size={36} />
                      </div>
                    </button>
                    <div className="p-5 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-black uppercase italic truncate">{d.title}</p>
                        {d.description && (
                          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 line-clamp-2">{d.description}</p>
                        )}
                        {d.fileSize && (
                          <p className="text-slate-400 dark:text-slate-600 text-[10px] font-bold uppercase tracking-widest mt-1 flex items-center gap-1.5">
                            <ImageIcon size={11} /> {formatBytes(d.fileSize)}
                          </p>
                        )}
                      </div>
                      <a
                        href={toDownloadUrl(d.fileUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Download image"
                        className="p-3 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-slate-950 rounded-xl transition-all flex-shrink-0"
                      >
                        <Download size={18} />
                      </a>
                    </div>
                  </div>
                ) : (
                  <a
                    key={d.id}
                    href={docHref(d.fileUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 p-6 rounded-3xl flex items-center justify-between gap-4 shadow-sm dark:shadow-none hover:border-yellow-500/50 transition-all group"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="bg-yellow-500/10 text-yellow-500 p-3 rounded-xl flex-shrink-0">
                        <File size={22} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-black uppercase italic truncate">{d.title}</p>
                        {d.description && (
                          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1 line-clamp-2">{d.description}</p>
                        )}
                        {d.fileSize && (
                          <p className="text-slate-400 dark:text-slate-600 text-[10px] font-bold uppercase tracking-widest mt-1">{formatBytes(d.fileSize)}</p>
                        )}
                      </div>
                    </div>
                    <Download className="text-slate-400 group-hover:text-yellow-500 transition-colors flex-shrink-0" size={20} />
                  </a>
                ))}
              </div>
            </section>
            </Reveal>
          ))}
        </div>
      </div>
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[500] flex items-center justify-center bg-black/90 p-4"
          onClick={closeLightbox}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-xl transition-all"
            aria-label="Close"
          >
            <X size={24} />
          </button>
          <img
            src={lightbox.fileUrl}
            alt={lightbox.title}
            className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur-sm px-5 py-3 rounded-2xl">
            <p className="text-white font-black uppercase italic text-sm">{lightbox.title}</p>
            <a
              href={toDownloadUrl(lightbox.fileUrl)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="p-2 bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500 hover:text-slate-950 rounded-lg transition-all"
              title="Download"
            >
              <Download size={16} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default Documents;
