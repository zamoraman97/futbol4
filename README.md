# 🏆 Mundial 2026 · MultiView

Web para ver **canales del Mundial FIFA 2026 en vivo** con **MultiView de hasta 4 pantallas**,
control de volumen por foco, barra DVR (atrasar/adelantar hasta el directo) y conexión robusta
(reintentos + proxy de respaldo).

No aloja ningún vídeo: solo enlaza a streams públicos de terceros y los reproduce en el
navegador con [hls.js](https://github.com/video-dev/hls.js).

## Características

- **MultiView** de 1, 2, 3 o 4 pantallas simultáneas.
- El audio sigue a la **pantalla en foco** (una sola con sonido a la vez).
- **Barra DVR** por ventana: rebobina/avanza dentro del búfer y botón "EN VIVO".
- Conexión resiliente: auto-recuperación de hls.js, watchdog anti-congelación y proxy de respaldo.
- Portal de **Términos y Condiciones** con aceptación recordada.
- Diseño oscuro premium (glass + aurora), responsive.

## Ejecutar en local

Necesitas [Node.js](https://nodejs.org) 18 o superior.

```bash
npm start
```

Luego abre `http://localhost:8080`.

> Alternativa sin Node: `python -m http.server 8080` y abre `http://localhost:8080`.

## Desplegar en Railway

El proyecto ya está preparado para [Railway](https://railway.app):

- `server.js`: servidor estático Node sin dependencias que escucha en `process.env.PORT`.
- `package.json`: define `npm start`.
- `railway.json`: usa el builder Nixpacks y `npm start` como comando de arranque.

### Opción A — desde GitHub (recomendado)

1. Sube este proyecto a un repositorio de GitHub.
2. En Railway: **New Project → Deploy from GitHub repo** y elige el repo.
3. Railway detecta `package.json`, instala y ejecuta `npm start` automáticamente.
4. En la pestaña **Settings → Networking**, pulsa **Generate Domain** para obtener la URL pública.

### Opción B — con Railway CLI

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

No hace falta configurar el puerto: Railway inyecta la variable `PORT` y el servidor la usa.

## Archivos

| Archivo        | Descripción                                        |
| -------------- | -------------------------------------------------- |
| `index.html`   | Estructura de la página y MultiView.               |
| `styles.css`   | Estilos (tema oscuro premium, responsive).         |
| `app.js`       | Lógica de reproducción, DVR, audio y conexión.     |
| `playlist.m3u` | Lista de canales del Mundial.                      |
| `server.js`    | Servidor estático para producción (Railway).       |
| `package.json` | Scripts y versión de Node.                         |
| `railway.json` | Configuración de despliegue en Railway.            |

## Notas

- Algunos canales pueden no reproducirse por **geo-bloqueo**, caída del stream o políticas
  CORS del proveedor. Es normal: prueba con otro canal.
- Las fuentes públicas cambian con frecuencia; puede requerir actualizar `playlist.m3u`.

## Legal

Este proyecto no almacena ni distribuye contenido protegido. Únicamente enlaza a streams
públicos de terceros. Úsalo respetando las leyes de tu país.
