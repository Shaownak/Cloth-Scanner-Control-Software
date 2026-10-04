FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node working-software/src ./working-software/src
COPY --chown=node:node working-software/public ./working-software/public
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/working-software/data /app/working-software/vision-inbox && chown -R node:node /app/working-software
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "working-software/src/server.js"]
