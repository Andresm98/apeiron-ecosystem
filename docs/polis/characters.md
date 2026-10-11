# ssanax: el personaje del jugador

ssanax es el avatar del usuario en la Polis ([ADR-013](../adr/0013-polis-agentic-world.md#personaje-de-ssanax-subfase-5h)). Es un personaje **con esqueleto y animación**, no una figura estática. Viene en dos variantes que comparten la misma máquina de estados:

| Variante | Cuándo | Código |
|---|---|---|
| **glTF riggeado** (publicado desde 2026-10-11) | Si `apps/web/public/assets/polis/characters/manifest.json` lista `"ssanax"` | `engine/avatar/gltf-avatar.ts`: `AnimationMixer` con los clips del modelo |
| **Procedural** (respaldo) | Si no hay `ssanax.glb` publicado o falla su carga | `engine/avatar/character.ts`: `SkinnedMesh` de una pieza (un draw call) con 22 huesos |

El ssanax publicado es un guerrero de armadura negra con cristales verdes, pelo en punta y cola: malla generada con Supavoxel, limpiada y decimada (de 1,5 M a 40 k triángulos), riggeada en Mixamo y con los clips `Idle`, `Walk`, `Run` (*Fast Run* de Mixamo) y `Jump`. Pesa 2 MB (meshopt + WebP). Los cristales llevan una máscara emisiva sacada de su propia textura (`KHR_materials_emissive_strength` 0,6) para que se distinga de noche. El diseño que sigue describe el procedural.

## Diseño (procedural)

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

   `Jump` debe ser **solo el tramo en el aire** (del despegue al contacto), con la cadera a su altura de pie: la física del salto la pone el motor (0,7 s de vuelo) y el clip se reproduce según la fase del vuelo (despegue → cima → aterrizaje). Un `Jump` de Mixamo trae agacharse, vuelo y aterrizaje, y sube la cadera: hay que recortarlo y aplanarlo.

   **Zancada.** Si los pasos del modelo no miden lo mismo que los del rig procedural (2,02 m por ciclo al caminar), los pies patinan. El glb la declara en los `extras` de su escena, en alturas del modelo en reposo: `{"apeiron": {"stride": {"walk": 0.957, "run": 1.6}}}`. Es lo que la cadera avanza en un ciclo de `Walk` (de `Run`) **antes** de dejarlo en el sitio. Sin `run`, se corre con el ciclo de caminar.
4. **Exportar** glb con *Animation* activado, y optimizar con `npx @gltf-transform/cli optimize ssanax.glb ssanax.opt.glb --compress meshopt --texture-compress webp`.

   **Con Mixamo (como se hizo el actual):** Mixamo no acepta glb, así que se sube un `.zip` con OBJ, MTL y textura base. Primero se descarga el personaje sin animación aplicada (FBX Binary, T-pose; la malla va incluida); después, cada animación aplicada, *Without Skin*, a 30 fps. Si se olvida *In Place*, se corrige al unir: se resta la deriva lineal de la cadera y esa deriva es la zancada. Los FBX se pasan a glb con `FBX2glTF` y se unen con glTF-Transform: malla y esqueleto del personaje, pistas de cada clip por nombre de hueso. Ojo: en un mismo proceso de Node, `@gltf-transform/functions` y `sharp` cargan dos libvips y chocan; las texturas van en un paso aparte.
5. **Publicar:** copiarlo a `apps/web/public/assets/polis/characters/ssanax.glb` y añadir `"ssanax"` a `manifest.json`. Si falla la carga o faltan `Idle`/`Walk`, la consola avisa con `avatar_fallback` y se queda el procedural.

Limitaciones conocidas del ssanax actual: la cola no tiene huesos (va rígida con la cadera), no hay física secundaria (pelo, pañuelo) ni clips de gestos, así que los gestos no se ven.

Limitación conocida: en el glTF, los gestos se mezclan con el reposo por pesos del `AnimationMixer`, que promedia cuando los pesos suman más de 1. En el procedural, los gestos sustituyen al torso por completo.

## Catálogo de figuras: un aspecto por agente y por jugador

`characters/manifest.json` (v2) es el **catálogo de figuras** de la Polis. Cada figura tiene un `id` (el nombre de su `<id>.glb`), un tipo y un título visible:

```json
{ "version": 2, "characters": [
  { "id": "ssanax", "kind": "rigged", "title": "Guerrero de cristal" },
  { "id": "ssanax2", "kind": "rigged", "title": "Señor oscuro" },
  { "id": "philosopher", "kind": "statue", "title": "Estatua de mármol" }
] }
```

| Tipo | Qué es | Quién lo lleva |
|---|---|---|
| `rigged` | Personaje con esqueleto y clips (`Idle`, `Walk`; opcionales `Run`, `Jump` y gestos). Camina y corre con la máquina de estados de ssanax (`avatar/rigged-model.ts`) | ssanax (el jugador elige en la bienvenida, «Tu aspecto»; se recuerda en el navegador) y cualquier agente que lo declare |
| `statue` | Estatua viva: levita, respira, se ilumina y despierta al acercarse ssanax | Los agentes que lo declaran y, por defecto, los que no declaran nada (`philosopher`) |

**Un agente elige su figura en su manifiesto**, sin tocar código: `figure = "<id>"` en `[residence]`. Los cinco pensadores declaran `philosopher`. Una figura que no existe en el catálogo no rompe nada: el agente lleva la estatua por defecto y, sin catálogo, la figura de cono (`domain/figure-catalog.ts`, con spec). Un agente animado conserva todo lo suyo (color, halo, rótulo, saludo, atención) y lleva un **aura** de su color con la intensidad de la estatua: tenue en reposo, más fuerte al acercarse ssanax y latiendo al trabajar.

**Añadir una figura animada desde Mixamo** (como `ssanax2`): los FBX de Mixamo se pasan a glb con `FBX2glTF` y se unen con glTF-Transform:

1. Malla con esqueleto de `Idle.fbx` (descargado *With Skin*) y clips `Walking` → `Walk`, `Fast Run` → `Run`, `Jumping` → `Jump`, por nombre de hueso.
2. Un solo skin: FBX2glTF crea uno por malla con subconjuntos de huesos; se unifican (reasignando `JOINTS_0`) y las mallas se concatenan por material (`ssanax2`: de 12 draw calls a 5).
3. `Walk` y `Run` en el sitio (la deriva de la cadera es la zancada, `extras.apeiron.stride`) y desplazados para que el apoyo del pie izquierdo caiga al 25 %. `Jump`, solo el tramo en el aire (0,30–0,86 s en el `Jumping` de Mixamo).
4. Texturas DDS (three no las lee dentro de un glb): se decodifican con Pillow y se pasan a WebP. Si el alfa del color es brillo, sale de ahí la rugosidad; las luces saturadas, a una máscara emisiva.
5. Medir con three.js: fase de los pies, zancada y que el modelo mire a +Z. Publicar en `characters/` y añadir la entrada al manifiesto.

Ojo: la caja de una malla con esqueleto de varias primitivas recién clonada (`SkeletonUtils.clone`) sale disparatada; `RiggedModel` escala cada copia con la caja de la plantilla.

## Los ciudadanos: estatuas vivas

Los agentes no son personajes riggeados sino **estatuas de mármol que cobran vida** ([ADR-013](../adr/0013-polis-agentic-world.md#personaje-de-ssanax-subfase-5h)). Si `characters/manifest.json` lista `"philosopher"`, todos los ciudadanos usan `characters/philosopher.glb` en lugar de la figura de cono, que queda como respaldo (aviso `citizen_fallback` si falla la carga).

| Qué | Cómo |
|---|---|
| Modelo | «Asklepios» de noe-3d.at ([Sketchfab](https://sketchfab.com/3d-models/asklepios-3e87e2d771164cac96d4d3b12cec9e36), **CC BY-NC 4.0**; crédito visible en la ayuda «?»). Escaneo de 505 k triángulos: sin pedestal, decimado a 20 k, textura WebP de 1024 px; 470 KB |
| Tamaño | 3,2 m (ssanax mide 2,5): son estatuas, no personas. Un solo modelo cargado una vez y clonado por ciudadano |
| Identidad | Mármol teñido un 22 % con el color del agente. La luz propia usa la misma textura (`emissiveMap`) con un tono pálido mezclado con su color: de noche se lee el mármol, no una silueta |
| Movimiento | `domain/statue-motion.ts` (puro, con spec): en reposo respira (balanceo mínimo, desfasado por agente); al razonar flota y su luz late, más rápido si consulta una herramienta; al acudir al ágora **levita** inclinada en vez de caminar. Las transiciones son suaves (`approach`) |
| Recibir a ssanax | En su sitio y sin trabajar, la estatua **despierta** cuando ssanax se acerca (`attentionAt`: desde 18 m, del todo a 6 m): se eleva hasta 35 cm, su mármol se enciende con el color del agente y se vuelve hacia él sin saltos. A 16 m le **saluda** con un bocadillo (`domain/greeting.ts`): la primera vez, «Hola, *jugador*, bienvenido» y el epíteto de su manifiesto; las siguientes, un aforismo de la casa («Dudar es de sabios; creer, de ingenuos»). No repite hasta que ssanax se aleja más de 25,6 m, y nunca saluda en el ágora, de viaje ni trabajando |

Para cambiar la estatua: cualquier glb de una figura de pie, con la fachada hacia +Z y los pies en y = 0 (el motor la escala a 3,2 m). El script de preparación corta el pedestal por altura, decima y comprime con meshopt. Limitación: los cinco comparten la misma estatua; el paso siguiente es una por filósofo.
