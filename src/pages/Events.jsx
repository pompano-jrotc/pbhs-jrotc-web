import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { Calendar, MapPin, Tag } from 'lucide-react';

const Events = () => {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    // Orders events by date so the soonest ones appear first
    const q = query(collection(db, "events"), orderBy("date", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(e => !e.isPrivate));
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 p-10 ml-64 text-white">
      <header className="mb-10">
        <h1 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
          <Calendar className="text-yellow-500" /> Battalion Operations
        </h1>
        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-1">S-3 Training & Events</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {events.map((event) => (
          <div key={event.id} className="bg-slate-900 border border-white/5 rounded-3xl p-6 hover:border-yellow-500/30 transition-all group shadow-xl">
            <div className="flex justify-between items-start mb-4">
              <span className="bg-yellow-500/10 text-yellow-500 text-[9px] font-black px-2 py-1 rounded uppercase">
                {event.type}
              </span>
              <p className="text-slate-500 text-xs font-bold">{event.date}</p>
            </div>
            
            <h3 className="text-xl font-black uppercase italic mb-4 group-hover:text-yellow-500 transition-colors">
              {event.title}
            </h3>

            <div className="space-y-2 mt-auto">
              <div className="flex items-center gap-2 text-slate-400 text-xs font-medium">
                <MapPin size={14} className="text-slate-600" />
                {event.location}
              </div>
            </div>
          </div>
        ))}

        {events.length === 0 && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-800 rounded-3xl">
            <p className="text-slate-600 italic">No scheduled events in the operations log.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Events;