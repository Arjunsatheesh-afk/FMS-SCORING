# PhysioTracking Mobile Client

React Native (Expo) app for recording/uploading physiotherapy exercise videos and receiving ML analysis from the Python backend.

## Features

- In-app exercise video recording (camera)
- Upload exercise videos from gallery
- Submit analysis jobs to backend API
- Live job progress polling
- Session feedback, score timeline, and progress dashboard

## Screens

- Home
- Record
- Feedback
- Progress
- Profile

## Prerequisites

1. Python analysis server running from the repository root (`analysis_server.py`)
2. Node.js 20+ and npm

## Run

```bash
cd /home/user/Exercise_Tracking_and_Analysis/PhysioTracking
npm install
```

Set API URL for your environment:

```bash
export EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:8000
```

Then start the app:

```bash
npx expo start
```

Defaults if env var is missing:

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator / web: `http://127.0.0.1:8000`

## API Contract

- `GET /exercises`
- `POST /analysis/jobs` (multipart form with `exercise`, `model`, `file`)
- `GET /analysis/jobs/{job_id}`

## Notes

- Ensure `tracking_models/<exercise>/` contains trained `.pkl` model files on the server.
- Camera and gallery permissions are configured in `app.json`.
