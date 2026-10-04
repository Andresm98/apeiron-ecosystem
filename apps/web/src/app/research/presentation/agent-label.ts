/** Nombre visible de un agente: `heraclito` -> `Heráclito`. */
export function agentLabel(name: string): string {
  return name === 'heraclito' ? 'Heráclito' : name.charAt(0).toUpperCase() + name.slice(1);
}
