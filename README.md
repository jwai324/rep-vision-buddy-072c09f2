# RepVision

An AI-powered workout tracking app. Plan templates and programs, run live sessions with timers and set-by-set logging, and chat with an AI coach that can edit your workouts and pull stats from your history.

## Stack

- Vite + React 18 + TypeScript
- Tailwind + shadcn/ui
- Supabase (Postgres, Auth, Edge Functions)
- Anthropic Claude (`claude-opus-4-7`) for AI coach + program generation

## Local development

```bash
npm install
cp .env.example .env   # then fill in your Supabase project values
npm run dev            # http://localhost:8080
```

## Scripts

| Command           | Purpose                                       |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start the Vite dev server                     |
| `npm run build`   | Production build                              |
| `npm run preview` | Preview the production build                  |
| `npm run lint`    | Run ESLint                                    |
| `npm test`        | Run the Vitest suite                          |

See `CLAUDE.md` for architecture notes, the Supabase setup runbook, and notes on the AI integration.
