# Imagem da plataforma (Next.js) com o núcleo. Construída a partir da raiz do monorepo
# (docker compose -f docker/docker-compose.yml); as exclusões ficam em Dockerfile.dockerignore.
FROM node:22-alpine AS base
WORKDIR /app

# 1. Dependências (camada em cache enquanto os package.json não mudarem).
FROM base AS dependencias
COPY package.json package-lock.json ./
COPY nucleo/package.json nucleo/
COPY plataforma/package.json plataforma/
RUN npm ci

# 2. Build do site.
FROM dependencias AS build
COPY nucleo nucleo
COPY plataforma plataforma
# A página /plano lê este arquivo (a imagem de execução herda esta etapa).
COPY plano.txt plano.txt
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w plataforma

# 3. Execução: aplica as migrações e sobe o site.
FROM build AS execucao
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "npm run banco:migrar -w plataforma && npm run start -w plataforma"]
