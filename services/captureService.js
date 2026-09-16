const path = require('path');
const config = require('../config');
const { db } = require('../data/store');
const { probeStream, captureFrame } = require('./rtspMonitor');

async function triggerCapture(cameraId, triggeredBy) {
  const camera = db.prepare('SELECT id, name, rtsp_url, is_active FROM cameras WHERE id = ?').get(cameraId);
  if (!camera) {
    throw new Error(`Camera ${cameraId} not found`);
  }
  if (!camera.is_active) {
    throw new Error(`Camera ${cameraId} is not active`);
  }

  const isOnline = await probeStream(camera.rtsp_url);
  if (!isOnline) {
    throw new Error(`Camera ${cameraId} is offline`);
  }

  const filePath = await captureFrame(camera.rtsp_url, camera.name, camera.id);
  const relativePath = path.relative(process.cwd(), filePath);

  const info = db.prepare(`
    INSERT INTO captures (camera_id, file_path, triggered_by)
    VALUES (?, ?, ?)
  `).run(cameraId, relativePath, triggeredBy || 'manual');

  return { id: info.lastInsertRowid, cameraId, filePath: relativePath, timestamp: new Date().toISOString() };
}

function getCaptureHistory(cameraId, limit) {
  let query = `
    SELECT c.id, c.camera_id, cam.name AS camera_name, c.file_path, c.triggered_by, c.captured_at
    FROM captures c
    JOIN cameras cam ON c.camera_id = cam.id
  `;
  const params = [];
  if (cameraId) {
    query += ' WHERE c.camera_id = ?';
    params.push(cameraId);
  }
  query += ' ORDER BY c.captured_at DESC LIMIT ?';
  params.push(limit || 50);
  return db.prepare(query).all(...params);
}

module.exports = { triggerCapture, getCaptureHistory };
