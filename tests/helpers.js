'use strict';
// Shared test helpers: environment, database connection and a cookie-keeping HTTP client.
process.env.BCRYPT_ROUNDS = '4';
process.env.JWT_SECRET = 'test-secret-not-for-production';
process.env.ATTENDANCE_THRESHOLD = '75';

const mongoose = require('mongoose');
const config = require('../src/config');

async function connect(dbName) {
  await mongoose.connect(config.mongoUri, { dbName, serverSelectionTimeoutMS: 8000 });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}
async function disconnect() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

// A tiny "browser tab": remembers the session cookie between calls.
function client(base) {
  let cookie = '';
  async function call(method, path, body, rawBody) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: rawBody !== undefined ? rawBody : body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie();
    const token = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('token='));
    if (token !== undefined) cookie = token === 'token=' ? '' : token;
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers, setCookies };
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    raw: (p, text) => call('POST', p, null, text),
    setToken: (t) => { cookie = `token=${t}`; },
  };
}

module.exports = { connect, disconnect, listen, client };
