import type { ItemId } from './inventory'

export const STEP = 1 / 60
export const MAX_FRAME_DT = 0.1
export const MAX_STEPS_PER_FRAME = 6

export const EYE_HEIGHT = 1.7
export const PLAYER_RADIUS = 0.4
export const WALK_SPEED = 6
export const SPRINT_SPEED = 10
export const WATER_SPEED_FACTOR = 0.5
export const GRAVITY = 20
export const JUMP_VELOCITY = 7
export const GROUND_SNAP = 0.2
export const WORLD_BOUND_FACTOR = 0.48

// Por debajo de esta altura de terreno el jugador vadea; por debajo de FLOAT_DEPTH, flota.
export const WADE_DEPTH = 0.3
export const FLOAT_DEPTH = 1.1

export const STAMINA_MAX = 100
export const SPRINT_COST_PER_SEC = 20
export const JUMP_COST = 10
export const STAMINA_REGEN_PER_SEC = 15
export const STAMINA_REGEN_DELAY = 1
export const STAMINA_RECOVER_THRESHOLD = 15

export const HEALTH_MAX = 100
export const HUNGER_MAX = 100
// De lleno a vacío en unos 4 minutos; con hambre a 0 la vida baja hasta morir en 50 s.
export const HUNGER_DRAIN_PER_SEC = 0.4
export const STARVE_DAMAGE_PER_SEC = 2
// Por encima de este hambre la vida se regenera.
export const HEALTH_REGEN_HUNGER = 30
export const HEALTH_REGEN_PER_SEC = 1
export const BERRY_FOOD = 15
export const EAT_KEY = 'KeyF'

export const MOUSE_SENSITIVITY = 0.002
export const MAX_PITCH = (89 * Math.PI) / 180
// Solo se aplica sin unadjustedMovement: descarta los picos de movementX/Y de Chrome.
export const MOUSE_SPIKE_LIMIT = 450
// Rueda: un paso de hotbar cada tantos píxeles seguidos; tras una pausa el primer evento cuenta ya.
export const WHEEL_STEP_PX = 50
export const WHEEL_LINE_PX = 40
export const WHEEL_GESTURE_GAP_MS = 150

export const REACH = 3.5
export const HIT_COOLDOWN = 0.4
export const WOBBLE_DURATION = 0.15

/** Familia de un prop: decide su forma, su hitbox, de dónde cae lo que suelta y cómo suena. */
export type PropFamily = 'tree' | 'rock' | 'bush'
/** Familia de una herramienta: el hacha tala árboles y el pico rompe rocas. */
export type ToolFamily = 'axe' | 'pickaxe'

export interface PropDef {
  name: string
  verb: string
  family: PropFamily
  /** Herramienta que le hace más daño (y la única que sirve desde el nivel 1); null: ninguna (arbustos). */
  tool: ToolFamily | null
  /** Nivel 0: cualquier cosa sirve. Desde el 1, solo una herramienta de su familia de ese nivel o más (tiers.ts). */
  tier: number
  hp: number
  drop: { item: ItemId; amount: number }
  /** Se recoge poco a poco: cada golpe quita 1 de vida y da el drop; a 0 no se destruye y se rellena solo. */
  harvest?: boolean
}

// Cada baya es un punto de vida del arbusto. Las que faltan vuelven de una en una: vacío se llena en 90 s.
export const BERRIES_PER_BUSH = 6
export const BERRY_REGROW = 15

// Las claves son los tipos de prop: `PropKind` (props.ts) se saca de aquí, así que un tipo nuevo solo se añade aquí.
export const PROP_DEFS: Record<'tree' | 'rock' | 'bush', PropDef> = {
  tree: { name: 'Árbol', verb: 'talar', family: 'tree', tool: 'axe', tier: 0, hp: 3, drop: { item: 'wood', amount: 4 } },
  rock: { name: 'Roca', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 1, hp: 4, drop: { item: 'stone', amount: 3 } },
  bush: {
    name: 'Arbusto de bayas',
    verb: 'recoger',
    family: 'bush',
    tool: null,
    tier: 0,
    hp: BERRIES_PER_BUSH,
    drop: { item: 'berry', amount: 1 },
    harvest: true,
  },
}

export const BASE_DAMAGE = 1

// Lo que sueltan árboles, rocas y trasgos cae al suelo (una pieza por unidad) y se recoge al pasar por encima.
/** Segundos desde que cae hasta que se puede recoger: se ve saltar antes de que el jugador lo coja. */
export const PICKUP_DELAY = 0.5
/** Distancia horizontal (desde el centro del jugador) a la que se recoge. */
export const PICKUP_RADIUS = 0.9
/** Más cerca que esto, si cabe en la hotbar, se desliza hacia el jugador. */
export const PICKUP_MAGNET = 1.6
export const PICKUP_MAGNET_SPEED = 6

export interface ToolDef {
  family: ToolFamily
  /** 1 madera, 2 piedra (la mano es el nivel 0). */
  tier: number
  /** Daño contra los props de su familia; contra el resto se golpea como a mano (la regla está en tiers.ts). */
  damage: number
  /** Daño contra enemigos, sea cual sea la familia de la herramienta. */
  attack: number
}

export const TOOL_DEFS: Partial<Record<ItemId, ToolDef>> = {
  wood_axe: { family: 'axe', tier: 1, damage: 2, attack: 2 },
  stone_axe: { family: 'axe', tier: 2, damage: 4, attack: 3 },
  wood_pickaxe: { family: 'pickaxe', tier: 1, damage: 2, attack: 2 },
  stone_pickaxe: { family: 'pickaxe', tier: 2, damage: 4, attack: 3 },
}

// Enemigos nocturnos: 6 golpes a mano, 3 con herramienta de madera, 2 con una de piedra.
export const ENEMY_DEF = { name: 'Trasgo', verb: 'atacar', hp: 6, drop: { item: 'raw_meat' as ItemId, amount: 1 } }
export const ENEMY_RADIUS = 0.55
// Algo más lento que andar: se le puede dejar atrás, pero no mientras se tala o se pica.
export const ENEMY_SPEED = 5
export const ENEMY_DAMAGE = 10
/** Hueco (entre bordes) que deja al llegar al jugador, para que no le tape la vista. */
export const ENEMY_GAP = 0.35
/** Hueco máximo (entre bordes) desde el que alcanza al jugador. */
export const ENEMY_REACH = 0.7
export const ENEMY_ATTACK_INTERVAL = 1.2
/** Espera desde que llega al jugador (o se recupera de un golpe) hasta su primer ataque. */
export const ENEMY_WINDUP = 0.5
export const ENEMY_KNOCKBACK = 6
export const ENEMY_STAGGER = 0.3
export const ENEMY_SPAWN_INTERVAL = 5
export const ENEMY_SPAWN_MIN = 26
export const ENEMY_SPAWN_MAX = 40
/** Enemigos a la vez la primera noche; cada noche se suman ENEMY_PER_NIGHT, hasta ENEMY_MAX. */
export const ENEMY_BASE_COUNT = 3
export const ENEMY_PER_NIGHT = 2
export const ENEMY_MAX = 12
/** Con N jugadores caben ENEMY_PER_PLAYER más por cada uno a partir del segundo, hasta ENEMY_HARD_MAX. */
export const ENEMY_PER_PLAYER = 4
export const ENEMY_HARD_MAX = 24
/** Cada cuánto vuelve a elegir a quién persigue, y cuánto más cerca debe estar otro para cambiar. */
export const ENEMY_RETARGET = 0.5
export const ENEMY_RETARGET_MARGIN = 3

// Distancia por delante del jugador a la que se colocan la fogata y las demás estructuras (radios en structures.ts).
export const PLACE_DISTANCE = 2.2
// Alcance de una estación al fabricar: en horizontal, del centro del jugador al borde de la estación.
export const STATION_RANGE = 3.5
// Solo las fogatas más cercanas al jugador iluminan: el número de luces no cambia y no recompila shaders.
export const CAMPFIRE_LIGHTS = 4
export const CAMPFIRE_LIGHT_INTENSITY = 30
export const CAMPFIRE_LIGHT_DISTANCE = 22

// Muerte en una sala (§9 del plan): el muerto mira a los demás y reaparece; con un jugador se reinicia como siempre.
/** Quien muere de día reaparece a los tantos segundos; de noche, al amanecer. */
export const RESPAWN_DAY_DELAY = 30
/** Con todos muertos, segundos de "Game over" antes de reiniciar la isla. */
export const GAME_OVER_DELAY = 6
/** Los montones del inventario de un muerto salen desde esta altura sobre sus pies. */
export const DEATH_DROP_HEIGHT = 1
