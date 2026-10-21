# Diseño del juego

Plan de diseño para convertir muck-web en un juego propio inspirado en Muck: misma sensación de supervivencia
contrarreloj, pero con objetivos claros, combate con más fondo y un sistema de evolución de objetos.

Ver también: [arquitectura.md](arquitectura.md) (cómo organizar el código) y [hoja-de-ruta.md](hoja-de-ruta.md) (en qué orden hacerlo).

---

## 1. Qué tomamos de Muck y qué queremos mejorar

**Lo que funciona en Muck y conservamos**

- Ciclo día/noche donde la noche es peligrosa y cada noche es peor que la anterior.
- Partida corta tipo roguelike: si morís todos, se acaba la isla.
- Recolectar, fabricar y subir de tier (madera → piedra → metales).
- Cofres que se compran con oro y dan mejoras acumulables (el "gancho" de Muck).
- Cooperativo de 1 a 8 jugadores.

**Lo que suele fallar en Muck y queremos arreglar**

| Problema | Nuestra respuesta |
| --- | --- |
| Pasado el día 5, la partida se vuelve grind sin rumbo | Un **objetivo final con fecha límite** (la Noche Eterna, §3) y un tracker de objetivos del día |
| El combate es hacer clic sin parar | Esquiva, bloqueo, enemigos que avisan antes de atacar, armas con estilos distintos (§6) |
| Cuando ya eres fuerte, nada te presiona | La dificultad depende del **día**, no de tu poder: ir lento se castiga (§4) |
| Poca variedad de enemigos | Elenco por roles + variantes élite + jefes cada 3 noches (§7) |
| Las armas se tiran al subir de tier | **Evolución de objetos**: tu hacha crece contigo y conserva parte de la inversión (§5) |
| La base no sirve para nada | Estaciones que trabajan solas (horno) y enemigos que atacan estructuras (§8) |
| El final es poco épico | El final es un **evento de defensa** de varios minutos con todos los jugadores (§3) |

---

## 2. Bucle principal

```
DÍA  (≈ 4 min)                         NOCHE (≈ 2 min)
 ├─ recolectar (madera, piedra, menas)  ├─ oleadas que escalan con el día
 ├─ fabricar / fundir / evolucionar     ├─ menas nocturnas (plata lunar) → riesgo/recompensa
 ├─ explorar: cofres, santuarios        ├─ cada 3 noches: jefe
 └─ cazar un guardián (opcional/obligatorio para ganar)
                         ↓
              cada amanecer: +1 día, sube la dificultad,
              avanza la Plaga, se acerca la Noche Eterna
```

El día actual dura 6 min (`DAY_LENGTH = 360`, 65 % de día). Lo mantenemos: **10 días ≈ 60 min**, la duración
objetivo de una partida ganada.

---

## 3. Objetivo y presión de tiempo

### Objetivo: escapar de la isla

En la isla hay un **Faro antiguo** apagado. Para encenderlo hacen falta **4 Fragmentos**, cada uno custodiado
por un **Guardián** en un bioma distinto (bosque, montaña, pantano, volcán). Con los 4 fragmentos colocados
empieza el **evento final**: el faro tarda 3 min en cargar y durante ese tiempo llegan oleadas de todo el
elenco más el jefe final. Si el faro aguanta, ganáis.

### Fecha límite: la Noche Eterna

- Al amanecer del **día 12** el sol deja de salir: noche permanente, oleadas sin pausa y con el multiplicador
  de dificultad acelerado. No es una derrota instantánea, pero en la práctica sí lo es si no estáis preparados.
- El HUD muestra siempre **"Noche Eterna en N días"**. Saber la fecha límite es lo que crea la prisa.

### Otras fuentes de presión (todas ajustables)

| Mecánica | Por qué presiona |
| --- | --- |
| **La Plaga**: cada amanecer la corrupción avanza desde la costa hacia el centro. En zona corrupta los recursos no vuelven a crecer y los enemigos son élite | Obliga a recoger lo de la costa pronto y a avanzar hacia dentro |
| **Hambre** (ya existe) + **comida que se pudre**: la carne cruda se estropea en 1 día, la cocinada en 3, la ahumada nunca | No se puede acumular comida al principio y olvidarse |
| **Precio de los cofres sube con el día** (como en Muck) | Gastar el oro pronto rinde más |
| **Jefes en noches fijas** (3, 6, 9) anunciados con 1 día de antelación ("Luna roja mañana") | Fecha concreta para tener el siguiente tier |
| **Eventos con temporizador** (§9): meteorito, mercader errante | Decidir rápido si vale la pena desviarse |
| **Fundir lleva tiempo real** (horno) | Hay que planificar: dejar fundiendo mientras se recolecta |

### Ritmo ideal de una partida (para equilibrar)

| Día | Lo esperado al final del día | Noche |
| --- | --- | --- |
| 1 | Herramientas de piedra, fogata, banco de trabajo | 3 trasgos |
| 2 | Cobre + horno, primera arma de verdad, 1–2 cofres | más trasgos + arqueros |
| 3 | Hierro empezado | **Jefe 1** |
| 4–5 | Armadura de hierro, primera evolución, Guardián 1 | élites |
| 6 | Plata lunar (se mina de noche) | **Jefe 2** |
| 7–8 | Obsidiana, Guardianes 2–3 | |
| 9 | Guardián 4 | **Jefe 3** |
| 10 | Evento final del faro → victoria | |
| 11 | Margen para grupos lentos | |
| 12 | Noche Eterna | |

---

## 4. Dificultad

La dificultad depende del **día** y del **número de jugadores**, nunca del equipo que lleváis. Así, quien va
lento se queda atrás de verdad.

### Escalado por día (valores iniciales para probar)

```
vidaEnemigo  = base × (1 + 0.30 × (día − 1)) × (1 + 0.35 × (jugadores − 1))
dañoEnemigo  = base × (1 + 0.20 × (día − 1))
presupuesto  = 3 + 2 × (día − 1) + 2 × (jugadores − 1)     // "puntos" de enemigos por noche
```

El **presupuesto** sustituye al número fijo de enemigos actual (`ENEMY_BASE_COUNT`, `ENEMY_PER_NIGHT`):
cada tipo de enemigo cuesta puntos (trasgo 1, arquero 2, bruto 4…) y el **director** (ver arquitectura)
gasta el presupuesto eligiendo de la tabla de aparición del día.

Comprobación rápida con daño de armas (§6): un trasgo tiene 30 de vida el día 1 (2 golpes con espada de
piedra) y 111 el día 10 (2 golpes con obsidiana, 4 si seguís con hierro, y vendrán muchos más). Con equipo
del tier esperado cada enemigo cae en 2–3 golpes; un tier por detrás, el doble.

### Modos

| Modo | Vida/daño enemigo | Hambre | Noche Eterna | Muerte |
| --- | --- | --- | --- | --- |
| **Relajado** | ×0.6 | ×0.6 | desactivada | reaparecer al amanecer |
| **Normal** | ×1 | ×1 | día 12 | fantasma, se revive en el altar |
| **Brutal** | ×1.5, élites desde el día 2 | ×1.3 | día 10 | igual que normal; el altar cuesta el doble |

### Muerte en multijugador

- Al morir se queda como **fantasma** (puede mirar y marcar cosas en el mapa, no interactuar).
- Los compañeros lo reviven en el **Altar de las ánimas** (estructura fabricable) pagando oro, o reaparece solo
  al amanecer con el inventario en una tumba donde murió.
- La partida termina cuando están todos muertos a la vez.

---

## 5. Crafteo y evolución de objetos

Este es el sistema que más nos diferencia. Cuatro capas, de más simple a más profunda:

### 5.1 Tiers de material

| Tier | Material | Dónde | Necesita |
| --- | --- | --- | --- |
| 0 | Madera, piedra | todo el mapa | mano |
| 1 | Cobre (+ carbón) | rocas con vetas naranjas | pico de piedra, horno |
| 2 | Hierro | montaña | pico de cobre, horno |
| 3 | **Plata lunar** | vetas que **solo brillan y se pueden picar de noche** | pico de hierro, horno |
| 4 | Obsidiana | volcán / zona corrupta | pico de plata lunar, horno + fuelle |
| 5 | Fragmento de guardián | guardianes | — (solo para evoluciones finales y el faro) |

### 5.2 Estaciones

| Estación | Hace | Notas |
| --- | --- | --- |
| Mano (C) | herramientas básicas, fogata, banco | lo que hay ahora |
| **Banco de trabajo** | herramientas, armas y estructuras de tier 0–1 | primera estación, se fabrica el día 1 |
| **Horno** | funde menas en lingotes | **tarda tiempo real** (10 s por lingote) y gasta combustible; trabaja solo |
| **Yunque** | armas, armaduras, mejoras +1…+5 | |
| **Caldero** | comidas con buff, pociones | junto a una fogata |
| **Altar rúnico** | evoluciones de rama, infusiones de gemas, fusión de reliquias | tier 2+ |

Fabricar exige estar **cerca** de la estación (como en Muck). Esto da sentido a montar una base.

### 5.3 Mejora (+1 … +5)

En el yunque, un objeto sube de nivel gastando materiales **de su tier** (y algo de oro). Cada nivel:
+10 % daño o eficiencia. Sin probabilidad de fallo: el azar ya está en los cofres.

### 5.4 Evolución (subir de tier sin tirar el objeto)

Un objeto +N de tier T se convierte en su versión de tier T+1 **conservando ⌊N/2⌋ niveles**.

> Hacha de piedra +4 + 5 lingotes de cobre → **Hacha de cobre +2**

Así mejorar nunca es dinero tirado, y siempre hay que decidir: ¿sigo mejorando o evoluciono ya?

### 5.5 Ramas (especialización en tier 2)

Al evolucionar a hierro se elige **una rama permanente** que cambia cómo se juega con el objeto:

```
Hacha ─ madera ─ piedra ─ cobre ─┬─ Hacha de leñador   (+50 % madera; a +5 tala de un golpe)
                                 └─ Hacha de batalla   (+daño; golpe cargado en círculo)

Pico  ─ madera ─ piedra ─ cobre ─┬─ Pico de minero     (+1 mena por golpe; detecta vetas cercanas)
                                 └─ Pico de demoledor  (daño a estructuras/jefes de piedra ×2)

Espada ─ piedra ─ cobre ─────────┬─ Espada vampírica   (roba vida)
                                 └─ Espada de tormenta (cada 4º golpe encadena un rayo)

Arco  ─ corto ─ recurvo ─────────┬─ Arco múltiple      (3 flechas en abanico)
                                 └─ Ballesta           (atraviesa enemigos, recarga lenta)

Martillo ─ piedra ─ cobre ───────┬─ Martillo sísmico   (onda en área al saltar y golpear)
                                 └─ Martillo guardián  (al bloquear, devuelve daño)
```

Las ramas siguen evolucionando a plata lunar y obsidiana manteniendo su efecto (más fuerte).

### 5.6 Infusión de gemas

Las gemas salen de jefes, cofres raros y meteoritos. Se engarzan en el altar (1 hueco; 2 en obsidiana):

| Gema | Efecto en arma | Efecto en armadura |
| --- | --- | --- |
| Rubí | quemadura | resistencia al fuego (volcán) |
| Zafiro | ralentiza | inmune a congelación |
| Esmeralda | veneno | resistencia al veneno (pantano) |
| Topacio | rayo encadenado | +velocidad |
| Ónice | +daño a élites y jefes | −daño de élites |

### 5.7 Maestría por uso (opcional, fase tardía)

Cada objeto gana experiencia al usarlo. Con la maestría completa se desbloquea un **rasgo** extra
("Leñador incansable: talar no gasta stamina"). Da apego a tu hacha favorita.

### 5.8 Comida y cocina

```
Bayas ──caldero──► Mermelada        (+hambre, no se pudre)
Carne cruda ──fogata──► Carne asada ──caldero + bayas + seta──► Estofado (+regeneración 60 s)
Pescado ──fogata──► Pescado asado ──ahumadero──► Pescado ahumado (no se pudre)
Setas del pantano ──caldero──► Poción de resistencia (veneno)
```

Las comidas elaboradas dan **buffs temporales**: preparar comida antes del jefe es parte de la estrategia.

---

## 6. Combate

Hoy: clic con enfriamiento de 0,4 s, daño por número de golpes. Pasamos a **daño numérico** y estilos de arma:

| Arma | Ritmo | Alcance | Rasgo |
| --- | --- | --- | --- |
| Puños | rápido | corto | 5 de daño |
| Espada | medio | medio | combo de 3 golpes |
| Lanza | medio | largo | atraviesa en línea |
| Martillo | lento | medio | área + empuje fuerte |
| Arco | carga | lejos | gasta flechas |
| Hacha / pico | medio | medio | herramienta; daño de combate menor |

Daño base por tier (espada): madera 10 · piedra 15 · cobre 22 · hierro 32 · plata lunar 45 · obsidiana 65.

**Nuevas acciones del jugador**

- **Esquivar** (rodar, gasta stamina, unos frames invulnerable).
- **Bloquear** con el clic derecho si llevas escudo (reduce daño, gasta stamina). Comer pasa a una tecla propia.
- **Armadura**: casco, peto, botas. Reducción `armadura / (armadura + 100)`. Bonus de **set** al llevar las 3
  piezas del mismo material.

Los enemigos ya tienen un "windup" antes de atacar (`ENEMY_WINDUP`); lo hacemos visible (brillo, sonido) para
que esquivar sea una habilidad y no suerte.

---

## 7. Enemigos

### Por roles (para que cada noche se juegue distinto)

| Enemigo | Rol | Coste | Desde | Notas |
| --- | --- | --- | --- | --- |
| Trasgo (ya existe) | cuerpo a cuerpo | 1 | noche 1 | |
| Trasgo arquero | a distancia | 2 | noche 2 | obliga a cubrirse o cerrar distancia |
| Murciélago | rápido, poca vida | 1 | noche 2 | vuela, ignora el agua |
| Bruto | tanque | 4 | noche 3 | embiste con aviso claro |
| Zapador | ataca estructuras | 3 | noche 4 | explota junto a la fogata/horno |
| Chamán | apoyo | 4 | noche 5 | cura y acelera a los cercanos: prioridad |
| Fauna (jabalí, ciervo) | neutral de día | — | día 1 | carne y cuero; el jabalí embiste si le pegas |

### Élites (desde el día 4, o 2 en Brutal)

Un enemigo normal con un modificador visible: **Rápido**, **Blindado** (mitad de daño de frente),
**Explosivo** (explota al morir), **Vampírico**, **Gigante**. Sueltan más oro y a veces una gema.

### Jefes de noche (3, 6, 9)

| Noche | Jefe | Idea de pelea |
| --- | --- | --- |
| 3 | **Rey Trasgo** | grande, invoca trasgos, golpe en área telegrafiado |
| 6 | **Coloso de roca** | lento, lanza rocas, solo es vulnerable en el núcleo de la espalda |
| 9 | **Bruja de la niebla** | se teletransporta, crea zonas de niebla que esconden enemigos |
| Final | **El Devorador** | aparece en el evento del faro |

### Guardianes (uno por bioma, se buscan de día)

Cada uno con su mecánica y su fragmento: **Ent anciano** (bosque), **Gólem de hierro** (montaña),
**Hidra del pantano** (veneno), **Salamandra** (volcán, hace falta resistencia al fuego).

---

## 8. Mundo y base

- **Biomas**: pradera (inicio), bosque profundo, montaña, pantano, volcán. Cada uno con sus recursos, enemigos
  y guardián. El mapa actual (200 × 200) es pequeño para esto: subir a unos 400 × 400 con biomas por ruido.
- **Estructuras**: fogata (existe), estaciones, muros y puertas de madera/piedra, trampas de pinchos, torre de
  arquero (dispara sola con flechas que le dejas), cofre de almacenamiento compartido.
- Los **zapadores** atacan estructuras: una base tiene valor, pero también hay que defenderla.

---

## 9. Economía: oro, cofres y reliquias

- **Oro**: lo sueltan los enemigos (más los élites y jefes) y algunos cofres. **Por jugador**, pero se puede soltar
  al suelo para dárselo a otro.
- **Cofres** repartidos por el mapa: común (barato), raro, épico. **El precio sube con el día.**
- **Santuarios**: activarlo lanza una oleada de 60 s; si la sobrevives, das a elegir entre 3 reliquias.
- **Reliquias** (los "powerups" de Muck): mejoras pasivas acumulables, por rareza.
  - **Familias** (sangre, tormenta, viento, piedra…): 3 reliquias de la misma familia dan un bonus extra.
  - **Malditas**: cofres negros con una reliquia muy fuerte y un inconveniente ("+60 % daño, −30 % vida máxima").
  - **Fusión** en el altar: 3 comunes → 1 rara de tu elección. Reduce la frustración del azar.

Ejemplos de reliquias: Bota alada (+velocidad), Colmillo (robo de vida), Trébol (crítico), Bellota dorada
(+madera), Brasa (los golpes queman), Corazón de roble (+vida máxima), Pluma (doble salto), Reloj de arena
(+20 s de día).

---

## 10. Eventos (rompen la rutina y presionan)

| Evento | Cuándo | Qué pasa |
| --- | --- | --- |
| **Meteorito** | mediodía, aleatorio | cae lejos; 90 s para llegar antes de que lo rodeen enemigos; gemas y obsidiana |
| **Mercader errante** | día 3, 6, 9 | aparece 2 min en un punto del mapa; vende gemas y reliquias por oro |
| **Luna de sangre** | aleatorio desde el día 4 | presupuesto ×2, todos élites, doble oro |
| **Tormenta** | aleatorio | la lluvia apaga fogatas sin techo; rayos que caen cerca del metal |
| **Niebla** | días de pantano | visión reducida, los enemigos aparecen más cerca |
| **Cofre enterrado** | mapas del tesoro de cofres | ir a la X antes de que acabe el día |

---

## 11. Interfaz necesaria

- Menú de crafteo por estación y categoría, con tooltip de estadísticas y comparación con lo equipado.
- Inventario: hotbar de 9 + **mochila** (empieza en 9, se amplía con cuero).
- Pantalla del altar para evoluciones, ramas e infusiones (mostrando el árbol).
- **Tracker de objetivos**: "Noche Eterna en 6 días · Jefe mañana · Fragmentos 1/4".
- Barra de vida de jefes, indicador de amenaza de élites, marcas en el minimapa (meteoritos, mercader, guardianes).
- Pantalla de fin de partida con estadísticas (día alcanzado, daño, objetos evolucionados).

---

## 12. Progresión entre partidas (opcional, decidir más adelante)

Sin poder permanente (para no romper el equilibrio): desbloquear **reliquias nuevas** en el pool, **clases de
inicio** (Leñador empieza con hacha +1, Cazador con arco…) y cosméticos, mediante logros.

---

## 13. Decisiones abiertas

1. ¿Oro por jugador o compartido? (propuesta: por jugador, se puede soltar)
2. ¿Durabilidad de herramientas? (propuesta: **no**; la presión ya viene del tiempo)
3. ¿La muerte en solitario reinicia la isla (como ahora) o hay un intento de revivir?
4. ¿Tamaño del mapa y número de biomas en la primera versión? (propuesta: 3 biomas para el MVP)
5. ¿Cuántos días hasta la Noche Eterna? 12 es el punto de partida; se ajusta jugando.
6. Nombre del juego. Algunas ideas para empezar: *Noche Eterna*, *Última Luna*, *Isla Ceniza*, *Faro*,
   *Lodo*, *Ocaso*.
