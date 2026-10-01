import { useAuth } from '@/contexts/AuthContext';
import { SiteHeader } from '@/components/SiteHeader';
import { FamilyPanel } from '@/components/FamilyPanel';

const UserDashboard = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl p-4">
        <h1 className="mb-3 text-xl font-bold">👪 Family member {user!.id}</h1>
        <FamilyPanel userId={user!.id} mapHeight="h-[60vh]" />
      </main>
    </div>
  );
};

export default UserDashboard;
