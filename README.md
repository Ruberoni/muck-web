# muck-web

Juego de supervivencia low-poly para el navegador, inspirado en [Muck](https://store.steampowered.com/app/1625450/Muck/). No se usan assets, sonidos ni logos del juego original. Todo el contenido es propio salvo los personajes, del pack [Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html) de Quaternius (CC0).

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

Haz clic en la pantalla para empezar (captura el ratón). Las teclas de la tabla son las de por defecto: se cambian en los ajustes (ver [Sonido y ajustes](#sonido-y-ajustes)).

Lo que se puede usar ahora se marca con un contorno blanco tenue: una línea que recorre su silueta por fuera del modelo, sin marcar las caras ni las aristas de dentro, y que no se ve a través de nada. Va en el faro, el tótem, el avión y la tumba cuando se está a su lado (**E**), y en la fogata, las estaciones y el puesto del mercader cuando se los mira de cerca (clic derecho). El aviso bajo la mira dice qué se puede hacer y con qué tecla, que es la que se tenga asignada (`setOutline` en `src/view/StructureView.ts`: cada pieza sólida lleva una copia inflada por sus normales y dibujada del revés).

| Tecla | Acción |
| --- | --- |
| **W A S D** | moverse |
| **Ratón** | mirar |
| **Espacio** | saltar (gasta stamina) |
| **Shift** | correr (gasta stamina) |
| **Clic izquierdo** | golpear; mantenerlo repite el golpe |
| **Clic derecho** | mirando a una fogata, un horno o un destilador, abrir sus ranuras; mirando a la mesa de trabajo o al yunque, sus recetas (a unos 3 m o menos). Si no se mira a ninguna: con un escudo puesto, **mantenerlo** bloquea (salvo con comida en la mano, que se come); sin escudo, comer como con **F** |
| **F** | comer lo que se lleva en la mano; si no es comida, una baya. Junto a la barra de hambre se ve qué se comerá |
| **1–9** o **rueda del ratón** | elegir casilla de la hotbar (la rueda da la vuelta al pasar del extremo) |
| **Q** | tirar uno de lo que se tiene en la mano; **Ctrl + Q**, todos. En la pantalla de inventario, la casilla que está bajo el ratón |
| **Tab** o **E** | abrir o cerrar el inventario: la mochila (18 casillas) y la hotbar; clic en una casilla y en otra, o arrastrar una sobre otra, para intercambiarlas, y con el ratón encima de una casilla, **1–9** la intercambia con esa casilla de la hotbar, como en Minecraft. Junto a una fogata, un horno o un destilador se abre con sus ranuras. El ratón queda suelto y la partida sigue: con **W A S D** y **Espacio** se sigue andando y saltando (sin correr ni golpear); **C** también cierra y **Esc** cierra y pausa |
| **C** | abrir el inventario con las recetas a la vista: clic en una receta la fabrica y **Mayúsculas + clic**, hasta 5 |
| **Clic izquierdo** con la fogata o una estación (mesa de trabajo, horno o yunque) en la mano | colocarla |
| **+** / **−** | acercar o alejar el zoom del minimapa (se guarda con los ajustes) |
| **Esc** | pausa; en la pausa, pulsándolo otra vez, reanuda (también vale el clic de siempre). Si el navegador aún no deja recapturar el ratón —lo impide un instante tras salir con Esc— sale el aviso de reintento |

Recolectar lleva tiempo, y mejorar una herramienta es ganarlo. Los árboles dan 4 de madera y se talan con 16 golpes a mano, 8 con el hacha de madera y 2 con la de mithril. Las rocas dan 3 de piedra y no se pueden picar a mano: hacen falta 10 golpes con el pico de madera y 2 con el de mithril. Si se golpea algo sin la herramienta que pide, suena metálico, tiembla y no pasa nada; al apuntarle se ve en gris lo que hace falta ("Roca · necesita pico de madera"). Sobre todo en el bosque, entre 3 y 6 m de altura, crecen 40 abedules de tronco blanco, que solo caen con un hacha de piedra (3 golpes), de hierro (2) o de mithril (1) y dan +4 madera de abedul, y en la montaña (entre 6,4 y 13,5 m) hay 40 menas de hierro, rocas con vetas anaranjadas que solo se pican con un pico de piedra (3 golpes), de hierro (2) o de mithril (1) y dan +3 mineral de hierro. Entre 6,4 y 15 m crecen también 20 pinos oscuros, más grandes y de copa casi negra, que piden un hacha de hierro (3 golpes; 2 con la de mithril) y dan +4 madera oscura, y en las cimas (desde 13,5 m) hay 16 menas de mithril, pequeñas y con cristales azules, que piden un pico de hierro (3 golpes; 2 con el de mithril) y dan +5 mineral de mithril. Entre la pradera y la montaña (de 3 a 12 m) hay 30 menas de carbón, rocas con cristales negros que se pican con el pico de madera y dan +2 carbón, el combustible bueno del horno y del destilador. En la playa y la montaña crecen 24 árboles muertos, sin hojas, que piden un hacha de piedra (3 golpes) y dan +3 madera seca, que en el horno y el destilador arde el doble que la normal, y en la fogata, 1,5 veces. En las cimas (desde 12 m) hay también 12 menas de cristal, rocas con cristales cian que brillan, que piden un pico de hierro y dan +3 cristal, para el escudo de cristal. Los minerales se funden en el horno; la madera de abedul sirve para las herramientas de hierro y la oscura para las de mithril (ver [Crafteo](#crafteo)). Cada arbusto tiene 6 bayas a la vista: cada clic arranca una (+1 baya) y el arbusto se queda aunque esté vacío. Las bayas que faltan vuelven de una en una, una cada 15 s, así que un arbusto vacío se llena en 90 s. Sobre todo en el bosque crecen 30 hierbas curativas, matas pequeñas con flores rosas: un clic recoge la flor (+1 hierba curativa) y vuelve a salir a los 90 s. En la pradera crecen 30 matas de menta silvestre, verde claro con brotes azulados: un clic la recoge (+1 menta) y vuelve a salir a los 60 s. Los árboles y las rocas (también abedules, pinos oscuros y menas) no vuelven. La madera, la piedra y los minerales caen al suelo al talar o picar y se recogen pasando por encima (de cerca se acercan solas); las bayas van directas al inventario. Lo nuevo ocupa la primera casilla libre de la hotbar y, si está llena, de la mochila (18 casillas más); si no queda sitio, se queda en el suelo. Para hacer sitio, **Q** tira uno de la mano y **Ctrl + Q** la pila entera: sale hacia delante como un montón en el suelo, que quien lo tiró no puede recoger durante 2 s (los demás, sí). Lo que hay en el suelo no dura para siempre: la comida desaparece a los 3 minutos, los materiales a los 5 y las herramientas, armas y estaciones a los 10, parpadeando sus últimos 10 s (`GROUND_TIME` en `src/sim/inventory.ts`). Las monedas, los fragmentos de meteorito, los trofeos, las piezas del avión y todo lo que suelta un jugador al morir no desaparecen nunca.

En primera persona solo se ve el objeto de la casilla seleccionada, sin la mano, y se balancea al andar. Las espadas y las hachas son las de `public/models/weapons.glb` (de `arte/taller/armas.mjs`: espada corta para las de madera y piedra, espadón para las de hierro, mithril y meteorito), con la hoja del color de su material; el pico y lo demás, hechos en código. Cada clase de arma tiene dos golpes casi iguales que se van turnando (la espada, un tajo en diagonal y un revés; el hacha, de arriba y en diagonal; el pico, de arriba y otro más corto), que duran casi su cadencia y llegan abajo justo cuando pega el golpe. Cada golpe tiene su animación, también al aire, y mantener el clic golpea una vez cada 0,45 s aunque no haya nada delante. El golpe empieza al hacer clic (`playerSwing`) y pega un poco después, cuando la animación llega abajo (`playerStrike`, `STRIKE_DELAY`: 0,12 s con la espada, 0,18 con el hacha o el pico y 0,14 a mano), contra lo que se tenga delante entonces; si antes se cambia de objeto o se levanta el escudo, se pierde; comer y colocar la fogata o una estación también se animan.

## Crafteo

Las recetas están en la pantalla de inventario (**C** la abre directamente en ellas), agrupadas por estación:

| Estación | Receta | Coste |
| --- | --- | --- |
| — | hacha o pico de madera | 5 madera |
| — | fogata | 6 madera + 3 piedra |
| — | mesa de trabajo | 10 madera |
| mesa de trabajo | espada de madera | 5 madera |
| mesa de trabajo | hacha o pico de piedra | 3 madera + 5 piedra |
| mesa de trabajo | espada de piedra | 3 madera + 2 piedra |
| mesa de trabajo | escudo de madera | 8 madera |
| mesa de trabajo | horno | 12 piedra + 4 madera |
| mesa de trabajo | destilador | 8 madera + 4 piedra |
| mesa de trabajo | yunque | 4 lingotes de hierro + 6 piedra |
| yunque | hacha, pico o espada de hierro | 3 lingotes de hierro + 2 madera de abedul |
| yunque | hacha o pico de mithril | 3 lingotes de mithril + 2 madera oscura |
| yunque | espada de mithril | 2 lingotes de mithril + 2 madera oscura |
| yunque | hacha de meteorito | 3 fragmentos de meteorito + 2 madera oscura + 2 madera de abedul + 3 lingotes de hierro + 2 lingotes de mithril |
| yunque | pico de meteorito | 4 fragmentos de meteorito + 2 madera oscura + 2 madera de abedul + 3 lingotes de hierro + 2 lingotes de mithril |
| yunque | espada de meteorito | 3 fragmentos de meteorito + 2 madera oscura |
| yunque | escudo de hierro | 4 lingotes de hierro + 2 madera de abedul |
| yunque | escudo de cristal | 4 cristales + 2 lingotes de hierro |
| yunque | casco, peto, pantalones y botas de hierro | 3, 5, 4 y 2 lingotes de hierro |
| yunque | casco, peto, pantalones y botas de mithril | 3, 5, 4 y 2 lingotes de mithril |

Se ven todas siempre; las que no se pueden hacer salen atenuadas, con lo que falta en rojo y el motivo ("Necesitas un yunque cerca" si falta la estación). Un clic fabrica una y **Mayúsculas + clic**, hasta 5 seguidas.

Fundir, cocinar y destilar no son recetas: se hacen en las ranuras de la estación, como en un horno de Minecraft (ver [Estaciones](#estaciones)).

| Estación | Entrada | Salida | Tiempo por unidad |
| --- | --- | --- | --- |
| horno | 1 mineral de hierro | 1 lingote de hierro | 15 s |
| horno | 1 mineral de mithril | 1 lingote de mithril | 25 s |
| fogata (encendida) | 1 carne cruda | 1 carne asada | 10 s |
| fogata (encendida) | 4 bayas | 1 infusión de bayas | 15 s |
| destilador | 1 carne cruda | 1 aceite | 60 s |

Las herramientas de hierro hacen 6 de daño a lo de su familia y son las que abren el pino oscuro y la mena de mithril. Las de mithril hacen 12: nada pide mithril, y con ellas un abedul cae en 4 golpes, una mena de hierro en 5, un pino oscuro en 6 y una mena de mithril en 8. Las de meteorito son las mejores y las más caras, y tampoco abren nada nuevo: el hacha hace 16 (el árbol de un golpe, el abedul de 3 y el pino oscuro de 5) y el pico 24 (la roca y la mena de carbón de un golpe, la mena de hierro de 3, la de cristal de 3 y la de mithril de 4).

Las espadas son las armas para pelear: no talan ni pican, golpean cada 0,28 s (las herramientas, cada 0,45 s), y cada golpe alcanza además a los enemigos de delante, hasta 4, aunque vaya al aire. Por golpe hacen algo menos que una herramienta de su nivel:

| Nivel | Herramienta | Espada |
| --- | --- | --- |
| mano | 10 | — |
| madera | 20 | 16 |
| piedra | 30 | 25 |
| hierro | 40 | 35 |
| mithril | 60 | 50 |
| meteorito | 80 | 65 |

## Estaciones

La mesa de trabajo, el horno y el yunque se colocan como la fogata, con vista previa, y quedan de frente al jugador. Las recetas de cada estación se fabrican a unos 3 m o menos de su borde (3,3 m), de cualquiera de ese tipo: son permanentes y en una sala las comparten todos.

La fogata, el horno y el destilador procesan: **clic derecho** mirándolos, o **Tab** o **E** a su lado, abre el inventario con sus ranuras en lugar de las recetas. **Entrada**, lo que se procesa; **combustible**, lo que arde (el horno y el destilador: 1 madera arde 15 s, 1 madera seca 30 s y 1 carbón, 60 s; la fogata quema cualquier madera, pero no carbón: ver [Fogata](#fogata)); y **salida**, lo que sale. Para meter algo: un **clic** en una casilla mete la pila entera en la ranura que le toca (lo que la estación no acepta se intercambia como siempre), **clic derecho** mete una, y también se puede arrastrar la casilla a una ranura. Un clic en una ranura la saca al inventario. Cada ranura guarda hasta 99. La estación trabaja sola mientras tenga entrada, sitio en la salida y algo ardiendo, y el horno y el destilador solo gastan combustible mientras procesan (la fogata arde siempre que tenga leña); una barra enseña cómo va la unidad actual y otra lo que le queda a lo que arde. Si se para, la pantalla dice por qué (faltan bayas, la salida tiene otra cosa, no hay combustible, la fogata está apagada). Arriba dice lo que procesa y cuánto tarda en esta partida. Las ranuras son de la estación, no de quien las llenó: cualquiera puede meter y sacar, y se guardan con la partida. Una estación rinde lo mismo con 1 o con 5 jugadores. La dificultad alarga por igual recolectar y lo que tardan las estaciones. No se pueden atravesar, salen en el minimapa con un cuadrado (marrón la mesa, gris el horno, azul el yunque) y desaparecen al reiniciarse la isla. El horno tiene fuego en la boca, pero no ilumina como la fogata.

## Fogata

Se fabrica con 6 de madera y 3 de piedra. Con ella en la mano aparece una vista previa delante del jugador (verde si se puede colocar, roja si cae en el agua, en una pendiente o encima de algo) y un clic la coloca. Se coloca **apagada**: para encenderla hay que echarle leña en su ranura de combustible (al lado, **E** abre sus ranuras; un clic en la madera la mete). Arde sola mientras le quede leña, cocine o no, y se apaga al acabarse: 1 madera dura 1 min, 1 madera seca o de abedul 1,5 min y 1 madera oscura 2 min (una noche entera son unas 2 maderas). El carbón no le vale. Encendida da luz cálida que de noche ilumina el entorno (de día apenas se nota), crepita, cocina (ver [Crafteo](#crafteo)) y cura: a 4 m o menos de su borde, su calor da 0,5 de vida por segundo, además de la regeneración natural, también en los 8 s que siguen a un golpe y con cualquier hambre por encima de 0 (la mejora Recuperación no lo cambia y dos fogatas no se suman); mientras tanto, bajo las barras sale "Calor" y la barra de vida late en verde si está curando; apagada se queda en la leña, sin llama, sin luz ni sonido, sale gris en el minimapa y no cocina: lo que esté a medias espera a que se vuelva a encender. Al lado, el aviso dice si está apagada ("Fogata · Apagada — E para echarle leña") o cuánto fuego le queda contando la leña de la ranura ("Fogata · Encendida 1:30 — E para cocinar"). No se puede atravesar y desaparece al morir, con el resto de la partida.

## Armadura y escudo

En la pantalla de inventario, encima de la mochila, hay cinco huecos de equipo: **cabeza**, **pecho**, **piernas**, **pies** y **escudo**. Para ponerse una pieza de armadura o un escudo, **Mayúsculas + clic** en su casilla o arrastrarlo a su hueco; un clic en el hueco lo devuelve al inventario. Lo puesto no ocupa casilla, y al morir cae con todo lo demás.

- **Armadura**: cuatro piezas que se ponen y se quitan cada una por su lado (casco, peto, pantalones y botas) y se pueden mezclar. Cada una quita siempre una parte de todo el daño de los enemigos, venga de donde venga, y se suman: de hierro, el casco un 5 %, el peto un 11 %, los pantalones un 6 % y las botas un 3 % (un 25 % entre las cuatro); de mithril, un 8, un 19, un 10 y un 5 % (un 42 %).
- **Escudo**: manteniendo el **clic derecho** se levanta y para el daño que llega de frente (60° a cada lado de la mirada): el de madera un 70 %, el de hierro un 80 % y el de cristal un 90 %. Lo de los lados, lo de detrás y los meteoritos pasan enteros. Con el escudo arriba no se golpea, se anda a la mitad y no se corre, y la resistencia no se recupera; cada punto parado gasta 0,6 de resistencia y, si se acaba, el escudo baja hasta recuperarse, como al agotarse corriendo. Lo que se para suena a metal.

Armadura y escudo se suman: con el de hierro levantado y la armadura de hierro entera, un golpe de frente se queda en el 15 %. Los demás jugadores ven el escudo colgado a la izquierda, y delante cuando bloquean, y la armadura que lleva cada uno (viaja en un número, `armorCode`). Los valores están en `EQUIP_DEFS` (`src/sim/equipment.ts`).

## Supervivencia

El hambre (barra naranja) baja sola y se vacía en unos 4 minutos; cada baya devuelve 15, la carne cruda 8 y la carne asada 45, y esta además cura 15 de vida al acabar de comerla. La infusión de bayas recupera 2 de vida por segundo durante 20 s, y la hierba curativa cura 25 de vida de una vez. La menta silvestre llena la resistencia y durante 20 s correr y saltar no la gastan (el escudo sí): con varias seguidas se corre sin parar. Los efectos con tiempo (este aliento y los de las pociones) salen bajo las barras con los segundos que les quedan. Lo que no mejora nada (comer lleno, por ejemplo) no se gasta. Comer y beber llevan su tiempo (`time` en `CONSUMABLE_DEFS`): 0,6 s una baya o una menta, 0,7 la hierba, 0,9 la carne, 1 la infusión o el amuleto, 1,1 una poción y 1,2 el incienso. El efecto llega al acabar, también el del incienso y el del amuleto. Mientras tanto se ve la animación con lo que se come y una barrita bajo la mira, se anda a la mitad y sin correr, y no se golpea, no se coloca nada ni se levanta el escudo; no se empieza otro hasta acabar, y cambiar de casilla lo corta sin gastarlo. Con el hambre por encima del 30 % la vida se regenera 1 por segundo, salvo durante los 8 s siguientes a recibir un golpe, y con el hambre a 0 la vida baja hasta morir. Al calor de una fogata encendida se cura además 0,5 por segundo (ver [Fogata](#fogata)). Los consumibles se definen en `CONSUMABLE_DEFS` (`src/sim/constants.ts`) y pueden curar al momento o poco a poco; la curación poco a poco se suma a la natural, sigue aunque te golpeen, la barra de vida late en verde con los segundos que quedan y tomar otro solo renueva el tiempo. Al morir la partida empieza de nuevo: inventario vacío, isla restaurada y el jugador en el punto de aparición.

## El mar

Meterse en el mar tiene un precio: tras 12 s seguidos en su agua, vadeando o nadando, aparece un pez grande que da vueltas alrededor con la aleta fuera del agua, avisando con un gruñido y un aviso en pantalla. Desde entonces muerde cada 1,5 s hasta que se sale del agua: 35 donde ya no se hace pie y 15 en lo poco hondo de la orilla. Al salir se va, y la cuenta vuelve a empezar. No se puede matar ni apuntar, y como muerde desde abajo el escudo no lo para (el peto, sí). En los lagos no hay peces, aunque en su centro haya que nadar. Los demás jugadores lo ven rondar a quien sea (`src/sim/fish.ts`, `src/view/FishView.ts`).

## Enemigos

Al anochecer empiezan a aparecer trasgos a 34–48 m del jugador, uno cada 5 s, y cada uno se anuncia antes: 1,5 s antes de salir se levanta una columna de humo oscuro donde aparecerá, que se ve por encima de los árboles y a través de la niebla, con un soplo grave que se oye desde allí (`enemyIncoming`, `src/view/SpawnSmokeView.ts`). Los jefes salen con su humo, sin esperar. Hay 3 a la vez la primera noche y 2 más cada noche, hasta 12. Persiguen al jugador algo más despacio de lo que anda y rodean árboles y rocas, pero solo dentro de su rango de agro: ven a quien tienen a 55 m y no lo sueltan hasta los 80 m (`ENEMY_AGGRO` y `ENEMY_AGGRO_DROP`, con margen entre las dos para que no duden en la frontera). Al perderlo de vista no se quedan quietos ni cruzan la isla detrás: vagan despacio por la zona, dando vueltas, y vuelven a perseguir en cuanto el jugador entra otra vez en su rango. Los jefes no tienen ese límite, y los guardianes usan su propio `aggro` y `leash` alrededor del cráter. También nadan: donde ya no se hace pie van al 30 % de su velocidad y nunca a más de 2,5 m/s, bastante menos que lo que nada el jugador (3 m/s), y flotan con el cuerpo medio fuera, así que se les puede golpear. El agua ya no es un refugio, pero da mucho más margen para escapar. Pegados al jugador le quitan 10 de vida cada 1,2 s. Se golpean como los props (clic), y tienen 70 de vida: 7 golpes a mano; con hacha o pico, 4 de madera, 3 de piedra y 2 de hierro o mithril; con espada, 5, 3, 2 y 2, pero mucho más seguidos. Cada golpe los hace retroceder. Al morir dejan carne cruda y una moneda en el suelo; cuanta más vida tienen (las noches avanzadas, la Noche Eterna y el tótem la suben), más monedas sueltan. El gólem y el espíritu dan 2, y los jefes y el guardián muchas más. Las monedas se gastan en el mercader (ver [Mercader](#mercader)). Al amanecer dejan de salir nuevos, pero los que quedan siguen ahí hasta que los mates, y cuentan para el tope de la noche siguiente. Desde la noche 2 algunos dejan paso a otros tres enemigos, cada noche más hasta la 4:

| Enemigo | Vida | Velocidad | Daño | Pico | Hacha | Espada | Mano | Sale sobre todo en | Suelta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Trasgo | 70 | 5 | 10 | ×1 | ×1 | ×1 | ×1 | cualquier sitio | carne cruda |
| Trasgo lancero | 55 | 5 | 12 (la lanza) | ×1 | ×1 | ×1 | ×1 | cualquier sitio, uno de cada tres trasgos | carne cruda |
| Gólem de piedra | 170 | 3,5 | 15 | ×2 | ×0,5 | ×1 | ×0,5 | montaña | 3 piedra + 1 mineral de hierro |
| Espíritu del bosque | 130 | 6 | 8 | ×0,5 | ×2 | ×1 | ×0,5 | bosque | 4 madera + 1 madera de abedul |
| Perro salvaje | 45 | 7,5 | 4 | ×1 | ×1 | ×1 | ×1 | pradera y playa, en manada de 2 o 3 | carne cruda |

Cada 3 noches sale además un **mini-boss**, unos 20 s después de anochecer, a 38–50 m. Al amanecer de ese día se anuncia con un cartel, y hasta que llega se ve "Esta noche: …" bajo el día; mientras vive, arriba sale su barra de vida. No cuenta para el tope de enemigos y, como el resto, no se va al amanecer: si sigue vivo, no sale otro. Su vida se multiplica por los jugadores, para que un grupo no lo mate antes que uno solo, y su botín crece un 50 % por cada jugador a partir del segundo. La armadura resta una cantidad a cada golpe: castiga las armas rápidas y débiles.

- **Trasgo gigante** (noches 3, 9, 15…): 1.800 de vida, armadura 10 y más rápido que andar. Los golpes normales no lo aturden. Su **embestida** es uno de sus ataques especiales: a 5–9 m se agacha 0,8 s, brillando y rugiendo, y carga en línea recta hacia donde estabas: se esquiva apartándose, y se para al chocar con algo. Si te alcanza te da un golpe fuerte de 40 con la lanza, y al acabar queda 2,5 s aturdido, tambaleándose, y recibe el doble. Suelta 3 carnes crudas y 2 lingotes de hierro.
- **Lanzarrocas** (noches 6, 12…): 1.400 de vida, armadura 5 y algo más lento que andar. No se aturde. Se te acerca hasta unos 14 m y retrocede si llegas a menos de 8. Sus rocas se esquivan moviéndose, y los árboles y las rocas las paran. Suelta 2 minerales de mithril y 6 de piedra.

Los cuatro jefes (estos dos, el guardián del meteorito y el Coloso de Cristal) **solo atacan con sus ataques especiales**: no tienen golpe normal, y mientras no les toca ninguno se acercan o guardan las distancias. Cada uno tiene su espera, y entre dos cualesquiera pasan al menos 2,5 s; a cualquier distancia hasta 9 m tienen alguno que se repite en 10 s o menos, así que ninguno se queda inofensivo pegado a ti. Antes de cada uno avisan (agachados y brillando en rojo, o con la roca en alto) y después quedan 1–1,5 s **agotados**, quietos, tambaleándose y recibiendo el doble: es el hueco para golpearlos (`specials` en `ENEMY_DEFS`; las zonas y las ondas, en `src/sim/hazards.ts`).

- Trasgo gigante: **pisotón** (hasta 6 m, cada 5 s, cae clavando la lanza con una onda de 7 m y 20 de daño que se esquiva saltando o alejándose; el suelo tiembla) y **tres flechas** con el arco (a 10–26 m, seguidas, cada 0,3 s y hacia donde estás al soltarla, 20 cada una) y la **embestida**.
- Lanzarrocas: **golpe fuerte** (si estás pegado, golpea el suelo delante con los dos puños: 35 en 2,6 m), **llama gólems** (salen dos del suelo a su alrededor, hasta tres a la vez) y **roca rápida** (a 4–24 m, casi el doble de rápida que las de siempre y más fuerte).
- Guardián del meteorito: **anillo de fuego** (de cerca, cada 5 s, una onda de 9 m más lenta que el pisotón, 18 de daño, que se esquiva saltando), **suelo ardiente** (a 3–18 m, tres charcos de fuego, uno donde estás, que se marcan 0,8 s y queman 4 cada 0,5 s durante 5 s) y **rayo** (a 2–20 m, marca donde estás y cae a los 0,9 s con 25).
- Coloso de Cristal: **pulso** (si estás a menos de 4 m, cada 5 s, estalla a su alrededor en 4,5 m con 25, medio segundo después de marcarlo), **pilares** (a 1–16 m, seis cristales en fila hacia ti que brotan uno tras otro con 20: se esquivan de lado), **abanico de esquirlas** (a 5–20 m, cinco abiertas, 12 cada una: hay hueco entre dos) y **haz de luz** (hasta 30 m, te apunta 2 s, marca donde estás y cae a los 0,8 s con 35). Con la coraza rota repite sus ataques un 25 % antes (`SHELL_BROKEN_PACE`).

Las zonas y las ondas las decide el servidor por ticks, con su centro fijo, y el cliente las dibuja en su tick predicho, como los proyectiles: se esquiva lo que se ve.

Los mobs comunes golpean con peso: al llegar esperan un momento y empiezan el golpe (`enemySwing`, cuando la vista arranca la animación), que pega un poco después, en el impacto (`strike` en `ENEMY_DEFS`: 0,45 s el trasgo, 0,6 el gólem, 0,5 el espíritu y 0,35 el perro). Mientras lo prepara te sigue, así que quien solo anda se lo come; corriendo o apartándose de lado, falla. Un golpe que lo aturde le interrumpe el suyo, que vuelve a intentar tras su espera: aun golpeándolo sin parar, nunca tarda más de 2 s en pegar. El trasgo lancero no se acerca: se queda a 8–14 m y retrocede si llegas a menos de 8. Cada 4–5 s (cada uno a su ritmo, para que no lancen todos a la vez), hasta 18 m, se para y apunta 0,62 s, gruñendo, y lanza su lanza hacia donde estás al soltarla; después tarda 0,73 s más en acabar el lanzamiento, quieto. Se esquiva moviéndose, y un golpe que lo aturde mientras apunta le corta el lanzamiento. El perro salvaje corre más que quien anda y menos que quien corre: para escapar de una manada hay que gastar resistencia. Muerde poco, pero seguido, y ladra en vez de gruñir. El gólem no se aturde ni retrocede. Al trasgo y al espíritu, tras un golpe que los empuja y los aturde 0,3 s les quedan 0,6 s de aguante: durante ese rato los golpes les quitan vida, pero no los empujan ni les interrumpen el ataque, así que golpear sin parar no evita que te peguen.

Los enemigos se ven con sus modelos animados (`public/models/mobs`, de `arte/listas` con `npm run exportar` en `arte/taller`): cada apariencia va horneada en una o dos piezas con el color en los vértices, para que veinte a la vez no cuesten cientos de llamadas de dibujo. Se descarga cada uno la primera vez que sale uno de su tipo (los trasgos, ya al empezar) y mientras tanto se ve el de cajas, que es también su hitbox. Andan o corren según cómo se mueven, y los golpes, los lanzamientos, los ataques especiales, los golpes recibidos y la muerte salen de los eventos de la simulación, a la velocidad que hace que el golpe de la animación caiga cuando cae el de verdad (`src/view/enemyModels.ts`, `src/view/EnemyRig.ts`). El trasgo gigante va tal cual, con sus texturas (6,5 MB). Sus licencias están en `public/models/mobs/LICENSE.txt`, y los créditos salen en el menú. Cada tipo de enemigo es una entrada de `ENEMY_DEFS` (`src/sim/constants.ts`): vida, velocidad, tamaño, daño, ritmo de ataque, botín, debilidades… Cada mob común guarda la apariencia con la que salió (`look`): la de siempre, la de la Noche Eterna o la del tótem activado. Con ella cambia su modelo y, en algunos, su tamaño (`LOOK_GROWTH`: el trasgo y el lancero, 1,3 veces de noche y con el tótem; el perro, 1,2 con el tótem), y su hitbox crece igual. Lo que vuela (`src/sim/projectiles.ts`) cae con la gravedad y choca con jugadores, props, estructuras y suelo, pero pasa por encima de lo que le queda 3 m por debajo. Los choques los decide el servidor; el cliente sigue la trayectoria en el momento de su predicción, para que se pueda esquivar lo que ve.

Un enemigo puede ser débil o resistente a una clase de arma (`weakness`): el golpe multiplica su daño, y tanto el destello (amarillo si es eficaz, gris si lo resiste) como el sonido lo dejan ver.

## Personajes

En una sala, cada jugador es un personaje animado: todos son **la náufraga** casual (descalza, short y camiseta rota), la única skin (`Naufraga.glb`, 989 KB), así que el menú enseña su vista previa sin desplegable. Lleva puestas las piezas de armadura que tiene equipadas: cada una tapa su parte del cuerpo (el casco el pelo, el peto el torso, los pantalones las piernas y las botas los pies; la cabeza siempre se ve) y su parte de metal va del color del hierro o del mithril (`CharacterRig.setArmor`). Las demás skins del pack ya no están; Casual y Medieval, de donde sale la náufraga, quedan en `arte/fuentes/` para el taller. Como la partida es en primera persona, la propia no se ve al jugar, y en solitario no se descarga ninguna hasta abrir la vista previa.

Andan, corren en las cuatro direcciones, golpean, comen, reciben golpes y mueren, y llevan en la mano lo que tienen seleccionado. Las piernas y el torso se animan por separado, para poder correr y golpear a la vez (`src/view/CharacterRig.ts`). Solo se descarga la skin de quienes están en la sala; mientras llega, o si no se puede cargar, se ve el cuerpo de cajas de siempre. A la simulación le da igual la skin: colisiones, vida y velocidad no cambian.

Los modelos están en `public/models/`. La náufraga sale de `arte/listas/personaje/Jugador.glb` (`npm run jugador` y `npm run exportar` en `arte/taller`): un esqueleto con el cuerpo en piezas y las cuatro de armadura, que se prenden y se apagan. Las animaciones van una vez en `animations.glb`, convertidas desde el pack con `scripts/build-models.mjs`, porque todos comparten esqueleto. El zip original no va en el repositorio. Para volver a generarlos:

```bash
node scripts/build-models.mjs "<carpeta Individual Characters/glTF del pack>"
```

## Sonido y ajustes

Todos los sonidos se generan en el navegador con Web Audio (`src/audio/`), sin archivos de audio: golpes en madera, piedra y arbustos, recoger, comer, fabricar, colocar la fogata o una estación, pasos (también en el agua), saltos, daño, trasgos que gruñen desde donde están y la muerte. De fondo hay viento, pájaros de día, grillos de noche y el crepitar de las fogatas encendidas cercanas; el ambiente se calla en el menú y en la pausa. El navegador no deja sonar nada hasta el primer clic.

Los mobs también pisan al andar: un golpe grave y corto, uno por paso (cada 2,1 m por su escala, así que los del Coloso suenan espaciados y los de un perro seguidos). Es discreto a propósito, porque se repite mucho y pueden ser 24 a la vez: solo se oye hasta 16 m, a menos de la mitad del volumen de un paso propio, y como mucho suenan dos por frame, los más cercanos. Donde un mob no hace pie, nada y chapotea (`enemySteps` en `src/audio/gameAudio.ts`).

En el menú y en la pausa hay deslizadores para la sensibilidad del ratón, el campo de visión y el volumen. Se guardan en `localStorage` y se aplican al momento. También hay un interruptor para el suavizado (MSAA): como es un atributo del contexto WebGL y no se puede cambiar con el contexto ya creado, se guarda y **se aplica al recargar la página**. El zoom del minimapa (**+** / **−**) se guarda con los mismos ajustes.

Debajo hay una sección **Teclas**: las acciones del núcleo (moverse, saltar, correr, golpear, bloquear, usar, comer, inventario, recetas y tirar) se reasignan con un clic en su botón y la tecla o el botón del ratón que se pulse después. Una tecla no puede estar en dos acciones a la vez: al asignarla, la que la tenía se queda sin ninguna y se ve como `—`. **Esc** no se asigna (ya cierra la pausa y el inventario) y deja la acción vacía. "Restaurar las teclas" vuelve a las de la tabla de arriba. Las asignaciones viven en `src/game/bindings.ts`, se guardan con los demás ajustes y las leen `Input`, `stepActions` y la pantalla de inventario.

## Mundo

Cada partida es en una isla distinta. Una isla (`Island`, `src/sim/world/island.ts`) sale de una semilla: el terreno y los biomas usan ruido simplex con ella y cada tipo de prop tiene su propio generador derivado de ella, así que la misma semilla da siempre la misma isla. Al empezar una partida, en solitario o en una sala, se elige una al azar y se comprueba que se pueda jugar (`src/sim/islands.ts`): que quepan todos los props, cada uno en su bioma y su franja de altura, que haya un punto de aparición llano en la pradera y sitio para el faro y el tótem, este a más de 40 m del principio; si no, se prueba la siguiente semilla. Las de partida miden 600 m de lado (`ISLAND_SIZE`), el triple que la de siempre (`WORLD_SEED`, `src/sim/random.ts`, de 200 m), que es la del menú y la de las pruebas. En ellas hay de todo unas cinco veces más (`propCounts`: lo de la de siempre por su lado elevado a 1,5, algo menos que su superficie, porque caminar es parte del juego) y unos cinco lagos tierra adentro, fuera del claro del centro y sin tocar el mar: se vadean casi enteros (el fondo a 0,7 m) y solo en el centro cubren y hay que nadar. Las colocaciones de los props van redondeadas al milímetro y, en el cable, en tuplas: los de una isla grande son unos 2.600 y el `welcome` se queda en unos 130 KB sin comprimir. En una sala, el servidor manda la semilla y las colocaciones de los props en el `welcome` y, al empezar una partida en otra isla, en el `state` que reciben todos; la partida guardada lleva su semilla. Todo lo que mira el suelo (jugadores, enemigos, objetos, proyectiles, estructuras, meteoritos, la malla, el minimapa y la decoración) recibe la isla en vez de usar una fija. La isla tiene cuatro biomas (`src/sim/world/biomes.ts`): la playa va por altura, la montaña empieza a los 6,4 m, y el resto es bosque o pradera según el ruido; el centro, donde se aparece, siempre es pradera, y el punto de aparición es llano. `BIOME_FLORA` dice la probabilidad de que cada tipo de prop arraigue en cada bioma: solo decide dónde salen, no cuántos hay. En la pradera hay árboles sueltos, arbustos y rocas; en el bosque, árboles densos, los abedules, las hierbas curativas y pocos arbustos; en la montaña, los pinos oscuros, las rocas y las menas; y en la playa, alguna roca. Por encima de 5 m el terreno sube 3 veces más deprisa (`lift`, `src/sim/world/terrain.ts`), salvo en el claro del centro, que sigue como antes y desde el que la subida llega poco a poco hasta los 80 m: las cimas rondan los 20–25 m y las laderas de la montaña son empinadas, mientras que la playa, la pradera, el bosque y los lagos quedan igual. Las franjas de altura de los props pasan por la misma cuenta y, en la montaña, aceptan pendientes 3 veces mayores; corriendo cuesta abajo se sigue pegado al suelo. El suelo y el minimapa cambian de color con el bioma, mezclándose en las fronteras, y al entrar en uno aparece su nombre. En modo desarrollo, `window.__debug` expone un hash del mundo (`worldHash`) y helpers para probar el juego sin ratón (`start`, `advance`, `setKeys`, `aimAt`, `props({ kind })`, `drop(casilla, todo)`, `setDay(n)` para saltar al día n a la misma hora, `spawnEnemy(x, z, tipo)`, `throwRock(x, z)` para lanzarte una roca, `meteor(x, z)` para que caiga un meteorito…); no se incluye en el build de producción.

Los árboles, abedules, pinos oscuros, rocas, menas y arbustos se dibujan con modelos low-poly de colores lisos (`public/models/nature/nature.glb`): árboles, rocas, arbustos y hierba del Simple Nature Pack, árboles muertos y guijarros del Stylized Nature MegaKit y cristales del Ultimate RPG Items Pack, todos de Quaternius (CC0); el pino de pisos, las setas y las flores se hacen en el propio script. Cada tipo tiene dos o tres variantes, y cada prop lleva una versión entera, con sombra, hasta 55 m de la cámara y otra simplificada, sin sombra, más lejos. Más allá de 330 m, donde la niebla ya tapa todo, no se dibujan, y cada mesh solo lleva las instancias que se ven. Alrededor de la cámara (40 m) hay además decoración sin colisión: hierba teñida del color del suelo, flores, setas y guijarros, según el bioma. Lo que se ve cambia, pero las colisiones y la puntería no: siguen las formas de siempre, que quedan ocultas, y `scripts/nature.test.ts` comprueba que los modelos caben en ellas. Mientras se descargan, o si fallan, se ven esas formas. Los zips no van en el repositorio; para volver a generarlos:

```bash
node scripts/build-nature.mjs "<Simple Nature Pack/OBJ>" "<Stylized Nature MegaKit/OBJ>" "<Ultimate RPG Items Pack/OBJ>"
```

La lógica que no depende de three.js ni del DOM (jugador, supervivencia, colisiones, inventario, fabricación, constantes, generador aleatorio, altura del terreno y reloj del día) vive en `src/sim/`, para que la pueda ejecutar también un servidor. `npm run typecheck:sim` la compila sin la librería del DOM y un test comprueba que no importa three ni nada de fuera de `src/sim/`.

## La Noche Eterna

La partida va contra el reloj, y el reloj depende de cuántos empezaron: con más jugadores, menos tiempo. La noche dura 2,1 minutos para todos; lo que cambia es la luz de cada día. Cuando cae la noche 6, ya no vuelve a amanecer: la niebla se cierra a unos 40 m y un contador sigue las noches. Cada una acaba con una campana que se oye en toda la isla, y en ese momento pasa lo que antes pasaba al amanecer: vuelven los muertos que estaban esperando, cae el meteorito y sale el jefe que toque.

| Jugadores | Luz por día | Cae la Noche Eterna | Campana |
| --- | --- | --- | --- |
| 1 | 6 min | minuto 45 | cada 6 min |
| 2 | 5 min | minuto 40 | cada 5,5 min |
| 3 | 4 min | minuto 34 | cada 5 min |
| 4 | 3,5 min | minuto 31 | cada 4,5 min |
| 5 | 3 min | minuto 28 | cada 4 min |

Los mobs comunes tienen tope (hasta 24 a la vez), así que lo que sube es su fuerza: un 5 % más de vida por noche, un salto al caer la Noche Eterna (vida ×1,5, daño ×1,3, velocidad ×1,15) y, con cada campana, un nivel y un rasgo anunciado de antemano: Rápidos (+8 % de velocidad), Fuertes (+15 % de vida y +10 % de daño) o Agresivos (atacan y aparecen un 10 % más seguido). Nunca pasan de velocidad 9: corriendo siempre se les deja atrás. Los jefes y los guardianes no suben. Desde la Noche Eterna los enemigos desaparecen del minimapa. La dificultad multiplica lo que añaden los saltos: ×0,75 en fácil y ×1,5 en ultrahard.

## Construcciones compartidas

El faro y el tótem ya están en la isla desde el principio, en ruinas, y no se fabrican: el faro, una torre enorme, en lo más alto para verse desde todas partes, y el tótem lejos de él y del punto de aparición, los dos en el minimapa. Se reparan entre todos, llevando los materiales hasta allí: <kbd>E</kbd> al lado entrega lo que falte de la fase actual, y una barra enseña a todos cómo va. Con 3 jugadores en normal, el faro pide 240 de piedra, 220 de madera, 90 lingotes de hierro, 22 de mithril y 12 cristales, y el tótem 200 de piedra, 150 de madera oscura y 100 lingotes de hierro (más su corazón). Con otro número de jugadores se multiplica por el tiempo de trabajo que juntan hasta la Noche Eterna respecto al de 3 (`playerScale`, `src/sim/builds.ts`: con uno, un 45 %; con cinco, un 138 %), y la dificultad multiplica la cantidad como multiplica la vida de lo que se rompe, así que también alarga la caminata. La cuenta está en `src/sim/balance.test.ts` (el presupuesto de tiempo): contando golpes, paseo hasta cada prop y un viaje por material, y que se trabaja un 40 % del tiempo (el resto se va en las noches, en comer y en fabricar), cada prioridad (las armas de cada uno, el faro y el tótem) se lleva algo menos de la mitad del tiempo hasta la Noche Eterna: entre las tres, un 130–138 % en normal con cualquier número de jugadores. Da para dos, no para las tres; en fácil casi para todo y en ultra apenas para dos. <kbd>E</kbd> actúa sobre lo que haya cerca; si no hay nada, abre el inventario.

Con el faro acabado, <kbd>E</kbd> carga el aceite que se lleve (guarda hasta 10) y, si no se lleva, lo enciende o lo apaga, a cualquier hora; sin aceite no enciende, y el aviso lo dice. Una unidad da 39 s de luz, y cada campana un 10 % menos. Mientras arde no aparecen mobs comunes nuevos en toda la isla (los que ya estaban siguen, y los jefes y la campana tampoco cambian): sin mobs tampoco hay carne ni monedas, así que cada noche tranquila se paga con aceite. Si arde al menos dos tercios de una noche, cuenta como iluminada: en una noche normal los mobs no suman ese 5 % de vida, y en la Noche Eterna no suben con la campana. De día arde y gasta, pero no cuenta; no hace falta tenerlo siempre encendido, sino elegir qué noches se compran. Encendido, sus dos haces barren la isla, la noche se aclara y la niebla de la Noche Eterna se abre en toda ella, sea cual sea su tamaño. Quien muera de noche con el faro encendido reaparece en él a los 60 s; apagado, al amanecer o en la siguiente campana, en el punto inicial.

El aceite se hace en el destilador (se fabrica en la mesa de trabajo): 1 carne cruda en la entrada da 1 aceite en 60 s, con 4 de madera o 1 carbón ardiendo. Compite con la comida, y un destilador no basta para una noche.

El tótem se repara igual, en tres fases: la última pide 3 fragmentos de meteorito por jugador y un trofeo, que sueltan los jefes de noche. Manteniendo <kbd>E</kbd> 3 s se activa, sin vuelta atrás: los mobs dan el segundo salto (vida ×1,5, daño ×1,3, velocidad ×1,1). Se puede activar cuando se quiera, incluso antes de la Noche Eterna. Pronto evita que sigan subiendo mientras se espera, pero pilla con menos equipo.

Al activar el tótem el avión cae en llamas, lejos de él, y se anuncia hacia dónde. Se repara entregando materiales. Después, cualquiera arranca el motor con <kbd>E</kbd>: tarda 90 s en calentar y mientras tanto todos los mobs comunes van a por él. Si le quitan toda la vida el motor se apaga, pero no se destruye: se repara con 10 de madera y se vuelve a arrancar. Al acabar despegan quienes estén vivos y a menos de 8 m; si no hay nadie, espera. Se gana si escapa al menos uno, y la pantalla final dice quién se salvó y quién se quedó.

Hay una tumba escondida en la isla, y se puede encontrar antes de activar el tótem, aunque hasta entonces está dormida. Al activarlo lanza una columna de luz que se ve a través de la niebla y sale en el minimapa. Manteniendo <kbd>E</kbd> 3 s se abre y nace el **Coloso de Cristal**: 3.000 de vida por jugador, armadura 15 y una coraza que hay que romper a pico, porque hasta entonces lo demás apenas le hace daño. Suelta el motor, que es lo último que le falta al avión. Si no se mata, sigue ahí; no se pierde nada.

Lo imprescindible para escapar no se puede perder: si quien lo lleva se va, cae al suelo, y si cae al agua aparece en la orilla.

## Mercader

El puesto del mercader ya está en la isla desde el principio, a 40–70 m del punto de aparición y lejos del faro y del tótem, con un toldo morado, una linterna que se ve de noche y su punto en el minimapa. Con <kbd>E</kbd> o el **clic derecho** a su lado se abre el inventario con su tienda en lugar de las recetas (se puede seguir andando, y se cierra al alejarse). Las compras las decide el servidor (`src/sim/merchant.ts`).

**Vende** (un clic, uno):

| Objeto | Efecto | Precio |
| --- | --- | --- |
| Poción de curación | +60 de vida al momento | 8 |
| Poción de velocidad | +30 % de velocidad, 60 s | 10 |
| Poción de aguante | llena la resistencia y 60 s sin gastarla | 8 |
| Poción de piedra | −30 % del daño recibido, 60 s | 12 |
| Incienso de calma | todos los mobs comunes de la isla, vivos o anunciados, se deshacen en humo, sin botín | 25, +50 % cada compra |
| Amuleto del olvido | deshace el último rasgo de las campanas (Rápidos, Fuertes o Agresivos) y su nivel; solo se vende si hay alguno | 40, +50 % cada compra |

Lo que sube de precio sube para todos en la sala y se guarda con la partida. Se toman como la comida (**F**, o el clic derecho con ellos en la mano). No vende aceite: las noches tranquilas del faro se siguen pagando con carne y tiempo de destilador.

**Compra**, barato y en lotes: 10 de madera o de piedra, o 3 de carne cruda, por 1 moneda; un lingote de hierro por 1 y uno de mithril por 3. No compra nada de lo que vende, ni lo que no se puede perder (piezas del avión, trofeos, fragmentos de meteorito): vender sirve para sacar algo de lo que sobra, pero las monedas salen sobre todo de los mobs.

**Mejoras** (la tercera pestaña de la tienda): seis mejoras que se apilan multiplicando y duran lo que la partida (una isla nueva empieza de cero). El primer nivel cuesta 100 monedas y cada uno siguiente suma 50 (100 → 150 → 200…), o su equivalente en materiales: 25 lingotes de mithril o 60 de hierro el primero, escalados igual. Con cuál se paga se elige encima de la lista.

| Mejora | Cada nivel |
| --- | --- |
| Fuerza | ×1,5 al daño de cada golpe, con armas y con herramientas: también se recolecta más deprisa |
| Vitalidad | ×1,5 a la vida máxima (100 → 150 → 225), y al comprarla se cura lo que sube |
| Recuperación | ×1,5 a la regeneración natural de vida (sigue pidiendo hambre por encima de 30 y 8 s sin recibir daño; no cambia el calor de la fogata) |
| Aguante | ×1,5 a la recuperación de resistencia |
| Metabolismo | ×0,5 al ritmo al que baja el hambre |
| Empuje | ×2 al empujón que reciben los enemigos al golpearlos |

Las mejoras son de cada jugador, no del puesto: el precio sube con los niveles que tenga cada uno. Las paga el servidor y llegan con su estado, así que la predicción del cliente no las adivina (`src/sim/boosts.ts`).

## Meteoritos

Desde el día 2 cae un meteorito al día, a media mañana o a mediodía, a la hora que toque en cada partida; en la Noche Eterna, con cada campana. Se anuncia 6 s antes con una bola de fuego en el cielo, un silbido, el aviso "¡Cae un meteorito al norte!" (según dónde estés) y una marca roja en el suelo. Cae en hierba libre, entre 40 y 70 m de un jugador vivo, y quien esté a menos de 4 m recibe 20 de daño. Deja un cráter y una roca que no se puede atravesar, con su rombo en el minimapa, y junto a ella aparece su guardián. Mientras viva, la roca sigue al rojo y no cae otro; al morir, la roca se enfría y desaparece al amanecer siguiente. Los decide `src/sim/worldEvents.ts`, y en red el cliente sigue sus eventos.

El **Guardián del meteorito** tiene 1.500 de vida por cada jugador en el mundo y armadura 10, es más lento que andar y no se aturde; solo pega con sus ataques especiales. El pico le hace ×1,5. Se queda quieto junto al cráter hasta que un jugador vivo se acerca a 15 m; entonces lo persigue mientras no se aleje más de 25 m de su sitio, y si se aleja vuelve a él sin curarse. Sigue ahí de día y de noche hasta que lo matan, y suelta 3 fragmentos de meteorito por jugador. Con 3 fragmentos y 2 de madera oscura, en el yunque, se hace la espada de meteorito: 65 de ataque y un golpe cada 0,25 s, la mejor espada del juego. Con 3 fragmentos el hacha y 4 el pico, más 2 de madera oscura, 2 de abedul, 3 lingotes de hierro y 2 de mithril cada una, se hacen las herramientas de meteorito (16 y 24 de daño, 80 de ataque): las mejores del juego y tan caras que el equipo de meteorito completo pide diez fragmentos por jugador, cuatro guardianes.

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

En GitHub Pages el menú ya ofrece "Crear partida" y "Unirse" (el build publicado lleva `VITE_MULTIPLAYER=1` y se conecta a `SERVER_URL`). Una sala va por partidas, de 1 a 5 jugadores: en la sala de espera la isla no avanza, y el anfitrión (quien la crea, o el siguiente si se va) elige la dificultad y la empieza. Las reglas se fijan ahí: aunque alguien se vaya no cambian, nadie nuevo puede entrar y solo vuelve quien estaba, con su enlace. Los demás entran con un clic. En la pausa se puede votar rendirse: hace falta más de la mitad. Al acabar se vuelve a la sala de espera, con el resultado a la vista, para jugar otra.

Reglas en una sala: la pausa es solo tuya (sigues en el mundo como "ausente"; al volver, y también si la página se queda más de 2 s sin dibujar, por ejemplo con la ventana tapada, se pide el estado completo en vez de adelantarse al servidor); al morir tu inventario cae al suelo y miras a un compañero (Tab cambia) hasta reaparecer a los 30 s o, si es de noche, al amanecer, con 3 s en los que ni recibes daño ni eres objetivo; si mueren todos, "Game over" y a los 6 s acaba la partida (salvo que vuelva alguien vivo antes). En solitario es igual, pero con vidas: 3 en fácil, 2 en normal y 1 en difícil o ultrahard. <kbd>Enter</kbd> abre el chat. Si se corta la conexión, el juego vuelve a entrar solo durante un minuto, y los demás no ven "se ha ido / se ha unido" si vuelves en menos de 10 s.

Tráfico (medido en `npm run test:server` con 5 jugadores y 24 enemigos de noche): unos 30 KB/s de bajada por jugador en JSON, unos 15 KB/s con la compresión del WebSocket (permessage-deflate, que el Worker negocia). De subida, `cmds` a 20 Hz mientras te mueves, a 4 Hz quieto, a 1 Hz muerto y nada en pausa. En el plan gratuito de Cloudflare los mensajes entrantes cuentan 20 a 1 en las 100.000 peticiones diarias: unas 28 horas-jugador en movimiento al día (unas 7 h de partida a 4).

Para probarlo en local, con `npm run dev` y `npm run dev:server` a la vez:

- El menú tiene el lobby: tu nombre, "Jugar solo", "Crear partida" (deja el código en la URL y en la pausa sale "Copiar enlace") y "Unirse" con un código. `http://localhost:5173/?room=CODIGO` ofrece "Unirse a CODIGO" (con varias pestañas o navegadores se juega con varios).
- En una sala, arriba a la izquierda salen la conexión y la lista de jugadores (vida, ping, ausente); los nombres flotan sobre los demás, los compañeros salen en el minimapa con su color y lo que hacen suena donde pasa.
- Desde la consola: `await __debug.net.create()` crea una sala y deja su código en la URL, y `__debug.net.start()` la empieza; `__debug.net.join('CODIGO')`, `__debug.net.players()`, `__debug.net.addBot()` (otro jugador en la misma pestaña que anda en círculos, se para a talar y picar lo que puede y se fabrica un hacha y un pico de madera en cuanto tiene madera), `__debug.net.setLatency(100, 30)` (retraso artificial en ms), `__debug.net.drop()` (corta la conexión para probar la reconexión) y `__debug.net.stats()` (RTT, margen y correcciones de la predicción).
- En una sala, los trucos de `__debug` (`give`, `teleport`, `setVitals`, `spawnEnemy`, `placeStructure`, `setPhase`, `setDay`, `throwRock`, `meteor`, `aimAt`) los hace el servidor de desarrollo y devuelven una promesa; el de producción los rechaza.

**Desplegar el servidor corta las partidas abiertas unos segundos**: Cloudflare cierra los WebSockets al cambiar el código. Los clientes se reconectan solos con su token y siguen con la isla guardada (se pierden como mucho los últimos 10 s). Por eso el workflow solo lo despliega cuando cambia lo que el servidor ejecuta.
