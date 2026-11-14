'use strict';

// Attendance rate (%): a student counts as attending when marked present OR late.
// Sessions where the student was absent or not marked at all count against them.
// Returns null when no sessions have been held yet (nothing to measure).
function attendanceRate(present, late, sessions) {
  if (!sessions) return null;
  return Math.round(((present + late) / sessions) * 1000) / 10;
}

module.exports = { attendanceRate };
