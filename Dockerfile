FROM node:20-bookworm

WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN npm install
RUN npm install --prefix server
RUN npm install --prefix client

COPY . .

RUN npm run build
RUN npx --prefix server playwright install --with-deps chromium

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
