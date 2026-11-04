import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Menu, X, UserCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { getInitials } from '../utils/getInitials';
import { usePageVisibility } from '../hooks/usePageVisibility';

// Hoisted out of Navbar so it isn't recreated (and remounted, losing any
// state) on every Navbar render - takes currentPath as a prop instead of
// closing over it. Desktop link that hides itself on its own active page.
const NavLink = ({ to, currentPath, children }) => {
  if (to === currentPath) return null;
  return (
    <Link
      to={to}
      className="text-[11px] font-black uppercase tracking-[0.3em] transition-all duration-200
                 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:scale-105 active:scale-95"
    >
      {children}
    </Link>
  );
};

// Same reasoning as NavLink - hoisted, takes currentPath + onNavigate props
// instead of closing over Navbar's isActive/setIsOpen. Auto-closes the
// mobile menu on navigation via onNavigate.
const MobileNavLink = ({ to, currentPath, onNavigate, children, indent = false }) => {
  if (to === currentPath) return null;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`block py-3 text-xs font-black uppercase tracking-[0.2em] transition-colors
        ${indent ? 'pl-6 text-slate-400 border-l border-white/5 ml-2' : 'text-slate-200 hover:text-yellow-500'}`}
    >
      {children}
    </Link>
  );
};

const Navbar = () => {
  const location = useLocation();
  const currentPath = location.pathname;
  const [isOpen, setIsOpen] = useState(false);
  const { user, userData } = useAuth();
  const vis = usePageVisibility();

  // Mobile Dropdown Accordion States
  const [mobileCadetOpen, setMobileCadetOpen] = useState(false);
  const [mobileBattalionOpen, setMobileBattalionOpen] = useState(false);
  const [mobileQuizzesOpen, setMobileQuizzesOpen] = useState(false);

  // Desktop Dropdown States (for touchscreen compatibility — CSS hover doesn't fire on touch)
  const [desktopCadetOpen, setDesktopCadetOpen] = useState(false);
  const [desktopBattalionOpen, setDesktopBattalionOpen] = useState(false);
  const [desktopQuizzesOpen, setDesktopQuizzesOpen] = useState(false);

  // Close the mobile drawer (and any open accordions) whenever the route changes.
  // This is more reliable than relying solely on onClick — on real mobile devices,
  // touch events can cause React Router to navigate before the React synthetic
  // click event fires on the Link, leaving the drawer open. Watching location.pathname
  // guarantees closure regardless of how navigation was triggered.
  useEffect(() => {
    setIsOpen(false);
    setMobileCadetOpen(false);
    setMobileBattalionOpen(false);
    setMobileQuizzesOpen(false);
    setDesktopCadetOpen(false);
    setDesktopBattalionOpen(false);
    setDesktopQuizzesOpen(false);
  }, [location.pathname]);

  const isActive = (path) => currentPath === path;
  const closeMenu = () => setIsOpen(false);

  return (
    <nav className="fixed top-0 w-full z-50 h-16 transition-colors duration-300
                    bg-white/95 dark:bg-[#0a0c12]/95 backdrop-blur-sm 
                    border-b border-slate-200 dark:border-white/5 shadow-md dark:shadow-2xl">
      <div className="max-w-7xl mx-auto h-full flex items-center justify-between px-6">
        
        {/* LEFT SECTION: Logo & Primary Links */}
        <div className="flex items-center gap-10">
          {!isActive('/') ? (
            <Link to="/" onClick={() => setIsOpen(false)} className="flex items-center gap-3 group">
              <img src="/battalion-logo.png" alt="PBHS JROTC" className="w-10 h-10 object-contain group-hover:scale-110 transition-transform" />
              <span className="text-[12px] font-black uppercase tracking-[0.4em] text-slate-900 dark:text-white group-hover:text-yellow-500 transition">
                Home
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-3 opacity-40 cursor-default">
              <img src="/battalion-logo.png" alt="PBHS JROTC" className="w-10 h-10 object-contain" />
              <span className="text-[12px] font-black uppercase tracking-[0.4em] text-slate-900 dark:text-white">Home</span>
            </div>
          )}

          {/* DESKTOP LINKS */}
          <div className="hidden md:flex items-center gap-8">
            {vis.about && <NavLink to="/about" currentPath={currentPath}>About</NavLink>}

            {/* --- CADET INFO DROPDOWN (shows if any sub-item is visible) --- */}
            {(vis['cadet-info'] || vis['promotion-board'] || vis.uniform || vis.documents) && (
            <div className="relative group py-5">
              <div
                className="flex items-center gap-1 cursor-pointer"
                onClick={() => { setDesktopCadetOpen(o => !o); setDesktopBattalionOpen(false); setDesktopQuizzesOpen(false); }}
              >
                <span className={`text-[11px] font-black uppercase tracking-[0.3em] transition-colors
                  ${currentPath.includes('cadet') || currentPath === '/promotion-board'
                  ? 'text-yellow-500'
                  : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white'}`}>
                  Cadet Info
                </span>
                <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white" />
              </div>

              <div className={`absolute top-[100%] -left-4 w-56 p-2 rounded-xl transition-all duration-200
                              bg-white dark:bg-[#161923] border border-slate-200 dark:border-white/10 shadow-xl
                              ${desktopCadetOpen ? 'opacity-100 visible' : 'opacity-0 invisible group-hover:opacity-100 group-hover:visible'}`}>
                {vis['cadet-info'] && !isActive('/cadet-info') && (
                  <Link to="/cadet-info" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                    Cadet Info
                  </Link>
                )}
                {vis['promotion-board'] && !isActive('/promotion-board') && (
                  <Link to="/promotion-board" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                    Promotion Board
                  </Link>
                )}
                {vis.uniform && !isActive('/cadet-info/uniform') && (
                  <Link to="/cadet-info/uniform" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                    Uniform Guide
                  </Link>
                )}
                {vis.documents && !isActive('/documents') && (
                  <Link to="/documents" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors border-t border-slate-100 dark:border-white/5 mt-1 pt-3">
                    Documents & Regs
                  </Link>
                )}
              </div>
            </div>
            )}

            {/* --- BATTALION DROPDOWN (shows if any sub-item is visible) --- */}
            {(vis.announcements || vis.newsletter || vis.photos || vis.events || vis.leaderboard) && (
            <div className="relative group py-5">
              <div
                className="flex items-center gap-1 cursor-pointer text-slate-500 dark:text-slate-400"
                onClick={() => { setDesktopBattalionOpen(o => !o); setDesktopCadetOpen(false); setDesktopQuizzesOpen(false); }}
              >
                <span className={`text-[11px] font-black uppercase tracking-[0.3em] transition-colors
                  ${['/announcements', '/photos', '/events', '/leaderboard'].includes(currentPath) ? 'text-yellow-500' : 'group-hover:text-slate-900 dark:group-hover:text-white'}`}>
                  Battalion
                </span>
                <ChevronDown size={14} />
              </div>
              <div className={`absolute top-[100%] -left-4 w-56 p-2 rounded-xl transition-all duration-200
                              bg-white dark:bg-[#161923] border border-slate-200 dark:border-white/10 shadow-xl
                              ${desktopBattalionOpen ? 'opacity-100 visible' : 'opacity-0 invisible group-hover:opacity-100 group-hover:visible'}`}>
                {vis.announcements && !isActive('/announcements') && (
                  <Link to="/announcements" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">Announcements</Link>
                )}
                {vis.newsletter && !isActive('/newsletter') && (
                  <Link to="/newsletter" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">Newsletter</Link>
                )}
                {vis.events && !isActive('/events') && (
                  <Link to="/events" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">Calendar</Link>
                )}
                {vis.photos && !isActive('/photos') && (
                  <Link to="/photos" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">Photo Gallery</Link>
                )}
                {vis.leaderboard && !isActive('/leaderboard') && (
                  <Link to="/leaderboard" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">Battalion Board</Link>
                )}
              </div>
            </div>
            )}

            {/* --- QUIZZES DROPDOWN --- */}
            {vis.quizzes && (
            <div className="relative group py-5">
              <div
                className="flex items-center gap-1 cursor-pointer text-slate-500 dark:text-slate-400"
                onClick={() => { setDesktopQuizzesOpen(o => !o); setDesktopCadetOpen(false); setDesktopBattalionOpen(false); }}
              >
                <span className={`text-[11px] font-black uppercase tracking-[0.3em] transition-colors
                  ${currentPath.includes('/mindset-quiz') || currentPath.includes('/knowledge-quiz') || currentPath.includes('winning-colors')
                  ? 'text-yellow-500'
                  : 'group-hover:text-slate-900 dark:group-hover:text-white'}`}>
                  Quizzes
                </span>
                <ChevronDown size={14} />
              </div>
              <div className={`absolute top-[100%] -left-4 w-56 p-2 rounded-xl transition-all duration-200
                              bg-white dark:bg-[#161923] border border-slate-200 dark:border-white/10 shadow-xl
                              ${desktopQuizzesOpen ? 'opacity-100 visible' : 'opacity-0 invisible group-hover:opacity-100 group-hover:visible'}`}>
                {!isActive('/knowledge-quiz') && (
                  <Link to="/knowledge-quiz" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                    Promotion Board
                  </Link>
                )}
                {!isActive('/mindset-quiz') && (
                  <Link to="/mindset-quiz" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                    Mindset Quiz
                  </Link>
                )}
                {!isActive('/cadet-info/winning-colors') && (
                  <Link to="/cadet-info/winning-colors" className="block p-3 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                    Winning Colors
                  </Link>
                )}
              </div>
            </div>
            )}

            {vis.leadership && <NavLink to="/leadership" currentPath={currentPath}>Leadership</NavLink>}
            {vis.teams && <NavLink to="/teams" currentPath={currentPath}>Teams</NavLink>}
          </div>
        </div>

        {/* RIGHT SECTION: Admin Actions & Hamburger Toggle */}
        <div className="flex items-center gap-4">
          {user ? (
            <Link
              to="/admin/dashboard"
              onClick={() => setIsOpen(false)}
              title={userData?.fullName || 'Command Dashboard'}
              className="flex items-center gap-2 group"
            >
              <div className="w-8 h-8 rounded-full bg-yellow-500 text-slate-950 flex items-center justify-center text-[11px] font-black uppercase group-hover:scale-105 transition-transform overflow-hidden">
                {userData?.portrait ? (
                  <img src={userData.portrait} alt="" className="w-full h-full object-cover" />
                ) : (
                  getInitials(userData?.fullName) || <UserCircle size={20} />
                )}
              </div>
            </Link>
          ) : (
            !isActive('/admin') && (
              <Link
                to="/admin"
                onClick={() => setIsOpen(false)}
                className="text-[10px] font-black uppercase tracking-[0.2em] text-yellow-500 hover:bg-yellow-500 hover:text-slate-950 transition-all duration-300 border border-yellow-500/40 px-4 py-2 rounded-full"
              >
                Log In
              </Link>
            )
          )}

          {/* Hamburger Action Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 text-slate-600 dark:text-slate-300 hover:text-yellow-500 transition-colors md:hidden focus:outline-none"
            aria-label="Toggle Menu"
          >
            {isOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* --- HARDWARE-ACCELERATED MOBILE DRAWER OVERLAY --- */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute top-16 left-0 w-full bg-[#0a0c12] border-b border-white/10 shadow-2xl px-6 py-6 md:hidden max-h-[calc(100vh-4rem)] overflow-y-auto"
          >
            <div className="flex flex-col space-y-1">
              {vis.about && <MobileNavLink to="/about" currentPath={currentPath} onNavigate={closeMenu}>About</MobileNavLink>}

              {/* Mobile Cadet Accordion Node */}
              {(vis['cadet-info'] || vis['promotion-board'] || vis.uniform || vis.documents) && (
              <div className="py-2 border-b border-white/5">
                <button
                  onClick={() => setMobileCadetOpen(!mobileCadetOpen)}
                  className="w-full flex items-center justify-between text-xs font-black uppercase tracking-[0.2em] text-slate-200 py-1"
                >
                  <span>Cadet Info</span>
                  <ChevronDown size={14} className={`transform transition-transform duration-200 ${mobileCadetOpen ? 'rotate-180' : ''}`} />
                </button>
                {mobileCadetOpen && (
                  <div className="mt-2 space-y-1 bg-white/5 rounded-xl p-2">
                    {vis['cadet-info'] && <MobileNavLink to="/cadet-info" currentPath={currentPath} onNavigate={closeMenu} indent>Cadet Info</MobileNavLink>}
                    {vis['promotion-board'] && <MobileNavLink to="/promotion-board" currentPath={currentPath} onNavigate={closeMenu} indent>Promotion Board</MobileNavLink>}
                    {vis.uniform && <MobileNavLink to="/cadet-info/uniform" currentPath={currentPath} onNavigate={closeMenu} indent>Uniform Guide</MobileNavLink>}
                    {vis.documents && <MobileNavLink to="/documents" currentPath={currentPath} onNavigate={closeMenu} indent>Documents & Regs</MobileNavLink>}
                  </div>
                )}
              </div>
              )}

              {/* Mobile Battalion Accordion Node */}
              {(vis.announcements || vis.newsletter || vis.photos || vis.events || vis.leaderboard) && (
              <div className="py-2 border-b border-white/5">
                <button
                  onClick={() => setMobileBattalionOpen(!mobileBattalionOpen)}
                  className="w-full flex items-center justify-between text-xs font-black uppercase tracking-[0.2em] text-slate-200 py-1"
                >
                  <span>Battalion</span>
                  <ChevronDown size={14} className={`transform transition-transform duration-200 ${mobileBattalionOpen ? 'rotate-180' : ''}`} />
                </button>
                {mobileBattalionOpen && (
                  <div className="mt-2 space-y-1 bg-white/5 rounded-xl p-2">
                    {vis.announcements && <MobileNavLink to="/announcements" currentPath={currentPath} onNavigate={closeMenu} indent>Announcements</MobileNavLink>}
                    {vis.newsletter && <MobileNavLink to="/newsletter" currentPath={currentPath} onNavigate={closeMenu} indent>Newsletter</MobileNavLink>}
                    {vis.events && <MobileNavLink to="/events" currentPath={currentPath} onNavigate={closeMenu} indent>Calendar</MobileNavLink>}
                    {vis.photos && <MobileNavLink to="/photos" currentPath={currentPath} onNavigate={closeMenu} indent>Photo Gallery</MobileNavLink>}
                    {vis.leaderboard && <MobileNavLink to="/leaderboard" currentPath={currentPath} onNavigate={closeMenu} indent>Battalion Board</MobileNavLink>}
                  </div>
                )}
              </div>
              )}

              {/* Mobile Quizzes Accordion Node */}
              {vis.quizzes && (
              <div className="py-2 border-b border-white/5">
                <button
                  onClick={() => setMobileQuizzesOpen(!mobileQuizzesOpen)}
                  className="w-full flex items-center justify-between text-xs font-black uppercase tracking-[0.2em] text-slate-200 py-1"
                >
                  <span>Quizzes</span>
                  <ChevronDown size={14} className={`transform transition-transform duration-200 ${mobileQuizzesOpen ? 'rotate-180' : ''}`} />
                </button>
                {mobileQuizzesOpen && (
                  <div className="mt-2 space-y-1 bg-white/5 rounded-xl p-2">
                    <MobileNavLink to="/knowledge-quiz" currentPath={currentPath} onNavigate={closeMenu} indent>Promotion Board</MobileNavLink>
                    <MobileNavLink to="/mindset-quiz" currentPath={currentPath} onNavigate={closeMenu} indent>Mindset Quiz</MobileNavLink>
                    <MobileNavLink to="/cadet-info/winning-colors" currentPath={currentPath} onNavigate={closeMenu} indent>Winning Colors</MobileNavLink>
                  </div>
                )}
              </div>
              )}

              {vis.leadership && <MobileNavLink to="/leadership" currentPath={currentPath} onNavigate={closeMenu}>Leadership</MobileNavLink>}
              {vis.teams && <MobileNavLink to="/teams" currentPath={currentPath} onNavigate={closeMenu}>Teams</MobileNavLink>}

              <div className="pt-4 mt-2 border-t border-white/5">
                {user ? (
                  <MobileNavLink to="/admin/dashboard" currentPath={currentPath} onNavigate={closeMenu}>
                    {userData?.fullName || 'Command Dashboard'}
                  </MobileNavLink>
                ) : (
                  <MobileNavLink to="/admin" currentPath={currentPath} onNavigate={closeMenu}>Log In</MobileNavLink>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;