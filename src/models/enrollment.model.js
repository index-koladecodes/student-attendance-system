'use strict';
const { Schema, model } = require('mongoose');

const enrollmentSchema = new Schema(
  {
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  },
  { timestamps: true }
);

// A student can be enrolled in a given course only once.
enrollmentSchema.index({ course: 1, student: 1 }, { unique: true });
enrollmentSchema.index({ student: 1 });

module.exports = model('Enrollment', enrollmentSchema);
