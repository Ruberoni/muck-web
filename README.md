# muck-web

Juego de supervivencia low-poly para el navegador, inspirado en [Muck](https://store.steampowered.com/app/1625450/Muck/). Todo el contenido (modelos, colores, iconos) es original; no se usan assets, sonidos ni logos del juego original.

**Jugar:** https://ruberoni.github.io/muck-web/

Hecho con [Vite](https://vite.dev/), TypeScript y [Three.js](https://threejs.org/).

## Correr en local

Requisitos: Node.js **≥ 22.12** (Vite 8 no funciona en versiones anteriores de Node 22).

```bash
npm install
npm run dev       # servidor de desarrollo en http://localhost:5173/
```

Build de producción:

```bash
npm run build     # typecheck + build en dist/
npm run preview   # sirve dist/ en http://localhost:4173/
```

## Controles

- **Arrastrar con el ratón**: rotar la cámara
- **Rueda**: zoom
- **Clic derecho + arrastrar**: desplazar

## Mundo

El mundo se genera de forma determinista a partir de `WORLD_SEED` (`src/world/random.ts`): el terreno usa ruido simplex y los árboles y rocas usan un segundo generador independiente, así que el mapa es idéntico en cada carga. En modo desarrollo, `window.__debug.worldHash` expone un hash del mundo para detectar cambios.

## Despliegue

El workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

- en cada **push a `main`** hace build y despliega `dist/` a GitHub Pages;
- en cada **pull request** hacia `main` solo hace el build (sin desplegar);
- también se puede lanzar a mano desde la pestaña Actions (solo despliega si se lanza sobre `main`).

Configuración única en GitHub:

1. **Settings → General → Default branch**: debe ser `main` (el environment `github-pages` solo permite desplegar desde la rama por defecto).
2. **Settings → Pages → Build and deployment → Source**: **GitHub Actions**.
