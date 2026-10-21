import { supabase } from '../lib/supabase';
import type { EmergencyIncident, ConnectionState } from '../types';
import { getBackendUrl } from './apiConfig';

type EventHandler = (data: any) => void;

class RealtimeService {
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private connectionState: ConnectionState = 'disconnected';
  private incidents: Map<string, EmergencyIncident> = new Map();
  private channel: any = null;
  private initialized = false;
  private reconnectTimeout: any = null;
  private pollInterval: any = null;

  constructor() {
    // Only initialize when explicitly called or first used to avoid SSR issues
  }

  public initialize() {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof window === 'undefined') return;

    this.setupChannel();
    this.fetchInitialState();

    // Reconnect on visibility change if connection was lost
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (this.connectionState !== 'connected') {
          this.reconnect();
        } else {
          this.fetchInitialState();
        }
      }
    });

    // Window network state listeners
    window.addEventListener('online', () => {
      console.log('[RealtimeService] Browser back online. Reconnecting realtime...');
      this.reconnect();
    });

    window.addEventListener('offline', () => {
      console.warn('[RealtimeService] Browser offline.');
      this.connectionState = 'disconnected';
      this.dispatchLocal('connection_change', 'disconnected');
    });

    // Resilient background sync: reconciles state every 12 seconds in active tab
    this.pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.fetchInitialState();
      }
    }, 12000);
  }

  public reconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.connectionState = 'reconnecting';
    this.dispatchLocal('connection_change', 'reconnecting');
    this.setupChannel(true);
  }

  private setupChannel(forceReset = false) {
    if (this.channel && !forceReset) {
      return;
    }

    if (this.channel) {
      try {
        supabase.removeChannel(this.channel);
      } catch (err) {
        console.warn('[RealtimeService] removeChannel notice:', err);
      }
      this.channel = null;
    }

    this.connectionState = 'reconnecting';
    this.dispatchLocal('connection_change', 'reconnecting');

    try {
      this.channel = supabase.channel(`global:emergency_incidents:${Date.now()}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'emergency_incidents' },
          (payload: any) => {
            this.handlePostgresChange(payload);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'clinical_observations' },
          (payload: any) => {
            this.handleClinicalObservationChange(payload);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'police_route_assignments' },
          (payload: any) => {
            if (payload?.new) {
              this.dispatchLocal('police_assignment_updated', payload.new);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'police_coordination_plans' },
          (payload: any) => {
            if (payload?.new) {
              this.dispatchLocal('police_coordination_plan_updated', payload.new);
            }
          }
        )
        .on(
          'broadcast',
          { event: 'location_update' },
          (payload: any) => {
            this.handleLocationBroadcast(payload);
          }
        )
        .on(
          'broadcast',
          { event: 'clinical_observation_update' },
          (payload: any) => {
            this.handleClinicalBroadcast(payload);
          }
        )
        .on(
          'broadcast',
          { event: 'police_assignment_update' },
          (payload: any) => {
            if (payload?.payload) {
              this.dispatchLocal('police_assignment_updated', payload.payload);
            }
          }
        )
        .on(
          'broadcast',
          { event: 'incident_status_change' },
          (payload: any) => {
            if (payload?.payload) {
              this.handleIncidentBroadcast(payload.payload);
            }
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            this.connectionState = 'connected';
            this.dispatchLocal('connection_change', 'connected');
            // Reconcile missed state immediately after successful subscription
            this.fetchInitialState();
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            this.connectionState = 'disconnected';
            this.dispatchLocal('connection_change', 'disconnected');
            // Clean up and schedule reconnect
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => {
              if (this.initialized) {
                this.setupChannel(true);
              }
            }, 4000);
          }
        });
    } catch (err) {
      console.warn('[RealtimeService] Channel setup failed:', err);
      this.connectionState = 'disconnected';
      this.dispatchLocal('connection_change', 'disconnected');
    }
  }

  public async fetchInitialState() {
    try {
      let loaded = false;

      // 1. Try Supabase query (using current session if authenticated)
      const { data, error } = await supabase
        .from('emergency_incidents')
        .select('*')
        .in('status', ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'])
        .order('created_at', { ascending: false })
        .limit(50);
        
      if (!error && Array.isArray(data)) {
        this.incidents.clear();
        data.forEach((inc: any) => {
          this.incidents.set(inc.id, inc as EmergencyIncident);
        });
        this.broadcastIncidents();
        loaded = true;
      }

      // 2. Authoritative backend endpoint fallback
      if (!loaded) {
        const headers: Record<string, string> = {};
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            headers['Authorization'] = `Bearer ${session.access_token}`;
          }
        } catch {}

        const res = await fetch(`${getBackendUrl()}/api/admin/incidents?status=ACTIVE&limit=50`, { headers });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.incidents)) {
            this.incidents.clear();
            json.incidents.forEach((inc: any) => {
              this.incidents.set(inc.id, inc as EmergencyIncident);
            });
            this.broadcastIncidents();
          }
        }
      }
    } catch (e) {
      console.warn('[RealtimeService] Initial incidents sync note:', e);
    }
  }

  private handlePostgresChange(payload: any) {
    const { eventType, new: newRec, old: oldRec } = payload;
    
    if (eventType === 'DELETE') {
      if (oldRec?.id) {
        this.incidents.delete(oldRec.id);
      }
    } else if (newRec) {
      const incoming = newRec as EmergencyIncident;
      const statusLower = (incoming.status || '').toLowerCase();
      const isActive = ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'].includes(statusLower);
      
      if (isActive) {
        this.incidents.set(incoming.id, incoming);
      } else {
        this.incidents.delete(incoming.id);
      }
    }
    
    this.broadcastIncidents();
  }

  private handleIncidentBroadcast(incoming: any) {
    if (!incoming || !incoming.id) return;
    const statusLower = (incoming.status || '').toLowerCase();
    const isActive = ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'].includes(statusLower);

    if (isActive) {
      const existing = this.incidents.get(incoming.id) || {} as EmergencyIncident;
      this.incidents.set(incoming.id, { ...existing, ...incoming });
    } else {
      this.incidents.delete(incoming.id);
    }

    this.broadcastIncidents();
  }

  private broadcastIncidents() {
    const currentIncidents = Array.from(this.incidents.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    this.dispatchLocal('incidents_updated', currentIncidents);
  }

  private handleLocationBroadcast(payload: any) {
    if (!payload || !payload.payload) return;
    const { incidentId, latitude, longitude, speed, heading } = payload.payload;
    if (!incidentId) return;

    const incident = this.incidents.get(incidentId);
    if (incident) {
      // Update in memory and broadcast locally for instant UI update
      incident.current_latitude = latitude;
      incident.current_longitude = longitude;
      incident.current_speed = speed;
      incident.current_heading = heading;
      
      this.broadcastIncidents();
    }
  }

  public broadcastLocation(payload: any) {
    if (this.channel && this.connectionState === 'connected') {
      this.channel.send({
        type: 'broadcast',
        event: 'location_update',
        payload
      }).catch((e: any) => console.warn('Broadcast failed:', e));
    }
  }

  private handleClinicalObservationChange(payload: any) {
    const { new: newRec } = payload;
    if (newRec) {
      this.dispatchLocal('clinical_observation_updated', newRec);
    }
  }

  private handleClinicalBroadcast(payload: any) {
    if (payload?.payload) {
      this.dispatchLocal('clinical_observation_updated', payload.payload);
    }
  }

  public broadcastClinicalObservation(observation: any) {
    this.dispatchLocal('clinical_observation_updated', observation);
    if (this.channel && this.connectionState === 'connected') {
      this.channel.send({
        type: 'broadcast',
        event: 'clinical_observation_update',
        payload: observation
      }).catch((e: any) => console.warn('Clinical broadcast failed:', e));
    }
  }

  // ── Event Bus ──
  private lastEventData: Map<string, any> = new Map();

  public on(event: string, handler: EventHandler) {
    this.initialize(); // Lazy init

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    if (this.lastEventData.has(event)) {
      try {
        handler(this.lastEventData.get(event));
      } catch (err) {
        console.error(`Error in immediate event listener dispatch for ${event}:`, err);
      }
    }

    return () => this.off(event, handler);
  }

  public off(event: string, handler: EventHandler) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  private dispatchLocal(event: string, data: any) {
    this.lastEventData.set(event, data);
    const set = this.listeners.get(event);
    if (set) {
      set.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      });
    }
  }

  public getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  // Clean shutdown
  public destroy() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.channel) {
      try {
        supabase.removeChannel(this.channel);
      } catch {}
      this.channel = null;
    }
    this.listeners.clear();
    this.initialized = false;
  }

  // Stubbed legacy methods to prevent compiler errors in other dashboards
  public getAllEmergencies(): any[] { return []; }
  public getActiveEmergency(): any | null { return null; }
  public getJunctions(): any[] { return []; }
  public getIncidents(): any[] { return []; }
  public getCoordinationMessages(): any[] { return []; }
  public triggerEmergency(_e: any) {}
  public reportIncident(_e: any) {}
  public updateEmergencyStatus(_id: string, _status: string) {}
  public updateJunctionStatus(_id: string, _status: string) {}
  public updateHospitalPreparation(_id: string, _prep: any) {}
  public sendPoliceCoordinationMessage(_msg: any) {}
}

export const realtimeService = new RealtimeService();
