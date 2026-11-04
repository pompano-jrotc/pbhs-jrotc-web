// Fallback content for the S5/S6-editable pages (About, Cadet Info, Promotion Board).
// Used both as the public page's default before anything is saved to Firestore
// (pageContent/about, pageContent/cadet-info, pageContent/promotion-board), and
// as the admin editor's initial form state when no Firestore doc exists yet.

export const DEFAULT_ABOUT = {
  missionText: 'The mission of JROTC is "To motivate young people to be better citizens." It is a high school elective course designed to teach leadership, personal responsibility, and the value of community service without any military obligation.',
  studentLedText: "Unlike traditional classes, JROTC is student-led. Senior students hold leadership positions, managing the battalion's daily operations, planning events, and mentoring younger peers under the guidance of retired Army instructors.",
  history: [
    { title: "Army JROTC", text: "Established by the National Defense Act of 1916, JROTC has evolved from a military preparation program into a world-class leadership and citizenship program. Today, it operates in over 1,700 schools nationwide." },
    { title: "Broward County", text: "Broward County Public Schools (BCPS) boasts one of the largest JROTC footprints in the U.S. With over 33 programs, Broward is a national leader in competitive excellence." },
    { title: "PBHS Legacy", text: "Pompano Beach High School, established in 1928, has a rich legacy of academic excellence. Our JROTC battalion continues this tradition, bridging school pride with community leadership." }
  ],
  pillars: [
    { title: "Character", desc: "Developing lifelong habits of integrity, ethics, and personal responsibility." },
    { title: "Leadership", desc: "Teaching cadets how to lead by example and motivate others toward a common goal." },
    { title: "Citizenship", desc: "Preparing young people to be active and informed members of their community." },
    { title: "Academic Excellence", desc: "Maintaining the highest standards in academics, physical fitness, and graduation readiness." }
  ],
  ctaTitle: "Ready to Lead?",
  ctaText: "Join the class for next semester! Select JROTC during course registration."
};

export const DEFAULT_CADET_INFO = {
  missionText: "To motivate young people to be better citizens.",
  jrotcDefinition: "Junior Reserve Officer Training Corps",
  letDefinition: "Leadership Education Training",
  leadershipDefinition: "The ability to motivate (guide) others to accomplish a mission (task) in the manner desired by providing purpose, direction, and motivation.",
  cadetCreed: [
    "I am an Army Junior R.O.T.C. Cadet.",
    "I will always conduct myself to bring credit to my family, country, school, and the Corps of Cadets.",
    "I am loyal and patriotic. I am the future of the United States of America.",
    "I do not lie, cheat, or steal, and will always be accountable for my actions and deeds.",
    "I will always practice good citizenship and patriotism.",
    "I will work hard to improve my mind and strengthen my body.",
    "I will seek the mantle of leadership and stand prepared to uphold the Constitution and the American Way of Life.",
    "May God always grant me the strength to always live by this creed."
  ].join('\n'),
  principles: [
    "Know yourself and seek self-improvement.",
    "Be technically and tactically proficient.",
    "Set the example.",
    "Ensure the task is understood, supervised, and accomplished.",
    "Know your subordinates and look out for their welfare.",
    "Seek responsibility and take responsibility for your actions.",
    "Make sound and timely decisions.",
    "Keep your subordinates informed.",
    "Develop a sense of responsibility among your subordinates.",
    "Employ your subordinates in accordance with their capabilities.",
    "Train your subordinates as a team."
  ],
  armyValues: [
    { l: "L", v: "Loyalty",         d: "To bear true faith and allegiance to the US Constitution and your peers." },
    { l: "D", v: "Duty",            d: "To fulfill all obligations." },
    { l: "R", v: "Respect",         d: "To treat others the way they should be treated." },
    { l: "S", v: "Selfless Service",d: "To put the welfare of the nation before your own." },
    { l: "H", v: "Honor",           d: "To live up to all values." },
    { l: "I", v: "Integrity",       d: "To do what is right, legally and morally." },
    { l: "P", v: "Personal Courage",d: "To face fear, danger, or adversity." }
  ]
};

export const DEFAULT_PROMOTION_BOARD = {
  ranks: [
    {
      name: 'Squad Member',
      knowledge: ["Cadet Creed", "JROTC Meaning", "LET Meaning", "SAI (Who & Meaning)", "AI (Who & Meaning)", "Mission Statement", "LDRSHIP Meaning", "10 Ranks", "Military Bearing", "Company & Battalion Org"],
      duties: [
        "Maintain and wear the entire uniform immaculately when told",
        "Properly care for all equipment and materials given to you",
        "Ensure you are on time for all official formations",
        "Conduct yourself in a manner that brings credit to the Tornado Battalion",
        "If called upon be ready to perform as squad leader"
      ],
      leadership: "5/11 Principles"
    },
    {
      name: 'Squad Leader',
      knowledge: ["Cadet Creed", "LDRSHIP with definitions", "JROTC/LET Meaning", "Mission Statement", "SAI & AI Roles", "Company Leadership to squad members", "All Cadet Ranks"],
      duties: [
        "Responsible for all squad activities",
        "Sets the standard and direction of their squad",
        "Communicates information and end dates from leadership to squad members",
        "Encourages squad members to act appropriately in compliance with policies",
        "Responsible for personal accountability, uniform, equipment, and training plans"
      ],
      leadership: "5/11 Principles"
    },
    {
      name: 'Platoon Sergeant',
      knowledge: ["Cadet Creed", "LDRSHIP with definitions", "JROTC/LET Meaning", "SAI & AI Roles", "Company Leadership to Platoon", "All Cadet Ranks"],
      duties: [
        "Responsible for all platoon activities",
        "Sets the standard and direction of their platoon",
        "Communicates information and end dates from leadership to platoon",
        "Encourages platoon to act appropriately in compliance with policies",
        "Responsible for personal accountability, uniform, equipment, and training plans"
      ],
      leadership: "5/11 Principles"
    },
    {
      name: 'Platoon Leader',
      knowledge: ["Cadet Creed", "LDRSHIP with definitions", "JROTC/LET Meaning", "Mission Statement", "SAI & AI Roles", "Company Leadership to Squad Leaders", "All Cadet Ranks"],
      duties: [
        "Responsible for all platoon activities",
        "Sets the standard and direction of their platoon",
        "Communicates information and end dates from leadership to platoon sergeant",
        "Encourages platoon to act appropriately in compliance with policies",
        "Responsible for personal accountability, uniform, equipment, and training plans"
      ],
      leadership: "7/11 Principles"
    },
    {
      name: 'Company 1SG',
      knowledge: ["Cadet Creed", "LDRSHIP definitions", "SAI & AI Roles", "Top 5 & Company Chain of Command", "All Cadet Ranks"],
      duties: [
        "Coordinating with platoon sergeants to ensure proper training",
        "Responsible for passing information and data from platoon to CC and CC to platoon",
        "Advises CC on planning and coordinating company activities and training",
        "Accomplishes duties that are given by the CC, XO, and/or Army Instructor",
        "Responsible for the safety and risk assessment of all company events"
      ],
      leadership: "8/11 Principles"
    },
    {
      name: 'Company XO',
      knowledge: ["Cadet Creed", "LDRSHIP definitions", "SAI & AI Roles", "Top 5 & Company Chain of Command", "All Cadet Ranks"],
      duties: [
        "Assumes command and responsibilities in CC absence",
        "Serves as Chief of Staff; supervises and coordinates company staff",
        "Responsible for passing information/data between company staff and CC",
        "Accomplishes those duties that are given by the company commander",
        "Responsible for the safety and risk assessment of all company events"
      ],
      leadership: "8/11 Principles"
    },
    {
      name: 'Company Commander',
      knowledge: ["Cadet Creed", "LDRSHIP definitions", "SAI & AI Roles", "Top 5 & Company Chain", "Mission Statement", "All Cadet Ranks"],
      duties: [
        "Responsible for all company level activities",
        "Keeps the battalion commander informed of the status of the company",
        "Ensures the company is prepared to accomplish its assigned mission",
        "Build effective company chain of command",
        "Sets the standard and direction of the company",
        "Consult training schedules and ensure peer preparation to instruct",
        "Execute the orders of the battalion commander"
      ],
      leadership: "9/11 Principles"
    }
  ],
  staffAssistants: {
    knowledge: ["Cadet Creed", "LDRSHIP definitions", "JROTC/LET Meaning", "SAI & AI Roles", "Leadership: Co. to Squad Leaders of Platoon", "All Cadet Ranks"],
    leadership: "5/11 Principles",
    sections: [
      { id: "S-1", title: "Administrative Assistant", asst: [
        "Responsible for all matters concerning human resources within the company",
        "Provide administrative support within the company",
        "Responsible for the recording of all company data",
        "Responsible for the execution of all company level award ceremonies"
      ] },
      { id: "S-2", title: "Safety & Security Assistant", asst: [
        "Supervises company physical security and makes periodic inspections of all drill weapons",
        "Ensures that all Company activities are conducted in a safe manner",
        "Serves on event staff for planning and conducting company training events"
      ] },
      { id: "S-3", title: "Training Assistant", asst: [
        "Responsible for all matters concerning training operations and plans within the company",
        "Plans, organizes and supervises the conduct of cadet training within the company",
        "Ensures that all training listed within scheduling is rehearsed by the company",
        "Ensures the use of all schedules provided by the Battalion (S-3)"
      ] },
      { id: "S-4", title: "Supply Assistant", asst: [
        "Responsible for the distribution and maintenance of supply within the company",
        "Serve as a link between cadets and the Battalion (S-4)",
        "Serves on event staff for planning and conducting company training events"
      ] },
      { id: "S-5", title: "Public Affairs Assistant", asst: [
        "Responsible for taking video and picture documentation of all events within the company"
      ] },
      { id: "S-6", title: "Automation Assistant", asst: [
        "Assist in making periodic inspections of automation equipment",
        "Maintain and ensure the proper operation of all automation equipment used within the company"
      ] }
    ]
  },
  positionRequirements: {},
};

// Photo Gallery albums — each album links out to an external Google Photos URL.
// Admins can add/edit/remove albums from Admin → Content → Photo Gallery.
export const DEFAULT_PHOTOS = {
  albums: [
    { id: 1, title: "Yuletide Parade 2025-2026",         count: "163 Photos", coverImage: "/covers/Yuletide2025.webp",    albumUrl: "https://photos.app.goo.gl/yQma34bERVQhy6zz8" },
    { id: 2, title: "Raider States 2025-2026",            count: "517 Photos", coverImage: "/covers/Raiders2025.webp",     albumUrl: "https://photos.app.goo.gl/NyxyyFzDe59e2x2V9" },
    { id: 3, title: "Raider County Competition 2025-2026",count: "303 Photos", coverImage: "/covers/JV_Raiders.webp",      albumUrl: "https://photos.app.goo.gl/buYtCpjc3usGEWVc8" },
    { id: 4, title: "Military Ball 2024-2025",            count: "848 Photos", coverImage: "/covers/ball2024.webp",        albumUrl: "https://photos.app.goo.gl/UvXhZzj8Yca7ojEE6" },
  ]
};

// Homepage content — slideshow slides and quick-access cards.
// Slides use cover images already in /public/covers/; admins can swap URLs
// to any Cloudinary-hosted image uploaded through the portrait upload flow.
export const DEFAULT_HOME = {
  slides: [
    { url: "/covers/Yuletide2025.webp",    title: "TORNADO",    subtitle: "BATTALION" },
    { url: "/covers/Raiders_Awards.webp",  title: "EXCELLENCE", subtitle: "RECOGNIZED AT EVERY LEVEL" },
    { url: "/covers/ball2024.webp",        title: "DECORATED",  subtitle: "UNIT WITH DISTINCTION" },
    { url: "/covers/Open_House.webp",      title: "COMMUNITY",  subtitle: "LEADERS OF TOMORROW" },
    { url: "/covers/Raiders2025.webp",     title: "PHYSICAL",   subtitle: "READY FOR THE CHALLENGE" },
    { url: "/covers/Color_Guard.webp",     title: "PRECISION",  subtitle: "IN EVERY MOVEMENT" },
    { url: "/covers/fallenheros2025.webp", title: "HONORING",   subtitle: "OUR FALLEN HEROES" },
    { url: "/covers/JV_Raiders.webp",      title: "TRAINING",   subtitle: "THE NEXT GENERATION" }
  ],
  quickAccess: [
    { title: "Cadet Info",    desc: "Regulations, Creed, and Knowledge.", link: "/cadet-info" },
    { title: "Leadership",    desc: "Battalion Staff & Command.",         link: "/leadership" },
    { title: "Teams", desc: "Raiders, Drill, and Color Guard.",  link: "/teams" }
  ]
};
