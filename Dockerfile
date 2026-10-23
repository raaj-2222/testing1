# A single service runs the API and the static web frontend.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies before copying application code for faster rebuilding.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY public/ ./public/
COPY server/ ./server/

# Railway supplies PORT at runtime; 3000 is used for local Docker runs.
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/app.js"]
