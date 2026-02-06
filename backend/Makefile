.PHONY: dev run build-frontend

data = ../data/conversations.json
port = 8080

dev:
	CONVERSATIONS_DATA_PATH=$(data) uv run uvicorn main:app --host 127.0.0.1 --port $(port) --reload

run:
	CONVERSATIONS_DATA_PATH=$(data) uv run uvicorn main:app --host 127.0.0.1 --port $(port)

build-frontend:
	cd ../frontend && npm run build
