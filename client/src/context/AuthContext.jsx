// Token + user live in localStorage behind a small context, so a hard page refresh keeps the session and the API layer stays the single place that reads the token. The socket shares that exact lifecycle: one JWT, one connection — connected here on login/refresh, dropped on logout.
import { createContext, useContext, useEffect, useState } from "react";
import { connectSocket, disconnectSocket } from "../realtime/socket.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user")) || null;
    } catch {
      return null;
    }
  });

  // A hard refresh keeps the token in localStorage — reconnect the socket too (idempotent if already connected)
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      connectSocket(token);
    } else {
      disconnectSocket();
    }
  }, [user]);

  const login = (token, userDetails) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userDetails));
    connectSocket(token);
    setUser(userDetails);
  };

  const logout = () => {
    disconnectSocket();
    localStorage.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
