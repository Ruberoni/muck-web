import { ENEMY_DEFS, PROP_DEFS, type EnemyType, type HitEfficacy, type MobLook } from '../sim/constants'
import { enemyAimHeight } from '../sim/enemies'
import type { ItemId } from '../sim/inventory'
import type { PropKind, PropPlacement } from '../sim/props'
import { canDamage, weaponClass } from '../sim/tiers'
import type { Impact, ImpactMaterial } from './AttackFxView'

/** De qué está hecho cada prop, para lo que salta al golpearlo. */
const PROP_MATERIAL: Record<PropKind, ImpactMaterial> = {
  tree: 'wood',
  birch: 'birch',
  darkpine: 'darkwood',
  deadtree: 'deadwood',
  rock: 'stone',
  coal_ore: 'coal',
  iron_ore: 'iron',
  mithril_ore: 'mithril',
  crystal_ore: 'crystal',
  bush: 'leaves',
  healing_herb: 'leaves',
  mint: 'leaves',
}

/** De qué está hecho cada enemigo: los de roca sueltan lascas; el espíritu, astillas; el Coloso, cristales. */
const ENEMY_MATERIAL: Partial<Record<EnemyType, ImpactMaterial>> = {
  golem: 'rockCreature',
  thrower: 'rockCreature',
  guardian: 'rockCreature',
  colossus: 'crystal',
  spirit: 'woodCreature',
}

/** Alto del tronco (árboles, por su escala) o mitad de alto (rocas, sobre su centro) en que puede dar el golpe. */
const TRUNK_HEIGHT = 2.2
/** Dónde empieza la copa de cada árbol (por su escala); el árbol muerto no tiene hojas. */
const CANOPY_AT: Partial<Record<PropKind, number>> = { tree: 2.4, birch: 2.6, darkpine: 2 }

export interface Ray {
  x: number
  y: number
  z: number
  /** Dirección (unitaria). */
  dx: number
  dy: number
  dz: number
}

/**
 * Dónde da un golpe que va por `ray` contra un cilindro vertical de radio `radius` en (cx, cz), entre `bottom` y `top`:
 * donde el rayo entra en él o, si pasa de largo (se apunta al borde), el punto de su superficie más cercano al rayo.
 * Devuelve el punto y la normal horizontal de la superficie ahí (hacia fuera: hacia quien golpea).
 */
export function hitOnCylinder(ray: Ray, cx: number, cz: number, radius: number, bottom: number, top: number) {
  const ox = ray.x - cx
  const oz = ray.z - cz
  const a = ray.dx * ray.dx + ray.dz * ray.dz
  const b = 2 * (ox * ray.dx + oz * ray.dz)
  const c = ox * ox + oz * oz - radius * radius
  const disc = b * b - 4 * a * c
  let t: number
  if (a < 1e-9) t = 0
  else if (disc >= 0 && (-b - Math.sqrt(disc)) / (2 * a) > 0) t = (-b - Math.sqrt(disc)) / (2 * a)
  else t = Math.max(0, -b / (2 * a))
  let px = ray.x + ray.dx * t - cx
  let pz = ray.z + ray.dz * t - cz
  const out = Math.hypot(px, pz)
  // Dentro o en el eje: hacia quien golpea.
  const nx = out > 1e-6 ? px / out : ox / (Math.hypot(ox, oz) || 1)
  const nz = out > 1e-6 ? pz / out : oz / (Math.hypot(ox, oz) || 1)
  px = nx * radius
  pz = nz * radius
  const y = Math.min(top, Math.max(bottom, ray.y + ray.dy * t))
  return { x: cx + px, y, z: cz + pz, nx, nz }
}

/** El rayo desde (x, y, z) hacia (tx, ty, tz): para los golpes de los demás, que van hacia el centro de lo que golpean. */
export function rayTo(x: number, y: number, z: number, tx: number, ty: number, tz: number): Ray {
  const d = Math.hypot(tx - x, ty - y, tz - z) || 1
  return { x, y, z, dx: (tx - x) / d, dy: (ty - y) / d, dz: (tz - z) / d }
}

/** El golpe con `item` que va por `ray` contra el prop `prop`: dónde da, de qué es y si le hace algo. */
export function propImpact(prop: PropPlacement, item: ItemId | null, ray: Ray, slash?: number): Impact {
  const { family } = PROP_DEFS[prop.kind]
  const tree = family === 'tree'
  const radius = tree ? prop.radius * 0.8 : prop.radius
  const bottom = tree || family === 'bush' || family === 'herb' ? prop.y + 0.1 : prop.y - prop.radius * 0.4
  const top = tree ? prop.y + TRUNK_HEIGHT * prop.scaleY : family === 'bush' ? prop.y + 0.9 : family === 'herb' ? prop.y + 0.35 : prop.y + prop.radius * 0.8
  const at = hitOnCylinder(ray, prop.x, prop.z, radius, bottom, top)
  const canopy = CANOPY_AT[prop.kind]
  return {
    ...at,
    material: PROP_MATERIAL[prop.kind],
    tool: weaponClass(item),
    ...(canDamage(item, prop.kind) ? {} : { blocked: true }),
    ...(canopy !== undefined ? { canopy: prop.y + canopy * prop.scaleY } : {}),
    ...(slash !== undefined ? { slash } : {}),
  }
}

/** Un enemigo, como lo necesita el golpe: dónde está (con el suelo bajo sus pies), de qué tipo y cómo se ve. */
export interface StruckEnemy {
  type: EnemyType
  look?: MobLook
  x: number
  z: number
  floor: number
}

/** El golpe con `item` que va por `ray` contra `enemy`: dónde da (en su cuerpo) y de qué es. */
export function enemyImpact(enemy: StruckEnemy, item: ItemId | null, ray: Ray, efficacy?: HitEfficacy, slash?: number): Impact {
  const chest = enemyAimHeight(enemy.type, enemy.look)
  const at = hitOnCylinder(ray, enemy.x, enemy.z, ENEMY_DEFS[enemy.type].radius * 0.85, enemy.floor + chest * 0.4, enemy.floor + chest * 1.6)
  return {
    ...at,
    material: ENEMY_MATERIAL[enemy.type] ?? 'creature',
    tool: weaponClass(item),
    ...(efficacy ? { efficacy } : {}),
    ...(slash !== undefined ? { slash } : {}),
  }
}

/** Dónde apuntan los golpes de los demás en un enemigo: a su pecho. */
export const enemyChest = (enemy: StruckEnemy) => enemy.floor + enemyAimHeight(enemy.type, enemy.look)
