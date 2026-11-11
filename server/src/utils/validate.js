import mongoose from "mongoose";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Intl.supportedValuesOf() misses common aliases (e.g. Asia/Kolkata), so we let Intl.DateTimeFormat resolve the zone instead — it accepts every valid IANA name and alias.
function isValidTimezone(tz) {
  if (typeof tz !== "string" || tz.length > 50) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidObjectId(value) {
  return typeof value === "string" && mongoose.isValidObjectId(value.trim());
}

export function normalizeSkills(input) {
  if (input == null) return [];
  const list = Array.isArray(input) ? input : String(input).split(",");
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))].slice(0, 20);
}

export function validateRegisterInput(body = {}) {
  const errors = {};

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const skills = normalizeSkills(body.skills);
  const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "UTC";

  if (name.length < 2 || name.length > 50) errors.name = "Name must be 2-50 characters";
  if (!EMAIL_REGEX.test(email)) errors.email = "A valid email is required";
  if (password.length < 8) errors.password = "Password must be at least 8 characters";
  if (skills.some((s) => s.length > 40)) errors.skills = "Each skill must be at most 40 characters";
  if (timezone !== "UTC" && !isValidTimezone(timezone)) {
    errors.timezone = "Timezone must be a valid IANA timezone (e.g. Asia/Kolkata)";
  }

  return { errors, value: { name, email, password, skills, timezone } };
}

export function validateLoginInput(body = {}) {
  const errors = {};

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!EMAIL_REGEX.test(email)) errors.email = "A valid email is required";
  if (!password) errors.password = "Password is required";

  return { errors, value: { email, password } };
}

export function validateTeamInput(body = {}) {
  const errors = {};

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const hackathonId = typeof body.hackathonId === "string" ? body.hackathonId.trim() : "";

  if (name.length < 3 || name.length > 50) errors.name = "Team name must be 3-50 characters";
  if (!isValidObjectId(hackathonId)) errors.hackathonId = "hackathonId must be a valid id";

  return { errors, value: { name, hackathonId } };
}
