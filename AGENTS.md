# Repository Guidelines

## Project Structure & Module Organization
- `src/app/`: Next.js App Router pages (login, signup, dashboard, orders, print view).
- `src/components/`: shared UI components.
- `src/lib/`: utilities such as Supabase clients and money helpers.
- `public/`: static assets served by Next.js.
- `supabase/`: database schema and setup docs (`schema.sql`, `README.md`).
- `maquette/`: HTML mockups used as visual references.
- `.env.example`: environment template for local config.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start the dev server at `http://localhost:3000`.
- `npm run build`: create a production build.
- `npm run start`: run the production server after a build.
- `npm run lint`: run ESLint (fails on warnings).
- `npm run typecheck`: run TypeScript without emitting files.

## Coding Style & Naming Conventions
- TypeScript is strict (`tsconfig.json`), so keep types explicit for exported APIs.
- ESLint uses Next core-web-vitals and TypeScript rules; fix lint errors before PRs.
- Follow existing formatting: 2-space indentation, semicolons, double quotes.
- Prefer the `@/` path alias for imports from `src/` (e.g., `@/lib/money`).
- Use PascalCase for React components and `useX` for hooks; keep route folders lowercase.

## Testing Guidelines
- No test runner or test scripts are configured in this repo.
- If you add tests, align on a framework and add scripts to `package.json`.

## Commit & Pull Request Guidelines
- This directory does not appear to be a git repo, so no commit history is available.
- If git is initialized, follow the team standard (Conventional Commits if undecided).
- PRs should include a concise summary, linked issue (if any), and UI screenshots
  for visual changes. Note any Supabase schema or RLS updates.

## Configuration & Security Tips
- Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Apply the schema in `supabase/schema.sql` using the Supabase SQL editor before
  running locally.
- Never commit `.env.local` or Supabase secrets.
