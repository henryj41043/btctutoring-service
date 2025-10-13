FROM node:20-alpine as builder

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production
COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./package.json

EXPOSE 3000

CMD ["node", "dist/main"]
