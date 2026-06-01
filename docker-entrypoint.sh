#!/bin/sh
set -e
: "${OPENCLAW_UPSTREAM:=https://openclaw.grisbope.com}"
: "${OPENCLAW_KEY:=}"
: "${OPENAI_API_KEY:=}"
export OPENCLAW_UPSTREAM OPENCLAW_KEY OPENAI_API_KEY
envsubst '${OPENCLAW_UPSTREAM} ${OPENCLAW_KEY} ${OPENAI_API_KEY}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
