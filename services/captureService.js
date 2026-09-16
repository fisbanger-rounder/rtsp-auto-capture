const path = require('path');
const fs = require('fs');
const config = require('../config');
const { db, getSettings } = require('../data/store');
const { probeStream, captureFrame } = require('./rtspMonitor');

// Sends the captured JPEG as multipart/form-data to the configured upload server.
// fieldName is configurable (settings.upload_field). fileName is
// "<camera_source>_<timestamp>.jpg" so the receiver always knows the source and time.
async function uploadImage(filePath, uploadUrl, options = {}) {
  const fieldName = options.fieldName || 'file';
  const fileName = options.fileName || path.basename(filePath);
  const data = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append(fieldName, new Blob([data], { type: 'image/jpeg' }), fileName);
  const res = await fetch(uploadUrl, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    throw new Error(`upload server returned HTTP ${res.status}`);
  }
  return res.status;
}

async function maybeUpload(filePath, triggeredBy, captureId) {
  const settings = getSettings();
  const wanted =
    settings.upload_enabled === '1' &&
    ((triggeredBy === 'manual' && settings.upload_manual === '1') ||
      (triggeredBy === 'schedule' && settings.upload_schedule === '1'));

  if (!wanted || !settings.upload_url) return { uploaded: false, upload_error: null };

  try {
    await uploadImage(filePath, settings.upload_url, {
      fieldName: settings.upload_field || 'image',
      // disk basename is already "<camera_source>_<timestamp>.jpg"
      fileName: path.basename(filePath)
    });
    return { uploaded: true, upload_error: null };
  } catch (err) {
    console.error(`Upload failed for capture ${captureId}:`, err.message);
    return { uploaded: false, upload_error: err.message };
  }
}

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

  const upload = await maybeUpload(filePath, triggeredBy || 'manual', info.lastInsertRowid);

  return {
    id: info.lastInsertRowid,
    cameraId,
    filePath: relativePath,
    timestamp: new Date().toISOString(),
    uploaded: upload.uploaded,
    upload_error: upload.upload_error
  };
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

module.exports = { triggerCapture, getCaptureHistory, uploadImage };
