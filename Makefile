.PHONY: install check test run up
install:
	pip install -e packages/core -e packages/agents -e "packages/infra[llm,chroma,mcp,sessions]" -e services/api -e services/mcp-scholar pytest pytest-asyncio ruff mypy import-linter
check:
	ruff check . && mypy packages/core/src packages/agents/src packages/infra/src services/api/src services/mcp-scholar/src && lint-imports
test:
	pytest -q
run:
	uvicorn apeiron_api.main:create_app --factory --reload --port 8000
up:
	docker compose -f deploy/docker-compose.yml up --build
