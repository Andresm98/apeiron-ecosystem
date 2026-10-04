"""Puerto para emitir eventos visibles del agente durante su ejecución."""

from collections.abc import Callable

Emit = Callable[[str], None]
