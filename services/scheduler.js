const cron = require('node-cron');
const { db } = require('../data/store');
const { triggerCapture } = require('./captureService');

let scheduledJobs = new Map();
let jobManager = null;

function createTask(scheduleId, cameraId, cronExpression) {
  return cron.schedule(cronExpression, async () => {
    try {
      await triggerCapture(cameraId, 'schedule');
      if (jobManager) {
        jobManager.broadcast({ type: 'capture_done', camera_id: cameraId, triggered_by: 'schedule' });
      }
    } catch (err) {
      console.error(`Scheduled capture failed for schedule ${scheduleId}:`, err.message);
    }
  });
}

function loadAndSchedule() {
  scheduledJobs.forEach((task) => task.stop());
  scheduledJobs = new Map();

  const schedules = db.prepare('SELECT id, camera_id, cron_expression, is_enabled FROM schedules').all();
  for (const schedule of schedules) {
    if (!schedule.is_enabled) continue;
    try {
      scheduledJobs.set(schedule.id, createTask(schedule.id, schedule.camera_id, schedule.cron_expression));
    } catch (err) {
      console.error(`Failed to schedule job ${schedule.id}:`, err.message);
    }
  }
}

function addSchedule(cameraId, cronExpression) {
  if (!cron.validate(cronExpression)) {
    throw new Error('Invalid cron expression');
  }
  const camera = db.prepare('SELECT id FROM cameras WHERE id = ?').get(cameraId);
  if (!camera) {
    throw new Error(`Camera ${cameraId} not found`);
  }
  const result = db.prepare('INSERT INTO schedules (camera_id, cron_expression) VALUES (?, ?)').run(cameraId, cronExpression);
  const schedule = { id: result.lastInsertRowid, camera_id: cameraId, cron_expression: cronExpression, is_enabled: 1 };
  scheduledJobs.set(schedule.id, createTask(schedule.id, cameraId, cronExpression));
  return schedule;
}

function removeSchedule(scheduleId) {
  const task = scheduledJobs.get(scheduleId);
  if (task) {
    task.stop();
    scheduledJobs.delete(scheduleId);
  }
  db.prepare('DELETE FROM schedules WHERE id = ?').run(scheduleId);
}

function toggleSchedule(scheduleId, enabled) {
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId);
  if (!existing) {
    throw new Error(`Schedule ${scheduleId} not found`);
  }

  db.prepare('UPDATE schedules SET is_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, scheduleId);

  const task = scheduledJobs.get(scheduleId);
  if (enabled) {
    if (!task) {
      scheduledJobs.set(scheduleId, createTask(scheduleId, existing.camera_id, existing.cron_expression));
    }
  } else if (task) {
    task.stop();
    scheduledJobs.delete(scheduleId);
  }
}

function getAllSchedules() {
  return db.prepare('SELECT * FROM schedules ORDER BY id').all();
}

function setJobManager(jm) {
  jobManager = jm;
  loadAndSchedule();
}

module.exports = { loadAndSchedule, addSchedule, removeSchedule, toggleSchedule, getAllSchedules, setJobManager };
