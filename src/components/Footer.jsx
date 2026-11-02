import React from 'react';
import { Link } from 'react-router-dom';
import { Shield, Mail, MapPin, ExternalLink, Instagram, Youtube, Phone } from 'lucide-react';

const PORTAL_VERSION = 'v1.8.111';

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#0a0c12] border-t border-white/5 mt-20">

      {/* ── Main grid ──────────────────────────────────────────────────────────── */}
      <div className="w-full px-8 md:px-14 lg:px-20 pt-16 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1.6fr] gap-12 lg:gap-16">

          {/* Col 1 — Branding */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Shield className="text-yellow-500 shrink-0" size={28} />
              <div>
                <h2 className="text-xl font-black uppercase italic tracking-tighter text-white leading-none">
                  PBHS <span className="text-yellow-500">JROTC</span>
                </h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em] mt-0.5">
                  Tornado Battalion
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-400 leading-relaxed italic max-w-xs">
              "To motivate young people to be better citizens."
            </p>

            <p className="text-xs font-black text-yellow-500 uppercase tracking-[0.25em]">
              Above and Beyond
            </p>

            <div className="flex gap-3">
              <a
                href="https://www.instagram.com/pbhs.battalion"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="PBHS JROTC on Instagram"
                className="p-2.5 bg-white/5 hover:bg-yellow-500/10 rounded-xl text-slate-400 hover:text-yellow-500 transition-all"
              >
                <Instagram size={17} />
              </a>
              <a
                href="https://www.youtube.com/@pbhsjrotc"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="PBHS JROTC on YouTube"
                className="p-2.5 bg-white/5 hover:bg-yellow-500/10 rounded-xl text-slate-400 hover:text-yellow-500 transition-all"
              >
                <Youtube size={17} />
              </a>
            </div>
          </div>

          {/* Col 2 — Resources */}
          <div>
            <h3 className="text-yellow-500 font-black uppercase text-[10px] tracking-[0.25em] mb-6">
              Resources
            </h3>
            <ul className="space-y-3.5">
              {[
                { name: 'Cadet Creed',              path: '/cadet-info' },
                { name: 'Rank Structure',            path: '/cadet-info' },
                { name: 'Promotion Study Guide',     path: '/promotion-board' },
                { name: 'Documents & Regulations',   path: '/documents' },
                { name: 'Recommend a Cadet',         path: '/recommend' },
              ].map(link => (
                <li key={link.name}>
                  <Link
                    to={link.path}
                    className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-2.5 group"
                  >
                    <span className="w-1 h-1 rounded-full bg-yellow-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3 — Battalion */}
          <div>
            <h3 className="text-yellow-500 font-black uppercase text-[10px] tracking-[0.25em] mb-6">
              Battalion
            </h3>
            <ul className="space-y-3.5">
              {[
                { name: 'Leadership',    path: '/leadership' },
                { name: 'Teams',         path: '/teams' },
                { name: 'Announcements', path: '/announcements' },
                { name: 'Events',        path: '/events' },
                { name: 'Photo Gallery', path: '/photos' },
              ].map(link => (
                <li key={link.name}>
                  <Link
                    to={link.path}
                    className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-2.5 group"
                  >
                    <span className="w-1 h-1 rounded-full bg-yellow-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 4 — Contact */}
          <div>
            <h3 className="text-yellow-500 font-black uppercase text-[10px] tracking-[0.25em] mb-6">
              Contact
            </h3>
            <div className="space-y-4 text-sm text-slate-400">
              <div className="flex items-start gap-3">
                <MapPin size={16} className="text-yellow-500 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  600 NE 13th Ave,<br />Pompano Beach, FL 33060
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Mail size={16} className="text-yellow-500 shrink-0" />
                <a href="mailto:info@pbhsjrotc.com" className="hover:text-white transition-colors">
                  info@pbhsjrotc.com
                </a>
              </div>
              <div className="flex items-center gap-3">
                <Phone size={16} className="text-yellow-500 shrink-0" />
                <a href="tel:+17543222000" className="hover:text-white transition-colors">
                  (754) 322-2000
                </a>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-white/5 px-8 md:px-14 lg:px-20 py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

          {/* Left — copyright + version */}
          <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <span>© {currentYear} PBHS JROTC Tornado Battalion</span>
            <span className="hidden md:block text-white/10">·</span>
            <span className="text-slate-600">Portal {PORTAL_VERSION}</span>
          </div>

          {/* Right — legal + external links */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Link to="/privacy" className="hover:text-yellow-500 transition-colors">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-yellow-500 transition-colors">
              Terms of Service
            </Link>
            <Link to="/admin" className="hover:text-yellow-500 transition-colors">
              Admin Portal
            </Link>
            <a
              href="https://pbhsjrotc.instatus.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-yellow-500 transition-colors"
            >
              System Status <ExternalLink size={9} />
            </a>
            <a
              href="https://www.usarmyjrotc.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
            >
              U.S. Army JROTC <ExternalLink size={9} />
            </a>
          </div>

        </div>
      </div>

    </footer>
  );
};

export default Footer;
