const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const config = require('../config');
const { db } = require('../data/store');
const { triggerCapture, getCaptureHistory } = require('../services/captureService');

// GET /api/captures - get capture history
router.get('/', (req, res) => {
  const { camera_id: cameraId, limit = 50 } = req.query;
  try {
    const history = getCaptureHistory(cameraId ? parseInt(cameraId) : null, parseInt(limit));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/captures/trigger - manually trigger capture
router.post('/trigger', (req, res) => {
  const { camera_id: cameraId } = req.body;
  if (!cameraId) {
    return res.status(400).json({ error: 'camera_id required' });
  }
  triggerCapture(parseInt(cameraId), 'manual')
    .then((result) => res.status(201).json(result))
    .catch((err) => res.status(500).json({ error: err.message }));
});

// GET /api/captures/:id/download - download a captured image
router.get('/:id/download', (req, res) => {
  try {
    const capture = db.prepare('SELECT file_path FROM captures WHERE id = ?').get(req.params.id);
    if (!capture || !capture.file_path) {
      return res.status(404).json({ error: 'Capture not found' });
    }

    const baseDir = path.resolve(process.cwd(), config.captureDir);
    const filePath = path.resolve(process.cwd(), capture.file_path);
    if (!filePath.startsWith(baseDir + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Capture file not found' });
    }

    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
