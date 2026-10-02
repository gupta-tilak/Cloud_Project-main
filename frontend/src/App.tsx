import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import Join from "./pages/Join";
import CloudMonitor from "./pages/CloudMonitor";
import Overview from "./pages/Overview";
import LiveDemo from "./pages/LiveDemo";
import Evaluation from "./pages/Evaluation";
import ResponderDashboard from "./pages/ResponderDashboard";
import { homeFor, type Role } from "./lib/config";
import UserDashboard from "./pages/UserDashboard";
import DeviceDashboard from "./pages/DeviceDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children, role }: { children: React.ReactNode; role?: Role }) => {
  const { user } = useAuth();

  if (!user) return <Navigate to="/" replace />;
  if (role && user.role !== role) {
    return <Navigate to={homeFor(user.role)} replace />;
  }
  
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Join />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/cloud" element={<CloudMonitor />} />
            <Route path="/about" element={<Overview />} />
            <Route path="/demo" element={<LiveDemo />} />
            <Route path="/evaluation" element={<Evaluation />} />
            <Route
              path="/responder"
              element={
                <ProtectedRoute role="responder">
                  <ResponderDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute role="user">
                  <UserDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/device"
              element={
                <ProtectedRoute role="device">
                  <DeviceDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
