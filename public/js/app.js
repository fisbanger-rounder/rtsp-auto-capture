let ws;
let reconnectAttempts = 0;
const maxReconnects = 10;

function initWebSocket() {
  ws = new WebSocket(`ws://${window.location.host}`);

  ws.onopen = () => {
    console.log('WebSocket connected');
    reconnectAttempts = 0;
    loadCameras();
    loadSchedules();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'status_change') {
      updateCameraOfflineOnline(data.camera_id, data.is_online, data.camera_name);
    }
    if (data.type === 'status_update') {
      renderCameras(data.cameras);
    }
    if (data.type === 'capture_done') {
      console.log('Capture completed for camera:', data.camera_id);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    if (reconnectAttempts < maxReconnects) {
      setTimeout(initWebSocket, Math.min(1000 * Math.pow(2, reconnectAttempts), 10000));
      reconnectAttempts++;
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

window.broadcast = function(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
};

function loadCameras() {
  fetch('/api/cameras')
    .then(r => r.json())
    .then(renderCameras)
    .catch(err => console.error('Failed to load cameras:', err));
}

function renderCameras(cameras) {
  const container = document.getElementById('cameraList');
  document.getElementById('historyCameraFilter').innerHTML = 
    '<option value="">All Cameras</option>' +
    cameras.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  if (!cameras.length) {
    container.innerHTML = '<div class="empty-state">No cameras configured</div>';
    return;
  }

  container.innerHTML = cameras.map(c => {
    const isOnline = c.is_online === 1 || c.is_online === true;
    const isInactive = c.is_active === 0 || c.is_active === false;
    const statusClass = isOnline ? 'online' : 'offline';
    const inactiveClass = isInactive ? 'inactive' : '';
    const dotClass = isOnline ? 'on' : 'off';
    return `
      <div class="camera-card ${statusClass} ${inactiveClass}" data-id="${c.id}">
        <h3>${c.name}</h3>
        <div class="camera-url">${c.rtsp_url}</div>
        <div class="status-row">
          <span class="status-dot ${dotClass}"></span>
          <span>${isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <div class="camera-actions">
          <button class="btn btn-small btn-warning" onclick="triggerCapture(${c.id})">Capture</button>
          <button class="btn btn-small btn-secondary" onclick="editCamera(${c.id})">Edit</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateCameraOfflineOnline(cameraId, isOnline, name) {
  const card = document.querySelector(`.camera-card[data-id="${cameraId}"]`);
  if (card) {
    const wasOnline = card.querySelector('.status-dot').classList.contains('on');
    const shouldChange = wasOnline !== isOnline;
    if (shouldChange) {
      card.classList.toggle('online', isOnline);
      card.classList.toggle('offline', !isOnline);
      const dot = card.querySelector('.status-dot');
      dot.classList.remove('on', 'off');
      dot.classList.add(isOnline ? 'on' : 'off');
      card.querySelector('span:last-child').textContent = isOnline ? 'Online' : 'Offline';
    }
  }
}

function loadSchedules() {
  fetch('/api/schedules')
    .then(r => r.json())
    .then(renderSchedules)
    .catch(err => console.error('Failed to load schedules:', err));
}

function cronToLabel(expr) {
  const m = String(expr).trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\*|\d)$/);
  if (!m) return expr;
  const hh = m[2].padStart(2, '0');
  const mm = m[1].padStart(2, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayLabel = m[3] === '*' ? 'Every day' : days[parseInt(m[3], 10) % 7];
  return `${hh}:${mm} — ${dayLabel}`;
}

function renderSchedules(schedules) {
  const container = document.getElementById('scheduleList');
  if (!schedules.length) {
    container.innerHTML = '<div class="empty-state">No schedules configured</div>';
    return;
  }

  container.innerHTML = schedules.map(s => {
    const camera = document.querySelector(`option[value="${s.camera_id}"]`) || { textContent: s.camera_id };
    return `
      <div class="schedule-item" data-id="${s.id}">
        <div class="info">
          <strong>${camera.textContent || camera}</strong>
          <div class="cron">${cronToLabel(s.cron_expression)}</div>
          <div class="meta">Enabled: ${s.is_enabled ? 'Yes' : 'No'}</div>
        </div>
        <div class="schedule-actions">
          <button class="btn btn-small ${s.is_enabled ? 'btn-warning' : 'btn-primary'}" 
                  onclick="toggleSchedule(${s.id}, ${!s.is_enabled})">
            ${s.is_enabled ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-small btn-danger" onclick="deleteSchedule(${s.id})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleSchedule(scheduleId, enabled) {
  fetch(`/api/schedules/${scheduleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled })
  })
    .then(r => { loadSchedules(); })
    .catch(err => alert('Failed to update schedule'));
}

function deleteSchedule(scheduleId) {
  if (!confirm('Delete this schedule?')) return;
  fetch(`/api/schedules/${scheduleId}`, { method: 'DELETE' })
    .then(() => { loadSchedules(); })
    .catch(err => alert('Failed to delete schedule'));
}

function loadCaptureHistory(cameraId = null) {
  const url = cameraId ? `/api/captures?camera_id=${cameraId}` : '/api/captures';
  fetch(url)
    .then(r => r.json())
    .then(renderCaptureHistory)
    .catch(err => console.error('Failed to load history:', err));
}

function renderCaptureHistory(history) {
  const container = document.getElementById('historyList');
  const filter = document.getElementById('historyCameraFilter').value;
  const data = filter ? history.filter(h => h.camera_id == filter) : history;
  
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">No captures recorded</div>';
    return;
  }

  container.innerHTML = data.map(h => `
    <div class="history-item">
      <div class="left">
        <span class="camera-name">${h.camera_name}</span>
        <span class="trigger">(${h.triggered_by})</span>
      </div>
      <span class="time">${new Date(h.captured_at).toLocaleString()}</span>
      <span class="path">${h.file_path}</span>
      <button class="btn btn-small btn-primary" onclick="downloadCapture(${h.id})">Download</button>
    </div>
  `).join('');
}

function downloadCapture(captureId) {
  const a = document.createElement('a');
  a.href = `/api/captures/${captureId}/download`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function editCamera(id) {
  const camera = document.querySelector(`.camera-card[data-id="${id}"]`);
  if (!camera) return;
  
  document.getElementById('editCameraId').value = id;
  document.getElementById('cameraName').value = camera.querySelector('h3').textContent;
  document.getElementById('cameraUrl').value = camera.querySelector('.camera-url').textContent;
  document.getElementById('cameraActive').checked = !camera.classList.contains('inactive');
  document.getElementById('cameraForm').classList.remove('hidden');
}

function initCameraForm() {
  const form = document.getElementById('cameraForm');
  const editId = document.getElementById('editCameraId').value;
  const name = document.getElementById('cameraName').value;
  const url = document.getElementById('cameraUrl').value;
  const active = document.getElementById('cameraActive').checked;

  fetch(`/api/cameras${editId ? '/' + editId : ''}`, {
    method: editId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, rtsp_url: url, is_active: active })
  })
    .then(r => {
      form.classList.add('hidden');
      document.getElementById('editCameraId').value = '';
      loadCameras();
    })
    .catch(err => alert('Failed to save camera'));
}

function addCamera() {
  document.getElementById('editCameraId').value = '';
  document.getElementById('cameraName').value = '';
  document.getElementById('cameraUrl').value = '';
  document.getElementById('cameraActive').checked = true;
  document.getElementById('cameraForm').classList.remove('hidden');
}

function triggerCapture(cameraId) {
  const status = document.getElementById('captureStatus');
  status.textContent = 'Capturing...';
  status.className = 'success';

  fetch('/api/captures/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id: cameraId })
  })
    .then(r => r.json().then(data => {
      status.textContent = 'Capture saved: ' + (data.filePath || data.file_path);
      if (data.id) downloadCapture(data.id);
      loadCaptureHistory();
      setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
    }))
    .catch(err => {
      status.textContent = 'Capture failed: ' + err.message;
      status.className = 'error';
      setTimeout(() => { status.textContent = ''; status.className = ''; }, 4000);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  document.getElementById('addCameraBtn').addEventListener('click', addCamera);
  document.getElementById('saveCameraBtn').addEventListener('click', initCameraForm);
  document.getElementById('cancelCameraBtn').addEventListener('click', () => {
    document.getElementById('cameraForm').classList.add('hidden');
    document.getElementById('editCameraId').value = '';
  });
  document.getElementById('addScheduleBtn').addEventListener('click', () => {
    document.getElementById('scheduleCamera').innerHTML = 
      '<option value="">Select Camera</option>' +
      Array.from(document.querySelectorAll('option:not([value])')).map(o => '').join('');
    const cameras = Array.from(document.querySelectorAll('.camera-card')).map(c => ({
      id: c.dataset.id,
      name: c.querySelector('h3').textContent
    }));
    document.getElementById('scheduleCamera').innerHTML = 
      '<option value="">Select Camera</option>' +
      cameras.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('scheduleForm').classList.remove('hidden');
  });
  document.getElementById('saveScheduleBtn').addEventListener('click', () => {
    const cameraId = document.getElementById('scheduleCamera').value;
    const time = document.getElementById('scheduleTime').value;
    const day = document.getElementById('scheduleDay').value;
    if (!cameraId || !time) { alert('Select camera and enter a time'); return; }
    const [hh, mm] = time.split(':');
    const cron = `${parseInt(mm, 10)} ${parseInt(hh, 10)} * * ${day}`;
    fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: parseInt(cameraId), cron_expression: cron })
    })
      .then(r => r.json().then(data => {
        if (data.error) { alert('Failed to add schedule: ' + data.error); return; }
        loadSchedules();
        document.getElementById('scheduleForm').classList.add('hidden');
        document.getElementById('scheduleTime').value = '';
        document.getElementById('scheduleDay').value = '*';
      }))
      .catch(err => alert('Failed to add schedule'));
  });
  document.getElementById('cancelScheduleBtn').addEventListener('click', () => {
    document.getElementById('scheduleForm').classList.add('hidden');
  });
  document.getElementById('historyCameraFilter').addEventListener('change', () => {
    loadCaptureHistory(document.getElementById('historyCameraFilter').value);
  });
  loadCameras();
  loadCaptureHistory();
});