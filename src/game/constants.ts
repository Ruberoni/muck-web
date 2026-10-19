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

export const REACH = 3.5
export const HIT_COOLDOWN = 0.4
export const WOBBLE_DURATION = 0.15

export interface PropDef {
  name: string
  verb: string
  hp: number
  drop: { item: ItemId; amount: number }
  /** Segundos hasta que vuelve a aparecer tras destruirlo; sin valor, no vuelve. */
  regrow?: number
}

export const PROP_DEFS: Record<'tree' | 'rock' | 'bush', PropDef> = {
  tree: { name: 'Árbol', verb: 'talar', hp: 3, drop: { item: 'wood', amount: 4 } },
  rock: { name: 'Roca', verb: 'picar', hp: 4, drop: { item: 'stone', amount: 3 } },
  bush: { name: 'Arbusto de bayas', verb: 'recoger', hp: 1, drop: { item: 'berry', amount: 3 }, regrow: 90 },
}

// Margen extra entre el jugador y un prop que vuelve a crecer: no reaparece pegado a él.
export const REGROW_CLEARANCE = 0.5

export const BASE_DAMAGE = 1

export interface ToolDef {
  kind: keyof typeof PROP_DEFS
  multiplier: number
  /** Daño contra enemigos, sea cual sea el tipo de herramienta. */
  attack: number
}

// Una herramienta solo multiplica el daño contra su tipo de prop; contra el resto se golpea como a mano.
export const TOOL_DEFS: Partial<Record<ItemId, ToolDef>> = {
  wood_axe: { kind: 'tree', multiplier: 2, attack: 2 },
  stone_axe: { kind: 'tree', multiplier: 4, attack: 3 },
  wood_pickaxe: { kind: 'rock', multiplier: 2, attack: 2 },
  stone_pickaxe: { kind: 'rock', multiplier: 4, attack: 3 },
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

export const CAMPFIRE_RADIUS = 0.6
// Distancia por delante del jugador a la que se coloca la fogata.
export const CAMPFIRE_PLACE_DISTANCE = 2.2
// Solo las fogatas más cercanas al jugador iluminan: el número de luces no cambia y no recompila shaders.
export const CAMPFIRE_LIGHTS = 4
export const CAMPFIRE_LIGHT_INTENSITY = 30
export const CAMPFIRE_LIGHT_DISTANCE = 22
