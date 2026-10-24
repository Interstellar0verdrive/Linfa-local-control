FROM ghcr.io/home-assistant/base:3.24

RUN apk add --no-cache python3 py3-yaml

COPY backend/server.py /app/backend/server.py
COPY www/index.html /app/www/index.html
COPY www/assets /app/www/assets
COPY www/guide /app/www/guide
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
