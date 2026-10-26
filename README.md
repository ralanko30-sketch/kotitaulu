# Kotitaulu

Yksi sivu, jolla näkyvät kotikameroiden kuvat, sää ja ennuste, auton lataustaso, sähkönkulutus, lähialueen varoitukset ja liikenne sekä tuoreimmat uutiset.

Sivu pyörii Netlifyssa. Kamerakuvat ja sähkönkulutuksen lähettää pieni ohjelma Windows-koneeltasi aina, kun kone on päällä. Muuta laitetta ei tarvita.

```
Windows-kone ──(kamerakuvat, kulutus)──▶ Netlify ◀──(sää, uutiset, liikenne, auto)── avoimet rajapinnat
                                            │
                                     puhelin / selain
```

| Osa | Mistä | Tarvitsee |
|---|---|---|
| Sää, ennuste, säävaroitukset | Ilmatieteen laitoksen avoin data (varalla Open-Meteo) | ei mitään |
| Liikennetiedotteet ja tietyöt | Fintraffic Digitraffic | ei mitään |
| Uutiset | Ylen RSS-syötteet | ei mitään |
| Auto | FordConnect Query (Fordin virallinen rajapinta) | Ford-kehittäjätili, kertaluontoinen kirjautuminen |
| Kamerat | Tapo-kameroiden RTSP-virta kotiverkossa | kotiagentti Windows-koneella |
| Sähkönkulutus | Caruna Plus | kotiagentti ja Caruna Plus -tunnukset |

---

## 1. Netlify-sivu

### Julkaisu

Netlify Drop (raahaa ja pudota) ei aja palvelinfunktioita, joten julkaise jommallakummalla tavalla:

**GitHubin kautta (suositus):** vie tämä kansio omaan yksityiseen GitHub-repoosi. Netlifyssa valitse *Add new site → Import an existing project* ja valitse repo. Asetukset luetaan `netlify.toml`-tiedostosta.

**Netlify CLI:llä:**

```
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

### Ympäristömuuttujat

Netlifyssa: *Site configuration → Environment variables*. Julkaise sivu uudelleen muutosten jälkeen.

| Muuttuja | Pakollinen | Mitä |
|---|---|---|
| `SITE_PASSWORD` | kyllä | Salasana, jolla kirjaudut sivulle |
| `SESSION_SECRET` | kyllä | Satunnainen merkkijono, väh. 16 merkkiä. Kirjautumisevästeiden allekirjoitukseen |
| `AGENT_KEY` | kyllä | Satunnainen merkkijono, väh. 24 merkkiä. Sama arvo kotiagentin `config.json`-tiedostoon |
| `HOME_LAT`, `HOME_LON` | ei | Kodin koordinaatit. Oletus on Lappeenrannan keskusta |
| `HOME_PLACE` | ei | Paikkakunta säähavaintoja varten. Oletus `Lappeenranta` |
| `AREA_RADIUS_KM` | ei | Liikennetiedotteiden säde. Oletus `40` (tietyöt aina enintään 15 km) |
| `NEWS_FEEDS` | ei | Omat uutissyötteet muodossa `Nimi\|osoite,Nimi\|osoite`. Oletus Ylen pääuutiset ja Etelä-Karjala |
| `SITUATION_URL` | ei | Lähialue-osion linkki. Oletus Tilannehuone.fi |
| `FORD_CLIENT_ID`, `FORD_CLIENT_SECRET` | auto-osioon | Ks. kohta 2 |

Satunnaiset arvot saat PowerShellillä:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

Kun muuttujat on asetettu, avaa sivu ja kirjaudu. Sää, uutiset ja lähialue näkyvät heti.

---

## 2. Ford (lataustaso)

FordConnect Query on Fordin virallinen, vain lukeva rajapinta. Se näyttää lataustason, toimintamatkan, latausjohdon tilan, lukituksen, mittarilukeman ja sijainnin. Autoa sillä ei voi ohjata.

1. Rekisteröidy osoitteessa [developer.ford.com](https://developer.ford.com/) (EU-portaali).
2. Luo sovellus, jolle valitset FordConnect Query -rajapinnan.
3. Anna uudelleenohjausosoitteeksi (Redirect URL) tarkalleen:
   `https://SIVUSI-OSOITE/api/ford-callback`
4. Kopioi sovelluksen Client ID ja Client Secret Netlifyyn muuttujiin `FORD_CLIENT_ID` ja `FORD_CLIENT_SECRET` ja julkaise uudelleen.
5. Avaa Kotitaulu ja paina *Yhdistä Ford-tili*. Kirjaudu FordPass-tunnuksillasi ja hyväksy käyttöoikeus.

Hyvä tietää:
- Auton tiedot haetaan enintään viiden minuutin välein, jotta Fordin kutsurajat eivät täyty.
- Ford vaatii uuden kirjautumisen noin kerran vuodessa. Silloin auto-osioon ilmestyy taas *Yhdistä Ford-tili* -painike.
- Home Assistantin FordConnect-integraation tekijä suosittelee erillistä FordPass-tiliä, jolle auto on jaettu. Sama neuvo pätee tähän.

---

## 3. Tapo-kamerat

Jokaiselle kameralle tarvitaan **kameratili**, joka on eri kuin Tapo-sovelluksen kirjautuminen:

1. Avaa Tapo-sovellus → valitse kamera → rataskuvake → *Lisäasetukset* → *Kameratili*.
2. Luo käyttäjätunnus ja salasana.
3. Katso kameran IP-osoite kohdasta *Laitteen tiedot*. Lukitse se reitittimen asetuksista (DHCP-varaus), ettei osoite vaihdu.

Akkukäyttöisissä Tapo-malleissa RTSP-virta voi puuttua kokonaan. Verkkovirralla toimivissa malleissa (esim. C100, C200, C310, C320WS, C500, C520WS) se on tuettu.

---

## 4. Kotiagentti Windows-koneelle

Kansio `agent` sisältää ohjelman, joka ottaa kuvan jokaisesta kamerasta viiden minuutin välein ja hakee sähkönkulutuksen kolmen tunnin välein.

1. Kopioi `agent`-kansio koneellesi, esimerkiksi `C:\Kotitaulu\agent`.
2. Jos koneessa ei ole Pythonia, asenna se: `winget install Python.Python.3.12`
3. Kaksoisnapsauta `asenna.bat`. Ensimmäisellä kerralla se avaa `config.json`-tiedoston Muistioon.
4. Täytä tiedostoon:
   - `site_url`: sivusi osoite
   - `agent_key`: sama kuin Netlifyn `AGENT_KEY`
   - `cameras`: jokaiselle kameralle oma rivi. `id` saa sisältää vain pieniä kirjaimia a–z, numeroita ja väliviivoja; `name` on sivulla näkyvä nimi
   - `caruna`: Caruna Plus -sähköposti ja -salasana. Jätä `TÄYTÄ`-arvot paikalleen, jos et halua kulutusta
5. Tallenna ja kaksoisnapsauta `asenna.bat` uudelleen. Se tekee testikierroksen ja lisää agentin käynnistymään automaattisesti, kun kirjaudut Windowsiin.

Muut tiedostot:
- `testaa-kamerat.bat` ottaa kuvat kaikista kameroista tähän kansioon lähettämättä mitään. Käytä tätä, jos kamera ei näy sivulla.
- `poista.bat` pysäyttää agentin ja poistaa automaattisen käynnistyksen.
- `kotiagentti.log` kertoo, mitä agentti on tehnyt.

Sivun yläreunassa näkyy, milloin kotikone on viimeksi ollut yhteydessä. Jos kamerakuva on yli 20 minuuttia vanha, se näkyy harmaana.

---

## 5. Sähkönkulutus (Caruna)

Agentti kirjautuu Caruna Plussaan samoilla tunnuksilla kuin selaimessa ja hakee kuluvan ja edellisen kuukauden päiväkulutukset sekä eilisen tuntikulutuksen. Caruna päivittää tiedot noin vuorokauden viiveellä.

Haku käyttää avoimen lähdekoodin [pycaruna](https://github.com/Jalle19/pycaruna)-kirjastoa, joka matkii Caruna Plussan kirjautumista. Se ei ole Carunan virallinen rajapinta, joten se voi lakata toimimasta, jos Caruna muuttaa palveluaan. Jos niin käy, sähköosio kertoo viimeisimmän virheen ja muu sivu toimii normaalisti.

---

## 6. Tilannehuone

Tilannehuone.fi on yksityinen sivusto ilman julkista rajapintaa, joten sen sisältöä ei kopioida tänne. Lähialue-osiossa on linkki sivustolle, ja samaan osioon kootaan viralliset tiedot: Ilmatieteen laitoksen varoitukset kotisi alueelle ja Fintrafficin liikennetiedotteet.

---

## Tietoturva

- Kaikki data kulkee kirjautumisen vaativien rajapintojen kautta. Itse HTML-sivu ei sisällä mitään yksityistä.
- Kamerakuvat tallentuvat vain sivustosi Netlify Blobs -säilöön. Jokaisesta kamerasta säilytetään vain uusin kuva.
- Kameroiden ja Carunan tunnukset ovat vain kotikoneesi `config.json`-tiedostossa, eivät Netlifyssa.
- Agentti lähettää vain sivullesi, ja se tunnistautuu `AGENT_KEY`-avaimella.
- Kirjautuminen on voimassa 30 päivää. *Kirjaudu ulos* poistaa sen kyseiseltä laitteelta. Jos haluat kirjata kaikki laitteet ulos, vaihda `SESSION_SECRET`.

## Kehitys

```
node test/run.mjs                 # testit simuloiduilla vastauksilla
node test/devserver.mjs           # esikatselu esimerkkidatalla: http://localhost:8888, salasana demo
```
