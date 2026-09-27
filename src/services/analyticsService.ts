import { supabase } from '../lib/supabase';
import type { Emergency } from '../types';

export const analyticsService = {
  async getDashboardOverview() {
    // A quick way to get counts
    const { count: activeEmergencies } = await supabase.from('emergency_incidents').select('*', { count: 'exact', head: true }).in('status', ['active', 'dispatched', 'en_route', 'arrived', 'rerouting']);
    const { count: completedToday } = await supabase.from('emergency_incidents').select('*', { count: 'exact', head: true }).in('status', ['resolved', 'completed', 'cancelled']);
    const { count: onlineAmbulances } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['AMBULANCE', 'AMBULANCE_OPERATOR']);
    const { count: availablePolice } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['POLICE', 'POLICE_OFFICER']);
    
    return {
      activeEmergencies: activeEmergencies || 0,
      onlineAmbulances: onlineAmbulances || 0,
      availablePolice: availablePolice || 0,
      partnerHospitals: 0,
      completedToday: completedToday || 0,
      avgResponseTimeMins: 0,
      timeSavedMins: 0,
      clearanceSuccessRate: 0,
      // Fallbacks for AdminAnalytics
      avgResponseTimeMinutes: 0,
      timeSavedVsNormalTrafficMins: 0,
      junctionClearanceSuccessRatePercent: 0,
      totalEmergenciesToday: (activeEmergencies || 0) + (completedToday || 0),
    };
  },

  async getAnalyticsData() {
    return {
      overview: await this.getDashboardOverview(),
      performance: [], // stub
      emergencyVolume: [],
      statusDistribution: [],
      categoryDistribution: [],
      responseTimes: [],
      junctionClearanceMetrics: []
    } as any;
  },

  async getEmergencyHistory(): Promise<Emergency[]> {
    const { data } = await supabase.from('emergency_incidents').select('*').order('created_at', { ascending: false });
    return (data || []).map((i: any) => ({
      id: i.id,
      status: i.status === 'active' ? 'ACTIVE' : i.status === 'resolved' ? 'COMPLETED' : 'PENDING',
      priority: i.priority || 'CODE_RED',
      ambulanceDisplayName: i.ambulance_id || 'AERO ALS',
      vehicleNumber: i.ambulance_id || 'AMB-1',
      hospital: { name: i.destination_hospital || 'Unknown' },
      patient: { category: i.incident_type || 'UNAVAILABLE' },
      createdAt: i.created_at,
      currentSpeedKmH: i.current_speed,
      route: { etaSeconds: i.route_duration_seconds }
    })) as any;
  },

  exportData(format: 'csv' | 'json') {
    // In a real scenario, this would trigger a download based on current data
    console.log("Export triggered for", format);
  },
};
