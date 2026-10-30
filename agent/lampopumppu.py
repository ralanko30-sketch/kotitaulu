"""
Electrolux-ilmalämpöpumpun paikallinen ohjaus kotiverkossa.

Electrolux Home Comfort -laitteissa on Broadlink-pohjainen WiFi-moduuli (tyyppi 0x4F9B),
jota voi ohjata suoraan kotiverkossa ilman pilveä. Protokolla perustuu yhteisön
avoimeen työhön (DotEfekts/ElectroluxClimateComponent ja Volp02/electrolux_local, MIT).
"""
from __future__ import annotations

import json
import struct

import broadlink
from broadlink.device import Device

DEVICE_TYPE = 0x4F9B

MODES = {0: "Jäähdytys", 1: "Lämmitys", 2: "Kuivaus", 3: "Puhallin", 4: "Automaatti", 6: "Ylläpitolämpö 8 °C"}
FANS = {0: "Automaatti", 1: "Hidas", 2: "Keski", 3: "Nopea", 4: "Turbo", 5: "Hiljainen"}


class ElectroluxHeatPump(Device):
    TYPE = "ELECTROLUX_OEM"

    def _send(self, command: int, data: bytes = b"") -> dict:
        packet = bytearray(0xD)
        packet[0x00:0x02] = command.to_bytes(2, "little")
        packet[0x02:0x06] = bytes.fromhex("a5a55a5a")
        packet[0x08] = 0x01 if len(data) <= 2 else 0x02
        packet[0x09] = 0x0B
        packet[0xA:0xB] = len(data).to_bytes(2, "little")
        packet.extend(data)
        checksum = sum(packet[0x08:], 0xC0AD) & 0xFFFF
        packet[0x06:0x08] = checksum.to_bytes(2, "little")

        try:
            resp = self.send_packet(0x6A, packet)
        except Exception:
            self.auth()
            resp = self.send_packet(0x6A, packet)
        err = resp[0x22:0x24]
        if err != b"\x00\x00":
            raise RuntimeError(f"laite palautti virhekoodin {err.hex()}")
        dec = self.decrypt(resp[0x38:])
        length = struct.unpack("<H", dec[0xA:0xC])[0]
        payload = dec[0xE:0xE + length]
        return json.loads(payload)

    def status(self) -> dict:
        return self._send(0x0E, b"{}")

    def set_power(self, on: bool) -> dict:
        return self._send(0x18, ('{"ac_pwr":%d}' % (1 if on else 0)).encode())

    def set_temp(self, temp: int) -> dict:
        temp = max(16, min(32, int(temp)))
        return self._send(0x17, ('{"temp":%d}' % temp).encode())

    def set_mode(self, mode: int) -> dict:
        if mode not in MODES:
            raise ValueError("tuntematon tila")
        return self._send(0x19, ('{"ac_mode":%d}' % mode).encode())

    def set_fan(self, fan: int) -> dict:
        if fan not in FANS:
            raise ValueError("tuntematon puhallinnopeus")
        return self._send(0x19, ('{"ac_mark":%d}' % fan).encode())


def connect(host: str) -> ElectroluxHeatPump:
    """Avaa yhteyden lämpöpumppuun IP-osoitteella."""
    dev = broadlink.hello(host, timeout=5)
    hp = ElectroluxHeatPump((host, 80), dev.mac, dev.devtype, timeout=6)
    if not hp.auth():
        raise RuntimeError("tunnistautuminen laitteeseen epäonnistui")
    return hp


def discover(timeout: int = 6) -> list:
    """Etsii Broadlink-laitteet kotiverkosta."""
    return broadlink.discover(timeout=timeout)


def summarize(st: dict) -> dict:
    """Muuntaa laitteen tilan Kotitaulun muotoon."""
    on = st.get("ac_pwr") == 1
    return {
        "on": on,
        "mode": st.get("ac_mode"),
        "modeText": MODES.get(st.get("ac_mode"), str(st.get("ac_mode"))),
        "target": st.get("temp"),
        "room": st.get("envtemp"),
        "fan": st.get("ac_mark"),
        "fanText": FANS.get(st.get("ac_mark"), str(st.get("ac_mark"))),
        "swing": st.get("ac_vdir") == 1,
    }
