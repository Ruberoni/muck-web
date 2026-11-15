import type { DebugApi } from './debug'
import type { Game } from './game/Game'
import { ENEMY_DEFS, HEALTH_MAX, HUNGER_MAX, type EnemyType, type KeepDef, type SpecialId } from './sim/constants'
import { isNight } from './sim/world/daycycle'
import { WATER_LEVEL } from './sim/world/terrain'

/** Una muestra: qué jefe sale, a qué distancia, cada tecla qué ataque hace y si se pueden quitar los mobs que llama. */
interface Sample {
  type: EnemyType
  name: string
  /** Metros delante del jugador a los que sale. */
  distance: number
  /** Para que guarde las distancias aunque en el juego se acerque (solo en esta página): así se le ve entero. */
  keep?: KeepDef
  attacks: Record<string, { attack: SpecialId; label: string }>
  /** El texto de la tecla que quita los mobs que llama (sin él, no hay tecla). */
  clear?: string
  /** El texto de la tecla que lo enfurece (le baja la vida a su furia) o lo calma (sin él, no hay tecla). */
  fury?: string
}

// Las teclas: el juego no usa ninguna de estas.
const SAMPLES: Record<string, Sample> = {
  lanzarrocas: {
    type: 'thrower',
    name: 'Lanzarrocas',
    distance: 11,
    attacks: {
      KeyJ: { attack: 'smash', label: 'Golpe al suelo' },
      KeyK: { attack: 'summonGolems', label: 'Llamar gólems' },
      KeyL: { attack: 'fastRock', label: 'Roca rápida' },
    },
    clear: 'Quitar los gólems',
  },
  // A unos 10 m se le ve entero (mide más de 4 m), la embestida (16 m/s durante 0,6 s) aún llega a darte y las
  // flechas se ven volar.
  gigante: {
    type: 'giant',
    name: 'Trasgo gigante',
    distance: 10.5,
    keep: { flee: 9.5, max: 10.5 },
    attacks: {
      KeyJ: { attack: 'stomp', label: 'Pisotón' },
      KeyK: { attack: 'charge', label: 'Embestida' },
      KeyL: { attack: 'arrowVolley', label: 'Tres flechas' },
    },
  },
  // A unos 8 m se le ve entero (mide unos 3,6 m) y llega su anillo de fuego; los charcos y el meteorito caen donde
  // estás. Enfurecido, el anillo sale dos veces y caen tres meteoritos.
  guardian: {
    type: 'guardian',
    name: 'Guardián del meteorito',
    distance: 8,
    keep: { flee: 7.5, max: 8.5 },
    attacks: {
      KeyJ: { attack: 'lavaSlash', label: 'Tajo de lava' },
      KeyK: { attack: 'fireRing', label: 'Anillo de fuego' },
      KeyL: { attack: 'burningGround', label: 'Charcos de lava' },
      KeyU: { attack: 'meteorDrop', label: 'Meteorito' },
    },
    fury: 'Enfurecer / calmar',
  },
}
const NIGHT_KEY = 'KeyN'
/** Quita los mobs comunes (los que llama el jefe): se ponen delante y lo tapan. */
const CLEAR_KEY = 'KeyG'
/** Enfurece al jefe que tiene furia (o lo calma devolviéndole la vida). */
const FURY_KEY = 'KeyH'
/** Mediodía y medianoche (fase del día). */
const NOON = 0.3
const MIDNIGHT = 0.82
/** Cada cuánto (ms) se le devuelve la vida al jugador y se calma al jefe. */
const TICK_MS = 200
/** La espera que se le pone a cada ataque del jefe para que no ataque solo. */
const QUIET = 999

/**
 * Ventana de muestra, solo en desarrollo (`?muestra=lanzarrocas`, `?muestra=gigante` o `?muestra=guardian`): una partida
 * sola, de día, con el jefe delante, para ver sus ataques como en el juego. El jefe no ataca solo: J, K, L (y U) hacen
 * cada uno de sus ataques; N cambia entre día y noche, G quita los mobs que haya llamado y H enfurece al Guardián. El
 * jugador no muere ni pasa hambre.
 */
export function installMuestra(game: Game, debug: DebugApi, which: string) {
  const sample = SAMPLES[which]
  if (!sample) {
    console.warn(`muestra: no hay muestra de "${which}" (hay ${Object.keys(SAMPLES).join(', ')})`)
    return
  }
  // Solo en esta página de desarrollo: el jefe guarda las distancias para que se le vea entero.
  if (sample.keep) ENEMY_DEFS[sample.type].keep = sample.keep
  void game.playSolo('normal')
  debug.setPhase(NOON)
  let boss = place(game, debug, sample)

  const panel = document.createElement('div')
  panel.className = 'muestra'
  const row = (code: string, label: string) => `<div data-key="${code}"><kbd>${code.slice(3)}</kbd> ${label}</div>`
  panel.innerHTML = `<b>Muestra · ${sample.name}</b>${Object.entries(sample.attacks)
    .map(([code, { label }]) => row(code, label))
    .join('')}${row(NIGHT_KEY, 'Día / noche')}${sample.clear ? row(CLEAR_KEY, sample.clear) : ''}${sample.fury ? row(FURY_KEY, sample.fury) : ''}`
  const style = document.createElement('style')
  // A la izquierda, debajo del día: arriba en el centro va la vida del jefe.
  style.textContent = `.muestra { position: fixed; top: 64px; left: 12px; z-index: 50;
    pointer-events: none; padding: 8px 14px; border-radius: 8px; background: rgb(0 0 0 / 0.55); color: #fff;
    font: 14px/1.6 system-ui, sans-serif; text-align: left; }
  .muestra b { display: block; margin-bottom: 2px; }
  .muestra kbd { display: inline-block; min-width: 1.4em; text-align: center; margin-right: 6px; border-radius: 4px;
    background: #fff; color: #222; font: 600 12px/1.6 system-ui, sans-serif; }
  .muestra .on { color: #ffd76a; }`
  document.head.append(style)
  document.body.append(panel)
  const flash = (code: string) => {
    const el = panel.querySelector(`[data-key="${code}"]`)
    el?.classList.add('on')
    setTimeout(() => el?.classList.remove('on'), 600)
  }

  window.setInterval(() => {
    debug.setVitals({ health: HEALTH_MAX, hunger: HUNGER_MAX })
    const e = game.sim.enemies.list.find((en) => en.id === boss)
    if (!e?.alive) return
    for (const d of ENEMY_DEFS[sample.type].specials ?? []) e.special.cooldowns[d.id] = QUIET
  }, TICK_MS)

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return
    if (ev.code === NIGHT_KEY) {
      debug.setPhase(isNight(game.sim.clock.phase) ? NOON : MIDNIGHT)
      flash(ev.code)
      return
    }
    if (ev.code === CLEAR_KEY && sample.clear) {
      for (const spot of game.sim.enemies.calmAll()) game.smokeView.puff(spot.x, spot.z)
      flash(ev.code)
      return
    }
    const fury = ENEMY_DEFS[sample.type].fury
    if (ev.code === FURY_KEY && sample.fury && fury) {
      const e = game.sim.enemies.list.find((en) => en.id === boss && en.alive)
      if (!e) return
      // Calmado: se le deja justo encima de su furia y un golpecito lo enfurece, como en el juego (con su aviso).
      if (e.hp <= e.maxHp * fury.below) e.hp = e.maxHp
      else {
        e.hp = e.maxHp * fury.below + 1
        game.sim.enemies.hit(e, 2, e.pos, game.slot.id)
      }
      flash(ev.code)
      return
    }
    const key = sample.attacks[ev.code]
    if (!key) return
    if (!game.sim.enemies.list.some((en) => en.id === boss && en.alive)) boss = place(game, debug, sample)
    if (debug.special(boss, key.attack)) flash(ev.code)
  })
}

/** Pone al jefe a su distancia en tierra, hacia donde haya más suelo, y gira al jugador hacia él. Devuelve su id. */
function place(game: Game, debug: DebugApi, sample: Sample): number {
  const { island } = game.sim
  const { pos, yaw } = game.slot.player
  const distance = sample.distance
  let best = { x: pos.x - Math.sin(yaw) * distance, z: pos.z - Math.cos(yaw) * distance, low: -Infinity }
  for (let i = 0; i < 16; i++) {
    const angle = yaw + (i * Math.PI * 2) / 16
    const fx = -Math.sin(angle)
    const fz = -Math.cos(angle)
    // Lo más bajo del camino hasta él: así no queda detrás de un lago.
    let low = Infinity
    for (let d = 2; d <= distance; d += 1.5) low = Math.min(low, island.heightAt(pos.x + fx * d, pos.z + fz * d))
    if (low > best.low) best = { x: pos.x + fx * distance, z: pos.z + fz * distance, low }
  }
  if (best.low <= WATER_LEVEL) console.warn('muestra: no hay suelo seco alrededor; el jefe sale igual')
  const id = debug.spawnEnemy(best.x, best.z, sample.type) as number
  debug.teleport(pos.x, pos.z, Math.atan2(-(best.x - pos.x), -(best.z - pos.z)))
  return id
}
