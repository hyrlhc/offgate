// OffGate kapi firmware'i — iskelet (P8'de doldurulacak).
// Bu dosyanin simdilik tek isi: toolchain ve kutuphanelerin derlendigini
// dogrulamak, boylece gece P8'e gelindiginde indirme beklenmesin.

#include <Arduino.h>
#include <Crypto.h>
#include <Ed25519.h>
#include <ArduinoJson.h>

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("OffGate gate — iskelet derlendi");
  Serial.println("Ed25519 ve ArduinoJson baglandi.");
}

void loop() {
  delay(1000);
}
