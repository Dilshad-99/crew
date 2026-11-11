import "./loadEnv.js";
import http from "http";
import app from "./app.js";
import connection from "./config/db.js";
import { seedDefaultHackathon, backfillTeamCapacity } from "./seed.js";
import { initializeSocket } from "./realtime/io.js";

const port = process.env.PORT || 3001;

connection.once("open", async () => {
  await seedDefaultHackathon();
  await backfillTeamCapacity();
});

// Socket.io needs the raw http.Server handle — Express's app.listen returns it, and we hand it straight to the realtime layer on the same port as REST
const httpServer = app.listen(port, () => {
  console.log(`Crew API listening on port ${port}`);
});

initializeSocket(httpServer);
