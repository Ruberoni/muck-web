import type { ItemId } from '../sim/inventory'

const HANDLE = `<polygon points="7,28 10,29.5 22,8 19,6.5" fill="#8a5a32"/>`
const axe = (head: string, edge: string) =>
  `<svg viewBox="0 0 32 32">${HANDLE}<polygon points="16,7 22,3 29,9 27,15 21,11" fill="${head}"/><polygon points="22,3 29,9 27,15" fill="${edge}"/></svg>`
const pickaxe = (head: string, edge: string) =>
  `<svg viewBox="0 0 32 32">${HANDLE}<polygon points="5,12 11,6 20,3 29,5 30,9 21,7 12,9" fill="${head}"/><polygon points="5,12 11,6 12,9" fill="${edge}"/><polygon points="29,5 30,9 25,7.5" fill="${edge}"/></svg>`

/** Iconos SVG de cada objeto, para la hotbar, la pantalla de inventario y las recetas. */
export const ICONS: Record<ItemId, string> = {
  wood: `<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3" fill="#8a5a32"/><ellipse cx="26" cy="16" rx="4" ry="7" fill="#d9a86a"/><ellipse cx="26" cy="16" rx="2" ry="3.5" fill="#b07b45"/></svg>`,
  stone: `<svg viewBox="0 0 32 32"><polygon points="6,22 10,10 20,6 27,14 25,24 14,27" fill="#9a978a"/><polygon points="10,10 20,6 18,15" fill="#b8b5a8"/><polygon points="18,15 27,14 25,24" fill="#7c796e"/></svg>`,
  berry: `<svg viewBox="0 0 32 32"><path d="M16 9 Q18 4 23 4 Q21 8 16 9" fill="#3d7d35"/><circle cx="11" cy="19" r="6" fill="#c2304a"/><circle cx="21" cy="20" r="6" fill="#a8243d"/><circle cx="16" cy="12" r="5.5" fill="#d63d58"/><circle cx="14.5" cy="10.5" r="1.5" fill="#f2a0ad"/></svg>`,
  wood_axe: axe('#d9a86a', '#b07b45'),
  wood_pickaxe: pickaxe('#d9a86a', '#b07b45'),
  stone_axe: axe('#b8b5a8', '#7c796e'),
  stone_pickaxe: pickaxe('#b8b5a8', '#7c796e'),
  raw_meat: `<svg viewBox="0 0 32 32"><rect x="20" y="17" width="9" height="4" rx="2" transform="rotate(35 24 19)" fill="#efe6d2"/><path d="M5 15 Q6 6 15 6 Q24 7 23 15 Q22 24 13 25 Q4 24 5 15" fill="#d9566a"/><path d="M9 14 Q11 9 16 10" stroke="#f2a0ad" stroke-width="2" fill="none"/><circle cx="14" cy="17" r="2.5" fill="#f4e2c8"/></svg>`,
  campfire: `<svg viewBox="0 0 32 32"><path d="M16 4 Q23 12 21 19 Q19 23 16 23 Q13 23 11 19 Q9 12 16 4" fill="#ff7a1f"/><path d="M16 11 Q20 16 18.5 20 Q17.5 22 16 22 Q14.5 22 13.5 20 Q12 16 16 11" fill="#ffd23f"/><polygon points="4,25 6,22 26,26 25,29" fill="#6b4426"/><polygon points="28,25 26,22 6,26 7,29" fill="#8a5a32"/></svg>`,
  workbench: `<svg viewBox="0 0 32 32"><polygon points="7,15 10,15 9,28 6,28" fill="#6b4426"/><polygon points="22,15 25,15 26,28 23,28" fill="#6b4426"/><rect x="8" y="21" width="16" height="2.5" fill="#6b4426"/><polygon points="3,12 29,12 28,16 4,16" fill="#c8955a"/><polygon points="3,12 29,12 27,9 5,9" fill="#e0b07a"/><rect x="17" y="4" width="2.5" height="7" rx="1" fill="#8a5a32"/><rect x="13.5" y="3" width="9.5" height="3.5" rx="1" fill="#9a978a"/></svg>`,
  birch_wood: `<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3" fill="#ece8dc"/><rect x="9" y="9" width="3" height="5" fill="#2f2c28"/><rect x="16" y="17" width="4" height="6" fill="#2f2c28"/><rect x="11" y="19" width="2" height="4" fill="#2f2c28"/><ellipse cx="26" cy="16" rx="4" ry="7" fill="#e9d2a8"/><ellipse cx="26" cy="16" rx="2" ry="3.5" fill="#c9ab78"/></svg>`,
  iron_ore: `<svg viewBox="0 0 32 32"><polygon points="6,22 10,10 20,6 27,14 25,24 14,27" fill="#7b7268"/><polygon points="10,10 20,6 18,15" fill="#968c80"/><polygon points="18,15 27,14 25,24" fill="#5f5850"/><polygon points="12,15 15,13 16,17 13,19" fill="#d9864a"/><polygon points="20,9 23,10 21,13" fill="#c8743a"/><polygon points="16,21 19,20 19,24 16,24" fill="#c8743a"/></svg>`,
}
