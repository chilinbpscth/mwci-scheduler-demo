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

  const parsedClasses = classes.map((c) => {
    const name = c.name;
    const match = name.match(/(\d+)/);
    const level = match ? Number.parseInt(match[1], 10) : 1;
    return { name, level };
  });

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

    // Apply color fills
    for (let i = 0; i < parsedClasses.length; i++) {
      const clsName = parsedClasses[i].name;
      const cellData = schedRow.assignments?.[clsName];
      const cell = rowA.getCell(i + 2);
      if (cellData?.color) {
        const argb = "FF" + String(cellData.color).replace("#", "").toUpperCase();
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        const contrastColor = getContrastColor(cellData.color);
        cell.font = {
          color: { argb: contrastColor === "#ffffff" ? "FFFFFFFF" : "FF000000" }
        };
      }
    }
  }

  const wsStats = workbook.addWorksheet("總節數");
  wsStats.addRow(["教師代號", "總節數(points)"]);
  // points in demo: we treat 2節=2 points. Stats are handled server-side; this sheet is a placeholder.
  teachers.forEach((t) => wsStats.addRow([t.name, ""]));

  return await workbook.xlsx.writeBuffer();
}

