import type { TomTomIncident } from '../../types';

interface IncidentDetailModalProps {
  incident: TomTomIncident | null;
  onClose: () => void;
}

export function IncidentDetailModal({ incident, onClose }: IncidentDetailModalProps) {
  if (!incident) return null;

  const severityBadgeClass = {
    blocking: 'bg-red-500/20 text-red-400 border-red-500/40',
    major: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
    moderate: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
    minor: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    unknown: 'bg-slate-700/50 text-slate-300 border-slate-600',
  }[incident.severity] || 'bg-slate-700/50 text-slate-300 border-slate-600';

  return (
    <div className="absolute top-20 left-4 z-40 max-w-sm w-[calc(100vw-32px)] bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-4 shadow-2xl text-slate-100 animate-fade-in pointer-events-auto">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">
              {incident.category === 'Accident' ? '💥' :
               incident.category === 'Road Closed' ? '⛔' :
               incident.category === 'Road Works' ? '🚧' :
               incident.category === 'Traffic Jam' ? '🚗' : '⚠️'}
            </span>
            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${severityBadgeClass}`}>
              {incident.severity} • {incident.category}
            </span>
          </div>
          <h3 className="font-bold text-base text-white leading-tight">
            {incident.description}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="space-y-2.5 text-xs">
        {/* Road names */}
        {(incident.from || incident.to) && (
          <div className="bg-slate-800/60 rounded-xl p-2.5 border border-slate-700/50">
            <div className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Affected Location</div>
            <div className="font-medium text-slate-200">
              {incident.from && <span>From: {incident.from}</span>}
              {incident.from && incident.to && <br />}
              {incident.to && <span>To: {incident.to}</span>}
            </div>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-800/40 rounded-xl p-2.5 border border-slate-700/40">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Delay Caused</div>
            <div className="text-base font-bold text-red-400 mt-0.5">
              {(incident.delayMinutes && incident.delayMinutes > 0) ? `+${incident.delayMinutes} min` : 'Slow traffic'}
            </div>
          </div>

          <div className="bg-slate-800/40 rounded-xl p-2.5 border border-slate-700/40">
            <div className="text-[10px] uppercase font-semibold text-slate-400">Affected Stretch</div>
            <div className="text-base font-bold text-slate-200 mt-0.5">
              {incident.lengthMeters >= 1000
                ? `${(incident.lengthMeters / 1000).toFixed(1)} km`
                : `${incident.lengthMeters} m`}
            </div>
          </div>
        </div>

        {/* Timing */}
        {incident.startTime && (
          <div className="flex justify-between items-center text-[11px] text-slate-400 pt-1">
            <span>Reported Active Since:</span>
            <span className="font-mono text-slate-300">
              {new Date(incident.startTime).toLocaleTimeString()}
            </span>
          </div>
        )}

        <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-[10px] text-slate-500">
          <span>Source: TomTom Real-Time Incident Feed</span>
          <button
            onClick={onClose}
            className="text-primary-400 hover:text-primary-300 font-semibold"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
