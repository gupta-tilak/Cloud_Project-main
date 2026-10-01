import { useAuth } from '@/contexts/AuthContext';
import { SiteHeader } from '@/components/SiteHeader';
import { VehiclePanel } from '@/components/VehiclePanel';

const DeviceDashboard = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-1 text-xl font-bold">🚗 Vehicle {user!.id}</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          This screen plays the in-car IoT unit: GPS + motion sensors + a small computer that scores possible crashes.
        </p>
        <VehiclePanel vehicleId={user!.id} />
      </main>
    </div>
  );
};

export default DeviceDashboard;
