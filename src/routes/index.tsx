import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import { LandingPage } from '../features/public/pages/LandingPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { AuthCallbackPage } from '../features/auth/pages/AuthCallbackPage';
import { AccountSettingsPage } from '../features/settings/pages/AccountSettingsPage';
import { SecurityPrivacyPage } from '../features/settings/pages/SecurityPrivacyPage';
import { EmergencyProtocolPage } from '../features/public/pages/EmergencyProtocolPage';
import { TermsOfServicePage } from '../features/public/pages/TermsOfServicePage';
import { PrivacyPolicyPage } from '../features/public/pages/PrivacyPolicyPage';

import { AmbulanceDashboard } from '../features/ambulance/pages/AmbulanceDashboard';
import { PoliceDashboard } from '../features/police/pages/PoliceDashboard';
import { ActiveEmergencyDetails } from '../features/police/pages/ActiveEmergencyDetails';
import { HospitalDashboard } from '../features/hospital/pages/HospitalDashboard';
import { AdminDashboard } from '../features/admin/pages/AdminDashboard';
import { AdminAnalytics } from '../features/admin/pages/AdminAnalytics';
import { ComponentShowcase } from '../pages/ComponentShowcase';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AIAssistant } from '../features/ai/components/AIAssistant';

export function AppRoutes() {
  const navigate = useNavigate();

  const handleLogin = (userRole: string) => {
    switch (userRole.toLowerCase()) {
      case 'ambulance_operator':
      case 'ambulance':
        navigate('/ambulance');
        break;
      case 'traffic_operator':
      case 'police':
        navigate('/police');
        break;
      case 'hospital_operator':
      case 'hospital':
        navigate('/hospital');
        break;
      case 'admin':
        navigate('/admin');
        break;
      default:
        navigate('/ambulance');
    }
  };

  const ProtectedRoute = ({ allowedRoles, children }: { allowedRoles?: string[]; children: React.ReactNode }) => {
    const { user, profile, authLoading, profileLoading, profileError, refreshProfile } = useAuth();
    const location = useLocation();

    if (authLoading || profileLoading) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-main p-4">
          <div className="w-16 h-16 rounded-full border-4 border-border-subtle border-t-[#35C7FF] animate-spin mb-4"></div>
          <h2 className="text-xl font-bold text-white">LOADING AERO ACCOUNT...</h2>
          <p className="text-text-secondary mt-2">Authenticating secure session</p>
        </div>
      );
    }

    if (profileError && !profile) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-main p-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 max-w-md text-center">
            <h2 className="text-xl font-bold text-red-500 mb-2">AERO ACCOUNT ERROR</h2>
            <p className="text-text-secondary mb-6">{profileError || "Authentication could not be initialized."}</p>
            <button 
              onClick={() => refreshProfile()}
              className="bg-bg-surface hover:bg-bg-elevated text-white px-6 py-2 rounded-lg border border-border-subtle transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (!user) {
      return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      const userRole = profile?.role?.toUpperCase();
      if (!userRole || !allowedRoles.includes(userRole)) {
        if (userRole === 'POLICE' || userRole === 'TRAFFIC_OPERATOR') {
          if (location.pathname !== '/police') return <Navigate to="/police" replace />;
        } else if (userRole === 'HOSPITAL' || userRole === 'HOSPITAL_OPERATOR') {
          if (location.pathname !== '/hospital') return <Navigate to="/hospital" replace />;
        } else if (userRole === 'ADMIN') {
          if (location.pathname !== '/admin') return <Navigate to="/admin" replace />;
        } else {
          if (location.pathname !== '/ambulance') return <Navigate to="/ambulance" replace />;
        }
        
        return (
          <div className="min-h-dvh flex flex-col items-center justify-center bg-bg-main p-4 text-center">
            <h2 className="text-xl font-bold text-red-500 mb-2">UNAUTHORIZED</h2>
            <p className="text-text-secondary">Your account role ({userRole || 'UNKNOWN'}) does not have access to this page.</p>
          </div>
        );
      }
    }

    return (
      <>
        {children}
        <AIAssistant />
      </>
    );
  };

  return (
    <Routes>
      {/* Legal & Protocol */}
      <Route path="/emergency-response-protocol" element={<EmergencyProtocolPage />} />
      <Route path="/terms-of-service" element={<TermsOfServicePage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />

      {/* Public Routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
      <Route path="/register" element={<RegisterPage onRegister={handleLogin} />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/showcase" element={<ComponentShowcase />} />

      {/* Ambulance Routes */}
      <Route
        path="/ambulance"
        element={
          <ProtectedRoute allowedRoles={['AMBULANCE_OPERATOR', 'AMBULANCE']}>
            <AmbulanceDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ambulance/sos"
        element={<Navigate to="/ambulance" replace />}
      />
      <Route
        path="/ambulance/emergency"
        element={
          <ProtectedRoute allowedRoles={['AMBULANCE_OPERATOR', 'AMBULANCE']}>
            <AmbulanceDashboard />
          </ProtectedRoute>
        }
      />

      {/* Police Routes */}
      <Route
        path="/police"
        element={
          <ProtectedRoute allowedRoles={['TRAFFIC_OPERATOR', 'POLICE']}>
            <PoliceDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/police/emergency/:id"
        element={
          <ProtectedRoute allowedRoles={['TRAFFIC_OPERATOR', 'POLICE']}>
            <ActiveEmergencyDetails />
          </ProtectedRoute>
        }
      />
      <Route
        path="/police/alerts"
        element={
          <ProtectedRoute allowedRoles={['TRAFFIC_OPERATOR', 'POLICE']}>
            <PoliceDashboard />
          </ProtectedRoute>
        }
      />

      {/* Hospital ER Routes */}
      <Route
        path="/hospital"
        element={
          <ProtectedRoute allowedRoles={['HOSPITAL_OPERATOR', 'HOSPITAL']}>
            <HospitalDashboard />
          </ProtectedRoute>
        }
      />

      {/* Admin Routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/analytics"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/emergencies"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />

      {/* Settings Routes */}
      <Route
        path="/settings/account"
        element={
          <ProtectedRoute>
            <AccountSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/security"
        element={
          <ProtectedRoute>
            <SecurityPrivacyPage />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
