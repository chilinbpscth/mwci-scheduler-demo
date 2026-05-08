import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((p) => p.text).join("");
    if (v.text) return v.text;
  }
  return String(v);
}

function excelFillToHex(fill) {
  try {
    const argb = fill?.fgColor?.argb;
    if (!argb || typeof argb !== "string" || argb.length < 8) return "#ffffff";
    return "#" + argb.slice(2).toUpperCase();
  } catch {
    return "#ffffff";
  }
}

function parseDateVal(dateDisplay) {
  // matches original html uploadHistory heuristic
  const m = String(dateDisplay).match(/(\d+)/g);
  if (!m || m.length < 3) return null;
  return `${m[0]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

async function main() {
  const classesTeachersXlsx = process.argv[2];
  const historyXlsx = process.argv[3];
  if (!classesTeachersXlsx || !historyXlsx) {
    console.error("Usage: node scripts/generate-seed.mjs <classes_teachers.xlsx> <history.xlsx>");
    process.exit(1);
  }

  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.readFile(classesTeachersXlsx);
  const wsClasses = wb1.getWorksheet("班級設定");
  const wsTeachers = wb1.getWorksheet("教師設定");

  const classes = [];
  wsClasses?.eachRow((r, i) => {
    if (i === 1) return;
    const name = cellText(r.getCell(1).value).trim();
    if (name) classes.push({ name });
  });

  const teacherMap = new Map();
  wsTeachers?.eachRow((r, i) => {
    if (i === 1) return;
    const name = cellText(r.getCell(1).value).trim();
    const cls = cellText(r.getCell(2).value).trim();
    const roleRaw = cellText(r.getCell(3).value).trim();
    const specRaw = cellText(r.getCell(4).value).trim();
    if (!name) return;
    if (!teacherMap.has(name)) {
      teacherMap.set(name, { name, assignments: {}, specialties: [] });
    }
    const t = teacherMap.get(name);
    if (cls) t.assignments[cls] = roleRaw.includes("主") && !roleRaw.includes("非") ? "main" : "sub";
    if (specRaw) {
      for (const s of specRaw.split(/[,，]+/)) {
        const clean = s.trim();
        if (clean && !t.specialties.includes(clean)) t.specialties.push(clean);
      }
    }
  });

  const teachers = Array.from(teacherMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  // History workbook for initial dates/topics (take first 10 days)
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(historyXlsx);
  const ws = wb2.getWorksheet("工作表1") || wb2.worksheets[0];

  const dates = [];
  const topics = {};

  if (ws) {
    // Build class map from row 2
    const colMap = {};
    const classRow = ws.getRow(2);
    classRow.eachCell((cell, colNumber) => {
      const val = cellText(cell.value).trim();
      if (colNumber > 1 && val) colMap[colNumber] = val;
    });

    let pendingTopicRow = null;
    let count = 0;
    ws.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;
      if (count >= 10) return;
      if (!pendingTopicRow) {
        pendingTopicRow = row;
        return;
      }
      const teacherRow = row;
      const cell1 = pendingTopicRow.getCell(1).value;
      const cell2 = teacherRow.getCell(1).value;
      const dateDisplay = cell1 ? cellText(cell1) : cell2 ? cellText(cell2) : "";
      const dateVal = parseDateVal(dateDisplay);
      if (dateVal) {
        const d = new Date(dateVal);
        const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
        dates.push({
          val: dateVal,
          display: `${d.getMonth() + 1}/${d.getDate()}`,
          weekday: weekDays[d.getDay()],
          selected: true
        });

        for (const [colIdx, clsName] of Object.entries(colMap)) {
          const topicCell = pendingTopicRow.getCell(Number(colIdx));
          const text = cellText(topicCell.value).trim();
          const color = excelFillToHex(topicCell.fill);
          if (text || color) {
            topics[`${dateVal}_${clsName}`] = { text, color, fixedTeacher: "" };
          }
        }
        count++;
      }

      pendingTopicRow = null;
    });
  }

  const seed = {
    meta: { generatedAt: new Date().toISOString() },
    classes,
    teachers,
    dates,
    topics,
    specialTasks: {}
  };

  const outDir = path.resolve(process.cwd(), "seed");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "seed.json");
  await fs.writeFile(outPath, JSON.stringify(seed, null, 2), "utf8");
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

