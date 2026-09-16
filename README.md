# RTSP Auto-Capture

A self-hosted web app for monitoring RTSP CCTV streams and capturing snapshots on demand or on a schedule. It probes each camera for liveness, pulls single JPEG frames with `ffmpeg`, stores capture history in SQLite, pushes status changes to the browser over a WebSocket, and can forward every capture to a remote HTTP server.

## Features

- Add, edit, and deactivate cameras by RTSP URL.
- Live online/offline status for each stream, refreshed every 15 seconds.
- Manual one-click frame capture.
- Scheduled captures per camera (daily time or day-of-week, backed by cron).
- Upload every capture to a remote HTTP endpoint (manual and scheduled uploads toggle separately).
- Capture history with filter and download.
- Dark single-page UI with no build step.

## How it works

The server does four things in parallel:

1. **Web UI** — Express serves the static `public/` folder and a JSON API.
2. **Monitoring loop** — every 15 seconds (`config.monitorIntervalMs`) `server.js` reads all cameras and runs `monitorStreams`, which calls `ffprobe` against each RTSP URL. Results are written to the `stream_status` table and broadcast to every connected browser.
3. **Capture** — a capture request (manual or scheduled) runs `triggerCapture` in `services/captureService.js`. It probes the stream, then runs `ffmpeg -vframes 1` to save a JPEG under `captures/<camera_id>/<name>_<timestamp>.jpg`, and inserts a row into `captures`.
4. **Scheduler** — `services/scheduler.js` loads every enabled row from `schedules` and registers a `node-cron` job. When a job fires it calls `triggerCapture` with `triggered_by = 'schedule'` and broadcasts a `capture_done` message.
5. **Uploader** — after a capture is saved, `captureService` POSTs the JPEG to the configured upload server as `multipart/form-data` (using Node's built-in `fetch`/`FormData`). Uploads are gated by the settings below and are non-fatal: if the server is unreachable, the capture is still saved and the error is logged.

### Capture flow, end to end

```
browser "Capture" button
  -> POST /api/captures/trigger { camera_id }
  -> triggerCapture(cameraId, 'manual')
  -> probeStream(url)        # ffprobe, is the camera reachable?
  -> captureFrame(...)       # ffmpeg, one JPEG to captures/<id>/
  -> INSERT INTO captures
  -> upload to remote server # multipart/form-data, if enabled
  -> response { id, filePath } -> browser auto-downloads
```

Scheduled captures follow the same path, except `node-cron` fires the job and `triggered_by` is `'schedule'`.

### Status flow

```
setInterval(15s)
  -> SELECT * FROM cameras
  -> probeStream(each)
  -> INSERT/UPDATE stream_status (is_online, last_checked, last_changed)
  -> WebSocket broadcast { type: 'status_update', cameras }
  -> browser re-renders the camera grid (green/red dot)
```

## Stack

| Component | Version | Role |
|-----------|---------|------|
| Node.js | 22 LTS (in Docker) | Runtime |
| [Express](https://expressjs.com) | ^5.1.0 | HTTP server, static files, JSON API |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | ^12.2.0 | Synchronous SQLite database (native module) |
| [node-cron](https://github.com/node-cron/node-cron) | ^4.2.2 | Scheduled capture jobs |
| [ws](https://github.com/websockets/ws) | ^8.18.3 | WebSocket server for live status |
| FFmpeg / ffprobe | system binary | Stream probing and frame capture (not an npm dependency) |
| Vanilla JS + CSS | — | Frontend, no framework, no build step |

The only dependency that is not installed by `npm install` is **ffmpeg**. The app shells out to `ffprobe` (stream liveness) and `ffmpeg` (single-frame JPEG capture), so both binaries must be on `PATH`.

- Debian/Ubuntu: `apt install ffmpeg` (includes `ffprobe`)
- macOS: `brew install ffmpeg`
- Windows: a full build such as [gyan.dev FFmpeg](https://www.gyan.dev/ffmpeg/builds/)

Image uploads use Node's built-in `fetch` and `FormData`, so no HTTP client or multipart library is required.

## Project structure

```
config.js                 # port, dirs, polling interval, stream timeout
server.js                 # Express + WebSocket + monitoring loop entry point
data/store.js             # better-sqlite3 connection + schema + settings store
services/
  rtspMonitor.js          # ffprobe probe + ffmpeg frame capture
  captureService.js       # triggerCapture, getCaptureHistory, uploadImage
  scheduler.js            # cron job manager (add/remove/toggle/reload)
routes/
  cameras.js              # /api/cameras CRUD
  captures.js             # /api/captures history + trigger + download
  schedules.js            # /api/schedules CRUD + reload
  settings.js             # /api/settings read/update (upload config)
public/
  index.html, css/style.css, js/app.js, js/websocket.js
data/rtsp.db              # SQLite (created on first run)
captures/<camera_id>/     # captured JPEGs
```

## Prerequisites

- Node.js 18+ (22 recommended)
- npm
- ffmpeg and ffprobe on `PATH`

## Running locally

```bash
npm install
npm start
```

Open http://localhost:3000. The SQLite database is created at `data/rtsp.db` and captures land in `captures/` on first run.

## Running with Docker

```bash
docker compose up --build
```

The image installs ffmpeg and runs as a non-root user. `data/` and `captures/` are persisted as named volumes (`rtsp-data`, `rtsp-captures`), so your cameras, schedules, and images survive container rebuilds. Port 3000 is published to the host.

If your cameras live on a LAN and the default bridge network cannot reach them, run with host networking:

```bash
docker run --network host --rm -it $(docker build -q .)
```

## Using it

1. **Add a camera** — click `+ Add Camera`, enter a name and an RTSP URL (for example `rtsp://user:pass@192.168.1.50:554/stream`), then Save.
2. **Check status** — the card shows a green or red dot. Status refreshes every 15 seconds.
3. **Manual capture** — click `Capture` on a card. The app probes the stream, saves a JPEG, and downloads it.
4. **Schedule** — click `+ Add Schedule`, pick a camera, a time, and a day (or "Every day"). The app converts your choice into a cron expression and registers a live `node-cron` job.
5. **History** — the Capture History section lists every capture with camera, trigger (`manual` or `schedule`), timestamp, and a Download button. Filter by camera using the dropdown.
6. **Upload** — in Upload Settings, set the endpoint URL and the multipart field name, and choose whether manual captures, scheduled captures, or both are sent. Click Save; the settings persist in SQLite.

## API

| Method | Path | Body / query | Result |
|--------|------|--------------|--------|
| GET | `/api/cameras` | — | List cameras with live status |
| POST | `/api/cameras` | `{ name, rtsp_url }` | Create camera (201) |
| GET | `/api/cameras/:id` | — | Single camera |
| PUT | `/api/cameras/:id` | `{ name, rtsp_url, is_active }` | Update camera |
| DELETE | `/api/cameras/:id` | — | Delete camera (204) |
| GET | `/api/captures` | `?camera_id=&limit=` | Capture history (newest first) |
| POST | `/api/captures/trigger` | `{ camera_id }` | Capture a frame now (201) |
| GET | `/api/captures/:id/download` | — | Download the JPEG |
| GET | `/api/schedules` | — | List schedules |
| POST | `/api/schedules` | `{ camera_id, cron_expression }` | Create schedule (201) |
| PUT | `/api/schedules/:id` | `{ enabled }` | Enable/disable |
| DELETE | `/api/schedules/:id` | — | Delete schedule (204) |
| POST | `/api/schedules/reload` | — | Re-register all cron jobs |
| GET | `/api/settings` | — | Read upload settings |
| PUT | `/api/settings` | `{ upload_url, upload_field, upload_enabled, upload_manual, upload_schedule }` | Update upload settings |

## Cron expressions

Schedules use `node-cron`'s 5-field format:

```
minute hour day-of-month month day-of-week
```

The UI builds these for you, but you can POST any valid expression. Examples:

- `30 14 * * *` — every day at 14:30
- `0 9 * * 1-5` — weekdays at 09:00
- `0 */2 * * *` — every two hours
- `30 14 * * 1` — Monday at 14:30

Day-of-week uses `0` or `7` for Sunday, `1` for Monday, through `6` for Saturday.

## Upload

Every capture can be forwarded to a remote HTTP endpoint as `multipart/form-data`. The settings are editable in the **Upload Settings** section of the web app (or via `PUT /api/settings`) and stored in the `settings` table.

| Setting | Default | Meaning |
|---------|---------|---------|
| `upload_enabled` | `1` | Master switch for all uploads |
| `upload_url` | `http://192.168.68.102:8000/api/v1/upload-image` | Endpoint that receives the image |
| `upload_field` | `image` | Name of the multipart form field carrying the file |
| `upload_manual` | `1` | Upload captures triggered manually |
| `upload_schedule` | `1` | Upload captures triggered by a schedule |

Request details:

- Method `POST`, `Content-Type: multipart/form-data`.
- The file is sent under the configured `upload_field` name (default `image`).
- The filename is `"<camera_source>_<timestamp>.jpg"`, for example `Garage_2026-09-16T14-35-33.jpg`.
- Timeout is 15 seconds. A failed upload never fails the capture: the image stays on disk, the row stays in `captures`, and the error is logged to the server console and returned as `upload_error` in the trigger response.

Point `upload_url` at any server that accepts a multipart file upload and responds `2xx`.

## Configuration

Server-level settings live in `config.js` (upload settings are stored in SQLite, see [Upload](#upload)):

| Key | Default | Meaning |
|-----|---------|---------|
| `port` | `3000` | HTTP/WebSocket port |
| `dataDir` | `./data` | SQLite location |
| `captureDir` | `./captures` | Snapshot output location |
| `monitorIntervalMs` | `15000` | Status polling interval |
| `streamTimeoutSeconds` | `8` | ffprobe/ffmpeg timeout |

The RTSP credentials are stored as part of each camera's URL in the SQLite database, not in config.
