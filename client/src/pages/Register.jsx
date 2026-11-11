import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api.js";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

export default function Register() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    skills: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setErrors({});
    setLoading(true);

    try {
      await api.post("/api/auth/register", form);
      navigate("/login", { state: { message: "Registered successfully. Please log in." } });
    } catch (err) {
      setErrors(err.response?.data?.errors || {});
      setError(err.response?.data?.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <h1>Crew</h1>
      <h2>Register</h2>
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input name="name" value={form.name} onChange={handleChange} required />
        </label>
        {errors.name && <p className="error">{errors.name}</p>}
        <label>
          Email
          <input name="email" type="email" value={form.email} onChange={handleChange} required />
        </label>
        {errors.email && <p className="error">{errors.email}</p>}
        <label>
          Password (min 8 characters)
          <input name="password" type="password" value={form.password} onChange={handleChange} required />
        </label>
        {errors.password && <p className="error">{errors.password}</p>}
        <label>
          Skills (comma separated)
          <input name="skills" value={form.skills} onChange={handleChange} placeholder="React, Node.js, Figma" />
        </label>
        {errors.skills && <p className="error">{errors.skills}</p>}
        <label>
          Timezone
          <input name="timezone" value={form.timezone} onChange={handleChange} list="tz-list" />
          <datalist id="tz-list">
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </label>
        {errors.timezone && <p className="error">{errors.timezone}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Registering..." : "Register"}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
