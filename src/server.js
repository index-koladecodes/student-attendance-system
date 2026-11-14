'use strict';
const config = require('./config');
const { connectDB, mongoose } = require('./db');
const { createApp } = require('./app');

(async () => {
  await connectDB(config.mongoUri);
  console.log('MongoDB connected');
  const server = createApp().listen(config.port, () => {
    console.log(`Student Attendance System running at http://localhost:${config.port}`);
  });
  const shutdown = () => server.close(async () => { await mongoose.disconnect(); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error('Could not start the server:', err.message);
  process.exit(1);
});
