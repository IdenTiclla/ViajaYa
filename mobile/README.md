# ViajaYa mobile

Aplicación para pasajeros y conductores construida con Expo 56, React Native,
Expo Router y TypeScript.

## Preparación

```bash
npm install
cp .env.example .env
```

Configura en `.env` la URL de la API y las credenciales de Maps/OAuth. La app
usa módulos nativos, por lo que debe ejecutarse con un dev build, no con Expo Go.

## Desarrollo

```bash
npm start
npm run android  # crea o actualiza el dev build de Android cuando sea necesario
```

Antes de abrir procesos nuevos, verifica si PostgreSQL, backend y Metro ya están
corriendo para evitar reinicios o conflictos de puertos.

## Calidad

```bash
npx tsc --noEmit
npm run lint
```
