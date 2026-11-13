import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Scale } from 'lucide-react';
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

const TermsOfService = () => {
  usePageMeta({
    title: 'Terms of Service',
    description: 'Terms of service for the PBHS JROTC Tornado Battalion website.',
    path: '/terms',
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
            <Scale className="text-yellow-500" size={40} /> Terms of Service
          </h1>
          <p className="text-slate-500 font-bold uppercase tracking-[0.3em] mt-4 text-xs">
            Effective {EFFECTIVE_DATE}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-16">

        <div className="mb-12 p-5 bg-yellow-500/5 border border-yellow-500/20 rounded-2xl text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          By creating an account or using this site, you agree to these terms. This site is an
          independent project built for the PBHS JROTC Tornado Battalion and is not officially operated
          by Broward County Public Schools, Pompano Beach High School, or U.S. Army Cadet Command.
        </div>

        <Section n="1" title="Who Can Use This Site">
          <p>This site is intended for cadets, instructors, and staff of the PBHS JROTC Tornado Battalion. Registration requires a battalion-issued access code and is subject to review and approval by battalion staff before full access is granted.</p>
          <p>If you are under 18, your use of this site is also subject to your parent or guardian's consent, obtained separately as part of your JROTC enrollment paperwork (DD-322).</p>
          <p>Access may be reviewed periodically - for example, at the start of each school year - to confirm you're still an active cadet or staff member. Accounts that aren't reconfirmed, or that belong to cadets who have graduated or left the program, may be deactivated.</p>
        </Section>

        <Section n="2" title="Your Account">
          <p>You're responsible for keeping your password confidential and for all activity under your account. Provide accurate information when registering and keep your profile up to date.</p>
          <p>Don't share your login with anyone else, and don't attempt to access another cadet's account or any data outside the scope your role permits.</p>
          <p>Staff-level accounts (battalion staff, company command, and above) are required to set up two-factor authentication (2FA) as part of the account onboarding process. This is a security requirement, not optional. Accounts that do not complete 2FA setup will be restricted from accessing staff functions until it is enabled.</p>
        </Section>

        <Section n="3" title="Acceptable Use">
          <p>By using this site, you agree to comply with the <strong className="text-slate-900 dark:text-white">Broward County Public Schools Student Code of Conduct</strong> (SBBC Policy 5.8) and the <strong className="text-slate-900 dark:text-white">PBHS JROTC Standard Operating Procedures (SOP)</strong> in all your interactions with this portal. These existing rules apply to your conduct here just as they do in any other school-connected setting.</p>
          <p>You agree not to:</p>
          <p>&bull; Impersonate another person or misrepresent your rank, position, or role.</p>
          <p>&bull; Submit false or fabricated data — including uniform requests, supply requests, physical fitness scores, fundraiser records, or promotion board evaluations — or otherwise misuse any portal tool or feature.</p>
          <p>&bull; Attempt to access, view, or modify data outside the scope your role permits — for example, accessing another company's roster or records when your role is scoped to your own company.</p>
          <p>&bull; Attempt to bypass account security features, including the CAPTCHA, two-factor authentication, or the account approval workflow.</p>
          <p>&bull; Upload content that is inappropriate, harassing, or unrelated to battalion business.</p>
          <p>&bull; Disclose, share, copy, or distribute any cadet's personal information — including names, contact information, fitness scores, uniform sizes, fundraiser data, or promotion records — to any person or party not authorized by their role within the portal. Information you access through this site is for official battalion use only and must not be shared outside that context.</p>
          <p>&bull; Use information available through this site (like the roster or contact information) for anything outside official battalion purposes.</p>
        </Section>

        <Section n="4" title="Content You Submit">
          <p>You're responsible for any photos, documents, or information you submit. Battalion staff may edit or remove content that violates these terms, and may correct roster information for accuracy.</p>
          <p>By submitting content, you grant the battalion permission to display it on this site for battalion purposes - for example, on the public leadership page, photo gallery, or documents library.</p>
        </Section>

        <Section n="5" title="Site Availability & Administration">
          <p>We may add, change, suspend, or discontinue any part of this site - or the site as a whole - at any time, without notice or liability.</p>
          <p>This site is run by battalion volunteers, and who's running it will change over time as cadets and instructors graduate or move on. We may transfer administration of the site, and the data on it, to a successor administrator within the battalion so the site can keep operating.</p>
        </Section>

        <Section n="6" title="Suspension & Termination">
          <p>Battalion command and staff may suspend, restrict, or delete an account, or remove content, at their discretion - for example, for a terms violation, graduation, leaving the program, or any other reason connected to running the battalion's program. You can also delete your own account at any time from My Profile.</p>
          <p>Deleting your account removes your login and personal profile. Battalion records that include your name or contributions - like past orders, uniform issuance history, or camp rosters - may remain as part of the battalion's operational history, consistent with our Privacy Policy.</p>
        </Section>

        <Section n="7" title="Safety & Mandatory Reporting">
          <p>The role-based access limits described in our Privacy Policy don't restrict battalion instructors and staff from accessing, using, or sharing information when necessary for a cadet's safety or welfare, or to meet legal or mandatory-reporting obligations to school officials or other authorities.</p>
        </Section>

        <Section n="8" title="No Warranty">
          <p>This site is provided by an independent, volunteer-built project on an "as is" and "as available" basis. We don't guarantee it will be error-free, uninterrupted, or perfectly accurate, and we're not liable for decisions made based on information found here (like task deadlines or uniform status) - always confirm anything time-sensitive with your chain of command directly.</p>
          <p>We're also not responsible for outages or issues caused by the third-party services this site depends on (like Firebase, Vercel, Cloudinary, or Resend) or other events outside our control.</p>
        </Section>

        <Section n="9" title="Limitation of Liability">
          <p>To the fullest extent permitted by law, the individuals who built and maintain this site aren't liable for any indirect, incidental, or consequential damages arising from your use of it.</p>
        </Section>

        <Section n="10" title="Governing Law">
          <p>These terms are governed by the laws of the State of Florida, without regard to conflict-of-law principles.</p>
        </Section>

        <Section n="11" title="General Provisions">
          <p>We may use aggregate or de-identified usage information to maintain or improve this site.</p>
          <p>If any part of these terms is found unenforceable, the rest remains in effect.</p>
          <p>These terms, together with our Privacy Policy, are the entire agreement between you and the site regarding your use of it, and replace any prior understandings.</p>
          <p>If we don't enforce a provision of these terms on one occasion, that doesn't waive our right to enforce it later.</p>
        </Section>

        <Section n="12" title="Changes to These Terms">
          <p>These terms may be updated as the site evolves. Continuing to use the site after a change means you accept the updated terms. Material changes will be reflected by updating the effective date above.</p>
        </Section>

        <Section n="13" title="Contact Us">
          <p>Questions about these terms can be sent to <a href="mailto:info@pbhsjrotc.com" className="text-yellow-500 hover:underline">info@pbhsjrotc.com</a>.</p>
        </Section>

      </div>
    </div>
  );
};

export default TermsOfService;
