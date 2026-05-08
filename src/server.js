import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, getState, setConfig, createLock, releaseLock } from "./db.js";
import { generateSchedule } from "./scheduler.js";
import { exportToExcelBuffer } from "./excel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));

const db = openDb();

const ADMIN_KEY = process.env.ADMIN_KEY || "";
function isAdmin(req) {
  if (!ADMIN_KEY) return true; // demo default: if unset, allow (local convenience)
  return req.header("x-admin-key") === ADMIN_KEY;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "admin_only" });
  next();
}

// Static frontend
app.use(express.static(path.resolve(__dirname, "../public")));

app.get("/api/state", async (_req, res) => {
  res.json(getState(db));
});

app.post("/api/admin/set", requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  setConfig(db, {
    classes: body.classes,
    teachers: body.teachers,
    dates: body.dates,
    topics: body.topics,
    specialTasks: body.specialTasks
  });
  res.json({ ok: true, state: getState(db) });
});

app.post("/api/locks/lock", async (req, res) => {
  const { teacher, dateVal, className } = req.body ?? {};
  if (!teacher || !dateVal || !className) return res.status(400).json({ ok: false, error: "missing_fields" });
  try {
    createLock(db, { teacher, dateVal, className });
  } catch (e) {
    return res.status(409).json({ ok: false, error: "already_locked" });
  }
  res.json({ ok: true, locks: getState(db).locks });
});

app.post("/api/locks/unlock", async (req, res) => {
  const { lockId } = req.body ?? {};
  if (!lockId) return res.status(400).json({ ok: false, error: "missing_lockId" });
  releaseLock(db, { lockId });
  res.json({ ok: true, locks: getState(db).locks });
});

app.post("/api/generate", requireAdmin, async (_req, res) => {
  const data = getState(db);
  const { schedule, teacherLoad, tbdErrors } = generateSchedule({
    classes: data.classes,
    teachers: data.teachers,
    dates: data.dates,
    topics: data.topics,
    specialTasks: data.specialTasks,
    locks: data.locks,
    baseTeacherLoad: {}
  });
  if (tbdErrors && tbdErrors.length > 0) {
    return res.status(409).json({ ok: false, error: "tbd_gate", tbdErrors });
  }
  res.json({ ok: true, schedule, teacherLoad });
});

app.get("/api/export.xlsx", requireAdmin, async (_req, res) => {
  const data = getState(db);
  const { schedule, tbdErrors } = generateSchedule({
    classes: data.classes,
    teachers: data.teachers,
    dates: data.dates,
    topics: data.topics,
    specialTasks: data.specialTasks,
    locks: data.locks,
    baseTeacherLoad: {}
  });
  if (tbdErrors && tbdErrors.length > 0) {
    return res.status(409).json({ ok: false, error: "tbd_gate", tbdErrors });
  }

  const buffer = await exportToExcelBuffer({
    classes: data.classes,
    teachers: data.teachers,
    scheduleRows: schedule
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  // Node v20+ is strict about invalid header chars; keep ASCII filename,
  // and provide RFC5987 encoded UTF-8 filename for browsers that support it.
  const asciiName = "schedule_demo.xlsx";
  const utf8Name = "排課結果_demo.xlsx";
  const encoded = encodeURIComponent(utf8Name);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`
  );
  res.send(Buffer.from(buffer));
});

// Simple health check for Render
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`demo server listening on :${port}`);
});

