#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#if __has_include("table_config.h")
#include "table_config.h"
#else
#include "table_config.example.h"
#endif

// Protocol: 0 = off; 1 = defected/red; 2 = good/green; 3 = repairable/yellow.
static_assert(RED_PIN != GREEN_PIN && RED_PIN != YELLOW_PIN && GREEN_PIN != YELLOW_PIN,
              "Each lamp needs a different GPIO.");
static_assert(MAX_LEASE_MS >= 1000 && MAX_LEASE_MS <= 4500, "Use a lease timeout up to 4500 ms.");
static_assert(HTTP_TIMEOUT_MS >= 100 && HTTP_TIMEOUT_MS <= 1500, "HTTP timeout must be 100–1500 ms.");
static const char *FIRMWARE_VERSION = "1.0.0";
static SemaphoreHandle_t outputMutex;
static uint8_t outputCode = 0;
static uint32_t leaseDeadline = 0;
static String commandId;
static bool configured = false;
static uint32_t lastPoll = 0, lastReconnect = 0;

static int inactiveLevel() { return RELAY_ACTIVE_LOW ? HIGH : LOW; }
static int activeLevel() { return RELAY_ACTIVE_LOW ? LOW : HIGH; }
static const char *statusName(uint8_t code) {
  switch (code) { case 1: return "defected"; case 2: return "good"; case 3: return "repairable"; default: return "off"; }
}
// Caller holds outputMutex. Clear every output before energizing a different lamp.
static void writeOutput(uint8_t code) {
  digitalWrite(RED_PIN, inactiveLevel());
  digitalWrite(GREEN_PIN, inactiveLevel());
  digitalWrite(YELLOW_PIN, inactiveLevel());
  if (code == 1) digitalWrite(RED_PIN, activeLevel());
  else if (code == 2) digitalWrite(GREEN_PIN, activeLevel());
  else if (code == 3) digitalWrite(YELLOW_PIN, activeLevel());
  outputCode = code;
}
static void forceOff() {
  xSemaphoreTake(outputMutex, portMAX_DELAY);
  writeOutput(0); leaseDeadline = 0;
  xSemaphoreGive(outputMutex);
}
static uint8_t currentOutput() {
  xSemaphoreTake(outputMutex, portMAX_DELAY);
  uint8_t result = outputCode;
  xSemaphoreGive(outputMutex); return result;
}
static void applyOutput(uint8_t code, uint32_t lease) {
  xSemaphoreTake(outputMutex, portMAX_DELAY);
  if (outputCode != code) writeOutput(code);
  leaseDeadline = millis() + lease;
  xSemaphoreGive(outputMutex);
}
// Independent of HTTP requests: an unrenewed light is turned off within ~20 ms
// of lease expiry, including when the network call in loop() is blocked.
static void outputWatchdog(void *) {
  for (;;) {
    xSemaphoreTake(outputMutex, portMAX_DELAY);
    if (outputCode != 0 && static_cast<int32_t>(millis() - leaseDeadline) >= 0) {
      writeOutput(0); leaseDeadline = 0;
    }
    xSemaphoreGive(outputMutex);
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}
static bool startRequest(HTTPClient &http, WiFiClient &client, const String &path) {
  String base = SERVER_URL; if (base.endsWith("/")) base.remove(base.length()-1);
  if (!http.begin(client, base + path)) return false;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(false);
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  return true;
}
static bool pollCommand() {
  WiFiClient client; HTTPClient http;
  const uint32_t started = millis();
  if (!startRequest(http, client, String("/api/device/command?device_id=") + DEVICE_ID)) return false;
  const int response = http.GET();
  const int length = http.getSize();
  if (response != 200 || length < 1 || length > 2048) { http.end(); return false; }
  const String body = http.getString(); http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body) || !doc.is<JsonObject>() ||
      !doc["command_id"].is<const char *>() || !doc["status_code"].is<int>() ||
      !doc["status"].is<const char *>() || !doc["lease_ms"].is<uint32_t>()) return false;
  const int code = doc["status_code"].as<int>();
  const uint32_t lease = doc["lease_ms"].as<uint32_t>();
  const String id = doc["command_id"].as<String>();
  if (code < 0 || code > 3 || id.length() == 0 || id.length() > 80 ||
      String(doc["status"].as<const char *>()) != statusName(code) || lease == 0 || lease > MAX_LEASE_MS) return false;
  const uint32_t elapsed = millis() - started;
  if (elapsed >= lease) return false;
  if (id != commandId || currentOutput() != code) {
    Serial.printf("Command %s: %s (code %d)\n", id.c_str(), statusName(code), code);
  }
  commandId = id; applyOutput(static_cast<uint8_t>(code), lease - elapsed);
  return true;
}
static bool reportOutput() {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID; doc["command_id"] = commandId;
  doc["output"] = statusName(currentOutput()); doc["uptime_ms"] = millis();
  doc["rssi"] = WiFi.RSSI(); doc["firmware"] = FIRMWARE_VERSION;
  String body; serializeJson(doc, body);
  WiFiClient client; HTTPClient http;
  if (!startRequest(http, client, "/api/device/report")) return false;
  http.addHeader("Content-Type", "application/json");
  const int response = http.POST(body); http.end();
  return response == 200;
}
void setup() {
  Serial.begin(115200);
  // Preload the inactive level before changing a pin to output mode.
  for (const int pin : {RED_PIN, GREEN_PIN, YELLOW_PIN}) {
    digitalWrite(pin, inactiveLevel()); pinMode(pin, OUTPUT);
  }
  outputMutex = xSemaphoreCreateMutex();
  if (!outputMutex || xTaskCreate(outputWatchdog, "lamp-watchdog", 2048, nullptr, 2, nullptr) != pdPASS) {
    Serial.println("Cannot create output watchdog. Outputs remain off.");
    for (;;) delay(1000);
  }
  configured = String(WIFI_SSID) != "CHANGE_ME" && String(DEVICE_TOKEN).length() >= 24 &&
               !String(DEVICE_TOKEN).startsWith("CHANGE_ME") && String(SERVER_URL).startsWith("http://");
  if (!configured) { Serial.println("Create include/table_config.h with your Wi-Fi and device key. Outputs remain off."); return; }
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Cloth scanner ESP32 starting. Waiting for Wi-Fi; outputs off.");
}
void loop() {
  if (!configured) { delay(1000); return; }
  if (WiFi.status() != WL_CONNECTED) {
    forceOff();
    if (millis() - lastReconnect >= 10000) {
      lastReconnect = millis(); WiFi.reconnect(); Serial.println("Reconnecting to Wi-Fi. Outputs off.");
    }
    delay(20); return;
  }
  if (millis() - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = millis();
    if (!pollCommand()) {
      forceOff();
      // If the server is reachable, report that its command could not be held.
      reportOutput();
    } else if (!reportOutput()) forceOff();
  }
  delay(10);
}
