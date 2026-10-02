import { supabase } from '../lib/supabase';
import type { EmergencyIncident, ConnectionState } from '../types';

type EventHandler = (data: any) => void;

class RealtimeService {
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private connectionState: ConnectionState = 'disconnected';
  private incidents: Map<string, EmergencyIncident> = new Map();
  private channel: any = null;
  private initialized = false;

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
      if (document.visibilityState === 'visible' && this.connectionState !== 'connected') {
        this.fetchInitialState();
      }
    });
  }

  private setupChannel() {
    if (this.channel) {
      supabase.removeChannel(this.channel);
    }

    this.connectionState = 'reconnecting' as any; // Cast in case reconnecting isn't in type
    this.dispatchLocal('connection_change', 'reconnecting');

    this.channel = supabase.channel('global:emergency_incidents')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_incidents' },
        (payload: any) => {
          this.handlePostgresChange(payload);
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          this.connectionState = 'connected';
          this.dispatchLocal('connection_change', 'connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          this.connectionState = 'disconnected';
          this.dispatchLocal('connection_change', 'disconnected');
          // Try to reconnect after a delay
          setTimeout(() => {
             if (this.initialized && this.connectionState !== 'connected') {
                this.setupChannel();
             }
          }, 5000);
        }
      });
  }

  private async fetchInitialState() {
    try {
      // Auto-cleanup stale records older than 12 hours server side if possible
      // Fetch active incidents
      const { data, error } = await supabase
        .from('emergency_incidents')
        .select('*')
        .in('status', ['active', 'dispatched', 'en_route', 'arrived'])
        .order('created_at', { ascending: false });
        
      if (!error && data) {
        this.incidents.clear();
        data.forEach((inc: any) => this.incidents.set(inc.id, inc as EmergencyIncident));
        this.broadcastIncidents();
      }
    } catch (e) {
      console.error('Failed to fetch initial incidents:', e);
    }
  }

  private handlePostgresChange(payload: any) {
    const { eventType, new: newRec, old: oldRec } = payload;
    
    if (eventType === 'DELETE') {
      this.incidents.delete(oldRec.id);
    } else {
      const incoming = newRec as EmergencyIncident;
      const isActive = ['active', 'dispatched', 'en_route', 'arrived'].includes(incoming.status || '');
      
      if (isActive) {
        this.incidents.set(incoming.id, incoming);
      } else {
        this.incidents.delete(incoming.id);
      }
    }
    
    this.broadcastIncidents();
  }

  private broadcastIncidents() {
    const currentIncidents = Array.from(this.incidents.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    this.dispatchLocal('incidents_updated', currentIncidents);
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
