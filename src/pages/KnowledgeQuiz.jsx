// src/pages/KnowledgeQuiz.jsx
// Promotion Board Study Tool — 3 modes: Quiz, Flashcards, Fill in the Blank.
// Cadets pick one or more topics, then a study mode. No login required.

import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, RotateCcw, CheckCircle2, XCircle, ArrowLeft, Layers, PenLine, Target, Zap, Star } from 'lucide-react';
import { usePageMeta } from '../hooks/usePageMeta';

// ── Rank insignia renderer (matches CadetInfo.jsx) ───────────────────────────
// bg-black is intentional: insignia are always shown on a black military backing.
const RankSymbol = ({ type, count, hasWreath, hasStar, hasDiamond }) => {
  const isOfficer = type === 'officer' || type === 'officer-disk';
  const base = "relative w-14 h-28 bg-black border border-white/10 rounded-md flex flex-col items-center py-3 overflow-hidden shadow-xl";

  if (isOfficer) {
    const isDisk = type === 'officer-disk';
    return (
      <div className={base}>
        <div className="flex flex-col gap-2.5 items-center justify-center h-full">
          {[...Array(count)].map((_, i) => (
            <div key={i} className={isDisk
              ? "w-3.5 h-3.5 rounded-full bg-gradient-to-br from-slate-100 to-slate-300 shadow-[0_0_6px_rgba(255,255,255,0.3)] border border-slate-400"
              : "w-4 h-4 rotate-45 bg-gradient-to-br from-slate-100 to-slate-300 shadow-[0_0_6px_rgba(255,255,255,0.3)] border border-slate-400"
            } />
          ))}
        </div>
      </div>
    );
  }

  const up   = parseInt(String(count).split('/')[0]) || 0;
  const down = parseInt(String(count).split('/')[1]) || 0;

  return (
    <div className={base}>
      <div className="flex flex-col h-full w-full items-center justify-between px-1 scale-90">
        <div className="flex flex-col gap-1 w-full items-center">
          {[...Array(up)].map((_, i) => (
            <div key={i} className="w-10 h-2.5 bg-yellow-500 shadow-sm"
              style={{ clipPath: 'polygon(50% 0%, 100% 100%, 85% 100%, 50% 25%, 15% 100%, 0% 100%)' }} />
          ))}
        </div>
        <div className="relative flex items-center justify-center h-10 w-full">
          {hasWreath && (
            <div className="absolute w-10 h-10 border-4 border-double border-yellow-500/60 rounded-full flex items-center justify-center">
              <div className="absolute inset-0 border-2 border-dotted border-yellow-500/40 rounded-full rotate-45" />
            </div>
          )}
          {hasStar    && <Star size={hasWreath ? 14 : 16} className="text-yellow-500 fill-yellow-500 z-10" />}
          {hasDiamond && <div className="w-3.5 h-3.5 rotate-45 bg-yellow-500 border border-yellow-600 shadow-sm z-10" />}
        </div>
        <div className="flex flex-col gap-1 w-full items-center">
          {[...Array(down)].map((_, i) => (
            <div key={i} className="w-10 h-1.5 bg-yellow-500 rounded-sm shadow-sm" />
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Categories ────────────────────────────────────────────────────────────────
const CAT = {
  BASICS:     { id: 'BASICS',     label: 'JROTC Basics',             color: 'yellow'  },
  VALUES:     { id: 'VALUES',     label: 'Army Values',              color: 'blue'    },
  PRINCIPLES: { id: 'PRINCIPLES', label: 'Principles of Leadership', color: 'green'   },
  CREED:      { id: 'CREED',      label: 'Cadet Creed',              color: 'purple'  },
  RANKS:      { id: 'RANKS',      label: 'Rank Structure',           color: 'orange'  },
};

const CAT_COLOR = {
  yellow: { pill: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20', dot: 'bg-yellow-500', bar: 'bg-yellow-500'  },
  blue:   { pill: 'bg-blue-500/10   text-blue-600   dark:text-blue-400   border-blue-500/20',   dot: 'bg-blue-500',   bar: 'bg-blue-500'    },
  green:  { pill: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  purple: { pill: 'bg-purple-500/10 text-purple-600  dark:text-purple-400  border-purple-500/20', dot: 'bg-purple-500', bar: 'bg-purple-500'  },
  orange: { pill: 'bg-orange-500/10 text-orange-600  dark:text-orange-400  border-orange-500/20', dot: 'bg-orange-500', bar: 'bg-orange-500'  },
};

// ── Study modes ───────────────────────────────────────────────────────────────
const MODES = [
  { id: 'quiz',       label: 'Quiz',              icon: Target,  desc: 'Multiple-choice questions. Get instant feedback and a final score.'   },
  { id: 'flashcards', label: 'Flashcards',         icon: Layers,  desc: 'Flip cards — mark what you know and what still needs work.'           },
  { id: 'fill',       label: 'Fill in the Blank',  icon: PenLine, desc: 'Type the missing word. Tests exact recall of definitions and facts.'   },
];

const CHOICE_LABELS = ['A', 'B', 'C', 'D'];

// ── Item bank ─────────────────────────────────────────────────────────────────
// Each item has: cat, front (flashcard Q), back (flashcard A), quiz {}, fill {}
const ITEMS = [
  // ── JROTC BASICS ──────────────────────────────────────────────────────────
  { id:'b1', cat:CAT.BASICS,
    front:'What does JROTC stand for?',
    back:'Junior Reserve Officer Training Corps',
    quiz:{ q:'What does JROTC stand for?', choices:['Junior Reserve Officer Training Corps','Junior Ranked Officer Training Corps','Junior Reserve Officer Tactical Command','Junior Ready Officer Training Corps'], answer:0, explain:'JROTC — Junior Reserve Officer Training Corps.' },
    fill:{ sentence:'JROTC stands for Junior Reserve Officer _____ Corps.', answer:'Training' } },
  { id:'b2', cat:CAT.BASICS,
    front:'What does LET stand for?',
    back:'Leadership Education Training',
    quiz:{ q:'What does LET stand for?', choices:['Leadership Education Training','Leader Evaluation Test','Leadership Enrollment Track','Leader Experience Training'], answer:0, explain:'LET — Leadership Education Training.' },
    fill:{ sentence:'LET stands for Leadership _____ Training.', answer:'Education' } },
  { id:'b3', cat:CAT.BASICS,
    front:'What is the JROTC mission statement?',
    back:'"To motivate young people to be better citizens."',
    quiz:{ q:'What is the JROTC mission statement?', choices:['"To motivate young people to be better citizens."','"To train the next generation of Army officers."','"To develop leadership in all cadets."','"To build discipline and character in youth."'], answer:0, explain:'The official mission statement is: "To motivate young people to be better citizens."' },
    fill:{ sentence:'The JROTC mission is to motivate young people to be better _____.', answer:'citizens' } },
  { id:'b4', cat:CAT.BASICS,
    front:'What is the PBHS Tornado Battalion motto?',
    back:'"Above and Beyond"',
    quiz:{ q:'What is the PBHS Tornado Battalion motto?', choices:['Above and Beyond','Always Forward','Mission First','Honor Before Self'], answer:0, explain:'The PBHS Tornado Battalion motto is "Above and Beyond."' },
    fill:{ sentence:'The PBHS battalion motto is "_____ and Beyond."', answer:'Above' } },
  { id:'b5', cat:CAT.BASICS,
    front:'What acronym represents the 7 Army Values?',
    back:'LDRSHIP — Loyalty, Duty, Respect, Selfless Service, Honor, Integrity, Personal Courage',
    quiz:{ q:'What acronym spells out the 7 Army Values?', choices:['LDRSHIP','LEADERS','RESPECT','ARMYVLZ'], answer:0, explain:'LDRSHIP — each letter is an Army Value.' },
    fill:{ sentence:'The 7 Army Values are remembered with the acronym _____.', answer:'LDRSHIP' } },
  { id:'b6', cat:CAT.BASICS,
    front:'What is the definition of Leadership?',
    back:'The ability to motivate (guide) others to accomplish a mission (task) in the manner desired by providing purpose, direction, and motivation.',
    quiz:{ q:'What is the definition of Leadership?', choices:['The ability to motivate others to accomplish a mission by providing purpose, direction, and motivation','The ability to command others in battle with authority and skill','The power to make decisions for a group under pressure','The skill of managing resources and personnel efficiently'], answer:0, explain:'Leadership = ability to motivate others to accomplish a mission by providing purpose, direction, and motivation.' },
    fill:{ sentence:'Leadership is the ability to _____ others to accomplish a mission.', answer:'motivate' } },
  { id:'b7', cat:CAT.BASICS,
    front:'How many Army Values are there?',
    back:'7 Army Values',
    quiz:{ q:'How many Army Values are there?', choices:['7','8','6','11'], answer:0, explain:'There are 7 Army Values (LDRSHIP).' },
    fill:{ sentence:'There are _____ Army Values remembered by the acronym LDRSHIP.', answer:'7' } },
  { id:'b8', cat:CAT.BASICS,
    front:'How many Principles of Leadership are there?',
    back:'11 Principles of Leadership',
    quiz:{ q:'How many Principles of Leadership are there?', choices:['11','7','9','12'], answer:0, explain:'There are 11 Principles of Leadership.' },
    fill:{ sentence:'There are _____ Principles of Leadership.', answer:'11' } },
  { id:'b9', cat:CAT.BASICS,
    front:'What does "C/" before a rank indicate?',
    back:'"C/" stands for Cadet — it distinguishes a JROTC rank from an active-duty military rank.',
    quiz:{ q:'What does the "C/" prefix before a rank (e.g., C/CPT) indicate?', choices:['Cadet','Commander','Corporal','Classified'], answer:0, explain:'"C/" = Cadet — used to distinguish JROTC ranks.' },
    fill:{ sentence:'The prefix "C/" before a rank stands for _____.', answer:'Cadet' } },

  // ── ARMY VALUES ───────────────────────────────────────────────────────────
  { id:'v1', cat:CAT.VALUES,
    front:'What does "L" in LDRSHIP stand for?',
    back:'Loyalty — To bear true faith and allegiance to the US Constitution and your peers.',
    quiz:{ q:'What does the "L" in LDRSHIP stand for?', choices:['Loyalty','Leadership','Liberty','Labor'], answer:0, explain:'L = Loyalty: To bear true faith and allegiance to the US Constitution and your peers.' },
    fill:{ sentence:'The "L" in LDRSHIP stands for _____.', answer:'Loyalty' } },
  { id:'v2', cat:CAT.VALUES,
    front:'Define Loyalty.',
    back:'To bear true faith and allegiance to the US Constitution and your peers.',
    quiz:{ q:'Which Army Value means "to bear true faith and allegiance to the US Constitution and your peers"?', choices:['Loyalty','Duty','Honor','Integrity'], answer:0, explain:'Loyalty — the first Army Value.' },
    fill:{ sentence:'Loyalty means to bear true faith and allegiance to the US _____.', answer:'Constitution' } },
  { id:'v3', cat:CAT.VALUES,
    front:'What does "D" in LDRSHIP stand for?',
    back:'Duty — To fulfill all obligations.',
    quiz:{ q:'What does the "D" in LDRSHIP stand for?', choices:['Duty','Dedication','Discipline','Determination'], answer:0, explain:'D = Duty: To fulfill all obligations.' },
    fill:{ sentence:'The "D" in LDRSHIP stands for _____.', answer:'Duty' } },
  { id:'v4', cat:CAT.VALUES,
    front:'Define Duty.',
    back:'To fulfill all obligations.',
    quiz:{ q:'Which Army Value means "to fulfill all obligations"?', choices:['Duty','Loyalty','Selfless Service','Personal Courage'], answer:0, explain:'Duty — fulfilling all obligations to your unit, mission, and fellow cadets.' },
    fill:{ sentence:'Duty means to fulfill all _____.', answer:'obligations' } },
  { id:'v5', cat:CAT.VALUES,
    front:'What does "R" in LDRSHIP stand for?',
    back:'Respect — To treat others the way they should be treated.',
    quiz:{ q:'What does the "R" in LDRSHIP stand for?', choices:['Respect','Responsibility','Resilience','Readiness'], answer:0, explain:'R = Respect: To treat others the way they should be treated.' },
    fill:{ sentence:'The "R" in LDRSHIP stands for _____.', answer:'Respect' } },
  { id:'v6', cat:CAT.VALUES,
    front:'Define Respect.',
    back:'To treat others the way they should be treated.',
    quiz:{ q:'Which Army Value means "to treat others the way they should be treated"?', choices:['Respect','Honor','Integrity','Selfless Service'], answer:0, explain:'Respect — treating everyone with dignity.' },
    fill:{ sentence:'Respect means to treat others the way they should be _____.', answer:'treated' } },
  { id:'v7', cat:CAT.VALUES,
    front:'What does "S" in LDRSHIP stand for?',
    back:'Selfless Service — To put the welfare of the nation before your own.',
    quiz:{ q:'What does the "S" in LDRSHIP stand for?', choices:['Selfless Service','Sacrifice','Strength','Support'], answer:0, explain:'S = Selfless Service: To put the welfare of the nation before your own.' },
    fill:{ sentence:'The "S" in LDRSHIP stands for _____ Service.', answer:'Selfless' } },
  { id:'v8', cat:CAT.VALUES,
    front:'Define Selfless Service.',
    back:'To put the welfare of the nation before your own.',
    quiz:{ q:'Which Army Value is defined as "to put the welfare of the nation before your own"?', choices:['Selfless Service','Duty','Honor','Loyalty'], answer:0, explain:'Selfless Service — others before self.' },
    fill:{ sentence:'Selfless Service means to put the welfare of the nation before your _____.', answer:'own' } },
  { id:'v9', cat:CAT.VALUES,
    front:'What does "H" in LDRSHIP stand for?',
    back:'Honor — To live up to all values.',
    quiz:{ q:'What does the "H" in LDRSHIP stand for?', choices:['Honor','Honesty','Humility','Heroism'], answer:0, explain:'H = Honor: To live up to all values.' },
    fill:{ sentence:'The "H" in LDRSHIP stands for _____.', answer:'Honor' } },
  { id:'v10', cat:CAT.VALUES,
    front:'Define Honor.',
    back:'To live up to all values.',
    quiz:{ q:'Which Army Value means "to live up to all values"?', choices:['Honor','Integrity','Loyalty','Respect'], answer:0, explain:'Honor — living up to all the Army Values.' },
    fill:{ sentence:'Honor means to live up to all _____.', answer:'values' } },
  { id:'v11', cat:CAT.VALUES,
    front:'What does "I" in LDRSHIP stand for?',
    back:'Integrity — To do what is right, legally and morally.',
    quiz:{ q:'What does the "I" in LDRSHIP stand for?', choices:['Integrity','Initiative','Intelligence','Influence'], answer:0, explain:'I = Integrity: To do what is right, legally and morally.' },
    fill:{ sentence:'The "I" in LDRSHIP stands for _____.', answer:'Integrity' } },
  { id:'v12', cat:CAT.VALUES,
    front:'Define Integrity.',
    back:'To do what is right, legally and morally.',
    quiz:{ q:'Which Army Value means "to do what is right, legally and morally"?', choices:['Integrity','Honor','Duty','Respect'], answer:0, explain:'Integrity — doing right even when no one is watching.' },
    fill:{ sentence:'Integrity means to do what is right, legally and _____.', answer:'morally' } },
  { id:'v13', cat:CAT.VALUES,
    front:'What does "P" in LDRSHIP stand for?',
    back:'Personal Courage — To face fear, danger, or adversity.',
    quiz:{ q:'What does the "P" in LDRSHIP stand for?', choices:['Personal Courage','Perseverance','Professionalism','Patriotism'], answer:0, explain:'P = Personal Courage: To face fear, danger, or adversity.' },
    fill:{ sentence:'The "P" in LDRSHIP stands for Personal _____.', answer:'Courage' } },
  { id:'v14', cat:CAT.VALUES,
    front:'Define Personal Courage.',
    back:'To face fear, danger, or adversity.',
    quiz:{ q:'Which Army Value means "to face fear, danger, or adversity"?', choices:['Personal Courage','Integrity','Honor','Duty'], answer:0, explain:'Personal Courage — facing fear, danger, or adversity (physical or moral).' },
    fill:{ sentence:'Personal Courage means to face fear, danger, or _____.', answer:'adversity' } },

  // ── PRINCIPLES OF LEADERSHIP ──────────────────────────────────────────────
  { id:'p1', cat:CAT.PRINCIPLES,
    front:'1st Principle of Leadership',
    back:'Know yourself and seek self-improvement.',
    quiz:{ q:'What is the 1st Principle of Leadership?', choices:['Know yourself and seek self-improvement','Set the example','Be technically and tactically proficient','Ensure the task is understood, supervised, and accomplished'], answer:0, explain:'1st: Know yourself and seek self-improvement.' },
    fill:{ sentence:'1st Principle: Know _____ and seek self-improvement.', answer:'yourself' } },
  { id:'p2', cat:CAT.PRINCIPLES,
    front:'2nd Principle of Leadership',
    back:'Be technically and tactically proficient.',
    quiz:{ q:'What is the 2nd Principle of Leadership?', choices:['Be technically and tactically proficient','Know yourself and seek self-improvement','Set the example','Make sound and timely decisions'], answer:0, explain:'2nd: Be technically and tactically proficient.' },
    fill:{ sentence:'2nd Principle: Be technically and _____ proficient.', answer:'tactically' } },
  { id:'p3', cat:CAT.PRINCIPLES,
    front:'3rd Principle of Leadership',
    back:'Set the example.',
    quiz:{ q:'What is the 3rd Principle of Leadership?', choices:['Set the example','Know your subordinates and look out for their welfare','Be technically and tactically proficient','Keep your subordinates informed'], answer:0, explain:'3rd: Set the example.' },
    fill:{ sentence:'3rd Principle: Set the _____.', answer:'example' } },
  { id:'p4', cat:CAT.PRINCIPLES,
    front:'4th Principle of Leadership',
    back:'Ensure the task is understood, supervised, and accomplished.',
    quiz:{ q:'What is the 4th Principle of Leadership?', choices:['Ensure the task is understood, supervised, and accomplished','Set the example','Know your subordinates and look out for their welfare','Train your subordinates as a team'], answer:0, explain:'4th: Ensure the task is understood, supervised, and accomplished.' },
    fill:{ sentence:'4th Principle: Ensure the task is understood, supervised, and _____.', answer:'accomplished' } },
  { id:'p5', cat:CAT.PRINCIPLES,
    front:'5th Principle of Leadership',
    back:'Know your subordinates and look out for their welfare.',
    quiz:{ q:'What is the 5th Principle of Leadership?', choices:['Know your subordinates and look out for their welfare','Ensure the task is understood, supervised, and accomplished','Seek responsibility and take responsibility for your actions','Develop a sense of responsibility among your subordinates'], answer:0, explain:'5th: Know your subordinates and look out for their welfare.' },
    fill:{ sentence:'5th Principle: Know your subordinates and look out for their _____.', answer:'welfare' } },
  { id:'p6', cat:CAT.PRINCIPLES,
    front:'6th Principle of Leadership',
    back:'Seek responsibility and take responsibility for your actions.',
    quiz:{ q:'What is the 6th Principle of Leadership?', choices:['Seek responsibility and take responsibility for your actions','Know your subordinates and look out for their welfare','Make sound and timely decisions','Develop a sense of responsibility among your subordinates'], answer:0, explain:'6th: Seek responsibility and take responsibility for your actions.' },
    fill:{ sentence:'6th Principle: Seek _____ and take responsibility for your actions.', answer:'responsibility' } },
  { id:'p7', cat:CAT.PRINCIPLES,
    front:'7th Principle of Leadership',
    back:'Make sound and timely decisions.',
    quiz:{ q:'What is the 7th Principle of Leadership?', choices:['Make sound and timely decisions','Keep your subordinates informed','Employ your subordinates in accordance with their capabilities','Seek responsibility and take responsibility for your actions'], answer:0, explain:'7th: Make sound and timely decisions.' },
    fill:{ sentence:'7th Principle: Make sound and _____ decisions.', answer:'timely' } },
  { id:'p8', cat:CAT.PRINCIPLES,
    front:'8th Principle of Leadership',
    back:'Keep your subordinates informed.',
    quiz:{ q:'What is the 8th Principle of Leadership?', choices:['Keep your subordinates informed','Make sound and timely decisions','Develop a sense of responsibility among your subordinates','Train your subordinates as a team'], answer:0, explain:'8th: Keep your subordinates informed.' },
    fill:{ sentence:'8th Principle: Keep your subordinates _____.', answer:'informed' } },
  { id:'p9', cat:CAT.PRINCIPLES,
    front:'9th Principle of Leadership',
    back:'Develop a sense of responsibility among your subordinates.',
    quiz:{ q:'What is the 9th Principle of Leadership?', choices:['Develop a sense of responsibility among your subordinates','Keep your subordinates informed','Train your subordinates as a team','Employ your subordinates in accordance with their capabilities'], answer:0, explain:'9th: Develop a sense of responsibility among your subordinates.' },
    fill:{ sentence:'9th Principle: Develop a sense of _____ among your subordinates.', answer:'responsibility' } },
  { id:'p10', cat:CAT.PRINCIPLES,
    front:'10th Principle of Leadership',
    back:'Employ your subordinates in accordance with their capabilities.',
    quiz:{ q:'What is the 10th Principle of Leadership?', choices:['Employ your subordinates in accordance with their capabilities','Train your subordinates as a team','Develop a sense of responsibility among your subordinates','Keep your subordinates informed'], answer:0, explain:'10th: Employ your subordinates in accordance with their capabilities.' },
    fill:{ sentence:'10th Principle: Employ your subordinates in accordance with their _____.', answer:'capabilities' } },
  { id:'p11', cat:CAT.PRINCIPLES,
    front:'11th Principle of Leadership',
    back:'Train your subordinates as a team.',
    quiz:{ q:'What is the 11th Principle of Leadership?', choices:['Train your subordinates as a team','Employ your subordinates in accordance with their capabilities','Seek responsibility and take responsibility for your actions','Make sound and timely decisions'], answer:0, explain:'11th: Train your subordinates as a team.' },
    fill:{ sentence:'11th Principle: Train your subordinates as a _____.', answer:'team' } },

  // ── CADET CREED ───────────────────────────────────────────────────────────
  { id:'c1', cat:CAT.CREED,
    front:'How does the Cadet Creed begin?',
    back:'"I am an Army Junior R.O.T.C. Cadet."',
    quiz:{ q:'How does the Cadet Creed begin?', choices:['"I am an Army Junior R.O.T.C. Cadet."','"I am a proud member of the United States Army JROTC."','"I pledge allegiance to the United States of America."','"I am a cadet of the United States Army JROTC."'], answer:0, explain:'The Cadet Creed opens: "I am an Army Junior R.O.T.C. Cadet."' },
    fill:{ sentence:'I am an Army Junior R.O.T.C. _____.', answer:'Cadet' } },
  { id:'c2', cat:CAT.CREED,
    front:'A cadet conducts themselves to bring credit to which 4 things?',
    back:'Family, country, school, and the Corps of Cadets.',
    quiz:{ q:'A cadet conducts themselves to bring credit to which four things?', choices:['Family, country, school, and the Corps of Cadets','Family, nation, school, and the Army','Parents, country, unit, and the Corps of Cadets','Family, country, battalion, and the community'], answer:0, explain:'"…bring credit to my family, country, school, and the Corps of Cadets."' },
    fill:{ sentence:'I will bring credit to my family, country, school, and the Corps of _____.', answer:'Cadets' } },
  { id:'c3', cat:CAT.CREED,
    front:'"I am loyal and patriotic. I am the _____ of the United States of America."',
    back:'"future" — I am the future of the United States of America.',
    quiz:{ q:'Complete: "I am loyal and patriotic. I am the _____ of the United States of America."', choices:['future','hope','strength','pride'], answer:0, explain:'"I am loyal and patriotic. I am the future of the United States of America."' },
    fill:{ sentence:'I am loyal and patriotic. I am the _____ of the United States of America.', answer:'future' } },
  { id:'c4', cat:CAT.CREED,
    front:'What does the Cadet Creed say about lying, cheating, or stealing?',
    back:'"I do not lie, cheat, or steal, and will always be accountable for my actions and deeds."',
    quiz:{ q:'What does the Cadet Creed say about lying, cheating, or stealing?', choices:['"I do not lie, cheat, or steal, and will always be accountable for my actions and deeds."','"I will never lie, cheat, or steal under any circumstances."','"I do not lie, cheat, steal, or tolerate those who do."','"I will not lie, cheat, or steal and will report those who do."'], answer:0, explain:'Exact wording: "I do not lie, cheat, or steal, and will always be accountable for my actions and deeds."' },
    fill:{ sentence:'I do not lie, cheat, or _____, and will always be accountable for my actions and deeds.', answer:'steal' } },
  { id:'c5', cat:CAT.CREED,
    front:'What will a cadet always practice?',
    back:'"I will always practice good citizenship and patriotism."',
    quiz:{ q:'According to the Cadet Creed, what will a cadet always practice?', choices:['Good citizenship and patriotism','Discipline and dedication','Honor and integrity','Duty and loyalty'], answer:0, explain:'"I will always practice good citizenship and patriotism."' },
    fill:{ sentence:'I will always practice good citizenship and _____.', answer:'patriotism' } },
  { id:'c6', cat:CAT.CREED,
    front:'What does the Cadet Creed say a cadet will seek?',
    back:'"I will seek the mantle of leadership and stand prepared to uphold the Constitution and the American Way of Life."',
    quiz:{ q:'According to the Cadet Creed, what does a cadet seek?', choices:['"The mantle of leadership"','"A career in the United States Army"','"Excellence in all areas of life"','"Advancement through hard work"'], answer:0, explain:'"I will seek the mantle of leadership and stand prepared to uphold the Constitution…"' },
    fill:{ sentence:'I will seek the mantle of _____ and stand prepared to uphold the Constitution.', answer:'leadership' } },
  { id:'c7', cat:CAT.CREED,
    front:'How does the Cadet Creed end?',
    back:'"May God always grant me the strength to always live by this creed."',
    quiz:{ q:'How does the Cadet Creed end?', choices:['"May God always grant me the strength to always live by this creed."','"May I always have the courage to uphold this creed."','"I will always strive to live by this creed."','"May I always find the strength to serve my country with honor."'], answer:0, explain:'The Cadet Creed closes: "May God always grant me the strength to always live by this creed."' },
    fill:{ sentence:'May God always grant me the strength to always live by this _____.', answer:'creed' } },

  // ── RANK STRUCTURE ─────────────────────────────────────────────────────────
  // symbolProps feeds RankSymbol — the visual insignia is shown on flashcard fronts
  // and above quiz/fill questions so cadets recognize the actual insignia.
  { id:'r1', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Colonel (C/COL) — 3 Diamonds',
    symbolProps:{ type:'officer', count:3 },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Colonel (C/COL)','Cadet Lieutenant Colonel (C/LTC)','Cadet Major (C/MAJ)','Cadet Captain (C/CPT)'], answer:0, explain:'C/COL = Cadet Colonel — 3 Diamonds.' },
    fill:{ sentence:'This rank is Cadet _____ (C/COL).', answer:'Colonel' } },
  { id:'r2', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Lieutenant Colonel (C/LTC) — 2 Diamonds',
    symbolProps:{ type:'officer', count:2 },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Lieutenant Colonel (C/LTC)','Cadet Colonel (C/COL)','Cadet Major (C/MAJ)','Cadet Captain (C/CPT)'], answer:0, explain:'C/LTC = Cadet Lieutenant Colonel — 2 Diamonds.' },
    fill:{ sentence:'This rank is Cadet Lieutenant _____ (C/LTC).', answer:'Colonel' } },
  { id:'r3', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Major (C/MAJ) — 1 Diamond',
    symbolProps:{ type:'officer', count:1 },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Major (C/MAJ)','Cadet Lieutenant Colonel (C/LTC)','Cadet Captain (C/CPT)','Cadet Colonel (C/COL)'], answer:0, explain:'C/MAJ = Cadet Major — 1 Diamond.' },
    fill:{ sentence:'This rank is Cadet _____ (C/MAJ).', answer:'Major' } },
  { id:'r4', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Captain (C/CPT) — 3 Disks',
    symbolProps:{ type:'officer-disk', count:3 },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Captain (C/CPT)','Cadet 1st Lieutenant (C/1LT)','Cadet 2nd Lieutenant (C/2LT)','Cadet Major (C/MAJ)'], answer:0, explain:'C/CPT = Cadet Captain — 3 Disks.' },
    fill:{ sentence:'This rank is Cadet _____ (C/CPT).', answer:'Captain' } },
  { id:'r5', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet 1st Lieutenant (C/1LT) — 2 Disks',
    symbolProps:{ type:'officer-disk', count:2 },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet 1st Lieutenant (C/1LT)','Cadet Captain (C/CPT)','Cadet 2nd Lieutenant (C/2LT)','Cadet Major (C/MAJ)'], answer:0, explain:'C/1LT = Cadet 1st Lieutenant — 2 Disks.' },
    fill:{ sentence:'This rank is Cadet 1st _____ (C/1LT).', answer:'Lieutenant' } },
  { id:'r6', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet 2nd Lieutenant (C/2LT) — 1 Disk',
    symbolProps:{ type:'officer-disk', count:1 },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet 2nd Lieutenant (C/2LT)','Cadet 1st Lieutenant (C/1LT)','Cadet Captain (C/CPT)','Cadet Major (C/MAJ)'], answer:0, explain:'C/2LT = Cadet 2nd Lieutenant — 1 Disk.' },
    fill:{ sentence:'This rank is Cadet 2nd _____ (C/2LT).', answer:'Lieutenant' } },
  { id:'r7', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Command Sergeant Major (C/CSM) — 3 Up / 3 Down / Wreath',
    symbolProps:{ count:'3/3', hasWreath:true, hasStar:true },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Command Sergeant Major (C/CSM)','Cadet Sergeant Major (C/SGM)','Cadet First Sergeant (C/1SG)','Cadet Master Sergeant (C/MSG)'], answer:0, explain:'C/CSM = Cadet Command Sergeant Major — 3 Up / 3 Down / Wreath + Star.' },
    fill:{ sentence:'This rank is Cadet Command Sergeant _____ (C/CSM).', answer:'Major' } },
  { id:'r8', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Sergeant Major (C/SGM) — 3 Up / 3 Down / Star',
    symbolProps:{ count:'3/3', hasStar:true },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Sergeant Major (C/SGM)','Cadet Command Sergeant Major (C/CSM)','Cadet First Sergeant (C/1SG)','Cadet Master Sergeant (C/MSG)'], answer:0, explain:'C/SGM = Cadet Sergeant Major — 3 Up / 3 Down / Star (no wreath).' },
    fill:{ sentence:'This rank is Cadet Sergeant _____ (C/SGM).', answer:'Major' } },
  { id:'r9', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet First Sergeant (C/1SG) — 3 Up / 3 Down / Diamond',
    symbolProps:{ count:'3/3', hasDiamond:true },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet First Sergeant (C/1SG)','Cadet Sergeant Major (C/SGM)','Cadet Command Sergeant Major (C/CSM)','Cadet Master Sergeant (C/MSG)'], answer:0, explain:'C/1SG = Cadet First Sergeant — 3 Up / 3 Down / Diamond.' },
    fill:{ sentence:'This rank is Cadet First _____ (C/1SG).', answer:'Sergeant' } },
  { id:'r10', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Master Sergeant (C/MSG) — 3 Up / 3 Down',
    symbolProps:{ count:'3/3' },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Master Sergeant (C/MSG)','Cadet First Sergeant (C/1SG)','Cadet Sergeant Major (C/SGM)','Cadet Staff Sergeant (C/SSG)'], answer:0, explain:'C/MSG = Cadet Master Sergeant — 3 Up / 3 Down (no center device).' },
    fill:{ sentence:'This rank is Cadet Master _____ (C/MSG).', answer:'Sergeant' } },
  { id:'r11', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Sergeant First Class (C/SFC) — 3 Up / 2 Down',
    symbolProps:{ count:'3/2' },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Sergeant First Class (C/SFC)','Cadet Staff Sergeant (C/SSG)','Cadet Master Sergeant (C/MSG)','Cadet Sergeant (C/SGT)'], answer:0, explain:'C/SFC = Cadet Sergeant First Class — 3 Up / 2 Down.' },
    fill:{ sentence:'This rank is Cadet Sergeant First _____ (C/SFC).', answer:'Class' } },
  { id:'r12', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Staff Sergeant (C/SSG) — 3 Up / 1 Down',
    symbolProps:{ count:'3/1' },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Staff Sergeant (C/SSG)','Cadet Sergeant First Class (C/SFC)','Cadet Sergeant (C/SGT)','Cadet Master Sergeant (C/MSG)'], answer:0, explain:'C/SSG = Cadet Staff Sergeant — 3 Up / 1 Down.' },
    fill:{ sentence:'This rank is Cadet Staff _____ (C/SSG).', answer:'Sergeant' } },
  { id:'r13', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Sergeant (C/SGT) — 3 Up',
    symbolProps:{ count:'3/0' },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Sergeant (C/SGT)','Cadet Staff Sergeant (C/SSG)','Cadet Corporal (C/CPL)','Cadet Private First Class (C/PFC)'], answer:0, explain:'C/SGT = Cadet Sergeant — 3 Up (no rockers).' },
    fill:{ sentence:'This rank is Cadet _____ (C/SGT).', answer:'Sergeant' } },
  { id:'r14', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Corporal (C/CPL) — 2 Up',
    symbolProps:{ count:'2/0' },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Corporal (C/CPL)','Cadet Sergeant (C/SGT)','Cadet Private First Class (C/PFC)','Cadet Private (C/PVT)'], answer:0, explain:'C/CPL = Cadet Corporal — 2 Up.' },
    fill:{ sentence:'This rank is Cadet _____ (C/CPL).', answer:'Corporal' } },
  { id:'r15', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Private First Class (C/PFC) — 1 Up / 1 Down',
    symbolProps:{ count:'1/1' },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Private First Class (C/PFC)','Cadet Corporal (C/CPL)','Cadet Private (C/PVT)','Cadet Sergeant (C/SGT)'], answer:0, explain:'C/PFC = Cadet Private First Class — 1 Up / 1 Down.' },
    fill:{ sentence:'This rank is Cadet Private First _____ (C/PFC).', answer:'Class' } },
  { id:'r16', cat:CAT.RANKS,
    front:'What rank is this?', back:'Cadet Private (C/PVT) — 1 Up (most junior)',
    symbolProps:{ count:'1/0' },
    quiz:{ q:'What rank wears this insignia?', choices:['Cadet Private (C/PVT)','Cadet Private First Class (C/PFC)','Cadet Corporal (C/CPL)','Cadet Sergeant (C/SGT)'], answer:0, explain:'C/PVT = Cadet Private — 1 Up (most junior rank).' },
    fill:{ sentence:'This rank is Cadet _____ (C/PVT).', answer:'Private' } },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleQuizChoices(item) {
  const q = item.quiz;
  const indexed = q.choices.map((text, i) => ({ text, correct: i === q.answer }));
  const shuffled = shuffle(indexed);
  return { ...item, quiz: { ...q, choices: shuffled.map(c => c.text), answer: shuffled.findIndex(c => c.correct) } };
}

function normalize(s) {
  return (s || '').toLowerCase().trim().replace(/[.,!?'"]$/g, '');
}

function resultTier(pct) {
  if (pct === 100) return { label: 'Distinguished', color: 'text-yellow-500', desc: 'Perfect score. You are board-ready.' };
  if (pct >= 85)  return { label: 'Excellent',      color: 'text-emerald-500', desc: 'Outstanding performance. You know your material.' };
  if (pct >= 70)  return { label: 'Proficient',     color: 'text-blue-500',    desc: 'Solid foundation. Review missed questions before the board.' };
  if (pct >= 50)  return { label: 'Developing',     color: 'text-orange-500',  desc: 'Keep studying. Focus on the categories where you lost points.' };
  return           { label: 'Needs Work',           color: 'text-red-500',     desc: "Don't give up — review the material and retake." };
}

// ── Render sentence with blank highlighted ────────────────────────────────────
function SentenceWithBlank({ sentence, checked, correct }) {
  const parts = sentence.split('_____');
  return (
    <p className="text-lg md:text-xl font-bold leading-snug text-slate-800 dark:text-white">
      {parts[0]}
      <span className={`inline-block min-w-[80px] border-b-2 pb-0.5 mx-1 ${
        !checked ? 'border-yellow-500' :
        correct  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400' :
                   'border-red-400 text-red-500 dark:text-red-400'
      }`}>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      </span>
      {parts[1]}
    </p>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ current, total, correct }) {
  return (
    <div className="mb-8">
      <div className="flex justify-between items-center mb-2">
        <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400">
          {current + 1} / {total}
        </p>
        <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400 tabular-nums">
          {correct} correct
        </p>
      </div>
      <div className="h-1 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
        <div
          className="h-full bg-yellow-500 rounded-full transition-all duration-300"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ── Category pill ─────────────────────────────────────────────────────────────
function CatPill({ cat }) {
  const c = CAT_COLOR[cat.color];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded-xl border ${c.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {cat.label}
    </span>
  );
}

// ── Results screen ────────────────────────────────────────────────────────────
function ResultsScreen({ mode, answers, items, onRetake, onHome }) {
  const correct = answers.filter(a => a.correct).length;
  const pct = items.length ? Math.round((correct / items.length) * 100) : 0;
  const tier = resultTier(pct);

  const catBreakdown = Object.values(CAT).map(cat => {
    const idxs = items.map((it, i) => (it.cat.id === cat.id ? i : -1)).filter(i => i !== -1);
    const ok = idxs.filter(i => answers[i]?.correct).length;
    return { cat, total: idxs.length, correct: ok };
  }).filter(b => b.total > 0);

  const isFlash = mode === 'flashcards';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-5 pt-24 pb-16">
        <p className="text-[0.6rem] font-black tracking-[0.3em] uppercase text-yellow-500 mb-6">
          {isFlash ? 'Round Complete' : 'Quiz Complete'}
        </p>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 mb-6">
          <div className="flex items-start gap-6 mb-6">
            <div>
              <p className={`text-xs font-black uppercase tracking-widest mb-1 ${tier.color}`}>{tier.label}</p>
              {isFlash ? (
                <>
                  <p className="text-5xl font-black leading-none tabular-nums">{correct}<span className="text-2xl text-slate-400">/{items.length}</span></p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">cards marked "Know It"</p>
                </>
              ) : (
                <>
                  <p className="text-5xl font-black leading-none tabular-nums">{pct}<span className="text-2xl text-slate-400">%</span></p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{correct} of {items.length} correct</p>
                </>
              )}
            </div>
          </div>
          {!isFlash && (
            <div className="h-2 rounded-full bg-slate-100 dark:bg-white/5 mb-4 overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-1000 ${pct===100?'bg-yellow-500':pct>=70?'bg-emerald-500':pct>=50?'bg-orange-500':'bg-red-500'}`} style={{ width:`${pct}%` }} />
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">{tier.desc}</p>
        </div>

        {catBreakdown.length > 1 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 mb-6">
            <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400 mb-5">Breakdown by Category</p>
            <div className="space-y-3">
              {catBreakdown.map(({ cat, correct: ok, total }) => {
                const p = total ? Math.round((ok / total) * 100) : 0;
                const c = CAT_COLOR[cat.color];
                return (
                  <div key={cat.id}>
                    <div className="flex justify-between items-center mb-1.5">
                      <CatPill cat={cat} />
                      <span className="text-xs font-black tabular-nums text-slate-500 dark:text-slate-400">{ok}/{total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                      <div className={`h-full rounded-full ${c.bar}`} style={{ width:`${p}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button onClick={onRetake} className="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-black uppercase tracking-widest text-xs px-7 py-3.5 rounded-xl transition-colors">
            <RotateCcw size={13} /> Retake
          </button>
          <button onClick={onHome} className="inline-flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 text-slate-600 dark:text-slate-400 font-black uppercase tracking-widest text-xs px-7 py-3.5 rounded-xl transition-colors">
            <ArrowLeft size={13} /> Change Mode
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quiz mode ─────────────────────────────────────────────────────────────────
function QuizMode({ items, onFinish, onQuit }) {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState([]);

  const q = items[current];
  const quiz = q.quiz;

  const handleChoice = (idx) => {
    if (revealed) return;
    setSelected(idx);
    setRevealed(true);
    setAnswers(prev => [...prev, { correct: idx === quiz.answer }]);
  };

  const handleNext = () => {
    if (current + 1 >= items.length) {
      onFinish(answers.concat(/* already added above */ []));
    } else {
      setCurrent(c => c + 1);
      setSelected(null);
      setRevealed(false);
    }
  };

  // onFinish called when we click next on last question — answers already has all
  const handleNextFinal = () => {
    if (current + 1 >= items.length) {
      onFinish(answers);
    } else {
      setCurrent(c => c + 1);
      setSelected(null);
      setRevealed(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto px-5 pt-24 pb-10">
        <ProgressBar current={current} total={items.length} correct={answers.filter(a=>a.correct).length} />
        <div className="mb-5"><CatPill cat={q.cat} /></div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 mb-5">
          {q.symbolProps && (
            <div className="flex justify-center mb-5">
              <RankSymbol {...q.symbolProps} />
            </div>
          )}
          <p className="text-lg md:text-xl font-bold leading-snug text-slate-800 dark:text-white">{quiz.q}</p>
        </div>

        <div className="space-y-3 mb-6">
          {quiz.choices.map((choice, i) => {
            const isSelected = selected === i;
            const isCorrect  = i === quiz.answer;
            let cls = 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20';
            if (revealed) {
              if (isCorrect)       cls = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-700 dark:text-emerald-300';
              else if (isSelected) cls = 'bg-red-50 dark:bg-red-950/40 border-red-400 text-red-700 dark:text-red-300';
              else                 cls = 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-white/5 text-slate-400 opacity-60';
            }
            return (
              <button key={i} onClick={() => handleChoice(i)} disabled={revealed}
                className={`w-full flex items-start gap-4 p-5 rounded-2xl border-2 text-left font-medium text-sm transition-all disabled:cursor-default ${cls}`}>
                <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black ${
                  revealed && isCorrect ? 'bg-emerald-500 text-white' :
                  revealed && isSelected ? 'bg-red-500 text-white' :
                  'bg-slate-100 dark:bg-white/5 text-slate-500'}`}>
                  {revealed && isCorrect ? <CheckCircle2 size={13} /> : revealed && isSelected ? <XCircle size={13} /> : CHOICE_LABELS[i]}
                </span>
                <span className="leading-relaxed pt-0.5">{choice}</span>
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className={`rounded-2xl p-5 mb-6 border ${selected===quiz.answer ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-500/20' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10'}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${selected===quiz.answer ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {selected===quiz.answer ? '✓ Correct' : '✕ Incorrect'} — Explanation
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{quiz.explain}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button onClick={onQuit} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1.5">
            <ArrowLeft size={12} /> Quit
          </button>
          {revealed && (
            <button onClick={handleNextFinal} className="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-black uppercase tracking-widest text-xs px-7 py-3.5 rounded-xl transition-colors">
              {current + 1 >= items.length ? 'See Results' : 'Next'} <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Flashcard mode ─────────────────────────────────────────────────────────────
function FlashcardMode({ items, onFinish, onQuit }) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [fading, setFading] = useState(false);
  const [answers, setAnswers] = useState([]); // {correct: bool} per card

  const flip = () => {
    if (fading) return;
    setFading(true);
    setTimeout(() => { setFlipped(f => !f); setFading(false); }, 120);
  };

  const handleMark = (knew) => {
    const newAnswers = [...answers, { correct: knew }];
    setAnswers(newAnswers);
    if (current + 1 >= items.length) {
      onFinish(newAnswers);
    } else {
      setFading(true);
      setTimeout(() => {
        setCurrent(c => c + 1);
        setFlipped(false);
        setFading(false);
      }, 120);
    }
  };

  const card = items[current];
  const knownCount = answers.filter(a => a.correct).length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto px-5 pt-24 pb-10">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-2">
            <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400">{current + 1} / {items.length}</p>
            <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400">{knownCount} known</p>
          </div>
          <div className="h-1 rounded-full bg-slate-200 dark:bg-white/5 overflow-hidden">
            <div className="h-full bg-yellow-500 rounded-full transition-all duration-300" style={{ width:`${(current/items.length)*100}%` }} />
          </div>
        </div>

        <div className="mb-5"><CatPill cat={card.cat} /></div>

        {/* Card */}
        <div
          onClick={!flipped ? flip : undefined}
          className={`relative bg-white dark:bg-slate-900 border-2 rounded-3xl p-8 mb-5 min-h-[220px] flex flex-col items-center justify-center text-center cursor-pointer select-none transition-all duration-200 ${
            flipped
              ? 'border-yellow-500/40 bg-yellow-50 dark:bg-yellow-950/20'
              : 'border-slate-200 dark:border-white/5 hover:border-yellow-500/30'
          } ${fading ? 'opacity-0' : 'opacity-100'}`}
          style={{ transition: 'opacity 0.12s ease, border-color 0.2s, background-color 0.2s' }}
        >
          {!flipped && (
            <p className="absolute top-4 right-5 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-600">tap to flip</p>
          )}
          {flipped && (
            <p className="absolute top-4 left-5 text-[9px] font-black uppercase tracking-widest text-yellow-500">Answer</p>
          )}
          {/* Show rank insignia on front for rank items */}
          {!flipped && card.symbolProps && (
            <div className="mb-4 flex justify-center">
              <RankSymbol {...card.symbolProps} />
            </div>
          )}
          <p className={`font-bold leading-snug ${flipped ? 'text-base text-slate-700 dark:text-slate-200' : 'text-xl text-slate-800 dark:text-white'}`}>
            {flipped ? card.back : card.front}
          </p>
        </div>

        {/* Actions — only after flip */}
        {flipped ? (
          <div className="flex gap-3 justify-center">
            <button onClick={() => handleMark(false)}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 font-black uppercase text-xs tracking-wider hover:border-red-400/50 hover:text-red-500 transition-all">
              <RotateCcw size={13} /> Still Learning
            </button>
            <button onClick={() => handleMark(true)}
              className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 font-black uppercase text-xs tracking-wider hover:border-emerald-500/60 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-all">
              <CheckCircle2 size={13} /> Know It
            </button>
          </div>
        ) : (
          <div className="flex justify-between">
            <button onClick={onQuit} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1.5">
              <ArrowLeft size={12} /> Quit
            </button>
            <button onClick={flip} className="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-black uppercase tracking-widest text-xs px-7 py-3.5 rounded-xl transition-colors">
              Flip Card <ChevronRight size={14} />
            </button>
          </div>
        )}

        {flipped && (
          <div className="mt-4 flex justify-start">
            <button onClick={onQuit} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1.5">
              <ArrowLeft size={12} /> Quit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Fill in the Blank mode ────────────────────────────────────────────────────
function FillMode({ items, onFinish, onQuit }) {
  const [current, setCurrent] = useState(0);
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [answers, setAnswers] = useState([]);

  const item = items[current];
  const fill = item.fill;

  const handleCheck = () => {
    if (!input.trim()) return;
    const correct = normalize(input) === normalize(fill.answer);
    setIsCorrect(correct);
    setChecked(true);
    setAnswers(prev => [...prev, { correct }]);
  };

  const handleNext = () => {
    if (current + 1 >= items.length) {
      onFinish([...answers]);
    } else {
      setCurrent(c => c + 1);
      setInput('');
      setChecked(false);
      setIsCorrect(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') {
      if (!checked) handleCheck();
      else handleNext();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto px-5 pt-24 pb-10">
        <ProgressBar current={current} total={items.length} correct={answers.filter(a=>a.correct).length} />
        <div className="mb-5"><CatPill cat={item.cat} /></div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-3xl p-8 mb-5">
          <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400 mb-4">Fill in the blank</p>
          {item.symbolProps && (
            <div className="flex justify-center mb-5">
              <RankSymbol {...item.symbolProps} />
            </div>
          )}
          <SentenceWithBlank sentence={fill.sentence} checked={checked} correct={isCorrect} />
          <div className="mt-6 flex gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              disabled={checked}
              placeholder="Type your answer…"
              autoFocus
              className={`flex-1 px-5 py-3 rounded-xl border-2 text-sm font-bold bg-slate-50 dark:bg-slate-800 placeholder-slate-400 dark:placeholder-slate-600 text-slate-800 dark:text-white outline-none transition-all ${
                checked
                  ? isCorrect
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                    : 'border-red-400 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                  : 'border-slate-200 dark:border-white/10 focus:border-yellow-500'
              }`}
            />
            {!checked && (
              <button onClick={handleCheck} disabled={!input.trim()}
                className="px-6 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-black uppercase text-xs tracking-wider transition-colors">
                Check
              </button>
            )}
          </div>
        </div>

        {checked && (
          <div className={`rounded-2xl p-5 mb-6 border ${isCorrect ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-500/20' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10'}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isCorrect ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {isCorrect ? '✓ Correct!' : `✕ The answer is: "${fill.answer}"`}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{item.back}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button onClick={onQuit} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1.5">
            <ArrowLeft size={12} /> Quit
          </button>
          {checked && (
            <button onClick={handleNext} className="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-black uppercase tracking-widest text-xs px-7 py-3.5 rounded-xl transition-colors">
              {current + 1 >= items.length ? 'See Results' : 'Next'} <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const KnowledgeQuiz = () => {
  usePageMeta({
    title: 'Promotion Board Study',
    description: 'Study for the PBHS JROTC Promotion Board with quizzes, flashcards, and fill-in-the-blank exercises.',
    path: '/knowledge-quiz',
  });

  const [selectedCats, setSelectedCats] = useState(new Set(Object.keys(CAT)));
  const [mode, setMode] = useState(null);
  const [phase, setPhase] = useState('landing'); // 'landing' | 'studying' | 'results'
  const [activeItems, setActiveItems] = useState([]);
  const [finalAnswers, setFinalAnswers] = useState([]);

  const toggleCat = (id) => {
    setSelectedCats(prev => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  };

  const poolForMode = useCallback((m) => {
    const base = ITEMS.filter(it => selectedCats.has(it.cat.id));
    if (m === 'quiz') return shuffle(base.filter(it => it.quiz)).map(shuffleQuizChoices);
    if (m === 'fill') return shuffle(base.filter(it => it.fill));
    return shuffle(base); // flashcards — all items
  }, [selectedCats]);

  const startStudy = () => {
    const items = poolForMode(mode);
    if (!items.length) return;
    setActiveItems(items);
    setFinalAnswers([]);
    setPhase('studying');
  };

  const handleFinish = (answers) => {
    setFinalAnswers(answers);
    setPhase('results');
  };

  const handleRetake = () => {
    const items = poolForMode(mode);
    setActiveItems(items);
    setFinalAnswers([]);
    setPhase('studying');
  };

  const handleHome = () => {
    setPhase('landing');
    setFinalAnswers([]);
  };

  const handleQuit = () => setPhase('landing');

  // ── Results ─────────────────────────────────────────────────────────────────
  if (phase === 'results') {
    return (
      <ResultsScreen
        mode={mode}
        answers={finalAnswers}
        items={activeItems}
        onRetake={handleRetake}
        onHome={handleHome}
      />
    );
  }

  // ── Studying ─────────────────────────────────────────────────────────────────
  if (phase === 'studying') {
    if (mode === 'quiz')       return <QuizMode       items={activeItems} onFinish={handleFinish} onQuit={handleQuit} />;
    if (mode === 'flashcards') return <FlashcardMode  items={activeItems} onFinish={handleFinish} onQuit={handleQuit} />;
    if (mode === 'fill')       return <FillMode       items={activeItems} onFinish={handleFinish} onQuit={handleQuit} />;
  }

  // ── Landing ──────────────────────────────────────────────────────────────────
  const itemCount = ITEMS.filter(it => selectedCats.has(it.cat.id)).length;
  const canStart = mode && selectedCats.size > 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-5 pt-24 pb-16">

        <Link to="/cadet-info" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors mb-10">
          <ArrowLeft size={14} /> Cadet Info
        </Link>

        <div className="mb-10">
          <p className="text-[0.6rem] font-black tracking-[0.3em] uppercase text-yellow-500 mb-3">PBHS Tornado Battalion · Promotion Board</p>
          <h1 className="text-5xl md:text-6xl font-black uppercase italic tracking-tighter leading-none mb-4">
            Board<br /><span className="text-yellow-500">Study</span>
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed max-w-md">
            Pick your topics, choose a study mode, and start drilling. Flashcards, multiple-choice, or fill-in-the-blank — instant feedback on every question.
          </p>
        </div>

        {/* ── Topic selection ─────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400">Topics — select one or more</p>
            <button
              onClick={() => setSelectedCats(new Set(Object.keys(CAT)))}
              className="text-[9px] font-black uppercase tracking-widest text-yellow-500 hover:text-yellow-400 transition-colors"
            >
              Select All
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.values(CAT).map(cat => {
              const active = selectedCats.has(cat.id);
              const c = CAT_COLOR[cat.color];
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCat(cat.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider border-2 transition-all ${
                    active
                      ? `${c.pill} border-current`
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                  {cat.label}
                  {active && <span className="ml-1 opacity-60">{ITEMS.filter(it=>it.cat.id===cat.id).length}</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 tabular-nums">{itemCount} items selected</p>
        </div>

        {/* ── Mode selection ──────────────────────────────────────────────── */}
        <div className="mb-10">
          <p className="text-[0.6rem] font-black uppercase tracking-widest text-slate-400 mb-3">Study Mode</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MODES.map(m => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`text-left p-5 rounded-2xl border-2 transition-all ${
                    active
                      ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20'
                      : 'border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  <Icon size={20} className={`mb-3 ${active ? 'text-yellow-500' : 'text-slate-400'}`} />
                  <p className={`font-black uppercase text-xs tracking-wider mb-1 ${active ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-700 dark:text-slate-300'}`}>
                    {m.label}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={startStudy}
          disabled={!canStart}
          className="inline-flex items-center gap-3 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-black uppercase tracking-widest text-sm px-10 py-4 rounded-2xl transition-colors shadow-lg shadow-yellow-500/20"
        >
          <Zap size={16} /> Start Studying
        </button>
        {!mode && <p className="text-[10px] text-slate-400 mt-2">Select a study mode above to begin.</p>}
      </div>
    </div>
  );
};

export default KnowledgeQuiz;
