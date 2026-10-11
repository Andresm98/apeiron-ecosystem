import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { excerpt } from '../../../research/domain/dialogue';
import {
  PALETTE, PerfSample, Quality, QualityGovernor, RenderSettings, renderSettings,
} from '../../domain/atmosphere';
import {
  AGORA_ID, BEMA_RADIUS, HOME_ID, Place, agoraSeats, arrivalPoint, hostSpot, isWalkable, nearestPlace, toolPlaceId,
} from '../../domain/city-layout';
import { CitizenState, CoreState } from '../../domain/citizen-state';
import { HUMAN } from '../../domain/deliberation';
import { FigureInfo, citizenFigure, playerFigure, playerFigures } from '../../domain/figure-catalog';
import { GREET_M, GREET_RESET_M, greeting } from '../../domain/greeting';
import { Whereabouts, headingDeg, labelOpacity, moved } from '../../domain/hud';
import { PolisSignal } from '../../domain/signals';
import { attentionAt } from '../../domain/statue-motion';
import { Atmosphere, SPEAKER_LIGHTS, Speaker, moonDirection } from './atmosphere';
import { BlackHole } from './cosmos/black-hole';
import { energyClock } from './cosmos/energy';
import { Horizon } from './cosmos/horizon';
import { CosmicSky } from './cosmos/sky';
import { Stardust } from './cosmos/stardust';
import { Torches } from './cosmos/torches';
import { Vegetation } from './cosmos/vegetation';
import { Effects, dispose } from './effects';
import { Animator, RUN_SPEED, WALK_SPEED } from './avatar/animator';
import { Character, PlayerAvatar } from './avatar/character';
import { Gesture } from './avatar/clips';
import { Dust } from './avatar/dust';
import { GltfAvatar } from './avatar/gltf-avatar';
import { RiggedModel, loadFigureCatalog, loadRig } from './avatar/rigged-model';
import { Citizen, RIG_HEIGHT, loadStatue } from './figures';
import { PolisInput } from './input';
import { RapierPhysics } from './physics/rapier';
import { Walkable2D } from './physics/walkable-2d';
import { PlacedPlan, PolisPhysics } from './physics/walkable';
import { BuiltPlace, PlaceProps, buildBridge, buildPlace } from './places';
import { PostPipeline } from './post/post-pipeline';
import { batchStatic } from './world/batching';
import { availableLandmarks, loadLandmark } from './world/gltf/loader';
import { loadProps } from './world/gltf/props';

/** Lo que la Polis muestra de la ejecución: proyección pura del estado (ADR-013). */
export interface CitizenScene {
  states: Record<string, CitizenState>;
  core: CoreState;
  /** Convocados al ágora; vacío si la ejecución es una consulta en el lugar de un agente. */
  summoned: string[];
  /** La deliberación espera el turno de ssanax: su halo se enciende (ADR-013, fase 2). */
  myTurn?: boolean;
}

export type BeaconHealth = 'ok' | 'degraded' | 'down' | null;

// Emisivos por encima del umbral del bloom: en la penumbra, la luz es información.
const BEACON_LOOK: Record<'ok' | 'degraded' | 'down' | 'none', { color: string; intensity: number }> = {
  ok: { color: PALETTE.ok, intensity: 2.4 },
  degraded: { color: PALETTE.warn, intensity: 2.4 },
  down: { color: PALETTE.danger, intensity: 2.8 },
  none: { color: '#555555', intensity: 0.1 },
};

const CORE_LOOK: Record<CoreState, { color: string; intensity: number }> = {
  idle: { color: PALETTE.logos, intensity: 0.5 },
  routing: { color: '#ffd166', intensity: 2.4 },
  supervising: { color: '#ffd166', intensity: 1.6 },
  synthesizing: { color: '#fff1a8', intensity: 3.4 },
  done: { color: PALETTE.ok, intensity: 1.2 },
  error: { color: PALETTE.danger, intensity: 2 },
};

export interface WorldEvents {
  near(placeId: string | null): void;
  hover(placeId: string | null): void;
  select(placeId: string): void;
  map(): void;
  escape(): void;
  /** Posición y rumbo de ssanax para el minimapa: como mucho 10 veces por segundo y solo si cambian. */
  position(where: Whereabouts): void;
  /** El regulador bajó el nivel de calidad (evento discreto). */
  quality?(level: Quality): void;
  /** Medición para el overlay `?perf` (cada 0,5 s, solo si se pidió). */
  perf?(sample: PerfSample): void;
}

export interface WorldOptions {
  /** Introducción de cámara: de la vista aérea a ssanax (se interrumpe al primer gesto). */
  intro?: boolean;
  quality?: Quality;
  /** El regulador puede bajar el nivel solo (no si el usuario o la URL lo fijaron). */
  autoQuality?: boolean;
  reducedMotion?: boolean;
  perf?: boolean;
  /** Figura elegida por el jugador (`characters/manifest.json`); si no está publicada, la de por defecto. */
  figure?: string | null;
}

// Movimiento de ssanax (m/s, m/s²): caminar y correr con inercia, salto con gravedad y poco control en el aire.
const MOVE_WALK = WALK_SPEED * 1.1;
const MOVE_RUN = RUN_SPEED * 1.3; // a escala monumental se cruza la ciudad corriendo
const ACCEL = 18;
const DECEL = 24;
const AIR_CONTROL = 0.35;
const TURN_SPEED = 11; // rad/s
const JUMP_SPEED = 7;
const GRAVITY = 20;
/** Gestos de los atajos 1–5 (y del botón táctil de saludo). */
export const EMOTES: Gesture[] = ['wave', 'shrug', 'point', 'summon', 'nod'];
const POSITION_EVERY_S = 0.1; // ≤ 10 Hz hacia Angular (ADR-013 §5.7)
const PERF_EVERY_S = 0.5;
const INTRO_S = 2.6;
const INTRO_FROM = { pitch: 0.95, distance: 260 }; // vista aérea de la ciudad entera
const BUBBLE_MIN_S = 6;
const BUBBLE_MAX_S = 14;
/** Diorama: FOV cerrado, cámara baja y cercana para sentir la escala (ADR-013 §5.1). */
const FOV = 42;
const PITCH = 0.2; // casi horizontal: columnas de 22 m y el cielo entran en el encuadre
/** Inclinación mínima: por debajo de 0 la cámara mira hacia arriba (el cielo, el agujero negro, los templos). */
const MIN_PITCH = -0.35;
/** La cámara nunca baja de esta altura sobre el suelo de las islas, mire hacia donde mire. */
const CAMERA_MIN_Y = 0.6;
/** Altura a la que mira la cámara: un poco por encima de la cabeza de ssanax. */
const HEAD_Y = 2.6;

/** Mirar hacia arriba baja la cámara: el límite depende del zoom para que no se hunda en la isla. */
function lowestPitch(distance: number, targetY: number): number {
  return Math.max(MIN_PITCH, Math.asin(THREE.MathUtils.clamp((CAMERA_MIN_Y - targetY) / distance, -1, 1)));
}
const DISTANCE = 15;
const OCCLUDED_OPACITY = 0.22;
/** A menos de esta distancia de la cámara, lo que tapa a ssanax se oculta del todo. */
const OCCLUDER_HIDE_M = 2.5;

interface Bubble { label: CSS2DObject; until: number; }

/**
 * Motor de la Polis. Vive fuera del ciclo de Angular: recibe estado y señales y devuelve eventos de interacción.
 * Nunca decide nada sobre la ejecución; solo la representa (ADR-013).
 */
export class PolisWorld {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 3000);
  private readonly clock = new THREE.Clock();
  private readonly input: PolisInput;
  private readonly effects: Effects;
  private readonly atmosphere: Atmosphere;
  private readonly post: PostPipeline;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resize: ResizeObserver;
  private readonly governor: QualityGovernor;
  private physics: PolisPhysics;

  private places: Place[] = [];
  private city = new THREE.Group();
  private built = new Map<string, BuiltPlace>();
  private placeLabels = new Map<string, CSS2DObject>();
  private citizens = new Map<string, Citizen>();
  private ssanax: PlayerAvatar;
  private readonly animator = new Animator();
  private readonly dust = new Dust();
  private readonly velocity = new THREE.Vector3();
  private vy = 0;
  private grounded = true;
  private jumpQueued = false;
  private facing = 0;
  private yawRate = 0;
  private talkingUntil = 0;
  private attention: { at: () => THREE.Vector3; until: number } | null = null;
  private greeted = false;
  private readonly playerName: string;
  private readonly sky: CosmicSky;
  private stardust: Stardust;
  private horizon: Horizon;
  private torches: Torches | null = null;
  private vegetation: Vegetation | null = null;
  private obstacles: { x: number; z: number; r: number }[] = [];
  /** Piezas glTF que sustituyen partes procedurales (templo, serpiente); vacío hasta que cargan. */
  private props: PlaceProps = {};
  private blackHole: BlackHole | null = null;
  private labelOf: (agent: string) => string = (agent) => agent;
  /** Catálogo de figuras (una petición por mundo) y la que lleva ssanax. */
  private figureCatalog: Promise<FigureInfo[]> | null = null;
  private playerFigureId: string | null = null;
  private wornFigure: string | null = null;
  private disposed = false;

  private quality: Quality;
  private settings: RenderSettings;
  private focusLocked = false;
  private readonly reducedMotion: boolean;
  private readonly perfEnabled: boolean;
  private cityVersion = 0;

  private yaw = 0;
  private pitch = PITCH;
  private distance = DISTANCE;
  private frame = 0;
  private frames = 0;
  private near: string | null = null;
  private hovered: string | null = null;
  private hoverTick = 0;
  private pointer: { x: number; y: number } | null = null;
  private lastScene: CitizenScene = { states: {}, core: 'idle', summoned: [] };
  private health: BeaconHealth = null;
  private myTurn = false;
  /** Progreso de la introducción de cámara en [0, 1]; 1 = cámara normal. */
  private intro = 1;
  private sinceSent = 0;
  private sincePerf = 0;
  private perfFrames = 0;
  private sent: Whereabouts | null = null;
  private readonly bubbles = new Map<THREE.Object3D, Bubble>();
  /** Saludos de los pensadores: cuántos ha hecho cada uno y si ssanax sigue a su alcance (no repite hasta que se aleje). */
  private readonly welcomes = new Map<string, { visits: number; inside: boolean }>();
  private readonly faded = new Set<THREE.Mesh>();

  constructor(
    private readonly host: HTMLElement,
    private readonly events: WorldEvents,
    playerName: string,
    options: WorldOptions = {},
  ) {
    this.intro = options.intro ? 0 : 1;
    this.playerFigureId = options.figure ?? null;
    this.playerName = playerName;
    this.quality = options.quality ?? 'medium';
    this.reducedMotion = !!options.reducedMotion;
    this.perfEnabled = !!options.perf;
    this.governor = new QualityGovernor(this.quality, options.autoQuality ?? true);
    this.settings = renderSettings(this.quality, this.context());

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false; // el composer renderiza varias veces por fotograma: se mide el total
    this.renderer.domElement.className = 'polis-canvas';
    this.labels.domElement.className = 'polis-labels';
    host.append(this.renderer.domElement, this.labels.domElement);

    this.atmosphere = new Atmosphere(this.scene);
    this.post = new PostPipeline(this.renderer, this.scene, this.camera);
    this.physics = this.ground();

    // Capa 0 y volumen: cielo cósmico, polvo estelar y ruinas del horizonte (las islas flotan sobre el abismo).
    this.sky = new CosmicSky(moonDirection());
    this.stardust = new Stardust(this.settings.stardust);
    this.horizon = new Horizon(this.settings.horizonRuins);
    this.scene.add(this.sky.group, this.stardust.points, this.horizon.group, this.city);
    void this.loadProps();

    // ssanax: personaje con esqueleto y animación (procedural; un `ssanax.glb` riggeado lo sustituye si existe).
    this.ssanax = new Character(playerName);
    this.decoratePlayer();
    this.scene.add(this.ssanax.root, this.dust.mesh);
    void this.upgradeAvatar();

    this.effects = new Effects(this.scene);
    this.input = new PolisInput(this.renderer.domElement, {
      look: (dx, dy) => {
        this.yaw -= dx * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, lowestPitch(this.distance, HEAD_Y), 1.25);
      },
      zoom: (delta) => (this.distance = THREE.MathUtils.clamp(this.distance + delta * 3, 6, 80)),
      tap: (x, y) => {
        const id = this.pick(x, y);
        if (id) this.events.select(id);
      },
      hover: (x, y) => (this.pointer = { x, y }),
      key: (key) => {
        if (key === 'interact' && this.near) this.events.select(this.near);
        if (key === 'map') this.events.map();
        if (key === 'escape') this.events.escape();
        if (key === 'jump') this.jump();
      },
      emote: (index) => {
        const name = EMOTES[index];
        if (name) this.gesture(name);
      },
    });

    this.applySettings();
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();
    this.frame = requestAnimationFrame(this.loop);
  }

  /** Construye (o reconstruye) la ciudad para una topología. */
  setCity(places: Place[], labelOf: (agent: string) => string = (agent) => agent): void {
    this.clearCity();
    this.places = places;
    this.labelOf = labelOf;
    const version = ++this.cityVersion;
    const agora = places.find((p) => p.id === AGORA_ID);
    const bridges = new THREE.Group();
    for (const place of places) {
      const built = buildPlace(place, this.props);
      this.built.set(place.id, built);
      this.city.add(built.group);
      if (agora && place.kind !== 'agora') bridges.add(buildBridge(place, agora.radius));
      const tag = document.createElement('div');
      tag.className = `polis-place polis-place-${place.kind}`;
      tag.textContent = place.title;
      const label = new CSS2DObject(tag);
      label.position.set(place.x, built.labelHeight, place.z);
      this.placeLabels.set(place.id, label);
      this.city.add(label);
      if (place.agent) {
        const citizen = new Citizen(place.agent, labelOf(place.agent), place.color, this.homeSpot(place), place.kind === 'foreign');
        citizen.figure.root.traverse((o) => (o.userData['placeId'] = place.id));
        this.citizens.set(place.agent, citizen);
        this.scene.add(citizen.figure.root);
      }
    }
    batchStatic(bridges); // todos los puentes, un draw call
    this.city.add(bridges);
    this.atmosphere.setCity(places);
    // Arquitectura: obstáculos para caminar, antorchas y vegetación en el borde de las islas.
    this.obstacles = [...this.built.values()].flatMap((b) => b.obstacles);
    this.torches = new Torches([...this.built.values()].flatMap((b) => b.torches));
    this.vegetation = new Vegetation(places, this.settings.vegetation, (x, z) =>
      this.obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 2) || !isWalkable(places, x, z));
    this.city.add(this.torches.group, this.vegetation.group);
    const pos = this.ssanax.root.position;
    if (!isWalkable(places, pos.x, pos.z) || pos.lengthSq() === 0) this.travel(HOME_ID, true);
    this.setScene(this.lastScene);
    this.setBeacon(this.health);
    this.aimBlackHole();
    void this.upgradeLandmarks(version);
    void this.upgradeCitizens(version);
  }

  /** Color del Faro según la salud global del sistema; apagado si no hay datos. */
  setBeacon(health: BeaconHealth): void {
    this.health = health;
    const look = BEACON_LOOK[health ?? 'none'];
    for (const built of this.built.values()) {
      if (!built.lamp) continue;
      built.lamp.material.color.set(look.color);
      built.lamp.material.emissive.set(look.color);
      built.lamp.material.emissiveIntensity = look.intensity;
    }
  }

  /** Aplica el estado de la ejecución: estados, núcleo de Ápeiron y quién acude al ágora. */
  setScene(view: CitizenScene): void {
    this.lastScene = view;
    this.myTurn = !!view.myTurn;
    this.ssanax.halo.material.color.set(this.myTurn ? PALETTE.logos : PALETTE.cloth);
    this.ssanax.halo.material.opacity = this.myTurn ? 0.9 : 0.3;
    this.ssanax.label.element.classList.toggle('polis-citizen-turn', this.myTurn);
    const seats = agoraSeats(view.summoned);
    for (const [name, citizen] of this.citizens) {
      const state = view.states[name] ?? 'idle';
      citizen.setState(state);
      const seat = seats[name];
      const place = this.places.find((p) => p.agent === name);
      if (seat) {
        const speaking = state === 'working' || state === 'using_tool';
        const k = speaking ? (BEMA_RADIUS + 1.6) / Math.max(Math.hypot(seat.x, seat.z), 0.01) : 1; // al borde de la bema
        citizen.goTo(new THREE.Vector3(seat.x * k, 0, seat.z * k));
      } else if (place) {
        citizen.goTo(this.homeSpot(place));
      }
    }
    const core = this.built.get(AGORA_ID)?.core;
    if (core) {
      const look = CORE_LOOK[view.core];
      core.material.emissive.set(look.color);
      core.material.emissiveIntensity = look.intensity;
    }
  }

  /** Dibuja señales nuevas de la ejecución. */
  emit(signals: PolisSignal[]): void {
    const corePos = () => (this.built.get(AGORA_ID)?.core?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 5, 0));
    // `human` es ssanax: los haces de réplica también llegan hasta el usuario.
    const at = (agent: string) => () =>
      agent === HUMAN ? this.ssanax.root.position : (this.citizens.get(agent)?.position ?? corePos());
    const known = (agent: string) => agent === HUMAN || this.citizens.has(agent);
    for (const s of signals) {
      if (s.kind === 'control' && this.citizens.has(s.to)) this.effects.pulse(corePos, at(s.to));
      if (s.kind === 'reply' && known(s.from) && known(s.to)) this.effects.reply(at(s.from), at(s.to));
      if (s.kind === 'tool' && this.citizens.has(s.agent)) {
        const building = this.built.get(toolPlaceId(s.tool) ?? '')?.group.position;
        if (building) this.effects.messenger(at(s.agent), building, s.error);
      }
      if (s.kind === 'guard') this.effects.flash(s.agent === 'apeiron' ? corePos : at(s.agent));
      if (s.kind === 'speech') {
        const seconds = this.say(s.agent, s.text);
        const now = this.clock.elapsedTime;
        // ssanax gesticula mientras su bocadillo está a la vista; si habla otro, lo mira.
        if (s.agent === HUMAN) this.talkingUntil = now + seconds;
        else if (this.citizens.has(s.agent)) {
          const citizen = this.citizens.get(s.agent)!;
          this.attention = { at: () => citizen.position.clone().setY(1.9), until: now + seconds };
        }
      }
    }
  }

  /** Gesto de ssanax (saludar, encogerse, señalar, convocar, asentir…); solo mueve el tren superior. */
  gesture(name: Gesture): void {
    this.animator.play(name);
  }

  /** Salto (Espacio o botón táctil); se ignora en el aire. */
  jump(): void {
    this.jumpQueued = true;
  }

  /** Bocadillo sobre quien habla con un extracto del turno; devuelve cuántos segundos estará a la vista. */
  say(agent: string, text: string): number {
    const figure = agent === HUMAN ? this.ssanax : this.citizens.get(agent)?.figure;
    if (!figure) return 0;
    this.dropBubble(figure.root);
    const el = document.createElement('div');
    el.className = 'polis-bubble';
    el.textContent = excerpt(text, 110);
    const label = new CSS2DObject(el);
    label.position.y = 4.1;
    label.center.set(0.5, 1);
    figure.root.add(label);
    const seconds = Math.min(BUBBLE_MAX_S, Math.max(BUBBLE_MIN_S, el.textContent.length * 0.08));
    this.bubbles.set(figure.root, { label, until: this.clock.elapsedTime + seconds });
    return seconds;
  }

  /** Vector del joystick visible del HUD (solo con puntero grueso). */
  stick(x: number, y: number): void {
    this.input.setStick(x, y);
  }

  /** Termina la introducción de cámara (p. ej. al cerrar el onboarding con prisa). */
  skipIntro(): void {
    this.intro = 1;
  }

  /** Lleva a ssanax al borde de un lugar, mirando hacia él. */
  travel(placeId: string, instant = false): void {
    const place = this.places.find((p) => p.id === placeId);
    if (!place) return;
    const arrival = arrivalPoint(place);
    this.ssanax.root.position.set(arrival.x, 0, arrival.z);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    const dx = (place.id === HOME_ID ? 0 : place.x) - arrival.x;
    const dz = (place.id === HOME_ID ? 0 : place.z) - arrival.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.facing = Math.atan2(dx, dz); // de cara al lugar
    this.ssanax.root.rotation.y = this.facing;
    if (instant) this.placeCamera(1);
  }

  /** Nivel elegido por el usuario: se respeta (el regulador mide de cero desde aquí). */
  setQuality(quality: Quality): void {
    this.quality = quality;
    this.governor.reset(quality);
    this.applySettings();
  }

  /**
   * Hay una deliberación, un diálogo o es tu turno: sin profundidad de campo, la escena tiene que leerse entera
   * (principio 7 del ADR-013: la atmósfera nunca oculta estados ni bocadillos).
   */
  setFocusLock(locked: boolean): void {
    if (locked === this.focusLocked) return;
    this.focusLocked = locked;
    this.applySettings();
  }

  dispose(): void {
    this.disposed = true;
    this.cityVersion += 1; // las cargas de glTF en vuelo ya no tocan la escena
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.input.dispose();
    this.effects.clear();
    this.ssanax.dispose();
    this.dust.dispose();
    this.clearCity();
    this.physics.dispose();
    this.post.dispose();
    this.atmosphere.dispose();
    this.sky.dispose();
    this.blackHole?.dispose();
    this.stardust.dispose();
    this.horizon.dispose();
    dispose(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  private readonly loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.frames += 1;
    this.renderer.info.reset();
    this.moveSsanax(dt, t);
    if (this.intro < 1) {
      this.intro = this.input.active() ? 1 : Math.min(1, this.intro + dt / INTRO_S);
      if (this.intro === 1 && !this.greeted) {
        this.greeted = true;
        this.animator.play('wave'); // al terminar la presentación, ssanax saluda
      }
    }
    this.animatePlayer(dt, t);
    this.placeCamera(this.intro < 1 || this.reducedMotion ? 1 : 1 - Math.pow(0.0015, dt));
    this.sinceSent += dt;
    if (this.sinceSent >= POSITION_EVERY_S) this.sendPosition();
    this.expireBubbles(t);
    for (const built of this.built.values()) built.animate?.(t);
    const focus = new THREE.Vector3(0, 0, 0);
    this.receiveVisitor();
    for (const citizen of this.citizens.values()) citizen.update(dt, t, focus);
    this.effects.update(dt);
    energyClock.value = t;
    this.sky.update(dt, t, this.camera);
    this.blackHole?.update(this.camera);
    this.stardust.update(t, this.camera, this.renderer.getPixelRatio());
    this.horizon.update(dt);
    this.torches?.update(t);
    this.atmosphere.follow(this.ssanax.root.position);
    this.atmosphere.update(t);
    this.atmosphere.setSpeakers(this.speakers());
    this.post.focus(this.ssanax.root.position.clone().setY(1.6));
    if (this.frames % 6 === 0) this.updateOcclusion();
    this.updateLabels();
    if (this.pointer) this.hover(this.pointer);
    this.post.render(dt);
    this.labels.render(this.scene, this.camera);
    this.measure(dt);
  };

  private context() {
    return { focusLocked: this.focusLocked, reducedMotion: this.reducedMotion };
  }

  private applySettings(): void {
    this.settings = renderSettings(this.quality, this.context());
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.pixelRatioMax));
    this.atmosphere.apply(this.settings, this.renderer);
    this.post.configure(this.settings);
    if (this.blackHole) this.blackHole.group.visible = this.settings.blackHole;
    this.rebuildVolume();
    this.fit();
  }

  /** Regulador de calidad y overlay `?perf`. Solo eventos discretos hacia Angular. */
  private measure(dt: number): void {
    const lower = this.governor.sample(dt * 1000);
    if (lower) {
      this.quality = lower;
      this.applySettings();
      this.events.quality?.(lower);
    }
    if (!this.perfEnabled) return;
    this.sincePerf += dt;
    this.perfFrames += 1;
    if (this.sincePerf < PERF_EVERY_S) return;
    const info = this.renderer.info;
    this.events.perf?.({
      fps: Math.round(this.perfFrames / this.sincePerf),
      frameMs: Math.round((this.sincePerf / this.perfFrames) * 10000) / 10,
      calls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      quality: this.quality,
    });
    this.sincePerf = 0;
    this.perfFrames = 0;
  }

  /**
   * Luces dinámicas (como mucho 4): el farol de ssanax, siempre encendido —la única luz cálida que te acompaña en la
   * penumbra; se aviva en tu turno— y la de cada agente que razona o consulta, con su color pleno.
   */
  private speakers(): Speaker[] {
    // El farol va un poco por delante, del lado de la cámara: ilumina la cara de ssanax que ve el jugador.
    const me = this.ssanax.root.position;
    const toward = new THREE.Vector3(this.camera.position.x - me.x, 0, this.camera.position.z - me.z).setLength(1.1);
    const list: Speaker[] = [{
      position: me.clone().add(toward), color: PALETTE.lamp, intensity: this.myTurn ? 30 : 10, height: this.myTurn ? 3.2 : 1.9,
    }];
    for (const citizen of this.citizens.values()) {
      if (list.length >= SPEAKER_LIGHTS) break;
      if (citizen.state === 'working' || citizen.state === 'using_tool') {
        list.push({ position: citizen.position, color: citizen.color, intensity: 28 });
      }
    }
    return list;
  }

  /** Movimiento con inercia: el joystick o las teclas piden una velocidad y el cuerpo acelera o frena hacia ella. */
  private moveSsanax(dt: number, t: number): void {
    const { x, y, sprint } = this.input.direction();
    const pos = this.ssanax.root.position;
    const wish = new THREE.Vector3();
    if (x !== 0 || y !== 0) {
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      wish.addScaledVector(forward, y).addScaledVector(right, x);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(sprint ? MOVE_RUN : MOVE_WALK);
    }
    const diff = wish.clone().sub(this.velocity);
    const rate = (wish.lengthSq() >= this.velocity.lengthSq() ? ACCEL : DECEL) * (this.grounded ? 1 : AIR_CONTROL);
    if (diff.length() > rate * dt) diff.setLength(rate * dt);
    this.velocity.add(diff);

    if (this.velocity.lengthSq() > 1e-4) {
      const next = this.physics.move({ x: pos.x, z: pos.z }, { x: this.velocity.x * dt, z: this.velocity.z * dt });
      // Si choca o desliza por un borde, la velocidad es la que de verdad hubo (no empuja contra la pared).
      this.velocity.set((next.x - pos.x) / dt, 0, (next.z - pos.z) / dt);
      pos.x = next.x;
      pos.z = next.z;
    } else {
      this.velocity.set(0, 0, 0);
    }

    // Giro suave hacia donde va, con su velocidad angular (la usa la inclinación en las curvas).
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const before = this.facing;
    if (speed > 0.3) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      const delta = Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing));
      this.facing += THREE.MathUtils.clamp(delta, -TURN_SPEED * dt, TURN_SPEED * dt);
    }
    this.yawRate = dt > 0 ? (this.facing - before) / dt : 0;
    this.ssanax.root.rotation.y = this.facing;

    // Salto: impulso, gravedad y aterrizaje en el suelo de las islas (y = 0).
    if (this.jumpQueued && this.grounded) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
    }
    this.jumpQueued = false;
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      pos.y += this.vy * dt;
      if (pos.y <= 0) {
        pos.y = 0;
        this.grounded = true;
      }
    }

    this.ssanax.halo.scale.setScalar(this.myTurn ? 1 + Math.sin(t * 5) * 0.2 : 1);
    const near = nearestPlace(this.places, pos.x, pos.z)?.id ?? null;
    if (near !== this.near) {
      this.near = near;
      this.events.near(near);
    }
  }

  /** Animación de ssanax: máquina de estados + mirada + polvo de pisadas y aterrizajes. */
  private animatePlayer(dt: number, t: number): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const frame = this.animator.update({
      dt, speed, grounded: this.grounded, vy: this.vy,
      thinking: this.myTurn, talking: t < this.talkingUntil,
    });
    const pos = this.ssanax.root.position;
    for (const e of frame.events) {
      if (e.kind === 'step') {
        // El polvo sale del pie que apoya (a un lado del centro).
        const side = (e.foot === 'L' ? 1 : -1) * 0.12;
        const at = pos.clone().add(new THREE.Vector3(Math.cos(this.facing) * side, 0, -Math.sin(this.facing) * side));
        this.dust.emit(at, e.strength * 0.5, 2);
      } else {
        this.dust.emit(pos, e.impact, 6);
      }
    }
    this.dust.update(dt);
    this.ssanax.apply(frame, { dt, t, velocity: new THREE.Vector3(this.velocity.x, this.vy, this.velocity.z), yawRate: this.yawRate, look: this.lookTarget(t) });
  }

  /** A quién mira ssanax: al que habla; si no, al lugar señalado o al que tiene delante. */
  private lookTarget(t: number): THREE.Vector3 | null {
    if (this.attention && t < this.attention.until) return this.attention.at();
    this.attention = null;
    const id = this.hovered ?? this.near;
    const place = id ? this.places.find((p) => p.id === id) : null;
    return place ? new THREE.Vector3(place.x, 2.2, place.z) : null;
  }

  private decoratePlayer(): void {
    this.ssanax.label.element.classList.add('polis-citizen-self');
    this.ssanax.halo.material.color.set(PALETTE.cloth);
    this.ssanax.halo.material.opacity = 0.3;
  }

  /** Si se publica `ssanax.glb` (riggeado, con clips), sustituye al procedural sin perder posición ni estado. */
  /** Catálogo de figuras publicadas, pedido una vez por mundo. */
  private figures(): Promise<FigureInfo[]> {
    this.figureCatalog ??= loadFigureCatalog();
    return this.figureCatalog;
  }

  /** Aspectos que puede llevar ssanax (los personajes animados del catálogo), para el selector del HUD. */
  async playerFigures(): Promise<FigureInfo[]> {
    return playerFigures(await this.figures());
  }

  /** Cambia el aspecto de ssanax sin perder posición ni estado. */
  setPlayerFigure(id: string): void {
    this.playerFigureId = id;
    void this.upgradeAvatar();
  }

  /** Viste a ssanax con la figura elegida (un glTF riggeado); el procedural queda si no hay ninguna o falla. */
  private async upgradeAvatar(): Promise<void> {
    const figure = playerFigure(await this.figures(), this.playerFigureId);
    if (!figure || figure.id === this.wornFigure || this.disposed) return;
    try {
      const avatar = await GltfAvatar.load(figure.id, this.playerName);
      if (this.disposed || playerFigure(await this.figures(), this.playerFigureId)?.id !== figure.id) return avatar.dispose();
      avatar.root.position.copy(this.ssanax.root.position);
      avatar.root.rotation.y = this.facing;
      this.scene.remove(this.ssanax.root);
      this.ssanax.dispose();
      this.ssanax = avatar;
      this.wornFigure = figure.id;
      // Sus pies, su zancada: no patinan. Una figura sin zancada declarada usa la del rig procedural.
      if (avatar.stride) this.animator.setStride(avatar.stride);
      else this.animator.resetStride();
      this.decoratePlayer();
      this.scene.add(avatar.root);
      this.setScene(this.lastScene);
    } catch (e) {
      console.warn('avatar_fallback', { figure: figure.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private placeCamera(blend: number): void {
    const target = this.ssanax.root.position.clone();
    target.y = HEAD_Y + target.y * 0.6; // un poco por encima de la cabeza; al saltar acompaña sin tirones
    // Introducción: de la vista aérea de la ciudad a la espalda de ssanax, con salida suave (easeInOutCubic).
    const k = this.intro < 0.5 ? 4 * this.intro ** 3 : 1 - (-2 * this.intro + 2) ** 3 / 2;
    const distance = THREE.MathUtils.lerp(INTRO_FROM.distance, this.distance, k);
    const pitch = Math.max(THREE.MathUtils.lerp(INTRO_FROM.pitch, this.pitch, k), lowestPitch(distance, target.y));
    const yaw = this.yaw + (1 - k) * 0.9;
    const offset = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(distance);
    this.camera.position.lerp(target.clone().add(offset), blend);
    this.camera.lookAt(target);
  }

  /**
   * Oclusión (técnica de diorama): lo que se interpone entre la cámara y ssanax (columnas, muros) se vuelve
   * translúcido en lugar de mover la cámara. Unas 10 comprobaciones por segundo.
   */
  private updateOcclusion(): void {
    const head = this.ssanax.root.position.clone().setY(1.6);
    const toHead = head.clone().sub(this.camera.position);
    const length = toHead.length();
    this.raycaster.set(this.camera.position, toHead.normalize());
    this.raycaster.far = Math.max(0, length - 0.8);
    const hits = new Map<THREE.Mesh, number>();
    for (const hit of this.raycaster.intersectObjects([...this.built.values()].map((b) => b.group), true)) {
      const mesh = hit.object as THREE.Mesh;
      if (mesh.isMesh && mesh.userData['occluder'] && !hits.has(mesh)) hits.set(mesh, hit.distance);
    }
    this.raycaster.far = Infinity;
    // La cámara dentro o pegada a una pieza pequeña (núcleo, monumento): un rayo desde dentro no la ve y,
    // translúcida, teñiría toda la pantalla. Se oculta. Las piezas grandes (columnata fusionada) no.
    const sphere = new THREE.Sphere();
    this.city.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData['occluder']) return;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
      if (sphere.radius < 4 && sphere.distanceToPoint(this.camera.position) < 0.6) hits.set(mesh, 0);
    });
    for (const mesh of this.faded) if (!hits.has(mesh)) this.setFaded(mesh, false);
    for (const [mesh, distance] of hits) this.setFaded(mesh, true, distance < OCCLUDER_HIDE_M);
  }

  private setFaded(mesh: THREE.Mesh, faded: boolean, hide = false): void {
    const material = mesh.material as THREE.Material;
    if (material.transparent !== faded) {
      material.transparent = faded;
      material.depthWrite = !faded;
      material.needsUpdate = true;
    }
    material.opacity = faded ? OCCLUDED_OPACITY : 1;
    mesh.visible = !hide;
    if (faded) this.faded.add(mesh);
    else this.faded.delete(mesh);
  }

  private pick(x: number, y: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), this.camera);
    const targets = [...[...this.built.values()].map((b) => b.group), ...[...this.citizens.values()].map((c) => c.figure.root)];
    for (const hit of this.raycaster.intersectObjects(targets, true)) {
      const id = hit.object.userData['placeId'] as string | undefined;
      if (id) return id;
    }
    return null;
  }

  private hover(p: { x: number; y: number }): void {
    if (++this.hoverTick % 6) return; // unas 10 comprobaciones por segundo bastan
    const id = this.pick(p.x, p.y);
    if (id !== this.hovered) {
      this.hovered = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : '';
      this.events.hover(id);
    }
  }

  private updateLabels(): void {
    const me = this.ssanax.root.position;
    for (const [id, label] of this.placeLabels) {
      const d = Math.hypot(me.x - label.position.x, me.z - label.position.z);
      const emphasis = id === this.near || id === this.hovered;
      // Durante la introducción se ven todos: es el momento de orientarse.
      const opacity = this.intro < 1 ? 0.9 : labelOpacity(d, emphasis);
      label.element.style.opacity = String(opacity);
      label.element.style.visibility = opacity === 0 ? 'hidden' : '';
      label.element.classList.toggle('polis-place-active', emphasis);
    }
  }

  private sendPosition(): void {
    this.sinceSent = 0;
    const pos = this.ssanax.root.position;
    const where = { x: Math.round(pos.x * 100) / 100, z: Math.round(pos.z * 100) / 100, heading: headingDeg(this.yaw) };
    if (!moved(this.sent, where)) return;
    this.sent = where;
    this.events.position(where);
  }

  private expireBubbles(t: number): void {
    for (const [root, bubble] of this.bubbles) {
      const left = bubble.until - t;
      if (left > 0) {
        bubble.label.element.style.opacity = left < 1 ? String(left) : '';
        continue;
      }
      this.dropBubble(root);
    }
  }

  private dropBubble(root: THREE.Object3D): void {
    const bubble = this.bubbles.get(root);
    if (!bubble) return;
    root.remove(bubble.label);
    bubble.label.element.remove();
    this.bubbles.delete(root);
  }

  /** Polvo estelar y ruinas del horizonte según el nivel de calidad (se reconstruyen solo si cambia la cantidad). */
  private rebuildVolume(): void {
    if (!this.stardust || !this.horizon) return; // aún en el constructor
    if (this.stardust.points.geometry.getAttribute('position').count !== this.settings.stardust) {
      this.scene.remove(this.stardust.points);
      this.stardust.dispose();
      this.stardust = new Stardust(this.settings.stardust);
      this.scene.add(this.stardust.points);
    }
    if (this.horizon.size !== this.settings.horizonRuins) {
      this.scene.remove(this.horizon.group);
      this.horizon.dispose();
      this.horizon = new Horizon(this.settings.horizonRuins);
      this.scene.add(this.horizon.group);
    }
  }

  /** Suelo por defecto: islas, puentes y monumentos más las columnas, altares y estatuas de la arquitectura. */
  private ground(): Walkable2D {
    return new Walkable2D(() => this.places, () => this.obstacles);
  }

  /**
   * Sustituye los landmarks procedurales por sus glTF cuando el manifiesto los publica (ADR-013 §5.5). Si alguno
   * declara colisionadores `fixed_*`, la física pasa a Rapier; si una carga falla, queda el procedural.
   */
  /**
   * Figura de cada ciudadano: la que declara su manifiesto (`[residence] figure`), estatua viva o personaje animado;
   * si no declara ninguna o no está publicada, la estatua de mármol; sin catálogo, la figura de cono.
   */
  private async upgradeCitizens(version: number): Promise<void> {
    const catalog = await this.figures();
    await Promise.all([...this.citizens].map(async ([name, citizen]) => {
      const figure = citizenFigure(catalog, this.places.find((p) => p.agent === name)?.figure);
      if (!figure) return; // sin figuras publicadas: la figura procedural
      try {
        if (figure.kind === 'statue') {
          const statue = await loadStatue(figure.id);
          if (version === this.cityVersion) citizen.useStatue(statue);
        } else {
          const rig = new RiggedModel(await loadRig(figure.id), RIG_HEIGHT);
          if (version === this.cityVersion) citizen.useRig(rig);
          else rig.dispose();
        }
      } catch (e) {
        console.warn('citizen_fallback', { agent: name, figure: figure.id, error: e instanceof Error ? e.message : String(e) });
      }
    }));
  }

  private async upgradeLandmarks(version: number): Promise<void> {
    const available = await availableLandmarks();
    if (!available.size || version !== this.cityVersion) return;
    const placed: PlacedPlan[] = [];
    await Promise.all([...this.built.values()].map(async (built) => {
      const { place } = built;
      if (!available.has(place.landmark)) return;
      try {
        const { object, plan } = await loadLandmark(place.landmark);
        if (version !== this.cityVersion) return;
        // El asset trae su isla: se retira toda la geometría procedural del lugar.
        for (const child of [...built.group.children]) {
          built.group.remove(child);
          dispose(child);
        }
        object.traverse((o) => (o.userData['placeId'] = place.id));
        built.group.add(object);
        if (plan.colliders.length || plan.sensors.length) {
          placed.push({ placeId: place.id, plan, x: place.x, z: place.z, rotationY: built.group.rotation.y });
        }
      } catch (e) {
        console.warn('landmark_fallback', { landmark: place.landmark, error: e instanceof Error ? e.message : String(e) });
      }
    }));
    if (!placed.length || version !== this.cityVersion) return;
    try {
      const rapier = await RapierPhysics.create(placed, this.ground());
      if (version !== this.cityVersion) return rapier.dispose();
      this.physics.dispose();
      this.physics = rapier;
    } catch (e) {
      console.warn('physics_fallback', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Los pensadores reciben a ssanax: en su sitio y sin trabajar, despiertan al acercarse (se elevan, se iluminan y lo
   * miran) y le saludan con un bocadillo. Nunca durante una deliberación ni encima de un turno real.
   */
  private receiveVisitor(): void {
    const at = this.ssanax.root.position;
    for (const [name, citizen] of this.citizens) {
      const place = this.places.find((p) => p.agent === name);
      const busy = citizen.state === 'working' || citizen.state === 'using_tool';
      const home = place && citizen.resting && citizen.position.distanceTo(this.homeSpot(place)) < 1.5;
      const free = !!home && !busy && !this.lastScene.summoned.includes(name);
      const distance = Math.hypot(at.x - citizen.position.x, at.z - citizen.position.z);
      citizen.attend(free ? attentionAt(distance) : 0, at);
      const welcome = this.welcomes.get(name) ?? { visits: 0, inside: false };
      if (distance > GREET_RESET_M) welcome.inside = false;
      else if (free && distance < GREET_M && !welcome.inside && !this.bubbles.has(citizen.figure.root)) {
        welcome.inside = true;
        this.say(name, greeting(this.playerName, place?.epithet, welcome.visits++));
      }
      this.welcomes.set(name, welcome);
    }
  }

  private homeSpot(place: Place): THREE.Vector3 {
    const spot = hostSpot(place);
    return new THREE.Vector3(spot.x, 0, spot.z);
  }

  /**
   * Piezas glTF (ADR-013 §5.5): el templo y la serpiente sustituyen a sus equivalentes procedurales, así que la
   * ciudad se reconstruye con ellas al llegar; el agujero negro se suma al cielo.
   */
  private async loadProps(): Promise<void> {
    await Promise.all([this.loadCityProps(), this.loadSkyProps()]);
  }

  private async loadCityProps(): Promise<void> {
    const loaded = await loadProps(['temple', 'serpent']);
    if (this.disposed || (!loaded.temple && !loaded.serpent)) return;
    this.props = { temple: loaded.temple, serpent: loaded.serpent };
    if (this.places.length) this.setCity(this.places, this.labelOf);
  }

  /** El agujero negro (8 MB) llega por su cuenta: no retrasa los templos ni la serpiente. */
  private async loadSkyProps(): Promise<void> {
    const loaded = await loadProps(['black_hole']);
    if (this.disposed || !loaded.black_hole) return;
    this.blackHole = new BlackHole(loaded.black_hole, this.renderer);
    this.blackHole.group.visible = this.settings.blackHole;
    this.scene.add(this.blackHole.group);
    this.aimBlackHole();
  }

  /** El agujero negro cuelga en la dirección de la casa al ágora: desde casa, sobre el ágora. */
  private aimBlackHole(): void {
    const home = this.places.find((p) => p.id === HOME_ID);
    if (home && this.blackHole) this.blackHole.aim(-home.x, -home.z);
  }

  private clearCity(): void {
    for (const root of [...this.bubbles.keys()]) this.dropBubble(root);
    for (const welcome of this.welcomes.values()) welcome.inside = false; // su bocadillo se acaba de borrar
    this.faded.clear();
    for (const citizen of this.citizens.values()) {
      this.scene.remove(citizen.figure.root);
      citizen.figure.label.element.remove();
      dispose(citizen.figure.root);
    }
    for (const label of this.placeLabels.values()) label.element.remove();
    this.scene.remove(this.city);
    dispose(this.city);
    this.city = new THREE.Group();
    this.scene.add(this.city);
    this.built.clear();
    this.placeLabels.clear();
    this.citizens.clear();
    this.torches?.dispose();
    this.vegetation?.dispose();
    this.torches = null;
    this.vegetation = null;
    this.obstacles = [];
    if (!(this.physics instanceof Walkable2D)) {
      this.physics.dispose();
      this.physics = this.ground();
    }
  }

  private fit(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.resize();
  }
}

/** ¿Puede este navegador dibujar la Polis? */
export function canRenderWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
