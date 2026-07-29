FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3900
ENV SENSENOVA_API_KEY=sk-gRBj4F5geXno8iucOkmVlfOFXtbebMQj
CMD ["node", "server.js"]
