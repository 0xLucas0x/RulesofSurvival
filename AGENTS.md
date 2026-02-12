# Repository Guidelines

## Project Structure & Module Organization
This project is a Vite + React + TypeScript app. Keep code close to its purpose:
- `App.tsx`, `index.tsx`, `index.html`: app bootstrap and page shell.
- `components/`: UI modules (`Header.tsx`, `MainDisplay.tsx`, `RuleBook.tsx`, `EvidenceBoard.tsx`, `CRTLayer.tsx`).
- `services/`: external integrations (`geminiService.ts` for AI turn generation).
- `constants.ts`: initial game state and system prompt.
- `types.ts`: shared domain types (`GameState`, `Choice`, `Evidence`, `GeminiResponse`).
- `metadata.json`: app metadata for publishing/runtime tooling.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start local Vite dev server.
- `npm run build`: create a production build in `dist/`.
- `npm run preview`: serve the production build locally.

Example workflow: `npm run build && npm run preview` before submitting UI-heavy changes.

## Coding Style & Naming Conventions
- Use TypeScript with React functional components and hooks.
- Follow existing formatting: 2-space indentation, semicolons, and consistent quote style within each file.
- Component and component-file names: `PascalCase` (for example, `MainDisplay.tsx`).
- Variables/functions: `camelCase`; exported constants: `UPPER_SNAKE_CASE`.
- Keep reusable types in `types.ts`; avoid `any` unless unavoidable and documented.
- Keep API/service code inside `services/`, not inside UI components.

## Testing Guidelines
There is currently no automated test script in `package.json`. For now:
- Run `npm run build` to catch TypeScript and bundling issues.
- Manually validate gameplay flow (choices, sanity changes, evidence panel, game-over/victory states).
- For new test infrastructure, prefer Vitest + React Testing Library with `*.test.ts(x)` naming.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history (for example, `feat: implement evidence collection mechanic`).
- Keep commits focused and atomic; avoid mixing refactors with behavior changes.
- PRs should include:
  - what changed and why,
  - manual test steps/results,
  - linked issue (if available),
  - screenshots/GIFs for UI updates.

## Security & Configuration Tips
- Do not commit secrets. Use `.env.local` for local keys.
- The runtime currently reads `process.env.API_KEY`; keep README and code in sync if env names change.
- Avoid logging sensitive prompt/user data in production builds.
