import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '../../../components/layout/AppShell';
import { MapView, AmbulanceMarker, HospitalMarker, RoutePolyline } from '../../../components/map';
import { Badge } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { hospitalService, parsePatientData } from '../../../services/hospitalService';
import { realtimeService } from '../../../services/realtimeService';
import type { 
  Emergency, 
  Hospital, 
  HospitalReadinessState, 
  ReadinessTaskStatus,
  ConnectionState,
  EmergencyPriority
} from '../../../types';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../../providers/AuthProvider';
import { 
  Heart, 
  Activity, 
  Wind, 
  Brain, 
  Gauge, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  UserCheck, 
  Stethoscope, 
  ShieldCheck, 
  Edit3, 
  Save, 
  X, 
  Radio,
  AlertTriangle,
  Hospital as HospitalIcon,
  Check,
  ArrowRight,
  FileText
} from 'lucide-react';
import { clinicalService, type ClinicalObservation } from '../../../services/clinicalService';

export function HospitalDashboard() {
  const { addToast } = useToast();
  const { profile } = useAuth();

  // Core Hospital & Emergency State
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [incomingEmergencies, setIncomingEmergencies] = useState<Emergency[]>([]);
  const [selectedEmergency, setSelectedEmergency] = useState<Emergency | null>(null);
  const [readinessState, setReadinessState] = useState<HospitalReadinessState | null>(null);
  const [isLoadingReadiness, setIsLoadingReadiness] = useState<boolean>(false);
  const [isConfirmingReadiness, setIsConfirmingReadiness] = useState<boolean>(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  // Pre-hospital Clinical Observations State
  const [clinicalObservations, setClinicalObservations] = useState<ClinicalObservation[]>([]);
  const [isLoadingObservations, setIsLoadingObservations] = useState<boolean>(false);
  const [statusActionLoading, setStatusActionLoading] = useState<string | null>(null);

  // Specialist Assignment Modal State
  const [showSpecialistModal, setShowSpecialistModal] = useState<boolean>(false);
  const [availableSpecialists, setAvailableSpecialists] = useState<Array<{ id: string; name: string; role: string; phone?: string | null; organization?: string }>>([]);
  const [selectedSpecialistName, setSelectedSpecialistName] = useState<string>('');
  const [customSpecialty, setCustomSpecialty] = useState<string>('');
  const [customContact, setCustomContact] = useState<string>('');
  const [isAssigningSpecialist, setIsAssigningSpecialist] = useState<boolean>(false);

  // Capacity Editing State
  const [isEditingCapacity, setIsEditingCapacity] = useState(false);
  const [editCapacities, setEditCapacities] = useState({ icu: 0, trauma: 0, doctors: 0 });
  const [connectionState, setConnectionState] = useState<ConnectionState>(realtimeService.getConnectionState());

  // Real-time Connection State
  useEffect(() => {
    return realtimeService.on('connection_change', (state) => {
      setConnectionState(state);
    });
  }, []);

  // Fetch Hospital Info & Incoming Emergencies
  const loadHospitalData = useCallback(async () => {
    let h: Hospital | null = null;
    if (profile?.full_name) {
      h = await hospitalService.getHospitalByName(profile.full_name);
    }
    
    if (!h) {
      const hospitals = await hospitalService.getAllHospitals();
      if (hospitals.length > 0) {
        h = hospitals[0];
      }
    }

    if (h) {
      setHospital(h);
      const emergencies = await hospitalService.getIncomingEmergencies(h.name);
      setIncomingEmergencies(emergencies);
      if (emergencies.length > 0 && !selectedEmergency) {
        setSelectedEmergency(emergencies[0]);
      }
    }
  }, [profile?.full_name, selectedEmergency]);

  // Load Database-backed Readiness State for selected emergency
  const loadReadiness = useCallback(async (emergencyId: string) => {
    setIsLoadingReadiness(true);
    setReadinessError(null);
    try {
      const state = await hospitalService.getIncidentReadiness(emergencyId);
      setReadinessState(state);
    } catch (err: any) {
      console.error('[HospitalDashboard] Failed to load readiness state:', err);
      setReadinessError('Unable to load readiness tasks from server');
    } finally {
      setIsLoadingReadiness(false);
    }
  }, []);

  // Load Database-backed Clinical Observations for selected emergency
  const loadClinicalObservations = useCallback(async (emergencyId: string) => {
    setIsLoadingObservations(true);
    try {
      const observations = await clinicalService.getObservations(emergencyId);
      setClinicalObservations(observations);
    } catch (err: any) {
      console.warn('[HospitalDashboard] Could not fetch clinical observations:', err);
    } finally {
      setIsLoadingObservations(false);
    }
  }, []);

  // Sync selected emergency changes
  useEffect(() => {
    if (selectedEmergency?.id) {
      loadReadiness(selectedEmergency.id);
      loadClinicalObservations(selectedEmergency.id);
    } else {
      setReadinessState(null);
      setClinicalObservations([]);
    }
  }, [selectedEmergency?.id, loadReadiness, loadClinicalObservations]);

  // Real-time subscription to clinical observation updates
  useEffect(() => {
    if (!selectedEmergency?.id) return;
    const unsub = realtimeService.on('clinical_observation_updated', (event: any) => {
      if (event?.incident_id === selectedEmergency.id) {
        loadClinicalObservations(selectedEmergency.id);
      }
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [selectedEmergency?.id, loadClinicalObservations]);

  // Initial load
  useEffect(() => {
    loadHospitalData();
  }, [loadHospitalData]);

  // Real-time subscription to emergency incidents
  useEffect(() => {
    if (!hospital?.name) return;

    realtimeService.initialize();

    const unsub = realtimeService.on('incidents_updated', (updatedIncidents: any[]) => {
      // Filter incidents for this hospital with authorized active states
      const activeForHospital = updatedIncidents
        .filter(i => 
          i.destination_hospital?.toLowerCase() === hospital.name.toLowerCase() &&
          ['active', 'dispatched', 'en_route', 'rerouting', 'arrived'].includes((i.status || '').toLowerCase())
        )
        .map(i => {
          const patient = parsePatientData(i);
          const activeDuration = i.traffic_duration_seconds != null ? i.traffic_duration_seconds : i.route_duration_seconds;
          return {
            id: i.id,
            status: (i.status || 'ACTIVE').toUpperCase(),
            priority: patient.priority || 'CODE_RED',
            category: patient.category || 'GENERAL',
            ambulanceId: i.ambulance_id || 'UNAVAILABLE',
            ambulanceDisplayName: i.ambulance_id || 'AERO ALS',
            vehicleNumber: i.ambulance_id || 'UNAVAILABLE',
            hospital: hospital,
            patient,
            currentSpeedKmH: i.current_speed != null ? Math.round(i.current_speed) : undefined,
            route: {
              etaSeconds: activeDuration,
              trafficAwareEtaSeconds: i.traffic_duration_seconds,
              isTrafficAware: i.traffic_status === 'LIVE' || i.route_provider === 'tomtom',
              trafficDelaySeconds: (i.traffic_duration_seconds && i.route_duration_seconds)
                ? Math.max(0, i.traffic_duration_seconds - i.route_duration_seconds)
                : 0,
              routeProvider: i.route_provider || 'tomtom',
              polyline: i.route_geometry || [],
              distanceMeters: i.route_distance_meters || 0
            },
            route_duration_seconds: i.route_duration_seconds,
            traffic_duration_seconds: i.traffic_duration_seconds,
            isTrafficAware: i.traffic_status === 'LIVE' || i.route_provider === 'tomtom',
            route_provider: i.route_provider || 'tomtom',
            createdAt: i.created_at
          } as Emergency;
        });

      setIncomingEmergencies(activeForHospital);

      // Re-anchor or update selected emergency
      setSelectedEmergency(prev => {
        if (!prev) return activeForHospital[0] || null;
        const matching = activeForHospital.find(m => m.id === prev.id);
        return matching || activeForHospital[0] || null;
      });
    });

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [hospital?.name]);

  // Load available specialists for assignment modal
  const handleOpenSpecialistModal = async () => {
    setShowSpecialistModal(true);
    const specialists = await hospitalService.getAvailableSpecialists();
    setAvailableSpecialists(specialists);
    if (specialists.length > 0) {
      setSelectedSpecialistName(specialists[0].name);
      setCustomSpecialty(specialists[0].role);
      setCustomContact(specialists[0].phone || '');
    }
  };

  // Assign specialist to incident
  const handleAssignSpecialistSubmit = async () => {
    if (!selectedEmergency || !selectedSpecialistName) return;
    setIsAssigningSpecialist(true);
    const res = await hospitalService.assignSpecialist(selectedEmergency.id, {
      name: selectedSpecialistName,
      specialty: customSpecialty || 'Emergency Medicine',
      contact: customContact || undefined,
      assignedBy: profile?.full_name || 'ER Desk'
    });
    setIsAssigningSpecialist(false);

    if (res.success && res.assignedSpecialist) {
      // Update local readiness state
      setReadinessState(prev => {
        if (!prev) return null;
        const updatedTasks = prev.tasks.map(t => 
          t.taskType === 'specialist_team' 
            ? { ...t, status: 'READY' as ReadinessTaskStatus, assignedTo: res.assignedSpecialist.name, updatedAt: new Date().toISOString() } 
            : t
        );
        return {
          ...prev,
          assignedSpecialist: res.assignedSpecialist,
          tasks: updatedTasks,
          lastUpdatedAt: new Date().toISOString()
        };
      });

      // Update emergency patient details
      setSelectedEmergency(prev => {
        if (!prev || !prev.patient) return prev;
        return {
          ...prev,
          patient: {
            ...prev.patient,
            leadDoctorAssigned: res.assignedSpecialist.name,
            leadDoctorSpecialty: res.assignedSpecialist.specialty,
            leadDoctorContact: res.assignedSpecialist.contact
          }
        };
      });

      setShowSpecialistModal(false);
      addToast({
        variant: 'success',
        title: 'Specialist Assigned',
        message: `${res.assignedSpecialist.name} assigned to incident. Specialist task marked READY.`
      });
    } else {
      addToast({
        variant: 'error',
        title: 'Assignment Failed',
        message: res.error || 'Could not assign specialist'
      });
    }
  };

  // Interactive Task Status Transition
  const handleTaskStatusChange = async (taskId: string, newStatus: ReadinessTaskStatus) => {
    if (!selectedEmergency || !readinessState) return;

    // Optimistic UI update
    const previousTasks = [...readinessState.tasks];
    const updatedTasks = readinessState.tasks.map(task => 
      task.id === taskId 
        ? { ...task, status: newStatus, updatedAt: new Date().toISOString() } 
        : task
    );
    setReadinessState({ ...readinessState, tasks: updatedTasks });

    const currentTask = readinessState.tasks.find(t => t.id === taskId);
    const res = await hospitalService.updateReadinessTask(
      selectedEmergency.id,
      taskId,
      newStatus,
      undefined,
      currentTask?.assignedTo || undefined,
      profile?.full_name || 'ER Operator'
    );

    if (res.success) {
      addToast({
        variant: 'success',
        title: 'Task Status Updated',
        message: `${currentTask?.title || 'Task'} marked ${newStatus}.`
      });
    } else {
      // Rollback on failure
      setReadinessState({ ...readinessState, tasks: previousTasks });
      addToast({
        variant: 'error',
        title: 'Update Failed',
        message: res.error || 'Could not persist status change to backend.'
      });
    }
  };

  // Readiness Confirmation with Strict Validation of Mandatory Tasks
  const handleConfirmReadiness = async () => {
    if (!selectedEmergency || !readinessState) return;

    // Validate mandatory tasks
    const unreadyMandatory = readinessState.tasks.filter(
      t => t.isMandatory && t.status !== 'READY'
    );

    if (unreadyMandatory.length > 0) {
      const taskNames = unreadyMandatory.map(t => t.title).join(', ');
      setReadinessError(`Mandatory readiness requirements unfulfilled: ${taskNames} must be set to READY.`);
      addToast({
        variant: 'error',
        title: 'Readiness Incomplete',
        message: `Cannot confirm ER readiness. Mandatory tasks (${taskNames}) are not READY.`
      });
      return;
    }

    setReadinessError(null);
    setIsConfirmingReadiness(true);

    const userName = profile?.full_name || 'Hospital ER Duty Lead';
    const result = await hospitalService.confirmBayReadiness(selectedEmergency.id, userName);

    setIsConfirmingReadiness(false);

    if (result.success) {
      // Also persist status transition to READY in emergency_incidents
      clinicalService.updateHospitalStatus(selectedEmergency.id, {
        status: 'READY',
        hospitalStatus: 'READY',
        notes: `ER Bay primed & confirmed ready by ${userName}`
      }).catch(err => console.warn('[HospitalDashboard] Non-fatal READY sync error:', err));

      setSelectedEmergency(prev => prev ? ({ ...prev, status: 'READY' as any }) : null);
      setIncomingEmergencies(prev => prev.map(emg => emg.id === selectedEmergency.id ? ({ ...emg, status: 'READY' as any }) : emg));

      setReadinessState(prev => {
        if (!prev) return null;
        return {
          ...prev,
          hospitalStatus: 'READY',
          bayReadinessConfirmed: true,
          confirmedAt: result.confirmedAt || new Date().toISOString(),
          confirmedBy: userName
        };
      });

      addToast({
        variant: 'success',
        title: 'ER Bay Readiness Confirmed',
        message: `Hospital readiness confirmed and synchronized with AERO network. Ambulance crew alerted.`
      });
    } else {
      setReadinessError(result.error || 'Failed to confirm readiness with server.');
      addToast({
        variant: 'error',
        title: 'Confirmation Failed',
        message: result.error || 'Validation error during readiness confirmation.'
      });
    }
  };

  // Persistent Hospital Incident Status Transitions (Acknowledge, Ready, Arrive, Handover)
  const handleUpdateHospitalLifecycle = async (
    newStatus: 'ACCEPTED' | 'READY' | 'arrived' | 'resolved', 
    actionLabel: string
  ) => {
    if (!selectedEmergency) return;
    setStatusActionLoading(newStatus);
    try {
      const res = await clinicalService.updateHospitalStatus(selectedEmergency.id, {
        status: newStatus,
        notes: `Hospital action: ${actionLabel} by ${profile?.full_name || 'ER Staff'}`
      });

      if (res.success) {
        const updatedStatus = (res.incident?.status || newStatus).toUpperCase();
        setSelectedEmergency(prev => prev ? { ...prev, status: updatedStatus } : null);
        setIncomingEmergencies(prev => prev.map(emg => emg.id === selectedEmergency.id ? { ...emg, status: updatedStatus } : emg));
        
        if (newStatus === 'READY') {
          setReadinessState(prev => prev ? { ...prev, hospitalStatus: 'READY', bayReadinessConfirmed: true } : null);
        }

        addToast({
          variant: 'success',
          title: 'Emergency Status Updated',
          message: `Status transitioned to ${updatedStatus} and broadcast to ambulance crew.`
        });

        if (newStatus === 'resolved') {
          loadHospitalData();
        }
      } else {
        addToast({
          variant: 'error',
          title: 'Action Failed',
          message: res.error || 'Server rejected status transition.'
        });
      }
    } catch (err: any) {
      addToast({
        variant: 'error',
        title: 'Action Error',
        message: err.message || 'Failed to update hospital status.'
      });
    } finally {
      setStatusActionLoading(null);
    }
  };

  // Capacity Handlers
  const handleEditCapacity = () => {
    setEditCapacities({
      icu: hospital?.availableIcuBeds || 0,
      trauma: hospital?.traumaBaysAvailable || 0,
      doctors: hospital?.doctorsOnDuty || 0
    });
    setIsEditingCapacity(true);
  };

  const handleSaveCapacity = async () => {
    setIsEditingCapacity(false);
    if (!hospital) return;
    
    setHospital(prev => prev ? { 
      ...prev, 
      availableIcuBeds: editCapacities.icu, 
      traumaBaysAvailable: editCapacities.trauma, 
      doctorsOnDuty: editCapacities.doctors 
    } : null);
    
    await hospitalService.updateHospitalCapacity(hospital.id, {
      availableIcuBeds: editCapacities.icu,
      traumaBaysAvailable: editCapacities.trauma
    });
    
    addToast({ variant: 'success', title: 'Capacity Updated', message: 'Hospital facility metrics saved to database.' });
  };

  // Priority and Severity formatting
  const getSeverityBadge = (priority?: EmergencyPriority) => {
    switch (priority) {
      case 'CODE_RED':
        return <Badge variant="danger" size="sm">CRITICAL / CODE RED</Badge>;
      case 'CODE_AMBER':
        return <Badge variant="warning" size="sm">HIGH / CODE AMBER</Badge>;
      case 'CODE_YELLOW':
        return <Badge variant="warning" size="sm">MEDIUM / CODE YELLOW</Badge>;
      default:
        return <Badge variant="neutral" size="sm">ROUTINE</Badge>;
    }
  };

  // Task Status color helper
  const getTaskStatusBadge = (status: ReadinessTaskStatus) => {
    switch (status) {
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-[#20D67A]/15 text-[#20D67A] border border-[#20D67A]/30">
            <CheckCircle2 className="w-3 h-3" /> READY
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-[#35C7FF]/15 text-[#35C7FF] border border-[#35C7FF]/30">
            <Activity className="w-3 h-3 animate-pulse" /> IN PROGRESS
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-[#FF3B30]/15 text-[#FF3B30] border border-[#FF3B30]/30">
            <AlertCircle className="w-3 h-3" /> BLOCKED
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
            <Clock className="w-3 h-3" /> PENDING
          </span>
        );
    }
  };

  if (!hospital) {
    return (
      <div className="min-h-dvh bg-[#07090C] flex flex-col items-center justify-center text-slate-400 p-6 text-center">
        <HospitalIcon className="w-10 h-10 text-slate-600 mb-3 animate-pulse" />
        <h1 className="text-base font-bold text-slate-200 tracking-tight">Hospital Emergency Operations</h1>
        <p className="text-xs text-slate-400 font-medium mt-1">Connecting to hospital emergency department database...</p>
      </div>
    );
  }

  const mapCenter: [number, number] = [hospital.location.latitude, hospital.location.longitude];
  const activeEtaSeconds = selectedEmergency?.route_duration_seconds ?? selectedEmergency?.route?.etaSeconds;
  const etaMinutes = activeEtaSeconds != null ? Math.floor(activeEtaSeconds / 60) : null;
  const etaSecondsDisplay = activeEtaSeconds != null ? activeEtaSeconds % 60 : null;

  // Derive vitals with preference for latest pre-hospital clinical assessment
  const latestObservation = clinicalObservations[0] || null;
  const observationVitals = latestObservation ? {
    heartRate: latestObservation.heart_rate,
    bloodPressure: (latestObservation.systolic_bp && latestObservation.diastolic_bp)
      ? `${latestObservation.systolic_bp}/${latestObservation.diastolic_bp}`
      : null,
    spo2: latestObservation.spo2,
    respiratoryRate: latestObservation.respiratory_rate,
    gcsScore: latestObservation.gcs,
    temperature: latestObservation.temperature,
    sourceDevice: latestObservation.is_manual ? 'Paramedic Assessment (Manual Entry)' : (latestObservation.source_device || 'En-route ALS Monitor'),
    measuredAt: latestObservation.recorded_at || latestObservation.created_at,
    isManual: latestObservation.is_manual,
    notes: latestObservation.clinical_notes,
    category: latestObservation.emergency_category,
    severity: latestObservation.triage_severity,
    observedBy: latestObservation.recorded_by_name
  } : null;

  const vitals = observationVitals || selectedEmergency?.patient?.vitals;
  const hasTelemetry = !!vitals && (
    vitals.heartRate != null || 
    vitals.bloodPressure != null || 
    vitals.spo2 != null || 
    vitals.respiratoryRate != null || 
    vitals.gcsScore != null
  );

  const missingVitals: string[] = [];
  if (!vitals || vitals.heartRate == null) missingVitals.push('Heart Rate');
  if (!vitals || !vitals.bloodPressure) missingVitals.push('Blood Pressure');
  if (!vitals || vitals.spo2 == null) missingVitals.push('SpO2');
  if (!vitals || vitals.respiratoryRate == null) missingVitals.push('Resp Rate');
  if (!vitals || vitals.gcsScore == null) missingVitals.push('GCS');

  const isConfirmedReady = readinessState?.bayReadinessConfirmed || readinessState?.hospitalStatus === 'READY';
  const mandatoryTasks = readinessState?.tasks.filter(t => t.isMandatory) || [];
  const allMandatoryReady = mandatoryTasks.length > 0 && mandatoryTasks.every(t => t.status === 'READY');

  return (
    <AppShell userRole="HOSPITAL" userName={hospital.name} connectionState={connectionState}>
      <div className="flex flex-col lg:flex-row h-full overflow-hidden bg-[#07090C] text-slate-100">
        
        {/* Left Side: Map & Incoming Ambulances Stream */}
        <div className="flex-1 flex flex-col min-h-0 border-r border-[#1E293B]">
          
          {/* Top ER Header Status Bar */}
          <div className="relative z-30 bg-[#0D111A] px-4 py-3 border-b border-[#1E293B] flex items-center justify-between shrink-0 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-100 tracking-tight">{hospital.name}</h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/25 tracking-wider uppercase">
                  TRAUMA CENTRE
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                Emergency & Critical Care Dispatch Coordination
              </p>
            </div>

            {/* Capacity Indicators */}
            <div className="hidden sm:flex items-center gap-2.5">
              {isEditingCapacity ? (
                <div className="flex items-center gap-2 bg-[#131826] p-1.5 rounded-lg border border-[#1E293B]">
                  <div className="text-center px-2">
                    <span className="block text-[9px] uppercase font-bold text-slate-400">ICU</span>
                    <input 
                      type="number" 
                      min="0" 
                      value={editCapacities.icu} 
                      onChange={e => setEditCapacities(p => ({ ...p, icu: parseInt(e.target.value) || 0 }))} 
                      className="w-12 text-xs font-bold text-[#20D67A] bg-transparent border-b border-[#20D67A]/50 focus:outline-none text-center" 
                    />
                  </div>
                  <div className="text-center px-2">
                    <span className="block text-[9px] uppercase font-bold text-slate-400">Trauma</span>
                    <input 
                      type="number" 
                      min="0" 
                      value={editCapacities.trauma} 
                      onChange={e => setEditCapacities(p => ({ ...p, trauma: parseInt(e.target.value) || 0 }))} 
                      className="w-12 text-xs font-bold text-[#35C7FF] bg-transparent border-b border-[#35C7FF]/50 focus:outline-none text-center" 
                    />
                  </div>
                  <button 
                    onClick={handleSaveCapacity} 
                    className="flex items-center gap-1 bg-[#20D67A]/20 hover:bg-[#20D67A]/30 text-[#20D67A] px-2.5 py-1 rounded text-xs font-semibold transition-colors border border-[#20D67A]/30"
                  >
                    <Save className="w-3 h-3" /> Save
                  </button>
                  <button 
                    onClick={() => setIsEditingCapacity(false)} 
                    className="text-slate-400 hover:text-slate-200 px-1 py-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div 
                    onClick={handleEditCapacity}
                    title="Click to update verified capacity"
                    className="bg-[#131826] border border-[#1E293B] hover:border-slate-600 px-3 py-1.5 rounded-lg text-center cursor-pointer transition-colors"
                  >
                    <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-bold">ICU Beds Free</span>
                    <span className="text-xs font-bold text-[#20D67A]">{hospital.availableIcuBeds ?? '—'} Available</span>
                  </div>
                  <div 
                    onClick={handleEditCapacity}
                    title="Click to update verified capacity"
                    className="bg-[#131826] border border-[#1E293B] hover:border-slate-600 px-3 py-1.5 rounded-lg text-center cursor-pointer transition-colors"
                  >
                    <span className="block text-[9px] uppercase tracking-wider text-slate-400 font-bold">Trauma Bays</span>
                    <span className="text-xs font-bold text-[#35C7FF]">{hospital.traumaBaysAvailable ?? '—'} Ready</span>
                  </div>
                  <button 
                    onClick={handleEditCapacity}
                    className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg border border-[#1E293B] hover:bg-[#131826]"
                    title="Edit capacity metrics"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Live TomTom Map Area */}
          <div className="flex-1 relative min-h-[280px] bg-slate-900">
            <MapView center={mapCenter} zoom={14}>
              <HospitalMarker
                position={[hospital.location.latitude, hospital.location.longitude]}
                name={hospital.name}
                availableIcuBeds={hospital.availableIcuBeds}
                traumaBaysAvailable={hospital.traumaBaysAvailable}
              />
              {selectedEmergency && (
                <>
                  <AmbulanceMarker
                    position={
                      selectedEmergency.route?.polyline?.[0] || 
                      [hospital.location.latitude, hospital.location.longitude]
                    }
                    label={selectedEmergency.ambulanceDisplayName}
                    speedKmH={selectedEmergency.currentSpeedKmH != null ? selectedEmergency.currentSpeedKmH : undefined}
                    vehicleNumber={selectedEmergency.vehicleNumber}
                  />
                  <RoutePolyline
                    positions={selectedEmergency.route?.polyline || []}
                    congestionSegments={selectedEmergency.route?.congestionSegments}
                    active
                  />
                </>
              )}
            </MapView>

            {/* Floating Live Arrival Countdown Overlay */}
            {selectedEmergency && (
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="absolute top-4 left-4 z-30 bg-[#0D111A]/95 backdrop-blur-md border border-[#1E293B] rounded-xl p-3 shadow-xl flex items-center gap-3.5 max-w-sm"
              >
                <div className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/25 flex items-center justify-center text-lg shrink-0">
                  🚑
                </div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                      INCOMING UNIT
                    </span>
                    {selectedEmergency.isTrafficAware ? (
                      <span className="text-[8px] bg-emerald-500/15 text-emerald-400 px-1 py-0.5 rounded border border-emerald-500/25 font-bold tracking-wider">
                        TOMTOM LIVE TRAFFIC
                      </span>
                    ) : (
                      <span className="text-[8px] bg-slate-800 text-slate-400 px-1 py-0.5 rounded border border-slate-700 font-bold">
                        STANDARD ESTIMATE
                      </span>
                    )}
                  </div>
                  <div className="text-lg font-bold font-mono text-slate-100 tabular-nums">
                    {etaMinutes != null && etaSecondsDisplay != null 
                      ? `${etaMinutes}m ${etaSecondsDisplay.toString().padStart(2, '0')}s` 
                      : 'ETA CALCULATING...'}
                    <span className="text-xs font-medium text-slate-400 ml-2 font-sans">
                      ({selectedEmergency.currentSpeedKmH != null ? `${selectedEmergency.currentSpeedKmH} km/h` : 'Telemetry active'})
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Incoming Active Queue Horizontal Bar */}
          <div className="bg-[#0D111A] border-t border-[#1E293B] p-3 shrink-0 overflow-x-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Authorized Active Emergencies ({incomingEmergencies.length})
              </p>
              <span className="text-[10px] text-slate-500 font-medium">Real-time DB synced</span>
            </div>
            
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {incomingEmergencies.length === 0 ? (
                <div className="text-xs text-slate-500 py-1 font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>No active incoming ambulance dispatches routed to {hospital.name} at this time.</span>
                </div>
              ) : (
                incomingEmergencies.map((emg) => {
                  const isSelected = selectedEmergency?.id === emg.id;
                  const complaint = emg.patient?.chiefComplaint || 'Emergency corridor active';
                  return (
                    <button
                      key={emg.id}
                      onClick={() => setSelectedEmergency(emg)}
                      className={`px-3 py-2 rounded-lg border text-left transition-all shrink-0 min-w-[210px] max-w-[260px] ${
                        isSelected
                          ? 'bg-[#131826] border-red-500/50 shadow-md ring-1 ring-red-500/20'
                          : 'bg-[#07090C] border-[#1E293B] hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-bold text-slate-200 truncate">
                          {emg.ambulanceDisplayName}
                        </span>
                        {getSeverityBadge(emg.priority)}
                      </div>
                      <p className="text-[11px] text-slate-400 truncate leading-snug">
                        {complaint}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1.5 pt-1 border-t border-[#1E293B]">
                        <span>Status: <strong className="text-slate-300 font-semibold">{emg.status}</strong></span>
                        <span className="font-mono text-slate-400">
                          {emg.route?.etaSeconds != null ? `${Math.round(emg.route.etaSeconds / 60)}m ETA` : ''}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Patient Triage & Hospital Preparation Checklist */}
        <div className="w-full lg:w-[460px] bg-[#07090C] flex flex-col shrink-0 overflow-y-auto p-4 space-y-4 border-l border-[#1E293B]">
          
          <AnimatePresence mode="wait">
            {selectedEmergency ? (
              <motion.div 
                key={selectedEmergency.id}
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                className="space-y-4"
              >
                {/* 1. Patient Triage Card */}
                <div className="bg-[#0D111A] border border-[#1E293B] rounded-xl p-4 shadow-sm">
                  {/* Header: Category & Priority */}
                  <div className="flex items-start justify-between border-b border-[#1E293B] pb-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          PATIENT TRIAGE & INCIDENT
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          ID: {selectedEmergency.id.slice(0, 8)}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <span>{selectedEmergency.patient?.name || 'Patient identity pending verification'}</span>
                      </h3>
                      <p className="text-xs text-slate-400 font-medium mt-0.5">
                        {selectedEmergency.patient?.age != null ? `${selectedEmergency.patient.age} yrs` : 'Age: Not provided'} 
                        {' • '}
                        {selectedEmergency.patient?.gender ? (selectedEmergency.patient.gender === 'M' ? 'Male' : selectedEmergency.patient.gender === 'F' ? 'Female' : selectedEmergency.patient.gender) : 'Gender: Not provided'}
                        {' • '}
                        Category: <strong className="text-red-400 font-semibold">{selectedEmergency.category || selectedEmergency.patient?.category || 'GENERAL'}</strong>
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      {getSeverityBadge(selectedEmergency.priority)}
                      <span className="text-[10px] text-slate-400 font-mono">
                        Status: <span className="text-emerald-400 font-bold">{selectedEmergency.status}</span>
                      </span>
                    </div>
                  </div>

                  {/* Chief Complaint */}
                  <div className="bg-[#131826] p-3 rounded-lg border border-[#1E293B] mb-3">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Verified Chief Complaint / Incident Detail
                    </span>
                    <p className="text-xs text-slate-200 font-medium leading-relaxed">
                      {selectedEmergency.patient?.chiefComplaint || (
                        <span className="text-slate-500 italic">No chief complaint documented by crew</span>
                      )}
                    </p>
                  </div>

                  {/* Paramedic Field Notes if provided */}
                  {selectedEmergency.patient?.paramedicNotes && (
                    <div className="bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-lg mb-3">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-0.5">
                        Paramedic Field Telemetry Notes
                      </span>
                      <p className="text-xs text-slate-200 font-medium">
                        {selectedEmergency.patient.paramedicNotes}
                      </p>
                    </div>
                  )}

                  {/* 2. Live Vitals Grid */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-blue-400" />
                        Clinical Telemetry Vitals
                      </span>
                      <div className="flex items-center gap-1.5">
                        {latestObservation?.is_manual ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 rounded">
                            PARAMEDIC MANUAL ENTRY
                          </span>
                        ) : hasTelemetry ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                            <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE TELEMETRY
                          </span>
                        ) : (
                          <span className="text-[9px] font-medium text-slate-500 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700">
                            AWAITING TRANSMISSION
                          </span>
                        )}
                        {isLoadingObservations ? (
                          <span className="text-[9px] font-mono text-cyan-400 animate-pulse">
                            Syncing...
                          </span>
                        ) : clinicalObservations.length > 0 ? (
                          <span className="text-[9px] font-mono text-slate-500">
                            ({clinicalObservations.length} logged)
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {/* Heart Rate */}
                      <div className="bg-[#131826] p-2.5 rounded-lg border border-[#1E293B] text-center">
                        <span className="block text-[10px] font-semibold text-slate-400 mb-1 flex items-center justify-center gap-1">
                          <Heart className="w-3 h-3 text-red-400" /> Heart Rate
                        </span>
                        {vitals?.heartRate != null ? (
                          <div className="text-sm font-bold text-red-400 font-mono">
                            {vitals.heartRate} <span className="text-[10px] font-sans font-normal text-slate-400">bpm</span>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 font-medium italic">Awaiting vitals</div>
                        )}
                      </div>

                      {/* Blood Pressure */}
                      <div className="bg-[#131826] p-2.5 rounded-lg border border-[#1E293B] text-center">
                        <span className="block text-[10px] font-semibold text-slate-400 mb-1 flex items-center justify-center gap-1">
                          <Gauge className="w-3 h-3 text-amber-400" /> Blood Pressure
                        </span>
                        {vitals?.bloodPressure ? (
                          <div className="text-sm font-bold text-amber-400 font-mono">
                            {vitals.bloodPressure} <span className="text-[10px] font-sans font-normal text-slate-400">mmHg</span>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 font-medium italic">Awaiting vitals</div>
                        )}
                      </div>

                      {/* SpO2 */}
                      <div className="bg-[#131826] p-2.5 rounded-lg border border-[#1E293B] text-center">
                        <span className="block text-[10px] font-semibold text-slate-400 mb-1 flex items-center justify-center gap-1">
                          <Wind className="w-3 h-3 text-cyan-400" /> SpO2 Oxygen
                        </span>
                        {vitals?.spo2 != null ? (
                          <div className="text-sm font-bold text-cyan-400 font-mono">
                            {vitals.spo2}%
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 font-medium italic">Awaiting vitals</div>
                        )}
                      </div>

                      {/* Respiratory Rate */}
                      <div className="bg-[#131826] p-2.5 rounded-lg border border-[#1E293B] text-center">
                        <span className="block text-[10px] font-semibold text-slate-400 mb-1 flex items-center justify-center gap-1">
                          <Activity className="w-3 h-3 text-slate-300" /> Resp. Rate
                        </span>
                        {vitals?.respiratoryRate != null ? (
                          <div className="text-sm font-bold text-slate-200 font-mono">
                            {vitals.respiratoryRate} <span className="text-[10px] font-sans font-normal text-slate-400">/min</span>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 font-medium italic">Awaiting vitals</div>
                        )}
                      </div>

                      {/* Glasgow Coma Scale */}
                      <div className="bg-[#131826] p-2.5 rounded-lg border border-[#1E293B] text-center">
                        <span className="block text-[10px] font-semibold text-slate-400 mb-1 flex items-center justify-center gap-1">
                          <Brain className="w-3 h-3 text-emerald-400" /> GCS Scale
                        </span>
                        {vitals?.gcsScore != null ? (
                          <div className="text-sm font-bold text-emerald-400 font-mono">
                            {vitals.gcsScore} <span className="text-[10px] font-sans font-normal text-slate-400">/ 15</span>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 font-medium italic">Awaiting vitals</div>
                        )}
                      </div>

                      {/* Device & Status Information */}
                      <div className="bg-[#131826] p-2.5 rounded-lg border border-[#1E293B] text-center flex flex-col justify-center">
                        <span className="block text-[10px] font-semibold text-slate-400 mb-0.5">Telemetry Source</span>
                        <div className="text-[11px] font-medium text-slate-300 truncate">
                          {vitals?.sourceDevice || 'En-route ALS Monitor'}
                        </div>
                        {vitals?.measuredAt && (
                          <span className="text-[9px] text-slate-500">
                            {new Date(vitals.measuredAt).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Missing Vitals / Paramedic Assessment Status Banner */}
                    {missingVitals.length > 0 && (
                      <div className="mt-2 text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>
                            Awaiting crew vitals: <strong>{missingVitals.join(', ')}</strong>
                          </span>
                        </div>
                        <span className="text-[9px] text-slate-400 italic">SOS & routing unaffected</span>
                      </div>
                    )}

                    {/* Paramedic Clinical Assessment Notes if available */}
                    {latestObservation?.clinical_notes && (
                      <div className="mt-2 bg-[#131826] p-2.5 rounded-lg border border-[#1E293B]">
                        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                          Paramedic Clinical Notes ({latestObservation.recorded_by_name || 'En-route Crew'})
                        </span>
                        <p className="text-xs text-slate-200 font-medium leading-relaxed">
                          {latestObservation.clinical_notes}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 3. Responsible Specialist & Clinical Information */}
                  <div className="mt-4 pt-3 border-t border-[#1E293B]">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Assigned Lead ER Specialist
                        </span>
                        {selectedEmergency.patient?.leadDoctorAssigned || readinessState?.assignedSpecialist ? (
                          <div className="mt-0.5">
                            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                              <Stethoscope className="w-3.5 h-3.5" />
                              {readinessState?.assignedSpecialist?.name || selectedEmergency.patient?.leadDoctorAssigned}
                            </span>
                            <p className="text-[10px] text-slate-400">
                              {readinessState?.assignedSpecialist?.specialty || selectedEmergency.patient?.leadDoctorSpecialty || 'Clinical Specialist'}
                              {(readinessState?.assignedSpecialist?.contact || selectedEmergency.patient?.leadDoctorContact) && (
                                <span className="ml-1 text-slate-500 font-mono">
                                  • {readinessState?.assignedSpecialist?.contact || selectedEmergency.patient?.leadDoctorContact}
                                </span>
                              )}
                            </p>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 font-medium italic mt-0.5">
                            No specialist assigned yet
                          </div>
                        )}
                      </div>

                      <button
                        onClick={handleOpenSpecialistModal}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#131826] hover:bg-[#1E293B] text-slate-200 border border-[#1E293B] hover:border-slate-600 transition-colors flex items-center gap-1.5"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                        {selectedEmergency.patient?.leadDoctorAssigned || readinessState?.assignedSpecialist ? 'Reassign' : 'Assign Specialist'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2. ER Clinical Coordination Lifecycle Actions */}
                <div className="bg-[#0D111A] border border-[#1E293B] rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E293B]">
                    <div>
                      <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-cyan-400" />
                        ER Lifecycle Coordination
                      </h3>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                        Synchronized status transitions persisted to database and broadcast to crew
                      </p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                      STATUS: {selectedEmergency.status}
                    </span>
                  </div>

                  {/* 4 Sequential Lifecycle Steps */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Step 1: Acknowledge */}
                    <button
                      onClick={() => handleUpdateHospitalLifecycle('ACCEPTED', 'Acknowledge Incoming Emergency')}
                      disabled={statusActionLoading !== null || ['ACCEPTED', 'READY', 'ARRIVED', 'RESOLVED'].includes(selectedEmergency.status)}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
                        ['ACCEPTED', 'READY', 'ARRIVED', 'RESOLVED'].includes(selectedEmergency.status)
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-default'
                          : 'bg-[#131826] border-[#1E293B] hover:border-blue-500 text-slate-200 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span>1. Acknowledge Alert</span>
                        {['ACCEPTED', 'READY', 'ARRIVED', 'RESOLVED'].includes(selectedEmergency.status) ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : statusActionLoading === 'ACCEPTED' ? (
                          <Activity className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        ) : (
                          <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                        )}
                      </div>
                      <span className="text-[9px] text-slate-400 mt-1">
                        {['ACCEPTED', 'READY', 'ARRIVED', 'RESOLVED'].includes(selectedEmergency.status) ? 'Confirmed by ER desk' : 'Confirm incoming reception'}
                      </span>
                    </button>

                    {/* Step 2: Bay Ready */}
                    <button
                      onClick={handleConfirmReadiness}
                      disabled={statusActionLoading !== null || isConfirmedReady || isConfirmingReadiness}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
                        isConfirmedReady || ['READY', 'ARRIVED', 'RESOLVED'].includes(selectedEmergency.status)
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-default'
                          : allMandatoryReady
                            ? 'bg-blue-500/10 border-blue-500/30 hover:border-blue-400 text-blue-200 cursor-pointer'
                            : 'bg-[#131826] border-[#1E293B] text-slate-400 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span>2. Confirm Bay Ready</span>
                        {isConfirmedReady || ['READY', 'ARRIVED', 'RESOLVED'].includes(selectedEmergency.status) ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : isConfirmingReadiness ? (
                          <Activity className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                        ) : (
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                      </div>
                      <span className="text-[9px] text-slate-400 mt-1">
                        {isConfirmedReady ? 'Bay primed & team alerted' : allMandatoryReady ? 'Ready for confirmation' : 'Requires checklist ready'}
                      </span>
                    </button>

                    {/* Step 3: Arrived */}
                    <button
                      onClick={() => handleUpdateHospitalLifecycle('arrived', 'Confirm Ambulance Bay Arrival')}
                      disabled={statusActionLoading !== null || ['ARRIVED', 'RESOLVED'].includes(selectedEmergency.status)}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
                        ['ARRIVED', 'RESOLVED'].includes(selectedEmergency.status)
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-default'
                          : ['ACCEPTED', 'READY'].includes(selectedEmergency.status)
                            ? 'bg-[#131826] border-[#1E293B] hover:border-purple-500 text-slate-200 cursor-pointer'
                            : 'bg-[#131826]/50 border-[#1E293B] text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span>3. Ambulance Arrival</span>
                        {['ARRIVED', 'RESOLVED'].includes(selectedEmergency.status) ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : statusActionLoading === 'arrived' ? (
                          <Activity className="w-3.5 h-3.5 animate-spin text-purple-400" />
                        ) : (
                          <Radio className="w-3.5 h-3.5 text-purple-400" />
                        )}
                      </div>
                      <span className="text-[9px] text-slate-400 mt-1">
                        {['ARRIVED', 'RESOLVED'].includes(selectedEmergency.status) ? 'Vehicle at bay' : 'Mark arrival at bay'}
                      </span>
                    </button>

                    {/* Step 4: Handover */}
                    <button
                      onClick={() => handleUpdateHospitalLifecycle('resolved', 'Complete Clinical Handover & Transfer')}
                      disabled={statusActionLoading !== null || (selectedEmergency.status as string) === 'RESOLVED' || !['ARRIVED', 'arrived'].includes(selectedEmergency.status.toLowerCase())}
                      className={`p-2.5 rounded-lg border text-left flex flex-col justify-between transition-all ${
                        (selectedEmergency.status as string) === 'RESOLVED'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 cursor-default'
                          : ['ARRIVED', 'arrived'].includes(selectedEmergency.status.toLowerCase())
                            ? 'bg-amber-500/10 border-amber-500/30 hover:border-amber-400 text-amber-200 cursor-pointer'
                            : 'bg-[#131826]/50 border-[#1E293B] text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-bold">
                        <span>4. Complete Handover</span>
                        {(selectedEmergency.status as string) === 'RESOLVED' ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : statusActionLoading === 'resolved' ? (
                          <Activity className="w-3.5 h-3.5 animate-spin text-amber-400" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-amber-400" />
                        )}
                      </div>
                      <span className="text-[9px] text-slate-400 mt-1">
                        {(selectedEmergency.status as string) === 'RESOLVED' ? 'Care transferred' : 'Sign off patient transfer'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* 4. Database-Backed ER Preparation Checklist */}
                <div className="bg-[#0D111A] border border-[#1E293B] rounded-xl p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#1E293B]">
                    <div>
                      <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        ER Preparation Checklist
                      </h3>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                        Database-verified readiness tasks • Status updates require staff authorization
                      </p>
                    </div>
                    {isLoadingReadiness && (
                      <span className="text-[10px] font-mono text-slate-500 animate-pulse">Syncing...</span>
                    )}
                  </div>

                  {/* Readiness Tasks List */}
                  <div className="space-y-2.5">
                    {readinessState?.tasks.map((task) => {
                      return (
                        <div 
                          key={task.id}
                          className="p-3 rounded-lg bg-[#131826] border border-[#1E293B] hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-xs font-bold text-slate-200">
                                  {task.title}
                                </span>
                                {task.isMandatory && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25">
                                    MANDATORY
                                  </span>
                                )}
                                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                                  {task.category}
                                </span>
                              </div>

                              <div className="text-[10px] text-slate-400 flex items-center gap-2 flex-wrap">
                                <span>Role: <strong className="text-slate-300 font-medium">{task.assignedTo || task.assignedRole || 'Unassigned'}</strong></span>
                                {task.updatedAt && (
                                  <span>• Updated: {new Date(task.updatedAt).toLocaleTimeString()}</span>
                                )}
                              </div>

                              {task.notes && (
                                <p className="text-[10px] text-slate-400 italic mt-1 leading-snug">
                                  {task.notes}
                                </p>
                              )}
                            </div>

                            {/* Status Selector */}
                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              {getTaskStatusBadge(task.status)}
                              
                              <div className="flex items-center gap-1 mt-1">
                                <button
                                  onClick={() => handleTaskStatusChange(task.id, 'PENDING')}
                                  title="Mark as Pending"
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                    task.status === 'PENDING' 
                                      ? 'bg-slate-700 text-white border-slate-500' 
                                      : 'bg-[#07090C] text-slate-400 border-[#1E293B] hover:text-slate-200'
                                  }`}
                                >
                                  Pending
                                </button>
                                <button
                                  onClick={() => handleTaskStatusChange(task.id, 'IN_PROGRESS')}
                                  title="Mark as In Progress"
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                    task.status === 'IN_PROGRESS' 
                                      ? 'bg-[#35C7FF]/25 text-[#35C7FF] border-[#35C7FF]/40' 
                                      : 'bg-[#07090C] text-slate-400 border-[#1E293B] hover:text-slate-200'
                                  }`}
                                >
                                  In Prog
                                </button>
                                <button
                                  onClick={() => handleTaskStatusChange(task.id, 'READY')}
                                  title="Mark as Ready"
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                    task.status === 'READY' 
                                      ? 'bg-[#20D67A]/25 text-[#20D67A] border-[#20D67A]/40' 
                                      : 'bg-[#07090C] text-slate-400 border-[#1E293B] hover:text-slate-200'
                                  }`}
                                >
                                  Ready
                                </button>
                                <button
                                  onClick={() => handleTaskStatusChange(task.id, 'BLOCKED')}
                                  title="Mark as Blocked"
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                    task.status === 'BLOCKED' 
                                      ? 'bg-[#FF3B30]/25 text-[#FF3B30] border-[#FF3B30]/40' 
                                      : 'bg-[#07090C] text-slate-400 border-[#1E293B] hover:text-slate-200'
                                  }`}
                                >
                                  Blocked
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 5. Readiness Confirmation Banner & Button */}
                  <div className="mt-4 pt-3 border-t border-[#1E293B]">
                    {readinessError && (
                      <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <strong className="block font-semibold">Verification Alert:</strong>
                          <span>{readinessError}</span>
                        </div>
                      </div>
                    )}

                    {isConfirmedReady ? (
                      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25 mb-3 text-center">
                        <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          ER RESUSCITATION BAY PRIMED & READY
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Confirmed{readinessState?.confirmedBy ? ` by ${readinessState.confirmedBy}` : ''}
                          {readinessState?.confirmedAt ? ` at ${new Date(readinessState.confirmedAt).toLocaleTimeString()}` : ''}
                          . Synchronized with ambulance navigation corridor.
                        </p>
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 mb-2 flex items-center justify-between">
                        <span>Mandatory requirements: <strong>{mandatoryTasks.filter(t => t.status === 'READY').length} / {mandatoryTasks.length} Ready</strong></span>
                        <span className={allMandatoryReady ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-medium'}>
                          {allMandatoryReady ? '✓ Requirements satisfied' : '⚠️ Unready mandatory tasks'}
                        </span>
                      </div>
                    )}

                    <button 
                      onClick={handleConfirmReadiness}
                      disabled={isConfirmingReadiness || isConfirmedReady}
                      className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold tracking-wider uppercase transition-all shadow-md flex items-center justify-center gap-2 ${
                        isConfirmedReady 
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                          : allMandatoryReady
                            ? 'bg-[#20D67A] hover:bg-[#1bb869] text-slate-950 cursor-pointer shadow-[#20D67A]/20'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 cursor-pointer'
                      }`}
                    >
                      {isConfirmingReadiness ? (
                        <>
                          <Activity className="w-4 h-4 animate-spin" />
                          VALIDATING & CONFIRMING...
                        </>
                      ) : isConfirmedReady ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          CONFIRMED ER BAY READINESS
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          CONFIRM ER BAY READINESS
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-[#0D111A] border border-[#1E293B] rounded-xl p-8 text-center"
              >
                <div className="py-12">
                  <HospitalIcon className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                    No Incoming Emergency Active
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-2 leading-relaxed max-w-xs mx-auto">
                    The ER trauma team is on standard standby. When an ambulance initiates an emergency route to {hospital.name}, verified clinical telemetry and preparation tasks will appear here.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Specialist Assignment Modal */}
      <AnimatePresence>
        {showSpecialistModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0D111A] border border-[#1E293B] rounded-xl p-5 w-full max-w-md shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#1E293B] pb-3">
                <div className="flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-slate-100">
                    Assign Emergency Specialist
                  </h3>
                </div>
                <button 
                  onClick={() => setShowSpecialistModal(false)}
                  className="text-slate-400 hover:text-slate-200 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Select Staff Doctor / Specialist
                  </label>
                  {availableSpecialists.length > 0 ? (
                    <select
                      value={selectedSpecialistName}
                      onChange={e => {
                        const spec = availableSpecialists.find(s => s.name === e.target.value);
                        setSelectedSpecialistName(e.target.value);
                        if (spec) {
                          setCustomSpecialty(spec.role);
                          setCustomContact(spec.phone || '');
                        }
                      }}
                      className="w-full bg-[#131826] border border-[#1E293B] rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    >
                      {availableSpecialists.map(s => (
                        <option key={s.id} value={s.name}>
                          {s.name} ({s.role})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input 
                      type="text" 
                      placeholder="Enter Doctor Name (e.g. Dr. Hemanth Kumar)"
                      value={selectedSpecialistName}
                      onChange={e => setSelectedSpecialistName(e.target.value)}
                      className="w-full bg-[#131826] border border-[#1E293B] rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Clinical Specialty / Department
                  </label>
                  <input 
                    type="text" 
                    placeholder="e.g. Interventional Cardiology / Trauma Surgery"
                    value={customSpecialty}
                    onChange={e => setCustomSpecialty(e.target.value)}
                    className="w-full bg-[#131826] border border-[#1E293B] rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Direct Contact / Hospital Extension
                  </label>
                  <input 
                    type="text" 
                    placeholder="e.g. Ext. 4410 / +91 98765 43210"
                    value={customContact}
                    onChange={e => setCustomContact(e.target.value)}
                    className="w-full bg-[#131826] border border-[#1E293B] rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1E293B]">
                <button
                  onClick={() => setShowSpecialistModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-[#131826] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignSpecialistSubmit}
                  disabled={!selectedSpecialistName || isAssigningSpecialist}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 transition-colors shadow-sm"
                >
                  {isAssigningSpecialist ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
