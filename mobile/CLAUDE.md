@AGENTS.md

# ViajaYa — Mobile (Expo + React Native + TypeScript)

App de taxis y encomiendas. Expo Router (file-based), React Query (server state),
Zustand (auth/cliente), axios, react-native-maps, SSO Google/Facebook.

> ⚠️ **Expo 56 cambió mucho.** Lee SIEMPRE los docs versionados antes de escribir código:
> https://docs.expo.dev/versions/v56.0.0/ (ver `AGENTS.md`).

## Arquitectura

Código organizado por **features**, cada uno en capas (Clean Architecture adaptada al cliente).
El enrutado (`src/app/`) solo monta pantallas; la lógica vive en `src/features/`.

```
src/
├── app/                 # Rutas (expo-router, file-based). Solo composición de pantallas.
│   ├── (auth)/            # Grupo no autenticado: login, register
│   ├── (app)/             # Grupo autenticado (gated por sesión)
│   │   ├── (tabs)/          # index (home), history, wallet, profile
│   │   └── booking/         # destination, configure, offers, pick-on-map, saved-places, edit-place
│   ├── _layout.tsx        # Layout raíz: providers (React Query, theme, gesture handler)
│   └── index.tsx
├── features/            # Una carpeta por feature: auth, booking, home
│   └── <feature>/
│       ├── domain/        # types.ts — tipos del dominio (sin React ni IO)
│       ├── data/          # repositories/services: llamadas a la API y mappers DTO↔dominio
│       ├── application/   # hooks: casos de uso (useAuth, useBookingStore, usePlaceSearch, ...)
│       └── presentation/  # componentes de pantalla (LoginScreen, ConfigureTripScreen, ...)
├── core/               # Infra transversal
│   ├── config/env.ts     # Config tipada desde app.config.ts (extra) vía expo-constants
│   ├── http/             # client.ts (axios + interceptores token/refresh), tokenStorage (SecureStore)
│   ├── errors/apiError.ts
│   ├── hooks/            # hooks genéricos (useKeyboardHeight, ...)
│   └── theme/            # tokens.ts + index.ts (design system)
├── shared/components/  # UI reutilizable: Button, TextField, Checkbox, SocialButton, ...
└── store/authStore.ts  # Estado de sesión global (Zustand)
```

### Reglas al añadir código

- **Respeta las capas del feature.** Las pantallas (`presentation/`) consumen hooks (`application/`),
  que llaman a repos/services (`data/`), que mapean a tipos de `domain/`. No hagas `fetch`/axios desde un componente.
- **Todo el IO HTTP pasa por `src/core/http/client.ts`** (instancia `api`). Ya adjunta el Bearer token
  y refresca ante 401. No crees instancias axios sueltas ni uses `fetch` directo.
- **Config solo desde `@/core/config/env`.** Nunca leas `process.env` en runtime; las claves se exponen
  vía `app.config.ts` → `extra` → `env`. Edita `.env` (ver `.env.example`) para valores locales.
- **Reusa `shared/components/`** antes de crear UI nueva; respeta los `theme/tokens`.
- **Alias de imports:** `@/*` → `src/*`, `@/assets/*` → `assets/*`. Úsalos en vez de rutas relativas largas.
- **Pantallas nuevas:** crea el archivo de ruta en `src/app/...` y delega en un componente de `presentation/`.

## Comandos

```bash
cd mobile
npm install
cp .env.example .env       # API_URL (IP LAN del backend), claves Maps/OAuth

npx expo start             # dev server (emulador / Expo Go / dev build)
npm run android            # expo start --android
npm run ios                # expo start --ios

# Calidad (correr antes de commitear)
npx tsc --noEmit           # type-check estricto
npm run lint               # expo lint (eslint-config-expo)
```

## Convenciones

- **TypeScript estricto** (`strict: true`); evita `any`, tipa los datos de la API en `domain/types.ts`.
- **Server state → React Query**; **estado de sesión/cliente → Zustand** (`authStore`). No dupliques estado de servidor en stores.
- **Formularios:** react-hook-form + zod (`@hookform/resolvers`), con esquemas de validación junto al feature.
- **Mapas:** `react-native-maps`; ubicación con `expo-location` (permisos ya declarados en `app.config.ts`).
- **Tokens:** se guardan con `expo-secure-store` (`core/http/tokenStorage`), nunca en AsyncStorage plano.
- Comentarios/JSDoc en español, alineados con el estilo del repo.
- Antes de tocar APIs de Expo, confirma firmas en los docs de la **v56** (no asumas versiones previas).
