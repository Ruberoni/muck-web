# Arquitectura

Cómo organizar el código para que el contenido de [diseno-del-juego.md](diseno-del-juego.md) (decenas de objetos,
enemigos, recetas y reliquias) se pueda añadir sin tocar medio proyecto.

---

## 1. Dónde estamos

El código **no está en un solo archivo**: son unos 40 módulos bien separados **por capa**:

| Carpeta | Qué hay | Regla |
| --- | --- | --- |
| `src/sim/` | la partida: jugador, inventario, enemigos, props, fogatas, crafteo, colisiones | pura y determinista: sin three ni DOM, la usa también el servidor (`purity.test.ts`) |
| `src/view/` | modelos three.js de props, enemigos, pickups, fogatas | solo lee estado y eventos de la simulación |
| `src/ui/` | HUD, minimapa, ajustes | |
| `src/audio/` | sonido generado con Web Audio | |
| `src/game/` | el cliente: bucle, entrada, mano, ajustes | |
| `src/net/` + `server/` | protocolo, sesión, sala multijugador | `PROTOCOL_VERSION` sube con cada cambio de `src/sim` |
| `src/world/` | malla del terreno, cielo, hash del mundo (con three) | |

Esa base es buena y hay que **conservarla**: simulación pura, paso fijo de 60 Hz, eventos (`SimEvent`) en vez de
llamadas directas a la vista, y estado serializable (`toJSON`/`fromJSON`).

### Por qué parece "todo en un archivo"

El **contenido** (los datos del juego) está concentrado y repartido a la vez:

- `src/sim/constants.ts` mezcla física del jugador, props, herramientas, el enemigo y la fogata.
- `src/sim/inventory.ts` define todos los `ItemId` como una unión a mano, y sus nombres.
- `src/sim/crafting.ts` tiene las recetas en una lista cuyo **índice** es la tecla 1–5 y viaja así por la red.
- Los iconos están en `src/ui/hud.ts`, los modelos en mano en `src/game/handheld.ts`.

Resultado: **añadir un objeto hoy toca 7 archivos** (`wood_axe` aparece en crafting, constants, inventory,
Simulation, hud, handheld y Game). Con 100 objetos eso no escala. Además hay dos carpetas `world/`
(`src/world/` con three y `src/sim/world/` puro) que se confunden.

---

## 2. Principios

1. **Capa primero, entidad después.** Mantenemos `sim/` separado de `view/` (es lo que permite el servidor) y
   **dentro** de cada capa agrupamos por entidad. Un enemigo nuevo vive en `sim/enemies/` + `view/enemies/`.
2. **El contenido son datos.** Cada objeto, receta, enemigo o reliquia es una definición en su archivo,
   registrada en un registro. La lógica (sistemas) lee definiciones; no conoce objetos concretos.
3. **Identificadores de texto estables** (`'stone_axe'`), nunca índices de array, en la red y en las partidas
   guardadas.
4. **Una sola función de estadísticas**: todo lo que modifica al jugador (arma, armadura, reliquias, comida,
   nivel del objeto) se expresa como *modificadores* y se resuelve en un solo sitio.
5. **Cada definición se valida con un test** (las recetas apuntan a objetos que existen, los árboles de
   evolución no tienen ciclos, cada objeto tiene icono y modelo).

---

## 3. Estructura de carpetas propuesta

```
src/
├── sim/                              # PURO: sin three, sin DOM. Lo comparte el servidor.
│   ├── core/
│   │   ├── Simulation.ts             # orquesta los sistemas en cada step()
│   │   ├── commands.ts               # Move, Action
│   │   ├── events.ts                 # SimEvent, EventLog
│   │   ├── random.ts
│   │   ├── registry.ts               # defineRegistry(): helper genérico para todos los registros
│   │   └── constants.ts              # solo tick y límites globales
│   ├── physics/
│   │   ├── collision.ts
│   │   └── aim.ts
│   ├── world/
│   │   ├── terrain.ts
│   │   ├── biomes.ts                 # nuevo
│   │   ├── daycycle.ts
│   │   ├── plague.ts                 # nuevo: avance de la corrupción
│   │   ├── props/                    # árboles, rocas, arbustos, vetas de mena
│   │   │   ├── props.ts
│   │   │   └── defs.ts
│   │   └── pickups.ts
│   ├── player/
│   │   ├── player.ts                 # movimiento
│   │   ├── survival.ts               # hambre, vida
│   │   ├── stats.ts                  # nuevo: computeStats()
│   │   └── buffs.ts                  # nuevo: efectos temporales (comida, pociones)
│   ├── items/
│   │   ├── registry.ts               # ITEMS, ItemId derivado de las claves
│   │   ├── defs/
│   │   │   ├── materials.ts          # madera, piedra, menas, lingotes, gemas
│   │   │   ├── tools.ts              # hachas, picos
│   │   │   ├── weapons.ts
│   │   │   ├── armor.ts
│   │   │   ├── food.ts
│   │   │   └── placeables.ts         # fogata, estaciones, muros…
│   │   ├── instance.ts               # ItemStack / ItemInstance
│   │   └── inventory.ts              # hotbar + mochila + equipo
│   ├── crafting/
│   │   ├── crafting.ts               # canCraft / craft genéricos
│   │   ├── stations.ts
│   │   ├── recipes/                  # un archivo por estación
│   │   │   ├── hand.ts
│   │   │   ├── workbench.ts
│   │   │   ├── furnace.ts
│   │   │   ├── anvil.ts
│   │   │   └── cauldron.ts
│   │   └── evolution/
│   │       ├── upgrade.ts            # +1…+5
│   │       ├── evolve.ts             # tier T → T+1, ramas
│   │       ├── trees.ts              # árboles de evolución (datos)
│   │       └── infusion.ts           # gemas
│   ├── combat/
│   │   ├── interaction.ts            # objetivo y golpes (lo actual)
│   │   ├── damage.ts                 # daño, armadura, críticos
│   │   ├── projectiles.ts            # flechas, rocas del coloso
│   │   └── statusEffects.ts          # quemadura, veneno, ralentizar
│   ├── enemies/
│   │   ├── enemies.ts                # gestor (lo actual, genérico por tipo)
│   │   ├── director.ts               # presupuesto por noche, tabla de aparición
│   │   ├── ai/                       # comportamientos reutilizables
│   │   │   ├── chase.ts
│   │   │   ├── ranged.ts
│   │   │   ├── charge.ts
│   │   │   └── support.ts
│   │   ├── defs/                     # un archivo por enemigo: datos + qué IA usa
│   │   │   ├── goblin.ts
│   │   │   ├── goblinArcher.ts
│   │   │   └── …
│   │   ├── elites.ts                 # modificadores élite
│   │   └── bosses/
│   │       ├── goblinKing.ts
│   │       └── …
│   ├── structures/
│   │   ├── structures.ts             # gestor genérico (lo que hoy es Campfires)
│   │   └── defs/                     # fogata, horno, yunque, muro, torre…
│   ├── progression/
│   │   ├── gold.ts
│   │   ├── chests.ts
│   │   ├── relics/
│   │   │   ├── registry.ts
│   │   │   └── defs/
│   │   ├── objectives.ts             # fragmentos, faro, Noche Eterna
│   │   └── difficulty.ts             # modos y fórmulas de escalado
│   └── events/                       # eventos de mundo (meteorito, mercader, luna de sangre)
│
├── view/                             # three.js: espejo de sim/ por entidad
│   ├── scene.ts                      # (hoy src/scene.ts)
│   ├── world/                        # (hoy src/world/): terreno, cielo, agua, hash
│   ├── props/
│   ├── enemies/                      # EnemyView + un modelo por tipo
│   ├── items/                        # modelos de objetos: suelo, mano y estructuras comparten geometría
│   ├── structures/
│   └── effects/                      # partículas, golpes, estados
├── ui/
│   ├── hud/
│   ├── inventory/
│   ├── crafting/
│   ├── altar/                        # evolución e infusión
│   ├── minimap/
│   ├── objectives/
│   └── menus/                        # inicio, pausa, ajustes, fin de partida
├── audio/
├── game/                             # Game.ts, input, handheld, settings
├── net/
└── main.ts
server/
docs/
```

`purity.test.ts` ya admite subcarpetas dentro de `src/sim/` (cuenta los `..` según la profundidad), así que esta
estructura no rompe la regla del servidor.

### Mapa de lo actual a lo nuevo

| Ahora | Pasa a |
| --- | --- |
| `src/sim/Simulation.ts`, `commands.ts`, `events.ts`, `random.ts` | `src/sim/core/` |
| `src/sim/constants.ts` | se reparte: física → `player/`, `PROP_DEFS` → `world/props/defs.ts`, `TOOL_DEFS` → `items/defs/tools.ts`, `ENEMY_*` → `enemies/defs/goblin.ts`, `CAMPFIRE_*` → `structures/defs/campfire.ts` |
| `src/sim/collision.ts`, `aim.ts` | `src/sim/physics/` |
| `src/sim/player.ts`, `survival.ts` | `src/sim/player/` |
| `src/sim/inventory.ts` | `src/sim/items/inventory.ts` + `items/registry.ts` |
| `src/sim/crafting.ts` | `src/sim/crafting/` |
| `src/sim/interaction.ts` | `src/sim/combat/interaction.ts` |
| `src/sim/enemies.ts` | `src/sim/enemies/enemies.ts` |
| `src/sim/props.ts`, `pickups.ts` | `src/sim/world/props/`, `src/sim/world/pickups.ts` |
| `src/sim/campfires.ts` | `src/sim/structures/` (generalizado) |
| `src/world/*`, `src/scene.ts` | `src/view/world/`, `src/view/scene.ts` |
| `src/view/*View.ts` | `src/view/<entidad>/` |
| iconos de `src/ui/hud.ts` | `src/ui/` junto al registro de objetos de la vista |

Los tests siguen junto a su archivo, como ahora.

---

## 4. Modelos de datos clave

### 4.1 Registros

```ts
// sim/core/registry.ts
export function defineRegistry<D extends { id: string }>() {
  const map = new Map<string, D>()
  return {
    add<T extends D>(def: T) { map.set(def.id, def); return def },
    get(id: string) { const d = map.get(id); if (!d) throw new Error(`no existe ${id}`); return d },
    all: () => [...map.values()],
  }
}
```

```ts
// sim/items/defs/tools.ts
export const STONE_AXE = defineItem({
  id: 'stone_axe',
  name: 'Hacha de piedra',
  kind: 'tool',
  tier: 1,
  stack: false,                         // instancia única: puede tener nivel, rama, gemas
  tool: { prop: 'tree', power: 4 },
  attack: 12,
  evolvesTo: 'copper_axe',
})
```

Para no perder el tipado de `ItemId`, el registro se construye a partir de un objeto `as const` y
`ItemId = keyof typeof ITEMS`.

### 4.2 Objetos con identidad

El inventario de hoy guarda **recuentos** por `ItemId` (`Map<ItemId, number>`). Para mejorar y evolucionar
objetos hace falta que un objeto concreto tenga datos propios:

```ts
type ItemStack    = { kind: 'stack'; item: ItemId; count: number }                 // madera, bayas…
type ItemInstance = {
  kind: 'instance'
  uid: number          // lo asigna la simulación (contador determinista)
  item: ItemId
  level: number        // +0…+5
  xp: number           // maestría
  branch?: string      // rama elegida al evolucionar a tier 2
  gems: GemId[]
}
type Slot = ItemStack | ItemInstance | null

interface InventoryState {
  hotbar: Slot[]       // 9
  backpack: Slot[]     // 9 → 27 con mejoras
  equipment: { head: Slot; chest: Slot; feet: Slot; trinket: Slot }
  selected: number
}
```

Es el cambio de modelo más profundo del plan: conviene hacerlo **antes** de añadir muchos objetos.

### 4.3 Recetas

```ts
defineRecipe({
  id: 'stone_axe',                      // estable: es lo que viaja en { kind: 'craft', recipe: 'stone_axe' }
  station: 'workbench',
  cost: [{ item: 'wood', amount: 3 }, { item: 'stone', amount: 5 }],
  result: { item: 'stone_axe', amount: 1 },
  time: 0,                              // >0 para el horno: se procesa en la estación, en ticks
})
```

Evoluciones e infusiones son recetas especiales que toman una **instancia** como entrada y devuelven la misma
instancia transformada (conserva `uid`, ajusta `level`).

### 4.4 Estadísticas y modificadores

```ts
type Stat = 'maxHealth' | 'damage' | 'attackSpeed' | 'moveSpeed' | 'armor' | 'critChance'
          | 'lifesteal' | 'gatherWood' | 'gatherStone' | 'staminaMax' | 'hungerDrain' | …

interface Modifier { stat: Stat; op: 'add' | 'mul'; value: number; source: string }

// player/stats.ts — se recalcula cuando cambia el equipo, las reliquias o los buffs
function computeStats(slot: PlayerSlot): Stats
```

Arma en mano, armadura, nivel del objeto, rama, gemas, reliquias y comida **solo producen modificadores**. Los
sistemas (movimiento, combate, recolección, supervivencia) leen `Stats` y nunca miran qué objeto llevas.

### 4.5 Efectos con disparadores

Lo que no es un número fijo (robo de vida, rayo encadenado, explotar al morir) se expresa con ganchos sobre
los eventos de la simulación, todos deterministas:

```ts
defineRelic({
  id: 'ember',
  rarity: 'common',
  family: 'fire',
  onHit: (ctx, hit) => applyStatus(ctx, hit.target, 'burn', { stacks: ctx.stacks }),
})
```

Ganchos: `onHit`, `onKill`, `onHurt`, `onCraft`, `onGather`, `onDawn`, `onNight`.

### 4.6 Enemigos: definición + IA reutilizable

```ts
defineEnemy({
  id: 'goblin_archer',
  hp: 25, damage: 8, speed: 4.5, radius: 0.5,
  cost: 2, minNight: 2,
  ai: ranged({ range: 14, keepAway: 8, projectile: 'arrow', windup: 0.6 }),
  drops: [{ item: 'gold', amount: [1, 3] }, { item: 'arrow', amount: [0, 2] }],
})
```

`enemies.ts` deja de tener la lógica del trasgo dentro y pasa a ejecutar el comportamiento que diga la
definición. El **director** (`enemies/director.ts`) decide cuántos y cuáles salen cada noche con la fórmula de
presupuesto del documento de diseño.

### 4.7 Vista emparejada por id

En la vista, otro registro con la misma clave: `ITEM_VISUALS['stone_axe'] = { icon, model }`. Un test comprueba
que **todo** id de `sim` tiene su entrada en la vista. Añadir un objeto pasa a ser: 1 definición en `sim` +
1 entrada visual (+ receta).

---

## 5. Orden de los sistemas en cada paso

Ampliación del orden actual de `Simulation.step()`:

1. Acciones (seleccionar, fabricar, evolucionar, equipar) → movimiento de jugadores
2. Reloj, Plaga, eventos de mundo
3. Director → aparición de enemigos; IA de enemigos; proyectiles
4. Golpes de jugadores, colocar estructuras, estaciones que procesan (horno)
5. Estados (quemadura, veneno), recogida de objetos del suelo
6. Supervivencia, muertes, objetivos (fragmentos, faro, Noche Eterna)

---

## 6. Red y versiones

- `craft` pasa de índice a **id de receta**; aparecen acciones `equip`, `move_item`, `upgrade`, `evolve`,
  `infuse`, `use_station`, `dodge`, `block`.
- El snapshot incluye el inventario con instancias y las estadísticas calculadas del jugador (para el HUD).
- Cada PR que toque `src/sim` sube `PROTOCOL_VERSION` (lo exige `scripts/check-protocol-version.sh`).
  Los PR que solo mueven archivos también cuentan: se sube igualmente.

---

## 7. Rendimiento a vigilar

- Mapa de 400 × 400 con biomas: terreno por trozos (chunks) y props instanciados por bioma.
- Hasta 24+ enemigos y proyectiles: `InstancedMesh` por tipo de enemigo, la rejilla espacial (`SpatialGrid`) para
  todo lo que colisiona.
- Estados y reliquias se evalúan por evento, no recorriendo todo en cada tick.
