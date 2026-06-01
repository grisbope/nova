# Nova

Asistente de voz en el navegador. Un orbe minimalista, wake word, respuestas en streaming y TTS natural. Pensado para pantallas táctiles, kioscos y despliegues web como [nex.grisbope.com](https://nex.grisbope.com).

<img width="1385" height="776" alt="image" src="https://github.com/user-attachments/assets/7afda574-d956-4c7e-ab68-17e279ce787b" />

<p align="center">
  <strong>Toca el orbe</strong> · di <em>«Nova»</em>, <em>«Alexa»</em>, o <em>«Jarvis»</em> · habla · escucha la respuesta
</p>

---

## Qué hace

Nova es una interfaz **solo voz**: sin chat, sin teclado, sin ruido visual. El orbe cambia de color según el estado:

| Estado | Orbe | Qué ocurre |
|--------|------|------------|
| **Idle** | Azul profundo, respirando | Escucha la wake word o espera un toque |
| **Listening** | Azul brillante + ondas | Captura tu frase |
| **Thinking** | Morado girando | Consulta a OpenClaw |
| **Speaking** | Verde con ondas | Responde con TTS en streaming |
| **Error** | Rojo | Mensaje breve y vuelve a idle |

**Barge-in:** si hablas mientras responde, interrumpe y escucha de nuevo.  
**Despedida:** «adiós», «gracias Nova», «hasta luego», «chao» → vuelve a reposo.

---

## Stack

- **React 18** + **Vite 5** + **Tailwind CSS**
- **Web Speech API** + **VAD** (Silero ONNX en el cliente)
- **OpenClaw** como backend conversacional (SSE streaming)
- **OpenAI** para STT/TTS (configurable)
- **Docker + nginx** para producción con proxy seguro a OpenClaw, STT y TTS

---

## Inicio rápido

```bash
git clone https://github.com/grisbope/nova.git
cd nova
cp .env.example .env   # edita PIN, claves y URLs
npm install
npm run dev
```

Abre `http://localhost:5173`. En producción necesitas **HTTPS** para micrófono y reconocimiento de voz.

### Build

```bash
npm run build
npm run preview
```

---

## Variables de entorno

Copia `.env.example` → `.env` y ajusta:

| Variable | Descripción |
|----------|-------------|
| `VITE_OPENCLAW_URL` | URL del gateway (`/openclaw` detrás de nginx, o URL absoluta en dev) |
| `VITE_OPENCLAW_KEY` | Bearer token del gateway |
| `VITE_OPENCLAW_MODEL` | Agente OpenClaw (p. ej. `openclaw/main`) |
| `VITE_WAKE_WORDS` | Wake words separadas por coma |
| `VITE_LOGIN_PIN` | PIN de acceso local |
| `VITE_AUTH_SECRET` | Secreto para firmar la sesión en `localStorage` |
| `VITE_LANG` | Locale de voz (`es-ES`) |
| `VITE_OPENAI_*` | Modelos de STT/TTS de OpenAI |

> En Docker, nginx inyecta la autenticación hacia OpenClaw y expone `/stt/` y `/tts/` como proxy same-origin hacia OpenAI. En Vercel o dev directo, configura `VITE_OPENCLAW_URL` y `VITE_OPENCLAW_KEY` apuntando a tu gateway.

---

## Despliegue

### Vercel (recomendado para frontend estático)

1. Importa el repo en [vercel.com](https://vercel.com).
2. Framework preset: **Vite**.
3. Añade las variables `VITE_*` en el panel de Environment Variables.
4. Deploy.

El `vercel.json` incluido enruta la SPA y sirve los assets de VAD.

### Docker (como en el VPS)

```bash
docker build -t nova .
docker run -p 8080:80 \
  -e OPENCLAW_UPSTREAM=http://openclaw:18789 \
  -e OPENCLAW_KEY=tu-clave \
  -e OPENAI_API_KEY=tu-clave-openai \
  nova
```

### Echo Show / kiosco

- URL de inicio → tu deploy HTTPS
- Permisos: micrófono siempre, autoplay permitido
- Pantalla siempre encendida, fullscreen
- Primer toque activa el micrófono (política del navegador)

---

## Estructura

```
src/
  App.jsx              # Máquina de estados de voz
  components/
    Orb.jsx            # Orbe animado
    Login.jsx          # Pantalla PIN
  lib/
    speech.js          # Reconocimiento + VAD
    tts.js               # Cola TTS por frases
    openclaw.js          # Streaming SSE
    wakeword.js          # Detección de activación
    auth.js              # Sesión local con PIN
public/vad/              # Modelos ONNX (Silero + ORT)
```

---

## Licencia

MIT — ver [LICENSE](LICENSE).

---

<p align="center">
  <sub>Hecho para conversaciones cortas, naturales y sin fricción.</sub>
</p>
