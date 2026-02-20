.PHONY: setup dev up down logs migrate test clean

setup:
	cp .env.example .env
	npm install
	@echo "Setup complete"

dev:
	docker-compose up -d postgres redis
	sleep 5
	npx prisma migrate deploy
	docker-compose up backend

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

migrate:
	npx prisma migrate dev

test:
	npm test

clean:
	docker-compose down -v
	docker system prune -f
