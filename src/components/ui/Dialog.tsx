import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  variant?: 'default' | 'danger' | 'emergency';
  loading?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  variant = 'default',
  loading = false,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setTimeout(() => dialogRef.current?.focus(), 0);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, loading]);

  if (!open) return null;

  const isEmergency = variant === 'emergency';
  const isDanger = variant === 'danger';
  const confirmVariant = isEmergency ? 'emergency' : isDanger ? 'danger' : 'primary';

  const dialogContent = (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Dimmed, Dark Command-Center Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/85 backdrop-blur-md transition-opacity duration-200"
        onClick={loading ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Solid Command-Center Dialog Card */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? 'dialog-description' : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`
          relative z-[9999] w-full max-w-lg rounded-2xl p-6 sm:p-7
          bg-[#0F172A] text-slate-100 shadow-2xl transition-all duration-200
          border-2 focus:outline-none my-auto
          ${isEmergency 
            ? 'border-red-500/80 shadow-[0_0_60px_rgba(239,68,68,0.30)]' 
            : isDanger
              ? 'border-red-500/60 shadow-[0_0_40px_rgba(239,68,68,0.20)]'
              : 'border-slate-700/80 shadow-2xl'
          }
        `}
      >
        {/* Header Badge */}
        {isEmergency && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest bg-red-500/20 text-red-400 border border-red-500/40 mb-3 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            CRITICAL SOS DISPATCH
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="dialog-title"
              className={`text-xl sm:text-2xl font-black tracking-tight ${
                isEmergency ? 'text-red-400' : 'text-slate-100'
              }`}
            >
              {title}
            </h2>
            {description && (
              <p id="dialog-description" className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                {description}
              </p>
            )}
          </div>

          {!loading && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              aria-label="Close dialog"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Modal Body */}
        {children && <div className="mt-5">{children}</div>}

        {/* Actions Footer */}
        <div className="mt-7 pt-4 border-t border-slate-800 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <Button
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={loading}
            className="w-full sm:w-auto bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700 font-semibold"
          >
            {cancelLabel}
          </Button>

          {onConfirm && (
            <Button
              variant={confirmVariant}
              size="md"
              onClick={onConfirm}
              loading={loading}
              className={`w-full sm:w-auto font-bold tracking-wider ${
                isEmergency
                  ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50'
                  : ''
              }`}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(dialogContent, document.body) : null;
}
