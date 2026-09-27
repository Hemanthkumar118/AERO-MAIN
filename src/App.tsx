import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { AppRoutes } from './routes';
import { MapProvider } from './providers/MapProvider';
import { AuthProvider } from './providers/AuthProvider';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <MapProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </MapProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
