# Rules of Survival

Rules-horror text adventure game built with Next.js + React + TypeScript.

## Run locally

1. Install dependencies

```bash
npm install
```

2. Start dev server

```bash
npm run dev
```

3. Build + start production

```bash
npm run build
npm run start
```

## Architecture

- UI and game state run in the browser.
- All LLM and image generation calls are proxied through Next.js API routes.
- Versioned API namespace: `/api/v1/*`.

## API v1

### Health

`GET /api/v1/health`

### Core turn engine

`POST /api/v1/game/turn`

Example:

```bash
curl -X POST http://localhost:3000/api/v1/game/turn \
  -H "Content-Type: application/json" \
  -d '{
    "history": [],
    "currentAction": "查看四周",
    "currentRules": ["不要直视东楼的护士。"],
    "provider": "gemini",
    "apiKey": "YOUR_KEY"
  }'
```

### LLM utilities

- `POST /api/v1/llm/test`
- `POST /api/v1/llm/models`

### Image utilities

- `POST /api/v1/image/generate`
- `POST /api/v1/image/models`

## Scripted gameplay testing (NVIDIA, no image rendering)

Use the provided script to run multiple automated game sessions against `/api/v1/game/turn`.

### 1) Start the app server

```bash
npm run dev
```

### 2) Create `.env.gameplay`

```bash
cp .env.gameplay.example .env.gameplay
```

Then edit `.env.gameplay` with your real NVIDIA key.

### 3) Run scripted tests

```bash
npm run test:game:nvidia
```

Optional: use a custom env file path

```bash
GAME_TEST_ENV_FILE=.env.gameplay.staging npm run test:game:nvidia
```

Defaults used by the script:

- `GAME_API_BASE=http://localhost:3000`
- `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1/chat/completions`
- `NVIDIA_MODEL=z-ai/glm4.7`
- `TEST_GAMES=8`
- `TEST_MAX_TURNS=16`

The script does not call image APIs, so it can focus purely on turn-engine behavior.

## Visual Test Lab

Open `http://localhost:3000/lab` for a visual stress-testing console.

- Configure provider, base URL, key, model, game count, concurrency, and turn limit.
- Run tests in parallel and monitor real-time progress.
- Each turn persists player choice + model output + state transition.
- Story quality is auto-evaluated per game via `POST /api/v1/eval/story` using the same model config.

Persistence behavior:

- Run configuration is stored in `localStorage`.
- Full run/game/turn logs are stored in `IndexedDB` for replay and analysis.

## Notes

- This project intentionally keeps provider credentials user-configurable for testing.
- Public API mode is currently open (no auth). Add rate limits before internet exposure.
