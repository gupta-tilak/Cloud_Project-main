import { useAuth } from '@/contexts/AuthContext';
import { SiteHeader } from '@/components/SiteHeader';
import { HospitalPanel } from '@/components/HospitalPanel';

const HospitalDashboard = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl p-4">
        <h1 className="mb-3 text-xl font-bold">🏥 Emergency console</h1>
        <HospitalPanel hospitalId={user!.id} mapHeight="h-[50vh]" />
      </main>
    </div>
  );
};

export default HospitalDashboard;
