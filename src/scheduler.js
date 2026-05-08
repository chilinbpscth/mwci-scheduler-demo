// Server-side scheduler aligned to v6.41 intent:
// - Fixed teachers (locks + topic.fixedTeacher) are applied first with conflict detection.
// - Then special tasks with conflict detection (conflicts become TBD).
// - Remaining cells are auto-assigned using: load balance > class preference > specialty > fatigue (optional) > random.

const BASE_LOAD = 2;

export function getTeacherSlots(str) {
  if (!str) return [null, null];
  const s = String(str).trim();
  if (!s || s === "TBD") return [null, null];
  if (s.includes(",") || s.includes("，") || s.includes("/")) {
    const parts = s.split(/[,，/]+/);
    const p1 = parts[0] === "" ? null : parts[0];
    const p2 = parts.length > 1 ? (parts[1] === "" ? null : parts[1]) : p1;
    return [p1, p2];
  }
  if (s.length > 1) return [s[0], s[1]];
  return [s, s];
}

function updateTeacherLoad(teacherStr, loadMap, value = BASE_LOAD) {
  if (!teacherStr || teacherStr === "TBD") return;
  const [s1, s2] = getTeacherSlots(teacherStr);
  if (s1 && s2 && s1 === s2) {
    loadMap[s1] = (loadMap[s1] ?? 0) + value;
  } else {
    if (s1) loadMap[s1] = (loadMap[s1] ?? 0) + 1;
    if (s2) loadMap[s2] = (loadMap[s2] ?? 0) + 1;
  }
}

function isNoScheduleTeacherStr(str) {
  const s = String(str ?? "").trim();
  return s === "/" || s === "";
}

export function generateSchedule({
  classes,
  teachers,
  dates,
  topics,
  specialTasks,
  locks,
  baseTeacherLoad = {}
}) {
  const teacherLoad = {};
  for (const t of teachers) teacherLoad[t.name] = baseTeacherLoad[t.name] ?? 0;

  const parsedClasses = classes.map((c) => {
    const name = c.name;
    const match = name.match(/(\d+)/);
    const level = match ? Number.parseInt(match[1], 10) : 1;
    return { name, level };
  });

  const selectedDates = dates.filter((d) => d.selected !== false);
  const result = [];
  const tbdErrors = [];

  // Pre-index locks by date+class.
  const lockMap = new Map();
  for (const l of locks) {
    if (l.status && l.status !== "locked") continue;
    lockMap.set(`${l.dateVal}_${l.className}`, l.teacher);
  }

  for (const date of selectedDates) {
    const busySlots = {}; // teacherName -> {1:boolean,2:boolean}
    const rowAssignments = {};
    const row = {
      dateVal: date.val,
      dateDisplay: date.display,
      weekday: date.weekday,
      assignments: {},
      specialTaskResults: []
    };

    // 1) Apply fixed teachers: locks override topics[*].fixedTeacher.
    // Also detect fixed-vs-fixed conflicts and turn those cells into TBD (to be gated upstream).
    const fixedCells = [];
    for (const cls of parsedClasses) {
      const key = `${date.val}_${cls.name}`;
      const topicData = topics[key] ?? { text: "", color: "#ffffff", fixedTeacher: "" };
      const lockedTeacher = lockMap.get(key);
      const fixedTeacher = lockedTeacher ?? topicData.fixedTeacher;
      if (isNoScheduleTeacherStr(fixedTeacher)) continue;

      const tStr = String(fixedTeacher).trim();
      if (!tStr || tStr === "TBD") {
        rowAssignments[cls.name] = {
          teacher: "TBD",
          topic: topicData.text ?? "",
          color: topicData.color ?? "#ffffff",
          isFixed: false
        };
        tbdErrors.push(`${date.val} - ${cls.name} (課堂)`);
        continue;
      }

      const [s1, s2] = getTeacherSlots(tStr);
      const cell = {
        className: cls.name,
        teacher: tStr,
        topic: topicData.text ?? "",
        color: topicData.color ?? "#ffffff",
        isFixed: true
      };
      fixedCells.push({ ...cell, s1, s2 });
      rowAssignments[cls.name] = cell;
    }

    // Fixed-vs-fixed slot conflicts (same teacher in same period across classes).
    // Mark both as TBD to match v6.41 "conflict => TBD" behavior.
    const seen = {}; // teacher -> {1: className, 2: className}
    for (const fc of fixedCells) {
      const { teacher, className, s1, s2 } = fc;
      seen[teacher] ??= { 1: null, 2: null };
      if (s1 && seen[teacher][1] && seen[teacher][1] !== className) {
        rowAssignments[className].teacher = "TBD";
        rowAssignments[seen[teacher][1]].teacher = "TBD";
        rowAssignments[className].isFixed = false;
        rowAssignments[seen[teacher][1]].isFixed = false;
        tbdErrors.push(`${date.val} - ${className} (課堂)`);
        tbdErrors.push(`${date.val} - ${seen[teacher][1]} (課堂)`);
      } else if (s1) {
        seen[teacher][1] = className;
      }
      if (s2 && seen[teacher][2] && seen[teacher][2] !== className) {
        rowAssignments[className].teacher = "TBD";
        rowAssignments[seen[teacher][2]].teacher = "TBD";
        rowAssignments[className].isFixed = false;
        rowAssignments[seen[teacher][2]].isFixed = false;
        tbdErrors.push(`${date.val} - ${className} (課堂)`);
        tbdErrors.push(`${date.val} - ${seen[teacher][2]} (課堂)`);
      } else if (s2) {
        seen[teacher][2] = className;
      }
    }

    // Apply non-TBD fixed cells to busySlots + load
    for (const cls of parsedClasses) {
      const cell = rowAssignments[cls.name];
      if (!cell || cell.teacher === "TBD") continue;
      if (!cell.isFixed) continue;
      updateTeacherLoad(cell.teacher, teacherLoad, BASE_LOAD);
      const [s1, s2] = getTeacherSlots(cell.teacher);
      if (s1) {
        busySlots[s1] ??= { 1: false, 2: false };
        busySlots[s1][1] = true;
      }
      if (s2) {
        busySlots[s2] ??= { 1: false, 2: false };
        busySlots[s2][2] = true;
      }
    }

    // 2) Special tasks (v6.41-like, conflicts become TBD)
    const dayTasks = specialTasks?.[date.val] ?? [];
    for (const task of dayTasks) {
      const taskResult = { name: task.name, teachers: [] };
      for (const assign of task.assignments ?? []) {
        const loadValue =
          assign.loadType === "full" ? 2 : assign.loadType === "0" ? 0 : 1;
        const needs1 =
          assign.loadType === "full" || assign.loadType === "1" || assign.loadType === "0";
        const needs2 =
          assign.loadType === "full" || assign.loadType === "2" || assign.loadType === "0";

        let picked = null;
        if (assign.teacher && String(assign.teacher).trim()) {
          const tName = String(assign.teacher).trim();
          // Conflict with existing busy slots (fixed teachers or prior tasks)
          busySlots[tName] ??= { 1: false, 2: false };
          if ((needs1 && busySlots[tName][1]) || (needs2 && busySlots[tName][2])) {
            picked = "TBD";
            tbdErrors.push(`${date.val} (特別任務)`);
          } else {
            picked = tName;
          }
        } else {
          const available = teachers.filter((t) => {
            const slot = busySlots[t.name];
            if (!slot) return true;
            if (needs1 && slot[1]) return false;
            if (needs2 && slot[2]) return false;
            return true;
          });
          available.sort((a, b) => (teacherLoad[a.name] ?? 0) - (teacherLoad[b.name] ?? 0));
          picked = available[0]?.name ?? "TBD";
        }

        if (picked !== "TBD") {
          busySlots[picked] ??= { 1: false, 2: false };
          if (needs1) busySlots[picked][1] = true;
          if (needs2) busySlots[picked][2] = true;
          teacherLoad[picked] = (teacherLoad[picked] ?? 0) + loadValue;
        } else {
          // Keep TBD in result
        }

        let display = picked;
        if (assign.loadType === "1") display += "(1)";
        else if (assign.loadType === "2") display += "(2)";
        else if (assign.loadType === "0") display += "(0)";
        taskResult.teachers.push(display);
      }
      row.specialTaskResults.push(taskResult);
    }

    // 3) Auto-assign remaining classes.
    const shuffledClasses = [...parsedClasses].sort(() => Math.random() - 0.5);

    for (const cls of shuffledClasses) {
      if (rowAssignments[cls.name]) continue;
      const key = `${date.val}_${cls.name}`;
      const topicData = topics[key] ?? { text: "", color: "#ffffff", fixedTeacher: "" };
      const topicText = String(topicData.text ?? "").trim();

      let available = teachers.filter((t) => {
        const slot = busySlots[t.name];
        if (!slot) return true;
        return !slot[1] && !slot[2];
      });

      // Specialists: if topic contains specialty keywords.
      let specialists = [];
      if (topicText) {
        specialists = available.filter(
          (t) => (t.specialties ?? []).some((s) => topicText.includes(s))
        );
      }

      let candidates = [];
      if (specialists.length > 0) {
        const classSpecialists = specialists.filter((t) => t.assignments?.[cls.name]);
        candidates = classSpecialists.length > 0 ? classSpecialists : specialists;
      } else {
        candidates = available.filter((t) => t.assignments?.[cls.name]);
        if (candidates.length === 0) candidates = available;
      }

      candidates.sort((a, b) => {
        const loadA = teacherLoad[a.name] ?? 0;
        const loadB = teacherLoad[b.name] ?? 0;
        if (loadA !== loadB) return loadA - loadB;
        const roleA = a.assignments?.[cls.name] ? 1 : 0;
        const roleB = b.assignments?.[cls.name] ? 1 : 0;
        if (roleA !== roleB) return roleB - roleA;
        return Math.random() - 0.5;
      });

      const assigned = candidates[0]?.name ?? "TBD";
      if (assigned !== "TBD") {
        busySlots[assigned] ??= { 1: false, 2: false };
        busySlots[assigned][1] = true;
        busySlots[assigned][2] = true;
        teacherLoad[assigned] = (teacherLoad[assigned] ?? 0) + BASE_LOAD;
      } else {
        tbdErrors.push(`${date.val} - ${cls.name} (課堂)`);
      }

      rowAssignments[cls.name] = {
        teacher: assigned,
        topic: topicText,
        color: topicData.color ?? "#ffffff",
        isFixed: false
      };
    }

    row.assignments = rowAssignments;
    result.push(row);
  }

  return { schedule: result, teacherLoad, tbdErrors: Array.from(new Set(tbdErrors)) };
}

