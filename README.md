# Controlador MIDI DMX para Consola Navigator 3 (ESP32 SuperMini)

Sistema puente inalámbrico para controlar escenas y funciones de la consola de iluminación **Navigator 3 DMX** desde una tablet Android mediante Wi-Fi local de baja latencia.

---

## 📁 Estructura del Proyecto

```text
navigator3-midi-controller/
├── firmware/
│   └── navigator3_esp32_firmware.ino  # Firmware Arduino para ESP32 SuperMini (WebSocket + MIDI UART)
├── web/
│   ├── index.html                     # Estructura principal de la Web App
│   ├── style.css                      # Tema oscuro FOH de alto contraste y diseño táctil
│   ├── app.js                         # Lógica WebSocket, bancos, notas MIDI, octavas y vibración
│   └── standalone.html                # Versión todo-en-uno (lista para abrir local o desde tablet)
└── README.md                          # Documentación del proyecto y guía de conexiones
```

---

## 🚀 Cómo probar la Web App AHORA (Antes de tener el ESP32)

1. Puedes abrir directamente el archivo [standalone.html](file:///Users/juliandipietro/.gemini/antigravity-ide/scratch/navigator3-midi-controller/web/standalone.html) en tu navegador preferido (Chrome, Safari, Firefox).
2. O bien acceder al servidor local en tu red: `http://localhost:8080/standalone.html`.

### ✨ Características de la Web App:
- **Matriz de 16 botones táctiles:** Organizada en 4 bancos (Banco 1: Escenas 1-16, Banco 2: Escenas 17-32, etc.).
- **Selector de Octavas (`-` / `+`):** Permite subir y bajar de octavas en tiempo real (+/- 12 semitonos), mostrando la nota musical equivalente (`C3`, `C4`, `D#4`, etc.) en cada botón, ideal para probar con sintetizadores.
- **Modo Simulación:** Si no está conectado al ESP32, puedes probar las pulsaciones, ver qué notas enviaría y comprobar la respuesta visual en pantalla.
- **Micro-vibración háptica:** Feedback táctil en tablets/teléfonos Android compatibles.
- **Panel de Ajustes (Modal):** Permite cambiar la IP del ESP32, el canal MIDI (1-16), la nota base de inicio y la duración del pulso de disparo (Note-On -> Note-Off).
- **Botón Blackout / Panic:** Apagado rápido con doble confirmación visual.
- **Monitor de Latencia (Ping/Pong):** Medición de tiempo real de ida y vuelta hacia el ESP32.

---

## 🔌 Conexionado Físico MIDI OUT (ESP32 SuperMini a DIN-5)

Basado en la especificación oficial **MIDI 1.0 (MMA CA-033 para 3.3V)** y los colores específicos de tu cable:

### 🎨 Código de Colores del Cable:
* **Malla (Shield):** **GND** (Pin 2 DIN-5).
* **Cable Blanco:** **Pin 4** (3.3V con resistencia de 33 Ω).
* **Cable Rojo:** **Pin 5** (TX con resistencia de 10 Ω).
* **Cable Naranja:** **Pin 1** (Sin conexión / Dejar aislado).
* **Cable Negro:** **Pin 3** (Sin conexión / Dejar aislado).

### 📐 Diagrama Eléctrico de Conexión:

```text
       ESP32 SuperMini                                 Cable MIDI (DIN-5)
  +----------------------+
  |                      |
  |            Pin 3.3V  +-----[ Resistencia 33 Ω ]----+  Cable BLANCO  (Pin 4 DIN-5)
  |                      |
  |     Pin TX (GPIO 21) +-----[ Resistencia 10 Ω ]----+  Cable ROJO    (Pin 5 DIN-5)
  |                      |
  |             Pin GND  +-----------------------------+  MALLA (GND)   (Pin 2 DIN-5)
  +----------------------+
                                                          Cable NARANJA (Pin 1 - No conectar)
                                                          Cable NEGRO   (Pin 3 - No conectar)
```

### 📋 Tabla Resumen de Soldadura:

| Conductor del Cable | Pin Físico DIN-5 | Función MIDI | Conexión en el ESP32 SuperMini | Componente Intermedio |
| :--- | :---: | :--- | :--- | :--- |
| **Malla** | **Pin 2** | Masa / Tierra | **GND** | Conexión directa |
| **Cable Blanco** | **Pin 4** | Alimentación (+3.3V) | **3.3V** | Resistencia **$33\ \Omega$** |
| **Cable Rojo** | **Pin 5** | Datos TX | **TX** (ej. GPIO 21) | Resistencia **$10\ \Omega$** |
| **Cable Naranja** | **Pin 1** | No usado | *Aislar con cinta / termocontraíble* | Ninguno |
| **Cable Negro** | **Pin 3** | No usado | *Aislar con cinta / termocontraíble* | Ninguno |

