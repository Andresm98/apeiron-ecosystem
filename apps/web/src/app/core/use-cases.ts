import { UseCase } from './models';

export const USE_CASES: UseCase[] = [
  { id: 1, mode: 'debate', title: 'Paradoja de Fermi vs. Sustancia Indeterminada',
    prompt: 'Debate: ¿puede el ápeiron explicar el gran silencio de la paradoja de Fermi?' },
  { id: 2, mode: 'debate', title: 'Entrelazamiento cuántico y monismo',
    prompt: 'Debate: ¿apoya el entrelazamiento cuántico una ontología monista?' },
  { id: 3, mode: 'single', title: 'Mecánica del problema de los tres cuerpos',
    prompt: 'Explica por qué el problema de los tres cuerpos no tiene solución general y qué revela sobre lo ilimitado.' },
  { id: 4, mode: 'single', title: 'Verificación lógica: modus ponens vs. falacia',
    prompt: 'Verifica con la calculadora lógica: "P -> Q, Q |- P". ¿Es válido el argumento?' },
  { id: 5, mode: 'single', title: 'Ápeiron y energía oscura',
    prompt: '¿Es la energía oscura una forma moderna del ápeiron? Argumenta con rigor.' },
  { id: 6, mode: 'debate', title: 'Devenir heraclíteo y flecha del tiempo',
    prompt: 'Debate: entropía, flecha del tiempo y el "todo fluye".' },
  { id: 7, mode: 'debate', title: 'Unidad de opuestos y dualidad onda-partícula',
    prompt: 'Debate: ¿es la dualidad onda-partícula una unidad de opuestos?' },
  { id: 8, mode: 'single', title: 'Infinitos mundos vs. multiverso',
    prompt: 'Compara los mundos innumerables de Anaximandro con las teorías modernas de multiverso.' },
  { id: 9, mode: 'single', title: 'Exoplanetas habitables: literatura reciente',
    prompt: 'Busca literatura reciente sobre exoplanetas habitables y resume su relevancia para la paradoja de Fermi.' },
  { id: 10, mode: 'debate', title: 'Azar e indeterminismo cuántico',
    prompt: 'Debate: ¿es el azar un principio último o un velo sobre lo indeterminado?' },
];
