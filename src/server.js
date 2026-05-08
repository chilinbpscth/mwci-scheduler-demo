import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readData, updateData } from "./store.js";
import { generateSchedule } from "./scheduler.js";
import { exportToExcelBuffer } from "./excel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));

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
  const data = await readData();
  res.json(data);
});

app.post("/api/admin/set", requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const next = await updateData((cur) => {
    // Minimal validation for demo
    return {
      ...cur,
      classes: body.classes ?? cur.classes,
      teachers: body.teachers ?? cur.teachers,
      dates: body.dates ?? cur.dates,
      topics: body.topics ?? cur.topics,
      specialTasks: body.specialTasks ?? cur.specialTasks
    };
  });
  res.json({ ok: true, state: next });
});

app.post("/api/locks/lock", async (req, res) => {
  const { teacher, dateVal, className } = req.body ?? {};
  if (!teacher || !dateVal || !className) return res.status(400).json({ ok: false, error: "missing_fields" });

  const next = await updateData((cur) => {
    // Unique lock per slot
    const exists = cur.locks.find((l) => l.dateVal === dateVal && l.className === className && l.status === "locked");
    if (exists) return cur;

    const lock = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      teacher,
      dateVal,
      className,
      status: "locked",
      createdAt: new Date().toISOString()
    };

    return { ...cur, locks: [...cur.locks, lock] };
  });

  res.json({ ok: true, locks: next.locks });
});

app.post("/api/locks/unlock", async (req, res) => {
  const { lockId } = req.body ?? {};
  if (!lockId) return res.status(400).json({ ok: false, error: "missing_lockId" });

  const next = await updateData((cur) => {
    const locks = cur.locks.map((l) => (l.id === lockId ? { ...l, status: "released", releasedAt: new Date().toISOString() } : l));
    return { ...cur, locks };
  });
  res.json({ ok: true, locks: next.locks });
});

app.post("/api/generate", requireAdmin, async (_req, res) => {
  const data = await readData();
  const { schedule, teacherLoad } = generateSchedule({
    classes: data.classes,
    teachers: data.teachers,
    dates: data.dates,
    topics: data.topics,
    specialTasks: data.specialTasks,
    locks: data.locks,
    baseTeacherLoad: {}
  });
  res.json({ ok: true, schedule, teacherLoad });
});

app.get("/api/export.xlsx", requireAdmin, async (_req, res) => {
  const data = await readData();
  const { schedule } = generateSchedule({
    classes: data.classes,
    teachers: data.teachers,
    dates: data.dates,
    topics: data.topics,
    specialTasks: data.specialTasks,
    locks: data.locks,
    baseTeacherLoad: {}
  });

  const buffer = await exportToExcelBuffer({
    classes: data.classes,
    teachers: data.teachers,
    scheduleRows: schedule
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="排課結果_demo.xlsx"');
  res.send(Buffer.from(buffer));
});

// Simple health check for Render
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`demo server listening on :${port}`);
});

