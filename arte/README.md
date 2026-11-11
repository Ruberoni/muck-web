# Taller de arte

Aquí se preparan los modelos `.glb` (low poly) antes de que entren al juego.

```
arte/
├── muestras/   lo que se descarga de internet, tal cual (no se sube a git)
├── listas/     lo ya ajustado y aprobado: lo que irá a producción
└── taller/     visores y scripts para revisar y transformar modelos
```

**Flujo:** se deja un modelo en `muestras/<mob>/` → se revisa en el visor → se ajusta con un script
del taller (colores, piezas, tamaño, animaciones) → cuando gusta, el resultado va a `listas/<mob>/` →
más adelante se pasa a `public/models/` y se conecta al juego.

Al guardar algo en `listas/`, anotar su origen y licencia en `listas/LICENCIAS.md`.

## Ver los modelos

Servir la raíz del proyecto (no `arte/`, porque los visores usan también `public/models/`):

```bash
python3 -m http.server 8766 --bind 127.0.0.1
```

- `http://localhost:8766/arte/taller/visor.html`: marca cualquier `.glb` de muestras, listas o del juego
  para verlo lado a lado, con sus animaciones, triángulos y altura, junto a una persona de 1,8 m. Con `?m=` (un
  enlace para mirar) la lista y el cuadro de datos empiezan escondidos: se muestran con el botón ☰ o la tecla H.
- `http://localhost:8766/arte/taller/armeria.html`: el jugador con cada pieza de armadura y su material.

## Scripts

```bash
cd arte/taller && npm install
npm run jugador     # rehace listas/personaje/Jugador.glb desde las skins Casual y Medieval
npm run analizar -- ../muestras/trasgo/algo.glb   # piezas, colores y huesos de un modelo
```

## Personaje (listo)

`listas/personaje/Jugador.glb`: un esqueleto (el de las skins y `animations.glb`) con piezas que se
prenden y se apagan.

| Cuerpo (náufraga)  | Armadura que lo tapa      |
| ------------------ | ------------------------- |
| `Naufraga_Pelo`    | `Armadura_Casco`          |
| `Naufraga_Torso`   | `Armadura_Peto`           |
| `Naufraga_Piernas` | `Armadura_Pantalon`       |
| `Naufraga_Pies`    | `Armadura_Botas`          |
| `Naufraga_Cabeza`  | (siempre visible)         |

Cada pieza de armadura tiene un material `<pieza>_Tinte`: su color es el del material de la armadura
(cuero = el original, hierro `#c3c9d1`, mithril `#8fd0f2`). El resto de la pieza (correas, hebillas)
no cambia.

## Apariencias de los mobs

Cada mob básico (no los jefes) tiene tres apariencias en un mismo `.glb`, como variantes de material
(`KHR_materials_variants`): **`base`**, **`noche`** (Noche Eterna) y **`totem`** (tótem activado, más fuerte).
Lo que solo existe en una apariencia va en un nodo `<variante>_<pieza>` (por ejemplo `totem_Pinchos`) y se
oculta en las demás; si ya hay un nodo `<pieza>`, el de la variante lo reemplaza (`totem_Trasgo` en lugar de `Trasgo`). El visor muestra las tres lado a lado (`?variante=noche` para ver una sola; tecla H
para esconder los paneles).

| Mob   | Archivo            | Script       | base                 | noche                         | totem                                           |
| ----- | ------------------ | ------------ | -------------------- | ----------------------------- | ----------------------------------------------- |
| Trasgo | `trasgo/TrasgoLanza.glb`, `trasgo/TrasgoCuchillo.glb` | `trasgo.mjs` | guerrero de la tribu de la isla: piel morena, faja y taparrabo claros, corona de plumas amarillas, collar y brazaletes azules, pintura roja | los mismos colores, pero corpulento y 1,3 veces más grande (`noche_Trasgo`) | del tamaño del de noche (`totem_Trasgo`, la misma malla): adornos de oro, pintura, ojos y piedra del arma brillando como brasa dorada, plumas rojas con punta de oro |
| Gólem | `golem/Golem.glb` | `golem.mjs` (hecho de cero: rocas partidas sobre el esqueleto del jugador, 1.940 triángulos, 2,2 m) | piedra gris en dos tonos con musgo, ojos ámbar | piedra oscura, cristales violeta que brillan en hombros, brazos y joroba (`noche_Cristales`), ojos violeta | piedra rojiza, cristales y musgo de lava (`totem_Cristales`, la misma malla), ojos de brasa |
| Espíritu | `espiritu/Espiritu.glb` | `espiritu.mjs` (el tocón: piezas facetadas como el gólem, 1,5 m, con animaciones propias de `tocon.mjs`; `FORMA=tronco` hace el ent de troncos, que quedó de prueba en `muestras/espiritu/pruebas` con las versiones anteriores) | tocón de corteza marrón con cara, piernas de cono, un solo brazo de rama que crece hacia arriba, arbolito arriba, hongos rojos, ojos ámbar | madera oscura, hojas moradas, hongos violeta que brillan | madera quemada, hojas, grietas y hongos de brasa |
| Perro | `perro/Perro.glb`  | `perro.mjs`  | pardo, vientre claro | negro, ojos violeta que brillan | pelaje de oro con vientre que brilla (`TOTEM=oro`; también `fuego` o `blanco`, las tres en `muestras/perro/pruebas/Perro_totems.glb`), 1,2 veces más grande (`extras.escala`) |

El trasgo está hecho sobre el cuerpo y el esqueleto del jugador: un guerrero de una tribu inventada de la isla,
de hombre (pecho plano, cintura y hombros más anchos, brazos más gruesos), descalzo, con sombreado suave y las
piernas un 12 % más cortas (`PIERNAS=0.88`). Como el esqueleto cambia, trae dentro las animaciones del jugador
adaptadas: usar las suyas, no las de `public/models/animations.glb`. Hay dos tipos, uno por archivo: con lanza y
con cuchillo de piedra. El arma es un nodo (`Lanza` o `Cuchillo`) colgado del hueso `Middle1.R`, en el mismo agarre
que usa el juego (`src/view/CharacterRig.ts`); la lanza va girada para quedar parada junto al cuerpo en reposo. El de lanza trae además la animación `Lanzar`
(1,35 s): la lanza se esconde al soltarla, en el segundo `extras.soltar` de la animación (0,62), y desde ahí el
juego debe lanzarla como proyectil; vuelve a la mano al final. El de noche y el de tótem son más grandes: el tamaño
no puede ir en la malla (comparte esqueleto), así que va en `extras.escala` de la escena (`{ noche: 1.3, totem: 1.3 }`)
y el juego debe escalar el modelo al elegir esa variante (el visor ya lo hace). Las
pruebas anteriores, con el trasgo oscuro de orejas largas (`trasgo-oscuro.mjs`), quedaron en `muestras/trasgo/pruebas/`;
`montar.mjs` sirve para montar en el esqueleto modelos que vienen sin huesos.

El espíritu tocón no usa las animaciones del jugador (tiene un solo brazo, para arriba, y piernas sin rodillas): trae
las suyas, `Idle`, `Walk` y `Run` (a saltitos, balanceándose de un lado a otro), `Attack` (azota con la rama; pega en
`extras.golpe`, 0,5 s), `HitRecieve` y `Death` (se cae de costado).

## Jefes (una sola apariencia)

| Jefe | Archivo | Script | Cómo es |
| ---- | ------- | ------ | ------- |
| Guardián del meteorito | `guardian/Guardian.glb` | `coloso.mjs` (`JEFE=guardian`), `espada.mjs` y `ataques.mjs` (`npm run guardian`) | el coloso de piedra en roca negra con bandas de brasa y un meteorito en la espalda; piernas más largas, de columnas de roca volcánica con grietas de brasa, y en la mano derecha (en vez de la maza) un espadón de obsidiana con alma de brasa (`Espada`, en el agarre de las espadas del juego) |
| Coloso de Cristal | `coloso/Coloso.glb` | `npm run coloso`: `coloso.mjs` (`JEFE=cristal`) y `ataques.mjs` arman en `muestras/coloso/pruebas` el coloso de antes (de donde salen las animaciones); `coloso-lowpo.mjs` las pasa (`retarget.mjs`) al gólem de hierro de LOWPO Golem Pack (Standout 7, gratis; en `muestras/coloso/lowpo`, pasado de FBX con Blender) **tal cual** | el gólem de bloques de LOWPO con su paleta pasada a cristal: cuerpo celeste, placas blancas y ojos que brillan; 2,8 m, 1.230 triángulos, con las animaciones del jugador y las de sus ataques (pulso, pilares, abanico, haz de luz) |
| Trasgo gigante | `trasgo-gigante/TrasgoGigante.glb` | `npm run trasgo-gigante`: `trasgo.mjs` (`JEFE=gigante`) y `ataques.mjs` arman en `muestras/trasgo-gigante/pruebas` el trasgo de donde salen las animaciones y las armas; `gigante.mjs` las pasa al hombre musculoso de Universal Base Characters (Quaternius, CC0; en `muestras/trasgo-gigante/base`) **tal cual**: su malla, su esqueleto y su textura (bajada a 1024 px) | el jefe de la tribu: el superhéroe de Quaternius con su pelo largo en negro, pintura blanca en las mejillas, el pecho, los antebrazos y las piernas, brazaletes y tobilleras de oro (zonas de la piel con otro material, sin mover vértices), el short teñido de rojo con faja y paños de taparrabo, vincha de oro con tocado de plumas rojas y blancas, collar de oro y de colmillos, carcaj, lanza en la mano derecha (`Lanza`) y arco en la izquierda (`Arco`). Sus huesos tienen otros nombres (`pelvis`, `hand_r`…): las animaciones vienen dentro (18.500 triángulos, 7 MB; el juego lo agranda) |
| Lanzarrocas | `lanzarrocas/Lanzarrocas.glb` | `golem.mjs` (`JEFE=lanzarrocas`, `npm run lanzarrocas`) | el gólem de roca en grande (2,8 m): granito con musgo y ojos azules que brillan; de jefe: una corona alta de cristales azules, hombreras de cristales grandes, un corazón de cristal en el pecho, una cresta de cristales por la espalda y nudillos de cristal; rocas amontonadas en la joroba y una roca en la mano para tirar (`RocaMano`, la muestra la animación) (2.640 triángulos) |
| Espíritu anciano (nuevo) | `espiritu-anciano/EspirituAnciano.glb` | `espiritu.mjs` (`FORMA=anciano`, `npm run espiritu-anciano`; el Treant de antes quedó en `muestras/espiritu/pruebas`) | un árbol viejo de 3,2 m hecho de piezas facetadas, como el tocón: tronco encorvado con la cara tallada, ojos verdes que brillan, barba de musgo, runas verdes, una copa enorme con ramas, brazos larguísimos de rama con garras, raíces por pies y hongos rojos y otros que brillan en azul (2.810 triángulos) |

Los jefes sobre el esqueleto del jugador traen una animación por cada ataque especial (`ataques.mjs`), con el
nombre del ataque en `src/sim/constants.ts`: el Guardián `fireRing` (alza los puños y golpea el suelo), `burningGround`
(junta fuego en la mano y lo arroja) y `lightning` (alza la espada al cielo y la baja); el Coloso `pulse` (se encoge y
estalla abriendo los brazos), `pillars` (golpea el suelo con el puño), `shardFan` (barre los brazos adelante, abiertos)
y `lightBeam` (apunta con las manos juntas y las baja de golpe). Cada una dura lo que el ataque: carga hasta
`extras.golpe` (el `windup`, cuando el juego hace el ataque), queda agotado `extras.agotado` segundos (el `recover`) y
vuelve a la pose quieta; el juego la pone al recibir `enemySpecial`. El trasgo gigante trae
`arrowVolley` (levanta el arco, tensa y suelta tres flechas seguidas, en 0,9, 1,2 y 1,5 s; la lanza se guarda mientras),
`charge` (la embestida: baja la lanza, corre desde `extras.aviso` y pega con ella en `extras.golpe`; luego queda aturdido)
y `stomp` (salta y cae clavando la lanza en el suelo con las dos manos). El lanzarrocas trae `smash` (alza los puños y
golpea el suelo delante), `summonGolems` (abre los brazos rugiendo y planta las manos en el suelo) y `fastRock` (saca la
roca de la mano, la lleva atrás y la arroja).

Los modelos de internet se bajan de polígonos con `reducir()` de `lib.mjs` (meshoptimizer), que además los deja
con caras planas como el resto.

## Mobs del juego

Hoy todos se dibujan con cajas en código (`src/view/EnemyView.ts`), sin esqueleto ni animaciones de
modelo: botan, golpean, embisten y mueren moviendo el cuerpo entero. Datos en `src/sim/constants.ts`.

| Carpeta          | Mob                    | Tipo                     | Tamaño (escala) | Aspecto actual                     |
| ---------------- | ---------------------- | ------------------------ | --------------- | ---------------------------------- |
| `trasgo`         | Trasgo                 | común, todas las noches  | 1,25            | morado, ojos amarillos             |
| `golem`          | Gólem de piedra        | común, noche 2 (montaña) | 1,7             | piedra gris, ojos naranjas         |
| `espiritu`       | Espíritu del bosque    | común, noche 2 (bosque)  | 1,15            | tronco marrón con ramas y hojas    |
| `perro`          | Perro salvaje          | común, noche 2, en manada| 0,72            | marrón, ojos rojos                 |
| `trasgo-gigante` | Trasgo gigante         | jefe: tres flechas con el arco, embestida con golpe fuerte, pisotón | 2,25 | como el trasgo, más grande |
| `lanzarrocas`    | Lanzarrocas            | jefe: llama gólems, golpe fuerte de cerca, roca rápida de lejos | 1,9 | |
| `guardian`       | Guardián del meteorito | jefe del meteorito: fuego y rayos | 2   | roca oscura con brasas             |
| `coloso`         | Coloso de Cristal      | jefe de luz, con coraza: guarda el motor del avión | 2,6 | cristal celeste |
