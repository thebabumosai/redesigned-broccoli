# Use the official Node.js image as the base image
FROM node:18

# Set the working directory
WORKDIR /app

# Install system dependencies for sharp and node-canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Next.js application
RUN npm run build

# Expose the port that the app runs on
EXPOSE 3000

# Start the Next.js application
CMD ["npm", "start"]
