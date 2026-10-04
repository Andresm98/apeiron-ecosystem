# Requiere que apps/web sea un proyecto Angular real (ver apps/web/README.md).
FROM node:24-alpine AS build
WORKDIR /web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build -- --configuration production

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx/nginx.conf /etc/nginx/conf.d/default.conf
# Ajusta la ruta si tu proyecto se llama distinto: dist/<proyecto>/browser
COPY --from=build /web/dist/apeiron-web/browser /usr/share/nginx/html
EXPOSE 80
