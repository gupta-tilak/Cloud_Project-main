import { NavLink, useNavigate } from 'react-router-dom';
import { MapPin, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { homeFor } from '@/lib/config';

const LINKS = [
  { to: '/', label: 'Join' },
  { to: '/cloud', label: 'Cloud Monitor' },
  { to: '/about', label: 'How it works' },
  { to: '/evaluation', label: 'Results' },
];

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
        <NavLink to="/" className="flex items-center gap-2 font-bold">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary">
            <MapPin className="h-4 w-4 text-primary-foreground" />
          </span>
          VehicleTrack Cloud <span className="text-xs font-normal text-muted-foreground">· ECAD</span>
        </NavLink>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end
              className={({ isActive }) => `rounded px-3 py-1.5 ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              {l.label}
            </NavLink>
          ))}
          {user && (
            <NavLink to={homeFor(user.role)} className={({ isActive }) => `rounded px-3 py-1.5 ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              My dashboard
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {right}
          {user ? (
            <>
              <span className="text-muted-foreground">
                {user.role}: {user.id}
              </span>
              <Button variant="outline" size="sm" onClick={() => (logout(), navigate('/'))}>
                <LogOut className="mr-1 h-4 w-4" /> Logout
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => navigate('/')}>
              Join
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
