"""
Tapo-kameroiden liike- ja henkilötapahtumat ONVIFin kautta (kotiverkossa, portti 2020).

Kevyt toteutus ilman ulkoisia ONVIF-kirjastoja: WS-Security UsernameToken -tunnistus,
CreatePullPointSubscription ja PullMessages. Tapahtumien kuuntelu ei käytä videovirtaa,
joten se ei varaa kameraa.
"""
from __future__ import annotations

import base64
import hashlib
import os
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import requests

NS = {
    "s": "http://www.w3.org/2003/05/soap-envelope",
    "wsa": "http://www.w3.org/2005/08/addressing",
    "wsnt": "http://docs.oasis-open.org/wsn/b-2",
    "tt": "http://www.onvif.org/ver10/schema",
    "tds": "http://www.onvif.org/ver10/device/wsdl",
    "tev": "http://www.onvif.org/ver10/events/wsdl",
}


def _security(user: str, password: str) -> str:
    nonce = os.urandom(16)
    created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    digest = base64.b64encode(hashlib.sha1(nonce + created.encode() + password.encode()).digest()).decode()
    return (
        '<wsse:Security s:mustUnderstand="1" '
        'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" '
        'xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">'
        f"<wsse:UsernameToken><wsse:Username>{_x(user)}</wsse:Username>"
        '<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">'
        f"{digest}</wsse:Password>"
        '<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">'
        f"{base64.b64encode(nonce).decode()}</wsse:Nonce>"
        f"<wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security>"
    )


def _x(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class OnvifError(RuntimeError):
    pass


class EventListener:
    """Yhden kameran tapahtumatilaus."""

    def __init__(self, host: str, user: str, password: str, port: int = 2020, timeout: int = 15):
        self.host, self.user, self.password, self.port = host, user, password, port
        self.timeout = timeout
        self.base = f"http://{host}:{port}"
        self.sub_addr: str | None = None
        self.http = requests.Session()

    def _call(self, url: str, action: str, body: str, read_timeout: float | None = None) -> ET.Element:
        envelope = (
            f'<s:Envelope xmlns:s="{NS["s"]}" xmlns:wsa="{NS["wsa"]}" xmlns:tds="{NS["tds"]}" '
            f'xmlns:tev="{NS["tev"]}" xmlns:wsnt="{NS["wsnt"]}">'
            f"<s:Header>{_security(self.user, self.password)}"
            f"<wsa:Action>{action}</wsa:Action><wsa:MessageID>urn:uuid:{uuid.uuid4()}</wsa:MessageID>"
            f"<wsa:To>{_x(url)}</wsa:To></s:Header>"
            f"<s:Body>{body}</s:Body></s:Envelope>"
        )
        try:
            r = self.http.post(
                url,
                data=envelope.encode(),
                headers={"Content-Type": f'application/soap+xml; charset=utf-8; action="{action}"'},
                timeout=(5, read_timeout or self.timeout),
            )
        except requests.RequestException as e:
            raise OnvifError(f"ei yhteyttä kameran ONVIF-porttiin {self.port}: {type(e).__name__}") from e
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError:
            raise OnvifError(f"kamera vastasi {r.status_code} ilman kelvollista XML:ää")
        fault = root.find(".//s:Fault", NS)
        if fault is not None or r.status_code >= 400:
            text = " ".join(t.strip() for t in (fault.itertext() if fault is not None else []) if t.strip())
            if "NotAuthorized" in text or "authority" in text.lower() or r.status_code == 401:
                raise OnvifError("kamera hylkäsi tunnukset (käytä Tapo-sovelluksen kameratilin tunnuksia)")
            raise OnvifError(f"ONVIF-virhe {r.status_code}: {text[:160]}")
        return root

    def events_url(self) -> str:
        root = self._call(
            f"{self.base}/onvif/device_service",
            "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
            "<tds:GetCapabilities><tds:Category>Events</tds:Category></tds:GetCapabilities>",
        )
        x = root.find(".//tt:Events/tt:XAddr", NS)
        return self._local(x.text.strip()) if x is not None and x.text else f"{self.base}/onvif/service"

    def _local(self, a: str) -> str:
        """Osa kameroista ilmoittaa osoitteissa väärän isännän; vaihdetaan se kameran IP:ksi."""
        if "://" not in a:
            return a
        rest = a.split("://", 1)[1]
        path = rest[rest.find("/"):] if "/" in rest else "/"
        hostport = rest.split("/", 1)[0]
        port = hostport.rsplit(":", 1)[1] if ":" in hostport else "80"
        return f"http://{self.host}:{port}{path}"

    def subscribe(self, minutes: int = 10) -> None:
        url = self.events_url()
        root = self._call(
            url,
            "http://www.onvif.org/ver10/events/wsdl/EventPortType/CreatePullPointSubscriptionRequest",
            f"<tev:CreatePullPointSubscription><tev:InitialTerminationTime>PT{minutes}M</tev:InitialTerminationTime>"
            "</tev:CreatePullPointSubscription>",
        )
        addr = root.find(".//tev:SubscriptionReference/wsa:Address", NS)
        if addr is None or not addr.text:
            raise OnvifError("kamera ei antanut tapahtumatilausta")
        self.sub_addr = self._local(addr.text.strip())

    def renew(self, minutes: int = 10) -> None:
        if not self.sub_addr:
            return self.subscribe(minutes)
        self._call(
            self.sub_addr,
            "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest",
            f"<wsnt:Renew><wsnt:TerminationTime>PT{minutes}M</wsnt:TerminationTime></wsnt:Renew>",
        )

    def pull(self, wait_seconds: int = 10, limit: int = 20) -> list[dict]:
        if not self.sub_addr:
            self.subscribe()
        body = (
            f"<tev:PullMessages><tev:Timeout>PT{wait_seconds}S</tev:Timeout>"
            f"<tev:MessageLimit>{limit}</tev:MessageLimit></tev:PullMessages>"
        )
        action = "http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest"
        try:
            root = self._call(self.sub_addr, action, body, read_timeout=wait_seconds + 10)
        except OnvifError as e:
            # Jos tilauksen osoitteen portti ei vastaa, kokeillaan samaa polkua ONVIF-portissa.
            alt = f"{self.base}/{self.sub_addr.split('/', 3)[3]}" if self.sub_addr.count("/") >= 3 else None
            if "ei yhteyttä" not in str(e) or not alt or alt == self.sub_addr:
                raise
            root = self._call(alt, action, body, read_timeout=wait_seconds + 10)
            self.sub_addr = alt
        return parse_notifications(root)

    def unsubscribe(self) -> None:
        if not self.sub_addr:
            return
        try:
            self._call(self.sub_addr, "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest", "<wsnt:Unsubscribe/>")
        except OnvifError:
            pass
        self.sub_addr = None


def parse_notifications(root: ET.Element) -> list[dict]:
    out = []
    for n in root.iterfind(".//wsnt:NotificationMessage", NS):
        topic = (n.findtext("wsnt:Topic", default="", namespaces=NS) or "").strip()
        msg = n.find(".//tt:Message", NS)
        data = {}
        if msg is not None:
            for it in msg.iterfind(".//tt:Data/tt:SimpleItem", NS):
                data[it.get("Name")] = it.get("Value")
        out.append({
            "topic": topic.split(":", 1)[-1] if ":" in topic else topic,
            "data": data,
            "time": msg.get("UtcTime") if msg is not None else None,
            "op": msg.get("PropertyOperation") if msg is not None else None,
        })
    return out


TRUE = {"true", "1", "yes"}


def classify(ev: dict) -> str | None:
    """Palauttaa 'henkilö', 'ajoneuvo', 'eläin', 'liike' tai None (tapahtuma päättyi / ei kiinnosta)."""
    topic = ev["topic"].lower()
    data = {k.lower(): str(v).lower() for k, v in ev["data"].items()}
    active = any(v in TRUE for v in data.values())
    if not active:
        return None
    if "people" in topic or "person" in topic or data.get("ispeople") in TRUE or data.get("isperson") in TRUE:
        return "henkilö"
    if "vehicle" in topic or data.get("isvehicle") in TRUE:
        return "ajoneuvo"
    if "pet" in topic or "animal" in topic or data.get("ispet") in TRUE:
        return "eläin"
    if "motion" in topic or "ismotion" in data:
        return "liike"
    return None
