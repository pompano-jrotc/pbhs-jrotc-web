import React, { useState, useEffect, useRef } from 'react';
import {
  collection, addDoc, query, where, orderBy, onSnapshot,
  updateDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { getAuth } from 'firebase/auth';
import {
  ShoppingCart, Clock, CheckCircle, XCircle, Package,
  Plus, Loader2, X, ChevronDown, AlertTriangle, FileText,
  Send, Filter,
} from 'lucide-react';
import AdminPageHeader from '../components/AdminPageHeader';
import { useAuth } from '../hooks/useAuth';
import { writeLog } from '../lib/writeLog';
import { ROLE_HIERARCHY } from '../constants';

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMIN_LEVEL   = 80;
const COMMAND_LEVEL = 45;

const ROLE_LABELS = {
  senior_army_instructor: 'Senior Army Instructor',
  army_instructor:        'Army Instructor',
  battalion_commander:    'Battalion Commander',
  battalion_xo:           'Battalion XO',
  battalion_csm:          'Battalion CSM',
  sergeant_major:         'Sergeant Major',
  s1_staff: 'S1 Personnel', s2_staff: 'S2 Intelligence',
  s3_staff: 'S3 Operations', s4_staff: 'S4 Logistics',
  s5_staff: 'S5 Public Affairs', s6_staff: 'S6 Technology',
  s7_staff: 'S7 Training',
  company_commander:        'Company Commander',
  company_xo:               'Company XO',
  company_1sg:              'Company 1SG',
  company_master_sergeant:  'Company Master Sergeant',
  company_supply_sergeant:  'Supply Sergeant',
};

const SUPPLY_CATALOG = {
  'Paper & Printing': [
    { name: 'Printer Paper (Letter)',  unit: 'reams' },
    { name: 'Cardstock',              unit: 'reams' },
    { name: 'Photo Paper',            unit: 'sheets' },
    { name: 'NCR Paper',              unit: 'packs' },
  ],
  'Ink & Toner': [
    { name: 'Black Ink Cartridge',   unit: 'cartridges' },
    { name: 'Color Ink Cartridge',   unit: 'cartridges' },
    { name: 'Black Toner Cartridge', unit: 'cartridges' },
    { name: 'Color Toner Cartridge', unit: 'cartridges' },
  ],
  'Binding & Filing': [
    { name: 'Staplers',       unit: 'units' },
    { name: 'Staples',        unit: 'boxes' },
    { name: 'Manila Folders', unit: 'boxes' },
    { name: '3-Ring Binders', unit: 'units' },
    { name: 'Paper Clips',    unit: 'boxes' },
    { name: 'Binder Clips',   unit: 'boxes' },
    { name: 'Tape',           unit: 'rolls' },
    { name: 'Rubber Bands',   unit: 'boxes' },
  ],
  'Writing & Markers': [
    { name: 'Ballpoint Pens',     unit: 'boxes' },
    { name: 'Pencils',            unit: 'boxes' },
    { name: 'Dry-Erase Markers',  unit: 'packs' },
    { name: 'Permanent Markers',  unit: 'packs' },
    { name: 'Highlighters',       unit: 'packs' },
    { name: 'Colored Markers',    unit: 'packs' },
  ],
  // "Other" is handled specially in the form: the item and unit fields become free-text inputs.
  'Other': [],
};

// Sentinel string that flags the "Other" category was selected
const OTHER_CAT = 'Other';

const PRIORITIES = ['Low', 'Medium', 'Urgent'];
const ALL_STATUSES = ['Pending', 'Approved', 'Denied', 'Fulfilled'];

const STATUS_META = {
  Pending:   { bg: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300', Icon: Clock },
  Approved:  { bg: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',         Icon: CheckCircle },
  Denied:    { bg: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',             Icon: XCircle },
  Fulfilled: { bg: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',     Icon: Package },
};

const PRIORITY_COLORS = {
  Low:    'text-slate-500 dark:text-slate-400',
  Medium: 'text-yellow-600 dark:text-yellow-400 font-semibold',
  Urgent: 'text-red-600 dark:text-red-400 font-bold',
};

const INITIAL_FORM = {
  category:   '',
  item:       '',
  customItem: '',
  quantity:   1,
  unit:       '',
  reason:     '',
  priority:   'Low',
};

// ── Small reusable pieces ─────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.Pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${m.bg}`}>
      <m.Icon size={11} /> {status}
    </span>
  );
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Submit Form ───────────────────────────────────────────────────────────────

function SubmitForm({ userProfile }) {
  const [form, setForm]     = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]   = useState('');

  const isOtherCat    = form.category === OTHER_CAT;
  const categoryItems = (!isOtherCat && form.category) ? SUPPLY_CATALOG[form.category] || [] : [];
  const isOther       = isOtherCat || form.item === '__other__';

  function handleCategory(cat) {
    // For the "Other" category, item + unit are free-text; pre-set sentinel values.
    if (cat === OTHER_CAT) {
      setForm(f => ({ ...f, category: cat, item: '__other__', unit: '', customItem: '' }));
    } else {
      setForm(f => ({ ...f, category: cat, item: '', unit: '', customItem: '' }));
    }
  }

  function handleItem(itemName) {
    if (itemName === '__other__') {
      setForm(f => ({ ...f, item: '__other__', unit: '', customItem: '' }));
      return;
    }
    const found = categoryItems.find(i => i.name === itemName);
    setForm(f => ({ ...f, item: itemName, unit: found?.unit || '', customItem: '' }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const resolvedItem = isOther ? form.customItem.trim() : form.item;
    if (!form.category || !resolvedItem || !form.quantity || !form.reason.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await addDoc(collection(db, 'supplyRequests'), {
        requestedByUid:     userProfile.uid,
        requestedByName:    userProfile.fullName || 'Unknown',
        requestedByCompany: userProfile.company  || '',
        requestedAt:        serverTimestamp(),
        category:           form.category,
        item:               resolvedItem,
        customItem:         isOther ? resolvedItem : null,
        quantity:           Number(form.quantity),
        unit:               form.unit.trim() || 'units',
        reason:             form.reason.trim(),
        priority:           form.priority,
        status:             'Pending',
        adminNotes:         '',
        approvedByName:     null,
        approvedAt:         null,
        denialReason:       null,
        fulfilledByName:    null,
        fulfilledAt:        null,
      });

      // Fire-and-forget email notification
      const auth = getAuth();
      auth.currentUser?.getIdToken().then(idToken => {
        fetch('/api/notify-supply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            requesterName: userProfile.fullName || 'Unknown',
            company:       userProfile.company  || '',
            category:      form.category,
            item:          resolvedItem,
            quantity:      Number(form.quantity),
            unit:          form.unit.trim() || 'units',
            reason:        form.reason.trim(),
            priority:      form.priority,
          }),
        }).catch(() => {});
      });

      setForm(INITIAL_FORM);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
      writeLog({
        type: 'supply', action: 'create',
        description: `Supply request submitted: ${form.category} — ${resolvedItem} (qty ${form.quantity})`,
        userId: userProfile.uid || '', userFullName: userProfile.fullName || '',
        userRole: userData?.role || '', targetName: resolvedItem,
        notes: `priority:${form.priority}`,
      });
    } catch (err) {
      setError('Failed to submit request. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-5">
      {success && (
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl text-green-800 dark:text-green-300 text-sm font-medium">
          <CheckCircle size={16} className="shrink-0" />
          Request submitted! Instructors have been notified.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-red-800 dark:text-red-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {/* Category */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
          Category <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <select
            value={form.category}
            onChange={e => handleCategory(e.target.value)}
            required
            className="w-full appearance-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 pr-10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            <option value="">Select a category…</option>
            {Object.keys(SUPPLY_CATALOG).map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Item — dropdown for catalog categories; free-text for "Other" category */}
      {!isOtherCat && (
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Item <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <select
              value={form.item}
              onChange={e => handleItem(e.target.value)}
              disabled={!form.category}
              required
              className="w-full appearance-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 pr-10 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:opacity-50"
            >
              <option value="">{form.category ? 'Select an item…' : 'Choose a category first'}</option>
              {categoryItems.map(i => (
                <option key={i.name} value={i.name}>{i.name}</option>
              ))}
              {form.category && <option value="__other__">Other (specify below)</option>}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Specify item — shown for "Other" catalog items OR the "Other" category */}
      {isOther && (
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            {isOtherCat ? 'Item Description' : 'Specify Item'} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.customItem}
            onChange={e => setForm(f => ({ ...f, customItem: e.target.value }))}
            placeholder={isOtherCat ? 'e.g. Extension cord, whiteboard eraser…' : 'e.g. Correction Fluid, Scissors…'}
            required
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
        </div>
      )}

      {/* Quantity + Unit */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Quantity <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="1"
            value={form.quantity}
            onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
            required
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Unit
          </label>
          <input
            type="text"
            value={form.unit}
            onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
            placeholder="reams, boxes, units…"
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
        </div>
      </div>

      {/* Priority */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
          Priority
        </label>
        <div className="flex gap-3">
          {PRIORITIES.map(p => (
            <label
              key={p}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border cursor-pointer text-sm font-semibold transition-all ${
                form.priority === p
                  ? p === 'Urgent'
                    ? 'bg-red-50 dark:bg-red-900/30 border-red-400 text-red-700 dark:text-red-300'
                    : p === 'Medium'
                    ? 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-400 text-yellow-700 dark:text-yellow-300'
                    : 'bg-slate-100 dark:bg-slate-700 border-slate-400 text-slate-700 dark:text-slate-200'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
              }`}
            >
              <input
                type="radio"
                name="priority"
                value={p}
                checked={form.priority === p}
                onChange={() => setForm(f => ({ ...f, priority: p }))}
                className="sr-only"
              />
              {p === 'Urgent' && <AlertTriangle size={13} />}
              {p}
            </label>
          ))}
        </div>
      </div>

      {/* Reason */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
          Reason / Justification <span className="text-red-500">*</span>
        </label>
        <textarea
          value={form.reason}
          onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
          placeholder="Briefly explain why these supplies are needed…"
          required
          rows={3}
          className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="flex items-center gap-2 px-6 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold rounded-xl text-sm disabled:opacity-60 transition-colors"
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        {saving ? 'Submitting…' : 'Submit Request'}
      </button>
    </form>
  );
}

// ── Action Modal (approve / deny) ─────────────────────────────────────────────

function ActionModal({ request, onClose, adminName }) {
  const [action, setAction]     = useState(''); // 'approve' | 'deny' | 'fulfill'
  const [notes, setNotes]       = useState('');
  const [denial, setDenial]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const { user, userData, role } = useAuth();

  async function handleConfirm() {
    if (action === 'deny' && !denial.trim()) {
      setError('Please provide a denial reason.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const ref = doc(db, 'supplyRequests', request.id);
      if (action === 'approve') {
        await updateDoc(ref, {
          status:         'Approved',
          adminNotes:     notes.trim(),
          approvedByName: adminName,
          approvedAt:     serverTimestamp(),
        });
      } else if (action === 'deny') {
        await updateDoc(ref, {
          status:        'Denied',
          adminNotes:    notes.trim(),
          denialReason:  denial.trim(),
        });
      } else if (action === 'fulfill') {
        await updateDoc(ref, {
          status:          'Fulfilled',
          adminNotes:      notes.trim(),
          fulfilledByName: adminName,
          fulfilledAt:     serverTimestamp(),
        });
      }
      writeLog({
        type: 'supply', action,
        description: `Supply request ${action}d: ${request.category} — ${request.item} for ${request.requestedByName}`,
        userId: user?.uid || '', userFullName: userData?.fullName || adminName,
        userRole: role || '', targetId: request.id, targetName: request.item,
      });
      onClose();
    } catch (err) {
      setError('Failed to update. Please try again.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Supply Request</p>
            <h3 className="font-black text-slate-900 dark:text-white text-lg">{request.item}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {request.quantity} {request.unit} · {request.requestedByName}
              {request.requestedByCompany ? ` · ${request.requestedByCompany} Co.` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Reason */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-sm text-slate-600 dark:text-slate-300 italic">
            "{request.reason}"
          </div>

          {/* Action selector */}
          {!action && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Select Action</p>
              <div className="grid grid-cols-3 gap-2">
                {request.status === 'Pending' && (
                  <>
                    <button onClick={() => setAction('approve')} className="flex flex-col items-center gap-1.5 p-3 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 border border-blue-200 dark:border-blue-700 rounded-xl text-blue-700 dark:text-blue-300 text-xs font-bold transition-colors">
                      <CheckCircle size={18} /> Approve
                    </button>
                    <button onClick={() => setAction('deny')} className="flex flex-col items-center gap-1.5 p-3 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 border border-red-200 dark:border-red-700 rounded-xl text-red-700 dark:text-red-300 text-xs font-bold transition-colors">
                      <XCircle size={18} /> Deny
                    </button>
                  </>
                )}
                {request.status === 'Approved' && (
                  <button onClick={() => setAction('fulfill')} className="flex flex-col items-center gap-1.5 p-3 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 border border-green-200 dark:border-green-700 rounded-xl text-green-700 dark:text-green-300 text-xs font-bold transition-colors">
                    <Package size={18} /> Mark Fulfilled
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Denial reason */}
          {action === 'deny' && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Denial Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={denial}
                onChange={e => setDenial(e.target.value)}
                placeholder="Explain why this request is being denied…"
                rows={2}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
            </div>
          )}

          {/* Admin notes */}
          {action && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                Admin Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any additional notes…"
                rows={2}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {error}
            </p>
          )}
        </div>

        {/* Footer */}
        {action && (
          <div className="flex justify-end gap-3 p-6 border-t border-slate-100 dark:border-slate-800">
            <button onClick={() => { setAction(''); setNotes(''); setDenial(''); setError(''); }}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl transition-colors">
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={saving}
              className={`flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-xl transition-colors disabled:opacity-60 ${
                action === 'deny'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : action === 'fulfill'
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {action === 'approve' ? 'Confirm Approval' : action === 'deny' ? 'Confirm Denial' : 'Mark as Fulfilled'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Request Row ───────────────────────────────────────────────────────────────

function RequestRow({ req, isAdmin, onAction, currentUid }) {
  const isOwn = req.requestedByUid === currentUid;
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
        {formatDate(req.requestedAt)}
      </td>
      {isAdmin && (
        <td className="px-4 py-3">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{req.requestedByName}</div>
          {req.requestedByCompany && (
            <div className="text-xs text-slate-400">{req.requestedByCompany} Co.</div>
          )}
        </td>
      )}
      <td className="px-4 py-3">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{req.item}</div>
        <div className="text-xs text-slate-400">{req.category}</div>
      </td>
      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">
        {req.quantity} {req.unit}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`text-xs font-semibold uppercase tracking-wide ${PRIORITY_COLORS[req.priority]}`}>
          {req.priority === 'Urgent' && <AlertTriangle size={10} className="inline mr-0.5 mb-px" />}
          {req.priority}
        </span>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={req.status} />
        {req.status === 'Denied' && req.denialReason && (
          <div className="text-xs text-slate-400 mt-0.5 italic">"{req.denialReason}"</div>
        )}
        {req.adminNotes && (
          <div className="text-xs text-slate-400 mt-0.5">Note: {req.adminNotes}</div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {isAdmin && (req.status === 'Pending' || req.status === 'Approved') && (
          <button
            onClick={() => onAction(req)}
            className="px-3 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-xs font-semibold rounded-lg transition-colors"
          >
            Review
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSupplyRequests({ hideHeader = false }) {
  const { userData, role } = useAuth();
  const level = ROLE_HIERARCHY[role] ?? 0;
  // Build a user object matching the shape SubmitForm + listeners expect
  const user = userData;

  const isAdmin   = level >= ADMIN_LEVEL;
  const canSubmit = level >= 12; // squad_leader_assistant and above can submit requests

  const [tab, setTab]           = useState('queue');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [actionTarget, setActionTarget] = useState(null);

  // Auto-switch to submit tab if not admin (they only see their requests + submit)
  useEffect(() => {
    if (!isAdmin && tab === 'queue') setTab('mine');
  }, [isAdmin, tab]);

  // Firestore listener
  useEffect(() => {
    if (!canSubmit) { setLoading(false); return; }

    let q;
    if (isAdmin) {
      q = query(collection(db, 'supplyRequests'), orderBy('requestedAt', 'desc'));
    } else {
      q = query(
        collection(db, 'supplyRequests'),
        where('requestedByUid', '==', user?.uid || ''),
        orderBy('requestedAt', 'desc')
      );
    }

    const unsub = onSnapshot(q, snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, err => {
      console.error('supplyRequests listener error:', err);
      setLoading(false);
    });
    return unsub;
  }, [isAdmin, canSubmit, user?.uid]);

  if (!canSubmit) {
    return (
      <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
        {!hideHeader && <AdminPageHeader icon={ShoppingCart} title="Supply Requests" meta="Materials & Office Supplies" />}
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShoppingCart size={40} className="text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
            Company Leadership access required to submit or view supply requests.
          </p>
        </div>
      </div>
    );
  }

  const filteredRequests = isAdmin && tab === 'queue'
    ? requests.filter(r => statusFilter === 'All' || r.status === statusFilter)
    : requests.filter(r => r.requestedByUid === user?.uid);

  const pendingCount = requests.filter(r => r.status === 'Pending').length;

  return (
    <div className={hideHeader ? 'w-full' : 'flex-1 p-6 md:p-10 w-full'}>
      {!hideHeader && (
        <AdminPageHeader
          icon={ShoppingCart}
          title="Supply Requests"
          meta={`Materials & Office Supplies · ${ROLE_LABELS[role] || role}`}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-8 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
        {isAdmin && (
          <button
            onClick={() => setTab('queue')}
            className={`relative flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              tab === 'queue'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Filter size={13} /> All Requests
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full px-1 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => setTab('mine')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            tab === 'mine'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <FileText size={13} /> My Requests
        </button>
        <button
          onClick={() => setTab('submit')}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            tab === 'submit'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Plus size={13} /> New Request
        </button>
      </div>

      {/* Submit tab */}
      {tab === 'submit' && (
        <SubmitForm userProfile={user} />
      )}

      {/* Queue / Mine tabs */}
      {(tab === 'queue' || tab === 'mine') && (
        <div>
          {/* Status filter (admin queue only) */}
          {tab === 'queue' && isAdmin && (
            <div className="flex flex-wrap gap-2 mb-5">
              {['Pending', ...ALL_STATUSES.filter(s => s !== 'Pending'), 'All'].map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 text-xs font-semibold rounded-full border transition-colors ${
                    statusFilter === s
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                      : 'bg-transparent border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {s}
                  {s === 'Pending' && pendingCount > 0 && (
                    <span className="ml-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 py-px">
                      {pendingCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-3 py-12 text-slate-400">
              <Loader2 size={18} className="animate-spin" /> Loading requests…
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <ShoppingCart size={36} className="text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
                {tab === 'mine' ? 'No requests submitted yet.' : `No ${statusFilter === 'All' ? '' : statusFilter.toLowerCase()+' '}requests.`}
              </p>
              {tab === 'mine' && (
                <button
                  onClick={() => setTab('submit')}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-slate-900 text-xs font-bold rounded-xl transition-colors"
                >
                  <Plus size={13} /> Submit a Request
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left min-w-[640px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60">
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Date</th>
                    {isAdmin && tab === 'queue' && (
                      <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Requester</th>
                    )}
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Item</th>
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Qty</th>
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Priority</th>
                    <th className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map(req => (
                    <RequestRow
                      key={req.id}
                      req={req}
                      isAdmin={isAdmin && tab === 'queue'}
                      onAction={setActionTarget}
                      currentUid={user?.uid}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Action modal */}
      {actionTarget && (
        <ActionModal
          request={actionTarget}
          adminName={user?.fullName || 'Admin'}
          onClose={() => setActionTarget(null)}
        />
      )}
    </div>
  );
}
