
interface TrafficLegendProps {
  onClose: () => void;
  showIncidents?: boolean;
}

export function TrafficLegend({ onClose, showIncidents = true }: TrafficLegendProps) {
  return (
    <div className="absolute bottom-16 left-16 z-30 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-xl p-3.5 shadow-2xl text-xs max-w-xs animate-fade-in text-slate-200">
      <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-slate-800">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-white uppercase tracking-wider text-[11px]">
            TomTom Live Traffic
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-0.5 rounded transition-colors"
          title="Close Legend"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        {/* Speed / Congestion Flow */}
        <div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Traffic Flow Speed
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-2 rounded bg-[#20D67A] shrink-0" />
              <span className="text-slate-300">Free Flow (Normal Speeds)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-2 rounded bg-[#EAB308] shrink-0" />
              <span className="text-slate-300">Moderate Delay (Slow)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-2 rounded bg-[#F97316] shrink-0" />
              <span className="text-slate-300">Heavy Traffic Delay</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-2 rounded bg-[#EF4444] shrink-0" />
              <span className="text-slate-300">Severe Congestion / Gridlock</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-2 rounded bg-[#991B1B] shrink-0" />
              <span className="text-slate-300">Road Blockage / Closure</span>
            </div>
          </div>
        </div>

        {/* Incidents */}
        {showIncidents && (
          <div className="border-t border-slate-800/80 pt-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Reported Incidents
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-xs">💥</span>
                <span className="text-slate-300">Accident</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs">🚗</span>
                <span className="text-slate-300">Traffic Jam</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs">🚧</span>
                <span className="text-slate-300">Road Works</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs">⛔</span>
                <span className="text-slate-300">Road Closed</span>
              </div>
            </div>
          </div>
        )}

        {/* Attribution & live indicator */}
        <div className="border-t border-slate-800/80 pt-1.5 flex items-center justify-between text-[10px] text-slate-400">
          <span>Data: TomTom Real-Time API</span>
          <span className="text-emerald-400 font-mono font-bold">● LIVE</span>
        </div>
      </div>
    </div>
  );
}
