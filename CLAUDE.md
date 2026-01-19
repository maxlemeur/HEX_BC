# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Internal order management application (Générateur de commandes) built with Next.js 16 and Supabase. Allows managing customers, products, and creating orders with tax calculations and printable output.

## Commands

```bash
npm run dev    # Start development server (http://localhost:3000)
npm run build  # Production build
npm run lint   # Run ESLint
```

## Architecture

### Tech Stack
- **Next.js 16** with App Router (React 19)
- **Supabase** for database and authentication (Email/Password)
- **Tailwind CSS 4** for styling
- **TypeScript** with strict mode

### Directory Structure
- `src/app/` - Next.js App Router pages
  - `login/`, `signup/` - Auth pages (public)
  - `dashboard/` - Protected area with layout that checks auth
    - `customers/`, `products/`, `orders/` - CRUD pages
    - `orders/[id]/print/` - Print-friendly order view
- `src/lib/supabase/` - Supabase client utilities
  - `client.ts` - Browser client (`createSupabaseBrowserClient`)
  - `server.ts` - Server client (`createSupabaseServerClient`)
- `src/lib/money.ts` - Currency utilities (EUR formatting, cents conversion, tax calculation)
- `src/components/` - Shared components
- `supabase/schema.sql` - Database schema

### Key Patterns

**Authentication**: Dashboard layout (`src/app/dashboard/layout.tsx`) checks auth via `createSupabaseServerClient()` and redirects unauthenticated users to `/login`.

**Supabase Clients**:
- Server Components: Use `createSupabaseServerClient()` (async)
- Client Components: Use `createSupabaseBrowserClient()` with `useMemo`

**Money Handling**: All monetary values stored in cents (`*_cents` columns). Tax rates stored in basis points (`tax_rate_bp`, e.g., 2000 = 20%). Use `formatEUR()` for display, `parseEuroToCents()` for input parsing.

### Database Schema
Four tables with RLS enabled (authenticated users have full access):
- `customers` - Client information
- `products` - Product catalog (prices in cents, tax rate in basis points)
- `orders` - Order headers with totals
- `order_items` - Order line items with computed totals

Order status enum: `draft`, `sent`, `accepted`, `canceled`

## Environment Variables

Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
