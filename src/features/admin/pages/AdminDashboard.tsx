import { useState, useEffect } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import { PageHeader } from '../../../components/layout/PageHeader';
import { StatusBadge } from '../../../components/ui/Badge';
import { Tabs } from '../../../components/ui/Tabs';
import { Dialog } from '../../../components/ui/Dialog';
import { analyticsService, type AdminOverviewStats } from '../../../services/analyticsService';
import { realtimeService } from '../../../services/realtimeService';
import type { Emergency } from '../../../types';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  AlertTriangle, 
  Clock, 
  RefreshCw, 
  Search, 
  Shield, 
  CheckCircle2, 
  FileSpreadsheet,
  FileJson,
  Activity,
  Ambulance as AmbulanceIcon
} from 'lucide-react';

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminOverviewStats>({
    activeEmergencies: 0,
    completedIncidents: 0,
    cancelledIncidents: 0,
    totalIncidents: 0,
    onlineAmbulances: 0,
    availablePolice: 0,
    partnerHospitals: 0,
    avgResponseTimeMins: null,
    corridorClearanceRatePercent: null,
    hasResponseTimeData: false,
    hasCorridorData: false,
    timestamp: new Date().toISOString(),
  });

  const [loading, setLoading] = useState(true);
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [selectedEmergency, setSelectedEmergency] = useState<Emergency | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [overviewData, historyData] = await Promise.all([
        analyticsService.getDashboardOverview(),
        analyticsService.getEmergencyHistory(),
      ]);
      setStats(overviewData);
      setEmergencies(historyData);
    } catch (err) {
      console.warn('[AdminDashboard] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const unsubEmergency = realtimeService.on('incidents_updated', () => {
      loadData();
    });

    return () => {
      unsubEmergency();
    };
  }, []);

  const handleExport = (format: 'csv' | 'json') => {
    analyticsService.exportData(format);
  };

  const statCards = [
    { 
      label: 'Active Emergencies', 
      value: stats.activeEmergencies.toString(), 
      subtext: 'Current live operations',
      icon: <AlertTriangle className="w-5 h-5 text-red-400" />,
      accent: 'border-red-500/30 text-red-400 bg-red-500/10'
    },
    { 
      label: 'Registered Ambulances', 
      value: `${stats.onlineAmbulances} Units`, 
      subtext: 'Authorized fleet profiles',
      icon: <AmbulanceIcon className="w-5 h-5 text-cyan-400" />,
      accent: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10'
    },
    { 
      label: 'Police Force Posts', 
      value: `${stats.availablePolice} Officers`, 
      subtext: 'Registered traffic personnel',
      icon: <Shield className="w-5 h-5 text-purple-400" />,
      accent: 'border-purple-500/30 text-purple-400 bg-purple-500/10'
    },
    { 
      label: 'Average Response Time', 
      value: stats.hasResponseTimeData && stats.avgResponseTimeMins !== null ? `${stats.avgResponseTimeMins}m` : 'Not recorded', 
      subtext: stats.hasResponseTimeData ? 'From verified arrival timestamps' : 'Awaiting completed incidents',
      icon: <Clock className="w-5 h-5 text-emerald-400" />,
      accent: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
    },
    { 
      label: 'Corridor Clearance Rate', 
      value: stats.hasCorridorData && stats.corridorClearanceRatePercent !== null ? `${stats.corridorClearanceRatePercent}%` : 'Not recorded', 
      subtext: stats.hasCorridorData ? 'Verified police clearances' : 'Awaiting corridor events',
      icon: <CheckCircle2 className="w-5 h-5 text-blue-400" />,
      accent: 'border-blue-500/30 text-blue-400 bg-blue-500/10'
    },
    { 
      label: 'Partner Hospitals', 
      value: `${stats.partnerHospitals} Facilities`, 
      subtext: 'Database-registered hospitals',
      icon: <Activity className="w-5 h-5 text-amber-400" />,
      accent: 'border-amber-500/30 text-amber-400 bg-amber-500/10'
    },
  ];

  const activeList = emergencies.filter(emg => {
    const isActive = emg.status === 'ACTIVE';
    const matchesSearch = emg.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emg.ambulanceDisplayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emg.hospital?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'ALL' || emg.patient?.category === filterCategory;
    return isActive && matchesSearch && matchesCategory;
  });

  const historyList = emergencies.filter(emg => {
    const isHistory = emg.status !== 'ACTIVE';
    const matchesSearch = emg.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emg.ambulanceDisplayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emg.hospital?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'ALL' || emg.patient?.category === filterCategory;
    return isHistory && matchesSearch && matchesCategory;
  });

  const renderEmergencyList = (list: Emergency[], emptyMessage: string) => (
    <div className="space-y-2.5">
      <AnimatePresence>
        {list.map((emg) => (
          <motion.div
            key={emg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            onClick={() => setSelectedEmergency(emg)}
            className="cursor-pointer"
          >
            <div className="bg-[#0D111A] border border-slate-800 hover:border-cyan-500/50 rounded-xl p-3.5 transition-all shadow-sm hover:shadow-cyan-950/20">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="font-mono text-[11px] font-bold text-slate-400 bg-[#131826] border border-slate-700/80 px-2.5 py-1 rounded-md shrink-0 select-all">
                    {emg.id.slice(0, 8)}...
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-white truncate">{emg.ambulanceDisplayName}</p>
                      <span className="text-xs text-slate-400 font-mono">({emg.vehicleNumber || 'AMB'})</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                        emg.priority === 'CODE_RED' || (emg.priority as any) === 'CRITICAL'
                          ? 'bg-red-500/10 text-red-400 border-red-500/30'
                          : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      }`}>
                        {emg.priority || 'URGENT'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-medium mt-0.5 truncate">
                      → <strong className="text-slate-200">{emg.hospital.name}</strong> • Category: <span className="text-cyan-400 font-semibold">{emg.patient?.category || 'Not specified'}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto bg-[#131826] px-3 py-1.5 rounded-lg border border-slate-800">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">ETA</span>
                    <span className="text-xs text-slate-200 font-mono font-bold">
                      {emg.route?.etaSeconds != null ? `${Math.round(emg.route.etaSeconds / 60)}m` : 'N/A'}
                    </span>
                  </div>
                  <div className="h-4 w-px bg-slate-800" />
                  <StatusBadge status={emg.status} />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {list.length === 0 && (
        <div className="text-center py-12 bg-[#0D111A] rounded-xl border border-slate-800">
          <Search className="w-8 h-8 text-slate-600 mx-auto mb-2.5" />
          <h3 className="text-sm font-bold text-slate-200">{emptyMessage}</h3>
          <p className="text-xs text-slate-400 mt-1">Try adjusting your search criteria or active filters.</p>
        </div>
      )}
    </div>
  );

  return (
    <AppShell userRole="ADMIN" userName="Central Command Admin" connectionState={realtimeService.getConnectionState()}>
      <div className="h-full overflow-y-auto pb-10 bg-[#07090C] text-slate-200">
        
        {/* Top Header */}
        <div className="px-4 sm:px-6 pt-6 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 mb-6 bg-[#0D111A]/50 backdrop-blur-md">
          <PageHeader
            title="AERO Central Command"
            subtitle="Authoritative multi-agency telemetry, emergency dispatch verification, and infrastructure status"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#131826] hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
              title="Refresh Records"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => handleExport('csv')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#131826] hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => handleExport('json')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 text-xs font-bold border border-cyan-800/80 transition-colors cursor-pointer"
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>
        </div>

        {/* Operational Overview Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 px-4 sm:px-6 mb-6">
          {statCards.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
            >
              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-3.5 h-full flex flex-col justify-between shadow-sm">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider leading-tight">
                    {stat.label}
                  </span>
                  <div className={`p-1.5 rounded-lg border shrink-0 ${stat.accent}`}>
                    {stat.icon}
                  </div>
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-black text-white tabular-nums tracking-tight">
                    {stat.value}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 truncate">
                    {stat.subtext}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tabbed Content */}
        <div className="px-4 sm:px-6 pb-6">
          <Tabs
            tabs={[
              {
                id: 'emergencies',
                label: 'Active Incident Feed',
                badge: activeList.length,
                content: (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4 pt-2"
                  >
                    {/* Search & Filter Bar */}
                    <div className="flex flex-col sm:flex-row gap-3 bg-[#0D111A] p-3 rounded-xl border border-slate-800">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search active emergencies by ID, ambulance, or hospital..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full bg-[#131826] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                      <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="bg-[#131826] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 min-w-[180px] cursor-pointer"
                      >
                        <option value="ALL">All Categories</option>
                        <option value="CARDIAC">Cardiac</option>
                        <option value="TRAUMA">Trauma</option>
                        <option value="STROKE">Stroke</option>
                        <option value="RESPIRATORY">Respiratory</option>
                      </select>
                    </div>

                    {/* Emergencies List */}
                    {renderEmergencyList(activeList, 'No active emergencies recorded')}
                  </motion.div>
                ),
              },
              {
                id: 'history',
                label: 'All Incident History',
                badge: historyList.length,
                content: (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4 pt-2"
                  >
                    <div className="flex flex-col sm:flex-row gap-3 bg-[#0D111A] p-3 rounded-xl border border-slate-800">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search completed or cancelled incident records..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full bg-[#131826] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                      <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="bg-[#131826] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 min-w-[180px] cursor-pointer"
                      >
                        <option value="ALL">All Categories</option>
                        <option value="CARDIAC">Cardiac</option>
                        <option value="TRAUMA">Trauma</option>
                        <option value="STROKE">Stroke</option>
                        <option value="RESPIRATORY">Respiratory</option>
                      </select>
                    </div>

                    {renderEmergencyList(historyList, 'No historical incident records found')}
                  </motion.div>
                ),
              }
            ]}
          />
        </div>

        {/* Incident Detail Modal */}
        {selectedEmergency && (
          <Dialog
            open={!!selectedEmergency}
            onClose={() => setSelectedEmergency(null)}
            title={`Incident Audit: ${selectedEmergency.id}`}
            variant="default"
            cancelLabel="Close Audit View"
          >
            <div className="space-y-3.5 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-3 bg-[#0B1220] p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Incident ID</span>
                  <span className="font-mono text-cyan-400 select-all font-bold">{selectedEmergency.id}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Status</span>
                  <span className="font-bold text-white uppercase">{selectedEmergency.status}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0B1220] p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Ambulance Unit</span>
                  <span className="font-bold text-white">{selectedEmergency.ambulanceDisplayName}</span>
                </div>
                <div className="bg-[#0B1220] p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Destination Hospital</span>
                  <span className="font-bold text-emerald-400">{selectedEmergency.hospital.name}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 bg-[#0B1220] p-3 rounded-xl border border-slate-800 text-center">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Corridor</span>
                  <span className="font-bold text-slate-200">{(selectedEmergency as any).corridorStatus || 'PENDING'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Hospital Bay</span>
                  <span className="font-bold text-slate-200">{(selectedEmergency as any).hospitalStatus || 'PENDING'}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Speed</span>
                  <span className="font-bold text-cyan-300">
                    {selectedEmergency.currentSpeedKmH != null ? `${Math.round(selectedEmergency.currentSpeedKmH)} km/h` : 'N/A'}
                  </span>
                </div>
              </div>

              <div className="bg-[#0B1220] p-3 rounded-xl border border-slate-800 space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Created At:</span>
                  <span className="text-white">
                    {selectedEmergency.createdAt ? new Date(selectedEmergency.createdAt).toLocaleString() : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Resolved At:</span>
                  <span className="text-white">
                    {(selectedEmergency as any).resolvedAt ? new Date((selectedEmergency as any).resolvedAt).toLocaleString() : 'Ongoing / Unresolved'}
                  </span>
                </div>
              </div>
            </div>
          </Dialog>
        )}

      </div>
    </AppShell>
  );
}
