/** Los consejos de la pantalla de carga: cortos y con el tono de los textos de dificultad. Uno al azar cada vez. */
export const TIPS: readonly string[] = [
  'Las bayas no se recogen solas. Aún.',
  'Una fogata encendida es la mejor amiga que tendrás de noche.',
  'Los trasgos madrugan poco, pero trasnochan mucho.',
  'Un pico de piedra abre más puertas que una sonrisa.',
  'Si la luna se pone roja, no es por timidez.',
  'El mar está bonito. Lo que nada en él, no tanto.',
  'Un escudo a tiempo vale más que dos espadas.',
  'En compañía, las noches se hacen más cortas. Y los trasgos, más pocos.',
]

/** Un consejo al azar (`random` de 0 a 1, para las pruebas). */
export const pickTip = (random: number = Math.random()) => TIPS[Math.min(TIPS.length - 1, Math.floor(random * TIPS.length))]!
