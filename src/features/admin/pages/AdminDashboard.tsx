import { useState, useEffect } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import { PageHeader } from '../../../components/layout/PageHeader';
import { StatusBadge } from '../../../components/ui/Badge';
import { Tabs } from '../../../components/ui/Tabs';
import { Dialog } from '../../../components/ui/Dialog';
import { analyticsService, type AdminOverviewStats } from '../../../services/analyticsService';
import { realtimeService } from '../../../services/realtimeService';
import type { Emergency, ConnectionState } from '../../../types';
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
  Ambulance as AmbulanceIcon,
  Navigation,
  UserCheck,
  Flame,
  Edit3,
  Trash2
} from 'lucide-react';
import {
  policeCoordinationService,
  type PoliceCoordinationPlan,
  type PoliceRouteAssignment
} from '../../../services/policeCoordinationService';

export function AdminDashboard() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(realtimeService.getConnectionState());

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

  // Admin Superuser Edit & Nuke states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEmergency, setEditingEmergency] = useState<Emergency | null>(null);
  const [editForm, setEditForm] = useState({
    status: 'ACTIVE',
    priority: 'CODE_RED',
    category: 'CARDIAC',
    hospitalName: '',
    corridorStatus: 'PENDING',
    notes: ''
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [nukeSingleModalOpen, setNukeSingleModalOpen] = useState(false);
  const [emergencyToNuke, setEmergencyToNuke] = useState<Emergency | null>(null);
  const [isNukingSingle, setIsNukingSingle] = useState(false);

  const [nukeAllModalOpen, setNukeAllModalOpen] = useState(false);
  const [isNukingAll, setIsNukingAll] = useState(false);

  // Central Police Route Coordination Overview & Dispatcher Override
  const [coordinationOverview, setCoordinationOverview] = useState<{
    plans: (PoliceCoordinationPlan & { assignments: PoliceRouteAssignment[] })[];
    totalActivePlans: number;
    totalCheckpoints: number;
    totalGaps: number;
    availableOfficers: any[];
  } | null>(null);

  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [selectedAssignmentToReassign, setSelectedAssignmentToReassign] = useState<PoliceRouteAssignment | null>(null);
  const [newOfficerId, setNewOfficerId] = useState('');
  const [newOfficerName, setNewOfficerName] = useState('');
  const [reassignReason, setReassignReason] = useState('DISPATCH_OVERRIDE_PRIORITY');
  const [isReassigning, setIsReassigning] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [overviewData, historyData, coordOverview] = await Promise.all([
        analyticsService.getDashboardOverview(),
        analyticsService.getEmergencyHistory(),
        policeCoordinationService.getAdminOverview().catch(() => null),
      ]);
      setStats(overviewData);
      setEmergencies(historyData);
      if (coordOverview) {
        setCoordinationOverview(coordOverview);
        if (coordOverview.availableOfficers?.[0] && !newOfficerId) {
          setNewOfficerId(coordOverview.availableOfficers[0].id);
          setNewOfficerName(coordOverview.availableOfficers[0].name);
        }
      }
    } catch (err) {
      console.warn('[AdminDashboard] Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    realtimeService.initialize();

    const unsubConn = realtimeService.on('connection_change', (state: ConnectionState) => {
      setConnectionState(state);
    });

    loadData();

    const unsubEmergency = realtimeService.on('incidents_updated', () => {
      loadData();
    });

    const unsubPolice = realtimeService.on('police_assignment_update', () => {
      policeCoordinationService.getAdminOverview().then(data => {
        if (data) setCoordinationOverview(data);
      }).catch(() => {});
    });

    return () => {
      unsubConn();
      unsubEmergency();
      unsubPolice();
    };
  }, []);

  const handleExport = (format: 'csv' | 'json') => {
    analyticsService.exportData(format);
  };

  // Open Edit Modal with incident data
  const handleOpenEdit = (emg: Emergency) => {
    setEditingEmergency(emg);
    setEditForm({
      status: emg.status,
      priority: emg.priority || 'CODE_RED',
      category: emg.patient?.category || 'CARDIAC',
      hospitalName: emg.hospital?.name || '',
      corridorStatus: (emg as any).corridorStatus || 'PENDING',
      notes: emg.patient?.chiefComplaint || ''
    });
    setEditModalOpen(true);
  };

  // Save Edit Changes
  const handleSaveEdit = async () => {
    if (!editingEmergency) return;
    setIsSavingEdit(true);
    try {
      const statusMap: Record<string, string> = {
        'ACTIVE': 'active',
        'ARRIVED': 'arrived',
        'COMPLETED': 'resolved',
        'CANCELLED': 'cancelled'
      };
      const rawStatus = statusMap[editForm.status] || editForm.status.toLowerCase();

      await analyticsService.updateIncident(editingEmergency.id, {
        status: rawStatus,
        priority: editForm.priority.toLowerCase() === 'code_red' ? 'critical' : (editForm.priority.toLowerCase() === 'code_yellow' ? 'high' : 'medium'),
        incident_type: editForm.category,
        destination_hospital: editForm.hospitalName,
        corridor_status: editForm.corridorStatus,
        description: editForm.notes
      });

      setEditModalOpen(false);
      setEditingEmergency(null);
      await loadData();
    } catch (err: any) {
      alert(`Failed to save edit: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Nuke Single Incident
  const handleConfirmNukeSingle = async () => {
    if (!emergencyToNuke) return;
    setIsNukingSingle(true);
    try {
      await analyticsService.nukeIncident(emergencyToNuke.id);
      setNukeSingleModalOpen(false);
      setEmergencyToNuke(null);
      await loadData();
    } catch (err: any) {
      alert(`Nuke failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsNukingSingle(false);
    }
  };

  // Nuke All Active Incidents
  const handleConfirmNukeAll = async () => {
    setIsNukingAll(true);
    try {
      await analyticsService.nukeAllActiveIncidents();
      setNukeAllModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert(`Nuke all failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsNukingAll(false);
    }
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
    const isActive = emg.status === 'ACTIVE' || emg.status === 'ARRIVED';
    const matchesSearch = emg.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emg.ambulanceDisplayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (emg.hospital?.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'ALL' || emg.patient?.category === filterCategory;
    return isActive && matchesSearch && matchesCategory;
  });

  const historyList = emergencies.filter(emg => {
    const isHistory = emg.status === 'COMPLETED' || emg.status === 'CANCELLED';
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

                <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-auto flex-wrap">
                  <div className="flex items-center gap-3 bg-[#131826] px-3 py-1.5 rounded-lg border border-slate-800">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">ETA</span>
                      <span className="text-xs text-slate-200 font-mono font-bold">
                        {emg.status === 'ARRIVED' ? (
                          <span className="text-emerald-400 font-sans">ARRIVED</span>
                        ) : emg.route?.etaSeconds != null ? (
                          `${Math.round(emg.route.etaSeconds / 60)}m`
                        ) : (
                          'N/A'
                        )}
                      </span>
                    </div>
                    <div className="h-4 w-px bg-slate-800" />
                    <StatusBadge status={emg.status} />
                  </div>

                  {/* Superuser Edit / Nuke Buttons */}
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleOpenEdit(emg)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#131826] hover:bg-cyan-950/80 text-slate-300 hover:text-cyan-300 border border-slate-700/80 hover:border-cyan-600/80 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                      title="Edit incident properties and status"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="hidden sm:inline">Edit</span>
                    </button>
                    <button
                      onClick={() => {
                        setEmergencyToNuke(emg);
                        setNukeSingleModalOpen(true);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/70 text-red-300 hover:text-white border border-red-800/40 hover:border-red-600 text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                      title="Nuke (purge/cancel) this emergency incident"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      <span className="hidden sm:inline">Nuke</span>
                    </button>
                  </div>
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
    <AppShell userRole="ADMIN" userName="Central Command Admin" connectionState={connectionState}>
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
              onClick={() => setNukeAllModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/80 hover:bg-red-900 text-red-200 text-xs font-bold border border-red-700/80 transition-colors cursor-pointer shadow-sm hover:shadow-red-950/50"
              title="Purge all active emergencies across all boards"
            >
              <Flame className="w-3.5 h-3.5 text-red-400" />
              <span>Nuke All Active</span>
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
              },
              {
                id: 'route_coordination',
                label: 'Route Police Coordination',
                badge: (coordinationOverview?.totalGaps && coordinationOverview.totalGaps > 0)
                  ? `${coordinationOverview.totalGaps} GAPS`
                  : (coordinationOverview?.totalActivePlans || 0),
                content: (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4 pt-2"
                  >
                    {/* Operational Summary Bar */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="bg-[#0D111A] p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Active Plans</span>
                          <span className="text-xl font-black text-cyan-400 font-mono">
                            {coordinationOverview?.totalActivePlans || 0}
                          </span>
                        </div>
                        <Navigation className="w-5 h-5 text-cyan-400" />
                      </div>

                      <div className="bg-[#0D111A] p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Monitored Checkpoints</span>
                          <span className="text-xl font-black text-teal-400 font-mono">
                            {coordinationOverview?.totalCheckpoints || 0}
                          </span>
                        </div>
                        <Shield className="w-5 h-5 text-teal-400" />
                      </div>

                      <div className={`p-3 rounded-xl border flex items-center justify-between ${
                        (coordinationOverview?.totalGaps || 0) > 0
                          ? 'bg-amber-950/20 border-amber-500/50'
                          : 'bg-[#0D111A] border-slate-800'
                      }`}>
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Coverage Gaps</span>
                          <span className={`text-xl font-black font-mono ${
                            (coordinationOverview?.totalGaps || 0) > 0 ? 'text-amber-400' : 'text-slate-400'
                          }`}>
                            {coordinationOverview?.totalGaps || 0} Unstaffed
                          </span>
                        </div>
                        <AlertTriangle className={`w-5 h-5 ${
                          (coordinationOverview?.totalGaps || 0) > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-600'
                        }`} />
                      </div>
                    </div>

                    {/* Plans List */}
                    {(!coordinationOverview?.plans || coordinationOverview.plans.length === 0) ? (
                      <div className="text-center py-12 bg-[#0D111A] rounded-xl border border-slate-800">
                        <Shield className="w-8 h-8 text-slate-600 mx-auto mb-2.5" />
                        <h3 className="text-sm font-bold text-slate-200">No active route coordination plans running</h3>
                        <p className="text-xs text-slate-400 mt-1">Coordination plans generate automatically when an ambulance SOS establishes a route.</p>
                      </div>
                    ) : (
                      coordinationOverview.plans.map(plan => (
                        <div key={plan.id} className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 space-y-3">
                          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-slate-800 pb-2.5">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-black text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800">
                                  PLAN v{plan.route_version}
                                </span>
                                <span className="font-bold text-white text-sm">Incident {plan.incident_id.slice(0, 8)}...</span>
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                                  plan.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}>
                                  {plan.status}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-1">
                                Corridor Radius: <strong className="text-slate-200">{plan.corridor_distance_meters}m</strong> • Checkpoints: <strong className="text-slate-200">{plan.assignments?.length || 0}</strong>
                              </p>
                            </div>

                            {(plan.coverage_gap_count || plan.coverage_gaps_count || 0) > 0 && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>{plan.coverage_gap_count || plan.coverage_gaps_count} Uncovered Junction(s)</span>
                              </div>
                            )}
                          </div>

                          {/* Checkpoint assignments */}
                          <div className="space-y-1.5">
                            {plan.assignments?.map(asg => {
                              const isGap = !asg.police_id || asg.is_coverage_gap;
                              return (
                                <div
                                  key={asg.id}
                                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border text-xs ${
                                    isGap ? 'bg-amber-950/15 border-amber-500/30' : 'bg-[#111624] border-slate-800/80'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-black text-cyan-400 bg-cyan-950/70 px-1.5 py-0.5 rounded text-[10px]">
                                      P{asg.sequence_order}
                                    </span>
                                    <div>
                                      <p className="font-bold text-white leading-tight">{asg.junction_name}</p>
                                      <p className="text-[10px] text-slate-400">
                                        {(asg.distance_from_ambulance_meters / 1000).toFixed(1)} km ahead • Amb ETA ~{asg.ambulance_eta_seconds != null ? Math.max(1, Math.round(asg.ambulance_eta_seconds / 60)) : Math.max(1, Math.round(asg.distance_from_ambulance_meters / 500))}m
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                                    {isGap ? (
                                      <span className="text-[10px] font-bold text-amber-400 bg-amber-950/70 px-2 py-0.5 rounded border border-amber-800">
                                        ⚠️ UNSTAFFED GAP
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-slate-300 bg-[#161D2E] px-2 py-0.5 rounded border border-slate-700">
                                        Officer: <strong className="text-white">{asg.police_name || 'Assigned'}</strong>
                                      </span>
                                    )}

                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${
                                      asg.status === 'CLEARANCE_CONFIRMED' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
                                      asg.status === 'READY' ? 'bg-teal-500/20 text-teal-300 border-teal-500/40' :
                                      asg.status === 'EN_ROUTE_TO_POSITION' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' :
                                      asg.status === 'ACKNOWLEDGED' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                                      asg.status === 'PASSED' || asg.status === 'COMPLETED' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
                                      asg.status === 'BLOCKED' || asg.status === 'CLEARANCE_REVOKED' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
                                      'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                    }`}>
                                      {asg.status.replace(/_/g, ' ')}
                                    </span>

                                    <button
                                      onClick={() => {
                                        setSelectedAssignmentToReassign(asg);
                                        setReassignModalOpen(true);
                                      }}
                                      className="py-1 px-2.5 rounded bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 font-bold text-[10px] border border-cyan-500/30 transition-colors cursor-pointer flex items-center gap-1"
                                    >
                                      <UserCheck className="w-3 h-3" />
                                      {isGap ? 'Assign Reinforcement' : 'Reassign / Override'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </motion.div>
                )
              }
            ]}
          />
        </div>

        {/* Modal: Admin Superuser Edit Incident */}
        <Dialog
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          title={`Edit Incident: ${editingEmergency?.id.slice(0, 8)}...`}
          variant="default"
          confirmLabel={isSavingEdit ? "Saving..." : "Save Changes"}
          onConfirm={handleSaveEdit}
        >
          <div className="space-y-3.5 text-xs text-slate-300">
            <p className="text-slate-400 text-[11px]">
              Administrator override: modify incident priority, status, corridor, or destination directly.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="COMPLETED">COMPLETED (Resolved)</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Priority</label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm(prev => ({ ...prev, priority: e.target.value }))}
                  className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="CODE_RED">CODE RED (Critical)</option>
                  <option value="CODE_YELLOW">CODE YELLOW (High)</option>
                  <option value="CODE_GREEN">CODE GREEN (Medium)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Category</label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="CARDIAC">CARDIAC</option>
                  <option value="TRAUMA">TRAUMA</option>
                  <option value="RESPIRATORY">RESPIRATORY</option>
                  <option value="STROKE">STROKE</option>
                  <option value="PEDIATRIC">PEDIATRIC</option>
                  <option value="GENERAL">GENERAL</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Corridor Status</label>
                <select
                  value={editForm.corridorStatus}
                  onChange={(e) => setEditForm(prev => ({ ...prev, corridorStatus: e.target.value }))}
                  className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="PENDING">PENDING</option>
                  <option value="CLEARING">CLEARING</option>
                  <option value="CLEAR">CLEAR</option>
                  <option value="CAUTION">CAUTION</option>
                  <option value="BLOCKED">BLOCKED</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Destination Hospital</label>
              <input
                type="text"
                value={editForm.hospitalName}
                onChange={(e) => setEditForm(prev => ({ ...prev, hospitalName: e.target.value }))}
                className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                placeholder="Hospital name..."
              />
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Chief Complaint / Description</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 resize-none"
                placeholder="Emergency description..."
              />
            </div>
          </div>
        </Dialog>

        {/* Modal: Nuke Single Incident Confirmation */}
        <Dialog
          open={nukeSingleModalOpen}
          onClose={() => setNukeSingleModalOpen(false)}
          title="Confirm Incident Nuke"
          variant="danger"
          confirmLabel={isNukingSingle ? "Nuking..." : "Yes, Nuke Incident"}
          onConfirm={handleConfirmNukeSingle}
        >
          <div className="space-y-3 text-xs text-slate-300">
            <p className="text-red-300 font-semibold">
              Warning: You are about to NUKE incident <span className="font-mono text-white font-bold select-all">{emergencyToNuke?.id}</span>.
            </p>
            <p>
              This will immediately purge the incident from active queues, revoke police corridor checkpoints, and clear ambulance telemetry.
            </p>
          </div>
        </Dialog>

        {/* Modal: Nuke All Active Incidents Confirmation */}
        <Dialog
          open={nukeAllModalOpen}
          onClose={() => setNukeAllModalOpen(false)}
          title="⚠️ NUKE ALL ACTIVE EMERGENCIES"
          variant="danger"
          confirmLabel={isNukingAll ? "Nuking All..." : "Yes, Nuke All Active"}
          onConfirm={handleConfirmNukeAll}
        >
          <div className="space-y-3 text-xs text-slate-300">
            <p className="text-red-400 font-bold text-sm">
              CAUTION: This will immediately purge ALL {activeList.length} active emergency incident(s) across the entire AERO platform.
            </p>
            <p>
              All active ambulance corridors, police junction assignments, and hospital triage incoming queues will be cancelled and reset immediately.
            </p>
            <p className="text-slate-400">
              Only perform this action for clearing test states or resetting emergency operations.
            </p>
          </div>
        </Dialog>

        {/* Modal: Dispatcher Assignment Override / Reinforcement */}
        <Dialog
          open={reassignModalOpen}
          onClose={() => setReassignModalOpen(false)}
          title={selectedAssignmentToReassign?.police_id ? "Dispatcher Override / Reassign Officer" : "Assign Reinforcement Officer"}
          variant="default"
          confirmLabel={isReassigning ? "Processing..." : "Confirm Assignment"}
          onConfirm={async () => {
            if (!selectedAssignmentToReassign || !newOfficerId) return;
            setIsReassigning(true);
            try {
              const res = await policeCoordinationService.reassignOfficer(
                selectedAssignmentToReassign.id,
                newOfficerId,
                reassignReason,
                newOfficerName
              );
              if (res?.assignment) {
                const updated = await policeCoordinationService.getAdminOverview();
                if (updated) setCoordinationOverview(updated);
                setReassignModalOpen(false);
              }
            } catch (err: any) {
              alert(`Reassignment failed: ${err.message || 'Error'}`);
            } finally {
              setIsReassigning(false);
            }
          }}
        >
          <div className="space-y-3.5 text-xs text-slate-300">
            <p>
              Reassign post at <strong className="text-white">{selectedAssignmentToReassign?.junction_name}</strong> to an available authorized traffic officer.
            </p>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Select Officer</label>
              <select
                value={newOfficerId}
                onChange={(e) => {
                  setNewOfficerId(e.target.value);
                  const off = coordinationOverview?.availableOfficers?.find(o => o.id === e.target.value);
                  if (off) setNewOfficerName(off.name);
                }}
                className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                {coordinationOverview?.availableOfficers?.map(off => (
                  <option key={off.id} value={off.id}>
                    {off.name} ({off.station || 'Traffic Division'}) — {off.availability}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Reason for Reassignment</label>
              <select
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                className="w-full bg-[#131826] border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="DISPATCH_OVERRIDE_PRIORITY">Dispatch Override: Prioritize Critical Trauma Corridor</option>
                <option value="COVERAGE_GAP_FILL">Coverage Gap Fill: Reinforce Unstaffed Route Junction</option>
                <option value="OFFICER_DELAY_ESCALATION">Escalation: Primary Officer Delayed or Unresponsive</option>
                <option value="TACTICAL_REDISTRIBUTION">Tactical Redistribution across Division</option>
              </select>
            </div>
          </div>
        </Dialog>

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

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => {
                    handleOpenEdit(selectedEmergency);
                    setSelectedEmergency(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/80 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Incident</span>
                </button>
                <button
                  onClick={() => {
                    setEmergencyToNuke(selectedEmergency);
                    setSelectedEmergency(null);
                    setNukeSingleModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800/60 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Nuke Incident</span>
                </button>
              </div>
            </div>
          </Dialog>
        )}

      </div>
    </AppShell>
  );
}
