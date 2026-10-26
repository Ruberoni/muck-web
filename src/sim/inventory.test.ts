import { describe, expect, it } from 'vitest'
import { Inventory, INVENTORY_SIZE, SLOT_COUNT, type ItemId } from './inventory'

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
    expect(inv.slots).toEqual(['stone', 'wood', ...empty(INVENTORY_SIZE - 2)])
    expect(changes).toBe(3)
  })

  it('ignora cantidades no positivas', () => {
    const inv = new Inventory()
    expect(inv.add('wood', 0)).toBe(false)
    expect(inv.remove('wood', 0)).toBe(false)
    expect(inv.slots).toEqual(empty(INVENTORY_SIZE))
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
    expect(inv.slots).toEqual(empty(INVENTORY_SIZE))
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

  it('lo nuevo va a la hotbar y, si está llena, a la mochila', () => {
    const inv = new Inventory()
    // Burlando el tipo: hay menos objetos que casillas en la hotbar.
    const fillers = Array.from({ length: SLOT_COUNT }, (_, i) => `item${i}` as ItemId)
    fillers.forEach((item) => inv.add(item, 1))
    expect(inv.slots.slice(0, SLOT_COUNT)).toEqual(fillers)
    expect(inv.add('wood', 2)).toBe(true)
    expect(inv.slots[SLOT_COUNT]).toBe('wood')
    // Al vaciar una casilla de la hotbar, lo siguiente nuevo vuelve a ella.
    inv.remove(fillers[3], 1)
    inv.add('stone', 1)
    expect(inv.slots[3]).toBe('stone')
  })

  it('con todas las casillas ocupadas rechaza objetos nuevos pero acepta los que ya tiene', () => {
    const inv = new Inventory(4)
    // Un inventario reducido: con los objetos que hay, el de 27 casillas no se llena.
    const fillers = Array.from({ length: 4 }, (_, i) => `item${i}` as ItemId)
    fillers.forEach((item) => inv.add(item, 1))
    expect(inv.canAdd('wood')).toBe(false)
    expect(inv.add('wood', 4)).toBe(false)
    expect(inv.count('wood')).toBe(0)
    expect(inv.add(fillers[0], 2)).toBe(true)
    expect(inv.count(fillers[0])).toBe(3)
  })

  it('move intercambia dos casillas, también con la mochila, y sin casillas que no existen no hace nada', () => {
    const inv = new Inventory()
    inv.add('wood', 3)
    inv.add('stone', 2)
    let changes = 0
    inv.onChange(() => changes++)
    expect(inv.move(0, 1)).toBe(true)
    expect(inv.slots.slice(0, 2)).toEqual(['stone', 'wood'])
    expect(inv.move(1, INVENTORY_SIZE - 1)).toBe(true)
    expect(inv.slots[1]).toBe(null)
    expect(inv.slots[INVENTORY_SIZE - 1]).toBe('wood')
    expect(changes).toBe(2)
    for (const [from, to] of [[0, 0], [0, INVENTORY_SIZE], [-1, 0], [0.5, 1]]) expect(inv.move(from, to)).toBe(false)
    expect(changes).toBe(2)
    // Las cantidades no cambian, y lo que se agota libera su casilla en la mochila.
    expect(inv.toJSON()).toEqual({ wood: 3, stone: 2 })
    inv.remove('wood', 3)
    expect(inv.slots[INVENTORY_SIZE - 1]).toBe(null)
  })

  it('la mano lleva lo que haya en la casilla elegida, también tras mover', () => {
    const inv = new Inventory()
    inv.add('wood', 1)
    inv.add('stone_axe', 1)
    inv.move(1, 20)
    inv.select(1)
    expect(inv.selectedItem).toBe(null)
    inv.move(20, 1)
    expect(inv.selectedItem).toBe('stone_axe')
  })

  it('save y load conservan la mochila', () => {
    const inv = new Inventory()
    inv.add('wood', 2)
    inv.move(0, 15)
    const copy = new Inventory()
    copy.load(JSON.parse(JSON.stringify(inv.save())))
    expect(copy.slots).toEqual(inv.slots)
    expect(copy.slots[15]).toBe('wood')
    expect(copy.count('wood')).toBe(2)
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
