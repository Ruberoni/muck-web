import { isSkin } from '../net/skins'

const SKIN_KEY = 'muck-web:skin'

/** La skin elegida y guardada en el navegador (`muck-web:skin`); sin ninguna (o una que ya no existe), la automática. */
export function loadSkin(): number | undefined {
  try {
    const saved = Number(localStorage.getItem(SKIN_KEY) ?? NaN)
    return isSkin(saved) ? saved : undefined
  } catch {
    return undefined
  }
}
