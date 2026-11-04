import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
  Save, Trash2, Edit3, ShieldAlert,
  Mail, CheckCircle2, Users, Plus, Loader2,
  Target, ListChecks, UploadCloud, ImageOff
} from 'lucide-react';
import { ROLE_HIERARCHY, STAFF_LEVEL } from '../constants';
import { uploadToCloudinary } from '../utils/cloudinaryUpload';
import AdminPageHeader from '../components/AdminPageHeader';

const AdminTeams = ({ hideHeader = false }) => {
  const { user, role, userData, loading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const [teams, setTeams] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showStatus, setShowStatus] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null, name: '' });

  const [formData, setFormData] = useState({
    name: '', status: 'Open Practice', description: '', practice: '', location: '',
    requirements: '', disciplines: '', leadership: [], photo: ''
  });

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [personnel, setPersonnel] = useState([]);

  const userLevel = ROLE_HIERARCHY[role] || 0;
  const isPowerUser = userLevel >= STAFF_LEVEL;
  const userEmail = user?.email?.toLowerCase().trim();

  // Computed before the effects below since one of them depends on
  // isAuthorized - referencing a const in a dependency array before its
  // declaration line throws a "Cannot access before initialization" error
  // on every render, not just sometimes.
  const accessibleTeams = teams.filter(t =>
    isPowerUser || (t.commanderEmails && t.commanderEmails.includes(userEmail))
  );
  const isAuthorized = isPowerUser || accessibleTeams.length > 0;

  // Sync Teams Data
  useEffect(() => {
    if (!authLoading && user) {
      const q = query(collection(db, "specialTeams"), orderBy("name", "asc"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setTeams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        setDataLoading(false);
      }, () => setDataLoading(false));
      return () => unsubscribe();
    }
  }, [authLoading, user]);

  // Sync Roster (for the Command Structure "select an existing cadet" picker).
  // Gated on isAuthorized (not just signed-in) so an unauthorized visitor
  // doesn't pull down every cadet's name/email before the redirect fires.
  useEffect(() => {
    if (!authLoading && user && isAuthorized) {
      const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
        const roster = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.fullName && p.email)
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
        setPersonnel(roster);
      });
      return () => unsubscribe();
    }
  }, [authLoading, user, isAuthorized]);

  // If navigated here with ?team=<keyword> (e.g. from the roster special-assignment badge),
  // auto-open the matching team for editing on first load.
  const autoOpenedRef = React.useRef(false);
  useEffect(() => {
    const keyword = searchParams.get('team');
    if (!keyword || teams.length === 0 || autoOpenedRef.current) return;
    const match = teams.find(t => t.name.toLowerCase().includes(keyword.toLowerCase()));
    if (match) {
      autoOpenedRef.current = true;
      setEditingId(match.id);
      setFormData({
        ...match,
        requirements: Array.isArray(match.requirements) ? match.requirements.join(', ') : match.requirements || '',
        disciplines:  Array.isArray(match.disciplines)  ? match.disciplines.join(', ')  : match.disciplines  || '',
        leadership:   match.leadership || [],
      });
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 150);
    }
  }, [teams, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentTeam = teams.find(t => t.id === editingId);
  const userInTeam = currentTeam?.leadership?.find(l => l.email?.toLowerCase().trim() === userEmail);
  const teamSpecificRole = userInTeam?.teamRole || 'Team Member';
  const canEditMainFields = isPowerUser || teamSpecificRole === "Commander" || teamSpecificRole === "Co-Commander";

  const triggerStatus = (type, msg = '') => {
    setShowStatus(type);
    setStatusMsg(msg);
    setTimeout(() => { setShowStatus(null); setStatusMsg(''); }, 4000);
  };

  const handleSaveTeam = async (e) => {
    e.preventDefault();
    const docId = editingId || formData.name.toLowerCase().replace(/\s+/g, '-');
    const commanderEmails = formData.leadership.map(l => l.email?.toLowerCase().trim()).filter(Boolean);

    const finalData = {
      ...formData,
      commanderEmails,
      requirements: typeof formData.requirements === 'string' ? formData.requirements.split(',').map(r => r.trim()).filter(Boolean) : formData.requirements,
      disciplines: typeof formData.disciplines === 'string' ? formData.disciplines.split(',').map(d => d.trim()).filter(Boolean) : formData.disciplines,
      updatedAt: new Date(),
      lastUpdatedBy: userEmail
    };

    try {
      await setDoc(doc(db, "specialTeams", docId), finalData);
      setEditingId(null);
      setFormData({ name: '', status: 'Open Practice', description: '', practice: '', location: '', requirements: '', disciplines: '', leadership: [], photo: '' });
      triggerStatus('success');
      writeLog({
        type: 'team', action: editingId ? 'update' : 'create',
        description: `${editingId ? 'Updated' : 'Created'} team: ${formData.name}`,
        userId: user?.uid || '', userFullName: userData?.fullName || '',
        userRole: role || '', targetId: docId, targetName: formData.name,
      });
    } catch { triggerStatus('error'); }
  };

  const addLeader = () => {
    setFormData({
      ...formData,
      leadership: [...formData.leadership, { name: '', rank: '', teamRole: 'Team Member', letLevel: '', email: '' }]
    });
  };

  const updateLeader = (index, field, value) => {
    const updatedLeadership = [...formData.leadership];
    updatedLeadership[index][field] = value;
    setFormData({ ...formData, leadership: updatedLeadership });
  };

  // Fills name/rank/email from the selected roster account, so leadership
  // entries always point at a real registered cadet instead of free text.
  const selectLeaderPerson = (index, selectedEmail) => {
    const person = personnel.find(p => (p.email || '').toLowerCase() === selectedEmail.toLowerCase());
    const updatedLeadership = [...formData.leadership];
    updatedLeadership[index] = {
      ...updatedLeadership[index],
      name: person?.fullName || '',
      rank: person?.rank || '',
      email: person?.email || selectedEmail
    };
    setFormData({ ...formData, leadership: updatedLeadership });
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const data = await uploadToCloudinary(file, 'image');
      setFormData(prev => ({ ...prev, photo: data.secure_url }));
    } catch (err) {
      console.error("Team photo upload failed:", err);
      triggerStatus('error', err.message || 'Upload failed');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleEdit = (team) => {
    setEditingId(team.id);
    setFormData({
      ...team,
      requirements: Array.isArray(team.requirements) ? team.requirements.join(', ') : team.requirements || '',
      disciplines: Array.isArray(team.disciplines) ? team.disciplines.join(', ') : team.disciplines || '',
      leadership: team.leadership || []
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (authLoading || (dataLoading && teams.length === 0)) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-yellow-600 dark:text-yellow-500 mb-4" size={40} />
        <p className="font-black uppercase tracking-widest text-[10px] text-slate-500">Establishing Command Link...</p>
      </div>
    );
  }

  if (!isAuthorized && !dataLoading) return <Navigate to="/admin/dashboard" replace />;

  return (
    <div className={`${hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'} relative`}>

      {/* STATUS TOAST */}
      {showStatus && (
        <div className={`fixed top-8 right-8 z-[100] flex items-center gap-3 p-4 rounded-2xl border shadow-2xl animate-in fade-in slide-in-from-top-4 ${
          showStatus === 'success' ? 'bg-green-500/10 border-green-500/50 text-green-600 dark:text-green-400' : 'bg-red-500/10 border-red-500/50 text-red-600 dark:text-red-400'
        }`}>
          {showStatus === 'success' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
          <p className="text-[10px] font-black uppercase tracking-widest">
            {showStatus === 'success' ? 'System Synced' : (statusMsg || 'Upload Failed')}
          </p>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        {!hideHeader && <AdminPageHeader icon={ShieldAlert} title="Manage Teams" />}

        <div className="grid lg:grid-cols-3 gap-12 animate-in fade-in slide-in-from-bottom-2">
            <div className="lg:col-span-2 space-y-8">
              <form onSubmit={handleSaveTeam} className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-white/5 p-8 md:p-10 rounded-[2.5rem] shadow-xl dark:shadow-none space-y-8">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-white/5 pb-6">
                  <h2 className="text-xs font-black text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">
                    {editingId ? `Modifying: ${formData.name}` : "Add New Team"}
                  </h2>
                  {editingId && (
                    <button type="button" onClick={() => { setEditingId(null); setFormData({name:'', status:'Open Practice', description:'', practice:'', location:'', requirements:'', disciplines:'', leadership:[], photo:''}); }} className="text-[10px] font-black text-slate-400 uppercase hover:text-red-500 transition-colors">Reset</button>
                  )}
                </div>
                
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Unit Designation</label>
                    <input required readOnly={!isPowerUser} value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 p-4 rounded-xl text-sm text-slate-900 dark:text-white focus:ring-2 ring-yellow-500/20 outline-none transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Operational Status</label>
                    <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 p-4 rounded-xl text-sm text-slate-900 dark:text-white outline-none">
                      <option>Open Practice</option>
                      <option>Conditioning Only</option>
                      <option>Out of Season</option>
                      <option>Closed Roster</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Mission Directives</label>
                  <textarea required value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 p-4 rounded-xl text-sm h-32 text-slate-900 dark:text-white outline-none" />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 ml-1">Team Photo</label>
                  <div className="flex items-center gap-4">
                    {formData.photo ? (
                      <img src={formData.photo} alt="" className="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-white/10" />
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-white/10 flex items-center justify-center text-slate-300 dark:text-slate-700">
                        <ImageOff size={20} />
                      </div>
                    )}
                    <label className="flex-1 flex items-center justify-center gap-3 border-2 border-dashed border-slate-200 dark:border-white/10 rounded-xl p-4 cursor-pointer hover:border-yellow-500 transition-all text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                      {uploadingPhoto ? <Loader2 className="animate-spin" size={16} /> : <UploadCloud size={16} />}
                      {uploadingPhoto ? 'Uploading...' : formData.photo ? 'Replace Photo' : 'Upload Photo'}
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploadingPhoto} />
                    </label>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 pt-4 border-t border-slate-100 dark:border-white/5">
                  <div className="space-y-6">
                    <h3 className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-widest flex items-center gap-2"><Users size={14}/> Command Structure</h3>
                    {isPowerUser && (
                      <button type="button" onClick={addLeader} className="text-[9px] bg-yellow-500 text-slate-950 px-4 py-2 rounded-full font-black hover:bg-yellow-400 transition-all">
                        + APPOINT OFFICER
                      </button>
                    )}
                  </div>
                </div>

                {formData.leadership.map((leader, index) => (
                  <div key={index} className="bg-slate-50 dark:bg-slate-950/60 p-6 rounded-3xl border border-slate-200 dark:border-white/5 relative group transition-all">
                    {isPowerUser && (
                      <button type="button" title="Remove officer" onClick={() => setFormData({...formData, leadership: formData.leadership.filter((_, i) => i !== index)})} className="absolute top-4 right-4 text-slate-400 hover:text-red-500"><Trash2 size={16}/></button>
                    )}
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <select
                        value={leader.email || ''}
                        onChange={(e) => selectLeaderPerson(index, e.target.value)}
                        className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 p-3 rounded-xl text-xs"
                      >
                        <option value="" disabled>Select Cadet...</option>
                        {personnel.map(p => (
                          <option key={p.id} value={p.email}>{p.fullName}{p.rank ? ` (${p.rank})` : ''}</option>
                        ))}
                      </select>
                      <select value={leader.teamRole || 'Team Member'} onChange={(e) => updateLeader(index, 'teamRole', e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-white/5 p-3 rounded-xl text-xs text-yellow-600 font-bold uppercase outline-none">
                        <option value="Commander">Commander</option>
                        <option value="Co-Commander">Co-Commander</option>
                        <option value="Team Member">Team Member</option>
                      </select>
                      {leader.email && (
                        <div className="lg:col-span-3 flex items-center gap-4 text-[10px] text-slate-400 dark:text-slate-500 px-1">
                          {leader.rank && <span className="font-black text-yellow-600 dark:text-yellow-500 uppercase">{leader.rank}</span>}
                          <span className="flex items-center gap-1 truncate"><Mail size={10} /> {leader.email}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <button type="submit" disabled={!canEditMainFields} className={`w-full py-5 rounded-2xl font-black uppercase text-xs tracking-[0.25em] transition-all flex items-center justify-center gap-3 shadow-2xl ${
                  canEditMainFields ? 'bg-yellow-500 text-slate-950 hover:bg-yellow-400 hover:-translate-y-1 shadow-yellow-500/20' : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-50'
                }`}>
                  <Save size={18} /> Synchronize Operational Data
                </button>
              </form>
            </div>

            <div className="space-y-6">
              <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest italic flex items-center gap-4">
                <div className="h-px flex-1 bg-slate-200 dark:bg-white/5" /> Catalog
              </h3>
              <div className="grid gap-4">
                {accessibleTeams.map(team => (
                  <div key={team.id} onClick={() => handleEdit(team)} title="Click to edit this team" className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 p-6 rounded-3xl flex justify-between items-center group hover:border-yellow-500 transition-all cursor-pointer shadow-sm dark:shadow-none">
                    <div>
                      <h4 className="font-black uppercase italic text-xl group-hover:text-yellow-600 dark:group-hover:text-yellow-500 transition-colors leading-none mb-2">{team.name}</h4>
                      <span className="text-[9px] font-black px-2 py-1 rounded-md uppercase bg-slate-100 dark:bg-white/5 text-slate-400">{team.status}</span>
                    </div>
                    <div className="flex gap-2">
                      <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-white/5 flex items-center justify-center text-slate-400 group-hover:text-yellow-600 dark:group-hover:text-white transition-all"><Edit3 size={16}/></div>
                      {isPowerUser && (
                        <button title="Delete team" onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ open: true, id: team.id, name: team.name }); }} className="w-10 h-10 rounded-xl hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-all"><Trash2 size={16}/></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
      </div>

      {/* CONFIRMATION MODAL */}
      {deleteConfirm.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-10 rounded-[2.5rem] max-w-sm w-full text-center shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-600" />
            <ShieldAlert size={48} className="text-red-500 mx-auto mb-6" />
            <h3 className="text-2xl font-black uppercase italic mb-3 text-slate-900 dark:text-white">Decommission Unit?</h3>
            <p className="text-slate-500 text-xs mb-10 leading-relaxed">Permanent erasure of the <span className="text-red-600 font-bold">{deleteConfirm.name}</span> dossier. This action is irreversible.</p>
            <div className="flex flex-col gap-3">
              <button onClick={async () => {
                  try {
                    await deleteDoc(doc(db, 'specialTeams', deleteConfirm.id));
                    setDeleteConfirm({ open: false, id: null, name: '' });
                    triggerStatus('success');
                    writeLog({
                      type: 'team', action: 'delete',
                      description: `Deleted team: ${deleteConfirm.name}`,
                      userId: user?.uid || '', userFullName: userData?.fullName || '',
                      userRole: role || '', targetId: deleteConfirm.id, targetName: deleteConfirm.name,
                    });
                  } catch { triggerStatus('error'); }
                }} className="w-full bg-red-600 py-4 rounded-xl font-black text-white uppercase text-[10px] tracking-widest hover:bg-red-500 transition-all">Confirm Purge</button>
              <button onClick={() => setDeleteConfirm({ open: false, id: null, name: '' })} className="w-full py-4 rounded-xl font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all uppercase text-[10px] tracking-widest bg-slate-100 dark:bg-white/5">Abort Mission</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTeams;