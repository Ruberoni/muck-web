import { PROP_DEFS } from './constants'
import type { PropData, PropKind } from './props'

/** Pocos golpes por prop. */
const QUICK_HP: Partial<Record<PropKind, number>> = { tree: 3, birch: 12, darkpine: 18, rock: 4, iron_ore: 12, mithril_ore: 18 }

/**
 * Solo para pruebas: props que caen en pocos golpes. Lo que prueba cómo funciona romper algo no debe depender de cuánto
 * se tarda en el juego real, que se ajusta jugando. Lo ya dañado sigue como estaba, para poder usarlo tras restaurar.
 */
export function quickProps(props: readonly PropData[]) {
  for (const prop of props) {
    if (PROP_DEFS[prop.kind].harvest) continue
    const whole = prop.hp === prop.maxHp
    prop.maxHp = QUICK_HP[prop.kind]!
    if (whole) prop.hp = prop.maxHp
  }
}
