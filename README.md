# Controlador MIDI DMX Inalámbrico (ESP32-C3 SuperMini)

Sistema puente de ultra-baja latencia (~10 ms) para controlar escenas y funciones de la consola de iluminación **Navigator 3 DMX**, sintetizadores (ej. **Arturia MicroFreak**) y samplers mediante Wi-Fi local autónomo y WebSockets binarios desde iPhone, iPad o tablets Android.

---

## 🚀 Repositorio GitHub
**[https://github.com/chuledp/navigator3-midi-controller-esp32](https://github.com/chuledp/navigator3-midi-controller-esp32)**

---

## 📁 Estructura del Proyecto

```text
navigator3-midi-controller/
├── navigator3_firmware/
│   ├── navigator3_firmware.ino  # Firmware Arduino ESP32-C3 (AP + WebServer + WebSocket binario + MIDI UART)
│   └── web_page.h               # Web App completa embebida en memoria Flash (GZIP)
├── web/
│   ├── standalone.html          # Web App lista para abrir en navegador
│   ├── index.html               # Estructura desacoplada
│   ├── style.css                # Estilos FOH Dark Theme de alto contraste
│   └── app.js                   # Lógica WebSocket y MIDI
└── README.md                    # Documentación y guía de conexiones
```

---

## 🔌 Conexionado Físico MIDI OUT (ESP32 SuperMini a DIN-5 / TRS Tipo B)

Basado en la especificación oficial **MIDI 1.0 (MMA CA-033 para 3.3V)** y validado con el adaptador TRS Tipo B:

### 🎨 Código de Colores y Asignación de Pines:
* **Malla (Shield / Sleeve):** **GND** (Pin 2 DIN-5).
* **Cable Blanco (Tip):** **Pin 4** DIN-5 $\rightarrow$ **3.3V** con resistencia de **$33\ \Omega$**.
* **Cable Rojo (Ring):** **Pin 5** DIN-5 $\rightarrow$ **TX (GPIO 21)** con resistencia de **$10\ \Omega$**.
* **Cables Naranja y Negro:** Sin conexión (aislados).

### 📐 Diagrama Eléctrico de Conexión:

```text
       ESP32-C3 SuperMini                                Adaptador MIDI (TRS / DIN-5)
  +--------------------------+
  |                          |
  |                 Pin 3.3V +-----[ Resistencia 33 Ω ]----+  Cable BLANCO (Tip / Pin 4 DIN)
  |                          |
  |         Pin TX (GPIO 21) +-----[ Resistencia 10 Ω ]----+  Cable ROJO   (Ring / Pin 5 DIN)
  |                          |
  |                  Pin GND +-----------------------------+  MALLA (Sleeve / Pin 2 DIN)
  +--------------------------+
```

---

## ✨ Características de la Web App

- **Ultra-Baja Latencia (~10 ms):** Transmisión por tramas binarias directas de 4 bytes (`Uint8Array`) por WebSocket, saltándose el parseo de strings JSON.
- **Selector de Vista 📱 iPhone (8 Pads) vs 📟 iPad (16 Pads):**
  - **Modo 8 Pads (iPhone):** Botones gigantes estilo Sampler MPC con navegación entre páginas `[1 - 8]` y `[9 - 16]`.
  - **Modo 16 Pads (iPad):** Matriz 4x4 completa con todos los pads visibles simultáneamente.
- **Optimización Apaisada (Landscape):** Encabezados compactados automáticamente en pantallas con altura reducida (< 480px).
- **Selector de Octavas (`-` / `+`):** Transposición en tiempo real (+/- 12 semitonos) con visualización de nota (`C3`, `C4`, `D#4`, etc.).
- **Blackout / Panic:** Apagado instantáneo con doble confirmación visual.
- **Zero Internet Required:** El ESP32 crea su propio Access Point `Navigator3-MIDI` y aloja la aplicación completa en su flash.

---

## ⚡ Compilación y Flasheo (Arduino CLI)

Para compilar y subir el firmware al ESP32-C3 SuperMini:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio navigator3_firmware
arduino-cli upload -p /dev/cu.usbmodem1101 --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashMode=dio navigator3_firmware
```

### 📶 Conexión Wi-Fi:
* **SSID:** `Navigator3-MIDI`
* **Password:** `12345678`
* **URL:** `http://192.168.4.1` o `http://navigator.local`
