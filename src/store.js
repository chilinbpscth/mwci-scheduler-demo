import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.resolve(process.cwd(), "data.json");

const DEFAULT_DATA = {
  meta: { version: 1, createdAt: new Date().toISOString() },
  classes: [{ name: "1A" }, { name: "1B" }],
  teachers: [
    { id: "T1", name: "趙", specialties: ["STEAM"], assignments: { "1A": "main" } },
    { id: "T2", name: "嫻", specialties: ["閱讀"], assignments: { "1B": "main" } }
  ],
  dates: [
    { val: "2026-05-11", display: "5/11", weekday: "一", selected: true },
    { val: "2026-05-15", display: "5/15", weekday: "五", selected: true }
  ],
  topics: {
    "2026-05-11_1A": { text: "STEAM", color: "#CAFFFF" },
    "2026-05-11_1B": { text: "閱讀", color: "#FFFFB9" },
    "2026-05-15_1A": { text: "體適能", color: "#BBFFBB" },
    "2026-05-15_1B": { text: "魔力橋", color: "#FFDCB9" }
  },
  specialTasks: {},
  locks: [],
  pointsLedger: []
};

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readData() {
  if (!(await fileExists(DATA_PATH))) {
    await writeData(DEFAULT_DATA);
    return structuredClone(DEFAULT_DATA);
  }
  const raw = await fs.readFile(DATA_PATH, "utf8");
  return JSON.parse(raw);
}

export async function writeData(next) {
  const tmp = `${DATA_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, DATA_PATH);
}

export async function updateData(mutator) {
  const cur = await readData();
  const next = await mutator(cur);
  await writeData(next);
  return next;
}

export function computeTeacherPoints(teacherName, scheduleRows) {
  // Points scheme A:
  // - A class cell is 2 points total; if shared, each gets 1.
  // - Special tasks: full=2, (1)/(2)=1, (0)=0. (We store it in export only for now.)

  let points = 0;
  for (const row of scheduleRows) {
    for (const clsName of Object.keys(row.assignments ?? {})) {
      const cell = row.assignments[clsName];
      if (!cell?.teacher || cell.teacher === "TBD") continue;
      const tStr = cell.teacher;
      const isShared = tStr.length > 1 || /[,，/]/.test(tStr);
      if (!tStr.includes(teacherName)) continue;
      points += isShared ? 1 : 2;
    }
  }
  return points;
}

