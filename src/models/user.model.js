'use strict';
const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    passwordHash: { type: String, required: true, select: false }, // never returned by default
    role: { type: String, required: true, enum: ['admin', 'lecturer', 'student'] },
  },
  { timestamps: true }
);

module.exports = model('User', userSchema);
