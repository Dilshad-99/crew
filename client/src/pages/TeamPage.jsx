// THE TEAM ROOM. One page serves three viewers: the leader (invite code, pending requests, remove buttons), members (leave button, audit feed, suggestions), and outsiders (request to join). Everything updates live via the team's socket room — room membership is authorized server-side, so a non-member never hears team chatter even though they can still view the page over REST.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getSocket } from "../realtime/socket.js";

const TEAM_EVENTS = ["memberJoined", "memberRemoved", "joinRequestReceived", "joinRequestResolved", "leaderChanged"];

const ACTION_LABELS = {
  team_created: "created the team",
  member_joined: "joined via invite code",
  join_request_created: "asked to join",
  request_accepted: "accepted a join request",
  request_declined: "declined a join request",
  member_removed: "removed a member",
  member_left: "left the team",
  leadership_transferred: "left and passed leadership on",
  team_deleted: "was the last member — team deleted"
};

export default function TeamPage() {
  const { teamId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [team, setTeam] = useState(null);
  const [viewerIsMember, setViewerIsMember] = useState(false);
  const [viewerIsLeader, setViewerIsLeader] = useState(false);
  const [inviteCode, setInviteCode] = useState(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState(null);
  const [requests, setRequests] = useState([]);
  const [audit, setAudit] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionError, setSuggestionError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  // Bumped on every change (HTTP action, socket event, reconnect) — the extras (audit/requests/suggestions) refetch whenever it moves
  const [revision, setRevision] = useState(0);

  const loadTeam = useCallback(async () => {
    try {
      const res = await api.get(`/api/teams/${teamId}`);
      setTeam(res.data.team);
      setViewerIsMember(Boolean(res.data.viewerIsMember));
      setViewerIsLeader(Boolean(res.data.viewerIsLeader));
      setInviteCode(res.data.inviteCode || null);
      setInviteExpiresAt(res.data.inviteCodeExpiresAt || null);
      return res.data.team;
    } catch (err) {
      setError(err.response?.data?.message || "Could not load team");
      return null;
    }
  }, [teamId]);

  // One refresh motion for every trigger: reload the team document, then let the revision bump cascade the membership-dependent extras
  const refresh = useCallback(async () => {
    await loadTeam();
    setRevision((r) => r + 1);
  }, [loadTeam]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Membership-dependent extras. Audit is members-only (403 otherwise), suggestions need a team, requests are leader-only — each fetches only when its viewer is entitled.
  useEffect(() => {
    if (!team?.hackathonId?._id) return;
    if (!viewerIsMember) {
      setAudit([]);
      setSuggestions([]);
      setRequests([]);
      return;
    }
    (async () => {
      const [auditRes, suggRes] = await Promise.allSettled([
        api.get(`/api/teams/${teamId}/audit`),
        api.get(`/api/hackathons/${team.hackathonId._id}/suggestions`)
      ]);
      if (auditRes.status === "fulfilled") setAudit(auditRes.value.data.audit || []);
      if (suggRes.status === "fulfilled") {
        setSuggestions(suggRes.value.data.suggestions || []);
        setSuggestionError("");
      } else {
        setSuggestions([]);
        setSuggestionError(suggRes.reason?.response?.data?.message || "Suggestions unavailable");
      }
      if (viewerIsLeader) {
        try {
          const reqRes = await api.get(`/api/teams/${teamId}/requests`);
          setRequests(reqRes.data.requests || []);
        } catch {
          setRequests([]);
        }
      }
    })();
  }, [team?._id, team?.hackathonId?._id, viewerIsMember, viewerIsLeader, revision, teamId]);

  // "the socket exists now" signal — AuthProvider connects it after children mount
  useEffect(() => {
    const onReady = () => setSocketReady(true);
    if (getSocket()?.connected) setSocketReady(true);
    window.addEventListener("crew:socket-connected", onReady);
    return () => window.removeEventListener("crew:socket-connected", onReady);
  }, []);

  // Realtime wiring: the team room refetches on every event; teamDeleted sends everyone back to the board. Reconnects re-subscribe (rooms don't survive a dropped socket).
  useEffect(() => {
    const socket = getSocket();
    if (!socketReady || !socket || !viewerIsMember) return;

    const resubscribe = () => {
      socket.emit("team:subscribe", teamId, (ack) => {
        if (ack?.status) {
          setLive(true);
          refresh(); // refetch once on (re)subscribe — the reconnect contract
        } else {
          setLive(false);
        }
      });
    };

    const onDeleted = () => {
      navigate("/teams");
    };

    if (socket.connected) resubscribe();
    socket.on("connect", resubscribe);
    socket.on("teamDeleted", onDeleted);
    TEAM_EVENTS.forEach((event) => socket.on(event, refresh));

    return () => {
      socket.off("connect", resubscribe);
      socket.off("teamDeleted", onDeleted);
      TEAM_EVENTS.forEach((event) => socket.off(event, refresh));
    };
  }, [socketReady, viewerIsMember, teamId, refresh, navigate]);

  const act = async (method, path, successNote) => {
    setNotice("");
    setError("");
    try {
      await api.request({ method, url: path });
      setNotice(successNote);
      await refresh();
      return true;
    } catch (err) {
      setError(err.response?.data?.message || "Action failed");
      return false;
    }
  };

  const requestToJoin = async () => {
    setNotice("");
    setError("");
    try {
      // fresh idempotency key per click — a network retry of THIS click replays, a genuinely new ask after a decline gets a new key
      const idempotencyKey = crypto.randomUUID();
      await api.post(`/api/teams/${teamId}/requests`, { idempotencyKey });
      setNotice("Request sent — the leader sees it live");
    } catch (err) {
      setError(err.response?.data?.message || "Could not send request");
    }
  };

  const leave = async () => {
    const ok = await act("post", `/api/teams/${teamId}/leave`, "You left the team");
    if (ok) navigate("/teams");
  };

  if (error && !team) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/teams">Back to teams</Link>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="page">
        <p>Loading team...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header>
        <h1>{team.name}</h1>
        <div>
          {viewerIsMember && <span className={live ? "notice" : "error"}>{live ? "● live" : "● offline"}</span>}
        </div>
      </header>

      <p>
        <Link to="/teams">← All teams</Link>
      </p>

      <p>
        Leader: {team.leaderId?.name || "unknown"} · {team.memberCount}/{team.hackathonId?.maxTeamSize} members
        (minimum {team.hackathonId?.minTeamSize})
      </p>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {viewerIsLeader && (
        <section className="panel">
          <h3>Invite code</h3>
          <p className="invite-code">{inviteCode || "—"}</p>
          <p className="hint">
            Share this code — expires {inviteExpiresAt ? new Date(inviteExpiresAt).toLocaleString() : "24h after team creation"}.
            Anyone with the code can join while seats remain.
          </p>
        </section>
      )}

      <section className="panel">
        <h3>Members</h3>
        <ul className="member-list">
          {(team.members || []).map((m) => (
            <li key={m._id} className="member-row">
              <span>
                {m.name}
                {String(m._id) === String(team.leaderId?._id) ? " (leader)" : ""}
                {String(m._id) === String(user?._id) ? " — you" : ""}
              </span>
              {viewerIsLeader && String(m._id) !== String(user?._id) && (
                <button className="danger" onClick={() => act("delete", `/api/teams/${teamId}/members/${m._id}`, "Member removed")}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {viewerIsMember && (
          <button className="danger" onClick={leave}>
            Leave team{viewerIsLeader ? " (passes leadership)" : ""}
          </button>
        )}
        {!viewerIsMember && <button onClick={requestToJoin}>Request to join</button>}
      </section>

      {viewerIsLeader && (
        <section className="panel">
          <h3>Join requests</h3>
          {requests.length === 0 && <p className="hint">No pending requests. They appear here the instant someone asks.</p>}
          <ul className="member-list">
            {requests.map((r) => (
              <li key={r._id} className="member-row">
                <span>
                  <strong>{r.userId?.name || "someone"}</strong>
                  {r.userId?.email ? ` · ${r.userId.email}` : ""}
                  {r.userId?.skills?.length ? ` · skills: ${r.userId.skills.join(", ")}` : ""}
                  {r.userId?.timezone ? ` · ${r.userId.timezone}` : ""}
                </span>
                <span>
                  <button className="danger" onClick={() => act("patch", `/api/teams/${teamId}/requests/${r._id}/decline`, "Request declined")}>
                    Decline
                  </button>{" "}
                  <button onClick={() => act("patch", `/api/teams/${teamId}/requests/${r._id}/accept`, "Request accepted — they just joined")}>
                    Accept
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewerIsMember && (
        <section className="panel">
          <h3>Suggested teammates</h3>
          <p className="hint">Ranked by what this team is MISSING (not what it has) + timezone overlap — every score is shown, nothing is a black box.</p>
          {suggestionError && <p className="hint">{suggestionError}</p>}
          {suggestions.length === 0 && !suggestionError && <p className="hint">No suggestions right now.</p>}
          <ul className="suggestion-list">
            {suggestions.map((s) => (
              <li key={s.user._id} className="suggestion-card">
                <strong>{s.user.name}</strong>
                <span>{s.user.email}</span>
                <span>Skills: {(s.user.skills || []).join(", ") || "none listed"} · {s.user.timezone}</span>
                <span className="breakdown">
                  +{s.score.skillsScore} skills — {s.score.missingSkills.length} missing
                  ({s.score.missingSkills.join(", ") || "none"})
                  {s.score.overlappingSkills.length ? `, ${s.score.overlappingSkills.length} overlap (${s.score.overlappingSkills.join(", ")})` : ""}
                </span>
                <span className="breakdown">
                  +{s.score.timezoneScore} timezone (Δ{" "}
                  {s.score.timezoneDeltaMinutes == null ? "unknown" : `${s.score.timezoneDeltaMinutes} min`})
                </span>
                <span className="score-total">Score: {s.score.total}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {viewerIsMember && (
        <section className="panel">
          <h3>Activity</h3>
          <p className="hint">The same audit log the server writes on every action — who did what, when.</p>
          {audit.length === 0 && <p className="hint">Nothing yet.</p>}
          <ul className="audit-list">
            {audit.map((a) => (
              <li key={a._id}>
                <strong>{a.actorId?.name || "someone"}</strong> {ACTION_LABELS[a.action] || a.action}
                <span className="hint"> · {new Date(a.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
