import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Heart, 
  Activity, 
  Gauge, 
  Wind, 
  Brain, 
  Thermometer, 
  AlertCircle, 
  X, 
  Send, 
  History, 
  ShieldAlert,
  Loader2
} from 'lucide-react';
import { clinicalService, type ClinicalObservation, type ClinicalObservationPayload } from '../../../services/clinicalService';
import { realtimeService } from '../../../services/realtimeService';
import { useToast } from '../../../components/ui/Toast';

interface ClinicalAssessmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentId: string;
  ambulanceId?: string;
  destinationHospital?: string;
  onObservationSaved?: (obs: ClinicalObservation) => void;
}

const CATEGORIES = [
  { id: 'TRAUMA', label: 'Trauma / Poly-Trauma', color: 'text-red-400 border-red-500/30 bg-red-500/10' },
  { id: 'CARDIAC', label: 'Cardiac Arrest / ACS', color: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
  { id: 'STROKE', label: 'Acute Stroke / CVA', color: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
  { id: 'RESPIRATORY', label: 'Respiratory Distress', color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
  { id: 'SEPSIS', label: 'Severe Sepsis / Shock', color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  { id: 'PEDIATRIC', label: 'Pediatric Emergency', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  { id: 'BURNS', label: 'Severe Burns / Inhalation', color: 'text-orange-400 border-orange-500/30 bg-orange-500/10' },
  { id: 'GENERAL_MEDICAL', label: 'General Acute Medical', color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  { id: 'OTHER', label: 'Other Emergency', color: 'text-slate-400 border-slate-500/30 bg-slate-500/10' },
];

export function ClinicalAssessmentModal({
  isOpen,
  onClose,
  incidentId,
  ambulanceId,
  destinationHospital,
  onObservationSaved
}: ClinicalAssessmentModalProps) {
  const { addToast } = useToast();

  const [emergencyCategory, setEmergencyCategory] = useState<string>('TRAUMA');
  const [triageSeverity, setTriageSeverity] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('CRITICAL');
  const [heartRate, setHeartRate] = useState<string>('');
  const [systolicBp, setSystolicBp] = useState<string>('');
  const [diastolicBp, setDiastolicBp] = useState<string>('');
  const [spo2, setSpo2] = useState<string>('');
  const [respiratoryRate, setRespiratoryRate] = useState<string>('');
  const [gcs, setGcs] = useState<string>('');
  const [temperature, setTemperature] = useState<string>('');
  const [chiefComplaint, setChiefComplaint] = useState<string>('');
  const [clinicalNotes, setClinicalNotes] = useState<string>('');

  const [history, setHistory] = useState<ClinicalObservation[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'form' | 'history'>('form');

  // Load existing observations for this incident
  useEffect(() => {
    if (!isOpen || !incidentId) return;

    let mounted = true;
    setIsLoadingHistory(true);

    clinicalService.getObservations(incidentId)
      .then(obs => {
        if (!mounted) return;
        setHistory(obs);
        // Pre-fill initial category if an earlier observation exists
        if (obs.length > 0 && obs[0].emergency_category) {
          setEmergencyCategory(obs[0].emergency_category);
          setTriageSeverity(obs[0].triage_severity);
        }
      })
      .catch(err => {
        console.warn('[Clinical Assessment] Could not fetch past observations:', err);
      })
      .finally(() => {
        if (mounted) setIsLoadingHistory(false);
      });

    return () => { mounted = false; };
  }, [isOpen, incidentId]);

  // Client-side range validation
  const validateForm = (): boolean => {
    const errs: string[] = [];

    if (heartRate) {
      const v = Number(heartRate);
      if (isNaN(v) || v < 20 || v > 300) errs.push('Heart rate must be between 20 and 300 bpm.');
    }
    if (systolicBp) {
      const v = Number(systolicBp);
      if (isNaN(v) || v < 40 || v > 300) errs.push('Systolic BP must be between 40 and 300 mmHg.');
    }
    if (diastolicBp) {
      const v = Number(diastolicBp);
      if (isNaN(v) || v < 20 || v > 200) errs.push('Diastolic BP must be between 20 and 200 mmHg.');
    }
    if (spo2) {
      const v = Number(spo2);
      if (isNaN(v) || v < 50 || v > 100) errs.push('SpO2 must be between 50% and 100%.');
    }
    if (respiratoryRate) {
      const v = Number(respiratoryRate);
      if (isNaN(v) || v < 4 || v > 80) errs.push('Respiratory rate must be between 4 and 80 breaths/min.');
    }
    if (gcs) {
      const v = Number(gcs);
      if (isNaN(v) || v < 3 || v > 15) errs.push('Glasgow Coma Scale (GCS) must be between 3 and 15.');
    }
    if (temperature) {
      const v = Number(temperature);
      if (isNaN(v) || v < 30.0 || v > 45.0) errs.push('Temperature must be between 30.0°C and 45.0°C.');
    }

    setFormErrors(errs);
    return errs.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setFormErrors([]);

    const payload: ClinicalObservationPayload = {
      ambulanceId: ambulanceId,
      hospitalName: destinationHospital,
      emergencyCategory,
      triageSeverity,
      heartRate: heartRate ? Number(heartRate) : null,
      systolicBp: systolicBp ? Number(systolicBp) : null,
      diastolicBp: diastolicBp ? Number(diastolicBp) : null,
      spo2: spo2 ? Number(spo2) : null,
      respiratoryRate: respiratoryRate ? Number(respiratoryRate) : null,
      gcs: gcs ? Number(gcs) : null,
      temperature: temperature ? Number(temperature) : null,
      chiefComplaint: chiefComplaint ? chiefComplaint.trim() : null,
      clinicalNotes: clinicalNotes ? clinicalNotes.trim() : null,
      isManual: true,
      sourceDevice: 'PARAMEDIC_MANUAL_ENTRY'
    };

    try {
      const observation = await clinicalService.recordObservation(incidentId, payload);
      
      // Broadcast real-time clinical update to the receiving hospital ER
      realtimeService.broadcastClinicalObservation(observation);

      addToast({
        variant: 'success',
        title: 'Clinical Assessment Transmitted',
        message: `Vitals & category (${emergencyCategory}) dispatched to ${destinationHospital || 'hospital trauma desk'}.`
      });

      setHistory(prev => [observation, ...prev]);
      if (onObservationSaved) onObservationSaved(observation);
      
      // Switch to history tab to confirm persistence
      setActiveTab('history');
    } catch (err: any) {
      console.error('[Clinical Assessment] Submit error:', err);
      setFormErrors([err.message || 'Failed to transmit clinical observations to hospital.']);
      addToast({
        variant: 'error',
        title: 'Transmission Failed',
        message: err.message || 'Network error transmitting vitals.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
        className="bg-[#0B101B] border border-[#1E293B] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1E293B] bg-[#0E1524] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100 tracking-wide uppercase">
                  Paramedic Clinical Assessment
                </h3>
                <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded border border-slate-700 font-semibold">
                  MANUAL OBSERVATION
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Destination: <strong className="text-cyan-400 font-semibold">{destinationHospital || 'Receiving Trauma ER'}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-[#070A10] p-0.5 rounded-lg border border-[#1E293B]">
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'form' 
                    ? 'bg-blue-600 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Entry Form
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'history' 
                    ? 'bg-blue-600 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <History className="w-3 h-3" />
                History ({history.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {formErrors.length > 0 && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold mb-0.5">Validation Requirement:</strong>
                <ul className="list-disc pl-4 space-y-0.5">
                  {formErrors.map((e, idx) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Emergency Category */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Emergency Category <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setEmergencyCategory(cat.id)}
                      className={`px-2.5 py-2 rounded-lg border text-xs font-semibold text-left transition-all ${
                        emergencyCategory === cat.id
                          ? `${cat.color} ring-1 ring-cyan-400/40 shadow-sm`
                          : 'bg-[#0E1524] border-[#1E293B] text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Triage Severity Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Initial Triage Severity
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'CRITICAL', label: 'Critical (Red)', style: 'bg-red-500/20 text-red-400 border-red-500/40' },
                    { id: 'HIGH', label: 'High (Amber)', style: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
                    { id: 'MEDIUM', label: 'Medium (Yellow)', style: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
                    { id: 'LOW', label: 'Low (Green)', style: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' },
                  ].map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setTriageSeverity(s.id as any)}
                      className={`py-2 px-1 rounded-lg border text-xs font-bold text-center transition-all ${
                        triageSeverity === s.id
                          ? `${s.style} ring-1 ring-white/20`
                          : 'bg-[#0E1524] border-[#1E293B] text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clinical Telemetry Vitals Inputs */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Physiological Vitals <span className="text-slate-500 font-normal">(Optional on Initial SOS)</span>
                  </label>
                  <span className="text-[10px] text-slate-400">Validated standard medical ranges</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {/* Heart Rate */}
                  <div className="bg-[#0E1524] p-3 rounded-xl border border-[#1E293B] focus-within:border-cyan-500/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1 font-semibold text-slate-300">
                        <Heart className="w-3.5 h-3.5 text-red-400" /> Heart Rate
                      </span>
                      <span className="text-[10px] text-slate-500">20-300</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        placeholder="--"
                        value={heartRate}
                        onChange={e => setHeartRate(e.target.value)}
                        className="w-full bg-transparent text-slate-100 font-mono font-bold text-base focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">bpm</span>
                    </div>
                  </div>

                  {/* Blood Pressure Systolic / Diastolic */}
                  <div className="bg-[#0E1524] p-3 rounded-xl border border-[#1E293B] focus-within:border-cyan-500/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1 font-semibold text-slate-300">
                        <Gauge className="w-3.5 h-3.5 text-amber-400" /> Blood Press.
                      </span>
                      <span className="text-[10px] text-slate-500">Sys / Dia</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        placeholder="Sys"
                        value={systolicBp}
                        onChange={e => setSystolicBp(e.target.value)}
                        className="w-14 bg-transparent text-slate-100 font-mono font-bold text-sm focus:outline-none"
                      />
                      <span className="text-slate-600">/</span>
                      <input
                        type="number"
                        placeholder="Dia"
                        value={diastolicBp}
                        onChange={e => setDiastolicBp(e.target.value)}
                        className="w-14 bg-transparent text-slate-100 font-mono font-bold text-sm focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 ml-auto">mmHg</span>
                    </div>
                  </div>

                  {/* SpO2 */}
                  <div className="bg-[#0E1524] p-3 rounded-xl border border-[#1E293B] focus-within:border-cyan-500/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1 font-semibold text-slate-300">
                        <Wind className="w-3.5 h-3.5 text-cyan-400" /> SpO2 O₂
                      </span>
                      <span className="text-[10px] text-slate-500">50-100%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        placeholder="--"
                        value={spo2}
                        onChange={e => setSpo2(e.target.value)}
                        className="w-full bg-transparent text-slate-100 font-mono font-bold text-base focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </div>
                  </div>

                  {/* Respiratory Rate */}
                  <div className="bg-[#0E1524] p-3 rounded-xl border border-[#1E293B] focus-within:border-cyan-500/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1 font-semibold text-slate-300">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" /> Resp. Rate
                      </span>
                      <span className="text-[10px] text-slate-500">4-80</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        placeholder="--"
                        value={respiratoryRate}
                        onChange={e => setRespiratoryRate(e.target.value)}
                        className="w-full bg-transparent text-slate-100 font-mono font-bold text-base focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">/min</span>
                    </div>
                  </div>

                  {/* Glasgow Coma Scale */}
                  <div className="bg-[#0E1524] p-3 rounded-xl border border-[#1E293B] focus-within:border-cyan-500/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1 font-semibold text-slate-300">
                        <Brain className="w-3.5 h-3.5 text-purple-400" /> GCS Scale
                      </span>
                      <span className="text-[10px] text-slate-500">3-15</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        placeholder="--"
                        value={gcs}
                        onChange={e => setGcs(e.target.value)}
                        className="w-full bg-transparent text-slate-100 font-mono font-bold text-base focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">/15</span>
                    </div>
                  </div>

                  {/* Temperature */}
                  <div className="bg-[#0E1524] p-3 rounded-xl border border-[#1E293B] focus-within:border-cyan-500/50">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span className="flex items-center gap-1 font-semibold text-slate-300">
                        <Thermometer className="w-3.5 h-3.5 text-yellow-400" /> Temp °C
                      </span>
                      <span className="text-[10px] text-slate-500">30-45°C</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="--"
                        value={temperature}
                        onChange={e => setTemperature(e.target.value)}
                        className="w-full bg-transparent text-slate-100 font-mono font-bold text-base focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">°C</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chief Complaint & Paramedic Clinical Notes */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                    Chief Complaint / Primary Symptom
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Acute substernal crushing chest pain radiating to left arm"
                    value={chiefComplaint}
                    onChange={e => setChiefComplaint(e.target.value)}
                    className="w-full bg-[#0E1524] border border-[#1E293B] rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                    Paramedic Field Notes / Interventions Given
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g., High-flow O2 initiated @ 15 L/min NRB, IV access established left AC 18G, Aspirin 325mg administered."
                    value={clinicalNotes}
                    onChange={e => setClinicalNotes(e.target.value)}
                    className="w-full bg-[#0E1524] border border-[#1E293B] rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none"
                  />
                </div>
              </div>

              {/* Disclaimer Notice */}
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>
                  Observations are manually entered by certified ambulance paramedics and transmitted directly to the assigned receiving hospital ER trauma desk.
                </span>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#1E293B]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-slate-700 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-red-500/20 flex items-center gap-2 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Transmitting to ER...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Transmit Clinical Vitals
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            /* Observation History Tab */
            <div className="space-y-3">
              {isLoadingHistory ? (
                <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                  <span>Loading clinical history...</span>
                </div>
              ) : history.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No clinical observations recorded yet for this incident.
                </div>
              ) : (
                history.map((obs, idx) => (
                  <div key={obs.id || idx} className="bg-[#0E1524] border border-[#1E293B] rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between border-b border-[#1E293B] pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                          {obs.emergency_category || 'EMERGENCY'}
                        </span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          obs.triage_severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {obs.triage_severity}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          MANUAL ENTRY
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(obs.recorded_at).toLocaleTimeString()}
                      </span>
                    </div>

                    {/* Vitals Summary */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center py-1">
                      <div className="bg-[#080D1A] p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block">HR</span>
                        <span className="text-xs font-bold text-red-400 font-mono">
                          {obs.heart_rate != null ? `${obs.heart_rate} bpm` : '--'}
                        </span>
                      </div>
                      <div className="bg-[#080D1A] p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block">BP</span>
                        <span className="text-xs font-bold text-amber-400 font-mono">
                          {obs.systolic_bp && obs.diastolic_bp ? `${obs.systolic_bp}/${obs.diastolic_bp}` : '--'}
                        </span>
                      </div>
                      <div className="bg-[#080D1A] p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block">SpO2</span>
                        <span className="text-xs font-bold text-cyan-400 font-mono">
                          {obs.spo2 != null ? `${obs.spo2}%` : '--'}
                        </span>
                      </div>
                      <div className="bg-[#080D1A] p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block">RR</span>
                        <span className="text-xs font-bold text-emerald-400 font-mono">
                          {obs.respiratory_rate != null ? `${obs.respiratory_rate}/m` : '--'}
                        </span>
                      </div>
                      <div className="bg-[#080D1A] p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block">GCS</span>
                        <span className="text-xs font-bold text-purple-400 font-mono">
                          {obs.gcs != null ? `${obs.gcs}/15` : '--'}
                        </span>
                      </div>
                      <div className="bg-[#080D1A] p-1.5 rounded">
                        <span className="text-[9px] text-slate-500 block">Temp</span>
                        <span className="text-xs font-bold text-yellow-400 font-mono">
                          {obs.temperature != null ? `${obs.temperature}°C` : '--'}
                        </span>
                      </div>
                    </div>

                    {obs.chief_complaint && (
                      <p className="text-xs text-slate-300 font-medium pt-1">
                        <strong className="text-slate-400">Complaint:</strong> {obs.chief_complaint}
                      </p>
                    )}

                    {obs.clinical_notes && (
                      <p className="text-xs text-slate-400 bg-[#080D1A] p-2 rounded border border-[#1E293B]">
                        {obs.clinical_notes}
                      </p>
                    )}

                    <div className="text-[10px] text-slate-500 pt-1 flex items-center justify-between">
                      <span>Logged by: {obs.recorded_by_name || 'Paramedic'}</span>
                      <span>Incident: {incidentId.slice(0, 8)}</span>
                    </div>
                  </div>
                ))
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActiveTab('form')}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 transition-colors"
                >
                  + Record New Observation
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
