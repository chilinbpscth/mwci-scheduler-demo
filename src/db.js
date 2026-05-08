import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data.sqlite");
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : DEFAULT_DB_PATH;

const SEED_PATH = path.resolve(process.cwd(), "seed/seed.json");

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function openDb() {
  ensureDir(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  migrate(db);
  seedIfEmpty(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
      name TEXT PRIMARY KEY,
      level INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teachers (
      name TEXT PRIMARY KEY,
      specialties_json TEXT NOT NULL,
      assignments_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dates (
      dateVal TEXT PRIMARY KEY,
      display TEXT NOT NULL,
      weekday TEXT NOT NULL,
      selected INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topics (
      dateVal TEXT NOT NULL,
      className TEXT NOT NULL,
      text TEXT NOT NULL,
      color TEXT NOT NULL,
      fixedTeacher TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(dateVal, className)
    );

    CREATE TABLE IF NOT EXISTS locks (
      id TEXT PRIMARY KEY,
      teacher TEXT NOT NULL,
      dateVal TEXT NOT NULL,
      className TEXT NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      releasedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS locks_unique_locked_slot
      ON locks(dateVal, className)
      WHERE status = 'locked';

    CREATE TABLE IF NOT EXISTS special_tasks (
      id TEXT PRIMARY KEY,
      dateVal TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS special_task_assignments (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL,
      teacher TEXT NOT NULL,
      loadType TEXT NOT NULL,
      FOREIGN KEY(taskId) REFERENCES special_tasks(id)
    );

    CREATE TABLE IF NOT EXISTS points_ledger (
      id TEXT PRIMARY KEY,
      teacher TEXT NOT NULL,
      dateVal TEXT NOT NULL,
      kind TEXT NOT NULL,
      points INTEGER NOT NULL,
      ref TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      schedule_json TEXT NOT NULL
    );
  `);
}

function parseLevelFromClass(name) {
  const m = String(name).match(/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : 1;
}

function seedIfEmpty(db) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM teachers").get();
  if (row?.c > 0) return;

  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Missing seed file at ${SEED_PATH}`);
  }
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));

  const now = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run("seededAt", now);

  const insertClass = db.prepare("INSERT OR REPLACE INTO classes(name, level) VALUES(?, ?)");
  for (const c of seed.classes ?? []) {
    const level = c.level ?? parseLevelFromClass(c.name);
    insertClass.run(c.name, level);
  }

  const insertTeacher = db.prepare(
    "INSERT OR REPLACE INTO teachers(name, specialties_json, assignments_json) VALUES(?, ?, ?)"
  );
  for (const t of seed.teachers ?? []) {
    insertTeacher.run(
      t.name,
      JSON.stringify(t.specialties ?? []),
      JSON.stringify(t.assignments ?? {})
    );
  }

  const insertDate = db.prepare(
    "INSERT OR REPLACE INTO dates(dateVal, display, weekday, selected) VALUES(?, ?, ?, ?)"
  );
  for (const d of seed.dates ?? []) {
    insertDate.run(d.val, d.display, d.weekday, d.selected === false ? 0 : 1);
  }

  const insertTopic = db.prepare(
    "INSERT OR REPLACE INTO topics(dateVal, className, text, color, fixedTeacher) VALUES(?, ?, ?, ?, ?)"
  );
  for (const [key, val] of Object.entries(seed.topics ?? {})) {
    const [dateVal, className] = key.split("_");
    insertTopic.run(dateVal, className, val.text ?? "", val.color ?? "#ffffff", val.fixedTeacher ?? "");
  }

  // Special tasks (optional in seed)
  const insertTask = db.prepare("INSERT OR REPLACE INTO special_tasks(id, dateVal, name) VALUES(?, ?, ?)");
  const insertAssign = db.prepare(
    "INSERT OR REPLACE INTO special_task_assignments(id, taskId, teacher, loadType) VALUES(?, ?, ?, ?)"
  );

  for (const [dateVal, tasks] of Object.entries(seed.specialTasks ?? {})) {
    for (const task of tasks ?? []) {
      const taskId = task.id ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      insertTask.run(taskId, dateVal, task.name ?? "");
      for (const a of task.assignments ?? []) {
        const assignId = a.id ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        insertAssign.run(assignId, taskId, a.teacher ?? "", a.loadType ?? "full");
      }
    }
  }
}

export function getState(db) {
  const classes = db.prepare("SELECT name, level FROM classes ORDER BY level, name").all();
  const teachersRaw = db.prepare("SELECT name, specialties_json, assignments_json FROM teachers ORDER BY name").all();
  const teachers = teachersRaw.map((t) => ({
    name: t.name,
    specialties: JSON.parse(t.specialties_json || "[]"),
    assignments: JSON.parse(t.assignments_json || "{}")
  }));
  const dates = db.prepare("SELECT dateVal, display, weekday, selected FROM dates ORDER BY dateVal").all().map((d) => ({
    val: d.dateVal,
    display: d.display,
    weekday: d.weekday,
    selected: d.selected === 1
  }));

  const topicsRows = db.prepare("SELECT dateVal, className, text, color, fixedTeacher FROM topics").all();
  const topics = {};
  for (const r of topicsRows) {
    topics[`${r.dateVal}_${r.className}`] = {
      text: r.text,
      color: r.color,
      fixedTeacher: r.fixedTeacher || ""
    };
  }

  const locks = db.prepare("SELECT * FROM locks ORDER BY createdAt").all();

  const tasksRows = db.prepare("SELECT id, dateVal, name FROM special_tasks ORDER BY dateVal, id").all();
  const assignsRows = db.prepare("SELECT id, taskId, teacher, loadType FROM special_task_assignments ORDER BY taskId, id").all();
  const assignsByTask = new Map();
  for (const a of assignsRows) {
    if (!assignsByTask.has(a.taskId)) assignsByTask.set(a.taskId, []);
    assignsByTask.get(a.taskId).push({ id: a.id, teacher: a.teacher, loadType: a.loadType });
  }
  const specialTasks = {};
  for (const t of tasksRows) {
    specialTasks[t.dateVal] ??= [];
    specialTasks[t.dateVal].push({
      id: t.id,
      name: t.name,
      assignments: assignsByTask.get(t.id) ?? []
    });
  }

  return {
    meta: { version: 2, dbPath: DB_PATH },
    classes: classes.map((c) => ({ name: c.name, level: c.level })),
    teachers,
    dates,
    topics,
    specialTasks,
    locks
  };
}

export function setConfig(db, patch) {
  const tx = db.transaction(() => {
    if (patch.classes) {
      db.prepare("DELETE FROM classes").run();
      const insertClass = db.prepare("INSERT INTO classes(name, level) VALUES(?, ?)");
      for (const c of patch.classes) insertClass.run(c.name, c.level ?? parseLevelFromClass(c.name));
    }
    if (patch.teachers) {
      db.prepare("DELETE FROM teachers").run();
      const insertTeacher = db.prepare("INSERT INTO teachers(name, specialties_json, assignments_json) VALUES(?, ?, ?)");
      for (const t of patch.teachers) {
        insertTeacher.run(t.name, JSON.stringify(t.specialties ?? []), JSON.stringify(t.assignments ?? {}));
      }
    }
    if (patch.dates) {
      db.prepare("DELETE FROM dates").run();
      const insertDate = db.prepare("INSERT INTO dates(dateVal, display, weekday, selected) VALUES(?, ?, ?, ?)");
      for (const d of patch.dates) insertDate.run(d.val, d.display, d.weekday, d.selected === false ? 0 : 1);
    }
    if (patch.topics) {
      db.prepare("DELETE FROM topics").run();
      const insertTopic = db.prepare("INSERT INTO topics(dateVal, className, text, color, fixedTeacher) VALUES(?, ?, ?, ?, ?)");
      for (const [key, val] of Object.entries(patch.topics)) {
        const [dateVal, className] = key.split("_");
        insertTopic.run(dateVal, className, val.text ?? "", val.color ?? "#ffffff", val.fixedTeacher ?? "");
      }
    }
    if (patch.specialTasks) {
      db.prepare("DELETE FROM special_task_assignments").run();
      db.prepare("DELETE FROM special_tasks").run();
      const insertTask = db.prepare("INSERT INTO special_tasks(id, dateVal, name) VALUES(?, ?, ?)");
      const insertAssign = db.prepare("INSERT INTO special_task_assignments(id, taskId, teacher, loadType) VALUES(?, ?, ?, ?)");
      for (const [dateVal, tasks] of Object.entries(patch.specialTasks)) {
        for (const task of tasks ?? []) {
          insertTask.run(task.id, dateVal, task.name ?? "");
          for (const a of task.assignments ?? []) {
            insertAssign.run(a.id ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`, task.id, a.teacher ?? "", a.loadType ?? "full");
          }
        }
      }
    }
  });
  tx();
}

export function createLock(db, { teacher, dateVal, className }) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const now = new Date().toISOString();
  // insert will fail if unique locked slot exists
  db.prepare(
    "INSERT INTO locks(id, teacher, dateVal, className, status, createdAt) VALUES(?, ?, ?, ?, 'locked', ?)"
  ).run(id, teacher, dateVal, className, now);
  return id;
}

export function releaseLock(db, { lockId }) {
  const now = new Date().toISOString();
  db.prepare("UPDATE locks SET status='released', releasedAt=? WHERE id=?").run(now, lockId);
}

export function saveExport(db, { schedule }) {
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO exports(id, createdAt, schedule_json) VALUES(?, ?, ?)").run(
    id,
    createdAt,
    JSON.stringify(schedule ?? [])
  );
  return id;
}

export function getLatestExport(db) {
  const row = db.prepare("SELECT id, createdAt, schedule_json FROM exports ORDER BY createdAt DESC LIMIT 1").get();
  if (!row) return null;
  return { id: row.id, createdAt: row.createdAt, schedule: JSON.parse(row.schedule_json || "[]") };
}

export function updateLatestExportCell(db, { dateVal, className, teacher }) {
  const latest = getLatestExport(db);
  if (!latest) return null;
  const schedule = latest.schedule;
  const row = schedule.find((r) => r.dateVal === dateVal);
  if (!row) return latest;
  row.assignments ??= {};
  row.assignments[className] ??= { teacher: "", topic: "", color: "#ffffff", isFixed: false };
  row.assignments[className].teacher = teacher;
  db.prepare("UPDATE exports SET schedule_json=? WHERE id=?").run(JSON.stringify(schedule), latest.id);
  return { ...latest, schedule };
}

