import { describe, expect, it } from 'vitest'
import { BossWatch } from './bossWatch'

describe('avisos de jefe', () => {
  it('un día normal no dice nada', () => {
    expect(new BossWatch().update(2, null)).toEqual({ banner: null, tonight: null })
  })

  it('el día del jefe sale el cartel una vez y el aviso sigue hasta que llega', () => {
    const watch = new BossWatch()
    expect(watch.update(3, null)).toEqual({ banner: 'Esta noche: Trasgo gigante', tonight: 'Esta noche: Trasgo gigante' })
    expect(watch.update(3, null)).toEqual({ banner: null, tonight: 'Esta noche: Trasgo gigante' })
    expect(watch.update(3, 'giant')).toEqual({ banner: '¡Se acerca el Trasgo gigante!', tonight: null })
    expect(watch.update(3, 'giant')).toEqual({ banner: null, tonight: null })
    // Muerto ya no avisa de nada, aunque siga siendo su día.
    expect(watch.update(3, null)).toEqual({ banner: null, tonight: null })
  })

  it('si sigue vivo el anterior no anuncia otro', () => {
    const watch = new BossWatch()
    watch.update(3, 'giant')
    expect(watch.update(9, 'giant')).toEqual({ banner: null, tonight: null })
  })

  it('cada noche de jefe anuncia al suyo', () => {
    const watch = new BossWatch()
    expect(watch.update(6, null).banner).toBe('Esta noche: Lanzarrocas')
    expect(watch.update(6, 'thrower').banner).toBe('¡Se acerca el Lanzarrocas!')
  })

  it('una noche sin jefe no avisa, y tras reiniciar vuelve a empezar', () => {
    const watch = new BossWatch()
    expect(watch.update(4, null).tonight).toBeNull()
    watch.update(9, null)
    expect(watch.update(3, null).banner).toBe('Esta noche: Trasgo gigante')
  })
})
