import React from 'react';
import { ClipboardList, Plus, X, Trash2 } from 'lucide-react';

const genId    = () => `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const genOptId = () => `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const TYPES = [
  { value: 'short',     label: 'Short answer' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'radio',     label: 'Multiple choice' },
  { value: 'checkbox',  label: 'Checkboxes' },
];

const FormCompose = ({ value, onChange }) => {
  const has = !!value;

  const add = () => onChange({
    questions: [{ id: genId(), text: '', type: 'short', required: false, options: [] }],
    anonymous: false,
  });
  const remove  = () => onChange(null);
  const update  = (patch) => onChange({ ...value, ...patch });
  const updateQ = (qId, patch) =>
    update({ questions: value.questions.map(q => q.id === qId ? { ...q, ...patch } : q) });
  const removeQ = (qId) =>
    update({ questions: value.questions.filter(q => q.id !== qId) });
  const addQ    = () => {
    if (value.questions.length >= 10) return;
    update({ questions: [...value.questions, { id: genId(), text: '', type: 'short', required: false, options: [] }] });
  };

  const setType = (qId, type) => {
    const q = value.questions.find(q => q.id === qId);
    const needsOpts = type === 'radio' || type === 'checkbox';
    const hadOpts   = q.type === 'radio' || q.type === 'checkbox';
    updateQ(qId, {
      type,
      options: needsOpts && !hadOpts
        ? [{ id: genOptId(), text: '' }, { id: genOptId(), text: '' }]
        : needsOpts ? q.options
        : [],
    });
  };

  const addOpt   = (qId) => {
    const q = value.questions.find(q => q.id === qId);
    if (!q || (q.options || []).length >= 6) return;
    updateQ(qId, { options: [...(q.options || []), { id: genOptId(), text: '' }] });
  };
  const removeOpt = (qId, optId) => {
    const q = value.questions.find(q => q.id === qId);
    if (!q || (q.options || []).length <= 2) return;
    updateQ(qId, { options: q.options.filter(o => o.id !== optId) });
  };
  const setOptText = (qId, optId, text) => {
    const q = value.questions.find(q => q.id === qId);
    updateQ(qId, { options: q.options.map(o => o.id === optId ? { ...o, text } : o) });
  };

  if (!has) {
    return (
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors"
      >
        <ClipboardList size={12} /> Add Form
      </button>
    );
  }

  return (
    <div className="space-y-4 border border-yellow-500/30 rounded-2xl p-4 bg-yellow-500/5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500 flex items-center gap-1.5">
          <ClipboardList size={12} /> Form
        </p>
        <button type="button" onClick={remove} className="text-slate-400 hover:text-red-500 transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">
        {value.questions.map((q, qi) => (
          <div key={q.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-[9px] font-black text-slate-400 mt-2.5 w-4 shrink-0 text-center">{qi + 1}.</span>
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={q.text}
                  onChange={e => updateQ(q.id, { text: e.target.value })}
                  placeholder="Question…"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm outline-none focus:border-yellow-500 transition-all"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={q.type}
                    onChange={e => setType(q.id, e.target.value)}
                    className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-xs outline-none focus:border-yellow-500"
                  >
                    {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={e => updateQ(q.id, { required: e.target.checked })}
                      className="accent-yellow-500"
                    />
                    Required
                  </label>
                </div>

                {(q.type === 'radio' || q.type === 'checkbox') && (
                  <div className="space-y-1.5 ml-1">
                    {(q.options || []).map((opt, oi) => (
                      <div key={opt.id} className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400 w-3">{String.fromCharCode(65 + oi)}</span>
                        <input
                          type="text"
                          value={opt.text}
                          onChange={e => setOptText(q.id, opt.id, e.target.value)}
                          placeholder={`Option ${String.fromCharCode(65 + oi)}…`}
                          className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-slate-900 dark:text-white text-xs outline-none focus:border-yellow-500 transition-all"
                        />
                        {(q.options || []).length > 2 && (
                          <button type="button" onClick={() => removeOpt(q.id, opt.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                    {(q.options || []).length < 6 && (
                      <button type="button" onClick={() => addOpt(q.id)} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors ml-4">
                        <Plus size={9} /> Add option
                      </button>
                    )}
                  </div>
                )}
              </div>
              {value.questions.length > 1 && (
                <button type="button" onClick={() => removeQ(q.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors mt-1 shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        {value.questions.length < 10 ? (
          <button type="button" onClick={addQ} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors">
            <Plus size={10} /> Add question
          </button>
        ) : <span />}
        <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={value.anonymous}
            onChange={e => update({ anonymous: e.target.checked })}
            className="accent-yellow-500"
          />
          Anonymous responses
        </label>
      </div>
    </div>
  );
};

export default FormCompose;
