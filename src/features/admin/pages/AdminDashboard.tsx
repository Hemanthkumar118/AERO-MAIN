import { useState, useEffect } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { StatusBadge } from '../../../components/ui/Badge';
import { Tabs } from '../../../components/ui/Tabs';
import { analyticsService } from '../../../services/analyticsService';
import { realtimeService } from '../../../services/realtimeService';
import type { Emergency } from '../../../types';
import { motion, AnimatePresence } from 'framer-motion';

export function AdminDashboard() {
  const [stats, setStats] = useState({
    activeEmergencies: 0,
    onlineAmbulances: 0,
    availablePolice: 0,
    partnerHospitals: 0,
    completedToday: 0,
    avgResponseTimeMins: 0,
    timeSavedMins: 0,
    clearanceSuccessRate: 0,
  });

  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');

  useEffect(() => {
    analyticsService.getDashboardOverview().then(setStats);
    analyticsService.getEmergencyHistory().then(setEmergencies);

    const unsubEmergency = realtimeService.on('incidents_updated', () => {
      analyticsService.getDashboardOverview().then(setStats);
      analyticsService.getEmergencyHistory().then(setEmergencies);
    });

    return () => {
      unsubEmergency();
    };
  }, []);

  const handleExport = (format: 'csv' | 'json') => {
    analyticsService.exportData(format);
  };

  const statCards = [
    { label: 'Active Emergencies', value: stats.activeEmergencies, variant: 'emergency' as const, icon: '🚨' },
    { label: 'Fleet Online', value: stats.onlineAmbulances !== null ? `${stats.onlineAmbulances} Units` : 'UNAVAILABLE', variant: 'info' as const, icon: '🚑' },
    { label: 'Police Coverage', value: stats.availablePolice !== null ? `${stats.availablePolice} Posts` : 'UNAVAILABLE', variant: 'warning' as const, icon: '👮' },
    { label: 'Avg Response Time', value: stats.avgResponseTimeMins !== null ? `${stats.avgResponseTimeMins}m` : 'UNAVAILABLE', variant: 'success' as const, icon: '⏱️' },
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
    <div className="space-y-3">
      <AnimatePresence>
        {list.map((emg) => {
          return (
            <motion.div
              key={emg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <Card variant="default" className="enterprise-card hover:border-border-strong">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="enterprise-badge bg-bg-main">
                      {emg.id}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-white">{emg.ambulanceDisplayName}</p>
                        <span className="text-xs text-text-secondary font-mono font-medium">({emg.vehicleNumber || 'AMB'})</span>
                      </div>
                      <p className="text-xs text-text-secondary font-medium mt-0.5">
                        → {emg.hospital.name} • Category: <strong className="text-[#FF3B30]">{emg.patient?.category || 'UNAVAILABLE'}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 bg-bg-main px-3 py-1.5 rounded-lg border border-border-subtle">
                    <span className="text-xs text-text-secondary font-mono font-bold hidden sm:inline">
                      ETA: {emg.route?.etaSeconds != null ? `${Math.round(emg.route.etaSeconds / 60)}m` : 'UNAVAILABLE'} ({emg.currentSpeedKmH != null ? `${Math.round(emg.currentSpeedKmH)} km/h` : 'SPEED UNAVAILABLE'})
                    </span>
                    <StatusBadge status={emg.status} />
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {list.length === 0 && (
        <div className="text-center py-12 bg-bg-surface rounded-xl border border-border-subtle shadow-sm">
          <span className="text-3xl block mb-3">🔍</span>
          <h3 className="text-sm font-bold text-white">{emptyMessage}</h3>
          <p className="text-xs text-text-secondary mt-1">Try adjusting your search or category filters.</p>
        </div>
      )}
    </div>
  );

  return (
    <AppShell userRole="ADMIN" userName="Central Command Admin" connectionState="connected">
      <div className="h-full overflow-y-auto pb-10 bg-bg-main">
        <div className="px-4 sm:px-6 pt-6 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border-subtle mb-6">
          <PageHeader
            title="AERO Central Operations"
            subtitle="Real-time multi-agency emergency tracking & traffic clearance supervision"
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport('csv')} className="enterprise-button-secondary">
              📊 Export CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => handleExport('json')} className="enterprise-button-primary">
              💾 Export JSON
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-4 sm:px-6 mb-6">
          {statCards.map((stat, idx) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card variant="default" className="enterprise-card h-full flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <p className="telemetry-label">
                    {stat.label}
                  </p>
                  <span className="text-xl bg-bg-elevated p-1.5 rounded-lg border border-border-subtle">{stat.icon}</span>
                </div>
                <p className="text-3xl font-bold text-white tabular-nums mt-4">
                  {stat.value}
                </p>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Tabbed Content */}
        <div className="px-4 sm:px-6 pb-6">
          <Tabs
            tabs={[
              {
                id: 'emergencies',
                label: 'Emergency Incident Log',
                badge: emergencies.length,
                content: (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4"
                  >
                    {/* Search & Filter Bar */}
                    <div className="flex flex-col sm:flex-row gap-3 enterprise-card p-3 shadow-none">
                      <div className="relative flex-1">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-text-secondary">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                        </span>
                        <input
                          type="text"
                          placeholder="Search by Trip ID, Ambulance, or Hospital..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="enterprise-input pl-9 border-none bg-bg-main text-white"
                        />
                      </div>
                      <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="enterprise-input border-none bg-bg-main min-w-[200px]"
                      >
                        <option value="ALL">All Medical Categories</option>
                        <option value="CARDIAC">Cardiac</option>
                        <option value="TRAUMA">Trauma</option>
                        <option value="STROKE">Stroke</option>
                        <option value="RESPIRATORY">Respiratory</option>
                      </select>
                    </div>

                    {/* Emergencies Table / Cards */}
                    {renderEmergencyList(activeList, 'No active emergencies')}
                  </motion.div>
                ),
              },
              {
                id: 'history',
                label: 'Incident History',
                badge: historyList.length,
                content: (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row gap-3 enterprise-card p-3 shadow-none">
                      <div className="relative flex-1">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-text-secondary">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                        </span>
                        <input
                          type="text"
                          placeholder="Search history..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="enterprise-input pl-9 border-none bg-bg-main text-white"
                        />
                      </div>
                      <select
                        value={filterCategory}
                        onChange={(e) => setFilterCategory(e.target.value)}
                        className="enterprise-input border-none bg-bg-main min-w-[200px]"
                      >
                        <option value="ALL">All Categories</option>
                        <option value="CARDIAC">Cardiac</option>
                        <option value="TRAUMA">Trauma</option>
                        <option value="STROKE">Stroke</option>
                        <option value="RESPIRATORY">Respiratory</option>
                      </select>
                    </div>

                    {renderEmergencyList(historyList, 'No historical incidents found')}
                  </motion.div>
                ),
              }
            ]}
          />
        </div>
      </div>
    </AppShell>
  );
}
