import ExcelJS from "exceljs";

function getContrastColor(hexColor) {
  if (!hexColor) return "#000000";
  const hex = hexColor.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}

function parseClasses(classes) {
  return classes.map((c) => {
    const name = c.name;
    const match = name.match(/(\d+)/);
    const level = match ? Number.parseInt(match[1], 10) : 1;
    return { name, level };
  });
}

function computeTeacherTotals(parsedClasses, teachers, scheduleRows) {
  const allTeacherNames = teachers.map((t) => t.name);
  const totals = {};
  allTeacherNames.forEach((t) => (totals[t] = 0));

  for (const row of scheduleRows) {
    for (const cls of parsedClasses) {
      const cellData = row.assignments?.[cls.name];
      const tStr = cellData?.teacher;
      if (!tStr || tStr === "TBD") continue;
      const isShared = String(tStr).length > 1 || /[,，/]/.test(String(tStr));
      for (const tName of allTeacherNames) {
        if (String(tStr).includes(tName)) {
          totals[tName] = (totals[tName] ?? 0) + (isShared ? 1 : 2);
        }
      }
    }

    // Special tasks
    for (const task of row.specialTaskResults ?? []) {
      for (const tStr of task.teachers ?? []) {
        let load = 2;
        if (String(tStr).includes("(1)")) load = 1;
        else if (String(tStr).includes("(2)")) load = 1;
        else if (String(tStr).includes("(0)")) load = 0;
        for (const tName of allTeacherNames) {
          if (String(tStr).includes(tName)) {
            totals[tName] = (totals[tName] ?? 0) + load;
          }
        }
      }
    }
  }

  return allTeacherNames
    .map((name) => ({ name, count: totals[name] ?? 0 }))
    .sort((a, b) => b.count - a.count);
}

export async function exportToExcelBuffer({ classes, teachers, scheduleRows }) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("工作表1");

  const centerStyle = { vertical: "middle", horizontal: "center", wrapText: true };
  const borderStyle = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" }
  };

  const parsedClasses = parseClasses(classes);

  const columns = [{ header: "", key: "date", width: 20 }];
  parsedClasses.forEach((cls) => columns.push({ header: cls.name, key: cls.name, width: 15 }));
  columns.push({ header: "特別任務", key: "specialTasks", width: 30 });
  ws.columns = columns;

  const levelRow = ws.getRow(1);
  levelRow.values = ["", ...parsedClasses.map((c) => `P${c.level}`), ""];
  const classRow = ws.getRow(2);
  classRow.values = ["", ...parsedClasses.map((c) => c.name), "特別任務"];
  [levelRow, classRow].forEach((r) => {
    r.eachCell((cell) => {
      cell.alignment = centerStyle;
      cell.font = { bold: true };
      cell.border = borderStyle;
    });
  });

  // Merge P-level headers like v6.41
  let mergeStart = 2;
  let curVal = levelRow.getCell(2).value;
  for (let i = 3; i <= parsedClasses.length + 1; i++) {
    if (levelRow.getCell(i).value !== curVal) {
      if (i - 1 > mergeStart) ws.mergeCells(1, mergeStart, 1, i - 1);
      mergeStart = i;
      curVal = levelRow.getCell(i).value;
    }
  }
  if (parsedClasses.length + 1 > mergeStart) ws.mergeCells(1, mergeStart, 1, parsedClasses.length + 1);

  for (const schedRow of scheduleRows) {
    const dateStr = schedRow.dateVal
      ? (() => {
          const dObj = new Date(schedRow.dateVal);
          const wd = schedRow.weekday ?? "";
          return `${dObj.getFullYear()}年${dObj.getMonth() + 1}月${dObj.getDate()}日(${wd})`;
        })()
      : schedRow.dateDisplay ?? "";

    const specialTaskStr = (schedRow.specialTaskResults ?? [])
      .map((t) => `${t.name}: ${(t.teachers ?? []).join(", ")}`)
      .join("\n");

    const rowA = ws.addRow([
      dateStr,
      ...parsedClasses.map((c) => schedRow.assignments?.[c.name]?.topic || ""),
      specialTaskStr
    ]);
    const rowB = ws.addRow([
      "",
      ...parsedClasses.map((c) => schedRow.assignments?.[c.name]?.teacher || ""),
      ""
    ]);

    [rowA, rowB].forEach((r) => {
      r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber <= parsedClasses.length + 2) {
          cell.border = borderStyle;
          cell.alignment = centerStyle;
        }
      });
    });

    ws.mergeCells(rowA.number, 1, rowB.number, 1);
    ws.getCell(rowA.number, 1).border = borderStyle;

    const taskColIdx = parsedClasses.length + 2;
    ws.mergeCells(rowA.number, taskColIdx, rowB.number, taskColIdx);

    // Apply color fills + merge same topic blocks (v6.41 behavior)
    let colIdx = 2;
    while (colIdx <= parsedClasses.length + 1) {
      const clsName = parsedClasses[colIdx - 2].name;
      const cellData = schedRow.assignments?.[clsName];
      const cell = rowA.getCell(colIdx);

      if (cellData?.color) {
        const argb = "FF" + String(cellData.color).replace("#", "").toUpperCase();
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        const contrastColor = getContrastColor(cellData.color);
        cell.font = { color: { argb: contrastColor === "#ffffff" ? "FFFFFFFF" : "FF000000" } };
      }

      const topicText = cell.value;
      if (topicText) {
        let mergeCount = 0;
        for (let next = colIdx + 1; next <= parsedClasses.length + 1; next++) {
          const nextCell = rowA.getCell(next);
          if (nextCell.value === topicText) {
            mergeCount++;
            const nextCls = parsedClasses[next - 2].name;
            const nextData = schedRow.assignments?.[nextCls];
            if (nextData?.color) {
              const nextArgb = "FF" + String(nextData.color).replace("#", "").toUpperCase();
              nextCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: nextArgb } };
              const contrastColor = getContrastColor(nextData.color);
              nextCell.font = { color: { argb: contrastColor === "#ffffff" ? "FFFFFFFF" : "FF000000" } };
            }
          } else break;
        }
        if (mergeCount > 0) {
          ws.mergeCells(rowA.number, colIdx, rowA.number, colIdx + mergeCount);
          ws.getCell(rowA.number, colIdx).border = borderStyle;
          colIdx += mergeCount + 1;
        } else colIdx++;
      } else colIdx++;
    }
  }

  const wsStats = workbook.addWorksheet("總節數");
  wsStats.addRow(["教師代號", "總節數"]);
  const teacherTotals = computeTeacherTotals(parsedClasses, teachers, scheduleRows);
  teacherTotals.forEach((s) => wsStats.addRow([s.name, s.count]));

  // 連續工作檢核 (copied from v6.41 intent; based on participation streak >= 5)
  const wsCheck = workbook.addWorksheet("連續工作檢核");
  const allTeacherNames = teachers.map((t) => t.name).sort();
  wsCheck.addRow(["日期", ...allTeacherNames]);

  const teacherLoadMatrix = {};
  const teacherWorkedMatrix = {};
  allTeacherNames.forEach((t) => {
    teacherLoadMatrix[t] = new Array(scheduleRows.length).fill(0);
    teacherWorkedMatrix[t] = new Array(scheduleRows.length).fill(false);
  });

  scheduleRows.forEach((row, rIdx) => {
    // classes
    parsedClasses.forEach((cls) => {
      const cellData = row.assignments?.[cls.name];
      const tStr = cellData?.teacher;
      if (!tStr || tStr === "TBD") return;
      const isShared = String(tStr).length > 1 || /[,，/]/.test(String(tStr));
      allTeacherNames.forEach((tName) => {
        if (String(tStr).includes(tName)) {
          teacherWorkedMatrix[tName][rIdx] = true;
          teacherLoadMatrix[tName][rIdx] += isShared ? 1 : 2;
        }
      });
    });
    // special tasks
    (row.specialTaskResults ?? []).forEach((task) => {
      (task.teachers ?? []).forEach((tStr) => {
        let load = 2;
        if (String(tStr).includes("(1)")) load = 1;
        else if (String(tStr).includes("(2)")) load = 1;
        else if (String(tStr).includes("(0)")) load = 0;
        allTeacherNames.forEach((tName) => {
          if (String(tStr).includes(tName)) {
            teacherWorkedMatrix[tName][rIdx] = true;
            teacherLoadMatrix[tName][rIdx] += load;
          }
        });
      });
    });
  });

  const teacherHighlights = {};
  allTeacherNames.forEach((t) => {
    teacherHighlights[t] = new Array(scheduleRows.length).fill(false);
    const timeline = teacherWorkedMatrix[t];
    let start = -1;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i]) {
        if (start === -1) start = i;
      } else {
        if (start !== -1) {
          if (i - start >= 5) for (let k = start; k < i; k++) teacherHighlights[t][k] = true;
          start = -1;
        }
      }
    }
    if (start !== -1 && timeline.length - start >= 5) {
      for (let k = start; k < timeline.length; k++) teacherHighlights[t][k] = true;
    }
  });

  scheduleRows.forEach((row, rIdx) => {
    const dateLabel = row.dateVal || row.dateDisplay || "";
    const rowData = [dateLabel];
    allTeacherNames.forEach((t) => {
      rowData.push(teacherWorkedMatrix[t][rIdx] ? teacherLoadMatrix[t][rIdx] : "");
    });
    const excelRow = wsCheck.addRow(rowData);
    allTeacherNames.forEach((t, tIdx) => {
      if (teacherHighlights[t][rIdx]) {
        const cell = excelRow.getCell(tIdx + 2);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
        cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
      }
    });
  });

  return await workbook.xlsx.writeBuffer();
}

