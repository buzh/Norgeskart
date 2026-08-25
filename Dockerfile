FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2.10.0-alpine@sha256:e2e3a089760c453bc51c4e718342bd7032d6714f15b437db7121bfc2de2654a6
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /var/www
EXPOSE 3000
