# Repository Guidelines

## Project Structure & Module Organization
`src/app/` contains the Next.js 16 App Router, including dashboard pages and API route handlers in `src/app/api/**`. Put shared UI in `src/components/`, domain and integration logic in `src/lib/`, and test helpers in `src/test/`. End-to-end coverage lives in `e2e/`; Supabase schema and migrations live in `supabase/`; design references live in `maquette/`; longer product and implementation notes live in `docs/`.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start the local app on `http://localhost:3000`.
- `npm run build`: validate OpenAPI output, then create the production build.
- `npm run start`: serve the built app.
- `npm run lint`: run ESLint with `--max-warnings=0`.
- `npm run typecheck`: run strict TypeScript checks without emitting files.
- `npm test`: run the full Vitest suite.
- `npm run e2e:pw:critical`: run the Playwright critical-path suite.
- `npm run e2e`: run the legacy PowerShell-driven smoke flow.

## Coding Style & Naming Conventions
Use TypeScript with strict types for exported APIs. Follow existing formatting: 2-space indentation, semicolons, and double quotes. Prefer the `@/` alias for imports from `src/`. Use PascalCase for React components, `useX` for hooks, lowercase route segment folders, and colocated test names such as `route.test.ts` or `Component.test.tsx`.

## Testing Guidelines
Vitest is the primary test runner, split between `node` and `jsdom` projects in `vitest.config.ts`. Add `*.test.ts` or `*.test.tsx` beside the code they cover. Use `npm test` before opening a PR; add `npm run e2e:pw:critical` for UI, routing, or auth changes. There is no enforced coverage threshold, so new work should include focused regression coverage where practical.

## Commit & Pull Request Guidelines
Always stay on and work from the `main` branch. Other teams may be working on `main` in parallel, so assume the worktree can contain unrelated changes. Never delete, revert, or overwrite work you did not create. Follow Conventional Commits and include a ticket when available, for example `fix(EST-243): remove unused portal test imports`. PRs should include a short summary, linked issue or story, screenshots for UI changes, and notes for migrations, RLS, OpenAPI, or environment updates. List the commands you ran.

## Configuration & Security Tips
Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never commit `.env.local` or service secrets. Apply schema or migration changes in Supabase before local verification, and call out database-impacting changes clearly in review.
