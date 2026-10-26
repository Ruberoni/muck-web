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
  iron_axe: axe('#dfe3e8', '#9aa3ad'),
  iron_pickaxe: pickaxe('#dfe3e8', '#9aa3ad'),
  mithril_axe: axe('#8fd0f2', '#4f9cc8'),
  mithril_pickaxe: pickaxe('#8fd0f2', '#4f9cc8'),
  raw_meat: `<svg viewBox="0 0 32 32"><rect x="20" y="17" width="9" height="4" rx="2" transform="rotate(35 24 19)" fill="#efe6d2"/><path d="M5 15 Q6 6 15 6 Q24 7 23 15 Q22 24 13 25 Q4 24 5 15" fill="#d9566a"/><path d="M9 14 Q11 9 16 10" stroke="#f2a0ad" stroke-width="2" fill="none"/><circle cx="14" cy="17" r="2.5" fill="#f4e2c8"/></svg>`,
  campfire: `<svg viewBox="0 0 32 32"><path d="M16 4 Q23 12 21 19 Q19 23 16 23 Q13 23 11 19 Q9 12 16 4" fill="#ff7a1f"/><path d="M16 11 Q20 16 18.5 20 Q17.5 22 16 22 Q14.5 22 13.5 20 Q12 16 16 11" fill="#ffd23f"/><polygon points="4,25 6,22 26,26 25,29" fill="#6b4426"/><polygon points="28,25 26,22 6,26 7,29" fill="#8a5a32"/></svg>`,
  workbench: `<svg viewBox="0 0 32 32"><polygon points="7,15 10,15 9,28 6,28" fill="#6b4426"/><polygon points="22,15 25,15 26,28 23,28" fill="#6b4426"/><rect x="8" y="21" width="16" height="2.5" fill="#6b4426"/><polygon points="3,12 29,12 28,16 4,16" fill="#c8955a"/><polygon points="3,12 29,12 27,9 5,9" fill="#e0b07a"/><rect x="17" y="4" width="2.5" height="7" rx="1" fill="#8a5a32"/><rect x="13.5" y="3" width="9.5" height="3.5" rx="1" fill="#9a978a"/></svg>`,
  birch_wood: `<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3" fill="#ece8dc"/><rect x="9" y="9" width="3" height="5" fill="#2f2c28"/><rect x="16" y="17" width="4" height="6" fill="#2f2c28"/><rect x="11" y="19" width="2" height="4" fill="#2f2c28"/><ellipse cx="26" cy="16" rx="4" ry="7" fill="#e9d2a8"/><ellipse cx="26" cy="16" rx="2" ry="3.5" fill="#c9ab78"/></svg>`,
  iron_ore: `<svg viewBox="0 0 32 32"><polygon points="6,22 10,10 20,6 27,14 25,24 14,27" fill="#7b7268"/><polygon points="10,10 20,6 18,15" fill="#968c80"/><polygon points="18,15 27,14 25,24" fill="#5f5850"/><polygon points="12,15 15,13 16,17 13,19" fill="#d9864a"/><polygon points="20,9 23,10 21,13" fill="#c8743a"/><polygon points="16,21 19,20 19,24 16,24" fill="#c8743a"/></svg>`,
  iron_bar: `<svg viewBox="0 0 32 32"><polygon points="4,22 9,14 27,14 28,22" fill="#9aa3ad"/><polygon points="9,14 12,10 30,10 27,14" fill="#dfe3e8"/><polygon points="27,14 30,10 31,18 28,22" fill="#7a838d"/><polygon points="13,11.5 22,11.5 21,12.5 12.5,12.5" fill="#f4f6f8"/></svg>`,
  furnace: `<svg viewBox="0 0 32 32"><rect x="19" y="3" width="5" height="7" fill="#77736a"/><rect x="4" y="9" width="24" height="20" rx="1.5" fill="#9a958a"/><rect x="3" y="8" width="26" height="3" fill="#77736a"/><path d="M4 17 H28 M4 23 H28 M12 11 V17 M20 17 V23 M12 23 V29" stroke="#857f74" stroke-width="1"/><rect x="10" y="18" width="12" height="9" rx="1" fill="#2a211c"/><path d="M12 27 Q13 22 16 20 Q19 22 20 27 Z" fill="#ff7a1f"/><path d="M14 27 Q15 24 16 23 Q17 24 18 27 Z" fill="#ffd23f"/></svg>`,
  anvil: `<svg viewBox="0 0 32 32"><polygon points="11,26 21,26 23,29 9,29" fill="#6b4426"/><polygon points="6,9 22,9 22,15 6,15" fill="#5c636d"/><polygon points="22,9 30,10 22,14" fill="#4d535c"/><polygon points="6,9 22,9 23,7.5 7,7.5" fill="#8a929c"/><polygon points="12,15 18,15 17,21 13,21" fill="#4d535c"/><polygon points="9,21 21,21 22,26 8,26" fill="#5c636d"/></svg>`,
  dark_wood: `<svg viewBox="0 0 32 32"><rect x="4" y="9" width="24" height="14" rx="3" fill="#3e2c20"/><ellipse cx="26" cy="16" rx="4" ry="7" fill="#8a6440"/><ellipse cx="26" cy="16" rx="2" ry="3.5" fill="#5e4128"/></svg>`,
  mithril_ore: `<svg viewBox="0 0 32 32"><polygon points="6,22 10,10 20,6 27,14 25,24 14,27" fill="#6c7080"/><polygon points="10,10 20,6 18,15" fill="#868b9a"/><polygon points="18,15 27,14 25,24" fill="#555966"/><polygon points="12,15 15,13 16,17 13,19" fill="#6fc4f4"/><polygon points="20,9 23,10 21,13" fill="#4fb3f0"/><polygon points="16,21 19,20 19,24 16,24" fill="#4fb3f0"/></svg>`,
  mithril_bar: `<svg viewBox="0 0 32 32"><polygon points="4,22 9,14 27,14 28,22" fill="#4f9cc8"/><polygon points="9,14 12,10 30,10 27,14" fill="#8fd0f2"/><polygon points="27,14 30,10 31,18 28,22" fill="#3b7fa8"/><polygon points="13,11.5 22,11.5 21,12.5 12.5,12.5" fill="#d8f1fd"/></svg>`,
}
