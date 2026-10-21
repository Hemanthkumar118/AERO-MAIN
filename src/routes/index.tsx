import { lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import { AIAssistant } from '../features/ai/components/AIAssistant';

// Lazy-loaded routes for code-splitting and performance
const LandingPage = lazy(() => import('../features/public/pages/LandingPage').then(m => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import('../features/auth/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('../features/auth/pages/RegisterPage').then(m => ({ default: m.RegisterPage })));
const AuthCallbackPage = lazy(() => import('../features/auth/pages/AuthCallbackPage').then(m => ({ default: m.AuthCallbackPage })));
const AccountSettingsPage = lazy(() => import('../features/settings/pages/AccountSettingsPage').then(m => ({ default: m.AccountSettingsPage })));
const SecurityPrivacyPage = lazy(() => import('../features/settings/pages/SecurityPrivacyPage').then(m => ({ default: m.SecurityPrivacyPage })));
const EmergencyProtocolPage = lazy(() => import('../features/public/pages/EmergencyProtocolPage').then(m => ({ default: m.EmergencyProtocolPage })));
const TermsOfServicePage = lazy(() => import('../features/public/pages/TermsOfServicePage').then(m => ({ default: m.TermsOfServicePage })));
const PrivacyPolicyPage = lazy(() => import('../features/public/pages/PrivacyPolicyPage').then(m => ({ default: m.PrivacyPolicyPage })));
const AmbulanceDashboard = lazy(() => import('../features/ambulance/pages/AmbulanceDashboard').then(m => ({ default: m.AmbulanceDashboard })));
const PoliceDashboard = lazy(() => import('../features/police/pages/PoliceDashboard').then(m => ({ default: m.PoliceDashboard })));
const ActiveEmergencyDetails = lazy(() => import('../features/police/pages/ActiveEmergencyDetails').then(m => ({ default: m.ActiveEmergencyDetails })));
const HospitalDashboard = lazy(() => import('../features/hospital/pages/HospitalDashboard').then(m => ({ default: m.HospitalDashboard })));
const AdminDashboard = lazy(() => import('../features/admin/pages/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const AdminAnalytics = lazy(() => import('../features/admin/pages/AdminAnalytics').then(m => ({ default: m.AdminAnalytics })));
const ComponentShowcase = lazy(() => import('../pages/ComponentShowcase').then(m => ({ default: m.ComponentShowcase })));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

const RouteLoadingFallback = () => (
  <div className="min-h-dvh flex flex-col items-center justify-center bg-[#0a1628] text-slate-300">
    <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mb-3" />
    <span className="text-xs font-mono font-bold tracking-wider text-slate-400 uppercase">Loading AERO...</span>
  </div>
);

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

    if (authLoading || (profileLoading && !profile)) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-aero-background p-4">
          <div className="w-16 h-16 rounded-full border-4 border-aero-border border-t-[#35C7FF] animate-spin mb-4"></div>
          <h2 className="text-xl font-bold text-aero-text-primary">LOADING AERO ACCOUNT...</h2>
          <p className="text-aero-text-secondary mt-2">Authenticating secure session</p>
        </div>
      );
    }

    if (profileError && !profile) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-aero-background p-4">
          <div className="bg-aero-red-soft border border-aero-red/30 rounded-xl p-6 max-w-md text-center">
            <h2 className="text-xl font-bold text-aero-red mb-2">AERO ACCOUNT ERROR</h2>
            <p className="text-aero-text-secondary mb-6">{profileError || "Authentication could not be initialized."}</p>
            <button 
              onClick={() => refreshProfile()}
              className="bg-aero-surface hover:bg-aero-surface-soft text-aero-text-primary px-6 py-2 rounded-lg border border-aero-border transition-colors"
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
          <div className="min-h-dvh flex flex-col items-center justify-center bg-aero-background p-4 text-center">
            <h2 className="text-xl font-bold text-aero-red mb-2">UNAUTHORIZED</h2>
            <p className="text-aero-text-secondary">Your account role ({userRole || 'UNKNOWN'}) does not have access to this page.</p>
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
    <Suspense fallback={<RouteLoadingFallback />}>
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
          <ProtectedRoute allowedRoles={['AMBULANCE', 'AMBULANCE_OPERATOR', 'ADMIN']}>
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
          <ProtectedRoute allowedRoles={['AMBULANCE', 'AMBULANCE_OPERATOR', 'ADMIN']}>
            <AmbulanceDashboard />
          </ProtectedRoute>
        }
      />

      {/* Police Routes */}
      <Route
        path="/police"
        element={
          <ProtectedRoute allowedRoles={['POLICE', 'TRAFFIC_OPERATOR', 'ADMIN']}>
            <PoliceDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/police/emergency/:id"
        element={
          <ProtectedRoute allowedRoles={['POLICE', 'TRAFFIC_OPERATOR', 'ADMIN']}>
            <ActiveEmergencyDetails />
          </ProtectedRoute>
        }
      />
      <Route
        path="/police/alerts"
        element={
          <ProtectedRoute allowedRoles={['POLICE', 'TRAFFIC_OPERATOR', 'ADMIN']}>
            <PoliceDashboard />
          </ProtectedRoute>
        }
      />

      {/* Hospital ER Routes */}
      <Route
        path="/hospital"
        element={
          <ProtectedRoute allowedRoles={['HOSPITAL', 'HOSPITAL_OPERATOR', 'ADMIN']}>
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
  </Suspense>
  );
}
