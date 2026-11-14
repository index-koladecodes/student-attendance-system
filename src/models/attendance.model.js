'use strict';
const { Schema, model } = require('mongoose');

const attendanceSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    // Calendar day as 'YYYY-MM-DD' (a plain string avoids time-zone shifts for a "day" record).
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: String, required: true, enum: ['present', 'late', 'absent'] },
    markedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One record per student, per course, per day. Re-marking updates this record instead of adding another.
attendanceSchema.index({ course: 1, student: 1, date: 1 }, { unique: true });
// Fast "who attended on this day" and "all sessions for this course" lookups.
attendanceSchema.index({ course: 1, date: 1 });

module.exports = model('Attendance', attendanceSchema);
