FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src ./src
ARG VITE_CPU_WARNING_THRESHOLD=85
ARG VITE_MEMORY_WARNING_THRESHOLD=85
ARG VITE_DISK_WARNING_THRESHOLD=90
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
  VITE_CPU_WARNING_THRESHOLD=$VITE_CPU_WARNING_THRESHOLD \
    VITE_MEMORY_WARNING_THRESHOLD=$VITE_MEMORY_WARNING_THRESHOLD \
    VITE_DISK_WARNING_THRESHOLD=$VITE_DISK_WARNING_THRESHOLD
RUN npm run build

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]