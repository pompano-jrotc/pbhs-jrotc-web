// src/pages/AdminChangelog.jsx
//
// Portal version history — read-only, accessible to all authenticated users.
// Versions follow semver: minor = feature milestone, patch = logical commit cluster.
// Update this file whenever a new version ships.

import React, { useState } from 'react';
import { Tag, ChevronDown, ChevronRight } from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { usePageMeta } from '../hooks/usePageMeta';

// ── Tag chips ─────────────────────────────────────────────────────────────────
const CHIP = {
  feat: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400',
  fix:  'bg-blue-100   dark:bg-blue-950/60    text-blue-700   dark:text-blue-400',
  sec:  'bg-rose-100   dark:bg-rose-950/60    text-rose-700   dark:text-rose-400',
  perf: 'bg-orange-100 dark:bg-orange-950/60  text-orange-700 dark:text-orange-400',
  law:  'bg-purple-100 dark:bg-purple-950/60  text-purple-700 dark:text-purple-400',
};
const CHIP_LABEL = { feat: 'Feature', fix: 'Fix', sec: 'Security', perf: 'Perf', law: 'Compliance' };

const Tag_ = ({ type }) => (
  <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${CHIP[type]}`}>
    {CHIP_LABEL[type]}
  </span>
);

// ── Single change line ─────────────────────────────────────────────────────────
const C = ({ type, children }) => (
  <li className="flex items-baseline gap-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
    <Tag_ type={type} /><span>{children}</span>
  </li>
);

// ── Patch card ─────────────────────────────────────────────────────────────────
const Patch = ({ version, date, title, isCurrent, changes }) => (
  <div className={`flex gap-3 py-3 border-b border-slate-100 dark:border-white/5 last:border-0 ${isCurrent ? 'rounded-xl bg-yellow-50 dark:bg-yellow-500/5 px-3 -mx-3 border-yellow-200 dark:border-yellow-500/20' : ''}`}>
    {/* Version pill */}
    <div className="w-[68px] shrink-0 pt-0.5">
      {isCurrent ? (
        <span className="inline-block bg-yellow-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded leading-none">
          {version}
        </span>
      ) : (
        <span className="text-[10px] font-black text-slate-400 dark:text-slate-500">{version}</span>
      )}
    </div>
    {/* Content */}
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{title}</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">{date}</span>
      </div>
      <ul className="space-y-1.5">{changes}</ul>
    </div>
  </div>
);


// ── Named release (grouped patches under a descriptive title) ─────────────────
const Release = ({ versions, date, title, isCurrent, changes }) => (
  <div className={`py-4 border-b border-slate-100 dark:border-white/5 last:border-0 ${
    isCurrent ? 'rounded-xl bg-yellow-50 dark:bg-yellow-500/5 px-3 -mx-3 border border-yellow-200 dark:border-yellow-500/20' : ''
  }`}>
    <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
      <div>
        {isCurrent ? (
          <span className="inline-block bg-yellow-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded leading-none mb-1">{versions}</span>
        ) : (
          <span className="block text-[10px] font-black text-slate-400 dark:text-slate-500 mb-0.5">{versions}</span>
        )}
        <p className="text-sm font-black text-slate-800 dark:text-slate-200">{title}</p>
      </div>
      <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0 mt-0.5">{date}</span>
    </div>
    <ul className="space-y-1.5">{changes}</ul>
  </div>
);

// ── Minor version section ──────────────────────────────────────────────────────
const Minor = ({ version, title, date, isMajor, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors ${
          isMajor
            ? 'bg-yellow-500/10 dark:bg-yellow-500/10 hover:bg-yellow-500/15 border border-yellow-500/30'
            : 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/8 border border-slate-200 dark:border-white/5'
        }`}
      >
        <span className={`text-[11px] font-black px-2 py-0.5 rounded shrink-0 ${isMajor ? 'bg-yellow-500 text-slate-950' : 'bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300'}`}>
          {version}
        </span>
        <span className={`font-black uppercase italic tracking-tight text-sm ${isMajor ? 'text-yellow-700 dark:text-yellow-400' : 'text-slate-700 dark:text-slate-300'}`}>
          {title}
        </span>
        <span className="ml-auto text-[10px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap mr-2">{date}</span>
        {open
          ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
          : <ChevronRight size={14} className="text-slate-400 shrink-0" />
        }
      </button>
      {open && (
        <div className="mt-1 px-4 py-2 rounded-xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/40">
          {children}
        </div>
      )}
    </div>
  );
};

// ── Stat tile ──────────────────────────────────────────────────────────────────
const Stat = ({ value, label }) => (
  <div className="flex-1 min-w-[80px] text-center px-3 py-3 border-r border-slate-200 dark:border-white/5 last:border-r-0">
    <p className="text-xl font-black italic text-yellow-500 leading-none">{value}</p>
    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mt-1">{label}</p>
  </div>
);

// ── Page ───────────────────────────────────────────────────────────────────────
const AdminChangelog = () => {
  usePageMeta({
    title: 'Version History',
    description: 'Command Portal release history.',
    path: '/admin/changelog',
  });

  return (
    <div className="p-6 md:p-8">
    <div>
      <AdminPageHeader
        icon={Tag}
        title="Version History"
        meta="All releases for the PBHS JROTC Command Portal — click any version to expand its patches."
      />

      {/* Stats bar */}
      <div className="flex flex-wrap mb-6 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/40 overflow-hidden">
        <Stat value="308"    label="Patches"     />
        <Stat value="641"    label="Commits"     />
        <Stat value="23"     label="Role Levels" />
        <Stat value="246d"   label="In Dev"      />
        <Stat value="v1.8.119" label="Current"     />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mr-1">Key:</span>
        {Object.keys(CHIP).map(t => <Tag_ key={t} type={t} />)}
      </div>

      {/* ── v1.8 ERA ──────────────────────────────────────────────────── */}
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-600 mb-3 px-1">Admin Portal Overhaul</p>

      <Minor version="v1.8" title="Admin Portal Overhaul" date="Oct 7, 2026" isMajor defaultOpen>
        <Release versions="v1.8.119" date="Nov 2" title="Remove category from Medals and Cords" isCurrent changes={<>
          <C type="fix">Medals and Cords no longer show or accept a category field, matching the same behavior as Arcs; Ribbons remain categorized</C>
        </>} />
        <Release versions="v1.8.118" date="Nov 2" title="Arcs have no category in Awards Registry" isCurrent={false} changes={<>
          <C type="fix">Arc types no longer show or accept a category — category field hidden from the create/edit modals and catalog cards for arcs only</C>
        </>} />
        <Release versions="v1.8.117" date="Nov 2" title="Awards Registry — Ribbons, Arcs, Medals & Cords combined" isCurrent={false} changes={<>
          <C type="feat">Ribbon Registry and Arcs/Medals/Cords merged into a single "Awards Registry" tab — four item types (Ribbon, Arc, Medal, Cord) accessible via a type selector at the top of one unified page</C>
          <C type="feat">All 67 standard US Army JROTC ribbons remain importable via "Import Standard Ribbons"; arcs, medals, and cords each have 10 standard items of their own</C>
        </>} />
        <Release versions="v1.8.116" date="Nov 2" title="Awards Registry — Arcs, Medals & Cords" isCurrent={false} changes={<>
          <C type="feat">New "Arcs, Medals &amp; Cords" sub-tab added to S1 Shop (accessible at command level 45+) — a full registry page for managing arc, medal, and cord types with the same Catalog, Reorder, and Mass Award workflow as the Ribbon Registry</C>
          <C type="feat">Arc, Medal, and Cord each have their own Firestore collection (arcTypes / medalTypes / cordTypes) and awards collection (arcAwards / medalAwards / cordAwards); type selector at the top switches between them instantly</C>
          <C type="feat">Each type ships with 10 common JROTC standard items importable via "Import Standard" button; all three types support drag-and-drop reordering</C>
        </>} />
        <Release versions="v1.8.115" date="Nov 2" title="Fix: voter names on pre-v1.8.114 poll votes" isCurrent={false} changes={<>
          <C type="fix">Voter chips in the "Who Voted" panel now look up the cadet's full name from Firestore for votes cast before v1.8.114 that lack a stored voterName; raw UIDs no longer appear</C>
        </>} />
        <Release versions="v1.8.114" date="Nov 2" title="Poll voter visibility for staff" isCurrent={false} changes={<>
          <C type="feat">Staff can now see who voted on any non-anonymous poll — a "Who Voted" button appears in the poll header when results are visible (staff 70+, non-anonymous polls only)</C>
          <C type="feat">Voter names are displayed grouped by the option they chose; names are stored at vote time so no extra lookups are needed</C>
          <C type="fix">Voter name is now saved to the pollVotes document when submitting — new votes include the cadet's full name alongside their user ID</C>
        </>} />
        <Release versions="v1.8.113" date="Nov 2" title="Polls on Command Feed + staff results preview" isCurrent={false} changes={<>
          <C type="feat">Polls on global broadcasts now appear directly in the Command Feed on the admin dashboard — cadets and staff can vote without leaving the dashboard</C>
          <C type="feat">Broadcast cards in the Command Feed now show the announcement title (if set) and preserve line breaks in the content</C>
          <C type="feat">Staff-only "Results" toggle added to polls — staff can peek at live vote counts before casting their own vote; clicking "Vote" returns to the voting interface</C>
        </>} />
        <Release versions="v1.8.112" date="Nov 2" title="Fix: staff/command users can now vote on polls" isCurrent={false} changes={<>
          <C type="fix">Staff and command-level users were blocked from voting on announcement polls — the results view replaced the voting interface immediately for any user above command level, making the poll unresponsive</C>
          <C type="fix">Fixed: all users (including staff) now see the voting interface until they cast their vote; staff still see full results immediately after voting even when resultsVisibility is set to "never"</C>
        </>} />
        <Release versions="v1.8.111" date="Nov 2" title="Ribbon Registry — drag-and-drop wear order" isCurrent={false} changes={<>
          <C type="feat">New "Reorder" button in the Ribbon Registry catalog (staff 70+) — enters a drag-and-drop mode showing all ribbons in a sortable list with numbered positions and grip handles</C>
          <C type="feat">Dragging ribbons up or down sets the wear order; "Save Order" batch-writes precedence values in one shot and exits reorder mode</C>
          <C type="fix">Removed the manual Order of Precedence number field from the edit and create modals — wear order is now managed exclusively through the drag interface</C>
        </>} />
        <Release versions="v1.8.110" date="Nov 2" title="Print Roster — PDF download" isCurrent={false} changes={<>
          <C type="feat">Print Roster now generates and auto-downloads a PDF file instead of opening the browser print dialog — uses jsPDF + autotable for a clean, formatted letter-size document</C>
          <C type="feat">PDF includes cadets grouped by LET level, sorted alphabetically; LET number is shown right-aligned in the name column on the first cadet of each group</C>
          <C type="feat">LET breakdown and total cadet count are included at the bottom of the PDF</C>
          <C type="fix">Removed incorrect name conversion — names are stored as "LAST, FIRST" and are now used as-is without any reformatting</C>
        </>} />
        <Release versions="v1.8.109" date="Nov 2" title="Print Roster — Personnel Hub, Cadet Challenge, Fundraiser" isCurrent={false} changes={<>
          <C type="feat">Print Roster button added to Personnel Hub (roster tab) — opens a print-ready window formatted to the standard PBHS JROTC roster: cadets grouped by LET level in "Last, First" order, LET breakdown and total at the bottom, with 6 blank columns for marking</C>
          <C type="feat">Print Roster button added to Cadet Challenge — prints the current company's roster for the active cycle</C>
          <C type="feat">Print Roster button added to Fundraiser (Roster tab) — prints the currently visible company's cadet list in the same format</C>
          <C type="feat">Shared printRoster utility handles LET grouping, name formatting, and opening the print dialog automatically</C>
        </>} />
        <Release versions="v1.8.108" date="Nov 2" title="Ribbon Registry: edit types + order of precedence" isCurrent={false} changes={<>
          <C type="feat">Ribbon types can now be edited — a pencil icon on each catalog card (staff 70+) opens an edit modal to change the name, code, category, description, and order of precedence</C>
          <C type="feat">Order of precedence added to ribbon types — an integer field where lower = more prestigious; the catalog is sorted by precedence (then alphabetically for ribbons without one)</C>
          <C type="feat">Standard ribbon import now assigns precedences automatically based on the official US Army JROTC order (N-1-x first, then N-2-x, N-3-x, N-4-x, then battalion-specific ribbons)</C>
          <C type="feat">Order of precedence field added to the New Ribbon Type modal so custom ribbons can be positioned in the correct wear order from creation</C>
        </>} />
        <Release versions="v1.8.107" date="Nov 2" title="Personnel Hub improvements + promotion board enhancements" isCurrent={false} changes={<>
          <C type="feat">Promotion board settings (title and board date) can now be edited on open and closed boards — S1 uses the new "Edit Settings" inline form in the board detail header</C>
          <C type="feat">N/A is now a valid score input for any promotion board category — selecting N/A means the category is skipped entirely (does not add or subtract from the cadet's final score)</C>
          <C type="feat">Personnel Hub company filter now persists across profile visits via sessionStorage — navigating into and out of a cadet profile returns to the same company filter</C>
          <C type="feat">New "All Companies" option in the Personnel Hub company filter allows staff to view all cadets across every company at once</C>
          <C type="feat">Cadets can now be searched by their unique ID number in Personnel Hub — type the number directly or prefix with # (e.g. #00042)</C>
          <C type="feat">Cadet History section added to Admin Cadet Profile — shows all archived yearly records (school year, rank, position, company, LET level) in one place without needing the separate history tab</C>
          <C type="feat">Edit, scroll-to-history, delete, and graduate action buttons added to the cadet profile header (visible to command 45+ / admin 80+ respectively) — eliminates the need to return to the roster just to edit or remove a cadet</C>
        </>} />
        <Release versions="v1.8.106" date="Nov 2" title="Standard JROTC ribbon catalog import" isCurrent={false} changes={<>
          <C type="feat">Added 68 standard US Army JROTC regulation ribbons to the Ribbon Registry as a built-in dataset (N-1-x through N-4-x plus battalion-specific awards)</C>
          <C type="feat">New "Import Standard Ribbons" button (staff 70+) in the Ribbon Registry Catalog tab — checks for existing names and batch-imports only missing ones via Firestore writeBatch; shows a count toast on completion</C>
        </>} />
        <Release versions="v1.8.105" date="Nov 2" title="Delete any promotion board" isCurrent={false} changes={<>
          <C type="feat">S1 / admin users can now delete open and closed promotion boards — the board document and all associated cadet score records are permanently removed in a batched Firestore write</C>
          <C type="fix">Draft deletion now uses the same unified handler; large boards (500+ score docs) are chunked into multiple batch commits to stay within Firestore limits</C>
        </>} />
        <Release versions="v1.8.104" date="Nov 2" title="Profile photo approval + public ribbon recommendation portal" isCurrent={false} changes={<>
          <C type="feat">Staff (70+) can assign a profile photo to any cadet from the Admin Cadet Profile page — sets the authoritative portrait and marks it staff-assigned</C>
          <C type="feat">When a cadet's photo is staff-assigned, any upload they submit goes to a pending state instead of applying immediately; their pending photo shows with a "Pending" badge in My Profile</C>
          <C type="feat">Staff can approve or reject a cadet's pending photo request directly from the Admin Cadet Profile page — approve swaps in the new photo, reject discards the request</C>
          <C type="feat">Cadets can cancel their own pending submission from My Profile before it is reviewed</C>
          <C type="feat">New public /recommend page — anyone (guests or logged-in cadets) can submit a ribbon recommendation for a cadet; logged-in users are pre-filled</C>
          <C type="feat">Recommenders select the cadet from the active roster, pick a ribbon from the catalog, write a reason, and provide their name and relation</C>
          <C type="feat">New Ribbon Recommendations section on Admin Cadet Profile (staff 70+) shows all pending recommendations with Approve (pre-fills the Award modal) and Reject actions</C>
          <C type="feat">Approving a recommendation automatically marks it as approved in Firestore and links the created award ID back to the recommendation record</C>
          <C type="feat">Recommend a Cadet link added to the public site footer under Resources</C>
        </>} />
        <Release versions="v1.8.103" date="Nov 2" title="Fix: Ribbon Registry in correct S1 sub-tab" isCurrent={false} changes={<>
          <C type="fix">Ribbon Registry now appears as a proper sub-tab inside the S1 Shop in Staff Shops — the previous build added it to AdminS1's internal tab bar which is suppressed by forceTab; now wired directly into AdminStaff.jsx alongside Form Tracker, Promotion Board, Meeting Logs, etc.</C>
        </>} />
        <Release versions="v1.8.102" date="Nov 1" title="Ribbon Registry: moved to S1 + Mass Award" isCurrent={false} changes={<>
          <C type="feat">Ribbon Registry moved from Personnel Hub to the S1 Area as a new "Ribbon Registry" tab alongside Form Tracker and Promotion Board</C>
          <C type="feat">New Mass Award sub-tab — select a ribbon type, filter cadets by company, check-select any combination, and award to all of them in one Firestore batch write</C>
          <C type="feat">Mass Award panel includes the same award fields as individual awards (date, cycle, citation, recommended-by, status) applied uniformly to all selected cadets</C>
        </>} />
        <Release versions="v1.8.101" date="Nov 1" title="Phase 5: Ribbon Registry + Award from Profile" isCurrent={false} changes={<>
          <C type="feat">New Ribbon Registry tab in Personnel Hub (command level 45+) — staff (70+) can create ribbon types with name, code, category, and description; admins (80+) can delete types</C>
          <C type="feat">Ribbon types stored in a Firestore ribbonTypes catalog — name, code, category, description, created-by tracking</C>
          <C type="feat">Award Ribbon button on Admin Cadet Profile — opens a modal to select a ribbon type from the catalog, set award date, cycle number, citation, recommended-by, and issued/pending status</C>
          <C type="feat">Awarded-by auto-fills from the current user; award is saved to ribbonAwards with full metadata and updates the profile live</C>
          <C type="feat">Ribbon Awards section on profile now displays ribbonName/ribbonCode from the catalog, award date, and recommended-by when present</C>
        </>} />
        <Release versions="v1.8.100" date="Nov 1" title="Fix: Cadet Challenge records on Admin Profile" isCurrent={false} changes={<>
          <C type="fix">Admin Cadet Profile page now correctly loads Cadet Challenge records — removed composite-index orderBy that caused Firestore to silently return no results; records are now sorted client-side by cycle number</C>
        </>} />
        <Release versions="v1.8.99" date="Nov 1" title="My Profile: Board History & Ribbon Awards" isCurrent={false} changes={<>
          <C type="feat">My Profile page now shows Promotion Board history — all boards the cadet has participated in, sorted newest-first, with board title, date, total score, extra credit, and per-category color-coded scores</C>
          <C type="feat">My Profile page now shows Ribbon Awards — each ribbon with its name, cycle number, and issued/pending status badge</C>
          <C type="feat">Both sections display a friendly empty state when no records exist yet</C>
        </>} />
        <Release versions="v1.8.98" date="Nov 1" title="Admin Cadet Profile Page" isCurrent={false} changes={<>
          <C type="feat">New Cadet Profile page at /admin/personnel/:id — accessible to all company staff (35+) and above</C>
          <C type="feat">Header shows portrait, name, cadet ID badge, rank, position, company, LET level, gender, and a quick stats row (challenge cycles, board appearances, total fundraiser)</C>
          <C type="feat">Cadet Challenge section shows all recorded cycles with per-event scores or medical-exempt status</C>
          <C type="feat">Promotion Boards section shows all board history with per-category scores and total; boards are sorted newest-first</C>
          <C type="feat">Ribbon Awards, Uniform Sizes, and Fundraiser summary sections all load live from Firestore</C>
          <C type="feat">Profile icon button added to every roster row for direct navigation to that cadet's profile</C>
        </>} />
        <Release versions="v1.8.97" date="Nov 1" title="Cadet IDs: Permanent 5-Digit Numbers" isCurrent={false} changes={<>
          <C type="feat">Every new cadet added to the Roster is automatically assigned a permanent 5-digit ID (00001–99999) using an atomic Firestore counter — IDs are never reused or reassigned</C>
          <C type="feat">Cadet ID badge (#00001) now appears next to the cadet's name in the Roster table</C>
          <C type="feat">Assign IDs button appears in the Roster toolbar for admins when any existing cadets are missing an ID — assigns numbers to unassigned entries in chronological order without affecting already-assigned ones</C>
        </>} />
        <Release versions="v1.8.96" date="Nov 1" title="Averages: Cadet Challenge + Promotion Board" isCurrent={false} changes={<>
          <C type="feat">Cadet Challenge records view now shows a Company Averages card below the table — per-event mean for push-ups, sit-ups, shuttle run, one mile, and sit-and-reach across non-exempt cadets in the selected cycle</C>
          <C type="feat">One-mile averages correctly parse MM:SS string format before averaging and display the result as MM:SS</C>
          <C type="feat">Promotion Board detail view now shows a Board Averages card — average total score, highest and lowest score, average extra credit, and a collapsible per-category breakdown across all cadets with entered scores</C>
        </>} />
        <Release versions="v1.8.95" date="Nov 1" title="CSV Export: Roster, Cadet Challenge, Fundraiser, Uniform Sizes" isCurrent={false} changes={<>
          <C type="feat">Export CSV button added to Roster — exports the currently visible cadets (current company or search results) with name, rank, position, company, platoon, squad, gender, and LET level</C>
          <C type="feat">Export CSV button added to Cadet Challenge — exports all records for the selected cycle and company filter with push-ups, sit-ups, shuttle run, one mile, sit-and-reach, and medical exempt flag</C>
          <C type="feat">Export CSV button added to Fundraiser Transactions — exports non-voided entries with cadet name, company, payment type, amount, flags earned, order number, order date, and notes</C>
          <C type="feat">Export CSV button added to Uniform Sizes — exports all records for the active company with cadet name, rank, and all size fields</C>
        </>} />
        <Release versions="v1.8.94" date="Nov 1" title="Profile: Dedicated Profile Photo Section" isCurrent={false} changes={<>
          <C type="feat">New Profile Photo card on the My Profile page — larger preview, Upload/Replace and Remove buttons, and a note explaining where the photo appears (public Leadership page + Command Portal)</C>
          <C type="feat">Remove button lets users clear their photo (reverts to initials) with a confirm prompt</C>
        </>} />
        <Release versions="v1.8.93" date="Nov 1" title="Leadership: Publishing Hub Read-Only + Bulk Sync" isCurrent={false} changes={<>
          <C type="feat">Publishing Hub Leadership tab redesigned as read-only — name, rank, and position on the public Leadership page are now managed entirely from the Roster; the manual "New Entry" and edit-name/role forms are removed</C>
          <C type="feat">New "Sync from Roster" button performs a one-time bulk sync of all current roster entries into the leadership display — useful for populating the page after the auto-sync feature was first deployed</C>
          <C type="feat">Per-entry portrait upload still available in the Publishing Hub — click the portrait thumbnail to replace a photo without touching the roster entry</C>
          <C type="feat">Auto-synced entries show a "Roster" badge so it's clear which entries are roster-managed vs. manually created</C>
        </>} />
        <Release versions="v1.8.92" date="Nov 1" title="Leadership: Auto-sync from Roster" isCurrent={false} changes={<>
          <C type="feat">Public Leadership page now stays in sync with the Roster automatically — saving any cadet entry with a command or staff position (BC, XO, CSM, SGM, S1–S7, Company Commander, XO, 1SG, MSgt) pushes name and rank to the public display without requiring manual Publishing Hub entries</C>
          <C type="feat">Portrait is also synced when the cadet has a linked portal account with a photo — falls back to placeholder for accounts without one</C>
          <C type="feat">Removing a cadet from the roster also removes their leadership display entry; position changes clean up the stale entry and create the correct new one</C>
          <C type="perf">Firestore leadership write rule relaxed to commanders (55+) so the auto-sync fires for more users; Publishing Hub portrait/bio overrides still work and are preserved on sync</C>
        </>} />
        <Release versions="v1.8.91" date="Oct 28" title="Org Day: Fix 30-pt Standing Bug + Settings Tab" isCurrent={false} changes={<>
          <C type="fix">All companies were showing exactly 30 pts in Org Day standings — 6 numeric-score events (PT, Squad Drill, Color Guard, Knockout, AYSTAL1, Spirit) returned 0 instead of null when no data was entered, causing every company to tie at rank 1 (5 pts each); adding null guards so empty data is excluded from ranking fixed this</C>
          <C type="feat">New Settings tab in Org Day area (admin only) — toggle events on/off, rename them, flip scoring direction (higher/lower), and set custom point values per placement (1st–5th) for any built-in event</C>
          <C type="feat">Add custom events from Settings — choose score type (number, time mm:ss, or placement 1–5), set direction and point scale; custom events appear in both the standings and event scoring grid</C>
        </>} />
        <Release versions="v1.8.90" date="Oct 27" title="Roles: District Army Instructor (DAI)" isCurrent={false} changes={<>
          <C type="feat">New role added — District Army Instructor (DAI) at level 105, above SAI; full portal access across all areas</C>
          <C type="feat">DAI role added to Firestore security rules — recognized as admin tier with self-edit exemption and full read/write access</C>
        </>} />
        <Release versions="v1.8.89" date="Oct 27" title="Fundraiser: Fix Voided Entry Count in Battalion Stats" isCurrent={false} changes={<>
          <C type="fix">Battalion Stats widget was including voided fundraiser entries in totals — the stats page filtered by a legacy <code>status</code> string field while the fundraiser page voids entries using a boolean <code>voided</code> field; aligned to use the same field so totals now match</C>
        </>} />
        <Release versions="v1.8.88" date="Oct 23" title="Staff Shops: Rename + SGM Merged into S3" isCurrent={false} changes={<>
          <C type="feat">Staff Hub renamed to Staff Shops across the portal — nav link, page header, and all notifications updated</C>
          <C type="feat">All staff tab labels updated to the Shop format: S1 Shop, S2 Shop, S3 Shop, S4 Shop, S5 Shop, S6 Shop</C>
          <C type="feat">SGM merged into S3 Shop — the S3 tab now carries a visible SGM badge to indicate the Sergeant Major operates within this shop</C>
        </>} />
        <Release versions="v1.8.87" date="Oct 20" title="Documents: Human-Readable Upload Error" isCurrent={false} changes={<>
          <C type="fix">PDF upload error when a file exceeds the 10 MB hosting limit now shows the actual file size in MB with a clear message — previously showed raw byte counts like "Got 13409573. Maximum is 10485760."</C>
        </>} />
        <Release versions="v1.8.86" date="Oct 20" title="Documents: Fix Drag-to-Reorder" isCurrent={false} changes={<>
          <C type="fix">Document reordering now works — dragging a row to a new position and clicking Save Order correctly persists the new order; previously the list silently reverted to the original order immediately after each drop due to a React state timing bug</C>
        </>} />
        <Release versions="v1.8.85" date="Oct 20" title="Uniform Requests: S4 Assistant Full Workflow" isCurrent={false} changes={<>
          <C type="feat">Company S4 assistants can submit uniform item requests — a "Request Issuance" button appears on the Uniform Items page; submitted requests appear in the Pending tab scoped to their company</C>
          <C type="fix">Firestore security rule extended so the original requester (e.g. S4 assistant) can mark their own Approved request as Received — previously Firestore blocked this update even though the UI showed the button</C>
        </>} />
        <Release versions="v1.8.84" date="Oct 20" title="Fundraiser: Search Notes Field for Order Numbers" isCurrent={false} changes={<>
          <C type="fix">Transactions search now also searches the notes field — catches legacy entries where the order number was stored in notes before the dedicated order number field existed</C>
        </>} />
        <Release versions="v1.8.83" date="Oct 20" title="Fundraiser: Search Placeholder Clarification" changes={<>
          <C type="fix">Transactions search placeholder now reads "Name, company, order #…" so it's clear order numbers are searchable; order number search was already wired in v1.8.82</C>
        </>} />
        <Release versions="v1.8.82" date="Oct 20" title="Fundraiser: Search Bar" changes={<>
          <C type="feat">Added a search bar to the Fundraiser page — filters Transactions by cadet name, company, or order number; filters Roster by cadet name or company; search clears automatically when switching tabs</C>
        </>} />
        <Release versions="v1.8.81" date="Oct 20" title="Documents: PDF Signature Fix" changes={<>
          <C type="fix">Cloudinary download signature was invalid — resource_type must not be included in the signed parameter string; removing it resolves the "Invalid Signature" error on all PDF downloads</C>
        </>} />
        <Release versions="v1.8.80" date="Oct 20" title="Documents: Reorder + PDF Timestamp Fix" changes={<>
          <C type="feat">Admin document list now supports drag-to-reorder — grab the grip handle on any row and drag it to a new position; a Save Order button appears after any change and writes the new order to Firestore in a batch</C>
          <C type="feat">Public Documents page respects the saved sort order — documents display in the admin-defined sequence, grouped by category</C>
          <C type="fix">PDF download proxy was returning "Missing required parameter — timestamp" from Cloudinary; the signed URL now includes the required timestamp param in both the signature and query string</C>
          <C type="fix">Removed the "Back to Command" link from the Documents page hero section</C>
        </>} />
        <Release versions="v1.8.79" date="Oct 20" title="Documents: PDF Proxy — Fix 401 Errors" changes={<>
          <C type="fix">PDF document links now route through a Vercel proxy that generates a Cloudinary Admin API signed URL — bypasses the account-level access control that was causing HTTP 401 errors on all raw file links</C>
          <C type="fix">Fix applies to both the public Documents page and the admin Download button; WebP images continue to use direct Cloudinary URLs as before</C>
        </>} />
        <Release versions="v1.8.78" date="Oct 20" title="Documents: PDF Fix & WebP Lightbox" changes={<>
          <C type="fix">PDFs now open correctly — signed uploads include access_mode: public so Cloudinary serves them without a 401 error (applies to all new uploads going forward)</C>
          <C type="feat">WebP images on the public Documents page are now clickable — clicking opens a full-screen lightbox with the image; press Escape or click outside to close; download button still available in the lightbox</C>
        </>} />
        <Release versions="v1.8.77" date="Oct 20" title="Documents: WebP Image Upload & Display" changes={<>
          <C type="feat">Documents page now accepts WebP images in addition to PDFs — upload via the existing Upload Document button; file is validated by magic bytes, not just extension</C>
          <C type="feat">WebP images display inline on the public Documents page with a visible preview and a dedicated download button; PDFs continue to open directly as before</C>
          <C type="feat">Admin document list shows a thumbnail preview for WebP entries instead of a file icon, making image documents easy to identify at a glance</C>
        </>} />
        <Release versions="v1.8.76" date="Oct 20" title="Documents: Edit Title, Category & Description" changes={<>
          <C type="feat">Each published document now has an Edit button (pencil icon) — staff can update the title, category, and description without re-uploading the file</C>
          <C type="feat">Description now shows as a one-line preview in the admin document list</C>
        </>} />
        <Release versions="v1.8.75" date="Oct 20" title="Documents: Org-Level Categories" changes={<>
          <C type="feat">Document categories updated to reflect chain of command: Cadet Command, 6th Brigade, Broward County Regiment, Tornado Battalion, Other</C>
        </>} />
        <Release versions="v1.8.74" date="Oct 19" title="E-Store: Split Payment, Order Date & Dedup" changes={<>
          <C type="feat">E-Store payments now require an order date — a date picker appears when E-Store is selected, stored per entry for accurate transaction records</C>
          <C type="feat">Multiple cadets can be added to a single e-store payment — the total amount is split equally between all added cadets, with per-cadet amounts shown live as you type; each cadet gets their own logged entry</C>
          <C type="feat">Duplicate order number prevention — saving an e-store payment with an order number that already exists in the system shows an error and blocks the save</C>
          <C type="feat">Log Payment modal now shows payment type selector at the top so switching to E-Store immediately reveals the e-store-specific fields</C>
        </>} />
        <Release versions="v1.8.73" date="Oct 19" title="Fundraiser: E-Store Order Number" changes={<>
          <C type="feat">E-Store payments now require an order number (format 1112011-##########) — the field appears automatically when E-Store is selected and is validated before saving</C>
          <C type="feat">Order numbers display in the transactions table and personal view in a dedicated monospace format, separate from the notes field</C>
          <C type="feat">Settings tab includes a one-time migration tool that moves existing order numbers from the notes field into the new dedicated field across all entries</C>
        </>} />
        <Release versions="v1.8.72" date="Oct 18" title="Participation Leaderboard, Fundraiser & Navbar Fixes" changes={<>
          <C type="feat">Participation Tracker now shows a live leaderboard when no event is selected — top 5 cadets overall and top 3 per company for the active quarter</C>
          <C type="fix">Fundraiser page: Battalion HQ company filter now correctly loads Battalion and Zulu cadets instead of showing an empty cadet search</C>
          <C type="fix">Navbar desktop dropdowns now open on tap/click in addition to hover, fixing right-click context menu appearing on Chrome touchscreens</C>
        </>} />
        <Release versions="v1.8.71" date="Oct 15" title="Roster: Cross-Company Search" changes={<>
          <C type="feat">Battalion staff can now search across all companies at once from the Roster page — typing in the search bar searches every company instead of only the selected tab, with a company badge on each result and a live result count shown below the search field</C>
          <C type="feat">Company name is also searchable (e.g. type "Alpha" to filter to Alpha Company cadets across the whole roster)</C>
        </>} />
        <Release versions="v1.8.70" date="Oct 15" title="Participation Tracker: Quarter Tabs" isCurrent={false} changes={<>
          <C type="feat">Participation Tracker events are now organized into Q1 / Q2 / Q3 / Q4 tabs — click a tab to see only that quarter's events, default opens to the current quarter</C>
          <C type="feat">New Event form includes a Quarter selector (Q1–Q4) so staff assign the correct quarter at creation; legacy events without a stored quarter auto-infer it from their date</C>
          <C type="feat">Creating an event auto-switches the view to the new event's quarter so it's immediately visible</C>
        </>} />
        <Release versions="v1.8.69" date="Oct 15" title="Calendar Tab Removed from Publishing Hub" isCurrent={false} changes={<>
          <C type="fix">Removed duplicate Calendar tab from Publishing Hub Content section — calendar is managed in the dedicated Events page under Staff Hub</C>
          <C type="fix">S3 and all battalion staff (level 70+) can now edit and delete any public event, including past events and those created before owner tracking was added</C>
        </>} />
        <Release versions="v1.8.68" date="Oct 15" title="Announcement Cooldown & Daily Limit Alerts" changes={<>
          <C type="feat">Per-user 10-minute cooldown between email announcements — sending again too soon returns a toast with the exact minutes remaining</C>
          <C type="fix">If Resend's daily email limit is hit, the sender now sees a clear toast ("Daily limit reached — resumes tomorrow") instead of a silent failure; announcement still posts to the portal</C>
        </>} />
        <Release versions="v1.8.67" date="Oct 14" title="Company Performance: % Toward Goal" isCurrent={false} changes={<>
          <C type="feat">Company Performance bars now show each company's progress as a percentage of their own goal (0% = empty, 100% = goal met) — goal line removed; the bar track edge is the goal</C>
        </>} />
        <Release versions="v1.8.66" date="Oct 14" title="Fundraiser Leaderboard on Battalion Board" isCurrent={false} changes={<>
          <C type="feat">Moved fundraiser leaderboard from the Fundraiser tab to the Battalion Leaderboard page — now shows Battalion Top 5 overall and Top 3 per company alongside fitness scores</C>
        </>} />
        <Release versions="v1.8.65" date="Oct 14" title="Fundraiser Leaderboard" isCurrent={false} changes={<>
          <C type="feat">New Leaderboard tab on the fundraiser — Battalion Top 5 overall with medal rankings, and Top 3 per company in a grid view, both computed live from logged payments</C>
        </>} />
        <Release versions="v1.8.64" date="Oct 14" title="Fundraiser Company Selector" isCurrent={false} changes={<>
          <C type="fix">Log Payment modal now shows a company dropdown when "All Companies" is selected — previously silently defaulted to the admin's own company, now requires explicit selection and loads cadets for that company</C>
        </>} />
        <Release versions="v1.8.63" date="Oct 14" title="Email Subdomain" isCurrent={false} changes={<>
          <C type="fix">Switched announcement email sender to announcements@mail.pbhsjrotc.com — dedicated sending subdomain segments email reputation from root domain per Resend best practices</C>
        </>} />
        <Release versions="v1.8.62" date="Oct 14" title="Status Page & Footer Link" isCurrent={false} changes={<>
          <C type="feat">Added "System Status" link to site footer pointing to pbhsjrotc.instatus.com — cadets can check portal and email uptime at a glance</C>
          <C type="feat">Launched PBHS JROTC status page on Instatus with three monitored components: Portal, Email Notifications, and Database</C>
        </>} />
        <Release versions="v1.8.61" date="Oct 14" title="Email Deliverability Fixes" isCurrent={false} changes={<>
          <C type="fix">Changed announcement email sender from noreply@pbhsjrotc.com to announcements@pbhsjrotc.com — Resend flagged "no-reply" addresses as a deliverability risk</C>
          <C type="fix">PDF attachment links in emails now point to the portal announcements page instead of Firebase Storage — fixes Resend "link URLs must match sending domain" warning</C>
          <C type="feat">Added a yellow "View Announcement →" CTA button to every announcement email linking to the portal</C>
        </>} />

        <Release versions="v1.8.60" date="Oct 14" title="Announcement Forms" isCurrent={false} changes={<>
          <C type="feat">Staff can now attach a form to any global broadcast or company announcement — multiple questions, four types: short answer, paragraph, multiple choice, and checkboxes</C>
          <C type="feat">Any signed-in portal user can fill out and submit the form; responses are immutable and one per user (enforced by Firestore rules)</C>
          <C type="feat">Form creator controls whether responses are anonymous or attributed (stores name at submission time)</C>
          <C type="feat">Staff see a collapsible "Responses (N)" panel on any announcement with a form — shows all submitted answers attributed or anonymously per the form setting</C>
          <C type="feat">Forms and polls can both be added to the same announcement independently</C>
        </>} />
        <Release versions="v1.8.59" date="Oct 14" title="Announcement Polls" isCurrent={false} changes={<>
          <C type="feat">Staff can now attach a poll to any global broadcast or company announcement — question, up to 6 options, single or multi-choice, results visibility (always / after voting / never), and anonymous vs attributed responses</C>
          <C type="feat">Any signed-in portal user can vote on polls; votes are immutable and one per user per poll (enforced by Firestore rules)</C>
          <C type="feat">Results display as percentage bars with the voter's own picks highlighted in yellow; staff always see results regardless of visibility setting</C>
          <C type="feat">Polls appear on the public Announcements page and in the admin history cards for both global and company announcements</C>
        </>} />
        <Release versions="v1.8.58" date="Oct 14" title="Announcements: Titles + WebP / Image Attachments" isCurrent={false} changes={<>
          <C type="feat">Both global broadcasts and company announcements now support an optional title field — displays as a bold heading above the message on the admin portal and public announcements page</C>
          <C type="feat">Announcement attachments now accept WebP, JPEG, and PNG images in addition to PDFs — validated via magic-byte detection; images display inline on the public announcements page</C>
          <C type="fix">Attachment upload progress label changed from "Uploading PDF…" to "Uploading…" to reflect the new file types</C>
        </>} />
        <Release versions="v1.8.57" date="Oct 14" title="Calendar Date Picker — All Date Fields" isCurrent={false} changes={<>
          <C type="feat">Replaced every native date text input across the portal with the custom calendar popup — AdminAnnouncements, AdminAARLogs, AdminCamps, AdminContent, AdminEvents, AdminFundraiser, AdminMeetingLogs, AdminNewsletters, AdminParticipation, AdminS1, AdminS5, S1PromotionBoard (12 pages, 19 inputs)</C>
          <C type="fix">Board date in S1 Promotion Board now auto-saves immediately when a date is picked from the calendar instead of waiting for blur</C>
          <C type="fix">Removed YYYY-MM-DD format hint labels in AdminContent since the picker handles formatting</C>
        </>} />
        <Release versions="v1.8.56" date="Oct 13" title="Announcement Email Notifications" isCurrent={false} changes={<>
          <C type="feat">Global broadcasts now send an email to every approved portal user — subject "Battalion-Wide Broadcast — PBHS JROTC" with the announcement text, issuer, and optional PDF link</C>
          <C type="feat">Company announcements send an email to every approved user in that company only — subject "[Company] Company Announcement — PBHS JROTC"</C>
          <C type="feat">Users can opt out of announcement emails from My Profile → Email Announcements section; opted-in by default</C>
          <C type="fix">Announcement email logic merged into send-push endpoint to stay within Vercel Hobby's 12-function serverless limit; global broadcast now sends push and email in a single call</C>
        </>} />
        <Release versions="v1.8.55" date="Oct 13" title="Company Announcements: Visible on Dashboard for Battalion Staff" changes={<>
          <C type="feat">Battalion staff (L70+) now see all companies' announcements in the Command Feed on the admin dashboard — tagged by company name</C>
          <C type="feat">Company badge displayed on each post for staff so they can tell which company it's from at a glance</C>
          <C type="feat">PDF attachment link shown on feed cards when a PDF was attached to the post</C>
        </>} />
        <Release versions="v1.8.54" date="Oct 13" title="Company Announcements: Battalion Staff Can Post & Manage" isCurrent={false} changes={<>
          <C type="feat">Battalion leadership (L70+) can now see the Company Announcements section on /admin/announcements at all times — no longer hidden when no posts exist</C>
          <C type="feat">Battalion staff compose form includes a company selector dropdown — post to any company directly from the Global Broadcast page</C>
          <C type="fix">Firestore create rule updated: L70+ may post to any company; company command (L45–69) still restricted to their own company only</C>
        </>} />
        <Release versions="v1.8.53" date="Oct 14" title="Company Announcements: PDF Attachment Support" isCurrent={false} changes={<>
          <C type="feat">Company command team can now attach a PDF to company announcements — same upload flow as global broadcast</C>
          <C type="feat">PDF attachment link appears on posted announcements in the history panel and on the dashboard feed</C>
        </>} />
        <Release versions="v1.8.52" date="Oct 13" title="Company Announcements: Accessible to Company Command Team" isCurrent={false} changes={<>
          <C type="feat">Company XO, CC, and 1SG now see "Announcements" in the admin sidebar — links to /admin/announcements where they can post and view company-scoped announcements</C>
          <C type="feat">Route protection lowered to COMMAND_LEVEL (45+); global broadcast form is hidden from company command — they only see the company section</C>
        </>} />
        <Release versions="v1.8.51" date="Oct 13" title="Company Announcements Moved to /admin/announcements" isCurrent={false} changes={<>
          <C type="feat">Company announcements compose form and post history moved from admin dashboard to /admin/announcements — all announcement types now live in one place</C>
          <C type="fix">Removed redundant company announcements section from admin dashboard; cleaned up unused imports and state</C>
        </>} />
        <Release versions="v1.8.50" date="Oct 13" title="Company Announcements — Company Command Can Broadcast to Their Company" isCurrent={false} changes={<>
          <C type="feat">Company command team (CC, XO, 1SG) can now post announcements visible only to their own company's cadets from the admin dashboard</C>
          <C type="feat">Battalion staff (L70+) see all companies' posts together, tagged by company name</C>
          <C type="feat">Posts appear on the admin dashboard Command Feed area only — not on the public /announcements page</C>
          <C type="feat">Company leadership and battalion staff can delete posts; stored in a separate companyAnnouncements Firestore collection</C>
        </>} />
        <Release versions="v1.8.49" date="Oct 13" title="Knowledge Tab: X/Y Inputs and Removed Inputs for Simple Categories" isCurrent={false} changes={<>
          <C type="feat">Countable categories (Duties, Ranks, Principles) now show two inputs separated by a slash — enter required/total (e.g. 5/11 for Principles of Leadership)</C>
          <C type="feat">All-or-nothing categories (Cadet Creed, LDRSHIP, JROTC Meaning, LET Meaning, Mission Statement, SAI/AI, Definition of Leadership) no longer show a count input</C>
          <C type="feat">Testing mode badge now shows "Must know X/Y items" when both values are set</C>
        </>} />
        <Release versions="v1.8.48" date="Oct 13" title="Chain of Command: Collapsible List + Platoon/Squad Positions" isCurrent={false} changes={<>
          <C type="feat">CoC position list is now collapsible — click the summary row to hide/show the full list; shows selected count when collapsed</C>
          <C type="feat">Added Platoon Leader, Platoon Sergeant, Squad Leader, and Squad Member to the selectable CoC positions</C>
        </>} />
        <Release versions="v1.8.47" date="Oct 13" title="Chain of Command: Position Selector in Knowledge Tab" isCurrent={false} changes={<>
          <C type="feat">Battalion Chain of Command category in the Knowledge tab now shows an inline position checklist instead of a number input — select exactly which positions a cadet must name</C>
          <C type="feat">During testing mode, the Chain of Command question card lists the required positions by name as a proctor reference</C>
        </>} />
        <Release versions="v1.8.46" date="Oct 13" title="Required Knowledge: Per-Category Item Count" isCurrent={false} changes={<>
          <C type="feat">Knowledge tab now shows a number input next to each checked category — set how many items the cadet must recite (e.g. 5 for "5/11 Principles of Leadership")</C>
          <C type="feat">During testing mode, the question card shows a "Must know N items" badge when a count is set for that category</C>
        </>} />
        <Release versions="v1.8.45" date="Oct 13" title="Per-Position Required Knowledge in Testing Mode" isCurrent={false} changes={<>
          <C type="feat">S1 editor now has a "Knowledge" tab per position — check/uncheck which of the 11 categories that position is required to know at a board</C>
          <C type="feat">Testing mode now only asks the categories required for the cadet's position; unchecked categories are skipped and not scored</C>
          <C type="feat">Pick phase Board Overview reflects the filtered category count before the test begins</C>
        </>} />
        <Release versions="v1.8.44" date="Oct 13" title="Testing Mode: Search Bar & Chain of Command Fix" isCurrent={false} changes={<>
          <C type="feat">Cadet selection in testing mode is now a search bar — type 2+ characters to filter by name; results appear as a dropdown, click to select</C>
          <C type="fix">Battalion Chain of Command answer key now shows only battalion command and company command positions (Battalion Commander → Master Sergeant) — no longer lists every squad leader in the battalion</C>
        </>} />
        <Release versions="v1.8.43" date="Oct 13" title="Answer Keys: Duties from S1, Chain of Command from Roster" isCurrent={false} changes={<>
          <C type="feat">Testing mode "List All Duties" answer key now shows the cadet's duties from the S1 Position Requirements editor (live, per position)</C>
          <C type="feat">Testing mode "Battalion Chain of Command" answer key now builds the full chain from the live roster — every filled position ordered highest to lowest</C>
          <C type="fix">Updated all static answer keys (Cadet Creed, LDRSHIP, Principles of Leadership order, JROTC/LET meanings, Leadership Definition) to match official battalion references</C>
        </>} />
        <Release versions="v1.8.42" date="Oct 13" title="SAI/AI Answer Key Pulls Live from Leadership Page" isCurrent={false} changes={<>
          <C type="feat">Testing mode SAI & AI answer key now reads live from the Firestore instructors collection (same source as the public Leadership page) — shows each instructor's name and role; no longer shows blank for that category</C>
        </>} />
        <Release versions="v1.8.41" date="Oct 13" title="Answer Key in Testing Mode" isCurrent={false} changes={<>
          <C type="feat">S1 testing mode now shows a collapsible Answer Key for each category with a fixed answer — Cadet Creed, LDRSHIP (with definitions), JROTC Meaning, LET Meaning, Mission Statement, Definition of Leadership, Cadet Ranks, and Principles of Leadership; battalion-specific categories (Chain of Command, SAI/AI, All Duties) show no key</C>
        </>} />
        <Release versions="v1.8.40" date="Oct 13" title="Remove Team Lead from Position List" isCurrent={false} changes={<>
          <C type="fix">Permanently removed "Team Lead" from JROTC_POSITIONS — it was never a valid JROTC position; the position dropdown in user management, the S1 editor, and the promotion board no longer show it</C>
        </>} />
        <Release versions="v1.8.39" date="Oct 12" title="Battalion Staff & Command Tabs on Public Promotion Board" isCurrent={false} changes={<>
          <C type="feat">Public /promotion-board now shows Battalion Staff (S-1 through S-7) and Battalion Command (Sergeant Major, Battalion XO, Deputy Commander, CSM, Commander) as separate tabs with the same sidebar-selector layout as Staff Assistants</C>
          <C type="feat">All battalion-level position requirements are sourced from S1 position requirements editor — same live Firestore subscription as all other positions</C>
        </>} />
        <Release versions="v1.8.38" date="Oct 12" title="S1 Is Full Source of Truth — Duties Editor & Publishing Hub Removed" isCurrent={false} changes={<>
          <C type="feat">S1 Position Requirements editor is now always visible (no active board required) and saves directly to pageContent/promotion-board — changes appear on the public page instantly</C>
          <C type="feat">Added a Duties &amp; Responsibilities section to the S1 Position Requirements editor — items are managed per-position with the same add/remove/reorder controls as the checklist</C>
          <C type="feat">Public /promotion-board page now reads exclusively from positionRequirements in pageContent/promotion-board (set by S1) — the Publishing Hub data structures are no longer used</C>
          <C type="feat">Removed the Promotion Board tab from Publishing Hub entirely — all promotion board content is now managed through the S1 tab</C>
        </>} />
        <Release versions="v1.8.37" date="Oct 12" title="Remove Green Section from Public Promotion Board" isCurrent={false} changes={<>
          <C type="feat">Removed the "What to Prepare for This Board" green card from the public /promotion-board page — the page now only shows the yellow Promotion Board Requirement and blue Duties & Responsibilities cards, both sourced from Publishing Hub content</C>
        </>} />
        <Release versions="v1.8.36" date="Oct 12" title="S1 Is Single Source of Truth for Position Requirements" isCurrent={false} changes={<>
          <C type="feat">Removed the "Board Requirements by Position" editor from Publishing Hub — the S1 Position Requirements editor is now the sole place to manage promotion board requirements; edits made there mirror automatically to the public /promotion-board page (existing S1 mirror logic)</C>
          <C type="fix">New boards created in S1 always start from the default position requirements instead of an outdated snapshot from Publishing Hub</C>
        </>} />
        <Release versions="v1.8.35" date="Oct 12" title="Leaderboard — Zero Firestore Errors Guaranteed" isCurrent={false} changes={<>
          <C type="fix">Public /leaderboard page now never opens a Firestore subscription regardless of auth state or role — always uses the service-account API; Firestore is reserved strictly for /admin/leaderboard at L70+, eliminating all possible permission-denied errors on the public route</C>
        </>} />
        <Release versions="v1.8.34" date="Oct 12" title="Leaderboard Permission Fix — Roster & Fundraiser" isCurrent={false} changes={<>
          <C type="fix">Eliminated all Firestore permission-denied errors on the Battalion Leaderboard — roster requires L70+ for a full collection read, so cadets and company leadership below L70 now use the public API endpoint (which returns the same data via service account); L70+ battalion staff keep live Firestore updates for all three collections</C>
        </>} />
        <Release versions="v1.8.33" date="Oct 12" title="Leaderboard Fundraiser Permission Fix" isCurrent={false} changes={<>
          <C type="fix">Eliminated Firestore permission-denied console error on the Battalion Leaderboard for cadets below L70 — the fundraiser Top Raised subscription now only runs for L70+ users who can actually read the full fundraiserEntries collection; lower-level cadets simply don't see the Top Raised panel, which was already the effective behavior</C>
        </>} />
        <Release versions="v1.8.32" date="Oct 12" title="Leaderboard Live Updates Restored" isCurrent={false} changes={<>
          <C type="fix">Battalion Leaderboard now uses live Firestore updates for all signed-in users on both the public and admin routes — Firestore rules already allow any authenticated cadet to read all cadetChallengeRecords with no company restriction, so there is no security concern; unauthenticated visitors still fall back to the cached API endpoint</C>
        </>} />
        <Release versions="v1.8.31" date="Oct 12" title="Leaderboard Shows All Companies When Signed In" isCurrent={false} changes={<>
          <C type="fix">Public Battalion Leaderboard (/leaderboard) now shows all companies regardless of whether the viewer is signed in — previously, signed-in cadets were restricted to their own company by Firestore security rules; the public route now always uses the service-account API endpoint so every cadet sees the full board</C>
        </>} />
        <Release versions="v1.8.30" date="Oct 12" title="Unified Promotion Board Requirements" isCurrent={false} changes={<>
          <C type="feat">Publishing Hub → Promotion Board now includes a "Board Requirements by Position" editor — select any JROTC position, add/edit/remove requirement line items, and add proctor notes; saved alongside rank knowledge and duties in a single Save click</C>
          <C type="feat">Requirements edited in Publishing Hub are the single source of truth — they appear on the public /promotion-board page immediately and are shown to proctors in S1 Testing Mode in real time (live Firestore subscription)</C>
          <C type="feat">New board drafts created in S1 now seed their position requirements from Publishing Hub, so proctors always start from the current published set</C>
          <C type="fix">Fixed a silent data-loss bug where saving rank knowledge/duties in Publishing Hub would wipe previously stored position requirements from Firestore (setDoc without merge was overwriting the field)</C>
        </>} />
        <Release versions="v1.8.9 – v1.8.29" date="Oct 12" title="Leadership Tasks, Command Feed Overhaul & Broadcasts" isCurrent={false} changes={<>
          <C type="feat">Leadership Calendar — tasks can now be created with a title, due date, priority (high/medium/low), and notes; tasks appear as violet chips on the calendar grid on their due date; panel below the calendar lists overdue, upcoming, and completed tasks</C>
          <C type="feat">Battalion staff (L70+) can create assigned tasks targeting all leadership, specific companies, specific positions, or any combination — two independent pickers (company pill toggles + position checkboxes) with AND logic between them</C>
          <C type="feat">Assigned tasks track completion per company — each company's leadership marks their own copy done; battalion sees "X co. ✓" progress and can credit/uncredit any company via the task detail popover</C>
          <C type="feat">Task row shows a people icon (violet = none, amber = some, green = all done) instead of a misleading empty checkbox for tasks the viewer can't complete</C>
          <C type="feat">Command Feed "My Action Items" now shows battalion-assigned leadership tasks with due dates, overdue indicators, and priority flags; company leadership can mark tasks complete from the dashboard</C>
          <C type="feat">Command Feed "Global Broadcasts" section shows active announcements — replaces legacy orders feed; battalion staff see a prompt to manage tasks from the Leadership Calendar</C>
          <C type="feat">Global Broadcast form now supports an optional expiry date (broadcast disappears automatically) and an optional PDF attachment (uploaded to Firebase Storage, linked on the dashboard and public Announcements page)</C>
          <C type="feat">Task forms and event form now use a calendar popup date picker instead of the native browser date input</C>
          <C type="feat">Honor Company Pending Approvals table now shows a Notes column before approving or rejecting an entry</C>
          <C type="feat">Fundraiser — weekly bars now show a yellow goal line; new Company Pace chart shows every company's total raised vs. expected cumulative goal for the current week</C>
          <C type="fix">Creators can now edit and delete their own public events regardless of rank — Firestore rule was silently rejecting edits from non-L70 creators; create still requires L70+</C>
          <C type="fix">Task detail popover syncs live with Firestore — was holding a stale snapshot until closed and reopened</C>
          <C type="fix">Removed Orders &amp; Tasks page and sidebar link — fully replaced by the leadership calendar task system</C>
          <C type="fix">404 page secondary button now links to Events instead of the unrelated Battalion Teams page</C>
          <C type="fix">Staff Hub S3 / AAR Logs / Meeting Logs — auth timing, composite index, and permission-denied errors resolved for company leadership</C>
          <C type="fix">AAR Logs now match regardless of stored company name casing (e.g. "BRAVO" vs "Bravo")</C>
        </>} />
        <Release versions="v1.8.8" date="Oct 12" title="Fundraiser, Calendar, Leaderboard & Stability" isCurrent={false} changes={<>
          <C type="fix">Fundraiser — bar chart tracks now use a solid visible background so the goal (full track width) is clearly readable in both light and dark mode</C>
          <C type="feat">Fundraiser — added Battalion HQ filter option and a dedicated Weekly tab with per-week bar chart; battalion leadership can filter by company and view week-over-week progress vs. goal</C>
          <C type="feat">Fundraiser — Company Performance bars now compare total raised against the full fundraiser goal (all weeks); Battalion HQ entry included in the graph</C>
          <C type="fix">Fundraiser — weekly bar chart scales each bar independently to its own goal so fill reads as % toward goal; bars styled to match Company Performance chart</C>
          <C type="fix">Calendar — No School events set as a date range now correctly suppress Blue/Gold day labels for every day in the range, not just the first and last dates; fix applied to both the public calendar and the leadership calendar</C>
          <C type="fix">Calendar — Google Calendar subscribe URL corrected to /settings/addbyurl?url= endpoint; Apple Calendar subscribe button changed to a native anchor tag for reliability across Chrome, Safari, and iOS</C>
          <C type="fix">Calendar subscriptions now work reliably — /api/calendar.ics falls back to service-account auth; Apple Calendar modal includes Mac/Chrome copy-URL tip</C>
          <C type="fix">Leadership Cal sub-tab removed from S3 Operations — use the dedicated /admin/leadership-calendar sidebar link instead</C>
          <C type="fix">Publishing Hub now recovers correctly after new deploys — chunk-preload error handler keys its reload flag on the chunk URL hash so each new deploy gets a fresh attempt; second failure navigates with a cache-buster URL</C>
          <C type="fix">Publishing Hub no longer redirects away mid-load — AdminLeadership sub-component waits for auth to resolve before checking permissions</C>
          <C type="fix">Battalion Leaderboard (/leaderboard) now loads for unauthenticated visitors — new /api/leaderboard.json edge function reads roster and fundraiser data via service account; Top Raised section renamed from "Top Donors" and made fully public</C>
          <C type="feat">Login notification presets updated to include all recent v1.8 updates</C>
        </>} />
        <Release versions="v1.8.7" date="Oct 8" title="Fix Infinite Page Reload on Login" isCurrent={false} changes={<>
          <C type="fix">Fixed infinite reload loop that affected specific accounts after a new deploy — the chunk-preload error handler now uses a sessionStorage flag so it only attempts one reload per session; if the reload still fails (browser returned stale cached HTML), it stops rather than looping</C>
        </>} />
        <Release versions="v1.8.6" date="Oct 8" title="Leadership Calendar Live Subscription" isCurrent={false} changes={<>
          <C type="feat">Leadership calendar is now a live auto-updating subscription — subscribe in Apple Calendar, Google Calendar, or Outlook via webcal:// URL; events sync automatically every 6 hours</C>
          <C type="feat">New /api/leadership-calendar.ics edge function — uses a Firebase service account to read the private leadershipCalendar collection (bypasses security rules for the feed only); protected by a secret token in the URL</C>
          <C type="feat">Subscribe modal on Leadership Calendar now mirrors the public calendar's subscribe UX — one-tap Apple Calendar button, Google Calendar link, and a copyable URL for Outlook</C>
          <C type="fix">Snapshot download still available as a fallback ("Or download snapshot") for cases where the subscription URL can't be used</C>
        </>} />
        <Release versions="v1.8.5" date="Oct 8" title="Leadership Calendar Export & Blue/Gold Days" isCurrent={false} changes={<>
          <C type="feat">Leadership Calendar now shows Blue/Gold day indicators (B/G) in the top-right of each school-day cell — reads from the same blueGoldCalendar settings document as the public calendar</C>
          <C type="feat">"Today is a Blue/Gold Day" banner at the top of the leadership calendar on school days</C>
          <C type="feat">Export button on the Leadership Calendar toolbar — downloads a private .ics file with all events (public + leadership-only) for import into iPhone Calendar, Google Calendar, or Outlook; private events are marked with a lock emoji</C>
          <C type="fix">Export modal includes step-by-step iOS and Google Calendar import instructions, and a reminder not to share the file outside command staff</C>
        </>} />
        <Release versions="v1.8.4" date="Oct 8" title="Public Calendar Redesign & iCal Subscription" isCurrent={false} changes={<>
          <C type="feat">Public Events calendar (/events) redesigned to match the Leadership Calendar style — full-width month grid with event title chips on each day cell, colour-coded by category, replaces the old square-cell dot-indicator layout</C>
          <C type="feat">Public calendar now includes a Subscribe button — opens a modal with one-tap "Add to Apple Calendar" (webcal://), "Add to Google Calendar" link, and a copyable URL for Outlook and other apps</C>
          <C type="feat">iCalendar feed endpoint at /api/calendar.ics — served with proper text/calendar headers; Calendar apps can subscribe and events will auto-update every 6 hours</C>
          <C type="feat">Monthly Agenda grid below the calendar replaces the old right sidebar — events shown in a responsive 1-to-3 column card grid with type badge, location, time, and description</C>
          <C type="fix">Blue/Gold day indicators (B/G letter) moved to the top-right corner of each cell so they don't compete with event chips</C>
        </>} />
        <Release versions="v1.8.3" date="Oct 8" title="Footer on All Pages, Calendar View & Merged Event Creation" changes={<>
          <C type="feat">Leadership Calendar (S3 sub-tab) rewritten as a proper month-grid calendar view — shows events from both the public calendar and private leadership calendar with month navigation and an event detail popover on click</C>
          <C type="feat">Public and private events are colour-coded in the calendar grid (blue = public, yellow = private) and private events carry a lock icon to distinguish them at a glance</C>
          <C type="feat">Calendar Events (S3 sub-tab) now supports creating private events directly — a toggle in the event form marks an event as private; private events are saved to the leadershipCalendar collection and are visible only to L45+</C>
          <C type="feat">Private event creation in Calendar Events allows setting audience (All Leadership or a specific company) using the same scope model as the standalone leadership calendar</C>
          <C type="feat">Personnel Hub and Staff Hub now have distinct sidebar icons — Personnel Hub keeps the Users icon while Staff Hub uses a Briefcase icon</C>
          <C type="fix">Footer now appears on every admin page — moved from individual page components into AdminLayout so no page can be missing it</C>
          <C type="fix">Duplicate Footer instances removed from AdminDashboard and ActivityLog (now rendered by AdminLayout only)</C>
          <C type="fix">Login Notifications reworked — empty state now shows two buttons: "Create from Scratch" (blank form) and "Announce an Update" (opens version picker showing v1.8.0 and v1.8.2 presets with feat/fix counts)</C>
          <C type="fix">Changelog page now expands to full viewport width on wide screens — removed hardcoded max-w-3xl wrapper that was leaving a dead space gap on the right</C>
          <C type="fix">Activity Log filter tabs now span the full page width — removed max-w-5xl constraints that were cutting off the tab bar and causing a left-side footer gap</C>
          <C type="fix">Fundraiser sidebar link now correctly visible to all battalion staff L70+ — condition was checking L80+ instead of L70+</C>
        </>} />
        <Release versions="v1.8.2" date="Oct 8" title="Collapsible Sidebar, Fundraiser Permissions & Staff Tab Labels" isCurrent={false} changes={<>
          <C type="feat">Sidebar now collapses to icon-only mode on desktop — click the chevron to toggle; icons expand to 20 px and each has a smooth animated tooltip on hover; preference persists across reloads</C>
          <C type="feat">Leadership Calendar is now accessible as a dedicated route (/admin/leadership-calendar) for all command leadership (L45+), with a direct sidebar link — no longer buried inside Staff Hub → S3</C>
          <C type="feat">All battalion staff (L70+) can now view the full cross-company fundraiser view and log payments for any company — previously only S1, S3, and company COs had full access</C>
          <C type="feat">Staff Hub tab labels renamed to reflect their function: S1 Personnel · S2 Intel · S3 Operations · S4 Supply · S5 Affairs · S6 Technology</C>
          <C type="fix">Leadership Calendar Firestore permission-denied error fixed — leadershipCalendar collection now has an explicit security rule (read: L45+, write: L70+); all data loads correctly</C>
          <C type="fix">Opening/closing the fundraiser period is now restricted to S1, S3, and Top 3 only (Battalion XO, CSM, Commander) — no longer available to all L70+ staff</C>
          <C type="fix">S6 Login Notification "Load Preset" crash fixed — X icon was referenced but not imported from lucide-react</C>
          <C type="fix">Removed redundant "Back to Dashboard" link from the top of every admin page — the Dashboard icon in the sidebar already handles this</C>
          <C type="fix">Sidebar "Back to Home" link now uses a House icon instead of a left arrow — eliminates confusion with the collapse chevron sitting above it</C>
          <C type="feat">Content area gains extra left padding when the sidebar is collapsed so pages don't hug the left edge</C>
        </>} />
        <Release versions="v1.8.0" date="Oct 6" title="Navigation Overhaul, Permissions, Leadership Calendar & Fundraiser" changes={<>
          <C type="feat">Staff Hub expanded — S3 now includes Calendar Events and Honor Company as sub-tabs; S1 now includes Camp Attendance and Participation Tracker as sub-tabs; S6 now includes Battalion Stats as a sub-tab</C>
          <C type="feat">Programs Hub removed — Camp Attendance and Participation Tracker consolidated into S1 inside Staff Hub</C>
          <C type="feat">Battalion Stats moved from Publishing Hub into S6 inside Staff Hub</C>
          <C type="feat">Calendar Events admin page moved from its own route into S3 inside Staff Hub</C>
          <C type="feat">Honor Company moved from its own route into S3 inside Staff Hub</C>
          <C type="feat">Admin sidebar categories removed — navigation flattened into a clean logical order with no section headers</C>
          <C type="feat">Battalion Leaderboard made public — accessible to all visitors at /leaderboard under the Battalion navbar dropdown (desktop and mobile)</C>
          <C type="feat">Top Donors section moved from Fundraiser page into the public Battalion Leaderboard (visible to staff+ only)</C>
          <C type="feat">Fundraiser roster "All Companies" view now correctly shows the full battalion roster with LET level grouping toggle</C>
          <C type="feat">Fundraiser goals bar shows battalion-wide totals when viewing all companies; switches to company-specific totals per selection</C>
          <C type="feat">Participation Tracker — new admin page to log cadets for named events (swim meets, community service, etc.) with company breakdown counts; cadets added via typeahead search; each cadet can only be logged once per event</C>
          <C type="feat">S6 Technology role can now access and send Global Broadcast announcements</C>
          <C type="feat">Staff Hub tab visibility now fully role-gated — each S1–S6 tab and every sub-tab is shown or hidden based on the cadet's role level rather than a flat role allowlist</C>
          <C type="feat">S1 sub-tabs: Form Tracker visible to L45+ and company S-staff assistants; Promotion Board limited to 1SG/XO/CC (company-scoped) and battalion S1-S7+SGM; Camp Attendance and Participation Tracker restricted to battalion staff L70+ (CC and below cannot see them)</C>
          <C type="feat">Promotion Board: battalion S1-S7+SGM can edit cadet info but cannot create new board events or modify requirements and dates; 1SG/XO/CC see only their own company records</C>
          <C type="feat">Meeting Logs: company-scoped access groups added — Whole Company, PLT LDR + SGT, Company Staff, Top 3 Only; logs created by company leaders (L45-69) are tagged with their company and are only visible to members of that company; battalion-level creators retain all existing battalion-wide access groups</C>
          <C type="feat">Honor Company: non-admin staff (L70-79) now submit point/penalty logs as pending; BC/CSM/XO (L85+) see a Pending Approvals panel and can approve or reject each submission; only approved entries count toward company totals</C>
          <C type="feat">Calendar Events: S7/S5/S4/S2 at L70 can only edit and delete their own events; L80+ (admin) can manage all events</C>
          <C type="feat">Route gate for Staff Hub lowered to minLevel 5 so all authenticated cadets can access their applicable tabs</C>
          <C type="feat">S4 sub-tabs: Uniform Sizes and Uniform Items limited to company S4/S3/S1 assistants and L45+; Supply Requests accessible from L12+</C>
          <C type="feat">S6 sub-tabs: Checklist visible to company S6 assistant and L50+; Battalion Stats, Activity Log, Login Notifications, and Feedback Hub gated to battalion staff or senior command</C>
          <C type="feat">New Leadership Calendar added as a sub-tab inside S3 — private calendar only visible to battalion leadership (L70+) and company CC, XO, and 1SG (L45+)</C>
          <C type="feat">Battalion staff (L70+) can create, edit, and delete leadership events; company leadership has view-only access to their applicable events</C>
          <C type="feat">Events can be scoped to All Leadership (visible to all L45+) or a Specific Company (visible to that company's leadership plus all battalion staff)</C>
          <C type="feat">Scope badges on each event card show audience at a glance: purple "Co" badge for company-scoped events, grey "All Leadership" for battalion-wide events</C>
          <C type="feat">Leadership events stored in a separate Firestore collection (leadershipCalendar) — fully independent from the public events calendar</C>
          <C type="feat">S1 assistant can now edit LET level, gender, platoon, and squad on cadets with linked portal accounts</C>
          <C type="feat">Honor Company: per-company tabs with click-to-edit spreadsheet and Change History panel showing every past edit</C>
          <C type="feat">Roster create form now asks for LET level first — LET 1 auto-fills Squad Member as the default position</C>
          <C type="fix">Leaderboard page now matches public page layout — proper navbar spacing, no admin back-button, compact donors table</C>
          <C type="fix">Fundraiser: Check payment type restored (Cash + Check + E-Store)</C>
          <C type="fix">Fundraiser: Voided donations no longer count toward cadet totals on the My Profile page</C>
          <C type="fix">Participation Tracker page crash caused by passing a JSX element instead of a component reference to AdminPageHeader — fixed</C>
          <C type="fix">Removed special Unicode characters (checkmark, middle dot) from Honor Company page that could render as emoji on some devices</C>
          <C type="fix">Home page Battalion Bulletins "Signed:" label now shows the issuer's name instead of being blank</C>
          <C type="fix">Sub-tab default selection now dynamically picks the first accessible sub-tab for each user instead of always defaulting to the first slot (which may be hidden)</C>
          <C type="fix">Honor Company spreadsheet saves use atomic replace so typing 0 correctly clears the cell; Firestore delete permission aligned to staff level (70)</C>
          <C type="fix">Class B shirt sizes now use collar sizing; shoe width dropdown shows full label</C>
          <C type="feat">Zulu company removed from the UI — all pages now display 'Battalion' via a centralised normalizeCompany utility; no data migration required</C>
          <C type="feat">useCompanies hook now correctly includes 'Battalion'; all dropdowns (e.g. Uniform Requests) now offer Battalion as an option</C>
          <C type="feat">Activity Log type filter now includes a "Leadership Cal" category for searching leadership calendar actions</C>
          <C type="fix">Leadership Calendar actions (create, edit, delete) now log correctly to the Activity Log with a distinct purple "Leadership Cal" badge</C>
          <C type="fix">Battalion staff assigned to the Zulu HQ company now default to the All Companies view when opening the Fundraiser — Zulu no longer appears as a selectable filter option</C>
          <C type="fix">Company list dropdowns across the portal now always source names from the live Firestore list plus a hardcoded Battalion option — no hardcoded lettered companies anywhere</C>
          <C type="fix">MyProfile page company display simplified — Zulu and Battalion users both see 'Battalion'</C>
          <C type="fix">AdminRoster, S1PromotionBoard, AdminCadetChallenge, AdminLeaderboard, AdminHonorCompany, AdminFundraiser, AdminLeadership, AdminS5, SignUp, and UniformRequests all updated to normalise company names before display</C>
        </>} />
      </Minor>

      {/* ── v1.7 ERA ──────────────────────────────────────────────────── */}
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-600 mb-3 px-1 mt-6">Public Tools &amp; Security</p>

      <Minor version="v1.7" title="Public Tools & Security" date="Sep 3 – 27, 2026" isMajor>

        <Release versions="v1.7.30" date="Sep 22" title="Meeting Logs — Granular Access Control" changes={<>
          <C type="fix">S1 assistant can now edit LET level, gender, platoon, and squad on cadets with linked portal accounts — previously all fields were locked</C>
          <C type="fix">Class B shirt sizes now use collar sizing (13, 13.5, 14 … 20 with S/R/L length) instead of S/M/L letter sizing</C>
          <C type="fix">Shoe width dropdown is wider so the full label (N (Narrow), R (Regular), W (Wide)) is visible</C>
          <C type="feat">Roster create form now asks for LET level first — LET 1 auto-fills Squad Member as the default position</C>
          <C type="feat">Honor Company: per-company tabs with spreadsheet-style inline editing — click any category cell to set points directly (logs a delta entry to the audit trail)</C>
        </>} />

        <Release versions="v1.7.30" date="Sep 22" title="Meeting Logs — Granular Access Control" changes={<>
          <C type="feat">Meeting log visibility is now configurable per-log: choose from Battalion Staff, Company Leadership, Top 3 Only, or any individual S-staff position (S1–S7) — multiple groups can be selected at once</C>
          <C type="feat">Logs with no groups selected default to all battalion staff (70+); existing logs with company access flag are backward-compatible</C>
          <C type="feat">View mode shows a "Visible To" badge list for all selected access groups</C>
        </>} />

        <Release versions="v1.7.29" date="Sep 17" title="Version History & Footer Update" changes={<>
          <C type="feat">Version History now displays newest versions first (v1.7 at top, v0.1 at bottom) — the current release era is open by default</C>
          <C type="fix">Footer portal version updated to v1.7.29; version history stat bar reflects current patch count</C>
        </>} />

        <Release versions="v1.7.28" date="Sep 17" title="S5 Shop — Projects, PDFs & Publish Workflow" changes={<>
          <C type="feat">Special Projects now support tasks and subtasks — add tasks inline via pencil/edit mode on any project card, then add subtasks under each task; completions tracked per-assistant per-task and per-subtask independently</C>
          <C type="feat">Publish workflow added to all S5 Shop item types — items save as Draft and only become visible to assistants once explicitly published; S5 can toggle Live / Draft at any time</C>
          <C type="feat">PDF attachment support on all S5 Shop items (assignments, posts, and projects) — upload via Firebase Storage; file links shown to both S5 management view and assistant self-service view</C>
          <C type="feat">Start Date field added alongside Due Date on all S5 Shop items; both shown in the management and assistant views</C>
          <C type="fix">Both S5 Public Affairs and Company S5 Assistants can mark completions on tasks and subtasks; assistant view now correctly shows only published items</C>
        </>} />

        <Release versions="v1.7.27" date="Sep 15" title="Roster — Graduate Hard-Delete" changes={<>
          <C type="law">Graduating a cadet now permanently deletes their roster entry and all associated records (fundraiser entries, uniform sizes, cadet challenge records, form submissions, year-end history, S5 Shop completions) to comply with privacy policy</C>
          <C type="fix">Graduation confirmation dialog updated to reflect permanent deletion with clear warning that the action cannot be undone</C>
        </>} />
        <Release versions="v1.7.26" date="Sep 14" title="S5 Shop — Public Affairs Task Tracker" changes={<>
          <C type="feat">New page: S5 Shop (/admin/s5-shop) — S5 Public Affairs officer can create and track tasks for their company assistants across three categories: Assignments, Posts, and Special Projects</C>
          <C type="feat">Each task card shows a checklist of all Company S5 Assistants (pulled live from the battalion roster) with a completion toggle per assistant; S5 can check off completions, and assistants can self-report their own items done</C>
          <C type="feat">Task cards display a progress pill (e.g. 3/5), optional description, optional due date with overdue highlighting, and expand/collapse to show the assistant completion grid with completion dates</C>
          <C type="feat">Company S5 Assistants get a personal task view showing all current assignments, posts, and special projects with a checkbox to mark their own items complete; S5 Shop link added to sidebar for both S5 and all Company S5 Assistants</C>
        </>} />

        <Release versions="v1.7.25" date="Sep 10" title="Fundraiser — Position List Fix & Battalion Total" changes={<>
          <C type="fix">Position list in Settings and Goals now matches the actual roster positions (Battalion Commander → CSM → Deputy Commander → XO → SGM → Staff S-1/S-7 → Company Commander → XO → MSG → 1SG → Company Assistants → Platoon Leader → Platoon Sergeant → Squad Leader → SLA → Squad Member); Team Lead removed from requirements; Battalion Deputy Commander added at 80 flags</C>
          <C type="feat">Goals tab company table now includes a Battalion Total row — sums all companies' cadets, total flags, total dollar goal, weekly flag target, weekly dollar target, and total raised so far</C>
        </>} />

        <Release versions="v1.7.24" date="Sep 10" title="Fundraiser — Company Goals View & Position Ordering" changes={<>
          <C type="feat">Goals tab now accessible to all full-access users (company commanders, XOs, 1SGs, MSgts) — previously only battalion staff could see it</C>
          <C type="feat">Company view in Goals tab: company-level users see only their own company's data — goal stat cards (total and weekly) plus a weekly progress bar chart with a bar for each fundraiser week and a cumulative total bar; the total bar includes a yellow pace marker that advances each week to show how much should have been raised by now</C>
          <C type="feat">Company Performance Graph (cross-company comparison bars) restricted to battalion staff (canViewAll) — company commanders no longer see other companies' fundraiser progress</C>
          <C type="feat">Positions in the Settings tab and Goals tab position breakdown now sort in correct military hierarchy order (Battalion Commander → CSM → XO → SGM → Staff S-1 through S-7 → Company Commander → XO → 1SG → MSG → Platoon Leader → Platoon Sergeant → Team Lead → Squad Leader → SLA → Company Assistants → Squad Member)</C>
        </>} />

        <Release versions="v1.7.23" date="Sep 10" title="Fundraiser — Per-Position Requirements Editor" changes={<>
          <C type="feat">Fundraiser page gains a Settings tab (visible to BN XO, S1, BN Commander, BN CSM, and admin) — set the fundraiser start/end date and individually edit the flag requirement for every position in the battalion; the system auto-calculates the number of weeks and each company's total + weekly flag goal based on who is in each position</C>
          <C type="feat">Goals tab added to the Fundraiser page — full table of every company's total flag goal (all weeks), total dollar goal, weekly flag target, and weekly dollar target alongside how many flags they've actually raised so far; a position breakdown panel shows every position's configured requirement</C>
          <C type="feat">Company goal summary bar now appears in all company views on the Fundraiser page (Transactions + Roster tabs) — shows total flags required, weekly flag/dollar target, and the fundraiser date range at a glance</C>
          <C type="feat">Battalion Stats page fundraiser bars now use the same position-based goal calculation — each company's weekly goal marker reflects their actual position-requirement total divided by weeks, not a flat per-cadet dollar amount; Manage button navigates to the Fundraiser Settings tab</C>
        </>} />

        <Release versions="v1.7.22" date="Sep 10" title="Fundraiser Requirements & Weekly Goals" changes={<>
          <C type="feat">Fallen Heroes Fundraiser card on Battalion Stats now has a "Manage" button — XO and S1 can set a per-cadet fundraising goal and a start/end date for the fundraiser; the system auto-calculates the number of weeks and derives each company's weekly dollar target from per-cadet goal × company roster size</C>
          <C type="feat">Per-company weekly goal lines now appear on the fundraiser progress bars instead of a single static battalion goal; each company's target adjusts automatically as the roster changes</C>
          <C type="feat">Fundraiser timeline chip shows the start → end date range and week count so staff can see progress at a glance; a prompt appears when dates or goal haven't been set yet</C>
          <C type="fix">Team Participation section removed from Battalion Stats — it was showing stale data from the specialTeams collection and is no longer needed in this view</C>
        </>} />

        <Release versions="v1.7.21" date="Sep 10" title="Battalion Stats — Roster Fix" changes={<>
          <C type="fix">Battalion Stats page was reading headcounts from the portal accounts (users) collection instead of the full roster — cadets without a portal account were invisible to every chart; switched all roster breakdowns (Total Roster tile, Roster by Company, by Rank, by LET Level) to the roster collection</C>
          <C type="fix">Roster by Company now normalizes legacy "Zulu" entries into the "Battalion" bucket so they don't appear as a separate bar; companies are also now sorted in defined order (Alpha, Bravo, Charlie, Delta, Battalion) instead of alphabetically</C>
          <C type="fix">Total Roster tile now shows the true roster count; portal account count shown as a sub-label below the main number; Battalion Growth chart clarified as reflecting portal account creation, not the full roster</C>
        </>} />

        <Release versions="v1.7.20" date="Sep 10" title="Uniform Guide — Item Visuals" changes={<>
          <C type="feat">Step 2 (item selection) now shows a visual swatch next to every item — ribbon bars render as accurate horizontal stripe patterns matching real Army JROTC ribbon colors; medals display a suspension ribbon and disc; arcs display as a curved tab patch with a short label; the ribbon arrangement preview in the placement panel also uses the real stripe swatches instead of solid color blocks</C>
        </>} />

        <Release versions="v1.7.19" date="Sep 9" title="Uniform Guide — Hidden (WIP)" changes={<>
          <C type="fix">Uniform Guide temporarily hidden from public nav and disabled by default (DEFAULT_VISIBILITY uniform: false) while further work is in progress; admins can re-enable it from Admin → Content → Visibility when ready</C>
        </>} />

        <Release versions="v1.7.18" date="Sep 9" title="Interactive Uniform Placement Guide" changes={<>
          <C type="feat">Uniform Guide completely redesigned as an interactive 3-step tool — choose Class A or B and Male or Female, select your ribbons, medals, and arcs from the full JROTC list, then see an SVG illustration of the uniform with 8 clickable zones (Beret, Rank Insignia, U.S. Insignia, Ribbons, Medals, Name Tag, Sleeve Insignia, Belt); tapping any zone opens step-by-step placement instructions and a video slot (ready for YouTube embeds when video IDs are added)</C>
          <C type="feat">Ribbons zone shows a live arrangement preview — colored bars in precedence order, 3 per row, top-left = highest precedence, matching the AR 670-1 stacking rule; assigned items listed by rank in each zone's panel</C>
          <C type="feat">Medals zone is visible only on Class A; sleeve insignia zone reflects selected arcs; female gender selection adds an AR 670-1 hair, earring, and nail polish reminder in the placement view</C>
        </>} />

        <Release versions="v1.7.17" date="Sep 9" title="Uniform Guide (initial)" changes={<>
          <C type="feat">New public page at /cadet-info/uniform — Army JROTC Uniform Guide with two tabs: "How to Wear" (5-step illustrated guide covering preparation, shirt/trousers, coat/insignia, beret, and inspection checks) and "My Checklist" (26-item personal inventory covering Class A, Class B, PT uniform, and insignia/awards; progress bar; items saved to device localStorage, never sent to server)</C>
          <C type="feat">Uniform Guide added to Cadet Info nav dropdown (desktop and mobile) and page visibility settings in Admin Content, so it can be toggled on/off like any other public page</C>
        </>} />

        <Release versions="v1.7.16" date="Sep 9" title="Nav Winning Colors Fix" changes={<>
          <C type="fix">Winning Colors appeared in the Cadet Info dropdown and mobile accordion — it belongs only in the Quizzes dropdown; removed from Cadet Info in both desktop and mobile nav, and updated the Quizzes active-state highlight to use path.includes() so it covers the /cadet-info/winning-colors sub-path correctly</C>
        </>} />

        <Release versions="v1.7.15" date="Sep 9" title="Leadership Write Access" changes={<>
          <C type="fix">S5 Public Affairs and S6 Technology could open the Edit Leadership Record modal but got a permission-denied error on save — Firestore rules for the leadership and instructors collections now match the pageContent gate (S5, S6, and all admins can write)</C>
        </>} />

        <Release versions="v1.7.14" date="Sep 9" title="Duplicate Roster Fix" changes={<>
          <C type="fix">Duplicate roster entries on account approval — admin double-clicking "Approve Account" or "Authorize & Add to Roster" triggered two concurrent Firestore checks that both saw an empty roster and each created an entry; submit buttons are now disabled with a loading spinner during the save, and the guard state resets on success, failure, or validation block</C>
          <C type="fix">Shadow-merge orphan — when a cadet signs up after staff pre-created their account (shadow record), the roster entry linked to the shadow was left with a stale UID after the shadow was deleted; complete-signup now re-links that roster entry to the real auth UID automatically</C>
        </>} />

        <Release versions="v1.7.13" date="Sep 9" title="Archive & Custom Dialogs" changes={<>
          <C type="feat">Calendar Events — past events automatically move to a collapsible "Archived Events" section; upcoming events stay at the top; archive icon and muted style distinguish past from active events</C>
          <C type="feat">Custom confirm dialogs — all browser window.confirm() and window.alert() calls across the portal replaced with a styled in-app modal; delete actions show a red "Delete" button, non-destructive actions show a yellow "Confirm" button</C>
        </>} />

        <Release versions="v1.7.12" date="Sep 7" title="Version History — Ordering Fix" changes={<>
          <C type="fix">v1.6 release entries were in reverse order (v1.6.88–99 first, v1.6.49–51 last) — corrected to chronological ascending order matching every other era</C>
        </>} />

        <Release versions="v1.7.11" date="Sep 7" title="Version History — Full Consolidation" changes={<>
          <C type="feat">All 156 patches consolidated into named descriptive releases across every era — v0.1 through v1.7; the changelog is now scannable by feature push rather than individual commits</C>
          <C type="fix">Individual patch details remain accessible within each named release; names reflect the dominant theme of each push</C>
        </>} />

        <Release versions="v1.7.10" date="Sep 7" title="Version History — Named Releases (Aug 30 – Sep 7)" changes={<>
          <C type="feat">Version History page — first consolidation: 61 granular patches (v1.6.49 – v1.7.9) grouped into 7 descriptive named releases</C>
        </>} />

        <Release versions="v1.7.6 – 9" date="Sep 4 – 7" title="The Security & Analytics Update" changes={<>
          <C type="feat">Vercel Analytics enabled — page views and visitor data now appear in the Vercel dashboard without requiring cookie consent; no personal data is collected</C>
          <C type="feat">Access Code management moved from Content Management to the Accounts page (admins, level 80+); changing the code writes a security-flagged Activity Log entry and pushes a notification to all staff (70+)</C>
          <C type="feat">Battalion sign-up code is now changeable without a redeploy — hashed in the browser (SHA-256) before being written to Firestore; the raw code is never stored anywhere</C>
          <C type="fix">Meeting Log attachments (PDF, PPTX, PPT) were silently rejected by Firebase Storage — the meeting-attachments/ path had no storage rule; rule added with authenticated read/delete and a 10 MB cap</C>
        </>} />

        <Release versions="v1.7.0 – 5" date="Sep 3 – 4" title="The Board Study Update" changes={<>
          <C type="feat">Board Study redesigned with 3 modes — Quiz (multiple-choice with instant feedback), Flashcards (flip and self-rate), and Fill in the Blank (type the answer, press Enter)</C>
          <C type="feat">New Rank Structure category (16 ranks: 6 officer, 10 enlisted) — covers C/COL through C/PVT with insignia descriptions; flashcard fronts show the actual rendered insignia image</C>
          <C type="feat">Multi-select topic pills — any combination of all 5 categories can be drilled in a single session; questions and choices randomized each attempt</C>
          <C type="feat">Quizzes dropdown added to the nav bar (desktop hover / mobile accordion) — links to Board Study, Mindset Quiz, and Winning Colors; visibility toggleable via Content → Visibility</C>
          <C type="fix">All Board Study screens (Quiz, Flashcards, Fill in the Blank, Results) now clear the fixed navbar; performance tier result emoji removed</C>
          <C type="feat">Accounts — admins and S1 can reset a cadet's enrolled 2FA phone, allowing them to sign in with password while re-enrolling</C>
        </>} />
      </Minor>

      {/* ── v1.x ERA ─────────────────────────────────────────────────────── */}
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-600 mb-3 mt-6 px-1">Production — Admin Portal Era</p>

      <Minor version="v1.6" title="Privacy & Compliance" date="Aug 22, 2026" isMajor>
        <Release versions="v1.6.0 – 5" date="Aug 22" title="The Privacy & Compliance Launch" changes={<>
          <C type="law">Privacy Policy fully rewritten — cites Florida Student Data Privacy Act (§ 1002.222, F.S.), FERPA, and COPPA; every data type explicitly listed (measurements, fitness scores, fundraiser data, promotion board scores)</C>
          <C type="law">Terms of Service updated — BCPS Student Code of Conduct and JROTC SOP compliance; cadet data non-disclosure rule; scope-access violation prohibition; 2FA requirement formalized</C>
          <C type="sec">Account deletion triggers cascade cleanup (roster entry unlinked, uniform size records purged); Google Analytics disabled on all /admin/* routes</C>
          <C type="feat">My Records section in My Profile — self-service view of fundraiser total, Cadet Challenge scores by cycle, and uniform sizes</C>
          <C type="feat">This page — /admin/changelog — added to the portal with full patch-level history; "Version History" link added to admin sidebar</C>
        </>} />

        <Release versions="v1.6.6 – 14" date="Aug 24" title="The Portal Stabilization & Security Pass" changes={<>
          <C type="fix">5 bug fixes — XO removed from "Meet the Top 3," Zulu hidden from public leadership tab, Blue/Gold end-date support, calendar grid layout, and home page animation lag</C>
          <C type="perf">Leadership portraits and Photo Gallery covers now lazy-load; backdrop-blur and transition-all narrowed across calendar, photos, and hero CTA; agenda animation delay capped</C>
          <C type="sec">Security audit — 7 Firestore rule fixes: wildcard fallback changed to deny-all, settings/events locked to staff tier (70+), company-scoped reads for records, role-ceiling enforcement at the database layer, promotion scores company-scoped</C>
          <C type="feat">S1 form-submission file attachments (magic-byte validated); company-scoped S1 queries; meeting logs shareable with company leadership; dashboard role-aware stat tile</C>
          <C type="feat">Fundraiser and Cadet Challenge now gated by Open/Close controls (staff-initiated); footer layout overhauled with correct grid; portal version shown in footer; MSgt and company-leadership role/permission fixes</C>
        </>} />

        <Release versions="v1.6.15 – 26" date="Aug 25 – 26" title="The Activity Log & Command Tools Update" changes={<>
          <C type="fix">S1/S3 assistant sidebar rebuilt with correct group labels; S1 Adjutant and S6 Technology can now save user accounts (Firestore rules fix)</C>
          <C type="feat">Account approval UI — green Approve / red Deny buttons; denial removes Firebase Auth entry and Firestore document in one action</C>
          <C type="feat">Google Form webhook — uniform requests submitted via QR code auto-populate a "Form Requests" tab with approve/decline actions; roster matching by name, company, and LET level with confidence scores</C>
          <C type="feat">Activity Log (/admin/log) — real-time feed of all system events; auto-logging wired into 30+ action types across the entire portal; 30 filter tabs, search bar, and action-color card theming (green/red/yellow/blue)</C>
          <C type="feat">AAR Logs (/admin/aar-logs) — After Action Reports for battalion/company events with two-level "What Went Well" and "Needs Improvement" bullet lists; shared BulletListEditor component</C>
          <C type="feat">Meeting Logs expanded — all staff (70+) can now create logs and edit their own; platoon/squad options standardized across Roster and Accounts</C>
        </>} />

        <Release versions="v1.6.27 – 35" date="Aug 26 – 27" title="The Honor Company & Battalion Rename Update" changes={<>
          <C type="feat">Activity Log action-color card theming — green for creates/approvals, red for deletes/denials, yellow for updates, blue for sign-ins; action labels readable with spaces instead of underscores</C>
          <C type="feat">Honor Company — fixed 5-4-3-2-1 Org Day point scale (1st = 5 pts regardless of company count); Zulu excluded from competition</C>
          <C type="feat">Zulu Company completely removed site-wide — "Battalion" designation replaces it; default company list is Alpha, Bravo, Charlie, Delta; legacy Zulu records appear under the Battalion tab automatically</C>
          <C type="feat">SGM access parity with Battalion CSM across all portal pages (Accounts, Teams, Feedback Hub, AAR/Meeting Logs elevated edit, Uniform Request approvals, full Order targets)</C>
          <C type="feat">Mindset Readiness Assessment — public quiz at /mindset-quiz; 14-question growth vs. fixed mindset self-assessment; 4 performance ranks (Recruit → Commander)</C>
          <C type="feat">Sub-bullet points in Meeting Logs and AAR Logs — two-level bullet points with indent arrow; shared BulletListEditor component; Google Sheets sync flattens sub-items with two-space indentation</C>
        </>} />

        <Release versions="v1.6.36 – 41" date="Aug 27 – 28" title="The Uniform Sizes & Security Hardening Update" changes={<>
          <C type="feat">Roster company selector converted to compact filter dropdown; Honor Company penalty points (negative values shown in red); fundraiser Battalion HQ bar distinct in the progress graph</C>
          <C type="feat">Meeting Logs — PDF and PowerPoint attachments (10 MB, magic-byte validated); download link in view mode; attachment icon on log list rows; deletion cleans up Storage file</C>
          <C type="sec">ToS & Privacy Policy acceptance gate — all users must accept before accessing any page; scroll-required dual-checkbox gate; acceptance recorded in Firestore; new user onboarding gains a Terms step</C>
          <C type="feat">Uniform Sizes v2 — S4 Logistics column configuration, smart incomplete detection, Class A auto-check from roster position, finalize with column selection, reopen button, required columns highlighted in yellow</C>
          <C type="sec">Roster security hardening — rank/position changes require 70+; deletion requires staff via rosterPendingActions approval workflow; rosterChangelog append-only audit trail; BC single-holder hard block; XO/CSM dual-role requires BC override; company command cannot promote/demote subordinates</C>
          <C type="feat">Security alert emails (notify-security.js) for self-edits and critical events; daily/weekly activity digest with hazard detection (self-edits, duplicate roles, rank changes, burst detection)</C>
        </>} />

        <Release versions="v1.6.42 – 48" date="Aug 29" title="The Auth Resilience & Roster Permissions Update" changes={<>
          <C type="fix">CSP hash updated; apis.google.com added to script-src and connect-src — resolves blocked Firebase Auth on some browsers</C>
          <C type="fix">Account saves now route through the Admin SDK server endpoint — eliminates permission-denied failures during Firebase Installations degradation; only the 12 safe form fields are written per save</C>
          <C type="fix">Firestore snapshot error no longer resets admin role to 'guest' on transient WebChannel failures — role is preserved for the session duration</C>
          <C type="sec">Company officers (level 45–69) blocked from assigning battalion positions in the roster edit modal</C>
          <C type="sec">Rank and position fields read-only for company command and assistants when editing existing roster entries; "contact staff to change" label shown</C>
          <C type="new">Company Commander, XO, First Sergeant, and MSgt positions now automatically assign Company HQ as the platoon and lock the platoon select on both Roster and Accounts pages</C>
          <C type="sec">Roster edit modal fully locked (all fields read-only) for entries linked to a portal account — a "Managed by Portal Account" banner directs staff to the Accounts page; only Notes remains editable</C>
        </>} />

        {/* ── Named releases: Aug 30 – Sep 2 ─────────────────────────────────── */}
        <Release versions="v1.6.49 – 51" date="Aug 30" title="The Push Notifications & Roster Update" changes={<>
          <C type="feat">FCM push notifications — staff and cadets can opt in from their profile; Global Broadcasts automatically push to every subscribed device; stale tokens are auto-removed after a failed send</C>
          <C type="feat">Roster company tabs now show three stacked counts — company cadets, battalion members in period (secondary company), and a total — giving instructors a full room headcount at a glance</C>
          <C type="fix">Company field locked on portal-linked roster entries; duplicate entries with the same cadet name are blocked with a clear error toast</C>
        </>} />

        <Release versions="v1.6.52 – 64" date="Aug 31" title="The LET Grouping & Permissions Update" changes={<>
          <C type="feat">LET-level grouping added across Roster, S1 Tracker, Cadet Challenge, and Promotion Board — cadets are split into LET 1 / 2 / 3 / 4 sections throughout the portal with an optional Group by LET toggle</C>
          <C type="feat">Battalion section in company views — battalion staff attached via secondary company now appear in a dedicated section within each company on the Roster and Cadet Challenge pages</C>
          <C type="feat">Promotion Board draft/open workflow introduced — boards move through Draft → Open → Closed states; company and battalion XOs can open a board once Battalion prepares the draft</C>
          <C type="feat">Patch notes modal — displayed once per user per version on the dashboard; covers new features, fixes, and rule reminders. Animation performance improved by removing backdrop blur</C>
          <C type="feat">Sign-in trust — "Lock Session" replaces Log Out for trusted devices (30-day window); a password re-entry resumes the session without SMS — "Sign Out Completely" remains for full sign-out</C>
          <C type="fix">Permission sweep — S1 Tracker, Cadet Challenge, and Promotion Board subscriptions now correctly scope queries by company for non-battalion users; multiple permission-denied errors resolved</C>
        </>} />

        <Release versions="v1.6.65 – 78" date="Sep 1" title="The Ribbons & Rank Regulation Update" changes={<>
          <C type="feat">Regulation rank-position system — every position maps to an authorized rank ceiling; saving a cadet over their rank is blocked with a clear error and a one-click "Use C/XXX" correction button</C>
          <C type="feat">Secondary position billets — Color Guard Commander, Drill Captain, Rifle Team Commander, Raider Team Commander / Co-Commander are now secondary assignments shown as indigo pill badges alongside the primary position</C>
          <C type="feat">Ribbon qualification system — cadets meeting the JROTC Athletic Ribbon or Physical Fitness Ribbon standard earn badges inline; when a cycle is locked, ribbon awards route directly to Uniform Requests for S4 issuance</C>
          <C type="feat">Battalion Leaderboard (/admin/leaderboard) — top 3 male and female per Cadet Challenge event per company, using personal-best scores across all cycles; accessible to all authenticated cadets</C>
          <C type="feat">Per-event medical exemptions — cadets can be exempted from specific Cadet Challenge events while completing the others; previously exemption was all-or-nothing for the whole cycle</C>
          <C type="feat">Promotion Board Testing Mode — full-screen guided scoring for Company Top 3 and Battalion Top 3; records mistakes per category and computes a full breakdown; saves directly to the board document</C>
          <C type="fix">Roster Challenge Scores column now reads the correct collection and shows the highest cycle that has actual data, with a C1/C2/C3 cycle badge displayed before the score chips</C>
        </>} />

        <Release versions="v1.6.79 – 87" date="Sep 2" title="The Promotion Board Overhaul" changes={<>
          <C type="feat">Run Promotions button — closed boards let S1 preview and execute a battalion-wide promotion (Board 1 or Board 2); ranks update in the roster and linked accounts automatically</C>
          <C type="feat">Per-position board requirements — Battalion configures required knowledge and duties per position; cadets see their requirements on the public Promotion Board page; proctors see a live checklist in Testing Mode</C>
          <C type="feat">Testing Mode overhauled — guided EC checklist (Named ranks, Extra duties, Chain of Command, Principles of Leadership, LDRSHIP definitions) with + / − counters; an "Other" open-entry option for custom EC items</C>
          <C type="feat">Configurable promotion eligibility — Battalion toggles "Forms complete" and "Cadet Challenge complete" gates per board; cadets not meeting requirements are excluded from Run Promotions</C>
          <C type="feat">Score-sheet requirements pre-populated per official standards for all positions (Battalion Leadership through Squad Leader); inline editable and reorderable with up/down arrows</C>
          <C type="fix">Company Commander, XO, and 1SG no longer see their own score rows; Testing Mode scores are locked for company-level users after save — only battalion staff can override</C>
          <C type="feat">Special assignment badges on the roster link directly to the matching team in Admin → Teams; same links appear in the cadet history detail view</C>
        </>} />

        <Release versions="v1.6.88 – 99" date="Sep 2" title="The S1 Tracker Overhaul" changes={<>
          <C type="feat">Auto-sync enrolls new cadets into all active form events on roster add; a safety-net sync on event open catches any missing entries and patches stale name, rank, or LET data</C>
          <C type="feat">Due dates editable inline — S1 and Company XO can edit their own events; Battalion filter restored to show only Zulu/Battalion submissions with correct stat cards and LET grouping</C>
          <C type="feat">Battalion Members section per company — secondary-company cadets can be marked turned in alongside regular company cadets; Zulu entries removed from the main cadet table</C>
          <C type="fix">Stat cards (Total Cadets / Turned In / Pending) and the progress bar now reflect the selected company filter; no longer shows full battalion totals when a company is chosen</C>
          <C type="fix">Overdue reminder emails now show cadet counts only (no names); Company XOs receive their company's count; S1 Adjutants receive the full battalion total — duplicate emails suppressed when addresses match</C>
          <C type="fix">Deleting a cadet from the roster now also removes all of their S1 Tracker submissions; orphaned submissions from past deletions are auto-purged on the next event open</C>
          <C type="feat">Battalion XO, Commander, CSM, Sergeant Major, and S3 can now send overdue reminder notifications (previously only S1 Adjutant and instructors)</C>
          <C type="feat">Cadet Challenge — live completion stats in the cycle banner; completion chip turns green when every cadet in the view is finished</C>
        </>} />

      </Minor>
      <Minor version="v1.5" title="Logistics & Performance" date="Aug 20, 2026">
        <Release versions="v1.5.0 – 3" date="Aug 20" title="The Supply & Performance Pass" changes={<>
          <C type="feat">Supply Requests page (S4 logistics — submit, approve, fulfill); Cadet History archive (company leadership+ can view; admin can archive/delete)</C>
          <C type="perf">backdrop-blur removed from all modal overlays (GPU savings on mobile); Framer Motion replaced with pure CSS keyframes (smaller bundle, faster modal open)</C>
          <C type="feat">S1 board unlock controls; Fundraiser roster-level goals per cadet; Supply Requests "Other" category; past calendar events display correctly on public calendar</C>
          <C type="sec">Firestore security rules enforced at the database level for 7 collections (roster, uniformSizes, cadetChallengeRecords, fundraiserEntries, supplyRequests, s1Tracker, meetingLogs); composite indexes added</C>
        </>} />
      </Minor>

      <Minor version="v1.4" title="Calendar & Public Features" date="Aug 19, 2026">
        <Release versions="v1.4.0 – 5" date="Aug 19" title="The Calendar & Public Features Suite" changes={<>
          <C type="fix">Admin sidebar now responsive on mobile/iPhone with hamburger toggle</C>
          <C type="feat">Admin Calendar Events (create/edit/delete with date ranges, colors, categories); public Events Calendar with category filter; Blue/Gold school day overlay with correct alternating schedule</C>
          <C type="feat">Honor Company leaderboard (live company rankings, scoped per role); Feedback Hub for staff; Fundraiser progress chart; company_master_sergeant role added to the hierarchy</C>
          <C type="feat">Admin sidebar grouped into Command / Personnel / Programs / Publishing sections; hover tooltips and click-to-expand modals on calendar day cells</C>
        </>} />
      </Minor>

      <Minor version="v1.3" title="Command Intelligence" date="Aug 14 – 17, 2026">
        <Release versions="v1.3.0 – 1" date="Aug 14 – 17" title="The S1 Tracker & Command Tools Launch" changes={<>
          <C type="feat">S1 Tracker — form turn-in status tracked per cadet across all required documents</C>
          <C type="feat">Promotion Board — score submission by Company XOs, reviewed by S1 staff</C>
          <C type="feat">Meeting Logs — structured log per meeting, synced to Google Sheets for archival</C>
        </>} />
      </Minor>

      <Minor version="v1.2" title="Programs & Logistics" date="Aug 12 – 13, 2026">
        <Release versions="v1.2.0 – 3" date="Aug 12 – 13" title="The Programs & Logistics Suite" changes={<>
          <C type="feat">Fundraiser Tracking — Fallen Heroes flag program: weekly progress per cadet, running totals, payment logging with soft-delete (void) and company-command void permission</C>
          <C type="feat">Uniform Sizes admin page (S4 logistics — shirt, pants, boot, beret per cadet); S7 Special Projects and S6 Technology scoped access control</C>
          <C type="feat">Personal views (cadet self-service) for Cadet Challenge, Fundraiser, Uniform Sizes, and Uniform Items; Orders + Tasks combined into one page</C>
          <C type="sec">Sidebar links fully role-gated; route protection enforced on all admin pages; SGM restricted from portal admin tools; email notifications scoped to role-relevant events only</C>
        </>} />
      </Minor>

      <Minor version="v1.1" title="Security & 2FA" date="Aug 11, 2026">
        <Release versions="v1.1.0 – 3" date="Aug 11" title="The Security & Field Tools Launch" changes={<>
          <C type="feat">Cadet Challenge score tracking (per cadet, per cycle, per exercise); S2 Inspections page; S6 Technology Checklist</C>
          <C type="sec">Session soft-lock — portal locks after inactivity and prompts re-auth; "Remember This Device" token skips SMS MFA on trusted devices for 30 days</C>
          <C type="fix">Login loop caused by stale sessionLocked flag; lock screen firing immediately on trusted devices (32-bit setTimeout overflow); session lock correctly unlocks for MFA-enrolled accounts — all resolved</C>
          <C type="feat">S1 Assistants get full CRUD on company roster (except name/company); approved accounts auto-added to battalion roster on approval; battalion cross-company Cadet Challenge support</C>
        </>} />
      </Minor>

      <Minor version="v1.0" title="Admin Portal Launch" date="Jul 30 – Aug 10, 2026" isMajor defaultOpen={false}>
        <Release versions="v1.0.0 – 5" date="Jul 30 – Aug 1" title="The Admin Portal Launch" changes={<>
          <C type="feat">Full Firestore-backed admin portal built from scratch, replacing the CMS; 22-role access hierarchy (Cadet → Battalion Commander → Instructor)</C>
          <C type="feat">Manage Personnel — role/company editing, password reset for any cadet; custom EmailJS password reset email with 60-second cooldown; both addresses notified on login-email change</C>
          <C type="feat">Signup approval workflow with battalion access-code gate; session-only persistence (tab close logs out); Documents & Regulations library; Privacy Policy and Terms of Service (initial)</C>
          <C type="sec">reCAPTCHA v2 checkbox on signup; Content-Security-Policy and other security headers added; server-side rate limiting via Redis on sensitive endpoints</C>
        </>} />

        <Release versions="v1.0.6 – 9" date="Aug 5 – 7" title="The Performance & SEO Pass" changes={<>
          <C type="perf">JS bundle code-split (1 MB chunk warning eliminated); cover images recompressed from 91 MB to 2.3 MB; HTTP cache headers for all static assets; skeleton loaders on highest-traffic pages</C>
          <C type="feat">Open Graph / Twitter Card meta tags, real 404 page, per-route metadata, favicon, sitemap, and structured data (EducationalOrganization); robots.txt added</C>
          <C type="feat">Cookie consent banner; Firebase Analytics gated behind acceptance; upload system with WebP storage, size validation, and profile photos (Cloudinary); error boundary + retry-with-backoff on uploads</C>
          <C type="feat">Onboarding checklists, custom scrollbar, scroll-triggered reveal animations on all public pages; CI workflow (lint + test + build)</C>
          <C type="fix">CLS fixes across hero, async data mount, and carousel height; 10 of 12 npm audit vulnerabilities resolved</C>
        </>} />

        <Release versions="v1.0.10 – 17" date="Aug 7 – 10" title="The Admin Feature Expansion" changes={<>
          <C type="feat">Persistent admin sidebar on all admin pages (AdminLayout wrapper); company names configurable by S6; SAI/AI instructor accounts sync from roster</C>
          <C type="sec">2FA (SMS MFA) enforced for staff-level accounts; full account onboarding wizard (email verify + 2FA + confirmation email via EmailJS); reCAPTCHA v2 upgraded to Enterprise score-based (invisible)</C>
          <C type="feat">ScrambleText, Typewriter, and SmoothInput spring-animated caret components; email delivery migrated to Resend (noreply@pbhsjrotc.com)</C>
          <C type="feat">Newsletter listing page + admin management panel; Battalion Roster with per-company tabs and two-way roster ↔ account sync; Cadet Dossier moved to My Profile</C>
          <C type="fix">PDF uploads routed to Firebase Storage; CSP updated; PDF upload limit raised to 25 MB</C>
        </>} />
      </Minor>


      {/* ── v0.x ERA ─────────────────────────────────────────────────────── */}
      <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-600 mb-3 mt-6 px-1">Pre-release — Public Site Era</p>

      <Minor version="v0.3" title="Leadership Page & Routing" date="Jun 14 – 25, 2026">
        <Release versions="v0.3.0 – 2" date="Jun 14 – 25" title="The Leadership Page & CMS" changes={<>
          <C type="feat">Decap CMS backend for leadership entries — no code changes needed to update; company leadership rosters fully editable via CMS dropdown</C>
          <C type="fix">Vercel SPA routing configured — direct links no longer 404</C>
          <C type="feat">"Meet the Top 3" homepage section binds live to CMS entries; mobile navigation bar added</C>
        </>} />
      </Minor>

      <Minor version="v0.2" title="Public Site & Portraits" date="Jan 29 – Feb 17, 2026">
        <Release versions="v0.2.0 – 3" date="Jan 29 – Feb 17" title="The Public Site Launch" changes={<>
          <C type="sec">Firebase API keys removed from source; missing image reference resolved; website crash on initial load fixed</C>
          <C type="feat">Command team portrait photos added to Leadership page</C>
          <C type="feat">Announcements and Orders split into separate streams with auto-expiry</C>
          <C type="feat">About page created; admin portal scaffolded for early dev testing</C>
          <C type="perf">All images converted from JPEG to WebP</C>
        </>} />
      </Minor>

      <Minor version="v0.1" title="Foundation" date="Jan 26, 2026">
        <Release versions="v0.1.0" date="Jan 26" title="Project Bootstrap" changes={<>
          <C type="feat">React + Vite SPA scaffold with Firebase Auth, Firestore, and Storage</C>
          <C type="sec">Firebase config moved to environment variables; .gitignore hardened</C>
        </>} />
      </Minor>

      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600 text-center mt-4 pb-8">
        Repository: pompano-jrotc/pbhs-jrotc-web · Deployed via Vercel
      </p>
    </div>
    </div>
  );
};

export default AdminChangelog;
