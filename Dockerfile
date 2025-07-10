# // ===== 4. Docker Configuration =====
# // File: Dockerfile

FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Create reports directory
RUN mkdir -p reports

# Expose port
EXPOSE 3000

# Start command (will be overridden by docker-compose)
CMD ["node", "odk-mcp-server.js"]