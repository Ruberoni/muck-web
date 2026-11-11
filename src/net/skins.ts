import type { PlayerId } from '../sim/events'

/**
 * Las skins de jugador: su modelo (`public/models/skins/`) y su nombre. Viajan como un índice en esta lista, y a la
 * simulación le dan igual: solo cambian lo que dibujan los clientes.
 *
 * Hay una sola: la náufraga casual (de `arte/listas/personaje/Jugador.glb`, con `npm run exportar` en `arte/taller`),
 * con las cuatro piezas de armadura que enseña según lo que lleva puesto (`CharacterRig.setArmor`). Quien tenga un
 * índice antiguo guardado cae en `isSkin` y vuelve a la automática.
 */
export const SKINS = [{ file: 'Naufraga', name: 'Náufraga' }] as const

/** Las primeras, que se distinguen bien de lejos: a quien no elige le toca una según su número. */
const AUTO_SKINS = 5

export const autoSkin = (id: PlayerId) => id % Math.min(AUTO_SKINS, SKINS.length)

export const isSkin = (skin: unknown): skin is number => Number.isInteger(skin) && (skin as number) >= 0 && (skin as number) < SKINS.length
