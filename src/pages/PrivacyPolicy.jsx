import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta';

const EFFECTIVE_DATE = "August 22, 2026";

const Section = ({ n, title, children }) => (
  <section className="mb-12">
    <h2 className="text-xl font-black uppercase italic tracking-tighter mb-4 flex items-baseline gap-3">
      <span className="text-yellow-500">{n}.</span> {title}
    </h2>
    <div className="space-y-4 text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
      {children}
    </div>
  </section>
);

const PrivacyPolicy = () => {
  usePageMeta({
    title: 'Privacy Policy',
    description: 'Privacy policy for the PBHS JROTC Tornado Battalion website.',
    path: '/privacy',
  });
  return (
    <div className="min-h-screen transition-colors duration-300 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-sans">

      {/* Hero */}
      <div className="relative py-20 flex items-center justify-center overflow-hidden border-b border-slate-200 dark:border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-yellow-500/10 via-transparent to-transparent opacity-50" />
        <div className="z-10 text-center px-6">
          <Link to="/" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-900 dark:hover:text-white mb-6 text-xs font-black uppercase tracking-widest transition-all">
            <ArrowLeft size={14} /> Back to Command
          </Link>
          <h1 className="text-4xl md:text-6xl font-black uppercase italic tracking-tighter flex items-center justify-center gap-4">
            <ShieldCheck className="text-yellow-500" size={40} /> Privacy Policy
          </h1>
          <p className="text-slate-500 font-bold uppercase tracking-[0.3em] mt-4 text-xs">
            Effective {EFFECTIVE_DATE}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-16">

        <div className="mb-12 p-5 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          This site is an independent student project built for the PBHS JROTC Tornado Battalion and is not
          officially operated by Broward County Public Schools, Pompano Beach High School, or U.S. Army
          Cadet Command. This policy explains what information the site collects, how it's used, and
          how to request that your information be corrected or removed.
        </div>

        <Section n="1" title="Information We Collect">
          <p><strong className="text-slate-900 dark:text-white">Account information</strong> you provide when you register: full name, email address, phone number, and password (your password is hashed by our authentication provider and is never stored or visible in plain text).</p>
          <p><strong className="text-slate-900 dark:text-white">Battalion and personnel information:</strong> rank, position, company, platoon, squad, and LET level — used to route you to the correct roster, tasks, and orders relevant to your role.</p>
          <p><strong className="text-slate-900 dark:text-white">Physical measurements:</strong> uniform sizes (shirt, pants, boot, beret) collected for supply logistics. This information is visible only to battalion staff and supply officers.</p>
          <p><strong className="text-slate-900 dark:text-white">Athletic and fitness performance data:</strong> scores from the Cadet Challenge physical fitness assessment, stored per cadet across multiple cycles. Access is restricted to company leadership and above.</p>
          <p><strong className="text-slate-900 dark:text-white">Fundraiser participation data:</strong> records of flags sold and weekly progress for the Fallen Heroes Fundraiser, tied to individual cadets and their position requirements.</p>
          <p><strong className="text-slate-900 dark:text-white">Promotion and evaluation data:</strong> promotion board scores submitted by company executive officers and reviewed by S1 staff. Access is restricted to battalion staff and instructors.</p>
          <p><strong className="text-slate-900 dark:text-white">Operational records:</strong> supply requests, meeting logs, task assignments, and camp attendance associated with your account and role.</p>
          <p><strong className="text-slate-900 dark:text-white">Photos and documents</strong> battalion staff upload for leadership profiles, the photo gallery, or the documents library.</p>
          <p><strong className="text-slate-900 dark:text-white">Usage data</strong> — only if you accept cookies — such as general device/browser information and which public pages were visited, collected through Google Analytics. Analytics are never collected on password-protected admin pages.</p>
        </Section>

        <Section n="2" title="How We Use Your Information">
          <p>To create and manage your account, show you the duties, orders, and announcements relevant to your role, and route battalion-wide administrative functions (rosters, fundraiser tracking, supply requests, promotion boards, fitness records).</p>
          <p>To send account-related emails: signup confirmation, welcome notification, password reset, login-email change notices, and uniform-issuance notifications.</p>
          <p>To maintain accurate operational records for the Tornado Battalion, including year-end cadet history archives.</p>
          <p>To keep the site secure — for example, verifying you're not a bot during signup, and detecting suspicious account activity.</p>
          <p>We do not sell your information, use it for advertising, or share it with any third party for commercial purposes.</p>
        </Section>

        <Section n="3" title="Student Data & Applicable Laws">
          <p>This site is used by JROTC cadets, the majority of whom are minors enrolled in a K-12 school program. As a result, several student data protection laws apply or inform how we operate:</p>
          <p><strong className="text-slate-900 dark:text-white">Florida Student Data Privacy Act (§ 1002.222, F.S.):</strong> Florida law restricts operators of websites used by K-12 students from using student data for non-educational purposes. We comply with this: student data collected by this site is used solely to support Tornado Battalion operations. We do not use it for targeted advertising, commercial profiling, or any purpose unrelated to the battalion's educational and training mission.</p>
          <p><strong className="text-slate-900 dark:text-white">FERPA:</strong> The Family Educational Rights and Privacy Act governs education records maintained by schools receiving federal funding. This site is an independent project, not an official Broward County Public Schools system. However, we follow FERPA's principles: access to individual cadet records is restricted by role, records are not disclosed to unauthorized parties, and parents/guardians may request access to their child's information (see Section 7).</p>
          <p><strong className="text-slate-900 dark:text-white">COPPA:</strong> The Children's Online Privacy Protection Act applies to websites that knowingly collect personal information from children under 13. We do not knowingly collect information from anyone under 13 without verifiable parental consent. See Section 7 for more.</p>
          <p>Fitness scores, physical measurements, and evaluation data are treated as sensitive student records and are only accessible to users with the appropriate role-based permissions.</p>
        </Section>

        <Section n="4" title="Who Can See Your Information">
          <p>Access is scoped by rank and role. In general: battalion command and staff can see the full roster and operational records; company leadership can see their own company; cadets can see their own information and what's directly relevant to their duties (like tasks assigned to their position). Some information — like the public leadership page or photo gallery — is intentionally visible to anyone visiting the site.</p>
          <p>Sensitive data (uniform sizes, fitness scores, fundraiser records, promotion board scores) is not visible to general cadets and is restricted to staff-level roles and above, or to the cadet's own company leadership.</p>
          <p>These role-based limits don't restrict battalion instructors and staff from accessing, using, or sharing information when necessary for a cadet's safety or welfare, or to meet legal or mandatory-reporting obligations to school officials or other authorities. See our Terms of Service for more.</p>
        </Section>

        <Section n="5" title="Third-Party Services We Use">
          <p>This site relies on a small number of outside services to operate. Each has its own privacy policy governing how they handle data on our behalf:</p>
          <p>&bull; <strong className="text-slate-900 dark:text-white">Google Firebase</strong> — account login, database storage (Firestore), file storage, and optional analytics. Firebase processes data under Google's data processing terms. Firebase Firestore is where all roster, operational, and personnel records are stored.</p>
          <p>&bull; <strong className="text-slate-900 dark:text-white">Vercel</strong> — website hosting and edge delivery.</p>
          <p>&bull; <strong className="text-slate-900 dark:text-white">Cloudinary</strong> — image and document file hosting, including photos of cadets uploaded by battalion staff (such as leadership profile photos). Cloudinary stores these files on its CDN. Only links to Cloudinary-hosted files are stored in our database; the files themselves are managed under Cloudinary's privacy terms.</p>
          <p>&bull; <strong className="text-slate-900 dark:text-white">Resend</strong> — sending account-related transactional emails (signup confirmation, password reset, etc.). Resend processes the recipient email address and email content for delivery purposes only. Email is sent server-side via Vercel API routes; no email credentials are exposed to the client.</p>
          <p>&bull; <strong className="text-slate-900 dark:text-white">Google Analytics 4</strong> — used to understand how public pages of this site are used (pages visited, general device/browser type). Analytics are only loaded if you accept cookies, and are never active on the password-protected admin portal. Analytics data does not include personally identifiable information and IP addresses are anonymized.</p>
          <p>&bull; <strong className="text-slate-900 dark:text-white">Google reCAPTCHA</strong> — verifying that signups aren't automated bots.</p>
        </Section>

        <Section n="6" title="Cookies & Analytics">
          <p>This site uses a small number of cookies and local storage entries required to keep you signed in for your session. It also offers optional Google Analytics to understand how public pages of the site are used (pages visited, general device/browser information), which sets its own cookies to do that — this only activates if you click Accept on the cookie consent banner shown on your first visit.</p>
          <p>Google Analytics on this site is configured with IP anonymization enabled and automatic page-view tracking disabled on load. No analytics data is sent before you accept cookies, and no analytics data is ever collected on password-protected admin pages (/admin/*).</p>
          <p>You can control or delete cookies through your browser's settings, and you can opt out of Google Analytics using Google's <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="text-yellow-500 hover:underline">Analytics Opt-out Browser Add-on</a>. Blocking cookies entirely may prevent you from staying signed in.</p>
        </Section>

        <Section n="7" title="Your Choices, Data Retention & Account Deletion">
          <p>You can review and update most of your own information from My Profile at any time. You can also permanently delete your own account from that same page — this permanently removes your login credentials and personal profile record.</p>
          <p>Battalion operational records that reference your name — such as past orders, fundraiser history, supply requests, fitness records, or camp attendance rosters — are retained as part of the battalion's active records while the battalion is in operation. These records document activity that involved other cadets and staff, not just you, and are not automatically removed when you delete your account.</p>
          <p><strong className="text-slate-900 dark:text-white">Data retention:</strong> Active cadet records are kept for the duration of the battalion's operation. When a cadet leaves the program (graduates or transfers), their personal account is deactivated or deleted upon request. Anonymized or aggregated records (e.g. historical fundraiser totals) may be retained indefinitely for battalion historical purposes. Identifiable data is not retained longer than necessary for operational purposes.</p>
          <p>Battalion command and staff can also suspend or delete accounts, consistent with our Terms of Service.</p>
        </Section>

        <Section n="8" title="Minors & Parental Access">
          <p>This site is used by JROTC cadets, who are generally minors. Consent for a cadet's photo, name, and personal information to be used in program materials — including this site's public leadership page and photo gallery — is obtained separately during program enrollment (DD-322), not through this website.</p>
          <p>This site is not intended for children under 13, and we do not knowingly collect personal information from anyone under 13 without verifiable parental consent. If we learn that an account was created by a child under 13 without that consent, we will remove it promptly.</p>
          <p>If you are a parent or guardian and want to review, correct, or request deletion of your child's information on this site — including fitness scores, physical measurements, or any other personal record — contact us using the information in Section 11 and we will address it directly.</p>
        </Section>

        <Section n="9" title="Data Security">
          <p>We use industry-standard practices where reasonably possible: passwords are never stored in plain text, sensitive account actions require verification (email verification and two-factor authentication for staff accounts), and access to internal data is enforced at the database level by role-based security rules — not just by the user interface.</p>
          <p>Sensitive categories of data (fitness scores, physical measurements, evaluation records) are stored in restricted Firestore collections that can only be read or written by users with the appropriate role permissions, verified server-side on every request.</p>
          <p>That said, no online system can be guaranteed 100% secure. If a data breach affecting your personal information occurs, we will notify affected cadets — or a parent/guardian for cadets under 18 — as soon as reasonably possible, describing what happened and what steps are being taken.</p>
        </Section>

        <Section n="10" title="Changes to This Policy">
          <p>We may update this policy as the site changes. Material changes will be reflected by updating the effective date above. Significant changes — such as new data collection practices or new third-party services — will be noted in the admin portal's announcement system for active users.</p>
        </Section>

        <Section n="11" title="Contact Us">
          <p>Questions about this policy, requests to review, correct, or delete information (including parental requests on behalf of a minor cadet), or concerns about how student data is being handled can be sent to <a href="mailto:info@pbhsjrotc.com" className="text-yellow-500 hover:underline">info@pbhsjrotc.com</a>.</p>
        </Section>

      </div>
    </div>
  );
};

export default PrivacyPolicy;
