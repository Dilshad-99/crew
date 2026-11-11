// Auth reused 1:1 from my Pawn Shop Management System: bcrypt(10) hashing at register, JWT payload { _id, email, role } signed for 7d at login, "Email already exists" on the E11000 duplicate-key error — same design, different app.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { JWT_SECRET } from "../middleware/auth.js";
import { validateRegisterInput, validateLoginInput } from "../utils/validate.js";

export const register = async (req, res) => {
  const { errors, value } = validateRegisterInput(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ status: false, message: "Invalid registration input", errors });
  }

  try {
    const hashedPassword = await bcrypt.hash(value.password, 10);

    const user = await User.create({
      name: value.name,
      email: value.email,
      password: hashedPassword,
      skills: value.skills,
      timezone: value.timezone,
      role: "user"
    });

    const { password, ...safeUser } = user.toObject();

    res.status(201).json({ status: "OK", message: "Registered successfully. You can now log in.", user: safeUser });
  } catch (error) {
    if (error.code === 11000 || error.message?.includes("duplicate key") || error.message?.includes("E11000")) {
      return res.status(409).json({ status: false, message: "Email already exists" });
    }

    if (error.name === "ValidationError") {
      const field = Object.keys(error.errors)?.[0];
      const msg = field ? error.errors[field].message : error.message;
      return res.status(400).json({ status: false, message: msg });
    }

    console.error("Registration error:", error.message);
    res.status(500).json({ status: false, message: "Server error" });
  }
};

export const login = async (req, res) => {
  const { errors, value } = validateLoginInput(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ status: false, message: "Invalid login input", errors });
  }

  try {
    const user = await User.findOne({ email: value.email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(value.password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { _id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password, ...userDetails } = user.toObject();

    res.status(200).json({ token, userDetails });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ message: "Server error" });
  }
};
