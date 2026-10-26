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
| **Tab** o **E** | abrir o cerrar el inventario: la mochila (18 casillas) y la hotbar; clic en una casilla y en otra para intercambiarlas. El ratón queda suelto y la partida sigue; **C** también cierra y **Esc** cierra y pausa |
| **C** | abrir o cerrar el crafteo (con él abierto, **1–5** fabrica) |
| **Clic izquierdo** con la fogata en la mano | colocarla |
| **Esc** | pausa |

Los árboles se talan con 3 golpes (+4 madera) y las rocas se pican con 4 (+3 piedra). Cada arbusto tiene 6 bayas a la vista: cada clic arranca una (+1 baya) y el arbusto se queda aunque esté vacío. Las bayas que faltan vuelven de una en una, una cada 15 s, así que un arbusto vacío se llena en 90 s. Los árboles y las rocas no vuelven. La madera y la piedra caen al suelo al talar o picar y se recogen pasando por encima (de cerca se acercan solas); las bayas van directas al inventario. Lo nuevo ocupa la primera casilla libre de la hotbar y, si está llena, de la mochila (18 casillas más); si no queda sitio, se queda en el suelo.

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

- en cada **push a `main`** corre los tests (también los del servidor), comprueba `src/sim/` sin DOM y el Worker con los tipos de Cloudflare, hace el build, despliega `dist/` a GitHub Pages y, después, despliega el servidor de multijugador a Cloudflare si el push cambia `server/`, `src/sim/`, `src/net/` o `package-lock.json`;
- en cada **pull request** hacia `main` corre lo mismo sin desplegar, y además comprueba que se ha subido `PROTOCOL_VERSION` si hacía falta;
- también se puede lanzar a mano desde la pestaña Actions (solo despliega si se lanza sobre `main`; lanzado a mano, despliega siempre el servidor).

Configuración única en GitHub:

1. **Settings → General → Default branch**: debe ser `main` (el environment `github-pages` solo permite desplegar desde la rama por defecto).
2. **Settings → Pages → Build and deployment → Source**: **GitHub Actions**.
3. **Settings → Secrets and variables → Actions**: los secretos `CLOUDFLARE_API_TOKEN` (permisos *Account · Workers Scripts · Edit* y *Account · Account Settings · Read*) y `CLOUDFLARE_ACCOUNT_ID`, y la variable `SERVER_URL` con la URL `wss://` del Worker (sin ruta). El build la expone al cliente como `VITE_SERVER_URL`.

## Servidor de multijugador

El multijugador cooperativo usa un servidor autoritativo en [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/): un Worker (`server/cf.ts`, configurado en `server/wrangler.jsonc`) recibe `GET /room/:code` y pasa el WebSocket a la Durable Object de esa sala, que ejecuta la misma simulación que el navegador (`server/room.ts` sobre `src/sim/`). La isla se guarda en el SQLite de la Durable Object cada 10 s, al pararse la sala y al irse el último jugador, y se borra a las 24 h sin nadie. `GET /status` responde `{"ok": true, "v": <PROTOCOL_VERSION>}`.

```bash
npm run dev:server        # el Worker en local con wrangler dev (ws://localhost:8787/room/CODIGO), acepta localhost
npm run test:server       # humo del Worker y la Durable Object en workerd, y la medida de CPU de la sala
npm run typecheck:server  # server/cf.ts con los tipos de Cloudflare
```

En GitHub Pages el menú ya ofrece "Crear partida" y "Unirse" (el build publicado lleva `VITE_MULTIPLAYER=1` y se conecta a `SERVER_URL`). Reglas en una sala: la pausa es solo tuya (sigues en el mundo como "ausente"); al morir tu inventario cae al suelo y miras a un compañero (Tab cambia) hasta reaparecer a los 30 s o, si es de noche, al amanecer; si mueren todos, "Game over" y la isla se reinicia a los 6 s (salvo que entre o vuelva alguien vivo antes). <kbd>Enter</kbd> abre el chat. Si se corta la conexión, el juego vuelve a entrar solo durante un minuto, y los demás no ven "se ha ido / se ha unido" si vuelves en menos de 10 s.

Tráfico (medido en `npm run test:server` con 8 jugadores y 24 enemigos de noche): unos 30 KB/s de bajada por jugador en JSON, unos 15 KB/s con la compresión del WebSocket (permessage-deflate, que el Worker negocia). De subida, `cmds` a 20 Hz mientras te mueves, a 4 Hz quieto, a 1 Hz muerto y nada en pausa. En el plan gratuito de Cloudflare los mensajes entrantes cuentan 20 a 1 en las 100.000 peticiones diarias: unas 28 horas-jugador en movimiento al día (unas 7 h de partida a 4).

Para probarlo en local, con `npm run dev` y `npm run dev:server` a la vez:

- El menú tiene el lobby: tu nombre, "Jugar solo", "Crear partida" (deja el código en la URL y en la pausa sale "Copiar enlace") y "Unirse" con un código. `http://localhost:5173/?room=CODIGO` ofrece "Unirse a CODIGO" (con varias pestañas o navegadores se juega con varios).
- En una sala, arriba a la izquierda salen la conexión y la lista de jugadores (vida, ping, ausente); los nombres flotan sobre los demás, los compañeros salen en el minimapa con su color y lo que hacen suena donde pasa.
- Desde la consola: `await __debug.net.create()` crea una sala y deja su código en la URL; `__debug.net.join('CODIGO')`, `__debug.net.players()`, `__debug.net.addBot()` (otro jugador en la misma pestaña que anda en círculos), `__debug.net.setLatency(100, 30)` (retraso artificial en ms), `__debug.net.drop()` (corta la conexión para probar la reconexión) y `__debug.net.stats()` (RTT, margen y correcciones de la predicción).
- En una sala, los trucos de `__debug` (`give`, `teleport`, `setVitals`, `spawnEnemy`, `placeCampfire`, `setPhase`, `aimAt`) los hace el servidor de desarrollo y devuelven una promesa; el de producción los rechaza.

**Desplegar el servidor corta las partidas abiertas unos segundos**: Cloudflare cierra los WebSockets al cambiar el código. Los clientes se reconectan solos con su token y siguen con la isla guardada (se pierden como mucho los últimos 10 s). Por eso el workflow solo lo despliega cuando cambia lo que el servidor ejecuta.
