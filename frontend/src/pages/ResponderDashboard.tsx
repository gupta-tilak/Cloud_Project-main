import { useAuth } from '@/contexts/AuthContext';
import { SiteHeader } from '@/components/SiteHeader';
import { ResponderPanel } from '@/components/ResponderPanel';

const ResponderDashboard = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl p-4">
        <h1 className="mb-3 text-xl font-bold">🚨 Emergency responder {user!.id === 'ALL' ? '· control room' : user!.id}</h1>
        <ResponderPanel facilityId={user!.id} mapHeight="h-[50vh]" />
      </main>
    </div>
  );
};

export default ResponderDashboard;
