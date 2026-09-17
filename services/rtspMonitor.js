const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { db } = require('../data/store');

function sanitizeName(name) {
  return String(name || 'camera').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function probeStream(rtspUrl, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = timeoutMs || config.streamTimeoutSeconds * 1000;
    execFile(
      'ffprobe',
      ['-v', 'quiet', '-rtsp_transport', 'tcp', '-print_format', 'json', '-show_streams', '-show_error', rtspUrl],
      { timeout },
      (error) => resolve(!error)
    );
  });
}

function captureFrame(rtspUrl, cameraName, cameraId) {
  return new Promise((resolve, reject) => {
    const captureDir = path.join(config.captureDir, String(cameraId));
    fs.mkdirSync(captureDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${sanitizeName(cameraName)}_${timestamp}.jpg`;
    const filePath = path.join(captureDir, fileName);

    const timeoutMicro = config.streamTimeoutSeconds * 1000000;
    execFile(
      'ffmpeg',
      ['-y', '-timeout', String(timeoutMicro), '-rtsp_transport', 'tcp', '-i', rtspUrl, '-vframes', '1', '-q:v', '2', filePath],
      { timeout: config.streamTimeoutSeconds * 1000 + 5000 },
      (error) => {
        if (error) reject(error);
        else resolve(filePath);
      }
    );
  });
}

function monitorStreams(cameras, callback) {
  const results = [];
  for (const camera of cameras) {
    results.push(
      probeStream(camera.rtsp_url).then((isOnline) => {
        const prevStatus = db.prepare('SELECT is_online, last_changed FROM stream_status WHERE camera_id = ?').get(camera.id);
        const now = new Date().toISOString();
        const wasOnline = prevStatus ? prevStatus.is_online : 0;

        if (wasOnline !== isOnline) {
          db.prepare(`
            INSERT INTO stream_status (camera_id, is_online, last_checked, last_changed)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(camera_id) DO UPDATE SET is_online=excluded.is_online, last_checked=excluded.last_checked, last_changed=excluded.last_changed
          `).run(camera.id, isOnline ? 1 : 0, now, now);
        } else {
          db.prepare(`
            INSERT INTO stream_status (camera_id, is_online, last_checked, last_changed)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(camera_id) DO UPDATE SET last_checked=excluded.last_checked
          `).run(camera.id, isOnline ? 1 : 0, now, prevStatus ? prevStatus.last_changed : now);
        }

        callback(camera.id, isOnline);
        return { id: camera.id, name: camera.name, rtsp_url: camera.rtsp_url, is_online: isOnline, is_active: camera.is_active };
      }).catch(() => {
        const now = new Date().toISOString();
        const prevStatus = db.prepare('SELECT last_changed FROM stream_status WHERE camera_id = ?').get(camera.id);
        db.prepare(`
          INSERT INTO stream_status (camera_id, is_online, last_checked, last_changed)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(camera_id) DO UPDATE SET is_online=0, last_checked=excluded.last_checked, last_changed=excluded.last_changed
        `).run(camera.id, 0, now, prevStatus ? prevStatus.last_changed : now);
        callback(camera.id, false);
        return { id: camera.id, name: camera.name, rtsp_url: camera.rtsp_url, is_online: false, is_active: camera.is_active };
      })
    );
  }
  return Promise.all(results);
}

module.exports = { probeStream, captureFrame, monitorStreams };
