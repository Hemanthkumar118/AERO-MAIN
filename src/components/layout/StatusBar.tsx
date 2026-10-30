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

const roleLabelsShort: Record<UserRole, string> = {
  AMBULANCE: 'Ambulance',
  POLICE: 'Police',
  HOSPITAL: 'Hospital',
  ADMIN: 'Admin',
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
  const { user, profile } = useAuth();
  
  const validPropRole = (propUserRole && propUserRole !== ('UNKNOWN' as any)) ? propUserRole : null;
  const rawRole = (
    validPropRole || 
    profile?.role || 
    user?.user_metadata?.role || 
    (typeof window !== 'undefined' ? localStorage.getItem('aero-user-role') : null) || 
    'AMBULANCE'
  ).toUpperCase();
  const userRole = (['AMBULANCE', 'POLICE', 'HOSPITAL', 'ADMIN'].includes(rawRole) 
    ? rawRole 
    : rawRole.includes('AMBULANCE') ? 'AMBULANCE'
    : rawRole.includes('POLICE') || rawRole.includes('TRAFFIC') ? 'POLICE'
    : rawRole.includes('HOSPITAL') ? 'HOSPITAL'
    : rawRole === 'ADMIN' ? 'ADMIN'
    : 'AMBULANCE') as UserRole;

  const validPropName = (propUserName && propUserName !== 'Operator' && !propUserName.includes('Unknown') && propUserName !== 'Ambulance Operator')
    ? propUserName
    : null;

  const userName = 
    validPropName || 
    profile?.full_name || 
    user?.user_metadata?.full_name || 
    user?.user_metadata?.name || 
    (typeof window !== 'undefined' ? localStorage.getItem('aero-user-name') : null) || 
    (user?.email ? user.email.split('@')[0] : null) || 
    'Ambulance Operator';

  return (
    <header className="relative z-40 h-14 bg-aero-surface border-b border-aero-border flex items-center justify-between px-3 sm:px-6 shrink-0">
      {/* Left: Brand & Role */}
      <div className="flex items-center gap-2 sm:gap-4">
        <div
          onClick={() => navigate('/')}
          className="flex items-center gap-2 sm:gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
        >
          {/* AERO Logo Mark */}
          <div className="w-8 h-8 rounded-lg bg-[#EF3B3A] flex items-center justify-center shadow-[0_0_12px_rgba(229,57,53,0.4)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" fill="white" opacity="0.95"/>
              <path d="M9 12h6M12 9v6" stroke="#07090C" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-lg font-black tracking-tight text-aero-red font-sans">
            AERO
          </span>
        </div>

        {userRole && (
          <div className="flex items-center ml-1 sm:ml-2 border-l border-aero-border pl-2 sm:pl-4">
            <Badge variant={roleBadgeVariant[userRole]} size="sm">
              <span className="hidden sm:inline">{roleLabels[userRole]}</span>
              <span className="sm:hidden">{roleLabelsShort[userRole]}</span>
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
            <AccountMenu userName={userName} userRole={userRole} />
          </>
        )}
      </div>
    </header>
  );
}
