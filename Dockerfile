# --- фронтенд ---
FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npx vite build

# --- бэкенд ---
FROM rust:1-bookworm AS api
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release; rm -rf src
COPY backend/src ./src
COPY backend/migrations ./migrations
RUN touch src/main.rs && cargo build --release

# --- итоговый образ ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=api /app/backend/target/release/bb-backend /app/bb-backend
COPY --from=web /app/dist /app/dist
ENV BIND_ADDR=0.0.0.0:8080 FRONTEND_DIR=/app/dist
EXPOSE 8080
CMD ["/app/bb-backend"]
