const express = require('express');
const router = express.Router();
const { db } = require('../data/store');
const scheduler = require('../services/scheduler');

// GET /api/cameras - list all cameras
router.get('/', (req, res) => {
  try {
    const cameras = db.prepare(`
      SELECT c.*, 
             s.is_online, s.last_checked, s.last_changed
      FROM cameras c
      LEFT JOIN stream_status s ON c.id = s.camera_id
      ORDER BY c.id
    `).all();
    res.json(cameras);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cameras - add a new camera
router.post('/', (req, res) => {
  const { name, rtsp_url } = req.body;
  if (!name || !rtsp_url) {
    return res.status(400).json({ error: 'name and rtsp_url required' });
  }
  try {
    const result = db.prepare('INSERT INTO cameras (name, rtsp_url) VALUES (?, ?)').run(name, rtsp_url);
    const newCamera = db.prepare('SELECT * FROM cameras WHERE id = ?').get(result.lastInsertRowid);
    // initialize stream status
    db.prepare(`
      INSERT OR IGNORE INTO stream_status (camera_id) VALUES (?)
    `).run(newCamera.id);
    res.status(201).json(newCamera);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cameras/:id - update a camera
router.put('/:id', (req, res) => {
  const { name, rtsp_url, is_active } = req.body;
  try {
    const result = db.prepare(`
      UPDATE cameras SET name = ?, rtsp_url = ?, is_active = ? WHERE id = ?
    `).run(name, rtsp_url, is_active ? 1 : 0, req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    const updated = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cameras/:id - delete a camera
router.delete('/:id', (req, res) => {
  try {
    for (const s of db.prepare('SELECT id FROM schedules WHERE camera_id = ?').all(req.params.id)) {
      scheduler.removeSchedule(s.id);
    }
    const result = db.prepare('DELETE FROM cameras WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    // stream_status, captures, and schedules cascade via FK
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cameras/:id - get single camera
router.get('/:id', (req, res) => {
  try {
    const camera = db.prepare(`
      SELECT c.*, s.is_online, s.last_checked, s.last_changed
      FROM cameras c
      LEFT JOIN stream_status s ON c.id = s.camera_id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    res.json(camera);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;