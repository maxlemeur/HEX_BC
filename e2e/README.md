# E2E tests (agent-browser)

This folder contains lightweight E2E checks powered by the `agent-browser` CLI.

## Requirements

- `agent-browser` installed and available in PATH.
- App running locally (default base URL is `http://localhost:3000`).

## Commands

- `npm run e2e` runs the smoke flow:
  - Opens the home page
  - Clicks the Login CTA
  - Checks the Login form fields

- `npm run e2e:auth` logs in and saves an auth state file for future tests.

## Environment variables

- `E2E_BASE_URL` (default: `http://localhost:3000`)
- `E2E_HEADED=1` to run with a visible browser window
- `E2E_SESSION` to control the agent-browser session name
- `E2E_LOGIN_EMAIL` and `E2E_LOGIN_PASSWORD` for auth state
- `E2E_AUTH_STATE` path for saved auth state (default: `e2e/.auth.json`)

## PowerShell examples

```powershell
$env:E2E_BASE_URL = "http://localhost:3000"
$env:E2E_HEADED = "1"
npm run e2e
```

```powershell
$env:E2E_LOGIN_EMAIL = "user@example.com"
$env:E2E_LOGIN_PASSWORD = "password"
npm run e2e:auth
```

## Using the saved auth state

In new scripts, dot-source the helper and load the auth state with:

```powershell
. "$PSScriptRoot/agent-browser.ps1"
Invoke-AgentBrowser -Session $Session "state" "load" "e2e/.auth.json"
```

Then navigate to authenticated routes.
