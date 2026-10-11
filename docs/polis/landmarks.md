# Landmarks de la Polis: de Blender al motor

Guía técnica para modelar, hornear y exportar los landmarks glTF de la Polis ([ADR-013 §5.5](../adr/0013-polis-agentic-world.md#55-assets-gltf-desde-blender-sin-romper-la-ciudad-declarada)). El motor no posiciona nada a mano: **lee los nombres de los nodos** y deduce colisionadores, sensores, puntos de aparición, luces, efectos y niveles de detalle. La ciudad decide dónde va cada landmark (`layoutCity`), así que cada asset se modela en su espacio local.

Código que aplica esta guía:

| Pieza | Fichero |
|---|---|
| Parser de convenciones (puro, con spec) | `apps/web/src/app/polis/domain/landmark-conventions.ts` |
| glTF → nodos en espacio del landmark | `apps/web/src/app/polis/presentation/engine/world/gltf/scene-nodes.ts` |
| Cargador (meshopt, materiales horneados, LOD, ocultación) | `apps/web/src/app/polis/presentation/engine/world/gltf/loader.ts` |
| Física: colisionadores y sensores en Rapier | `apps/web/src/app/polis/presentation/engine/physics/rapier.ts` |
| Landmarks publicados | `apps/web/public/assets/polis/landmarks/manifest.json` |

## 1. Escena

- **Unidades:** metros. ssanax mide 2,5 m; las columnas del ágora, de 3 a 4 veces eso.
- **Origen:** el centro de la isla, con el suelo pisable a `y = 0`. La fachada del landmark mira hacia **−Y de Blender** (+Z en glTF tras exportar con *+Y Up*): el motor gira ese eje hacia el ágora.
- **Un fichero por tipo de landmark:** `agora.glb`, `gnomon.glb`, `garden.glb`… (los valores de `Landmark` en `city-layout.ts`). La isla forma parte del asset: al cargarlo, el motor retira toda la geometría procedural de ese lugar.
- **Propiedades personalizadas de la escena** (Blender: *Scene Properties → Custom Properties*; se exportan como `extras` de la raíz):

  | Propiedad | Ejemplo | Obligatoria |
  |---|---|---|
  | `apeiron.landmark` | `"agora"` | Sí: debe coincidir con el nombre del fichero |
  | `apeiron.version` | `1` | Sí |
  | `apeiron.radius` | `11` | No: radio de la isla si difiere de la topología |

## 2. Convenciones de nombres

Prefijo opcional `node_` (`node_fixed_muro_box` ≡ `fixed_muro_box`). El sufijo `.001` que añade Blender a los duplicados se ignora.

| Nombre | Qué es | Qué hace el motor |
|---|---|---|
| `fixed_<id>_box` | Caja de colisión (malla simple, invisible) | Cuerpo rígido fijo con `cuboid` en Rapier; se oculta |
| `fixed_<id>_cyl` | Cilindro de colisión (invisible) | Cuerpo fijo con `cylinder` (radio = mayor semieje horizontal); se oculta |
| `fixed_<id>` | Geometría visible que además colisiona | Cuerpo fijo con `trimesh` exacto; **se ve**. Úsalo con mallas de pocos triángulos |
| `walk_<id>` | Suelo pisable (invisible) | Reservado para sustituir al círculo de la isla (hoy el suelo sigue siendo el de `isWalkable`) |
| `sensor_<id>` | Volumen de interacción (invisible) | Colisionador sensor en Rapier: `sensor_interact`, `sensor_tribune` |
| `spawn_host` / `spawn_visitor` / `spawn_seat_N` | Empty | Dónde espera el agente, por dónde llega ssanax, asientos del ágora (ordenados por N) |
| `light_lamp` / `light_core` | Empty | Linterna (emisivo + bloom) y núcleo de Ápeiron |
| `fx_smoke` / `fx_water` / `fx_fire` | Empty | Anclas de efectos |
| `<nombre>_lod0` / `_lod1` / `_lod2` | Niveles de detalle de una pieza | `THREE.LOD` con cambio a 35 m y a 70 m |
| Cualquier otro | Decoración | Se dibuja tal cual |

El parser **no adivina**: si algo está mal, el asset se rechaza con la lista de problemas y el lugar se queda con su versión procedural (aviso `landmark_fallback` en la consola). Rechaza, entre otros: falta de `extras`, landmark distinto del fichero, `fixed_*` sin malla, `trimesh` sin geometría, spawns desconocidos, nombres de sensor o spawn duplicados y LOD incompletos (`_lod0` y `_lod2` sin `_lod1`).

## 3. Luz y sombra horneadas

Objetivo: que la luz no cueste nada en tiempo real. Es la técnica de Bruno Simon: toda la iluminación estática (luna, linternas, oclusión ambiental y sombras de contacto) vive en una textura, y el material no calcula luz.

1. **Iluminación de bake = la del motor.** Un *Sun* frío (`#a9bdc4`, fuerza 2–3) con **elevación 24° y azimut −52°** (los de `MOON_ELEVATION`/`MOON_AZIMUTH` en `engine/atmosphere.ts`), un *World* muy oscuro (`#1a211e`, fuerza 0,3) y las linternas como **emisión** cálida (`#ffb35c`, fuerza 15–30). Sin luces puntuales de relleno: el claroscuro se hornea.
2. **UV:** el canal `UVMap` debe tener islas sin solapes (*Smart UV Project* o *Lightmap Pack*, margen 0,02). Para hornear, un canal y una imagen por landmark.
3. **Render:** Cycles, 256–512 muestras, *denoise* activado, *Filmic*/*AgX* desactivado al hornear (vista *Standard*): el tone mapping lo hace el motor.
4. **Bake:** tipo **Combined** con *Direct* + *Indirect* y *Diffuse* + *Emit* (sin *Glossy*), sobre una imagen de **1024 px** (2048 px el ágora), margen 8 px. La AO queda dentro del Combined; si se quiere más contacto, hornear **AO** aparte (distancia 1 m) y multiplicarla en el *Compositor* antes de guardar.
5. **Material final:** sustituir los materiales del objeto por **uno solo cuyo nombre empiece por `baked`** (`baked_agora`), con la imagen horneada como *Base Color*. El cargador lo convierte en `MeshBasicMaterial` con niebla: **cero cálculo de luz**, no proyecta ni recibe sombras en tiempo real (ya las trae).
6. **Lo que no se hornea:** piezas animadas o que cambian de color (núcleo, llamas, Faro) llevan un material normal (*Principled BSDF*); se exportan como `MeshStandardMaterial` y la oclusión del glTF (`occlusionTexture`) se respeta como `aoMap`. Su emisión cuenta para el bloom si supera el umbral (emisión > 1).
7. **Texturas:** sRGB, sin mipmaps propios, potencias de dos. Después de exportar: `gltf-transform resize --width 1024 --height 1024` y compresión (ver §4).

Con todo lo estático horneado, el coste de un landmark es su número de materiales (idealmente 1–2) y sus triángulos, no la luz. El presupuesto de rendimiento (ADR-013 §5.7) se verifica con `?perf`; **no se garantiza un número de FPS por encima del refresco de la pantalla** (60 Hz en la mayoría de equipos).

## 4. Exportar y publicar

1. *Apply modifiers*, unir las piezas por material, borrar caras ocultas, normales coherentes.
2. LOD: duplicar con *Decimate* al 50 % (`_lod1`) y al 20 % (`_lod2`).
3. *File → Export → glTF 2.0*: formato **glb**, *Selected objects*, *+Y Up*, *Apply Modifiers*, *Custom Properties* activado (lleva los `extras`), sin cámaras ni luces (se usan empties).
4. Optimizar:

   ```sh
   npx @gltf-transform/cli optimize agora.glb agora.opt.glb --compress meshopt --texture-compress webp
   ```

   (KTX2 llegará con el transcoder Basis en la subfase 5e; hasta entonces, WebP.)
5. Copiar a `apps/web/public/assets/polis/landmarks/agora.glb` y añadir `"agora"` a `manifest.json`. La ciudad solo pide los landmarks listados.
6. Comprobar en `/polis?perf&quality=high`: el lugar debe verse con su glTF, la consola sin `landmark_fallback` y el overlay dentro de presupuesto. Si declara `fixed_*` o `sensor_*`, la física pasa a Rapier (se descarga su WASM, unos 1,2 MB comprimidos, solo entonces).

## 5. Piezas: modelos dentro de un lugar procedural

Un landmark sustituye el lugar entero, isla incluida. Una **pieza** (`prop`) sustituye solo una parte y conserva la isla, el puente, las antorchas y el color del lugar. Sirve para modelos de terceros que no traen isla, o para uno que se repite en varios lugares ([ADR-013](../adr/0013-polis-agentic-world.md#piezas-gltf-santuarios-serpiente-y-agujero-negro-2026-10-11)).

| Pieza | Sustituye a | Hueco |
|---|---|---|
| `temple` | El peristilo de cada santuario de agente | Rectángulo `SANCTUARY.temple` (≈ 22 × 26 m), escalinata hacia el ágora |
| `serpent` | La bema del ágora | Círculo de `BEMA_RADIUS` (≈ 16 m de diámetro) |
| `black_hole` | Nada: se suma al cielo | Astro a 1,5 km de la cámara, sin niebla, con luz de estudio propia (`RoomEnvironment`); fuera en calidad baja |

**Contrato del asset:**

- Escena con `extras.apeiron = {"prop": "<nombre>", "version": 1}`. El nombre debe coincidir con el fichero.
- Suelo en y = 0 y frente hacia **+Z**. La escala y el centrado dan igual: `fitProp` ajusta la pieza a su hueco con escala uniforme.
- Niveles de detalle opcionales con nodos `<base>_lod0/_lod1/_lod2`, a 0, 60 y 120 m (`PROP_LOD_DISTANCES`).
- Materiales normales (`MeshStandardMaterial`), iluminados por la luna, las antorchas y la luz de los agentes. Una textura con la luz del día metida en el color se apaga antes de publicar.

**Publicar:** copiar el glb a `apps/web/public/assets/polis/props/` y añadir su nombre a `props/manifest.json`. Si la carga falla o los `extras` no cuadran, la consola avisa con `prop_fallback` y el hueco conserva su versión procedural. Verificar con `?perf`: los triángulos se cuentan con el pase de sombras.

**Pipeline usado con los modelos de Sketchfab** (glTF-Transform y meshoptimizer en Node; `@gltf-transform/functions` y `sharp` en procesos separados, porque cargan dos libvips y chocan):

1. **Geometría:** aplanar transformaciones (`flatten`, `clearNodeTransform`) y unir por material (`join`). Recortar lo que sobra por el centroide de cada triángulo (la explanada del escaneo del templo) y centrar con el suelo en y = 0 y el frente en +Z. Simplificar con `simplify` (`weld` antes) para el LOD cercano. Para el lejano, `simplifySloppy` de meshoptimizer ≥ 0.23: los escaneos y los anillos están llenos de costuras de UV que frenan al simplificador normal.
2. **Texturas** (con `sharp`): redimensionar a 2048 o 1024 px, apagar brillo y saturación si traen luz horneada y guardar en WebP. Quitar el emisivo que Sketchfab usa como «sin luz» (emisivo = color base).
3. **Empaquetar:** `extras` de la pieza y `meshopt` (nivel medio).

Un modelo con `KHR_materials_pbrSpecularGlossiness` (Sketchfab antiguo) se pasa antes a metal/rugosidad con `metalRough()`: three ya no carga esa extensión.

**Antes de simplificar, comparar.** Renderizar original y simplificado con la misma cámara y la misma luz. Con el agujero negro, hasta una simplificación conservadora dentaba los discos y la *sloppy* lo deformó: se publicó intacto.
