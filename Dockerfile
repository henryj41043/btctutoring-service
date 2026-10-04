FROM node:22-alpine AS builder

WORKDIR /app

# Dependencies first: this layer is reused until package*.json changes.
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./package.json

EXPOSE 80

CMD ["node", "dist/main"]
