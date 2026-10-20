import { describe, expect, it } from 'vitest'
import { Inventory, SLOT_COUNT, type ItemId } from './inventory'

const empty = (n: number) => Array<null>(n).fill(null)

describe('Inventory', () => {
  it('suma cantidades y asigna casillas por orden de primera recogida', () => {
    const inv = new Inventory()
    let changes = 0
    inv.onChange(() => changes++)
    inv.add('stone', 3)
    inv.add('wood', 4)
    inv.add('stone', 3)
    expect(inv.count('stone')).toBe(6)
    expect(inv.count('wood')).toBe(4)
    expect(inv.slots).toEqual(['stone', 'wood', ...empty(SLOT_COUNT - 2)])
    expect(changes).toBe(3)
  })

  it('ignora cantidades no positivas', () => {
    const inv = new Inventory()
    expect(inv.add('wood', 0)).toBe(false)
    expect(inv.remove('wood', 0)).toBe(false)
    expect(inv.slots).toEqual(empty(SLOT_COUNT))
    expect(inv.count('wood')).toBe(0)
  })

  it('remove resta, falla si no hay bastantes y libera la casilla al llegar a 0', () => {
    const inv = new Inventory()
    inv.add('wood', 2)
    inv.add('berry', 2)
    expect(inv.remove('berry', 3)).toBe(false)
    expect(inv.remove('berry', 1)).toBe(true)
    expect(inv.count('berry')).toBe(1)
    expect(inv.slots.slice(0, 2)).toEqual(['wood', 'berry'])
    expect(inv.remove('berry', 1)).toBe(true)
    expect(inv.count('berry')).toBe(0)
    expect(inv.slots.slice(0, 2)).toEqual(['wood', null])
    expect(inv.remove('berry', 1)).toBe(false)
  })

  it('load solo avisa si el contenido cambia', () => {
    const inv = new Inventory()
    inv.add('wood', 2)
    inv.add('berry', 1)
    const saved = inv.save()
    let changes = 0
    inv.onChange(() => changes++)
    // Lo mismo con las claves en otro orden (como llega del servidor).
    inv.load({ ...saved, counts: { berry: 1, wood: 2 } })
    expect(changes).toBe(0)
    inv.load({ ...saved, counts: { wood: 3, berry: 1 } })
    expect(changes).toBe(1)
    inv.load({ ...saved, counts: { wood: 3, berry: 1 }, selected: 2 })
    expect(changes).toBe(2)
    expect(inv.count('wood')).toBe(3)
  })

  it('clear vacía cantidades y casillas y vuelve a la primera', () => {
    const inv = new Inventory()
    let changes = 0
    inv.onChange(() => changes++)
    inv.add('stone', 3)
    inv.clear()
    expect(inv.count('stone')).toBe(0)
    expect(inv.slots).toEqual(empty(SLOT_COUNT))
    expect(inv.selected).toBe(0)
    expect(changes).toBe(2)
  })

  it('has y remove: quita todo o nada', () => {
    const inv = new Inventory()
    inv.add('wood', 4)
    expect(inv.has('wood')).toBe(true)
    expect(inv.has('wood', 5)).toBe(false)
    expect(inv.remove('wood', 5)).toBe(false)
    expect(inv.count('wood')).toBe(4)
    expect(inv.remove('wood', 3)).toBe(true)
    expect(inv.count('wood')).toBe(1)
    expect(inv.slots[0]).toBe('wood')
  })

  it('al llegar a 0 libera la casilla sin mover las demás, y un objeto nuevo la reutiliza', () => {
    const inv = new Inventory()
    inv.add('wood', 4)
    inv.add('stone', 3)
    inv.remove('wood', 4)
    expect(inv.has('wood')).toBe(false)
    expect(inv.slots.slice(0, 2)).toEqual([null, 'stone'])
    inv.add('wood_axe', 1)
    expect(inv.slots.slice(0, 2)).toEqual(['wood_axe', 'stone'])
  })

  it('con todas las casillas ocupadas rechaza objetos nuevos pero acepta los que ya tiene', () => {
    const inv = new Inventory()
    // Rellena la hotbar burlando el tipo: hay menos objetos que casillas.
    const fillers = Array.from({ length: SLOT_COUNT }, (_, i) => `item${i}` as ItemId)
    fillers.forEach((item) => inv.add(item, 1))
    expect(inv.canAdd('wood')).toBe(false)
    expect(inv.add('wood', 4)).toBe(false)
    expect(inv.count('wood')).toBe(0)
    expect(inv.add(fillers[0], 2)).toBe(true)
    expect(inv.count(fillers[0])).toBe(3)
  })

  it('la casilla seleccionada da el objeto en la mano', () => {
    const inv = new Inventory()
    inv.add('wood', 1)
    inv.add('stone_axe', 1)
    expect(inv.selectedItem).toBe('wood')
    inv.select(1)
    expect(inv.selectedItem).toBe('stone_axe')
    inv.select(SLOT_COUNT)
    inv.select(-1)
    expect(inv.selected).toBe(1)
    inv.select(2)
    expect(inv.selectedItem).toBe(null)
  })

  it('cycle mueve la selección y da la vuelta en los dos extremos', () => {
    const inv = new Inventory()
    inv.cycle(1)
    expect(inv.selected).toBe(1)
    inv.cycle(-2)
    expect(inv.selected).toBe(SLOT_COUNT - 1)
    inv.cycle(1)
    expect(inv.selected).toBe(0)
    inv.cycle(SLOT_COUNT * 2 + 3)
    expect(inv.selected).toBe(3)
  })
})
