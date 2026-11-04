import React from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft, Home } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta';

const NotFound = () => {
  usePageMeta({
    title: 'Page Not Found',
    description: 'The page you are looking for could not be found.',
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6 font-sans">
      <div className="text-center max-w-lg">
        <Shield className="text-yellow-500 mx-auto mb-6" size={56} />
        <h1 className="text-7xl md:text-9xl font-black uppercase italic tracking-tighter text-white mb-2">
          404
        </h1>
        <h2 className="text-xl md:text-2xl font-black uppercase italic tracking-tight text-yellow-500 mb-4">
          Position Not Found
        </h2>
        <p className="text-slate-400 text-sm leading-relaxed mb-10">
          The page you're looking for doesn't exist or has moved. Check the address, or head back to friendly territory.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-yellow-500 text-slate-950 px-8 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-yellow-400 transition-all shadow-lg shadow-yellow-500/20"
          >
            <Home size={16} /> Back to Home
          </Link>
          <Link
            to="/events"
            className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-white px-8 py-4 rounded-xl font-black uppercase tracking-widest hover:bg-white/20 transition-all backdrop-blur-md"
          >
            <ArrowLeft size={16} /> View Events
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
