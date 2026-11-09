import React, { useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { multiFactor } from 'firebase/auth';
import { useAuth } from './hooks/useAuth';
import { useIdleLogout } from './hooks/useIdleLogout';
import { ROLE_HIERARCHY, STAFF_LEVEL, COMMAND_LEVEL, ADMIN_LEVEL } from './constants';
import { canAccessRoute } from './lib/authz';
import { ThemeProvider } from './contexts/ThemeContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { setAnalyticsAdminMode } from './firebase';

// --- COMPONENTS ---
// Navbar/Footer stay eager: they render on almost every route, so splitting
// them out would just add a network round-trip with no bundle-size upside.
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import CookieConsent from './components/CookieConsent';
import { Analytics } from '@vercel/analytics/react';
import AdminLayout from './components/AdminLayout';
import TosGate from './components/TosGate';

// --- PAGES ---
// Lazy-loaded so each route gets its own chunk instead of all ~30 pages
// (Firestore admin dashboards, uniform logistics, stats, etc.) shipping in
// one ~1MB bundle to every visitor regardless of which page they actually
// open. Home stays eager since it's the page nearly everyone lands on first
// and there's no benefit to a loading flash on the very first paint.
import Home from './pages/Home';
const NotFound = lazy(() => import('./pages/NotFound'));
const SignUp = lazy(() => import('./pages/SignUp'));
const Photos = lazy(() => import('./pages/Photos'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const CadetInfo = lazy(() => import('./pages/CadetInfo'));
const Teams = lazy(() => import('./pages/Teams'));
const Announcements = lazy(() => import('./pages/Announcements'));
const PromotionBoard = lazy(() => import('./pages/PromotionBoard'));
const Leadership = lazy(() => import('./pages/Leadership'));
const AdminAnnouncements = lazy(() => import('./pages/AdminAnnouncements'));
const UniformRequests = lazy(() => import('./pages/UniformRequests'));
const CommanderInfo = lazy(() => import('./pages/CommanderInfo'));
const AdminTeams = lazy(() => import('./pages/AdminTeams'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminLeadership = lazy(() => import('./pages/AdminLeadership'));
const AdminContent = lazy(() => import('./pages/AdminContent'));
const Documents = lazy(() => import('./pages/Documents'));
const AdminDocuments = lazy(() => import('./pages/AdminDocuments'));
const AdminCamps = lazy(() => import('./pages/AdminCamps'));
const AdminStats = lazy(() => import('./pages/AdminStats'));
const AdminCompanies = lazy(() => import('./pages/AdminCompanies'));
const AdminPhotos = lazy(() => import('./pages/AdminPhotos'));
const MyProfile = lazy(() => import('./pages/MyProfile'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const WinningColors  = lazy(() => import('./pages/WinningColors'));
const UniformGuide   = lazy(() => import('./pages/UniformGuide'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const HowToJoin = lazy(() => import('./pages/HowToJoin'));
const AdminWelcome = lazy(() => import('./pages/AdminWelcome'));
const Newsletters = lazy(() => import('./pages/Newsletters'));
const AdminNewsletters = lazy(() => import('./pages/AdminNewsletters'));
const AdminCadetChallenge = lazy(() => import('./pages/AdminCadetChallenge'));
const AdminLeaderboard    = lazy(() => import('./pages/AdminLeaderboard'));
const AdminRoster         = lazy(() => import('./pages/AdminRoster'));
const AdminS2             = lazy(() => import('./pages/AdminS2'));
const AdminS6             = lazy(() => import('./pages/AdminS6'));
const AdminFundraiser     = lazy(() => import('./pages/AdminFundraiser'));
const AdminUniformSizes   = lazy(() => import('./pages/AdminUniformSizes'));
const AdminS1             = lazy(() => import('./pages/AdminS1'));
const AdminMeetingLogs    = lazy(() => import('./pages/AdminMeetingLogs'));
const AdminAARLogs        = lazy(() => import('./pages/AdminAARLogs'));
const AdminEvents         = lazy(() => import('./pages/AdminEvents'));
const AdminFeedback       = lazy(() => import('./pages/AdminFeedback'));
const AdminHonorCompany   = lazy(() => import('./pages/AdminHonorCompany'));
const AdminLog            = lazy(() => import('./pages/AdminLog'));
const AdminSupplyRequests = lazy(() => import('./pages/AdminSupplyRequests'));
const AdminCadetHistory   = lazy(() => import('./pages/AdminCadetHistory'));
const AdminChangelog           = lazy(() => import('./pages/AdminChangelog'));
const AdminLeadershipCalendar  = lazy(() => import('./pages/AdminLeadershipCalendar'));
const AdminParticipation  = lazy(() => import('./pages/AdminParticipation'));
const AdminS5             = lazy(() => import('./pages/AdminS5'));
const AdminStaff          = lazy(() => import('./pages/AdminStaff'));
const AdminProgramsHub    = lazy(() => import('./pages/AdminProgramsHub'));
const AdminLogsHub        = lazy(() => import('./pages/AdminLogsHub'));
const AdminPublishingHub  = lazy(() => import('./pages/AdminPublishingHub'));
const AdminRosterHub      = lazy(() => import('./pages/AdminRosterHub'));
const AdminPersonnelHub   = lazy(() => import('./pages/AdminPersonnelHub'));
const AdminCadetProfile   = lazy(() => import('./pages/AdminCadetProfile'));
const RecommendRibbon     = lazy(() => import('./pages/RecommendRibbon'));
const MindsetQuiz         = lazy(() => import('./pages/MindsetQuiz'));
const KnowledgeQuiz       = lazy(() => import('./pages/KnowledgeQuiz'));
const CadetPortal         = lazy(() => import('./pages/CadetPortal'));
const AdminServiceHours   = lazy(() => import('./pages/AdminServiceHours'));
const AdminAttendance     = lazy(() => import('./pages/AdminAttendance'));
const AdminScholarshipBoard = lazy(() => import('./pages/AdminScholarshipBoard'));
const AdminAchievementWall  = lazy(() => import('./pages/AdminAchievementWall'));
const AdminAFIPrep          = lazy(() => import('./pages/AdminAFIPrep'));
const AdminTeamsPrivate     = lazy(() => import('./pages/AdminTeamsPrivate'));

const RouteFallback = () => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500"></div>
  </div>
);

// Command roles whose operational scope doesn't extend to portal-management
// pages (S2/S6 tools, media, leadership board, customization). Mirrors the
// same constant in AdminSidebar — kept in sync manually.
const RESTRICTED_CMD = ['sergeant_major', 'battalion_commander', 'battalion_csm'];

const ProtectedRoute = ({ children, minLevel, allowedRoles, excludedRoles }) => {
  const { user, role, userData, loading } = useAuth();
  const location = useLocation();

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500"></div>
    </div>
  );

  if (!user) return <Navigate to="/admin" />;

  // Approval gate: account must be approved by staff before accessing any portal page.
  // approved is set to false on signup and flipped to true when an admin approves the account.
  // Absent field (undefined) = existing account = treated as approved.
  if (userData && userData.approved === false) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="mb-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-1">PBHS</p>
          <h1 className="text-2xl font-black uppercase italic tracking-tighter text-white">
            Battalion <span className="text-yellow-500">Portal</span>
          </h1>
        </div>
        <div className="w-full max-w-xs bg-slate-900 border border-white/5 rounded-3xl p-6 shadow-2xl space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
          </div>
          <div>
            <h2 className="text-xl font-black uppercase italic tracking-tight text-white mb-2">Pending Approval</h2>
            <p className="text-xs text-slate-400 font-medium leading-relaxed">
              Your account is awaiting approval from a staff instructor. You will receive an email once your account is approved.
            </p>
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Above and Beyond</p>
        </div>
      </div>
    );
  }

  const userLevel = ROLE_HIERARCHY[role] || 0;

  // Onboarding gate: newly approved accounts must complete email verification
  // and 2FA setup before accessing any other route. Only triggers on explicit
  // false (new accounts set this on approval) — absent field = existing account,
  // treated as complete so no disruption to anyone already using the portal.
  if (userData?.onboardingComplete === false && location.pathname !== '/admin/welcome') {
    return <Navigate to="/admin/welcome" replace />;
  }

  // TOS gate: every authenticated user must accept Terms of Service before
  // accessing any portal page. New users handle this during the onboarding
  // wizard (where finishOnboarding also writes tosAccepted:true), so the gate
  // only triggers once onboarding is complete (onboardingComplete !== false).
  // We also skip it on /admin/welcome itself to avoid a double-block.
  if (userData?.tosAccepted !== true && location.pathname !== '/admin/welcome') {
    return <TosGate userData={userData} />;
  }

  // allowedRoles isolates specific roles (e.g. S5/S6) that a level threshold
  // can't express on its own, since they're tied with every other S-role at
  // STAFF_LEVEL. Top command can always override, same as everywhere else.
  // excludedRoles denies specific roles even if they meet the level threshold.
  if (!canAccessRoute({ userLevel, role, minLevel, allowedRoles, adminLevel: ADMIN_LEVEL, excludedRoles })) {
    return <Navigate to="/admin/dashboard" />;
  }

  // Legacy MFA gate: applies to staff-level accounts that existed before the
  // onboarding wizard was introduced (no onboardingComplete field). New accounts
  // handle 2FA through the welcome wizard above and won't hit this.
  if (
    userLevel >= STAFF_LEVEL &&
    userData?.onboardingComplete !== false &&
    location.pathname !== '/admin/profile' &&
    multiFactor(user).enrolledFactors.length === 0
  ) {
    return <Navigate to="/admin/profile?mfa=required" replace />;
  }

  return children;
};

const AppContent = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  // Pass uid so the hook can check the trusted-device token for this user.
  useIdleLogout(!!user, user?.uid);

  // React Router doesn't reset scroll position on navigation like a full
  // page load would - without this, clicking a link (e.g. in the footer,
  // far down the page) lands on the new page still scrolled to wherever
  // you were, instead of at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Disable GA collection on every /admin/* route, re-enable on public pages.
  // No-ops if analytics hasn't loaded yet (user hasn't accepted cookies).
  useEffect(() => {
    setAnalyticsAdminMode(location.pathname.startsWith('/admin'));
  }, [location.pathname]);

  // Logic to hide Navbar and Footer on Admin pages
  const isAdminPage = location.pathname.startsWith('/admin') || location.pathname === '/uniform-requests';

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-yellow-500"></div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen">
      {/* SHOW NAVBAR ONLY ON PUBLIC PAGES */}
      {!isAdminPage && <Navbar />}
      
      {/* MAIN CONTENT AREA - flex-grow ensures footer stays at bottom */}
      <main className="flex-grow">
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* --- PUBLIC ROUTES --- */}
          <Route path="/" element={<Home />} />
          <Route path="/photos" element={<Photos />} />
          <Route path="/cadet-info" element={<CadetInfo />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/promotion-board" element={<PromotionBoard />} />
          <Route path="/leadership" element={<Leadership />} />
          <Route path="/commander/:id" element={<CommanderInfo />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/signup" element={<SignUp />} />
          {/* Welcome/onboarding wizard — no sidebar, accessible to any signed-in user */}
          <Route path="/admin/welcome" element={<ProtectedRoute><AdminWelcome /></ProtectedRoute>} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/leaderboard" element={<AdminLeaderboard />} />
          {/* Safety-net redirect: Home.jsx hero used "/About" (capital A) which
              React Router v6 treats as a distinct path — this catches any
              bookmarks or links still using the old casing. */}
          <Route path="/About" element={<Navigate to="/about" replace />} />
          <Route path="/events" element={<CalendarPage />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/newsletter" element={<Newsletters />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/cadet-info/winning-colors" element={<WinningColors />} />
          <Route path="/cadet-info/uniform"        element={<UniformGuide />} />
          <Route path="/how-to-join" element={<HowToJoin />} />
          <Route path="/recommend" element={<RecommendRibbon />} />
          <Route path="/mindset-quiz" element={<MindsetQuiz />} />
          <Route path="/knowledge-quiz" element={<KnowledgeQuiz />} />

          {/* --- PROTECTED ADMIN ROUTES (wrapped in AdminLayout for persistent sidebar) --- */}
          {/* AdminLayout is a pathless layout route that renders <AdminSidebar /> +
              <Outlet /> so the sidebar appears on every admin page automatically.
              /admin (login) and /admin/signup are outside this wrapper on purpose —
              those pages don't need the authenticated sidebar. */}
          <Route element={<AdminLayout />}>
            <Route path="/admin/dashboard" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
            {/* Gated: S4 assistants, company command (CC/XO/1SG), S4 logistics,
                and battalion command (adminLevel override). All lower tiers are
                redirected — cadets, squad/platoon leadership don't have access. */}
            {/* Uniform Items: any signed-in user can open this page;
                full request/approve flow gated inside the component by role. */}
            <Route path="/uniform-requests" element={
              <ProtectedRoute>
                <UniformRequests />
              </ProtectedRoute>
            } />

            {/* --- ANNOUNCEMENTS (ADMIN) --- */}
            {/* Company command (45+) see company section; S5/S6/admin also see global broadcast */}
            <Route
              path="/admin/announcements"
              element={
                <ProtectedRoute minLevel={COMMAND_LEVEL}>
                  <AdminAnnouncements />
                </ProtectedRoute>
              }
            />

            {/* Individual Cadet Profile (company staff 35+) */}
            <Route
              path="/admin/personnel/:rosterDocId"
              element={
                <ProtectedRoute minLevel={35} allowedRoles={['company_s1_assistant', 'company_s2_assistant', 'company_s3_assistant', 'company_s4_assistant', 'company_s5_assistant', 'company_s6_assistant', 'company_s7_assistant']}>
                  <AdminCadetProfile />
                </ProtectedRoute>
              }
            />

            {/* Personnel Hub: Roster · Cadet History · Accounts · Cadet Challenge */}
            <Route
              path="/admin/personnel"
              element={
                <ProtectedRoute minLevel={COMMAND_LEVEL} allowedRoles={['company_s1_assistant', 'company_s3_assistant']}>
                  <AdminPersonnelHub />
                </ProtectedRoute>
              }
            />
            {/* Legacy personnel routes → Personnel Hub */}
            <Route path="/admin/users" element={<Navigate to="/admin/personnel?tab=accounts" replace />} />

            {/* Legacy teams route → Publishing Hub */}
            <Route path="/admin/teams" element={<Navigate to="/admin/publishing?tab=teams" replace />} />

            {/* Publishing Hub: Leadership · Content · Documents · Newsletters ·
                Photo Gallery · Battalion Stats · Customization */}
            <Route
              path="/admin/publishing"
              element={
                <ProtectedRoute allowedRoles={[
                  's5_public_affairs', 's6_technology',
                ]} excludedRoles={RESTRICTED_CMD} minLevel={STAFF_LEVEL}>
                  <AdminPublishingHub />
                </ProtectedRoute>
              }
            />
            {/* Legacy publishing routes → Publishing Hub */}
            <Route path="/admin/leadership"  element={<Navigate to="/admin/publishing?tab=leadership"  replace />} />
            <Route path="/admin/content"     element={<Navigate to="/admin/publishing?tab=content"     replace />} />
            <Route path="/admin/documents"   element={<Navigate to="/admin/publishing?tab=documents"   replace />} />
            <Route path="/admin/newsletters" element={<Navigate to="/admin/publishing?tab=newsletters" replace />} />
            <Route path="/admin/photos"      element={<Navigate to="/admin/publishing?tab=photos"      replace />} />

            {/* Programs Hub → Staff Hub S1 */}
            <Route path="/admin/programs"      element={<Navigate to="/admin/staff?tab=s1" replace />} />
            <Route path="/admin/camps"         element={<Navigate to="/admin/staff?tab=s1" replace />} />
            <Route path="/admin/participation" element={<Navigate to="/admin/staff?tab=s1" replace />} />

            <Route path="/admin/stats" element={<Navigate to="/admin/staff?tab=s6" replace />} />

            <Route path="/admin/leaderboard" element={<ProtectedRoute><AdminLeaderboard /></ProtectedRoute>} />

            {/* Legacy routes → Personnel Hub */}
            <Route path="/admin/cadet-challenge" element={<Navigate to="/admin/personnel?tab=challenge" replace />} />
            <Route path="/admin/roster-hub"      element={<Navigate to="/admin/personnel?tab=roster"    replace />} />
            <Route path="/admin/roster"          element={<Navigate to="/admin/personnel?tab=roster"    replace />} />
            <Route path="/admin/cadet-history"   element={<Navigate to="/admin/personnel?tab=history"   replace />} />

            {/* Legacy staff routes — redirect to unified Staff Hub */}
            <Route path="/admin/s2"      element={<Navigate to="/admin/staff?tab=s2" replace />} />
            <Route path="/admin/s5-shop" element={<Navigate to="/admin/staff?tab=s5" replace />} />
            <Route path="/admin/s6"      element={<Navigate to="/admin/staff?tab=s6" replace />} />

            {/* Fundraiser Tracking — Fallen Heroes: every authenticated portal user can
                reach this route; the component itself handles the split between full
                access (transactions + roster) and personal view (own entries only). */}
            <Route
              path="/admin/fundraiser"
              element={
                <ProtectedRoute>
                  <AdminFundraiser />
                </ProtectedRoute>
              }
            />

            {/* Uniform Sizes: any signed-in user can open this page;
                full input/finalize flow gated inside the component by role. */}
            <Route
              path="/admin/uniform-sizes"
              element={
                <ProtectedRoute>
                  <AdminUniformSizes />
                </ProtectedRoute>
              }
            />

            {/* No minLevel here: every signed-in user manages their own profile */}
            <Route path="/admin/profile" element={<ProtectedRoute><MyProfile /></ProtectedRoute>} />

            {/* Legacy companies route → Publishing Hub Customization tab */}
            <Route path="/admin/companies" element={<Navigate to="/admin/publishing?tab=companies" replace />} />

            {/* Legacy S1 route → Staff Hub */}
            <Route path="/admin/s1" element={<Navigate to="/admin/staff?tab=s1" replace />} />

            {/* Unified Staff Hub: S1 · S2 · S4 · S5 · S6 tabs; component gates per-tab access. */}
            <Route
              path="/admin/staff"
              element={
                <ProtectedRoute minLevel={5}>
                  <AdminStaff />
                </ProtectedRoute>
              }
            />

            {/* Legacy log routes → Staff Hub */}
            <Route path="/admin/logs"         element={<Navigate to="/admin/staff?tab=s1" replace />} />
            <Route path="/admin/meeting-logs" element={<Navigate to="/admin/staff?tab=s1" replace />} />
            <Route path="/admin/aar-logs"     element={<Navigate to="/admin/staff?tab=s3" replace />} />

            {/* Calendar Events → Staff Hub S3 */}
            <Route path="/admin/events" element={<Navigate to="/admin/staff?tab=s3" replace />} />

            {/* Legacy feedback route → Staff Hub S6 */}
            <Route path="/admin/feedback" element={<Navigate to="/admin/staff?tab=s6" replace />} />

            {/* Honor Company → Staff Hub S3 */}
            <Route path="/admin/honor-company" element={<Navigate to="/admin/staff?tab=s3" replace />} />

            {/* Leadership Calendar — dedicated route for L45+ command leadership */}
            <Route
              path="/admin/leadership-calendar"
              element={
                <ProtectedRoute minLevel={COMMAND_LEVEL}>
                  <AdminLeadershipCalendar />
                </ProtectedRoute>
              }
            />


            {/* Legacy activity log route → Staff Hub S6 */}
            <Route path="/admin/log" element={<Navigate to="/admin/staff?tab=s6" replace />} />
            {/* Company Leadership+ can submit; admin can approve/deny/fulfill */}
            <Route
              path="/admin/supply-requests"
              element={
                <ProtectedRoute minLevel={COMMAND_LEVEL}>
                  <AdminSupplyRequests />
                </ProtectedRoute>
              }
            />

            {/* Version History — read-only, open to every authenticated portal user */}
            <Route
              path="/admin/changelog"
              element={<ProtectedRoute><AdminChangelog /></ProtectedRoute>}
            />

            {/* Cadet Record Portal — personal dashboard for all approved users */}
            <Route
              path="/admin/my"
              element={<ProtectedRoute><CadetPortal /></ProtectedRoute>}
            />

            {/* Service Hours — all cadets can submit; staff 70+ can review */}
            <Route
              path="/admin/service-hours"
              element={<ProtectedRoute><AdminServiceHours /></ProtectedRoute>}
            />

            {/* Attendance — events/practices/meetings (NOT class attendance) */}
            <Route
              path="/admin/attendance"
              element={<ProtectedRoute minLevel={COMMAND_LEVEL}><AdminAttendance /></ProtectedRoute>}
            />

            {/* Scholarship & Opportunity Board — all cadets view; staff 70+ post */}
            <Route
              path="/admin/scholarships"
              element={<ProtectedRoute><AdminScholarshipBoard /></ProtectedRoute>}
            />

            {/* Achievement Wall — all cadets view; staff 70+ post/hide */}
            <Route
              path="/admin/achievements"
              element={<ProtectedRoute><AdminAchievementWall /></ProtectedRoute>}
            />

            {/* AFI Prep Tool — command 45+ edit; staff 70+ create sessions */}
            <Route
              path="/admin/afi-prep"
              element={<ProtectedRoute minLevel={COMMAND_LEVEL}><AdminAFIPrep /></ProtectedRoute>}
            />

            {/* Teams Private — internal roster, competition results, notes */}
            <Route
              path="/admin/teams-private"
              element={<ProtectedRoute minLevel={COMMAND_LEVEL}><AdminTeamsPrivate /></ProtectedRoute>}
            />
          </Route>

          {/* CATCH ALL - was a silent redirect to Home; now a real 404 page.
              Note: since this is a client-side SPA with a Vercel rewrite
              serving index.html for every unmatched path, the HTTP response
              itself is still a 200, not a true 404 status code - that's an
              inherent limitation of this hosting architecture without a
              server-side/edge function, not something this route can fix. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>

      {/* SHOW FOOTER ONLY ON PUBLIC PAGES */}
      {!isAdminPage && <Footer />}

      <CookieConsent />
      <Analytics />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <ConfirmProvider>
        <Router>
          <div className="bg-slate-50 dark:bg-slate-950 min-h-screen font-sans text-slate-900 dark:text-white">
            <AppContent />
          </div>
        </Router>
      </ConfirmProvider>
    </ThemeProvider>
  );
}