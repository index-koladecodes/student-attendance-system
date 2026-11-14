'use strict';
const { Schema, model } = require('mongoose');

const courseSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 20 },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    lecturer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = model('Course', courseSchema);
