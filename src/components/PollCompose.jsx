import React from 'react';
import { BarChart2, Plus, X } from 'lucide-react';

const genId = () => `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const PollCompose = ({ value, onChange }) => {
  const hasPoll = !!value;

  const addPoll = () => onChange({
    question: '',
    options: [{ id: genId(), text: '' }, { id: genId(), text: '' }],
    type: 'single',
    resultsVisibility: 'after_vote',
    anonymous: true,
  });

  const remove = () => onChange(null);
  const update = (patch) => onChange({ ...value, ...patch });

  const setOption = (id, text) =>
    update({ options: value.options.map(o => o.id === id ? { ...o, text } : o) });

  const addOption = () => {
    if (value.options.length >= 6) return;
    update({ options: [...value.options, { id: genId(), text: '' }] });
  };

  const removeOption = (id) => {
    if (value.options.length <= 2) return;
    update({ options: value.options.filter(o => o.id !== id) });
  };

  if (!hasPoll) {
    return (
      <button
        type="button"
        onClick={addPoll}
        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors"
      >
        <BarChart2 size={12} /> Add Poll
      </button>
    );
  }

  return (
    <div className="space-y-3 border border-yellow-500/30 rounded-2xl p-4 bg-yellow-500/5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500 flex items-center gap-1.5">
          <BarChart2 size={12} /> Poll
        </p>
        <button type="button" onClick={remove} className="text-slate-400 hover:text-red-500 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Question */}
      <input
        type="text"
        value={value.question}
        onChange={e => update({ question: e.target.value })}
        placeholder="Poll question…"
        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-slate-900 dark:text-white outline-none focus:border-yellow-500 transition-all text-sm"
      />

      {/* Options */}
      <div className="space-y-2">
        {value.options.map((opt, i) => (
          <div key={opt.id} className="flex items-center gap-2">
            <span className="text-[9px] font-black text-slate-400 w-4 shrink-0 text-center">
              {String.fromCharCode(65 + i)}
            </span>
            <input
              type="text"
              value={opt.text}
              onChange={e => setOption(opt.id, e.target.value)}
              placeholder={`Option ${String.fromCharCode(65 + i)}…`}
              className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-sm outline-none focus:border-yellow-500 transition-all"
            />
            {value.options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(opt.id)}
                className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors shrink-0"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {value.options.length < 6 && (
          <button
            type="button"
            onClick={addOption}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-yellow-500 transition-colors ml-6"
          >
            <Plus size={10} /> Add option
          </button>
        )}
      </div>

      {/* Settings row */}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <div className="space-y-1">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Response type
          </label>
          <select
            value={value.type}
            onChange={e => update({ type: e.target.value })}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-2 py-2 text-slate-900 dark:text-white text-xs outline-none focus:border-yellow-500"
          >
            <option value="single">Single choice</option>
            <option value="multi">Multi-select</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Results shown
          </label>
          <select
            value={value.resultsVisibility}
            onChange={e => update({ resultsVisibility: e.target.value })}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-2 py-2 text-slate-900 dark:text-white text-xs outline-none focus:border-yellow-500"
          >
            <option value="always">Always</option>
            <option value="after_vote">After voting</option>
            <option value="never">Never</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Responses
          </label>
          <select
            value={value.anonymous ? 'anon' : 'attributed'}
            onChange={e => update({ anonymous: e.target.value === 'anon' })}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-2 py-2 text-slate-900 dark:text-white text-xs outline-none focus:border-yellow-500"
          >
            <option value="anon">Anonymous</option>
            <option value="attributed">Attributed</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default PollCompose;
