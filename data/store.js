const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const dbPath = path.join(config.dataDir, 'rtsp.db');
fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rtsp_url TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL,
    cron_expression TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL,
    file_path TEXT,
    triggered_by TEXT DEFAULT 'manual',
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS stream_status (
    camera_id INTEGER PRIMARY KEY,
    is_online INTEGER DEFAULT 0,
    last_checked DATETIME,
    last_changed DATETIME,
    FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
  );
`);

module.exports = { db };
