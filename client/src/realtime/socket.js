// One socket per browser tab, period. It authenticates with the SAME JWT the REST layer uses (handshake auth) and lives in a module singleton so any page can grab it — AuthContext owns its lifecycle: connect on login / hard refresh, disconnect on logout.
import { io } from "socket.io-client";

let socket = null;

export function connectSocket(token) {
  if (socket) return socket; // already connected (or reconnecting) — never stack sockets
  socket = io(import.meta.env.VITE_API_URL || "http://localhost:3001", {
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000
  });
  // Pages key their room subscriptions off this window event — React children mount before parent effects run, so the pages need a signal for "the socket now exists"
  socket.on("connect", () => window.dispatchEvent(new Event("crew:socket-connected")));
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
