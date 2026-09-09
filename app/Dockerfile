FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Zonas horarias (Alpine no las trae) para que TZ=America/Lima funcione
RUN apk add --no-cache tzdata

# Instala dependencias primero (mejor cache)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Codigo
COPY . .

EXPOSE 3000
CMD ["node", "src/server.js"]
