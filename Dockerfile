# Use an official Node.js runtime as the base image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
# This allows npm install to leverage Docker's build cache
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Build NestJS App
RUN nest build

# Expose the port your application listens on
EXPOSE 3000

# Define the command to run your application
CMD [ "node", "dist/main" ]
