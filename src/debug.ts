import { aimPose } from './sim/interaction'
import type { Game } from './game/Game'
import { INVENTORY_SIZE, SLOT_COUNT, type ItemId } from './sim/inventory'
import type { PlayerInput } from './sim/player'
import { computeWorldHash } from './world/hash'
import { islandMeshes } from './view/PropView'
import { heightAt, WATER_LEVEL } from './sim/world/terrain'
import { EYE_HEIGHT, FLOAT_DEPTH, PLAYER_RADIUS, WADE_DEPTH } from './sim/constants'
import { ENEMY_AIM_HEIGHT } from './sim/enemies'
import { STRUCTURE_DEFS, STRUCTURE_KINDS, structureSpot, type StructureKind } from './sim/structures'
import { isRecipeId, RECIPE_IDS, type RecipeId } from './sim/crafting'
import type { DevOp } from './net/protocol'
import { CRAFT_MANY } from './ui/recipes'
import { LocalSession } from './net/session'
import { NetSession, startBot, type Bot } from './net/netSession'

/** Espera a que se dibujen `n` frames (en red, para que el objetivo se recalcule tras un truco). */
const frames = (n = 2) => new Promise<void>((resolve) => {
  const next = () => (--n <= 0 ? resolve() : requestAnimationFrame(next))
  requestAnimationFrame(next)
})

/**
 * Helpers de depuración y pruebas, solo en desarrollo. Con un jugador los trucos cambian la simulación local
 * directamente y devuelven el resultado al momento. En red (`__debug.net`) los hace el servidor de desarrollo
 * (mensajes `dev`): devuelven una promesa que se cumple cuando la predicción ya los recoge. Los de solo lectura
 * leen siempre `game.sim`, que en red es el espejo del cliente. `advance`, `start({manual})` y `restart` son solo
 * de un jugador; `select`, `craft` y `move` pasan por acciones, como las teclas (se aplican en el siguiente paso).
 */
export function installDebug(game: Game) {
  const sim = () => game.sim
  const slot = () => game.slot
  const player = () => game.slot.player
  const inventory = () => game.slot.inventory
  // Se calcula antes de que el jugador toque nada: es la huella del mundo generado.
  const worldHash = computeWorldHash(islandMeshes(game.propView))
  // Solo ids de props: los enemigos tienen su propia numeración (ver enemies()).
  const targetPropId = () => {
    const t = slot().target
    return t && t.kind !== 'enemy' ? t.id : null
  }
  /** En red, el truco va al servidor; con un jugador, `local` lo hace aquí. */
  function dev<T>(op: DevOp, local: () => T): T | Promise<void> {
    const { net } = game
    return net ? net.dev(op) : local()
  }
  const localOnly = (what: string) => {
    if (game.net) throw new Error(`${what} solo con un jugador`)
  }
  const bots: Bot[] = []

  const net = {
    /** Crea una sala nueva y entra en ella; devuelve su código (queda en la URL como `?room=`). */
    async create(name = 'Jugador') {
      return enter(await NetSession.create(name))
    },
    /** Entra en la sala `code` (con el token guardado si ya se estuvo). */
    async join(code: string, name = 'Jugador') {
      return enter(await NetSession.open('join', code.toUpperCase(), name))
    },
    /** Sale de la sala y vuelve a jugar solo. */
    leave() {
      for (const bot of bots.splice(0)) bot.stop()
      game.setSession(new LocalSession())
      history.replaceState(null, '', location.pathname)
    },
    room: () => game.net?.room ?? null,
    me: () => game.net?.me ?? null,
    /** Los demás jugadores tal como se dibujan ahora. */
    players: () =>
      (game.net?.client.shownPlayers ?? []).map(({ id, pose, data }) => ({
        id,
        name: game.net!.client.names.get(id) ?? '',
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        ...data,
      })),
    /** Retraso artificial en cada sentido (ms), para probar con latencia en local. */
    setLatency(ms: number, jitter = 0) {
      const transport = game.net?.transport
      if (!transport) throw new Error('no se está en una sala')
      transport.latency = ms
      transport.jitter = jitter
    },
    /** Otro jugador en esta pestaña que anda en círculos; devuelve su id. */
    async addBot() {
      const room = game.net?.room
      if (!room) throw new Error('no se está en una sala')
      const bot = await startBot(room, `Bot ${bots.length + 1}`)
      bots.push(bot)
      return bot.id
    },
    /** Corta la conexión como si se cayera la red: la sesión vuelve a entrar sola (`reconnecting`). */
    drop() {
      const transport = game.net?.transport
      if (!transport) throw new Error('no se está en una sala')
      transport.close(4999)
    },
    /** online | reconnecting | lost */
    status: () => game.net?.status ?? null,
    removeBots() {
      for (const bot of bots.splice(0)) bot.stop()
    },
    /** Reloj y predicción: RTT, margen, correcciones. */
    stats() {
      const client = game.net?.client
      if (!client) return null
      const { rtt, rttDev, margin, lead, targetMargin } = client.clock
      return { rtt, rttDev, margin, targetMargin, lead, ...client.predictor!.stats }
    },
  }

  function enter(session: NetSession) {
    game.setSession(session)
    history.replaceState(null, '', `?room=${session.room}`)
    return session.room
  }

  const api = {
    worldHash,
    net,
    start({ manual = false }: { manual?: boolean } = {}) {
      if (manual) localOnly('el reloj manual')
      game.manualClock = manual
      game.setState('playing')
    },
    advance: (seconds: number) => game.advance(seconds),
    setKeys(keys: Partial<PlayerInput> | null) {
      game.inputOverride = keys
    },
    setAttack(held: boolean | null) {
      game.attackOverride = held
    },
    /** Pulsación única de tecla (e.code), se consume en el siguiente paso. */
    press: (code: string) => game.input.press(code),
    /** Pasos de rueda (positivo hacia abajo), se consumen en el siguiente paso. */
    scroll: (steps: number) => game.input.scroll(steps),
    setVitals: (vitals: { health?: number; hunger?: number }) => dev({ op: 'setVitals', ...vitals }, () => void Object.assign(player(), vitals)),
    state: () => game.state,
    restart() {
      localOnly('restart')
      game.restart()
    },
    player: () => {
      const p = player()
      return {
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        yaw: p.yaw,
        stamina: p.stamina,
        grounded: p.grounded,
        exhausted: p.exhausted,
        sprintLocked: p.sprintLocked,
        health: p.health,
        hunger: p.hunger,
      }
    },
    teleport: (x: number, z: number, yaw?: number) => game.teleport(x, z, yaw, 0),
    /** Se pone delante del prop mirándolo; devuelve el prop apuntado (en red, en una promesa). */
    aimAt(propId: number) {
      const { world } = sim()
      const prop = world.props[propId]
      const isFree = (x: number, z: number) => {
        if (heightAt(x, z) < WATER_LEVEL - WADE_DEPTH) return false
        for (const other of world.grid.query(x, z, PLAYER_RADIUS + world.grid.maxRadius)) {
          if (other.alive && Math.hypot(other.x - x, other.z - z) < other.radius + PLAYER_RADIUS) return false
        }
        return true
      }
      const pose = aimPose(prop, isFree)
      const eyeY = Math.max(heightAt(pose.x, pose.z), WATER_LEVEL - FLOAT_DEPTH) + EYE_HEIGHT
      const moved = game.teleport(pose.x, pose.z, pose.yaw, Math.atan2(pose.aimY - eyeY, pose.horizontal))
      if (moved) return moved.then(() => frames()).then(targetPropId)
      sim().interaction.updateTarget(slot())
      game.advance(0)
      return targetPropId()
    },
    inventory: () => inventory().toJSON(),
    hotbar: () => ({ slots: inventory().slots.slice(0, SLOT_COUNT), selected: inventory().selected }),
    /** Las casillas de la mochila (9–26). */
    backpack: () => inventory().slots.slice(SLOT_COUNT),
    give: (item: ItemId, amount = 1) => dev({ op: 'give', item, amount }, () => inventory().add(item, amount)),
    select: (index: number) => {
      // En red, una casilla fuera de la hotbar hace que la sala expulse al jugador.
      if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) throw new Error(`no existe la casilla ${index} de la hotbar`)
      game.queueAction({ kind: 'select', slot: index })
    },
    /** Fabrica como un clic en la receta (`times`: Mayúsculas + clic); los que no se puedan no se mandan. */
    craft: (id: RecipeId, times = 1) => {
      // En red, una receta que no existe hace que la sala expulse al jugador.
      if (!isRecipeId(id)) throw new Error(`no existe la receta ${id} (son ${RECIPE_IDS.join(', ')})`)
      if (!Number.isInteger(times) || times < 1 || times > CRAFT_MANY) throw new Error(`times debe ser un entero de 1 a ${CRAFT_MANY}`)
      for (let i = 0; i < times; i++) game.queueAction({ kind: 'craft', recipe: id })
    },
    /** Intercambia dos casillas del inventario (0–8 hotbar, 9–26 mochila). */
    move: (from: number, to: number) => {
      const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < INVENTORY_SIZE
      if (!valid(from) || !valid(to)) throw new Error(`casillas fuera de rango: ${from}, ${to}`)
      game.queueAction({ kind: 'move', from, to })
    },
    /**
     * Abre (jugando) o cierra la pantalla de inventario. Cerrarla desde aquí no recaptura el ratón (no hay gesto del
     * usuario): vuelve a jugar sin él, como `start`.
     */
    inventoryScreen(open: boolean) {
      if (open) game.openInventory()
      else if (game.state === 'inventory') game.setState('playing')
      return game.state
    },
    structures: () => sim().structures.list.map(({ id, kind, x, y, z }) => ({ id, kind, x, y, z })),
    /**
     * Coloca una estructura `kind` delante de (x, z) mirando a `yaw`, sin gastar materiales; sin (x, z), delante del
     * jugador, y sin `yaw`, hacia donde mira. Devuelve si se pudo (con un jugador).
     */
    placeStructure: (kind: StructureKind, x?: number, z?: number, yaw?: number) => {
      // En red, un tipo que no existe hace que la sala expulse al jugador.
      if (!STRUCTURE_KINDS.includes(kind)) throw new Error(`no existe la estructura ${kind} (son ${STRUCTURE_KINDS.join(', ')})`)
      if ((x === undefined) !== (z === undefined)) throw new Error('x y z van juntas')
      // En red, un número no finito llega como null y la sala expulsa al jugador.
      if ([x, z, yaw].some((n) => n !== undefined && !Number.isFinite(n))) throw new Error('x, z y yaw deben ser números finitos')
      const op: DevOp = { op: 'placeStructure', kind }
      if (x !== undefined && z !== undefined) Object.assign(op, { x, z })
      if (yaw !== undefined) Object.assign(op, { yaw })
      return dev(op, () => {
        const s = sim()
        const from = x !== undefined && z !== undefined ? { x, z } : player().pos
        const spot = structureSpot(from, yaw ?? player().yaw, STRUCTURE_DEFS[kind].radius, [s.world.grid, s.structures.grid])
        return s.structures.place(spot, kind, slot().id) !== null
      })
    },
    props: () => sim().world.props.map(({ id, kind, x, y, z, radius, hp, alive }) => ({ id, kind, x, y, z, radius, hp, alive })),
    target: targetPropId,
    /** Objetos en el suelo, por recoger. */
    pickups: () => sim().pickups.list.map(({ id, item, pos, grounded }) => ({ id, item, x: pos.x, y: pos.y, z: pos.z, grounded })),
    enemies: () =>
      sim().enemies.list.map(({ id, pos, hp }) => {
        const target = slot().target
        return { id, x: pos.x, z: pos.z, hp, targeted: target?.kind === 'enemy' && target.id === id }
      }),
    /** Con un jugador devuelve su id; en red aparece en el siguiente `snap`. */
    spawnEnemy: (x: number, z: number) => dev({ op: 'spawnEnemy', x, z }, () => sim().enemies.spawnAt(x, z).id),
    /** Gira la cámara hacia el enemigo sin mover al jugador; devuelve si queda apuntado (en red, en una promesa). */
    aimAtEnemy(id: number) {
      const e = sim().enemies.list.find((en) => en.id === id)
      if (!e) return false
      const p = player()
      const dx = e.pos.x - p.pos.x
      const dz = e.pos.z - p.pos.z
      const dy = heightAt(e.pos.x, e.pos.z) + ENEMY_AIM_HEIGHT - (p.pos.y + EYE_HEIGHT)
      const yaw = Math.atan2(-dx, -dz)
      const pitch = Math.atan2(dy, Math.hypot(dx, dz))
      // En red solo cambia la mirada, que es del cliente: el objetivo sale del siguiente paso.
      if (game.net) {
        game.setLook(yaw, pitch)
        return frames().then(() => slot().target?.kind === 'enemy' && slot().target?.id === id)
      }
      game.teleport(p.pos.x, p.pos.z, yaw, pitch)
      sim().interaction.updateTarget(slot())
      game.advance(0)
      return slot().target === e
    },
    hand: () => ({ item: game.handheld.item, action: game.handheld.action }),
    heightAt,
    clock: () => ({ day: sim().clock.day, phase: sim().clock.phase }),
    /** Salta a una hora del día actual (0 = amanecer, redondeada al tick) y renderiza. */
    setPhase: (phase: number) =>
      dev({ op: 'setPhase', phase }, () => {
        sim().setPhase(phase)
        game.advance(0)
      }),
  }

  window.__debug = api
  return api
}

export type DebugApi = ReturnType<typeof installDebug>
