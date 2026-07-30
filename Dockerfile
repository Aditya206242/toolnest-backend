# Stage 1: Install production dependencies
FROM node:18.20.0-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Create runtime runner
FROM node:18.20.0-alpine
WORKDIR /app
ENV NODE_ENV=production

# Copy built node_modules and code assets
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src
COPY server.js ./

# Create local uploads directory and enforce permissions ownership to Node user
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node

EXPOSE 5000
CMD ["npm", "start"]
