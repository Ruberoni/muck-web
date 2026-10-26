import { describe, expect, it } from 'vitest'
import { CloseCode, PROTOCOL_VERSION } from './protocol'
import { closeMessage, explainClose, nextMark, OLD_SERVER_FOR_MS, QUOTA, reconnectDelay, RELOAD_FOR_MS, SERVER_DOWN, shouldReconnect, statusUrl, versionAction } from './status'

const answer = (ok: boolean) => (async () => ({ ok }) as Response) as typeof fetch
const unreachable = (async () => {
  throw new TypeError('Failed to fetch')
}) as typeof fetch

describe('estado de la conexión', () => {
  it('explica cada rechazo y cada código de cierre', () => {
    expect(closeMessage({ type: 'reject', reason: 'not-found' }, 1000, 'K7QX2')).toBe('No existe la sala K7QX2.')
    expect(closeMessage({ type: 'reject', reason: 'full' }, 4003)).toContain('llena')
    expect(closeMessage({ type: 'reject', reason: 'version', v: PROTOCOL_VERSION + 1 }, 4000)).toContain('recarga')
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

  describe('otra versión', () => {
    const now = 1_000_000_000

    it('servidor más nuevo: recarga; si ya se recargó por esa versión hace poco, otra vez más tarde; luego se rinde', () => {
      expect(versionAction(7, 8, null, null, now)).toBe('reload')
      // Una recarga por otra versión no cuenta.
      expect(versionAction(7, 9, { v: 8, at: now - 1000 }, null, now)).toBe('reload')
      expect(versionAction(7, 8, { v: 8, at: now - 1000 }, null, now)).toBe('reload-later')
      expect(versionAction(7, 8, { v: 8, at: now - RELOAD_FOR_MS + 1 }, null, now)).toBe('reload-later')
      expect(versionAction(7, 8, { v: 8, at: now - RELOAD_FOR_MS }, null, now)).toBe('lost')
      // Una marca del futuro (se cambió el reloj) no vale.
      expect(versionAction(7, 8, { v: 8, at: now + 1000 }, null, now)).toBe('reload')
    })

    it('servidor más viejo: reintenta durante un rato, sin recargar', () => {
      expect(versionAction(8, 7, null, null, now)).toBe('retry')
      expect(versionAction(8, 7, { v: 7, at: now }, now - OLD_SERVER_FOR_MS + 1, now)).toBe('retry')
      expect(versionAction(8, 7, null, now - OLD_SERVER_FOR_MS, now)).toBe('lost')
    })

    it('al recargar otra vez por la misma versión, la marca no se renueva (si no, el plazo no acabaría nunca)', () => {
      const first = { v: 8, at: now - 60_000 }
      expect(nextMark(first, 8, now)).toBe(first)
      expect(nextMark(null, 8, now)).toEqual({ v: 8, at: now })
      expect(nextMark(first, 9, now)).toEqual({ v: 9, at: now })
      expect(nextMark({ v: 8, at: now + 1000 }, 8, now)).toEqual({ v: 8, at: now })
    })

    it('rendirse con el servidor viejo no pide recargar: el cliente ya es el nuevo', () => {
      expect(closeMessage({ type: 'reject', reason: 'version', v: PROTOCOL_VERSION - 1 }, 4000)).toContain('aún no se ha actualizado')
      expect(closeMessage({ type: 'reject', reason: 'version', v: PROTOCOL_VERSION + 1 }, 4000)).toContain('recarga')
    })

    it('sin versión en el rechazo (o la misma) no hay nada que esperar', () => {
      expect(versionAction(7, undefined, null, null, now)).toBe('lost')
      expect(versionAction(7, 7, null, null, now)).toBe('lost')
    })
  })
})
