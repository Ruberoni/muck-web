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

Tests y build de producción:

```bash
npm test          # tests unitarios (vitest)
npm run build     # typecheck + build en dist/
npm run preview   # sirve dist/ en http://localhost:4173/
```

## Controles

Haz clic en la pantalla para empezar (captura el ratón).

| Tecla | Acción |
| --- | --- |
| **W A S D** | moverse |
| **Ratón** | mirar |
| **Espacio** | saltar (gasta stamina) |
| **Shift** | correr (gasta stamina) |
| **Clic izquierdo** | golpear; mantenerlo repite el golpe |
| **F** | comer una baya |
| **1–9** | elegir casilla de la hotbar |
| **C** | abrir o cerrar el crafteo (con él abierto, **1–5** fabrica) |
| **Clic izquierdo** con la fogata en la mano | colocarla |
| **Esc** | pausa |

Los árboles se talan con 3 golpes (+4 madera) y las rocas se pican con 4 (+3 piedra). Los arbustos de bayas se recogen con un clic (+3 bayas) y vuelven a crecer a los 90 s, aunque nunca encima del jugador ni de una fogata (esperan a que el sitio quede libre). Los árboles y las rocas no vuelven. Lo recogido aparece en la hotbar.

## Fogata

Se fabrica con 6 de madera y 3 de piedra. Con ella en la mano aparece una vista previa delante del jugador (verde si se puede colocar, roja si cae en el agua, en una pendiente o encima de algo) y un clic la coloca. Da luz cálida que de noche ilumina el entorno; de día apenas se nota. No se puede atravesar y desaparece al morir, con el resto de la partida.

## Supervivencia

El hambre (barra naranja) baja sola y se vacía en unos 4 minutos; cada baya devuelve 15. Con el hambre por encima del 30 % la vida se regenera, y con el hambre a 0 la vida baja hasta morir. Al morir la partida empieza de nuevo: inventario vacío, isla restaurada y el jugador en el punto de aparición.

## Mundo

El mundo se genera de forma determinista a partir de `WORLD_SEED` (`src/world/random.ts`): el terreno usa ruido simplex y los árboles y rocas usan un segundo generador independiente (los arbustos, un tercero, para no alterar los anteriores), así que el mapa es idéntico en cada carga. En modo desarrollo, `window.__debug` expone un hash del mundo (`worldHash`) y helpers para probar el juego sin ratón (`start`, `advance`, `setKeys`, `aimAt`…); no se incluye en el build de producción.

## Despliegue

El workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

- en cada **push a `main`** corre los tests, hace el build y despliega `dist/` a GitHub Pages;
- en cada **pull request** hacia `main` solo corre los tests y el build (sin desplegar);
- también se puede lanzar a mano desde la pestaña Actions (solo despliega si se lanza sobre `main`).

Configuración única en GitHub:

1. **Settings → General → Default branch**: debe ser `main` (el environment `github-pages` solo permite desplegar desde la rama por defecto).
2. **Settings → Pages → Build and deployment → Source**: **GitHub Actions**.
