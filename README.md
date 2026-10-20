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
| **Clic derecho** o **F** | comer una baya |
| **1–9** o **rueda del ratón** | elegir casilla de la hotbar (la rueda da la vuelta al pasar del extremo y no actúa con el crafteo abierto) |
| **C** | abrir o cerrar el crafteo (con él abierto, **1–5** fabrica) |
| **Clic izquierdo** con la fogata en la mano | colocarla |
| **Esc** | pausa |

Los árboles se talan con 3 golpes (+4 madera) y las rocas se pican con 4 (+3 piedra). Cada arbusto tiene 6 bayas a la vista: cada clic arranca una (+1 baya) y el arbusto se queda aunque esté vacío. Las bayas que faltan vuelven de una en una, una cada 15 s, así que un arbusto vacío se llena en 90 s. Los árboles y las rocas no vuelven. La madera y la piedra caen al suelo al talar o picar y se recogen pasando por encima (de cerca se acercan solas); las bayas van directas a la hotbar. Si la hotbar no tiene sitio para algo nuevo, se queda en el suelo.

El objeto de la casilla seleccionada se ve en la mano derecha (o el puño, si está vacía) y se balancea al andar. Cada golpe tiene su animación, también al aire, y mantener el clic golpea una vez cada 0,4 s aunque no haya nada delante; comer y colocar la fogata también se animan.

## Fogata

Se fabrica con 6 de madera y 3 de piedra. Con ella en la mano aparece una vista previa delante del jugador (verde si se puede colocar, roja si cae en el agua, en una pendiente o encima de algo) y un clic la coloca. Da luz cálida que de noche ilumina el entorno; de día apenas se nota. No se puede atravesar y desaparece al morir, con el resto de la partida.

## Supervivencia

El hambre (barra naranja) baja sola y se vacía en unos 4 minutos; cada baya devuelve 15. Con el hambre por encima del 30 % la vida se regenera, y con el hambre a 0 la vida baja hasta morir. Al morir la partida empieza de nuevo: inventario vacío, isla restaurada y el jugador en el punto de aparición.

## Enemigos

Al anochecer empiezan a aparecer trasgos a 26–40 m del jugador, uno cada 5 s: 3 a la vez la primera noche y 2 más cada noche, hasta 12. Persiguen al jugador algo más despacio de lo que anda, rodean árboles y rocas y no entran en agua profunda. Pegados al jugador le quitan 10 de vida cada 1,2 s. Se golpean como los props (clic): 6 golpes a mano, 3 con un hacha o pico de madera y 2 con uno de piedra; cada golpe los hace retroceder. Al morir dejan carne cruda en el suelo, y al amanecer los que quedan desaparecen.

## Sonido y ajustes

Todos los sonidos se generan en el navegador con Web Audio (`src/audio/`), sin archivos de audio: golpes en madera, piedra y arbustos, recoger, comer, fabricar, colocar la fogata, pasos (también en el agua), saltos, daño, trasgos que gruñen desde donde están y la muerte. De fondo hay viento, pájaros de día, grillos de noche y el crepitar de las fogatas cercanas; el ambiente se calla en el menú y en la pausa. El navegador no deja sonar nada hasta el primer clic.

En el menú y en la pausa hay deslizadores para la sensibilidad del ratón, el campo de visión y el volumen. Se guardan en `localStorage` y se aplican al momento.

## Mundo

El mundo se genera de forma determinista a partir de `WORLD_SEED` (`src/sim/random.ts`): el terreno usa ruido simplex y los árboles y rocas usan un segundo generador independiente (los arbustos, un tercero, para no alterar los anteriores), así que el mapa es idéntico en cada carga. En modo desarrollo, `window.__debug` expone un hash del mundo (`worldHash`) y helpers para probar el juego sin ratón (`start`, `advance`, `setKeys`, `aimAt`…); no se incluye en el build de producción.

La lógica que no depende de three.js ni del DOM (jugador, supervivencia, colisiones, inventario, fabricación, constantes, generador aleatorio, altura del terreno y reloj del día) vive en `src/sim/`, para que la pueda ejecutar también un servidor. `npm run typecheck:sim` la compila sin la librería del DOM y un test comprueba que no importa three ni nada de fuera de `src/sim/`.

## Despliegue

El workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

- en cada **push a `main`** corre los tests, comprueba `src/sim/` sin DOM, hace el build y despliega `dist/` a GitHub Pages;
- en cada **pull request** hacia `main` solo corre los tests, esa comprobación y el build (sin desplegar);
- también se puede lanzar a mano desde la pestaña Actions (solo despliega si se lanza sobre `main`).

Configuración única en GitHub:

1. **Settings → General → Default branch**: debe ser `main` (el environment `github-pages` solo permite desplegar desde la rama por defecto).
2. **Settings → Pages → Build and deployment → Source**: **GitHub Actions**.
