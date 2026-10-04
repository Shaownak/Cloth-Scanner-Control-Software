#pragma once
// Copy this file to table_config.h and edit before uploading to your ESP32.
// Or download table_config.h from the dashboard's Device & setup page.
#define WIFI_SSID "CHANGE_ME"
#define WIFI_PASSWORD "CHANGE_ME"
#define SERVER_URL "http://192.168.1.10:8090"
#define DEVICE_ID "table-01"
#define DEVICE_TOKEN "CHANGE_ME_DEVICE_TOKEN"

// ESP32 DevKit / WROOM-32 GPIO numbers, not connector positions.
#define RED_PIN 25
#define GREEN_PIN 26
#define YELLOW_PIN 27
#define RELAY_ACTIVE_LOW true
#define POLL_INTERVAL_MS 400UL
#define HTTP_TIMEOUT_MS 1000
#define MAX_LEASE_MS 4500UL
