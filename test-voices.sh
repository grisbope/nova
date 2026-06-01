#!/bin/bash
KEY='sk_a0d890f7d925be691d135440fa41ccb39c02bc8be9e690b2'
TEXT='Hola, qué tal. Esto es una prueba de voz.'
for entry in 'nPczCjzI2devNBz1zQrb:Brian' 'cjVigY5qzO86Huf0OWal:Eric' 'pNInz6obpgDQGcFmaJgB:Adam' 'JBFqnCBsd6RMkjVDRZzb:George' 'pqHfZKP75CvOlQylNhV4:Bill' 'iP95p4xoKVk53GoZ742B:Chris' 'TX3LPaxmHKxFdv7VOQHJ:Liam'; do
  ID="${entry%:*}"; N="${entry#*:}"
  TIME=$(curl -sS -X POST "https://api.elevenlabs.io/v1/text-to-speech/${ID}/stream?optimize_streaming_latency=4" \
    -H "xi-api-key: $KEY" -H 'Content-Type: application/json' \
    -o "/tmp/v_${N}.mp3" -w "%{time_total}" --max-time 20 \
    -d "{\"text\":\"$TEXT\",\"model_id\":\"eleven_flash_v2_5\",\"language_code\":\"es\",\"voice_settings\":{\"stability\":0.5,\"similarity_boost\":0.75}}")
  SZ=$(stat -c%s "/tmp/v_${N}.mp3")
  echo "${N} -> bytes=${SZ} time=${TIME}s"
done
