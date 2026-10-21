import { describe, expect, it } from 'vitest'
import { CloseCode } from './protocol'
import { closeMessage, explainClose, QUOTA, reconnectDelay, SERVER_DOWN, shouldReconnect, statusUrl } from './status'

const answer = (ok: boolean) => (async () => ({ ok }) as Response) as typeof fetch
const unreachable = (async () => {
  throw new TypeError('Failed to fetch')
}) as typeof fetch

describe('estado de la conexión', () => {
  it('explica cada rechazo y cada código de cierre', () => {
    expect(closeMessage({ type: 'reject', reason: 'not-found' }, 1000, 'K7QX2')).toBe('No existe la sala K7QX2.')
    expect(closeMessage({ type: 'reject', reason: 'full' }, 4003)).toContain('llena')
    expect(closeMessage({ type: 'reject', reason: 'version', v: 9 }, 4000)).toContain('recarga')
    expect(closeMessage(null, CloseCode.OtherTab)).toContain('otra pestaña')
    expect(closeMessage(null, CloseCode.Quota)).toBe(QUOTA)
    expect(closeMessage(null, CloseCode.RoomDeleted)).toContain('borrado')
    expect(closeMessage(null, 1006)).toBeNull()
    expect(closeMessage(null, null)).toBeNull()
  })

  it('sin motivo, pregunta a /status: si no contesta, avisa de la cuota', async () => {
    expect(await explainClose(null, 1006, 'K7QX2', 'wss://x.dev', unreachable)).toBe(SERVER_DOWN)
    expect(await explainClose(null, 1006, 'K7QX2', 'wss://x.dev', answer(false))).toBe(SERVER_DOWN)
    expect(await explainClose(null, 1006, 'K7QX2', 'wss://x.dev', answer(true))).toBe('Sin conexión con el servidor.')
    expect(await explainClose(null, CloseCode.Quota, 'K7QX2', 'wss://x.dev', answer(true))).toBe(QUOTA)
  })

  it('la URL de /status sale de la del WebSocket', () => {
    expect(statusUrl('wss://muck-web.ruben-pardes25.workers.dev')).toBe('https://muck-web.ruben-pardes25.workers.dev/status')
    expect(statusUrl('ws://localhost:8787/')).toBe('http://localhost:8787/status')
  })

  it('reintenta tras un corte, pero no si la sala lo ha rechazado o no tiene arreglo', () => {
    for (const code of [1000, 1001, 1005, 1006, 1011, null]) expect(shouldReconnect(null, code)).toBe(true)
    for (const code of [CloseCode.Version, CloseCode.OtherTab, CloseCode.RoomDeleted, CloseCode.RoomFull, CloseCode.Quota, CloseCode.Invalid]) {
      expect(shouldReconnect(null, code)).toBe(false)
    }
    expect(shouldReconnect({ type: 'reject', reason: 'not-found' }, 1000)).toBe(false)
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 5000, 5000])
  })
})
