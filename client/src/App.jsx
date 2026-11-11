import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import TeamList from "./pages/TeamList.jsx";
import CreateTeam from "./pages/CreateTeam.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import JoinByCode from "./pages/JoinByCode.jsx";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/teams"
          element={
            <ProtectedRoute>
              <TeamList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teams/new"
          element={
            <ProtectedRoute>
              <CreateTeam />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teams/:teamId"
          element={
            <ProtectedRoute>
              <TeamPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/join"
          element={
            <ProtectedRoute>
              <JoinByCode />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/teams" replace />} />
      </Routes>
    </AuthProvider>
  );
}
