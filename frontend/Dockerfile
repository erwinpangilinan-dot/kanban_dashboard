FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

FROM nginx:alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
# Named .inc, not .conf: nginx auto-loads conf.d/*.conf as server blocks, and
# this file holds location blocks meant to be included from within one.
COPY frontend/nginx-app.inc /etc/nginx/conf.d/app-locations.inc
COPY --from=build /app/dist /usr/share/nginx/html

# 80 = LAN, 8080 = Cloudflare Tunnel (container network only, never published)
EXPOSE 80 8080

CMD ["nginx", "-g", "daemon off;"]
