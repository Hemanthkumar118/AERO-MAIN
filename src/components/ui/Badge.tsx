import type { BadgeVariant, EmergencyStatus } from '../../types';
import { motion } from 'framer-motion';

/* ── Badge ── */
interface BadgeProps {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const badgeVariantClasses: Record<BadgeVariant, string> = {
  info: 'bg-aero-blue-soft text-aero-blue border-[#35C7FF]/20',
  success: 'bg-aero-green-soft text-aero-green border-[#20D67A]/20',
  warning: 'bg-aero-amber-soft text-aero-amber border-[#FFB020]/20',
  danger: 'bg-aero-red-soft text-aero-red border-[#FF3B30]/20',
  neutral: 'bg-aero-surface-soft text-aero-text-secondary border-aero-border',
  emergency: 'bg-aero-red text-aero-text-primary border-[#FF3B30]/50 shadow-[0_0_15px_rgba(255,59,48,0.3)]',
};

const dotColorClasses: Record<BadgeVariant, string> = {
  info: 'bg-aero-blue',
  success: 'bg-aero-green',
  warning: 'bg-aero-amber',
  danger: 'bg-aero-red',
  neutral: 'bg-text-secondary',
  emergency: 'bg-white animate-pulse',
};

export function Badge({
  variant = 'neutral',
  size = 'sm',
  children,
  className = '',
  dot = false,
}: BadgeProps) {
  return (
    <motion.span
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`
        inline-flex items-center gap-1.5 font-medium border rounded-full whitespace-nowrap
        ${size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'}
        ${badgeVariantClasses[variant]}
        ${className}
      `}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColorClasses[variant]}`} aria-hidden="true" />
      )}
      {children}
    </motion.span>
  );
}

/* ── StatusBadge (Emergency-specific) ── */
interface StatusBadgeProps {
  status: EmergencyStatus;
  className?: string;
}

const statusConfig: Record<EmergencyStatus, { variant: BadgeVariant; label: string }> = {
  PENDING: { variant: 'warning', label: 'PENDING' },
  ACCEPTED: { variant: 'info', label: 'ACCEPTED' },
  ACTIVE: { variant: 'emergency', label: 'ACTIVE' },
  ARRIVED: { variant: 'info', label: 'ARRIVED AT HOSPITAL' },
  COMPLETED: { variant: 'success', label: 'COMPLETED' },
  CANCELLED: { variant: 'neutral', label: 'CANCELLED' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || { variant: 'neutral', label: status };
  return (
    <Badge variant={config.variant} size="md" dot className={className}>
      {config.label}
    </Badge>
  );
}
