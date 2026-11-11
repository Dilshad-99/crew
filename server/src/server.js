import "./loadEnv.js";
import app from "./app.js";
import connection from "./config/db.js";
import { seedDefaultHackathon } from "./seed.js";

const port = process.env.PORT || 3001;

connection.once("open", () => {
  seedDefaultHackathon();
});

app.listen(port, () => {
  console.log(`Crew API listening on port ${port}`);
});
