import { useState, useEffect } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import { PageHeader } from '../../../components/layout/PageHeader';
import { analyticsService, type AdminAnalyticsDataset } from '../../../services/analyticsService';
import { realtimeService } from '../../../services/realtimeService';
import type { ConnectionState } from '../../../types';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  Activity, 
  Clock, 
  CheckCircle2, 
  BarChart3, 
  PieChart as PieIcon, 
  RefreshCw,
  Inbox
} from 'lucide-react';

const CATEGORY_COLORS = ['#38bdf8', '#34d399', '#f87171', '#fbbf24', '#a78bfa', '#ec4899', '#94a3b8'];

export function AdminAnalytics() {
  const [dataset, setDataset] = useState<AdminAnalyticsDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>(realtimeService.getConnectionState());

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const data = await analyticsService.getAnalyticsData();
      setDataset(data);
    } catch (err) {
      console.warn('[AdminAnalytics] Error loading dataset:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    
    const unsub = realtimeService.on('connection_change', (state) => {
      setConnectionState(state);
    });

    return () => {
      unsub();
    };
  }, []);

  return (
    <AppShell userRole="ADMIN" userName="Central Command Admin" connectionState={connectionState}>
      <div className="h-full overflow-y-auto pb-10 bg-[#07090C] text-slate-200">
        
        {/* Page Header */}
        <div className="px-4 sm:px-6 pt-6 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 mb-6 bg-[#0D111A]/50 backdrop-blur-md">
          <PageHeader
            title="Operations Analytics & Performance"
            subtitle="Verified emergency dispatch history, response-time calculations, and multi-agency metrics"
          />
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#131826] hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Analytics</span>
          </button>
        </div>

        {!dataset || loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
            <span className="text-sm font-medium">Aggregating database analytics...</span>
          </div>
        ) : (
          <div className="px-4 sm:px-6 space-y-6">
            
            {/* KPI Highlight Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              
              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Average Transit Time</span>
                    <Clock className="w-4 h-4 text-emerald-400" />
                  </div>
                  <span className="text-2xl font-black text-white font-mono tracking-tight">
                    {dataset.overview.hasResponseTimeData && dataset.overview.avgResponseTimeMins !== null
                      ? `${dataset.overview.avgResponseTimeMins} mins`
                      : 'Not recorded'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  {dataset.overview.hasResponseTimeData ? 'Computed from completed incident logs' : 'Awaiting completed trips with arrival timestamps'}
                </span>
              </div>

              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Dispatches</span>
                    <Activity className="w-4 h-4 text-cyan-400" />
                  </div>
                  <span className="text-2xl font-black text-cyan-300 font-mono tracking-tight">
                    {dataset.overview.totalIncidents} Runs
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  {dataset.overview.activeEmergencies} active • {dataset.overview.completedIncidents} completed
                </span>
              </div>

              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Corridor Clearance Rate</span>
                    <CheckCircle2 className="w-4 h-4 text-purple-400" />
                  </div>
                  <span className="text-2xl font-black text-purple-300 font-mono tracking-tight">
                    {dataset.overview.hasCorridorData && dataset.overview.corridorClearanceRatePercent !== null
                      ? `${dataset.overview.corridorClearanceRatePercent}%`
                      : 'Not recorded'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  {dataset.overview.hasCorridorData ? 'Verified police green-wave actions' : 'Awaiting police corridor updates'}
                </span>
              </div>

              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Registered Facilities</span>
                    <Activity className="w-4 h-4 text-amber-400" />
                  </div>
                  <span className="text-2xl font-black text-amber-300 font-mono tracking-tight">
                    {dataset.overview.partnerHospitals} Hospitals
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 mt-2 block">
                  Active database network destinations
                </span>
              </div>

            </div>

            {/* Charts Row 1: Volume Timeline & Verified Response Times */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              
              {/* Emergency Volume by Date */}
              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <BarChart3 className="w-4 h-4 text-cyan-400" />
                      <span>Emergency Dispatch Volume by Date</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">Total incidents logged vs confirmed cleared corridors</p>
                  </div>
                </div>

                <div className="h-64 flex items-center justify-center">
                  {dataset.timelineVolume.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                      <Inbox className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-semibold">No emergency volume recorded yet</p>
                      <p className="text-[11px] text-slate-600 mt-0.5">Data appears as incidents are created</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dataset.timelineVolume} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                        <Bar dataKey="count" name="Total Incidents" fill="#0284c7" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="cleared" name="Police Cleared" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Transit Times (Verified Records) */}
              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-emerald-400" />
                      <span>Verified Trip Transit Times (Minutes)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">Calculated strictly from resolved incident start-to-arrival logs</p>
                  </div>
                </div>

                <div className="h-64 flex items-center justify-center">
                  {dataset.responseTimesList.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                      <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-semibold">No completed trips with arrival timestamps yet</p>
                      <p className="text-[11px] text-slate-600 mt-0.5">Transit times will populate once ambulances mark arrival</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dataset.responseTimesList} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="id" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                        <Bar dataKey="durationMinutes" name="Actual Transit Time (min)" fill="#10b981" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="estimatedEtaMinutes" name="Estimated Route ETA (min)" fill="#64748b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

            </div>

            {/* Charts Row 2: Category Distribution & Status Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              
              {/* Emergency Category Distribution */}
              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm">
                <div className="mb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <PieIcon className="w-4 h-4 text-purple-400" />
                    <span>Emergency Category Distribution</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Breakdown by emergency medical triage category</p>
                </div>

                <div className="h-64 flex items-center justify-center">
                  {dataset.categoryDistribution.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                      <PieIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-semibold">No emergency categories recorded</p>
                      <p className="text-[11px] text-slate-600 mt-0.5">Database has 0 categorized incidents</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dataset.categoryDistribution}
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {dataset.categoryDistribution.map((_, index) => (
                            <Cell key={`cat-${index}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Status Breakdown */}
              <div className="bg-[#0D111A] border border-slate-800 rounded-xl p-4 shadow-sm">
                <div className="mb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <span>Incident Operational Lifecycle Distribution</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Distribution across Active, Arrived, Resolved, and Cancelled</p>
                </div>

                <div className="h-64 flex items-center justify-center">
                  {dataset.statusDistribution.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                      <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-xs font-semibold">No incident lifecycle records</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dataset.statusDistribution} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                        <XAxis type="number" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        />
                        <Bar dataKey="value" name="Incidents" fill="#38bdf8" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

      </div>
    </AppShell>
  );
}
