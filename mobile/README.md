# ViajaYa mobile

App for passengers and drivers built with Expo 56, React Native,
Expo Router and TypeScript.

## Setup

```bash
npm install
cp .env.example .env
```

Set the API URL and the Maps/OAuth credentials in `.env`. The app uses
native modules, so it must run in a dev build, not in Expo Go.

## Development

```bash
npm start
npm run android  # creates or updates the Android dev build when needed
```

Before starting new processes, check whether PostgreSQL, the backend and Metro are
already running to avoid restarts or port conflicts.

## Quality

```bash
npx tsc --noEmit
npm run lint
```
