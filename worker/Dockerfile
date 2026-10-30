FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
RUN npm ci --include=dev

COPY . .

RUN npx prisma generate --schema prisma/schema.prisma

ENV NODE_ENV=production

CMD ["npm", "start"]
