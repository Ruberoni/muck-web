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
| **Clic derecho** o **F** | comer lo que se lleva en la mano; si no es comida, una baya. Junto a la barra de hambre se ve qué se comerá |
| **1–9** o **rueda del ratón** | elegir casilla de la hotbar (la rueda da la vuelta al pasar del extremo) |
| **Q** | tirar uno de lo que se tiene en la mano; **Ctrl + Q**, todos. En la pantalla de inventario, la casilla que está bajo el ratón |
| **Tab** o **E** | abrir o cerrar el inventario: la mochila (18 casillas) y la hotbar; clic en una casilla y en otra para intercambiarlas. El ratón queda suelto y la partida sigue; **C** también cierra y **Esc** cierra y pausa |
| **C** | abrir el inventario con las recetas a la vista: clic en una receta la fabrica y **Mayúsculas + clic**, hasta 5 |
| **Clic izquierdo** con la fogata o una estación (mesa de trabajo, horno o yunque) en la mano | colocarla |
| **Esc** | pausa |

Los árboles se talan con 3 golpes a mano (+4 madera). Las rocas no se pueden picar a mano: hace falta un pico de madera (2 golpes) o cualquiera mejor (1 golpe), y dan +3 piedra. Si se golpea algo sin la herramienta que pide, suena metálico, tiembla y no pasa nada; al apuntarle se ve en gris lo que hace falta ("Roca · necesita pico de madera"). Las hachas talan más rápido (2 golpes con la de madera, 1 con cualquiera mejor). Sobre todo en el bosque, entre 3 y 6 m de altura, crecen 40 abedules de tronco blanco, que solo caen con un hacha de piedra (3 golpes), de hierro (2) o de mithril (1) y dan +4 madera de abedul, y en la montaña (entre 6 y 8,5 m) hay 40 menas de hierro, rocas con vetas anaranjadas que solo se pican con un pico de piedra (3 golpes), de hierro (2) o de mithril (1) y dan +3 mineral de hierro. Entre 6 y 9 m crecen también 20 pinos oscuros, más grandes y de copa casi negra, que piden un hacha de hierro (3 golpes; 2 con la de mithril) y dan +4 madera oscura, y en las cimas (desde 8,5 m) hay 16 menas de mithril, pequeñas y con cristales azules, que piden un pico de hierro (3 golpes; 2 con el de mithril) y dan +5 mineral de mithril. Los minerales se funden en el horno; la madera de abedul sirve para las herramientas de hierro y la oscura para las de mithril (ver [Crafteo](#crafteo)). Cada arbusto tiene 6 bayas a la vista: cada clic arranca una (+1 baya) y el arbusto se queda aunque esté vacío. Las bayas que faltan vuelven de una en una, una cada 15 s, así que un arbusto vacío se llena en 90 s. Sobre todo en el bosque crecen 30 hierbas curativas, matas pequeñas con flores rosas: un clic recoge la flor (+1 hierba curativa) y vuelve a salir a los 90 s. Los árboles y las rocas (también abedules, pinos oscuros y menas) no vuelven. La madera, la piedra y los minerales caen al suelo al talar o picar y se recogen pasando por encima (de cerca se acercan solas); las bayas van directas al inventario. Lo nuevo ocupa la primera casilla libre de la hotbar y, si está llena, de la mochila (18 casillas más); si no queda sitio, se queda en el suelo. Para hacer sitio, **Q** tira uno de la mano y **Ctrl + Q** la pila entera: sale hacia delante como un montón en el suelo, que quien lo tiró no puede recoger durante 2 s (los demás, sí).

El objeto de la casilla seleccionada se ve en la mano derecha (o el puño, si está vacía) y se balancea al andar. Cada golpe tiene su animación, también al aire, y mantener el clic golpea una vez cada 0,4 s aunque no haya nada delante; comer y colocar la fogata o una estación también se animan.

## Crafteo

Las recetas están en la pantalla de inventario (**C** la abre directamente en ellas), agrupadas por estación:

| Estación | Receta | Coste |
| --- | --- | --- |
| — | hacha o pico de madera | 5 madera |
| — | fogata | 6 madera + 3 piedra |
| — | mesa de trabajo | 10 madera |
| fogata | carne asada | 1 carne cruda |
| fogata | infusión de bayas | 4 bayas |
| mesa de trabajo | espada de madera | 5 madera |
| mesa de trabajo | hacha o pico de piedra | 3 madera + 5 piedra |
| mesa de trabajo | espada de piedra | 3 madera + 2 piedra |
| mesa de trabajo | horno | 12 piedra + 4 madera |
| mesa de trabajo | yunque | 4 lingotes de hierro + 6 piedra |
| horno | lingote de hierro | 1 mineral de hierro + 1 madera |
| horno | lingote de mithril | 1 mineral de mithril + 2 madera |
| yunque | hacha, pico o espada de hierro | 3 lingotes de hierro + 2 madera de abedul |
| yunque | hacha o pico de mithril | 3 lingotes de mithril + 2 madera oscura |
| yunque | espada de mithril | 2 lingotes de mithril + 2 madera oscura |

Se ven todas siempre; las que no se pueden hacer salen atenuadas, con lo que falta en rojo y el motivo ("Necesitas un horno cerca" si falta la estación). Un clic fabrica una y **Mayúsculas + clic**, hasta 5 seguidas. Fundir y cocinar son instantáneos: cada clic junto al horno convierte un mineral en un lingote, y junto a una fogata, una carne cruda en una asada.

Las herramientas de hierro hacen 6 de daño a lo de su familia y son las que abren el pino oscuro y la mena de mithril. Las de mithril, las mejores, hacen 12: nada pide mithril, pero tumban abedules y menas de hierro de un golpe, y pinos oscuros y menas de mithril de dos.

Las espadas son las armas para pelear: no talan ni pican, golpean cada 0,25 s (las herramientas, cada 0,4 s), y cada golpe alcanza además a los enemigos de delante, hasta 4, aunque vaya al aire. Por golpe hacen algo menos que una herramienta de su nivel:

| Nivel | Herramienta | Espada |
| --- | --- | --- |
| mano | 10 | — |
| madera | 20 | 16 |
| piedra | 30 | 25 |
| hierro | 40 | 35 |
| mithril | 60 | 50 |

## Estaciones

La mesa de trabajo, el horno y el yunque se colocan como la fogata, con vista previa, y quedan de frente al jugador. Las recetas de cada estación se fabrican a unos 3 m o menos de su borde (3,3 m), de cualquiera de ese tipo: son permanentes y en una sala las comparten todos. No se pueden atravesar, salen en el minimapa con un cuadrado (marrón la mesa, gris el horno, azul el yunque) y desaparecen al reiniciarse la isla. El horno tiene fuego en la boca, pero no ilumina como la fogata.

## Fogata

Se fabrica con 6 de madera y 3 de piedra. Con ella en la mano aparece una vista previa delante del jugador (verde si se puede colocar, roja si cae en el agua, en una pendiente o encima de algo) y un clic la coloca. Da luz cálida que de noche ilumina el entorno; de día apenas se nota. A unos 3 m de ella se cocina (ver [Crafteo](#crafteo)). No se puede atravesar y desaparece al morir, con el resto de la partida.

## Supervivencia

El hambre (barra naranja) baja sola y se vacía en unos 4 minutos; cada baya devuelve 15, la carne cruda 8 y la carne asada 45, y esta además cura 15 de vida al momento. La infusión de bayas recupera 2 de vida por segundo durante 20 s, y la hierba curativa cura 25 de vida al momento. Lo que no mejora nada (comer lleno, por ejemplo) no se gasta. Con el hambre por encima del 30 % la vida se regenera 1 por segundo, salvo durante los 8 s siguientes a recibir un golpe, y con el hambre a 0 la vida baja hasta morir. Los consumibles se definen en `CONSUMABLE_DEFS` (`src/sim/constants.ts`) y pueden curar al momento o poco a poco; la curación poco a poco se suma a la natural, sigue aunque te golpeen, la barra de vida late en verde con los segundos que quedan y tomar otro solo renueva el tiempo. Al morir la partida empieza de nuevo: inventario vacío, isla restaurada y el jugador en el punto de aparición.

## Enemigos

Al anochecer empiezan a aparecer trasgos a 26–40 m del jugador, uno cada 5 s: 3 a la vez la primera noche y 2 más cada noche, hasta 12. Persiguen al jugador algo más despacio de lo que anda, rodean árboles y rocas y no entran en agua profunda. Pegados al jugador le quitan 10 de vida cada 1,2 s. Se golpean como los props (clic), y tienen 70 de vida: 7 golpes a mano; con hacha o pico, 4 de madera, 3 de piedra y 2 de hierro o mithril; con espada, 5, 3, 2 y 2, pero mucho más seguidos. Cada golpe los hace retroceder. Al morir dejan carne cruda en el suelo. Al amanecer dejan de salir nuevos, pero los que quedan siguen ahí hasta que los mates, y cuentan para el tope de la noche siguiente. Desde la noche 2 algunos dejan paso a otros dos enemigos, cada noche más hasta la 4:

| Enemigo | Vida | Velocidad | Daño | Pico | Hacha | Espada | Mano | Sale sobre todo en | Suelta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Trasgo | 70 | 5 | 10 | ×1 | ×1 | ×1 | ×1 | cualquier sitio | carne cruda |
| Gólem de piedra | 170 | 3,5 | 15 | ×2 | ×0,5 | ×1 | ×0,5 | montaña | 3 piedra + 1 mineral de hierro |
| Espíritu del bosque | 130 | 6 | 8 | ×0,5 | ×2 | ×1 | ×0,5 | bosque | 4 madera + 1 madera de abedul |

Cada 3 noches sale además un **mini-boss**, unos 20 s después de anochecer. Al amanecer de ese día se anuncia con un cartel, y hasta que llega se ve "Esta noche: …" bajo el día; mientras vive, arriba sale su barra de vida. No cuenta para el tope de enemigos y, como el resto, no se va al amanecer: si sigue vivo, no sale otro. Su vida y su botín crecen un 50 % por cada jugador a partir del segundo.

- **Trasgo gigante** (noches 3, 9, 15…): 400 de vida, 25 de daño y más rápido que andar. No se aturde. A 5–9 m se agacha 0,8 s, brillando y rugiendo, y carga en línea recta hacia donde estabas: se esquiva apartándose, y se para al chocar con algo. Suelta 3 carnes crudas y 2 lingotes de hierro.
- **Lanzarrocas** (noches 6, 12…): 300 de vida, 15 de daño por roca y algo más lento que andar. No se aturde. Se te acerca hasta unos 14 m y retrocede si llegas a menos de 8. Cada 2,5 s, hasta 20 m, se para 0,7 s con la roca en alto, brillando y gruñendo, y la lanza hacia donde estás al soltarla: se esquiva moviéndose, y los árboles y las rocas la paran. Suelta 2 minerales de mithril y 6 de piedra.

El gólem no se aturde ni retrocede. Al trasgo y al espíritu, tras un golpe que los empuja y los aturde 0,3 s les quedan 0,6 s de aguante: durante ese rato los golpes les quitan vida, pero no los empujan ni les retrasan el ataque, así que golpear sin parar no evita que te peguen.

Cada tipo de enemigo es una entrada de `ENEMY_DEFS` (`src/sim/constants.ts`): vida, velocidad, tamaño, daño, ritmo de ataque, botín, debilidades… Lo que vuela (`src/sim/projectiles.ts`) cae con la gravedad y choca con jugadores, props, estructuras y suelo, pero pasa por encima de lo que le queda 3 m por debajo. Los choques los decide el servidor; el cliente sigue la trayectoria en el momento de su predicción, para que se pueda esquivar lo que ve.

Un enemigo puede ser débil o resistente a una clase de arma (`weakness`): el golpe multiplica su daño, y tanto el destello (amarillo si es eficaz, gris si lo resiste) como el sonido lo dejan ver.

## Sonido y ajustes

Todos los sonidos se generan en el navegador con Web Audio (`src/audio/`), sin archivos de audio: golpes en madera, piedra y arbustos, recoger, comer, fabricar, colocar la fogata o una estación, pasos (también en el agua), saltos, daño, trasgos que gruñen desde donde están y la muerte. De fondo hay viento, pájaros de día, grillos de noche y el crepitar de las fogatas cercanas; el ambiente se calla en el menú y en la pausa. El navegador no deja sonar nada hasta el primer clic.

En el menú y en la pausa hay deslizadores para la sensibilidad del ratón, el campo de visión y el volumen. Se guardan en `localStorage` y se aplican al momento.

## Mundo

El mundo se genera de forma determinista a partir de `WORLD_SEED` (`src/sim/random.ts`): el terreno y los biomas usan ruido simplex y cada tipo de prop tiene su propio generador, así que el mapa es idéntico en cada carga. La isla tiene cuatro biomas (`src/sim/world/biomes.ts`): la playa va por altura, la montaña empieza a los 6 m, y el resto es bosque o pradera según el ruido; el centro, donde se aparece, siempre es pradera, y el punto de aparición es llano. `BIOME_FLORA` dice la probabilidad de que cada tipo de prop arraigue en cada bioma: solo decide dónde salen, no cuántos hay. En la pradera hay árboles sueltos, arbustos y rocas; en el bosque, árboles densos, los abedules, las hierbas curativas y pocos arbustos; en la montaña, los pinos oscuros, las rocas y las menas; y en la playa, alguna roca. El suelo y el minimapa cambian de color con el bioma, mezclándose en las fronteras, y al entrar en uno aparece su nombre. En modo desarrollo, `window.__debug` expone un hash del mundo (`worldHash`) y helpers para probar el juego sin ratón (`start`, `advance`, `setKeys`, `aimAt`, `props({ kind })`, `drop(casilla, todo)`, `setDay(n)` para saltar al día n a la misma hora, `spawnEnemy(x, z, tipo)`, `throwRock(x, z)` para lanzarte una roca…); no se incluye en el build de producción.

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

En GitHub Pages el menú ya ofrece "Crear partida" y "Unirse" (el build publicado lleva `VITE_MULTIPLAYER=1` y se conecta a `SERVER_URL`). Reglas en una sala: la pausa es solo tuya (sigues en el mundo como "ausente"); al morir tu inventario cae al suelo y miras a un compañero (Tab cambia) hasta reaparecer a los 30 s o, si es de noche, al amanecer, con 3 s en los que ni recibes daño ni eres objetivo; si mueren todos, "Game over" y la isla se reinicia a los 6 s (salvo que entre o vuelva alguien vivo antes). <kbd>Enter</kbd> abre el chat. Si se corta la conexión, el juego vuelve a entrar solo durante un minuto, y los demás no ven "se ha ido / se ha unido" si vuelves en menos de 10 s.

Tráfico (medido en `npm run test:server` con 8 jugadores y 24 enemigos de noche): unos 30 KB/s de bajada por jugador en JSON, unos 15 KB/s con la compresión del WebSocket (permessage-deflate, que el Worker negocia). De subida, `cmds` a 20 Hz mientras te mueves, a 4 Hz quieto, a 1 Hz muerto y nada en pausa. En el plan gratuito de Cloudflare los mensajes entrantes cuentan 20 a 1 en las 100.000 peticiones diarias: unas 28 horas-jugador en movimiento al día (unas 7 h de partida a 4).

Para probarlo en local, con `npm run dev` y `npm run dev:server` a la vez:

- El menú tiene el lobby: tu nombre, "Jugar solo", "Crear partida" (deja el código en la URL y en la pausa sale "Copiar enlace") y "Unirse" con un código. `http://localhost:5173/?room=CODIGO` ofrece "Unirse a CODIGO" (con varias pestañas o navegadores se juega con varios).
- En una sala, arriba a la izquierda salen la conexión y la lista de jugadores (vida, ping, ausente); los nombres flotan sobre los demás, los compañeros salen en el minimapa con su color y lo que hacen suena donde pasa.
- Desde la consola: `await __debug.net.create()` crea una sala y deja su código en la URL; `__debug.net.join('CODIGO')`, `__debug.net.players()`, `__debug.net.addBot()` (otro jugador en la misma pestaña que anda en círculos, se para a talar y picar lo que puede y se fabrica un hacha y un pico de madera en cuanto tiene madera), `__debug.net.setLatency(100, 30)` (retraso artificial en ms), `__debug.net.drop()` (corta la conexión para probar la reconexión) y `__debug.net.stats()` (RTT, margen y correcciones de la predicción).
- En una sala, los trucos de `__debug` (`give`, `teleport`, `setVitals`, `spawnEnemy`, `placeStructure`, `setPhase`, `setDay`, `throwRock`, `aimAt`) los hace el servidor de desarrollo y devuelven una promesa; el de producción los rechaza.

**Desplegar el servidor corta las partidas abiertas unos segundos**: Cloudflare cierra los WebSockets al cambiar el código. Los clientes se reconectan solos con su token y siguen con la isla guardada (se pierden como mucho los últimos 10 s). Por eso el workflow solo lo despliega cuando cambia lo que el servidor ejecuta.
