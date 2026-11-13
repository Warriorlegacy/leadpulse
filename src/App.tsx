import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, setCsrfToken, type AuthPayload } from './api';
import { Spinner, ToastProvider } from './ui';
import { Shell } from './Shell';
import { Landing, Pricing, Privacy, Terms, NotFound } from './pages/Public';
import { AuthPage, AcceptInvitePage, ForgotPasswordPage, ResetPasswordPage } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { LeadsPage, LeadDetailPage } from './pages/Leads';
import { PipelinePage } from './pages/Pipeline';
import { TasksPage } from './pages/Tasks';
import { ReportsPage } from './pages/Reports';
import { TeamPage, SettingsPage } from './pages/TeamSettings';
import { DataIOPage, AuditPage } from './pages/DataIO';
import { CapturePage } from './pages/Capture';

interface AuthContextValue {
  auth: AuthPayload | null;
  loading: boolean;
  setAuth: (payload: AuthPayload) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  auth: null, loading: true, setAuth: () => {}, refresh: async () => {}, signOut: async () => {},
});
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuthState] = useState<AuthPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const setAuth = useCallback((payload: AuthPayload) => {
    if (payload.csrfToken) setCsrfToken(payload.csrfToken);
    setAuthState(payload);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await api<AuthPayload>('/auth/me');
      setAuth(payload);
    } catch {
      setCsrfToken('');
      setAuthState(null);
    } finally {
      setLoading(false);
    }
  }, [setAuth]);

  useEffect(() => { void refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* clear local state regardless */ }
    setCsrfToken('');
    setAuthState(null);
  }, []);

  return (
    <AuthContext.Provider value={{ auth, loading, setAuth, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { auth, loading } = useAuth();
  if (loading) return <div className="public"><Spinner label="Checking your session" /></div>;
  if (!auth) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept/:token" element={<AcceptInvitePage />} />
      <Route path="/form/:publicId" element={<CapturePage />} />
      <Route path="/app" element={<Protected><Shell /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:id" element={<LeadDetailPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="data" element={<DataIOPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
