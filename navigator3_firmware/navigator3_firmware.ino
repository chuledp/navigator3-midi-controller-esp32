/*
  =============================================================================
  NAVIGATOR 3 // ESP32 SUPERMINI MIDI DMX BRIDGE
  MODO ACCESS POINT (AP) PURO

  El ESP32 crea su propia red Wi-Fi:
      SSID:      Navigator3-MIDI
      Password:  12345678
      IP fija:   192.168.4.1
      Host:      navigator.local  (mDNS)
      Web:       http://192.168.4.1
      WebSocket: ws://192.168.4.1:81

  MIDI OUT (MMA CA-033 3.3V):
  - Pin 4 DIN-5 (Blanco) -> R 33 ohm -> 3.3V
  - Pin 5 DIN-5 (Rojo)   -> R 10 ohm -> TX (GPIO 21)
  - Pin 2 DIN-5 (Malla)  -> GND
  =============================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <WebSocketsServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include "esp_wifi.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "web_page.h"

// Anular completamente la inicialización del detector de brownout a nivel de linker
// Esto previene que el hardware detector entre en bucle de reset por fluctuaciones normales de voltaje
extern "C" void esp_brownout_init(void) {
    // NOP
}

// Macros de logging seguro: NUNCA bloquean si el ESP32 está conectado a un cargador sin PC
#define DBG_PRINT(x)         do { if (Serial) Serial.print(x); } while(0)
#define DBG_PRINTLN(x)       do { if (Serial) Serial.println(x); } while(0)
#define DBG_PRINTF(fmt, ...) do { if (Serial) Serial.printf(fmt, ##__VA_ARGS__); } while(0)

// -----------------------------------------------------------------------------
// PINES
// -----------------------------------------------------------------------------
#define MIDI_TX_PIN     21
#define MIDI_RX_PIN     20
#define STATUS_LED_PIN   8

// -----------------------------------------------------------------------------
// CONFIGURACION DEL AP
// -----------------------------------------------------------------------------
const char* AP_SSID = "Navigator3-MIDI";
const char* AP_PASS = "12345678";     // minimo 8 caracteres
const int   AP_CHANNEL = 6;           // canal fijo (1, 6 u 11 son los mejores)
const int   AP_MAX_CLIENTS = 4;       // maximo de clientes simultaneos

// -----------------------------------------------------------------------------
// SERVIDORES
// -----------------------------------------------------------------------------
WebServer       server(80);
WebSocketsServer webSocket(81);
DNSServer       dnsServer;

// -----------------------------------------------------------------------------
// COLA NOTE-OFF
// -----------------------------------------------------------------------------
struct NoteOffEvent {
  uint8_t       note;
  uint8_t       channel;
  unsigned long offTime;
  bool          active;
};

const int MAX_NOTE_EVENTS = 16;
NoteOffEvent noteOffQueue[MAX_NOTE_EVENTS];

// -----------------------------------------------------------------------------
// MIDI UART
// -----------------------------------------------------------------------------
void sendMidiNoteOn(uint8_t channel, uint8_t note, uint8_t velocity) {
  uint8_t status = 0x90 | ((channel - 1) & 0x0F);
  Serial0.write(status);
  Serial0.write(note & 0x7F);
  Serial0.write(velocity & 0x7F);
  Serial1.write(status);
  Serial1.write(note & 0x7F);
  Serial1.write(velocity & 0x7F);
  digitalWrite(STATUS_LED_PIN, LOW);
}

void sendMidiNoteOff(uint8_t channel, uint8_t note) {
  uint8_t status = 0x80 | ((channel - 1) & 0x0F);
  Serial0.write(status);
  Serial0.write(note & 0x7F);
  Serial0.write((uint8_t)0);
  Serial1.write(status);
  Serial1.write(note & 0x7F);
  Serial1.write((uint8_t)0);
  digitalWrite(STATUS_LED_PIN, HIGH);
}

void scheduleNoteOff(uint8_t channel, uint8_t note, unsigned long durationMs) {
  // Reemplazar si ya existe la misma nota+canal
  for (int i = 0; i < MAX_NOTE_EVENTS; i++) {
    if (noteOffQueue[i].active &&
        noteOffQueue[i].note == note &&
        noteOffQueue[i].channel == channel) {
      noteOffQueue[i].offTime = millis() + durationMs;
      return;
    }
  }
  // Slot libre
  for (int i = 0; i < MAX_NOTE_EVENTS; i++) {
    if (!noteOffQueue[i].active) {
      noteOffQueue[i].channel = channel;
      noteOffQueue[i].note    = note;
      noteOffQueue[i].offTime = millis() + durationMs;
      noteOffQueue[i].active  = true;
      return;
    }
  }
  // Cola llena: forzar off de la mas vieja
  int oldest = 0;
  for (int i = 1; i < MAX_NOTE_EVENTS; i++) {
    if (noteOffQueue[i].offTime < noteOffQueue[oldest].offTime) oldest = i;
  }
  sendMidiNoteOff(noteOffQueue[oldest].channel, noteOffQueue[oldest].note);
  noteOffQueue[oldest].channel = channel;
  noteOffQueue[oldest].note    = note;
  noteOffQueue[oldest].offTime = millis() + durationMs;
  noteOffQueue[oldest].active  = true;
}

void processNoteOffQueue() {
  unsigned long now = millis();
  for (int i = 0; i < MAX_NOTE_EVENTS; i++) {
    if (noteOffQueue[i].active && now >= noteOffQueue[i].offTime) {
      sendMidiNoteOff(noteOffQueue[i].channel, noteOffQueue[i].note);
      noteOffQueue[i].active = false;
    }
  }
}

// -----------------------------------------------------------------------------
// WEBSOCKET
// -----------------------------------------------------------------------------
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      DBG_PRINTF("[WS] Cliente #%u desconectado\n", num);
      break;

    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      DBG_PRINTF("[WS] Cliente #%u conectado desde %s\n", num, ip.toString().c_str());
      webSocket.sendTXT(num, "{\"type\":\"connected\",\"msg\":\"ESP32 SuperMini Listo\"}");
      // Destello breve para indicar cliente web conectado
      digitalWrite(STATUS_LED_PIN, LOW);
      delay(40);
      digitalWrite(STATUS_LED_PIN, HIGH);
      break;
    }

    case WStype_BIN: {
      // Fast path: recepcion binaria directa (status, note, velocity, duration) sin JSON
      if (length >= 3) {
        uint8_t status   = payload[0];
        uint8_t note     = payload[1];
        uint8_t velocity = payload[2];
        uint8_t dur      = (length >= 4) ? payload[3] : 60;
        uint8_t channel  = (status & 0x0F) + 1;

        if ((status & 0xF0) == 0x90) {
          sendMidiNoteOn(channel, note, velocity);
          scheduleNoteOff(channel, note, dur);
        } else if ((status & 0xF0) == 0x80) {
          sendMidiNoteOff(channel, note);
        }
      }
      break;
    }

    case WStype_TEXT: {
      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, payload, length)) return;

      const char* msgType = doc["type"] | "";

      if (strcmp(msgType, "trigger_scene") == 0) {
        uint8_t note      = doc["note"]     | 60;
        uint8_t channel   = doc["channel"]  | 1;
        uint8_t velocity  = doc["velocity"] | 127;
        unsigned long dur = doc["duration"] | 60;

        sendMidiNoteOn(channel, note, velocity);
        scheduleNoteOff(channel, note, dur);
      }
      else if (strcmp(msgType, "blackout") == 0) {
        uint8_t channel = doc["channel"] | 1;
        sendMidiNoteOn(channel, 0, 127);
        scheduleNoteOff(channel, 0, 80);
      }
      else if (strcmp(msgType, "ping") == 0) {
        webSocket.sendTXT(num, "{\"type\":\"pong\"}");
      }
      break;
    }
    default: break;
  }
}

// -----------------------------------------------------------------------------
// HANDLERS HTTP
// -----------------------------------------------------------------------------
void handleRoot() {
  server.sendHeader("Content-Encoding", "gzip");
  server.send_P(200, "text/html", (const char*)INDEX_HTML_GZ, INDEX_HTML_GZ_LEN);
}

// -----------------------------------------------------------------------------
// SETUP
// -----------------------------------------------------------------------------
void setup() {
  // 1. DESACTIVAR BROWNOUT DETECTOR
  // En cargadores de pared o powerbanks, el pico inicial de corriente Wi-Fi puede
  // causar caídas mínimas de milivoltios que reinician el ESP32 en bucle si esto está activo.
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  // 2. SERIAL NO BLOQUEANTE
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0); // CERO ms de timeout: si no hay PC conectado, descarta sin colgarse

  // 3. LED DE ESTADO: Encendido fijo durante el arranque inicial
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW); // LOW = Encendido en ESP32-C3 SuperMini

  for (int i = 0; i < MAX_NOTE_EVENTS; i++) noteOffQueue[i].active = false;

  // 4. MIDI UART a 31250 baud:
  // Serial0 -> TX exclusivo en GPIO 21
  // Serial1 -> TX exclusivo en GPIO 20
  Serial0.begin(31250, SERIAL_8N1, -1, 21);
  Serial1.begin(31250, SERIAL_8N1, -1, 20);

  // 5. CONFIGURACIÓN WI-FI AP ROBUSTA
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(100);

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);

  IPAddress apIP(192, 168, 4, 1);
  IPAddress netMsk(255, 255, 255, 0);
  WiFi.softAPConfig(apIP, apIP, netMsk);

  // Iniciar AP en canal 6 (estable, libre de interferencias)
  bool apOk = WiFi.softAP(AP_SSID, AP_PASS, 6, 0, 4);
  if (!apOk) {
    delay(200);
    WiFi.softAP(AP_SSID, AP_PASS, 6, 0, 4);
  }

  // 6. OPTIMIZACIÓN RADIO (Sin ahorro de energía = 0 lag, potencia equilibrada a 13dBm para no provocar caídas de tensión)
  delay(100);
  WiFi.setSleep(false);
  esp_wifi_set_ps(WIFI_PS_NONE);
  WiFi.setTxPower(WIFI_POWER_13dBm);

  // 7. DNS SERVER (Cualquier consulta DNS redirige a la IP del ESP32)
  dnsServer.start(53, "*", apIP);

  // 8. mDNS (navigator.local)
  MDNS.begin("navigator");
  MDNS.addService("http", "tcp", 80);

  // 9. HTTP SERVIDOR & GESTIÓN DE CAPTIVE PORTAL
  server.on("/", handleRoot);
  server.on("/index.html", handleRoot);
  server.on("/standalone.html", handleRoot);

  // Para iOS (iPhone/iPad): hotspot-detect debe devolver "Success"
  // Esto le confirma a iOS que la red está lista y EVITA que desconecte el Wi-Fi automáticamente
  server.on("/hotspot-detect.html", []() {
    server.send(200, "text/html", "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>");
  });

  // Para Android: retorno 204
  server.on("/generate_204", []() { server.send(204, "text/plain", ""); });
  server.on("/gen_204", []() { server.send(204, "text/plain", ""); });

  server.onNotFound(handleRoot);
  server.begin();
  DBG_PRINTLN("[HTTP] Servidor en puerto 80");

  // 10. WEBSOCKET
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  DBG_PRINTLN("[WS] Servidor en puerto 81");

  DBG_PRINTLN("=======================================");
  DBG_PRINTLN("  NAVIGATOR 3 MIDI AP LISTO");
  DBG_PRINTF("  http://%s  o  http://navigator.local\n", WiFi.softAPIP().toString().c_str());
  DBG_PRINTLN("=======================================\n");

  // 11. CONFIRMACIÓN VISUAL POR HARDWARE
  // 3 destellos rápidos del LED azul: AP y servidores iniciados con éxito
  for (int i = 0; i < 3; i++) {
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(70);
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(70);
  }
}

// -----------------------------------------------------------------------------
// LOOP
// -----------------------------------------------------------------------------
void loop() {
  dnsServer.processNextRequest();
  server.handleClient();
  webSocket.loop();
  processNoteOffQueue();
}