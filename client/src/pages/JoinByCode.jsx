// Joining by invite code with the SAME race-proof endpoint as always — the idempotencyKey is minted once per visit so a double-click or network retry of one attempt replays the original result instead of fighting the atomic join guard.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api.js";

export default function JoinByCode() {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // stable per visit: one intent, one key — a retry replays the original 200
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const join = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/api/teams/join", {
        inviteCode: inviteCode.trim(),
        idempotencyKey
      });
      navigate(`/teams/${res.data.team._id}`);
    } catch (err) {
      setError(err.response?.data?.message || "Could not join");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Join a team</h1>
      <p>
        <Link to="/teams">← All teams</Link>
      </p>
      <form onSubmit={join}>
        <label>
          Invite code
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="the code your team lead shared"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Joining..." : "Join"}
        </button>
      </form>
    </div>
  );
}
