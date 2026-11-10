import type { ItemId } from './inventory'
import type { Biome } from './world/biomes'

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
  /** Resistencia que devuelve al momento. */
  stamina?: number
  /** Segundos en los que correr y saltar no gastan resistencia (el escudo sí). Otra solo renueva el tiempo. */
  breath?: number
  /** Segundos con la velocidad multiplicada por `factor`. */
  speed?: { factor: number; seconds: number }
  /** Segundos con el daño recibido multiplicado por `factor` (menos de 1). */
  guard?: { factor: number; seconds: number }
  /** Lo que hace en el mundo, no en quien lo toma (lo decide la simulación): calmar a los mobs u olvidar un rasgo. */
  world?: 'calm' | 'forget'
}

export const CONSUMABLE_DEFS: Partial<Record<ItemId, ConsumableDef>> = {
  berry: { food: 15 },
  // Se puede comer, pero llena poco: compensa asarla.
  raw_meat: { food: 8 },
  cooked_meat: { food: 45, heal: 15 },
  berry_infusion: { food: 0, regen: { perSec: 2, seconds: 20 } },
  healing_herb: { food: 0, heal: 25 },
  // Llena la resistencia y deja correr sin gastarla: con varias seguidas se corre sin parar.
  mint: { food: 0, stamina: STAMINA_MAX, breath: 20 },
  // Lo que vende el mercader (merchant.ts).
  healing_potion: { food: 0, heal: 60 },
  speed_potion: { food: 0, speed: { factor: 1.3, seconds: 60 } },
  stamina_potion: { food: 0, stamina: STAMINA_MAX, breath: 60 },
  stone_potion: { food: 0, guard: { factor: 0.7, seconds: 60 } },
  calm_incense: { food: 0, world: 'calm' },
  forget_amulet: { food: 0, world: 'forget' },
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
/** Segundos entre golpes, salvo que el arma diga otra cosa (ToolDef.cooldown). */
export const HIT_COOLDOWN = 0.4
const SWORD_COOLDOWN = 0.25
/** Enemigos a los que alcanza un golpe de espada como mucho, contando al apuntado (Interaction). */
export const SWEEP_TARGETS = 4
export const WOBBLE_DURATION = 0.15

/** Familia de un prop: decide su forma, su hitbox, de dónde cae lo que suelta y cómo suena. */
export type PropFamily = 'tree' | 'rock' | 'bush' | 'herb'
/** Familia de una herramienta: el hacha tala árboles, el pico rompe rocas y la espada solo sirve para pelear. */
export type ToolFamily = 'axe' | 'pickaxe' | 'sword'

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
export const PROP_DEFS: Record<'tree' | 'birch' | 'darkpine' | 'rock' | 'iron_ore' | 'mithril_ore' | 'bush' | 'healing_herb' | 'coal_ore' | 'crystal_ore' | 'deadtree' | 'mint', PropDef> = {
  // Recolectar lleva tiempo, y el tiempo es lo que falta: mejorar una herramienta es ganarlo.
  tree: { name: 'Árbol', verb: 'talar', family: 'tree', tool: 'axe', tier: 0, hp: 16, drop: { item: 'wood', amount: 4 } },
  birch: { name: 'Abedul', verb: 'talar', family: 'tree', tool: 'axe', tier: 2, hp: 40, drop: { item: 'birch_wood', amount: 4 } },
  darkpine: { name: 'Pino oscuro', verb: 'talar', family: 'tree', tool: 'axe', tier: 3, hp: 72, drop: { item: 'dark_wood', amount: 4 } },
  // En la playa y la montaña: su madera seca arde el doble en el horno.
  deadtree: { name: 'Árbol muerto', verb: 'talar', family: 'tree', tool: 'axe', tier: 2, hp: 30, drop: { item: 'dry_wood', amount: 3 } },
  rock: { name: 'Roca', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 1, hp: 20, drop: { item: 'stone', amount: 3 } },
  iron_ore: { name: 'Mena de hierro', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 2, hp: 60, drop: { item: 'iron_ore', amount: 3 } },
  mithril_ore: { name: 'Mena de mithril', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 3, hp: 96, drop: { item: 'mithril_ore', amount: 5 } },
  // El combustible bueno del horno y del destilador: arde cuatro veces más que la madera.
  coal_ore: { name: 'Mena de carbón', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 1, hp: 24, drop: { item: 'coal', amount: 2 } },
  // En las cimas, junto al mithril: para el escudo de cristal.
  crystal_ore: { name: 'Mena de cristal', verb: 'picar', family: 'rock', tool: 'pickaxe', tier: 3, hp: 72, drop: { item: 'crystal', amount: 3 } },
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
  // Como la hierba curativa, en la pradera: devuelve la resistencia.
  mint: {
    name: 'Menta silvestre',
    verb: 'recoger',
    family: 'herb',
    tool: null,
    tier: 0,
    hp: 1,
    drop: { item: 'mint', amount: 1 },
    harvest: { regrow: 60, empty: 'ya recogida' },
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
  /** 1 madera, 2 piedra, 3 hierro, 4 mithril, 5 meteorito (la mano es el nivel 0). */
  tier: number
  /** Daño contra los props de su familia; contra el resto se golpea como a mano (la regla está en tiers.ts). */
  damage: number
  /** Daño contra enemigos, sea cual sea la familia de la herramienta. */
  attack: number
  /** Segundos entre golpes; sin él, HIT_COOLDOWN. */
  cooldown?: number
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
  // Algo menos de daño que una herramienta de su nivel, pero más cadencia y golpe en arco: las armas para pelear.
  wood_sword: { family: 'sword', tier: 1, damage: 1, attack: 16, cooldown: SWORD_COOLDOWN },
  stone_sword: { family: 'sword', tier: 2, damage: 1, attack: 25, cooldown: SWORD_COOLDOWN },
  iron_sword: { family: 'sword', tier: 3, damage: 1, attack: 35, cooldown: SWORD_COOLDOWN },
  mithril_sword: { family: 'sword', tier: 4, damage: 1, attack: 50, cooldown: SWORD_COOLDOWN },
  // La mejor arma del juego, y la única con más cadencia que las demás espadas.
  meteor_sword: { family: 'sword', tier: 5, damage: 1, attack: 65, cooldown: 0.22 },
}

/** Con qué se golpea a un enemigo: una familia de herramienta o, con cualquier otra cosa, la mano. */
export type WeaponClass = ToolFamily | 'hand'
/** Cuánto le ha hecho un golpe a un enemigo, por su debilidad al arma: la vista y el sonido lo distinguen. */
export type HitEfficacy = 'effective' | 'normal' | 'resisted'
/** Cómo se comporta un enemigo. */
export type EnemyAI = 'chase' | 'charge' | 'ranged' | 'guard'

/** Embestida: a `min`–`max` metros se agacha `windup` segundos y carga en línea recta `time` segundos a `speed`. */
export interface ChargeDef {
  min: number
  max: number
  windup: number
  speed: number
  time: number
  /** Segundos hasta poder volver a embestir. */
  cooldown: number
  /** Segundos que queda aturdido al acabar: quieto, y recibe DAZED_DAMAGE veces el daño. */
  dazed: number
}

/** Por cuánto se multiplica el daño a un jefe aturdido tras embestir. */
export const DAZED_DAMAGE = 2

/**
 * A distancia: se acerca hasta `max` metros y retrocede si tiene al jugador a menos de `flee`. Hasta `range` metros
 * se para `windup` segundos y lanza una roca desde `height` metros de altura, cada `attackInterval` segundos.
 */
export interface RangedDef {
  flee: number
  max: number
  range: number
  height: number
}

/** Los ataques especiales de los jefes (los hace la simulación con `onSpecial`, enemies.ts). */
export type SpecialId =
  | 'stomp'
  | 'tossGoblin'
  | 'rockRain'
  | 'boulder'
  | 'fireRing'
  | 'lightning'
  | 'burningGround'
  | 'pulse'
  | 'pillars'
  | 'shardFan'
  | 'lightBeam'

/**
 * Un ataque especial: a `min`–`max` metros del jugador avisa `windup` segundos (con la pose `look`), ataca y queda
 * `recover` segundos agotado, quieto y recibiendo DAZED_DAMAGE veces el daño: el hueco para golpearlo. Cada uno tiene su
 * espera (`cooldown`) y entre dos cualesquiera pasan al menos SPECIAL_GAP segundos.
 */
export interface SpecialDef {
  id: SpecialId
  min: number
  max: number
  windup: number
  cooldown: number
  recover: number
  look: 'crouch' | 'aim'
}

/** Segundos entre el final de un ataque especial y el principio del siguiente, sea cual sea. */
export const SPECIAL_GAP = 2.5
/** Con la coraza rota, las esperas de los ataques especiales se quedan en esto: el Coloso se enfada. */
export const SHELL_BROKEN_PACE = 0.75

/** Guarda un sitio: se despierta con un jugador a `aggro` metros y persigue mientras siga a menos de `leash` de ese sitio. */
export interface GuardDef {
  aggro: number
  leash: number
}

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
  /** Lo que resta a cada golpe: castiga las armas rápidas y débiles. */
  armor?: number
  /** Lo que suelta al morir. */
  loot: { item: ItemId; amount: number }[]
  /** Puntos que gasta al salir, para el futuro director de apariciones (docs/diseno-del-juego.md §4). */
  cost: number
  /** Desde qué noche sustituye a veces a un trasgo y con qué probabilidad en cada bioma (ver `spawnChance`). */
  spawn?: { fromNight: number; biomes: Record<Biome, number> }
  /** Jefe: sale solo en su noche (`bossOfNight`), con vida y botín según los jugadores, y no cuenta para el tope. */
  boss?: boolean
  charge?: ChargeDef
  ranged?: RangedDef
  /** Sale de un evento, no de la noche: no cuenta para el tope, y su vida y su botín van por jugador. */
  guard?: GuardDef
  /** Jefe de luz: nace de una tumba, con vida por jugador. Guarda una pieza del avión. */
  light?: boolean
  /** Coraza, por jugador: hasta romperla a pico casi no recibe daño. */
  shell?: number
  /** Ataques especiales, en orden de preferencia cuando hay varios listos. */
  specials?: SpecialDef[]
}

export const ENEMY_DEFS: Record<'goblin' | 'golem' | 'spirit' | 'giant' | 'thrower' | 'guardian' | 'colossus' | 'dog', EnemyDef> = {
  // Herramientas: 7 golpes a mano, 4 de madera, 3 de piedra y 2 de hierro o mithril. Espadas: 5, 3, 2 y 2.
  goblin: {
    name: 'Trasgo',
    verb: 'atacar',
    hp: 70,
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
    loot: [{ item: 'raw_meat', amount: 1 }, { item: 'coin', amount: 1 }],
    cost: 1,
  },
  // Lento, duro y sin aturdirse: se rompe con el pico, y el hacha apenas le hace nada.
  golem: {
    name: 'Gólem de piedra',
    verb: 'atacar',
    hp: 170,
    speed: 3.5,
    radius: 0.8,
    scale: 1.7,
    damage: 15,
    gap: 0.35,
    reach: 0.8,
    attackInterval: 1.6,
    windup: 0.7,
    knockback: 0,
    stagger: 0,
    staggerGap: 0,
    nocturnal: true,
    ai: 'chase',
    weakness: { pickaxe: 2, axe: 0.5, hand: 0.5 },
    loot: [{ item: 'stone', amount: 3 }, { item: 'iron_ore', amount: 1 }, { item: 'coin', amount: 2 }],
    cost: 3,
    spawn: { fromNight: 2, biomes: { beach: 0.1, meadow: 0.1, forest: 0.1, mountain: 0.6 } },
  },
  // Rápido como quien anda y de golpe flojo: se tala con el hacha.
  spirit: {
    name: 'Espíritu del bosque',
    verb: 'atacar',
    hp: 130,
    speed: 6,
    radius: 0.5,
    scale: 1.15,
    damage: 8,
    gap: 0.35,
    reach: 0.7,
    attackInterval: 1,
    windup: 0.4,
    knockback: 6,
    stagger: 0.3,
    staggerGap: 0.6,
    nocturnal: true,
    ai: 'chase',
    weakness: { axe: 2, pickaxe: 0.5, hand: 0.5 },
    loot: [{ item: 'wood', amount: 4 }, { item: 'birch_wood', amount: 1 }, { item: 'coin', amount: 2 }],
    cost: 2,
    spawn: { fromNight: 2, biomes: { beach: 0.05, meadow: 0.15, forest: 0.6, mountain: 0.05 } },
  },
  // Mini-boss: más rápido que andar, y embiste. 1,8 veces el trasgo.
  giant: {
    name: 'Trasgo gigante',
    verb: 'atacar',
    hp: 1800,
    armor: 10,
    speed: 6.5,
    radius: 0.95,
    scale: 2.25,
    damage: 25,
    gap: 0.35,
    reach: 0.9,
    attackInterval: 1.4,
    windup: 0.5,
    knockback: 0,
    stagger: 0,
    staggerGap: 0,
    nocturnal: true,
    ai: 'charge',
    weakness: {},
    loot: [{ item: 'raw_meat', amount: 3 }, { item: 'iron_bar', amount: 2 }, { item: 'boss_trophy', amount: 1 }, { item: 'coin', amount: 12 }],
    cost: 8,
    boss: true,
    charge: { min: 5, max: 9, windup: 0.8, speed: 16, time: 0.6, cooldown: 5, dazed: 2.5 },
    specials: [
      // Pisotón: salta y cae con una onda de 7 m que se esquiva saltando o alejándose.
      { id: 'stomp', min: 0, max: 5, windup: 0.8, cooldown: 9, recover: 1.4, look: 'crouch' },
      // Agarra un trasgo y lo lanza: hace daño al caer, y el trasgo se levanta y pelea.
      { id: 'tossGoblin', min: 10, max: 24, windup: 0.9, cooldown: 14, recover: 1.1, look: 'aim' },
    ],
  },
  // Mini-boss a distancia: más lento que andar, para que se le pueda alcanzar, y sus rocas se esquivan.
  thrower: {
    name: 'Lanzarrocas',
    verb: 'atacar',
    hp: 1400,
    armor: 5,
    speed: 5,
    radius: 0.8,
    scale: 1.9,
    damage: 15,
    gap: 0.35,
    reach: 0.9,
    attackInterval: 2.5,
    windup: 0.7,
    knockback: 0,
    stagger: 0,
    staggerGap: 0,
    nocturnal: true,
    ai: 'ranged',
    weakness: {},
    loot: [{ item: 'mithril_ore', amount: 2 }, { item: 'stone', amount: 6 }, { item: 'boss_trophy', amount: 1 }, { item: 'coin', amount: 10 }],
    cost: 7,
    boss: true,
    ranged: { flee: 8, max: 14, range: 20, height: 3 },
    specials: [
      // Lluvia de piedras: cinco marcas alrededor del jugador, que caen a los 1,2 s.
      { id: 'rockRain', min: 4, max: 22, windup: 1, cooldown: 11, recover: 1.3, look: 'aim' },
      // Roca gorda: lenta, y estalla en 3 m al caer.
      { id: 'boulder', min: 6, max: 22, windup: 1.1, cooldown: 13, recover: 1.5, look: 'aim' },
    ],
  },
  // Guarda el meteorito de día y de noche, hasta que lo matan. Más lento que andar, y el pico lo rompe antes.
  guardian: {
    name: 'Guardián del meteorito',
    verb: 'atacar',
    hp: 1500,
    armor: 10,
    speed: 4.5,
    radius: 0.9,
    scale: 2,
    damage: 15,
    gap: 0.35,
    reach: 0.9,
    attackInterval: 1.4,
    windup: 0.6,
    knockback: 0,
    stagger: 0,
    staggerGap: 0,
    nocturnal: false,
    ai: 'guard',
    weakness: { pickaxe: 1.5 },
    loot: [{ item: 'meteor_fragment', amount: 3 }, { item: 'coin', amount: 5 }],
    cost: 6,
    guard: { aggro: 15, leash: 25 },
    specials: [
      // Anillo de fuego: una onda lenta de 9 m que se esquiva saltando.
      { id: 'fireRing', min: 0, max: 6, windup: 0.9, cooldown: 10, recover: 1.4, look: 'crouch' },
      // Suelo ardiente: tres charcos alrededor del jugador que queman 5 s.
      { id: 'burningGround', min: 3, max: 18, windup: 1, cooldown: 12, recover: 1.3, look: 'aim' },
      // Rayo: marca donde estás y cae a los 0,9 s.
      { id: 'lightning', min: 4, max: 20, windup: 0.8, cooldown: 7, recover: 1, look: 'aim' },
    ],
  },
  // Jefe de luz: casi no recibe daño hasta que un pico le rompe la coraza. Guarda el motor del avión.
  colossus: {
    name: 'Coloso de Cristal',
    verb: 'atacar',
    hp: 3000,
    armor: 15,
    shell: 400,
    speed: 4.5,
    radius: 1.1,
    scale: 2.6,
    damage: 30,
    gap: 0.35,
    reach: 1,
    attackInterval: 1.6,
    windup: 0.7,
    knockback: 0,
    stagger: 0,
    staggerGap: 0,
    nocturnal: false,
    ai: 'chase',
    weakness: {},
    loot: [{ item: 'plane_engine', amount: 1 }, { item: 'coin', amount: 20 }],
    cost: 10,
    light: true,
    specials: [
      // Pulso: si estás pegado a él, un estallido de 4,5 m a su alrededor.
      { id: 'pulse', min: 0, max: 4, windup: 0.7, cooldown: 8, recover: 1.2, look: 'crouch' },
      // Pilares: una fila de cristales que brotan del suelo, uno tras otro, hacia el jugador.
      { id: 'pillars', min: 3, max: 16, windup: 0.9, cooldown: 10, recover: 1.3, look: 'crouch' },
      // Abanico de esquirlas: cinco, abiertas; se esquiva entre dos o de lado.
      { id: 'shardFan', min: 5, max: 20, windup: 0.9, cooldown: 9, recover: 1.1, look: 'aim' },
      // Haz de luz: te apunta 2 s, marca donde estás y cae a los 0,8 s.
      { id: 'lightBeam', min: 0, max: 30, windup: 2, cooldown: 15, recover: 1.6, look: 'aim' },
    ],
  },
  // Al final: el orden es el índice en el cable. Sale en manada (DOG_PACK), más rápido que andar y más lento que correr:
  // obliga a gastar resistencia para escapar. Poca vida y mordiscos flojos pero seguidos.
  dog: {
    name: 'Perro salvaje',
    verb: 'atacar',
    hp: 45,
    speed: 7.5,
    radius: 0.42,
    scale: 0.72,
    damage: 4,
    gap: 0.3,
    reach: 0.6,
    attackInterval: 0.9,
    windup: 0.3,
    knockback: 8,
    stagger: 0.25,
    staggerGap: 0.5,
    nocturnal: true,
    ai: 'chase',
    weakness: {},
    loot: [{ item: 'raw_meat', amount: 1 }, { item: 'coin', amount: 1 }],
    cost: 1,
    spawn: { fromNight: 2, biomes: { beach: 0.15, meadow: 0.25, forest: 0.12, mountain: 0.05 } },
  },
}
export type EnemyType = keyof typeof ENEMY_DEFS
/** Cuántos perros salen juntos cuando sale uno: entre `min` y `max`, sin pasar del tope. */
export const DOG_PACK = { min: 2, max: 3 }
/** Los tipos en orden fijo: un `snap` lleva el índice en vez del nombre. */
export const ENEMY_TYPES = Object.keys(ENEMY_DEFS) as EnemyType[]

export const ENEMY_SPAWN_INTERVAL = 5
/** Un jefe cada tantas noches, unos segundos después de anochecer y algo más lejos que el resto. */
export const BOSS_EVERY = 3
export const BOSS_DELAY = 20
export const BOSS_SPAWN_MIN = 38
export const BOSS_SPAWN_MAX = 50
/** Velocidad horizontal de las rocas que se lanzan. */
export const ROCK_SPEED = 14
/** Meteoritos: desde este día, uno al día a una hora al azar entre estas dos fases. */
export const METEOR_FROM_DAY = 2
export const METEOR_PHASE_MIN = 0.15
export const METEOR_PHASE_MAX = 0.4
/** Segundos desde que se anuncia hasta que cae. */
export const METEOR_WARNING = 6
/** A cuántos metros de un jugador vivo cae. */
export const METEOR_SPAWN_MIN = 40
export const METEOR_SPAWN_MAX = 70
/** Radio de la roca: bloquea el paso. */
export const METEOR_RADIUS = 1.6
/** Quien esté a menos de METEOR_BLAST metros al caer recibe este daño; también es el radio libre de props. */
export const METEOR_DAMAGE = 20
export const METEOR_BLAST = 4
/** Vida y botín de un jefe: un 50 % más por cada jugador a partir del segundo. */
export const BOSS_PER_PLAYER = 0.5
export const ENEMY_SPAWN_MIN = 34
export const ENEMY_SPAWN_MAX = 48
/** Segundos entre el aviso de una aparición (humo y sonido, `enemyIncoming`) y la salida del mob. */
export const SPAWN_WARN = 1.5
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
/**
 * A cuántos metros ve un mob común a un jugador y se lanza a por él, y a cuántos lo suelta una vez detrás. Dos
 * cifras para que no dude en la frontera: si fueran la misma, perdería y recuperaría el objetivo a cada paso.
 * Los jefes y los guardianes no las usan (los guardianes tienen su propio `aggro` y `leash`).
 */
export const ENEMY_AGGRO = 55
export const ENEMY_AGGRO_DROP = 80
/** A cuánto vagan buscando cuando no persiguen a nadie, y qué deprisa gira su rumbo. */
export const ENEMY_WANDER_SPEED = 1.2
export const ENEMY_WANDER_SPIN = 0.35

// Distancia por delante del jugador a la que se colocan la fogata y las demás estructuras (radios en structures.ts).
export const PLACE_DISTANCE = 2.2
// Alcance de una estación al fabricar: en horizontal, del centro del jugador al borde de la estación.
export const STATION_RANGE = 3.5
/**
 * Segundos de luz de una unidad de aceite, cuánto dura menos con cada campana y cuántas guarda el faro. 39 es el
 * tope que mantiene que un destilador no baste para una noche iluminada (lighthouse.test.ts); con 40 ya empatan.
 */
export const OIL_SECONDS = 39
export const OIL_WEAR = 0.9
export const OIL_MAX = 10
/** Parte del tiempo entre campanas que debe arder el faro para que la noche cuente como iluminada. */
export const LIT_SHARE = 2 / 3
/** Con el faro encendido se reaparece en él a los tantos segundos, también en la Noche Eterna. */
export const RESPAWN_LIGHTHOUSE_DELAY = 60
/** Segundos que hay que mantener la tecla de uso para activar el tótem: no debe hacerse sin querer. */
export const TOTEM_HOLD = 3
/** El avión: vida, segundos que tarda en calentar el motor, a cuántos metros se sube y lo que cuesta repararlo. */
export const PLANE_HP = 600
export const MOTOR_TIME = 90
export const PLANE_BOARD = 8
export const PLANE_REPAIR_WOOD = 10
/** Segundos que hay que mantener la tecla de uso para abrir una tumba. */
export const GRAVE_HOLD = 3
/** Lo que entra de cada golpe a quien aún tiene la coraza, si no es de pico. */
export const SHELL_RESIST = 0.1
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
