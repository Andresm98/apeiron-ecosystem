# Eval de diferenciación · baseline

- Fecha: 2026-10-10 21:53 · modelo `openai:gpt-5.6-luna (low)` · personas `3e397928e47e`
- 6 preguntas × 5 agentes = 30 intervenciones (degradadas: 0)
- Coste: 123 llamadas, 124388 tokens (debates 110391 · juez 13997)

**Atribución ciega: 53%** sobre 30 intervenciones válidas (azar: 20%). Turnos degradados, excluidos: {'anaximandro': 0, 'heraclito': 0, 'nietzsche': 0, 'feynman': 0, 'epicuro': 0}

| agente | acierto | palabras/turno |
|---|---|---|
| anaximandro | 17% | 166 |
| heraclito | 67% | 83 |
| nietzsche | 17% | 118 |
| feynman | 83% | 180 |
| epicuro | 83% | 159 |

Matriz de confusión:

| autor \ juez | anaximandro | heraclito | nietzsche | feynman | epicuro | ? |
|---|---|---|---|---|---|---|
| **anaximandro** | 1 | 1 | 0 | 2 | 2 | 0 |
| **heraclito** | 0 | 4 | 0 | 0 | 2 | 0 |
| **nietzsche** | 0 | 1 | 1 | 1 | 3 | 0 |
| **feynman** | 0 | 0 | 0 | 5 | 1 | 0 |
| **epicuro** | 0 | 0 | 0 | 1 | 5 | 0 |

Solapamiento léxico medio entre agentes (coseno): **0.294**. Pares más parecidos: epicuro-feynman 0.401, feynman-nietzsche 0.343, heraclito-nietzsche 0.34
