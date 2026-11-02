import type { PlayerId } from '../sim/events'

/**
 * Las skins de jugador: su modelo (`public/models/skins/`) y su nombre. Viajan como un índice en esta lista, y a la
 * simulación le dan igual: solo cambian lo que dibujan los clientes.
 */
export const SKINS = [
  { file: 'Medieval', name: 'Guerrera' },
  { file: 'Worker', name: 'Obrera' },
  { file: 'Witch', name: 'Bruja' },
  { file: 'SciFi', name: 'Piloto' },
  { file: 'Punk', name: 'Punk' },
  { file: 'Soldier', name: 'Soldado' },
  { file: 'Adventurer', name: 'Exploradora' },
  { file: 'Casual', name: 'Casual' },
  { file: 'Formal', name: 'Elegante' },
  { file: 'Suit', name: 'Ejecutiva' },
] as const

/** Las primeras, que se distinguen bien de lejos: a quien no elige le toca una según su número. */
const AUTO_SKINS = 5

export const autoSkin = (id: PlayerId) => id % AUTO_SKINS

export const isSkin = (skin: unknown): skin is number => Number.isInteger(skin) && (skin as number) >= 0 && (skin as number) < SKINS.length
