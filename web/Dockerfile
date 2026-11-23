# Só o que a página precisa: index.html, engine.js e taxonomy.js (sem node_modules).
FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY prototype/index.html prototype/engine.js prototype/taxonomy.js /usr/share/nginx/html/
