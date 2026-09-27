interface ETADisplayProps {
  etaSeconds?: number;
  trafficAwareEtaSeconds?: number;
  trafficStatus?: 'LIVE' | 'MODERATE' | 'HEAVY' | 'SEVERE' | 'UNAVAILABLE';
  distanceMeters?: number;
  speed?: number;
  className?: string;
  compact?: boolean;
}

function formatETA(seconds?: number): string {
  if (seconds == null) return 'UNAVAILABLE';
  if (seconds < 60) return `<1 min`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function formatDistance(meters?: number): string {
  if (meters == null) return 'UNAVAILABLE';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function ETADisplay({
  etaSeconds,
  trafficAwareEtaSeconds,
  trafficStatus,
  distanceMeters,
  speed,
  className = '',
  compact = false,
}: ETADisplayProps) {
  const activeEta = trafficAwareEtaSeconds ?? etaSeconds;
  
  if (compact) {
    return (
      <div className={`inline-flex items-center gap-3 text-[13px] ${className}`}>
        <span className="text-text-secondary">
          <span className="font-semibold text-text-primary">{formatETA(activeEta)}</span>
          {' '}ETA
        </span>
        {trafficStatus === 'LIVE' && (
           <span className="text-[9px] bg-[#34C759]/20 text-[#34C759] px-1 py-0.5 rounded border border-[#34C759]/30 font-bold ml-1">LIVE TRAFFIC</span>
        )}
        <span className="text-border-strong">|</span>
        <span className="text-text-secondary">
          <span className="font-semibold text-text-primary">{formatDistance(distanceMeters)}</span>
        </span>
        {speed != null && (
          <>
            <span className="text-border-strong">|</span>
            <span className="text-text-secondary">
              <span className="font-semibold text-text-primary">{Math.round(speed)}</span> km/h
            </span>
          </>
        )}
      </div>
    );
  }

  return (
      <div className={`flex gap-4 ${className}`} role="status" aria-label={`ETA: ${formatETA(activeEta)}, Distance: ${formatDistance(distanceMeters)}`}>
      {/* ETA */}
      <div className="flex flex-col items-center relative">
        <span className="text-2xl font-bold text-text-primary tabular-nums">
          {formatETA(activeEta)}
        </span>
        <span className="text-[11px] font-medium tracking-[0.05em] uppercase text-text-secondary flex items-center gap-1">
          ETA
          {trafficStatus === 'LIVE' && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#34C759] animate-pulse" title="Live Traffic" />
          )}
        </span>
      </div>

      <div className="w-px bg-border-subtle" />

      {/* Distance */}
      <div className="flex flex-col items-center">
        <span className="text-2xl font-bold text-text-primary tabular-nums">
          {formatDistance(distanceMeters)}
        </span>
        <span className="text-[11px] font-medium tracking-[0.05em] uppercase text-text-secondary">
          Distance
        </span>
      </div>

      {speed != null && (
        <>
          <div className="w-px bg-border-subtle" />
          <div className="flex flex-col items-center">
            <span className="text-2xl font-bold text-text-primary tabular-nums">
              {Math.round(speed)}
            </span>
            <span className="text-[11px] font-medium tracking-[0.05em] uppercase text-text-secondary">
              km/h
            </span>
          </div>
        </>
      )}
    </div>
  );
}
