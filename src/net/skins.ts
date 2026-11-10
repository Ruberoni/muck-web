import type { PlayerId } from '../sim/events'

/**
 * Las skins de jugador: su modelo (`public/models/skins/`) y su nombre. Viajan como un índice en esta lista, y a la
 * simulación le dan igual: solo cambian lo que dibujan los clientes.
 *
 * De momento hay una sola, la más ligera (Punk: 710 KB, 11.956 vértices, 5.956 triángulos). Los otros nueve .glb
 * siguen en `public/models/skins/` sin referenciar: no se descargan, y basta con volver a listarlos aquí para
 * recuperarlos. Quien tenga un índice antiguo guardado cae en `isSkin` y vuelve a la automática.
 */
export const SKINS = [{ file: 'Punk', name: 'Punk' }] as const

/** Las primeras, que se distinguen bien de lejos: a quien no elige le toca una según su número. */
const AUTO_SKINS = 5

export const autoSkin = (id: PlayerId) => id % Math.min(AUTO_SKINS, SKINS.length)

export const isSkin = (skin: unknown): skin is number => Number.isInteger(skin) && (skin as number) >= 0 && (skin as number) < SKINS.length
