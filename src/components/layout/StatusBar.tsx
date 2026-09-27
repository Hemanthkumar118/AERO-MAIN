import { useNavigate } from 'react-router-dom';
import type { UserRole, ConnectionState, GPSState } from '../../types';
import { ConnectionIndicator } from '../status/ConnectionIndicator';
import { GPSIndicator } from '../status/GPSIndicator';
import { Badge } from '../ui/Badge';
import { AccountMenu } from './AccountMenu';
import { useAuth } from '../../providers/AuthProvider';

interface StatusBarProps {
  userRole?: UserRole;
  userName?: string;
  connectionState: ConnectionState;
  gpsState?: GPSState;
  gpsAccuracy?: number;
  gpsTimestamp?: Date | null;
}

const roleLabels: Record<UserRole, string> = {
  AMBULANCE: 'Ambulance Unit',
  POLICE: 'Traffic Police',
  HOSPITAL: 'Hospital ER',
  ADMIN: 'Control Center Admin',
};

const roleBadgeVariant: Record<UserRole, 'info' | 'warning' | 'emergency' | 'neutral'> = {
  AMBULANCE: 'info',
  POLICE: 'warning',
  HOSPITAL: 'emergency',
  ADMIN: 'neutral',
};

export function StatusBar({
  userRole: propUserRole,
  userName: propUserName,
  connectionState,
  gpsState,
  gpsAccuracy,
  gpsTimestamp,
}: StatusBarProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  
  const userRole = propUserRole || (profile?.role?.toUpperCase() as UserRole) || 'AMBULANCE';
  const userName = propUserName || profile?.full_name || 'Operator';

  return (
    <header className="h-14 bg-bg-surface border-b border-border-subtle flex items-center justify-between px-4 sm:px-6 shrink-0 z-50">
      {/* Left: Brand & Role */}
      <div className="flex items-center gap-3 sm:gap-4">
        <div
          onClick={() => navigate('/')}
          className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
        >
          {/* AERO Logo Mark */}
          <div className="w-8 h-8 rounded-lg bg-[#E53935] flex items-center justify-center shadow-[0_0_12px_rgba(229,57,53,0.4)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white" opacity="0.95"/>
              <path d="M9 12h6M12 9v6" stroke="#07090C" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-lg font-black tracking-tight text-white font-sans">
            AERO
          </span>
        </div>

        {userRole && (
          <div className="flex items-center ml-2 border-l border-border-subtle pl-4">
            <Badge variant={roleBadgeVariant[userRole]} size="sm">
              {roleLabels[userRole]}
            </Badge>
          </div>
        )}
      </div>

      {/* Right: Indicators & Controls */}
      <div className="flex items-center gap-3 sm:gap-4">
        {gpsState && (
          <GPSIndicator state={gpsState} accuracy={gpsAccuracy} timestamp={gpsTimestamp} />
        )}
        <ConnectionIndicator state={connectionState} />
        {userName && userRole && (
          <>
            <div className="w-px h-6 bg-border-subtle hidden sm:block mx-1" />
            <AccountMenu />
          </>
        )}
      </div>
    </header>
  );
}
