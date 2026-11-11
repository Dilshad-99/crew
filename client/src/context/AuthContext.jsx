// Token + user live in localStorage behind a small context, so a hard page refresh keeps the session and the API layer stays the single place that reads the token.
import { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user")) || null;
    } catch {
      return null;
    }
  });

  const login = (token, userDetails) => {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(userDetails));
    setUser(userDetails);
  };

  const logout = () => {
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
