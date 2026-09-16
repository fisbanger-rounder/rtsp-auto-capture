const express = require('express');
const router = express.Router();
const { addSchedule, removeSchedule, toggleSchedule, getAllSchedules, loadAndSchedule } = require('../services/scheduler');

// GET /api/schedules - list all schedules
router.get('/', (req, res) => {
  try {
    const schedules = getAllSchedules();
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/schedules - add a new schedule
router.post('/', (req, res) => {
  const { camera_id, cron_expression } = req.body;
  if (!camera_id || !cron_expression) {
    return res.status(400).json({ error: 'camera_id and cron_expression required' });
  }
  try {
    const schedule = addSchedule(parseInt(camera_id), cron_expression);
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/schedules/:id - remove a schedule
router.delete('/:id', (req, res) => {
  try {
    removeSchedule(parseInt(req.params.id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/schedules/:id - enable/disable schedule
router.put('/:id', (req, res) => {
  const { enabled } = req.body;
  if (enabled === undefined) {
    return res.status(400).json({ error: 'enabled field required' });
  }
  try {
    toggleSchedule(parseInt(req.params.id), enabled);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/schedules/reload - reload schedules (re-initialize cron jobs)
router.post('/reload', (req, res) => {
  try {
    loadAndSchedule();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
