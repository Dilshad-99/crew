// After a successful POST we navigate back to /teams, whose useEffect re-fetches — so the new team shows up in the list with no manual refresh. The idempotencyKey is generated ONCE per form attempt (useState initializer), so a double-clicked submit sends the SAME key and the server replays the original result instead of creating two teams.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api.js";

export default function CreateTeam() {
  const [hackathons, setHackathons] = useState([]);
  const [hackathonId, setHackathonId] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get("/api/hackathons")
      .then((res) => {
        setHackathons(res.data.hackathons || []);
        setHackathonId(res.data.hackathons?.[0]?._id || "");
      })
      .catch((err) => setError(err.response?.data?.message || "Could not load hackathons"));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setErrors({});
    setLoading(true);

    try {
      await api.post("/api/teams", { hackathonId, name, idempotencyKey });
      navigate("/teams");
    } catch (err) {
      setErrors(err.response?.data?.errors || {});
      setError(err.response?.data?.message || "Could not create team");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <h1>Crew</h1>
      <h2>Create a team</h2>
      {error && <p className="error">{error}</p>}
      {hackathons.length === 0 && !error && <p>No hackathons yet.</p>}
      {hackathons.length > 0 && (
        <form onSubmit={handleSubmit}>
          <label>
            Hackathon
            <select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)} required>
              {hackathons.map((h) => (
                <option key={h._id} value={h._id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          {errors.hackathonId && <p className="error">{errors.hackathonId}</p>}
          <label>
            Team name
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={50} />
          </label>
          {errors.name && <p className="error">{errors.name}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create team"}
          </button>
        </form>
      )}
      <p>
        <Link to="/teams">Back to teams</Link>
      </p>
    </div>
  );
}
