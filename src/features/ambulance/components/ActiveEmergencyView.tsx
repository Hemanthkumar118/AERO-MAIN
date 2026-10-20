import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Badge } from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { supabase } from '../../../lib/supabase';
import type { EmergencyIncident } from '../../../types';

interface ActiveEmergencyViewProps {
  emergency: EmergencyIncident;
  hospitalName: string;
  onCancel: () => void;
  onComplete: () => void;
  currentSpeedKmH?: number;
}

export function ActiveEmergencyView({
  emergency,
  hospitalName,
  onCancel,
  onComplete,
  currentSpeedKmH = 0,
}: ActiveEmergencyViewProps) {
  const { addToast } = useToast();

  const handleCancel = async () => {
    const { error } = await supabase.from('emergency_incidents').update({ status: 'resolved' }).eq('id', emergency.id);
    if (!error) {
      addToast({ variant: 'info', title: 'Emergency Cancelled', message: 'The trip was aborted.' });
      onCancel();
    }
  };

  const handleComplete = async () => {
    const { error } = await supabase.from('emergency_incidents').update({ status: 'resolved' }).eq('id', emergency.id);
    if (!error) {
      addToast({ variant: 'success', title: 'Mission Completed', message: 'Patient delivered to ER.' });
      onComplete();
    }
  };

  return (
    <div className="space-y-3">
      {/* Alert Header Banner */}
      <div className="bg-aero-red-soft border border-aero-red/30 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-[0_0_15px_rgba(255,59,48,0.2)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-aero-red-soft border border-[#FF3B30]/40 flex items-center justify-center">
            <span className="w-4 h-4 rounded-full bg-aero-red animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-aero-red">EMERGENCY CORRIDOR ACTIVE</h2>
              <Badge variant="emergency" size="sm">{emergency.priority || 'CODE_RED'}</Badge>
            </div>
            <p className="text-[11px] text-aero-text-secondary font-mono mt-0.5">Trip ID: {emergency.id.substring(0, 8)}</p>
          </div>
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
          <div className="text-left sm:text-right">
            <span className="telemetry-label mb-1">Vehicle Speed</span>
            <span className="text-base font-bold text-aero-blue font-mono">{Math.round(currentSpeedKmH)} km/h</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 text-xs">
        <Card className="aero-card p-3">
          <div className="space-y-2">
            <div className="flex justify-between border-b border-aero-border pb-1.5">
              <span className="telemetry-label">Destination</span>
              <span className="font-bold text-aero-text-primary">{hospitalName}</span>
            </div>
            <div className="flex justify-between border-b border-aero-border pb-1.5">
              <span className="telemetry-label">Patient Category</span>
              <span className="font-semibold text-aero-red">{emergency.incident_type}</span>
            </div>
            <div className="flex justify-between">
              <span className="telemetry-label">Police Status</span>
              <span className={`font-semibold ${emergency.corridor_status === 'CLEAR' ? 'text-aero-green' : 'text-aero-amber'}`}>
                {emergency.corridor_status || 'PENDING'} {emergency.police_acknowledged_at ? '(Acknowledged)' : ''}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <Button variant="outline" className="w-full" onClick={handleCancel}>
          Abort Mission
        </Button>
        <Button variant="success" className="w-full" onClick={handleComplete}>
          Complete Mission
        </Button>
      </div>
    </div>
  );
}
