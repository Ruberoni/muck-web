# Hoja de ruta

Orden propuesto para llegar de lo que hay hoy al juego de [diseno-del-juego.md](diseno-del-juego.md) siguiendo
[arquitectura.md](arquitectura.md). Igual que la serie "Multijugador PR 1–9": **PR pequeños**, cada uno con sus
tests y el juego jugable al terminar.

El primer gran hito es la **partida completa mínima** (fase 6): una partida de principio a fin con victoria y
derrota. A partir de ahí todo es añadir contenido y equilibrar jugando.

---

## Fase 0 — Reorganizar carpetas (sin cambiar comportamiento)

Solo mover archivos con `git mv` y arreglar imports. Ningún test cambia de resultado.

1. `src/sim/` en subcarpetas: `core/`, `physics/`, `player/`, `items/`, `crafting/`, `combat/`, `enemies/`,
   `world/props/`, `structures/`.
2. `src/world/` y `src/scene.ts` → `src/view/world/`; vistas a `src/view/<entidad>/`.
3. Repartir `constants.ts` entre las carpetas de cada entidad.
4. Actualizar el README (rutas mencionadas) y `purity.test.ts` si hace falta.

## Fase 1 — El contenido como datos

1. Registro genérico + `ITEMS` con `ItemId` derivado; nombres e iconos salen del registro.
2. Recetas con id de texto; la acción `craft` manda el id (sube `PROTOCOL_VERSION`).
3. `ITEM_VISUALS` en la vista y test de que todo objeto tiene icono y modelo.
4. `PROP_DEFS` y `ENEMY_DEF` como registros (un archivo por tipo).

**Hecho cuando:** añadir un objeto nuevo con receta toca 2–3 archivos.

## Fase 2 — Inventario con instancias y estadísticas

1. `ItemStack` / `ItemInstance` en el inventario (guardar, cargar y protocolo).
2. Mochila además de la hotbar; arrastrar y mover objetos.
3. `computeStats()` y modificadores; las herramientas actuales pasan a usarlo.
4. Daño numérico en vez de "número de golpes" (con los valores del diseño).

## Fase 3 — Estaciones y tiers

1. `structures/` genérico a partir de `Campfires`.
2. Banco de trabajo y fabricar "cerca de una estación".
3. Vetas de cobre/hierro, carbón, horno con tiempo de proceso y combustible.
4. Yunque: armas (espada, martillo) y armaduras de cobre/hierro.

## Fase 4 — Combate y enemigos

1. Esquiva y bloqueo; windup visible de los enemigos.
2. Enemigos por definición + IA reutilizable; trasgo arquero (proyectiles), murciélago, bruto.
3. Director con presupuesto y escalado por día y jugadores; modos de dificultad.
4. Fauna de día (jabalí) y cuero.

## Fase 5 — Oro, cofres y reliquias

1. Oro que sueltan los enemigos; cofres con precio que sube con el día.
2. Primeras 15 reliquias con modificadores y ganchos; familias.
3. Santuarios.

## Fase 6 — Partida completa mínima ✦ hito

1. Faro + 2 guardianes (en vez de 4) + fragmentos.
2. Jefe de la noche 3 (Rey Trasgo).
3. Noche Eterna y tracker de objetivos en el HUD.
4. Muerte como fantasma, altar para revivir, fin de partida con estadísticas.
5. **Primera ronda de equilibrado jugando entre todos.**

## Fase 7 — Evolución de objetos

1. Mejora +1…+5 en el yunque.
2. Evolución de tier conservando niveles.
3. Ramas en tier 2 (hacha, pico, espada para empezar) y altar rúnico.
4. Gemas e infusión.
5. Cocina y comida que se pudre; caldero y buffs.

## Fase 8 — Mundo grande

1. Mapa más grande con biomas (terreno por trozos).
2. La Plaga.
3. Plata lunar (minado nocturno) y obsidiana.
4. Los 4 guardianes y jefes de las noches 6 y 9.

## Fase 9 — Eventos y pulido

Meteoritos, mercader, luna de sangre, tormenta; élites; estructuras defensivas y zapadores; maestría por uso;
progresión entre partidas; efectos, sonido y música para todo lo nuevo; nombre definitivo.

---

## Cómo repartirse el trabajo entre varios

Tras la fase 1 las carpetas por entidad permiten trabajar en paralelo sin pisarse: una persona en `enemies/`,
otra en `crafting/` y otra en `ui/` raramente tocan los mismos archivos. Los puntos de conflicto son
`core/Simulation.ts` (orden de los sistemas) y `net/protocol.ts`: mejor que los cambios ahí vayan en PR propios y
cortos.
