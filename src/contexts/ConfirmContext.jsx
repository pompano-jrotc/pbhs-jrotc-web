// src/contexts/ConfirmContext.jsx
//
// Global confirm dialog that replaces window.confirm() everywhere in the portal.
// Usage:
//   const confirm = useConfirm();
//   const ok = await confirm('Delete this?', { title: 'Delete Event', destructive: true });
//   if (!ok) return;

import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import { AlertTriangle, Trash2, X, Check } from 'lucide-react';

const ConfirmContext = createContext(null);

// ── ConfirmDialog ─────────────────────────────────────────────────────────────
const ConfirmDialog = ({ title, message, destructive, onConfirm, onCancel }) => {
  const Icon = destructive ? Trash2 : AlertTriangle;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Card */}
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl shadow-black/30 p-6 flex flex-col gap-4 animate-[confirmPop_0.15s_ease-out]">

        {/* Icon + header */}
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            destructive
              ? 'bg-red-500/10 text-red-500'
              : 'bg-yellow-500/10 text-yellow-500'
          }`}>
            <Icon size={18} />
          </div>
          <div>
            <p
              id="confirm-title"
              className="text-sm font-black text-slate-900 dark:text-white leading-tight"
            >
              {title || (destructive ? 'Confirm Delete' : 'Confirm')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 font-black text-xs uppercase rounded-xl hover:opacity-70 transition-opacity"
            autoFocus
          >
            <X size={12} /> Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex items-center gap-1.5 px-4 py-2 font-black text-xs uppercase rounded-xl transition-opacity hover:opacity-90 ${
              destructive
                ? 'bg-red-500 text-white'
                : 'bg-yellow-500 text-slate-950'
            }`}
          >
            {destructive ? <Trash2 size={12} /> : <Check size={12} />}
            {destructive ? 'Delete' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Provider ──────────────────────────────────────────────────────────────────
export const ConfirmProvider = ({ children }) => {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((message, opts = {}) => {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setDialog({ message, title: opts.title, destructive: opts.destructive ?? true });
    });
  }, []);

  const handleConfirm = () => {
    resolveRef.current?.(true);
    setDialog(null);
  };
  const handleCancel = () => {
    resolveRef.current?.(false);
    setDialog(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          destructive={dialog.destructive}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => useContext(ConfirmContext);
