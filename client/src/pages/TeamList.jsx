// THE LIVE BOARD. Teams load via REST, then the page joins the hackathon's socket room and refetches ON every team event (and once on every reconnect) — the second browser window sees a join the instant it happens, zero polling, zero refresh. If the socket isn't up yet, a window event from the socket manager re-runs the wiring once it is.
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import api from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getSocket } from "../realtime/socket.js";

// Every event the board cares about → one refetch (server sends SAFE payloads; the invite code never rides a socket)
const BOARD_EVENTS = ["teamCreated", "memberJoined", "memberRemoved", "leaderChanged", "teamDeleted"];

export default function TeamList() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [hackathons, setHackathons] = useState([]);
  const [hackathonId, setHackathonId] = useState("");
  const [teams, setTeams] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [socketReady, setSocketReady] = useState(false);

  useEffect(() => {
    api
      .get("/api/hackathons")
      .then((res) => {
        setHackathons(res.data.hackathons || []);
        setHackathonId((prev) => prev || res.data.hackathons?.[0]?._id || "");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load hackathons"));
  }, []);

  const loadTeams = useCallback(() => {
    if (!hackathonId) return;
    api
      .get("/api/teams", { params: { hackathonId } })
      .then((res) => setTeams(res.data.teams || []))
      .catch((err) => setError(err.response?.data?.message || "Could not load teams"));
  }, [hackathonId]);

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

  // "the socket exists now" — children mount before the AuthProvider effect that connects it, so pages listen for this signal
  useEffect(() => {
    const onReady = () => setSocketReady(true);
    if (getSocket()?.connected) setSocketReady(true);
    window.addEventListener("crew:socket-connected", onReady);
    return () => window.removeEventListener("crew:socket-connected", onReady);
  }, []);

  // Realtime wiring: subscribe to the board room, refetch on every change event, and re-subscribe on reconnect (rooms don't survive a dropped socket)
  useEffect(() => {
    const socket = getSocket();
    if (!socketReady || !socket || !hackathonId) return;

    const resubscribe = () => {
      socket.emit("hackathon:subscribe", hackathonId, (ack) => {
        if (ack?.status) {
          setLive(true);
          loadTeams(); // fresh state after (re)subscribe — the "refetch once on reconnect" contract
        } else {
          setLive(false);
        }
      });
    };

    if (socket.connected) resubscribe();
    socket.on("connect", resubscribe);
    BOARD_EVENTS.forEach((event) => socket.on(event, loadTeams));

    return () => {
      socket.off("connect", resubscribe);
      BOARD_EVENTS.forEach((event) => socket.off(event, loadTeams));
    };
  }, [socketReady, hackathonId, loadTeams]);

  const selectedHackathon = hackathons.find((h) => h._id === hackathonId);
  const myTeam = teams.find((t) =>
    (t.members || []).some((m) => String(m._id) === String(user?._id))
  );

  return (
    <div className="page">
      <header>
        <h1>Crew</h1>
        <div>
          <span>{user?.name} </span>
          <span className={live ? "notice" : "error"}>{live ? "● live" : "● offline"}</span>
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
          You are on <Link to={`/teams/${myTeam._id}`}>{myTeam.name}</Link> in this hackathon.
        </p>
      )}
      {!myTeam && hackathonId && (
        <p>
          <Link to="/teams/new">Create a team</Link> · <Link to="/join">Join by invite code</Link>
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading teams...</p>}

      {!loading && !error && teams.length === 0 && hackathonId && <p>No teams yet. Be the first to create one!</p>}

      <ul className="team-list">
        {teams.map((team) => (
          <li key={team._id} className="team-card">
            <strong>
              <Link to={`/teams/${team._id}`}>{team.name}</Link>
            </strong>
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
