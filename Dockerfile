FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --silent
COPY . .
RUN cp .env.example .env && \
    mkdir -p public/vad && \
    cp node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx public/vad/ && \
    cp node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js public/vad/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm public/vad/ && \
    cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs public/vad/ && \
    cp node_modules/onnxruntime-web/dist/ort.min.mjs public/vad/ && \
    npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache gettext
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN mkdir -p /etc/nginx/templates
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint-custom.sh
RUN chmod +x /docker-entrypoint-custom.sh
EXPOSE 80
CMD ["/docker-entrypoint-custom.sh"]
