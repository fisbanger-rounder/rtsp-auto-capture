const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { db } = require('./data/store');
const { monitorStreams } = require('./services/rtspMonitor');
const { setJobManager } = require('./services/scheduler');
const cameraRoutes = require('./routes/cameras');
const captureRoutes = require('./routes/captures');
const scheduleRoutes = require('./routes/schedules');
const settingsRoutes = require('./routes/settings');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/cameras', cameraRoutes);
app.use('/api/captures', captureRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/settings', settingsRoutes);

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

function startMonitoring() {
  setJobManager({ broadcast });
  setInterval(async () => {
    try {
      const cameras = db.prepare('SELECT * FROM cameras').all();
      const results = await monitorStreams(cameras, (cameraId, isOnline) => {
        const camera = db.prepare('SELECT name FROM cameras WHERE id = ?').get(cameraId);
        broadcast({ type: 'status_change', camera_id: cameraId, camera_name: camera?.name, is_online: isOnline });
      });
      broadcast({ type: 'status_update', cameras: results });
    } catch (err) {
      console.error('Monitor error:', err.message);
    }
  }, config.monitorIntervalMs);
}

const capturesDir = path.join(__dirname, config.captureDir);
fs.mkdirSync(capturesDir, { recursive: true });

const PORT = config.port;
server.listen(PORT, () => {
  console.log(`RTSP Auto-Capture server running on http://localhost:${PORT}`);
  startMonitoring();
});
