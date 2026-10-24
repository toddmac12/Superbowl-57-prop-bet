FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/App_Data && chown node:node /app/App_Data
USER node
ENV HOST=0.0.0.0 PORT=5002
EXPOSE 5002
CMD ["node", "server.js"]
