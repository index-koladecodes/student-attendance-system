'use strict';
const { Schema, model } = require('mongoose');

const studentSchema = new Schema(
  {
    // Login account for this student. Left out entirely (not null) when the record was
    // pre-created by an admin, so the sparse unique index below ignores it.
    user: { type: Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
    matricNo: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40 },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: String, trim: true, maxlength: 120, default: null },
    level: { type: String, trim: true, maxlength: 20, default: null },
  },
  { timestamps: true }
);

module.exports = model('Student', studentSchema);
