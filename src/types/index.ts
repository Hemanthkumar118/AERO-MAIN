/* ============================================================
   AERO — Shared TypeScript Types
   ============================================================ */

// ── User & Auth ──
export type UserRole = 'AMBULANCE' | 'POLICE' | 'HOSPITAL' | 'ADMIN';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
  badgeNumber?: string;
  vehicleNumber?: string;
  hospitalId?: string;
  policeStation?: string;
}

// ── Emergency & Triage ──
export type EmergencyStatus = 'PENDING' | 'ACCEPTED' | 'ACTIVE' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED';
export type EmergencyPriority = 'CODE_RED' | 'CODE_AMBER' | 'CODE_YELLOW';
export type EmergencyCategory = 'CARDIAC' | 'TRAUMA' | 'STROKE' | 'RESPIRATORY' | 'OBSTETRIC' | 'PEDIATRIC' | 'GENERAL';

export interface PatientVitals {
  heartRate?: number; // bpm
  bloodPressure?: string; // e.g. "135/88"
  spo2?: number; // %
  respiratoryRate?: number; // breaths/min
  gcsScore?: number; // Glasgow Coma Scale 3-15
  measuredAt?: string;
  sourceDevice?: string;
}

export interface PatientInfo {
  name?: string;
  age?: number;
  gender?: 'M' | 'F' | 'Other';
  category: EmergencyCategory;
  priority: EmergencyPriority;
  chiefComplaint?: string;
  vitals?: PatientVitals;
  paramedicNotes?: string;
  leadDoctorAssigned?: string;
  leadDoctorSpecialty?: string;
  leadDoctorContact?: string;
}

export type ReadinessTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'READY' | 'BLOCKED';

export interface ReadinessTask {
  id: string;
  taskType: 'trauma_bay' | 'icu_bed' | 'emergency_ot' | 'blood_bank' | 'specialist_team' | string;
  title: string;
  category: 'SURGICAL' | 'CRITICAL_CARE' | 'BLOOD_BANK' | 'CLINICAL' | 'FACILITY';
  status: ReadinessTaskStatus;
  isMandatory: boolean;
  assignedTo?: string | null;
  assignedRole?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  notes?: string;
}

export interface HospitalReadinessState {
  incidentId: string;
  hospitalStatus: 'PENDING' | 'ACCEPTED' | 'READY';
  bayReadinessConfirmed: boolean;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  assignedSpecialist?: {
    id?: string;
    name: string;
    specialty?: string;
    contact?: string;
    assignedAt?: string;
  } | null;
  tasks: ReadinessTask[];
  lastUpdatedAt: string;
}

export interface HospitalPreparationState {
  traumaBayReady: boolean;
  icuBedReserved: boolean;
  otStandby: boolean;
  bloodReady: boolean;
  specialistAlerted: boolean;
}

export interface Emergency {
  id: string;
  status: EmergencyStatus;
  priority?: EmergencyPriority;
  category?: EmergencyCategory;
  ambulanceId: string;
  ambulanceDisplayName: string;
  vehicleNumber?: string;
  driverName?: string;
  driverPhone?: string;
  hospital: Hospital;
  route?: RouteInfo;
  route_distance_meters?: number;
  route_duration_seconds?: number;
  traffic_duration_seconds?: number;
  isTrafficAware?: boolean;
  route_provider?: string;
  patient?: PatientInfo;
  hospitalPrep?: HospitalPreparationState;
  readinessState?: HospitalReadinessState;
  acceptedBy?: {
    id: string;
    displayName: string;
    badgeNumber: string;
    station?: string;
  };
  notes?: string;
  currentSpeedKmH?: number;
  distanceCoveredKm?: number;
  createdAt: string;
  acceptedAt?: string;
  arrivedAt?: string;
  arrived_at?: string;
  hospital_status?: string;
  hospital_acknowledged_at?: string;
  completedAt?: string;
}

// ── Supabase Database Types ──
export type CorridorStatus = 'PENDING' | 'CLEARING' | 'CLEAR' | 'CAUTION' | 'BLOCKED';

export interface EmergencyIncident {
  id: string;
  user_id: string;
  incident_type: string;
  priority: string;
  status: string;
  ambulance_id?: string;
  latitude: number;
  longitude: number;
  destination_hospital: string;
  destination_latitude: number;
  destination_longitude: number;
  route_geometry?: any;
  route_distance_meters?: number;
  route_duration_seconds?: number;
  traffic_duration_seconds?: number;
  traffic_status?: string;
  route_provider?: string;

  route_version?: number;
  last_reroute_at?: string;
  route_updated_at?: string;
  current_latitude?: number;
  current_longitude?: number;
  current_accuracy?: number;
  current_speed?: number;
  current_heading?: number;
  corridor_status?: CorridorStatus;
  police_acknowledged_at?: string;
  police_id?: string;
  hospital_status?: string;
  hospital_acknowledged_at?: string;
  arrived_at?: string;
  arrived_by?: string;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
}

export type SOSStatus = 'IDLE' | 'VALIDATING' | 'CALCULATING_ROUTE' | 'CREATING_EMERGENCY' | 'BROADCASTING' | 'ACTIVE' | 'ARRIVED' | 'COMPLETED' | 'ABORTED' | 'ERROR';
export type CommunicationStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';

export interface SOSState {
  status: SOSStatus;
  emergencyId?: string;
  routeStatus?: 'PENDING' | 'SUCCESS' | 'ERROR';
  policeStatus?: CommunicationStatus;
  hospitalStatus?: CommunicationStatus;
  ambulanceLocation?: LatLng;
  destination?: Hospital;
  distanceMeters?: number;
  etaSeconds?: number;
  trafficAwareEtaSeconds?: number;
  isTrafficAware?: boolean;
  trafficDelaySeconds?: number;
  trafficStatus?: 'LIVE' | 'UNAVAILABLE';
  routeProvider?: 'google' | 'mapbox' | 'osrm' | 'tomtom' | string;
  speedKmH?: number;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
}

// ── Hospital ──
export interface Hospital {
  id: string;
  name: string;
  address: string;
  location: LatLng;
  phone?: string;
  emergencyCapable: boolean;
  totalBeds?: number;
  availableIcuBeds?: number;
  traumaBaysAvailable?: number;
  doctorsOnDuty?: number;
  distanceKm?: number;
}

// ── Junction & Police-Assisted Clearance ──
export type JunctionStatus = 'NORMAL' | 'PREPARING' | 'CLEARED' | 'PASSED';

export interface Junction {
  id: string;
  name: string;
  location: LatLng;
  assignedPoliceId?: string;
  assignedPoliceName?: string;
  status: JunctionStatus;
  distanceFromAmbulanceMeters?: number;
  etaSeconds?: number;
  clearedAt?: string;
}

// ── Traffic Incidents & Overlays ──
export type IncidentType = 'ACCIDENT' | 'ROAD_BLOCKAGE' | 'CONGESTION' | 'CONSTRUCTION' | 'WATERLOGGING';
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TrafficIncident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description: string;
  location: LatLng;
  reportedBy: string;
  reportedAt: string;
  active: boolean;
}

export interface TomTomIncident {
  id: string;
  category: string;
  severity: 'minor' | 'moderate' | 'major' | 'blocking' | 'unknown';
  description: string;
  delaySeconds: number;
  delayMinutes?: number;
  lengthMeters: number;
  from?: string;
  to?: string;
  startTime?: string;
  endTime?: string;
  location: LatLng;
  geometry?: [number, number][]; // [lat, lng] array
}

export type CongestionLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface CongestionSegment {
  polyline: [number, number][];
  level: CongestionLevel;
  speedLimitKmH: number;
  averageSpeedKmH: number;
}

// ── Location & Telemetry ──
export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy: number;
  heading?: number;
  speed?: number;
  deviceTimestamp: string;
}

// ── Route ──
export interface RouteInfo {
  polyline: [number, number][];
  distanceMeters: number;
  etaSeconds: number;
  trafficAwareEtaSeconds?: number;
  isTrafficAware?: boolean;
  trafficDelaySeconds?: number;
  staticEtaSeconds?: number;
  calculatedAt?: string;
  trafficStatus?: 'LIVE' | 'UNAVAILABLE' | 'MODERATE' | 'HEAVY' | 'SEVERE';
  routeProvider?: string;
  waypoints?: LatLng[];
  junctions?: Junction[];
  congestionSegments?: CongestionSegment[];
  routeIncidents?: any[];
  alternatives?: any[];
  steps?: any[];
}

// ── Police Handover / Coordination Note ──
export interface PoliceCoordinationMessage {
  id: string;
  emergencyId: string;
  fromOfficerId: string;
  fromOfficerName: string;
  toJunctionId: string;
  toJunctionName: string;
  message: string;
  timestamp: string;
}

// ── Connection State ──
export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';
export type GPSState = 'acquiring' | 'active' | 'stale' | 'unavailable' | 'permission_denied';
export type AvailabilityStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'BUSY';

// ── UI Variants ──
export type ButtonVariant = 'primary' | 'emergency' | 'success' | 'danger' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';
export type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'emergency';
export type AlertVariant = 'info' | 'success' | 'warning' | 'error' | 'emergency';
export type ToastVariant = 'info' | 'success' | 'warning' | 'error';
