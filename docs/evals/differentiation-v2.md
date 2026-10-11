# Eval de diferenciación · v2

- Fecha: 2026-10-10 22:01 · modelo `openai:gpt-5.6-luna (low)` · personas `dba5a6264112`
- 6 preguntas × 5 agentes = 30 intervenciones (degradadas: 3)
- Coste: 117 llamadas, 114471 tokens (debates 102113 · juez 12358)

**Atribución ciega: 85%** sobre 27 intervenciones válidas (azar: 20%). Turnos degradados, excluidos: {'anaximandro': 0, 'heraclito': 0, 'nietzsche': 1, 'feynman': 2, 'epicuro': 0}

| agente | acierto | palabras/turno |
|---|---|---|
| anaximandro | 50% | 135 |
| heraclito | 83% | 62 |
| nietzsche | 100% | 102 |
| feynman | 100% | 120 |
| epicuro | 100% | 134 |

Matriz de confusión:

| autor \ juez | anaximandro | heraclito | nietzsche | feynman | epicuro | ? |
|---|---|---|---|---|---|---|
| **anaximandro** | 3 | 3 | 0 | 0 | 0 | 0 |
| **heraclito** | 0 | 5 | 0 | 1 | 0 | 0 |
| **nietzsche** | 0 | 0 | 5 | 0 | 0 | 0 |
| **feynman** | 0 | 0 | 0 | 4 | 0 | 0 |
| **epicuro** | 0 | 0 | 0 | 0 | 6 | 0 |

Solapamiento léxico medio entre agentes (coseno): **0.161**. Pares más parecidos: anaximandro-nietzsche 0.228, anaximandro-feynman 0.201, anaximandro-heraclito 0.196
