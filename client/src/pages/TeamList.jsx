// Teams are fetched in a useEffect keyed on [hackathonId, location.key], so navigating here after creating a team re-runs the fetch and the new team appears without any page refresh.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import api from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function TeamList() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [hackathons, setHackathons] = useState([]);
  const [hackathonId, setHackathonId] = useState("");
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get("/api/hackathons")
      .then((res) => {
        setHackathons(res.data.hackathons || []);
        setHackathonId((prev) => prev || res.data.hackathons?.[0]?._id || "");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load hackathons"));
  }, []);

  useEffect(() => {
    if (!hackathonId) return;
    setLoading(true);
    setError("");
    api
      .get("/api/teams", { params: { hackathonId } })
      .then((res) => setTeams(res.data.teams || []))
      .catch((err) => setError(err.response?.data?.message || "Could not load teams"))
      .finally(() => setLoading(false));
  }, [hackathonId, location.key]);

  const selectedHackathon = hackathons.find((h) => h._id === hackathonId);
  const myTeam = teams.find((t) =>
    (t.members || []).some((m) => String(m._id) === String(user?._id))
  );

  return (
    <div className="page">
      <header>
        <h1>Crew</h1>
        <div>
          <span>{user?.name}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <h2>Teams</h2>

      {hackathons.length === 0 && !error && <p>No hackathons yet.</p>}
      {hackathons.length > 0 && (
        <label>
          Hackathon
          <select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)}>
            {hackathons.map((h) => (
              <option key={h._id} value={h._id}>
                {h.name} (team size {h.minTeamSize}-{h.maxTeamSize})
              </option>
            ))}
          </select>
        </label>
      )}

      {myTeam && (
        <p className="notice">
          You are on <strong>{myTeam.name}</strong> in this hackathon.
        </p>
      )}
      {!myTeam && hackathonId && (
        <p>
          <Link to="/teams/new">Create a team</Link>
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading teams...</p>}

      {!loading && !error && teams.length === 0 && hackathonId && <p>No teams yet. Be the first to create one!</p>}

      <ul className="team-list">
        {teams.map((team) => (
          <li key={team._id} className="team-card">
            <strong>{team.name}</strong>
            <span>
              Leader: {team.leaderId?.name || "unknown"} · {team.memberCount} member
              {team.memberCount === 1 ? "" : "s"}
              {selectedHackathon ? ` (max ${selectedHackathon.maxTeamSize})` : ""}
            </span>
            <span>Members: {(team.members || []).map((m) => m.name).join(", ")}</span>
            {String(team.leaderId?._id) === String(user?._id) && <span className="notice">You lead this team</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
