# ssanax: el personaje del jugador

ssanax es el avatar del usuario en la Polis ([ADR-013](../adr/0013-polis-agentic-world.md#personaje-de-ssanax-subfase-5h)). Es un personaje **con esqueleto y animación**, no una figura estática. Viene en dos variantes que comparten la misma máquina de estados:

| Variante | Cuándo | Código |
|---|---|---|
| **Procedural** (por defecto) | Siempre que no haya un `ssanax.glb` publicado | `engine/avatar/character.ts`: `SkinnedMesh` de una pieza (un draw call) con 22 huesos |
| **glTF riggeado** | Si `apps/web/public/assets/polis/characters/manifest.json` lista `"ssanax"` | `engine/avatar/gltf-avatar.ts`: `AnimationMixer` con los clips del modelo |

## Diseño

Personaje estilizado propio: cabeza grande (unas 3,3 cabezas de alto, 2,5 m en el mundo), pelo castaño en punta, camisa de lino con mangas remangadas, pañuelo anudado, faja con lazo, pantalón ancho remangado, guantes sin dedos y botas. La paleta vive en la penumbra de la Polis. El único acento saturado es el **pañuelo color óxido** (`#b4532a`): marca al jugador, igual que el impermeable amarillo de *Little Nightmares*. Los colores están en `SSANAX_DESIGN`.

La hoja de referencia que inspiró el diseño es obra de un tercero. El personaje procedural **no la copia**: toma rasgos genéricos (proporciones, prendas). Para usar ese modelo exacto hace falta el fichero original con una licencia que lo permita (ADR-013: «nada con licencia dudosa»).

## Qué hace

| Comportamiento | Detalle |
|---|---|
| Locomoción | Reposo, caminar y correr mezclados por velocidad. La fase del ciclo avanza **con la distancia**, así que los pies no patinan. Inercia: acelera y frena (18 y 24 m/s²) y gira suave (11 rad/s), inclinándose en las curvas y al acelerar |
| Salto | Espacio o botón táctil: impulso, gravedad, piernas recogidas en el aire, poco control en el aire y aterrizaje con flexión y *squash* |
| Gestos (tren superior, sobre la locomoción) | Saluda al llegar, convoca con los brazos en alto al convocar, hace señas al invitar, se encoge de hombros al pasar turno, asiente cuando llega la síntesis. Atajos **1–5**: saludar, encogerse, señalar, convocar, asentir |
| Estados | En tu turno, **piensa** (mano en la barbilla). Mientras su bocadillo está a la vista, **gesticula** al hablar |
| Vida | Parpadeo, mirada hacia el agente que habla (o hacia el lugar señalado o cercano), idles variados tras 9 s quieto (mirar alrededor, estirarse) y respiración |
| Física secundaria | Muelles en el pelo, el pañuelo y la faja: se quedan atrás al correr y rebotan al frenar o aterrizar |
| Efectos | Polvo en cada pisada (según el pie y la velocidad) y al aterrizar; el farol cálido que lleva consigo; sombra de contacto que encoge al saltar |

Las reglas están en código puro con specs: `avatar/rig.ts` (esqueleto), `avatar/clips.ts` (poses), `avatar/animator.ts` (máquina de estados) y `avatar/gltf-clips.ts` (mapeo a clips glTF).

## Sustituirlo por un modelo riggeado (Blender o Mixamo)

1. **Modelo:** humanoide, de pie, mirando a **−Y en Blender** (+Z en glTF), en pose T o A. La escala da igual: el motor lo lleva a 2,5 m y lo apoya en el suelo.
2. **Esqueleto:** cualquiera (Mixamo, Rigify…). Para que los gestos se mezclen sobre la locomoción, los huesos de cadera y piernas deben llamarse con las palabras habituales: `Hips`, `UpLeg`, `Leg`, `Foot`, `Toe`, `Thigh`, `Shin`, `Calf`. Las pistas de esos huesos se quitan de los clips de gesto.
3. **Clips** (acciones de Blender o animaciones de Mixamo exportadas *without skin* y combinadas en un fichero). Nombres sin distinguir mayúsculas; vale el prefijo `Armature|`:

   | Clip | Obligatorio | Uso |
   |---|---|---|
   | `Idle`, `Walk` | **Sí** | Reposo y caminar (un ciclo de dos pasos, en el sitio: *in place*) |
   | `Run`, `Jump` | No | Correr (si falta, se usa Walk) y en el aire (si falta, Idle) |
   | `Wave`, `Talk`, `Think`, `Shrug`, `Point`, `Summon`, `Nod`, `Beckon`, `LookAround`, `Stretch` | No | Gestos; el que falte simplemente no se ve |

   Caminar y correr se sincronizan con la fase del animador: deben ser **ciclos en el sitio** que empiecen con las piernas cruzándose y la izquierda avanzando (apoyo del pie izquierdo al 25 % del clip y del derecho al 75 %).
4. **Exportar** glb con *Animation* activado, y optimizar con `npx @gltf-transform/cli optimize ssanax.glb ssanax.opt.glb --compress meshopt --texture-compress webp`.
5. **Publicar:** copiarlo a `apps/web/public/assets/polis/characters/ssanax.glb` y añadir `"ssanax"` a `manifest.json`. Si falla la carga o faltan `Idle`/`Walk`, la consola avisa con `avatar_fallback` y se queda el procedural.

Limitación conocida: en el glTF, los gestos se mezclan con el reposo por pesos del `AnimationMixer`, que promedia cuando los pesos suman más de 1. En el procedural, los gestos sustituyen al torso por completo.
