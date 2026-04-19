import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Load env from web/.env (one level up from backend/)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, "..", "..", ".env") });
dotenvConfig(); // also load local backend/.env if present (overrides)
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRoutes, requireUser } from "./auth.js";
import { repoRoutes } from "./github.js";
import { analyzeRoutes } from "./analyze.js";

const app = express();

app.use(
  cors({
    origin: (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(","),
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/api", requireUser);
app.use("/api", repoRoutes);
app.use("/api", analyzeRoutes);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error("[api] error:", err);
  res.status(err.status ?? 500).json({
    error: err.message ?? "internal error",
  });
};
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`api on ${port}`);
});
