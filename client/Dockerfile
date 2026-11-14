FROM node:20-alpine AS build

WORKDIR /app
# pixelfx is locked to a public GitHub commit; fetch it over HTTPS.
RUN apk add --no-cache git
COPY package.json package-lock.json ./
RUN GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf \
    GIT_CONFIG_VALUE_0=ssh://git@github.com/ npm ci

COPY . .
ARG VITE_API_URL
RUN VITE_API_URL="$VITE_API_URL" npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
