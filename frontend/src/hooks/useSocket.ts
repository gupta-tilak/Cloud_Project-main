import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_URL, makeToken, type Identity } from '@/lib/config';

// Opens a Socket.IO connection to the cloud gateway for one identity.
// Panels pass their own identity so the Live Demo page can host a vehicle,
// a family user and a hospital in one browser window.
export const useSocket = (identity: Identity | null) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const id = identity?.id;
  const role = identity?.role;

  useEffect(() => {
    if (!id || !role) return;

    const s = io(`${API_URL}/track`, {
      path: '/ws',
      auth: { token: makeToken({ id, role }) },
    });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (error) => console.error('Socket connection error:', error.message));
    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [id, role]);

  return { socket, connected };
};
