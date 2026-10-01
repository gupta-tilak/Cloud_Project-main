import React, { createContext, useContext, useState } from 'react';
import { makeToken, type Role } from '@/lib/config';

type AuthUser = { id: string; role: Role; token: string };

interface AuthContextType {
  user: AuthUser | null;
  login: (id: string, role: Role) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// sessionStorage (not localStorage) so each browser tab can hold a different
// role — vehicle, family user and hospital side by side during a demo.
const KEY = 'vehicletrack_auth';
const readStored = (): AuthUser | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(readStored);

  const login = (id: string, role: Role) => {
    const userData = { id, role, token: makeToken({ id, role }) };
    setUser(userData);
    sessionStorage.setItem(KEY, JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    sessionStorage.removeItem(KEY);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
