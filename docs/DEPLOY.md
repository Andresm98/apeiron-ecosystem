# Guía de despliegue (VM / EC2)

1. **VM**: Ubuntu 22.04+, 2 vCPU / 4 GB. Security group: 22 (tu IP), 80/443. No expongas 8000 ni Chroma.
2. **Docker**: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER` (re-login).
3. **Código**: `git clone <repo> && cd apeiron-ecosystem && cp .env.example .env`.
4. **Secretos** en `.env`: `APEIRON_ENV=prod`, `APEIRON_JWT_SECRET` (`openssl rand -hex 32`), `ANTHROPIC_API_KEY`,
   `APEIRON_LLM_PROVIDER=anthropic`, `APEIRON_VECTOR_BACKEND=chroma`; opcional LangSmith (`APEIRON_LANGSMITH_*`).
5. **Arranque**: `make up` (o `docker compose -f deploy/docker-compose.yml up -d --build`). Con front: añade `--profile web`.
6. **Verificación**: `curl localhost:8000/healthz` y `docker compose -f deploy/docker-compose.yml logs -f api` (logs JSON con `trace_id`).
7. **TLS**: Nginx/Caddy en el host (o ALB) con certificado; mantén `proxy_buffering off` en `/api/` para el SSE.
8. **Operación**: `restart: unless-stopped` ya está; actualiza con `git pull && docker compose ... up -d --build`.
   Pendiente antes de producción real: reemplazar `InMemoryUserRepository` por una base de datos (puerto `UserRepository`).
