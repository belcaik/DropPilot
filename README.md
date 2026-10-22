# DropPilot

Aplicación de escritorio local para organizar campañas de drops de Twitch y Kick, principalmente Rust. Importa canales desde Facepunch o archivos, consulta el inventario, comprueba directos y rota entre canales pendientes. Incluye interfaz en español y Chromium administrado para reproducción y consulta. Para autenticarte recomienda Chrome o Edge instalado.

## Alcance y estado

- Autenticación interactiva en Chrome o Edge instalado, con un perfil temporal separado; sesión reutilizable cifrada con el llavero del sistema.
- Importación de campañas públicas de `twitch.facepunch.com` y `kick.facepunch.com`.
- Cola por plataforma, prioridad y rotación configurable. Mantiene una reproducción por plataforma.
- Consulta periódica del inventario y omisión de canales cuyos premios estén confirmados como reclamados.
- Reclamación opcional cuando existe un botón reconocido en el inventario.
- Modo visible o Chromium sin ventana, importación/exportación de configuración, registro de actividad y selectores CSS configurables.

La aplicación no convierte tiempo local en progreso confirmado. Twitch/Kick y cada campaña deciden qué reproducción cuenta. Si el inventario, los indicadores de directo o una verificación humana no se reconocen, informa un estado desconocido y requiere revisar la sesión o los selectores. Las pruebas locales usan datos de ejemplo; la validación de campañas reales requiere tu cuenta y una campaña activa. En la corrección 0.1.1 se verificó que la página de acceso de Twitch abre en Chrome instalado sin el aviso de navegador no compatible y que guardar antes de autenticarte se rechaza. No se enviaron credenciales ni se verificó un acceso real: la ausencia del aviso inicial no garantiza que la autenticación termine correctamente. La corrección 0.1.2 adapta la lectura a las tarjetas reales del inventario de Twitch y espera a que se rendericen antes de consultarlas. Se contrastó el lector con HTML de un inventario autenticado: recompensas en progreso, recompensas vencidas e historial reclamado. El historial no siempre expone el juego o la campaña; para omitir un canal usando una recompensa de ese historial se exige su nombre exacto y que todo el intervalo posible de reclamación quede dentro de las fechas de la campaña. Sin esa evidencia el canal permanece pendiente. Kick aún requiere validar sus selectores con una cuenta real. La reclamación tampoco está garantizada: una solicitud de clic solo se confirma si el inventario posterior aporta evidencia. Las tarjetas modernas de Twitch se leen sin reclamación automática hasta verificar el botón real; el reclamo mediante selectores configurados conserva su comportamiento anterior. La interfaz avisa cuando el historial no aporta datos suficientes para asociar todas las recompensas a una campaña.

Facepunch establece que tanto Twitch como Kick acreditan drops para un solo canal activo a la vez; abrir varios no acelera la obtención. Twitch exige directos elegibles, no VOD ni repeticiones. Por eso DropPilot mantiene una reproducción por plataforma. Consulta [Facepunch Twitch](https://twitch.facepunch.com/), [Facepunch Kick](https://kick.facepunch.com/) y [la guía oficial de Twitch](https://help.twitch.tv/s/article/mission-based-drops?language=en_US). Las condiciones particulares de cada campaña y [los términos de drops de Kick](https://kick.com/kick-drops-terms) siguen siendo aplicables.

## Uso

1. Abre DropPilot. El ejecutable empaquetado incorpora Chromium; en desarrollo ejecuta `npm run prepare:browser`.
2. Instala una versión actual de Chrome o Edge. Pulsa **Conectar Twitch** o **Conectar Kick** y elige Chrome, Edge o Automático. Automático prefiere Chrome y después Edge. La aplicación abre un perfil temporal exclusivo; autentícate personalmente y pulsa **Guardar sesión** desde DropPilot. Completa cualquier MFA o verificación manual. El inicio de sesión requiere Chrome o Edge instalado: el Chromium incluido se reserva para reproducción y consulta. Seleccionar Chromium para reproducción no cambia ese requisito.
3. Importa la campaña de Facepunch o añade nombres/enlaces de canales. Los archivos de canales aceptan una lista de nombres o enlaces; la configuración completa se importa en JSON.
4. Ajusta los intervalos, la prioridad, el juego y el modo de navegador. Guarda antes de iniciar.
5. Pulsa **Iniciar**. Revisa **Inventario** y **Actividad** para comprobar evidencia de progreso y errores. **Pausar** cierra las reproducciones.

La vinculación de cuentas Rust/Steam con la plataforma se realiza en el sitio oficial de la campaña. La aplicación no la sustituye.

## Desarrollo

Requisitos: Node.js 22 o superior con npm, conexión para descargar dependencias y navegadores, Windows/macOS/Linux de escritorio. En Linux se necesita un llavero disponible para guardar sesiones cifradas y las bibliotecas de Chromium.

```sh
npm ci
npm run prepare:browser
npm test
npm start
```

En Linux, si faltan bibliotecas del sistema, sigue la instalación oficial de Playwright (`npx playwright install-deps chromium`). El proyecto almacena el navegador de desarrollo en `.browsers/`; no usa el perfil de tu navegador personal.

## Ejecutables y Releases

Descarga el ZIP de tu sistema desde [GitHub Releases](https://github.com/belcaik/DropPilot/releases). Extrae **todo el ZIP** en una carpeta y abre DropPilot.exe (Windows), droppilot (Linux) o DropPilot.app (macOS). Conserva resources, locales, librerías y Chromium junto a la aplicación: copiar solo el ejecutable no funciona. No se necesita instalar Node.js.

Los ZIP son aplicaciones extraíbles sin instalador. Las preferencias y sesiones continúan en el directorio de datos del usuario del sistema; no se guardan junto al ejecutable ni se incluyen en Releases. En Linux siguen siendo necesarias las bibliotecas del sistema de Chromium y un llavero para las sesiones; no se garantiza compatibilidad con cualquier distribución.

~~~sh
npm run dist:win    # Windows x64: ZIP completo
npm run dist:linux  # Linux x64: ZIP completo
npm run dist:mac    # macOS: ZIP para la arquitectura del equipo
~~~

Los resultados quedan en dist/. Cada compilación descarga Chromium para su sistema y arquitectura. El flujo .github/workflows/build.yml ejecuta las pruebas, genera cuatro ZIP (Windows x64, Linux x64, macOS Intel y Apple Silicon), los extrae y comprueba que la aplicación abre desde el archivo distribuido. Después genera SHA256 y sube cada ZIP directamente a una Release en borrador. Se ejecuta en etiquetas v* o manualmente indicando una etiqueta existente. Las Actions están fijadas por SHA; los trabajos de publicación usan contents: write. No usa almacenamiento de artefactos de Actions.

Para publicar una nueva versión, actualiza version en package.json y package-lock.json, haz commit y sube una etiqueta coincidente:

~~~sh
git tag v0.1.4
git push origin v0.1.4
~~~

Solo las etiquetas crean Releases automáticamente, después de superar los cuatro empaquetados y las pruebas de los ZIP extraídos. Una ejecución manual requiere indicar una etiqueta existente y sigue el mismo proceso de publicación. Si falla una plataforma, la Release permanece en borrador y no se publica. El flujo usa GITHUB_TOKEN; no requiere claves personales ni certificados. Una repetición actualiza los archivos de la misma Release.

Los paquetes no están firmados ni notarizados. Los sistemas operativos pueden pedir autorización para abrirlos. Un mismo binario no puede ejecutarse en los tres sistemas; se publica un ZIP independiente por sistema y arquitectura.

La auditoría realizada el 3 de octubre de 2026 no reportó vulnerabilidades conocidas en las dependencias de ejecución (`npm audit --omit=dev`). La auditoría completa sí reportó ocho avisos de severidad alta, derivados de una dependencia indirecta de descarga de electron-builder: [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). La versión publicada más reciente de `http-cache-semantics`, 4.2.0, también figura afectada. Estas herramientas se usan al compilar y no se incluyen en la aplicación; vuelve a revisar y actualizar el entorno de compilación cuando exista un parche compatible.

## Diseño

- `src/main.js`: ciclo de vida Electron, diálogos y operaciones disponibles para la interfaz.
- `src/preload.cjs`: puente limitado entre la interfaz aislada y el proceso principal.
- `src/core/config.js`: validación, normalización, selección y detección de canales completados.
- `src/core/scheduler.js`: consulta, prioridad, rotación y parada del planificador.
- `src/core/browser.js`: Chromium, inicio de sesión y estado autenticado.
- `src/core/store.js`: configuración local, escritura atómica y bóveda cifrada.
- `src/adapters/`: campañas Facepunch e interacción de Twitch/Kick.
- `src/ui/`: interfaz, preferencias, inventario y actividad.
- `test/` y pruebas de adaptadores: verificación sin cuentas ni servicios externos.

Facepunch puede publicar etiquetas de categoría del objeto (por ejemplo, «Small Backpack») que no coinciden con el nombre de la skin en Twitch (por ejemplo, «Rust Isles Backpack»). La sincronización del inventario reconoce el nombre real, pero para omitir automáticamente esos canales debes editar sus premios asociados y usar los nombres exactos del inventario. La aplicación no convierte esas categorías en nombres de skins ni da por completados todos los canales importados por esa semejanza.

Para otros juegos añade sus canales y los nombres/identificadores de premios a `rewardIds`. Una coincidencia por nombre requiere también el mismo juego; el inventario debe aportar ese dato. Cuando el canal incluye `campaignId`, la recompensa debe pertenecer a esa campaña. Para campañas importadas de Facepunch, `campaignTitle` también delimita la coincidencia. Si falta evidencia del juego o de la campaña, el canal permanece pendiente, salvo una entrada identificada como historial reclamado de Twitch cuyo nombre coincida exactamente y cuyo intervalo completo de fecha de reclamación esté contenido en las fechas de la campaña importada. Las coincidencias con juego y campaña explícitos evitan confundir premios homónimos; en el historial sin esos datos, el nombre exacto y las fechas reducen la ambigüedad, pero no prueban el juego. La aplicación no infiere un juego para esas entradas. Los selectores avanzados permiten adaptar inventarios y controles de las dos plataformas existentes. Un proveedor diferente requiere un adaptador y ampliar la validación de plataformas; no basta con cambiar el nombre del juego.

Ejemplo de configuración importable:

```json
{
  "version": 1,
  "settings": {
    "game": "Rust",
    "pollSeconds": 120,
    "inventorySeconds": 180,
    "rotationMinutes": 30,
    "headless": true,
    "autoClaim": false,
    "selectors": { "twitch": {}, "kick": {} }
  },
  "channels": [{
    "platform": "twitch",
    "login": "nombre_del_canal",
    "game": "Rust",
    "priority": 10,
    "enabled": true,
    "rewardIds": ["Nombre exacto del premio"],
    "completed": false
  }]
}
```

## Seguridad y datos

La interfaz utiliza aislamiento de contexto, acceso restringido y una política CSP local. Los canales, preferencias y destinos se validan antes de usarlos. La aplicación no lee ni clona cookies de Chrome, Edge, Firefox ni perfiles ajenos. Abre Chrome/Edge instalado con un perfil temporal exclusivo y un puerto de depuración limitado a la interfaz local de este equipo. Solo al pulsar **Guardar sesión** conecta con ese navegador para capturar el estado de la sesión creada aquí, cifrado mediante `safeStorage` de Electron. El perfil temporal se elimina al terminar. Cerrar el navegador antes de guardar descarta el nuevo inicio de sesión y conserva la sesión guardada anteriormente; el proceso de autenticación caduca a los 20 minutos. Para Twitch se comprueba que exista una cookie de sesión válida antes de guardar. Rechaza el almacenamiento de sesiones cuando no existe un mecanismo de cifrado adecuado.

La configuración y sesiones se guardan en el directorio de datos de usuario de Electron (`DropPilot`). La exportación incluye canales y preferencias, sin secretos. **Cerrar sesión** elimina la sesión local de la plataforma. El cifrado está ligado al usuario y equipo: inicia sesión nuevamente al trasladar la aplicación. No compartas la carpeta de datos ni introduzcas contraseñas en configuraciones.

La ventana de autenticación es el único lugar para ingresar credenciales. No se evitan CAPTCHA, MFA, bloqueos o verificaciones humanas. La aplicación realiza peticiones a las plataformas, Facepunch y, al preparar Chromium, a los servidores oficiales de descarga.

## Referencias técnicas

- [Playwright: instalación de navegadores](https://playwright.dev/docs/browsers)
- [Electron: almacenamiento cifrado](https://www.electronjs.org/docs/latest/api/safe-storage)
- [electron-builder: inclusión de recursos externos](https://www.electron.build/docs/contents/)
- [GitHub: sistemas disponibles para los runners](https://github.com/actions/runner-images)

