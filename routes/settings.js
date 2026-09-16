const express = require('express');
const router = express.Router();
const { getSettings, setSetting } = require('../data/store');

const ALLOWED_KEYS = ['upload_enabled', 'upload_url', 'upload_field', 'upload_manual', 'upload_schedule'];

// GET /api/settings - read current settings
router.get('/', (req, res) => {
  try {
    res.json(getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings - update settings
router.put('/', (req, res) => {
  try {
    for (const key of ALLOWED_KEYS) {
      if (req.body[key] !== undefined) {
        setSetting(key, req.body[key]);
      }
    }
    res.json(getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
