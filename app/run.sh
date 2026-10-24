#!/usr/bin/with-contenv bashio
bashio::log.info "Linfa Local Control: avvio backend su :8099"
exec python3 /app/backend/server.py
