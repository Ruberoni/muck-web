import type { EnemyType, HitEfficacy } from './constants'
import type { StationState } from './stations'
import type { RecipeId } from './crafting'
import type { BuildState } from './builds'
import type { ChargeState } from './enemies'
import type { ItemId } from './inventory'
import type { MatchResult } from './match'
import type { ProjectileEnd, ProjectileKind } from './projectiles'
import type { LighthouseFire, PlaneState, StructureKind } from './structures'
import type { MobTrait, ThreatState } from './threat'

/** Identificador de jugador. Con un jugador siempre es LOCAL_PLAYER. */
export type PlayerId = number
export const LOCAL_PLAYER: PlayerId = 0

/** Lo que tiene delante un jugador al golpear. */
export type TargetRef = { kind: 'prop' | 'enemy'; id: number }

/**
 * Lo que pasa en un paso de la simulación. HUD, sonido, mano y vistas se suscriben a esto en vez de
 * que la simulación los llame. `by` es quien lo provocó. Un golpe que rompe o mata emite
 * propDestroyed/enemyDied en vez de propHit/enemyHit.
 */
export type SimEventData =
  | { type: 'propHit'; id: number; hp: number; by: PlayerId }
  | { type: 'propDestroyed'; id: number; by: PlayerId }
  | { type: 'berryTaken'; id: number; hp: number; by: PlayerId }
  | { type: 'berryGrew'; id: number; hp: number }
  | { type: 'pickupSpawn'; id: number; item: ItemId; amount: number; keep?: true }
  /** Ha pasado demasiado tiempo en el suelo (`GROUND_TIME`). */
  | { type: 'pickupExpired'; id: number }
  | { type: 'pickupCollected'; id: number; by: PlayerId }
  | { type: 'structurePlaced'; id: number; kind: StructureKind; x: number; y: number; z: number; rotY: number; by: PlayerId }
  /** Una estación tiene un trabajo más en cola, o ha terminado el primero (lo hecho llega en su `pickupSpawn`). */
  | { type: 'stationChanged'; id: number; station: StationState }
  /** Ha cambiado el fuego de un faro. */
  | { type: 'fireChanged'; id: number; fire: LighthouseFire }
  /** Han entregado materiales a una construcción. `finished`: la fase que ha acabado, si ha acabado alguna. */
  | { type: 'buildProgress'; id: number; build: BuildState; finished: string | null }
  | { type: 'enemySpawn'; id: number; enemy: EnemyType; x: number; z: number }
  /** Va a salir un mob común aquí dentro de SPAWN_WARN segundos: humo y sonido. */
  | { type: 'enemyIncoming'; enemy: EnemyType; x: number; z: number }
  /** `kx`, `kz`: el empujón del golpe; a 0 si lo ha aguantado sin aturdirse. */
  | { type: 'enemyHit'; id: number; hp: number; kx: number; kz: number; by: PlayerId; efficacy: HitEfficacy }
  | { type: 'enemyAttack'; id: number; target: PlayerId }
  /** Embestida: se agacha (`crouch`), carga (`rush`) y acaba (`idle`). */
  | { type: 'enemyCharge'; id: number; state: ChargeState }
  | { type: 'enemyDied'; id: number; by: PlayerId }
  /** Sale un proyectil: con esto el cliente sigue su trayectoria (ver `Projectiles`). */
  | { type: 'projectileThrown'; id: number; kind: ProjectileKind; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { type: 'projectileHit'; id: number; x: number; y: number; z: number; end: ProjectileEnd }
  | { type: 'playerSwing'; id: PlayerId; item: ItemId | null; target: TargetRef | null }
  | { type: 'playerAte'; id: PlayerId; item: ItemId }
  | { type: 'playerCrafted'; id: PlayerId; recipe: RecipeId }
  | { type: 'playerTraded'; id: PlayerId; op: 'buy' | 'sell'; item: ItemId }
  /** Ha colocado `item` (la estructura llega en su `structurePlaced`). */
  | { type: 'playerPlaced'; id: PlayerId; item: ItemId }
  /** Ha tirado `amount` de `item` (el objeto del suelo llega en su `pickupSpawn`). */
  | { type: 'playerDropped'; id: PlayerId; item: ItemId; amount: number }
  /** Se ha puesto `item` (null: se ha quitado algo). */
  | { type: 'playerEquipped'; id: PlayerId; item: ItemId | null }
  /** `blocked`: lo que ha parado el escudo (sin él, nada). */
  | { type: 'playerHurt'; id: PlayerId; dmg: number; blocked?: number }
  | { type: 'playerDied'; id: PlayerId }
  | { type: 'playerRespawn'; id: PlayerId; x: number; z: number }
  /** Todos muertos (o, en solitario, sin vidas): a los pocos segundos se acaba la partida (`matchEnded`). */
  | { type: 'gameOver'; day: number }
  /** Durante la cuenta atrás del game over ha vuelto alguien vivo: la partida sigue. */
  | { type: 'gameOverCancelled' }
  | { type: 'matchEnded'; result: MatchResult }
  /** Un meteorito: se anuncia (`landTick`: cuándo cae), cae, se enfría y desaparece. Ver `WorldEvents`. */
  | { type: 'meteorIncoming'; x: number; y: number; z: number; landTick: number }
  /** Un pez va a por quien lleva rato nadando en el mar, le muerde y se va cuando sale (fish.ts). */
  | { type: 'fishAppeared'; id: PlayerId }
  | { type: 'fishBite'; id: PlayerId }
  | { type: 'fishLeft'; id: PlayerId }
  | { type: 'meteorLanded'; x: number; y: number; z: number }
  | { type: 'meteorCooled'; day: number }
  | { type: 'meteorGone' }
  /** Cae la Noche Eterna: ya no vuelve a amanecer. */
  | { type: 'eternalNight' }
  /** Acaba una noche de la Noche Eterna: lo que antes pasaba al amanecer pasa ahora. */
  | { type: 'bell'; night: number }
  /** El faro ha ardido bastante: los mobs no suben con esta campana. */
  | { type: 'nightLit'; night: number; threat: ThreatState }
  /** Se ha activado el tótem: ya no se puede deshacer. */
  | { type: 'totemActivated'; id: number }
  /** Al activar el tótem cae el avión en llamas (la estructura llega en su `structurePlaced`). */
  | { type: 'planeCrashed'; id: number; x: number; z: number }
  | { type: 'planeChanged'; id: number; plane: PlaneState }
  /** Se ha abierto una tumba: ha nacido su jefe. */
  | { type: 'graveOpened'; id: number }
  /** Un pico ha roto la coraza de un jefe de luz. */
  | { type: 'shellBroken'; id: number }
  /** Los mobs han subido: un rasgo con la campana o, sin él (`trait` null), uno de los saltos. */
  | { type: 'mobsRose'; trait: MobTrait | null; threat: ThreatState }
  /** El amuleto del olvido: los mobs pierden `trait` (null: no tenían ninguno). */
  | { type: 'mobsForgot'; trait: MobTrait | null; threat: ThreatState }
  /** El incienso de calma: los mobs comunes se deshacen en humo en estos sitios, sin botín. */
  | { type: 'mobsCalmed'; spots: { x: number; z: number }[] }
  /** Lo comprado en el puesto del mercader `id`: cambian los precios que suben. */
  | { type: 'shopChanged'; id: number; bought: Partial<Record<ItemId, number>> }
  | { type: 'clockSet'; worldStartTick: number }
  | { type: 'worldReset'; worldStartTick: number }

export type SimEvent = SimEventData & { tick: number }

/** Lo que reciben los módulos de la simulación para emitir eventos. */
export type Emit = (event: SimEventData) => void

export const NO_EMIT: Emit = () => {}

/** Eventos del paso en curso, sellados con su tick. */
export class EventLog {
  tick = 0
  private list: SimEvent[] = []

  readonly emit: Emit = (event) => void this.list.push({ ...event, tick: this.tick })

  /** Devuelve los eventos acumulados y vacía el registro. */
  drain(): SimEvent[] {
    const list = this.list
    this.list = []
    return list
  }
}
