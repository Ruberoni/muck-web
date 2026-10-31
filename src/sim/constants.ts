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
/** Segundos sin regeneración natural tras recibir daño: esperando no se cura en mitad de una pelea. */
export const HEALTH_REGEN_DELAY = 8
export const EAT_KEY = 'KeyF'

export interface ConsumableDef {
  /** Hambre que devuelve. */
  food: number
  /** Vida que cura al momento. */
  heal?: number
  /** Curación poco a poco: se suma a la natural, sigue aunque se reciba daño y otra solo renueva el tiempo. */
  regen?: { perSec: number; seconds: number }
}

export const CONSUMABLE_DEFS: Partial<Record<ItemId, ConsumableDef>> = {
  berry: { food: 15 },
  // Se puede comer, pero llena poco: compensa asarla.
  raw_meat: { food: 8 },
  cooked_meat: { food: 45, heal: 15 },
  berry_infusion: { food: 0, regen: { perSec: 2, seconds: 20 } },
  healing_herb: { food: 0, heal: 25 },
}

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
export type PropFamily = 'tree' | 'rock' | 'bush' | 'herb'
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
  /**
   * Se recoge poco a poco: cada golpe quita 1 de vida y da el drop; a 0 no se destruye y se rellena solo. `regrow`
   * son los segundos que tarda en volver cada unidad, y `empty`, lo que dice el HUD cuando no queda nada.
   */
  harvest?: { regrow: number; empty: string }
}

// Cada baya es un punto de vida del arbusto. Las que faltan vuelven de una en una: vacío se llena en 90 s.
export const BERRIES_PER_BUSH = 6
export const BERRY_REGROW = 15

// Las claves son los tipos de prop: `PropKind` (props.ts) se saca de aquí, así que un tipo nuevo solo se añade aquí.
export const PROP_DEFS: Record<'tree' | 'birch' | 'darkpine' | 'rock' | 'iron_ore' | 'mithril_ore' | 'bush' | 'healing_herb', PropDef> = {
  tree: { name: 'Árbol', verb: 'talar', family: 'tree', tool: 'axe', tier: 0, hp: 3, drop: { item: 'wood', amount: 4 } },
  birch: { name: 'Abedul', verb: 'talar', family: 'tree', tool: 'axe', tier: 2, hp: 12, drop: { item: 'birch_wood', amount: 4 } },
  darkpine: { name: 'Pino oscuro', verb: 'talar', family: 'tree', tool: 'axe', tier: 3, hp: 18, drop: { item: 'dark_wood', amount: 4 } },
  rock: { name: 'Roca', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 1, hp: 4, drop: { item: 'stone', amount: 3 } },
  iron_ore: { name: 'Mena de hierro', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 2, hp: 12, drop: { item: 'iron_ore', amount: 3 } },
  mithril_ore: { name: 'Mena de mithril', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 3, hp: 18, drop: { item: 'mithril_ore', amount: 4 } },
  bush: {
    name: 'Arbusto de bayas',
    verb: 'recoger',
    family: 'bush',
    tool: null,
    tier: 0,
    hp: BERRIES_PER_BUSH,
    drop: { item: 'berry', amount: 1 },
    harvest: { regrow: BERRY_REGROW, empty: 'sin bayas' },
  },
  healing_herb: {
    name: 'Hierba curativa',
    verb: 'recoger',
    family: 'herb',
    tool: null,
    tier: 0,
    hp: 1,
    drop: { item: 'healing_herb', amount: 1 },
    harvest: { regrow: 90, empty: 'ya recogida' },
  },
}

/** Daño de un golpe contra props a mano o con una herramienta de otra familia. */
export const BASE_DAMAGE = 1
/** Daño de un golpe contra enemigos a mano o con algo que no es un arma. */
export const HAND_ATTACK = 10

// Lo que sueltan árboles, rocas y trasgos cae al suelo (una pieza por unidad) y se recoge al pasar por encima.
/** Segundos desde que cae hasta que se puede recoger: se ve saltar antes de que el jugador lo coja. */
export const PICKUP_DELAY = 0.5
/** Distancia horizontal (desde el centro del jugador) a la que se recoge. */
export const PICKUP_RADIUS = 0.9
/** Más cerca que esto, si cabe en la hotbar, se desliza hacia el jugador. */
export const PICKUP_MAGNET = 1.6
export const PICKUP_MAGNET_SPEED = 6
/** Lo que tira un jugador (Q) no lo puede recoger él durante este tiempo: si no, el imán se lo devolvería al momento. */
export const DROP_PICKUP_DELAY = 2

export interface ToolDef {
  family: ToolFamily
  /** 1 madera, 2 piedra, 3 hierro, 4 mithril (la mano es el nivel 0). */
  tier: number
  /** Daño contra los props de su familia; contra el resto se golpea como a mano (la regla está en tiers.ts). */
  damage: number
  /** Daño contra enemigos, sea cual sea la familia de la herramienta. */
  attack: number
}

export const TOOL_DEFS: Partial<Record<ItemId, ToolDef>> = {
  wood_axe: { family: 'axe', tier: 1, damage: 2, attack: 20 },
  stone_axe: { family: 'axe', tier: 2, damage: 4, attack: 30 },
  iron_axe: { family: 'axe', tier: 3, damage: 6, attack: 40 },
  // El mithril no abre nada de nivel 4: da velocidad (abedul y mena de hierro de un golpe) y ataque.
  mithril_axe: { family: 'axe', tier: 4, damage: 12, attack: 60 },
  wood_pickaxe: { family: 'pickaxe', tier: 1, damage: 2, attack: 20 },
  stone_pickaxe: { family: 'pickaxe', tier: 2, damage: 4, attack: 30 },
  iron_pickaxe: { family: 'pickaxe', tier: 3, damage: 6, attack: 40 },
  mithril_pickaxe: { family: 'pickaxe', tier: 4, damage: 12, attack: 60 },
}

/** Con qué se golpea a un enemigo: una familia de herramienta o, con cualquier otra cosa, la mano. */
export type WeaponClass = ToolFamily | 'hand'
/** Cómo se comporta un enemigo. */
export type EnemyAI = 'chase' | 'charge' | 'ranged' | 'guard'

export interface EnemyDef {
  name: string
  verb: string
  hp: number
  speed: number
  /** Radio de colisión. */
  radius: number
  /** Escala del modelo y de su hitbox (el cuerpo de aim.ts). */
  scale: number
  damage: number
  /** Hueco (entre bordes) que deja al llegar al jugador, para que no le tape la vista. */
  gap: number
  /** Hueco máximo (entre bordes) desde el que alcanza al jugador. */
  reach: number
  attackInterval: number
  /** Espera desde que llega al jugador (o se recupera de un golpe) hasta su primer ataque. */
  windup: number
  /** Velocidad a la que lo empuja un golpe. */
  knockback: number
  /** Segundos que un golpe lo deja aturdido, sin moverse ni atacar; 0: nunca se aturde. */
  stagger: number
  /** Aguante: segundos tras un aturdimiento en los que los golpes no lo aturden, no lo empujan ni le retrasan el ataque. */
  staggerGap: number
  /** Solo sale de noche. */
  nocturnal: boolean
  ai: EnemyAI
  /** Multiplicador del daño por clase de arma; lo que no está vale 1. */
  weakness: Partial<Record<WeaponClass, number>>
  /** Lo que suelta al morir. */
  loot: { item: ItemId; amount: number }[]
  /** Puntos que gasta al salir, para el futuro director de apariciones (docs/diseno-del-juego.md §4). */
  cost: number
}

export const ENEMY_DEFS: Record<'goblin', EnemyDef> = {
  // 6 golpes a mano, 3 con herramienta de madera, 2 con una de piedra o de hierro y 1 con una de mithril.
  goblin: {
    name: 'Trasgo',
    verb: 'atacar',
    hp: 60,
    // Algo más lento que andar: se le puede dejar atrás, pero no mientras se tala o se pica.
    speed: 5,
    radius: 0.55,
    // El modelo mide unos 1,4 sin escalar: escalado, los ojos quedan algo por debajo de los del jugador.
    scale: 1.25,
    damage: 10,
    gap: 0.35,
    reach: 0.7,
    attackInterval: 1.2,
    windup: 0.5,
    knockback: 6,
    stagger: 0.3,
    staggerGap: 0.6,
    nocturnal: true,
    ai: 'chase',
    weakness: {},
    loot: [{ item: 'raw_meat', amount: 1 }],
    cost: 1,
  },
}
export type EnemyType = keyof typeof ENEMY_DEFS
/** Los tipos en orden fijo: un `snap` lleva el índice en vez del nombre. */
export const ENEMY_TYPES = Object.keys(ENEMY_DEFS) as EnemyType[]

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
/** Segundos tras reaparecer sin recibir daño ni ser objetivo: los enemigos ya no se van al amanecer. */
export const RESPAWN_SHIELD = 3
/** Con todos muertos, segundos de "Game over" antes de reiniciar la isla. */
export const GAME_OVER_DELAY = 6
/** Los montones del inventario de un muerto salen desde esta altura sobre sus pies. */
export const DEATH_DROP_HEIGHT = 1
