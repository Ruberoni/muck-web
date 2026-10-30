import { describe, expect, it } from 'vitest'
import { BIOME_NOTICE_DELAY, BiomeNotice } from './biomeNotice'

describe('aviso de bioma', () => {
  it('el primero se avisa al momento y el mismo no se repite', () => {
    const notice = new BiomeNotice()
    expect(notice.update('meadow', 0.016)).toBe('meadow')
    expect(notice.update('meadow', 10)).toBeNull()
  })

  it('uno nuevo se avisa tras un rato dentro de él', () => {
    const notice = new BiomeNotice()
    notice.update('meadow', 0.016)
    expect(notice.update('forest', BIOME_NOTICE_DELAY - 0.1)).toBeNull()
    expect(notice.update('forest', 0.2)).toBe('forest')
    expect(notice.update('forest', 5)).toBeNull()
  })

  it('andando por la frontera no sale ningún aviso', () => {
    const notice = new BiomeNotice()
    notice.update('meadow', 0.016)
    for (let i = 0; i < 20; i++) {
      expect(notice.update('forest', BIOME_NOTICE_DELAY * 0.6)).toBeNull()
      expect(notice.update('meadow', 0.1)).toBeNull()
    }
  })
})
