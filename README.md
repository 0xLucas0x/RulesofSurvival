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

## Notes

- This project intentionally keeps provider credentials user-configurable for testing.
- Public API mode is currently open (no auth). Add rate limits before internet exposure.
