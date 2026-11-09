// src/constants.js

export const ROLE_HIERARCHY = {
  // Tier: District (Level 105)
  'district_army_instructor': 105,

  // Tier: Instructors (Level 100-95)
  'senior_army_instructor': 100,
  'army_instructor': 95,

  // Tier: Battalion Command (Level 90-80)
  'battalion_commander': 90,
  'battalion_xo': 85,
  'battalion_csm': 85,
  'sergeant_major': 80,

  // Tier: Battalion Staff (Level 70)
  's1_adjutant': 70,
  's2_intelligence': 70,
  's3_operations': 70,
  's4_logistics': 70,
  's5_public_affairs': 70,
  's6_technology': 70,
  's7_special_projects': 70,

  // Tier: Company Command (Level 55-45)
  'company_commander': 55,
  'company_xo': 50,
  'company_1sg': 45,
  'company_master_sergeant': 45,

  // Tier: Company Staff Assistants (Level 35)
  'company_s1_assistant': 35,
  'company_s2_assistant': 35,
  'company_s3_assistant': 35,
  'company_s4_assistant': 35,
  'company_s5_assistant': 35,
  'company_s6_assistant': 35,
  'company_s7_assistant': 35,

  // Tier: Platoon Leadership (Level 25-20)
  'platoon_leader': 25,
  'platoon_sergeant': 20,

  // Tier: Squad Leadership (Level 15-12)
  'squad_leader': 15,
  'squad_leader_assistant': 12,

  // Tier: Baseline (Level 5-1)
  'squad_member': 5,
  'cadet': 1
};

export const ROLE_LABELS = {
  district_army_instructor: 'District Army Instructor (DAI)',
  senior_army_instructor: 'Senior Army Instructor (SAI)',
  army_instructor: 'Army Instructor (AI)',
  battalion_commander: 'Battalion Commander',
  battalion_xo: 'Battalion XO',
  battalion_csm: 'Battalion CSM',
  sergeant_major: 'Sergeant Major',
  s1_adjutant: 'S1 - Adjutant',
  s2_intelligence: 'S2 - Intelligence',
  s3_operations: 'S3 - Operations',
  s4_logistics: 'S4 - Logistics',
  s5_public_affairs: 'S5 - Public Affairs',
  s6_technology: 'S6 - Technology',
  s7_special_projects: 'S7 - Special Projects',
  company_commander: 'Company Commander',
  company_xo: 'Company XO',
  company_1sg: 'Company First Sergeant',
  company_master_sergeant: 'Company Master Sergeant',
  company_s1_assistant: 'Company S1 Assistant',
  company_s2_assistant: 'Company S2 Assistant',
  company_s3_assistant: 'Company S3 Assistant',
  company_s4_assistant: 'Company S4 Assistant',
  company_s5_assistant: 'Company S5 Assistant',
  company_s6_assistant: 'Company S6 Assistant',
  company_s7_assistant: 'Company S7 Assistant',
  platoon_leader: 'Platoon Leader',
  platoon_sergeant: 'Platoon Sergeant',
  squad_leader: 'Squad Leader',
  squad_leader_assistant: 'Squad Leader Assistant',
  squad_member: 'Squad Member',
  cadet: 'Cadet (Unassigned)'
};

// Sergeant Major and above: full command authority.
export const ADMIN_LEVEL = 80;
// S1-S7 and above: battalion staff authority.
export const STAFF_LEVEL = 70;
// Company First Sergeant and above: baseline leadership/admin-nav visibility.
export const COMMAND_LEVEL = 45;

export const EVENT_TYPES = [
  'Inspection', 'Service', 'Drill', 'PT', 'Meeting',
  'Ceremony', 'Raiders', 'JLAB', 'Drones', 'Gameday', 'Private Practice'
];

// Cadet rank abbreviations — used in AdminUsers, AdminRoster, UniformRequests.
// Enlisted first (low → high), then officer (low → high).
export const JROTC_RANKS = [
  'C/PVT', 'C/PFC', 'C/CPL', 'C/SGT', 'C/SSG',
  'C/SFC', 'C/MSG', 'C/1SG', 'C/SGM', 'C/CSM',
  'C/2LT', 'C/1LT', 'C/CPT', 'C/MAJ', 'C/LTC', 'C/COL',
];

// Army instructor ranks — enlisted, warrant, and officer grades used in JROTC.
export const MILITARY_RANKS = [
  'SSG', 'SFC', 'MSG', '1SG', 'SGM', 'CSM',
  'WO1', 'CW2', 'CW3', 'CW4', 'CW5',
  '2LT', '1LT', 'CPT', 'MAJ', 'LTC', 'COL',
];

export const INSTRUCTOR_POSITIONS = [
  'Army Instructor',
  'Senior Army Instructor',
  'District Army Instructor',
];

export const INSTRUCTOR_ROLE_MAP = {
  'Army Instructor':          'army_instructor',
  'Senior Army Instructor':   'senior_army_instructor',
  'District Army Instructor': 'district_army_instructor',
};

// Positions that ALWAYS get "Company HQ" as their platoon — non-negotiable.
// Positions that lead a platoon — they belong to a platoon but have no squad.
// Hide the squad field whenever one of these is selected.
export const NO_SQUAD_POSITIONS = [
  'Platoon Leader',
  'Platoon Sergeant',
];

// Changing position to one of these auto-locks the platoon select to "Company HQ".
export const COMPANY_HQ_LOCKED_POSITIONS = [
  'Company Commander',
  'Company XO',
  'First Sergeant',
  'Master Sergeant',
];

// Positions that DEFAULT to "Company HQ" but can still be overridden
// (e.g. a staff assistant who also holds a platoon-level slot).
export const COMPANY_HQ_DEFAULT_POSITIONS = [
  'Company S1 Assistant',
  'Company S2 Assistant',
  'Company S3 Assistant',
  'Company S4 Assistant',
  'Company S5 Assistant',
  'Company S6 Assistant',
  'Company S7 Assistant',
];

// Battalion-level positions — only staff (70+) and above may assign these on
// roster entries. Company command (45–69) and assistants (35) are blocked both
// client-side (filtered dropdown) and server-side (Firestore rules).
// Keep in sync with the isBattalionPosition() helper in firestore.rules.
export const BATTALION_POSITIONS = [
  'Battalion Staff (S-1)',
  'Battalion Staff (S-2)',
  'Battalion Staff (S-3)',
  'Battalion Staff (S-4)',
  'Battalion Staff (S-5)',
  'Battalion Staff (S-6)',
  'Battalion Staff (S-7)',
  'Sergeant Major',
  'Battalion XO',
  'Battalion Deputy Commander',
  'Battalion CSM',
  'Battalion Commander',
];

// Human-readable position labels for the signup and admin-personnel forms.
// Listed low → high so the dropdown reads naturally. Import this in both
// SignUp.jsx and AdminUsers.jsx — do NOT maintain a separate copy in each file.
export const JROTC_POSITIONS = [
  'Squad Member',
  'Squad Leader Assistant',
  'Squad Leader',
  'Platoon Sergeant',
  'Platoon Leader',
  'Company S1 Assistant',
  'Company S2 Assistant',
  'Company S3 Assistant',
  'Company S4 Assistant',
  'Company S5 Assistant',
  'Company S6 Assistant',
  'Company S7 Assistant',
  'First Sergeant',
  'Master Sergeant',
  'Company XO',
  'Company Commander',
  'Battalion Staff (S-1)',
  'Battalion Staff (S-2)',
  'Battalion Staff (S-3)',
  'Battalion Staff (S-4)',
  'Battalion Staff (S-5)',
  'Battalion Staff (S-6)',
  'Battalion Staff (S-7)',
  'Sergeant Major',
  'Battalion XO',
  'Battalion Deputy Commander',
  'Battalion CSM',
  'Battalion Commander',
];

// ── Rank-position helpers ─────────────────────────────────────────────────────

// Returns true when `rank` is strictly above the authorized max for `position`.
// A rank equal to or below the max is always valid.
export function rankExceedsMax(rank, position) {
  const maxRank = POSITION_RANKS[position];
  if (!maxRank || !rank) return false;
  return JROTC_RANKS.indexOf(rank) > JROTC_RANKS.indexOf(maxRank);
}

// Returns the promotion target rank for a given board number:
//   Board 1 → one rank below the authorized max (runway to max)
//   Board 2 → the authorized max itself
// Returns null when the position has no authorized rank.
export function boardTargetRank(position, board) {
  const maxRank = POSITION_RANKS[position];
  if (!maxRank) return null;
  const maxIdx = JROTC_RANKS.indexOf(maxRank);
  if (board === 1) return maxIdx > 0 ? JROTC_RANKS[maxIdx - 1] : maxRank;
  return maxRank;
}

// Special-assignment billets that are held in addition to a primary position.
// These are never the cadet's main position — they appear as a secondary
// designation on roster entries (stored in the `secondaryPosition` field).
export const SECONDARY_POSITIONS = [
  'Color Guard Commander',
  'Drill Captain',
  'Rifle Team Commander',
  'Raider Team Commander',
  'Raider Team Co-Commander',
];

// Authorized cadet rank for each position per AR 145-2 / JROTC battalion
// organization (paragraph 2-6 through 2-12).
// This is the MAXIMUM rank a cadet may hold for the position — being at or
// below this rank is always valid. After Promotion Board 1, cadets are
// promoted to one rank below the max; after Board 2, to the max itself.
// Positions without a fixed authorized rank are omitted.
export const POSITION_RANKS = {
  'Battalion Commander':        'C/LTC',
  'Battalion Deputy Commander': 'C/MAJ',
  'Battalion XO':               'C/MAJ',
  'Battalion CSM':              'C/CSM',
  'Color Guard Commander':      'C/CSM',
  'Sergeant Major':             'C/SGM',
  'Battalion Staff (S-1)':      'C/CPT',
  'Battalion Staff (S-2)':      'C/CPT',
  'Battalion Staff (S-3)':      'C/CPT',
  'Battalion Staff (S-4)':      'C/CPT',
  'Battalion Staff (S-5)':      'C/CPT',
  'Battalion Staff (S-6)':      'C/CPT',
  'Battalion Staff (S-7)':      'C/CPT',
  'Rifle Team Commander':       'C/CPT',
  'Raider Team Commander':      'C/CPT',
  'Company Commander':          'C/CPT',
  'Drill Captain':              'C/1LT',
  'Raider Team Co-Commander':   'C/1LT',
  'Company XO':                 'C/1LT',
  'Company S1 Assistant':       'C/MSG',
  'Company S2 Assistant':       'C/MSG',
  'Company S3 Assistant':       'C/MSG',
  'Company S4 Assistant':       'C/MSG',
  'Company S5 Assistant':       'C/MSG',
  'Company S6 Assistant':       'C/MSG',
  'Company S7 Assistant':       'C/MSG',
  'Master Sergeant':            'C/MSG',
  'Platoon Sergeant':           'C/MSG',
  'First Sergeant':             'C/1SG',
  'Platoon Leader':             'C/2LT',
  'Squad Leader':               'C/SGT',
  'Squad Leader Assistant':     'C/CPL',
  'Squad Member':               'C/PVT',
};