# Oma treenisivu Garmin-datalla – asennusohje

Tällä ohjeella saat oman treenisivun, joka hakee tietosi Garminista automaattisesti joka yö. Sivulla on harjoitusvalmius (0–100), treenien intensiteettityypit, aika sykealueilla, lajikohtaiset kehityskäyrät, huomiot ja itsestään mukautuva treenikalenteri.

Kaikki tehdään selaimessa, ohjelmointitaitoja ei tarvita. Aikaa menee noin 20–30 minuuttia. Kaikki palvelut ovat ilmaisia.

**Tarvitset:**

- Garmin-kellon ja Garmin Connect -tilin
- Tietokoneen (puhelimella asennus on hankalaa, mutta valmista sivua voi käyttää puhelimella)

> Tärkeää: Garminin Personal API on tarkoitettu vain omien tietojen hakemiseen. Jokainen tekee siis oman sivunsa omalla avaimellaan. Älä koskaan anna omaa avaintasi kenellekään.

---

## Vaihe 1: Luo Garmin API -avain

1. Kirjaudu tietokoneella Garmin Connectiin ja avaa sivu:
   https://connect.garmin.com/app/settings/personalApiToken
2. Valitse **Create Key** ja hyväksy käyttöehdot.
3. Valitse voimassaoloajaksi **1 vuosi** ja paina **Create**.
4. **Kopioi avain heti talteen** (esim. salasanamanageriin tai muistioon). Garmin näyttää sen vain kerran. Jos se katoaa, poista avain ja tee uusi.

Avain on kuin salasana: älä lähetä sitä viesteissä tai liitä mihinkään muualle kuin vaiheen 4 Netlify-asetukseen.

---

## Vaihe 2: Lataa tiedostot GitHubiin

GitHub on paikka, jossa sivuston tiedostot säilytetään.

1. Mene osoitteeseen https://github.com ja luo ilmainen tili (**Sign up**).
2. Paina oikeasta yläkulmasta **+** → **New repository**.
3. Anna nimeksi esim. `treenisivu`.
4. Valitse **Private**, jotta kukaan muu ei näe tiedostoja.
5. Ruksi **Add a README file** ja paina **Create repository**.
6. Pura saamasi zip-tiedosto koneellesi. Avaa purettu `treenisivu`-kansio, jotta näet sen sisällön:
   `public`, `lib`, `netlify`, `netlify.toml`, `package.json` (ja tämä ohje).
7. GitHubissa: **Add file → Upload files**.
8. Valitse kansiosta kaikki kohdat ja raahaa ne selainikkunaan.
   Älä raahaa zip-tiedostoa tai ylintä `treenisivu`-kansiota, vaan sen sisältö.
9. Paina alhaalta **Commit changes**.

Tarkista, että repon etusivulla näkyvät kansiot `public`, `lib` ja `netlify`.

---

## Vaihe 3: Julkaise sivusto Netlifyssä

Netlify pyörittää sivustoa ja hakee tiedot Garminilta.

1. Mene osoitteeseen https://www.netlify.com ja luo ilmainen tili. Helpointa on kirjautua GitHub-tunnuksilla.
2. Valitse **Add new site → Import an existing project → GitHub**.
3. Anna Netlifylle lupa käyttää GitHubia ja valitse `treenisivu`-repo.
4. Jätä asetukset ennalleen ja paina **Deploy**.

Sivusto julkaistaan nyt, mutta se ei vielä toimi, koska avain puuttuu.

---

## Vaihe 4: Lisää avain ja salasana Netlifyyn

Netlifyssä sivustosi asetuksissa: **Site configuration → Environment variables → Add a variable → Add a single variable**

**Ensimmäinen muuttuja – Garmin-avain:**

| Kenttä | Mitä laitat |
|---|---|
| Key | `GARMIN_API_KEY` |
| Contains secret values | ✅ ruksi |
| Scopes | All scopes (tai varmista, että Functions on mukana) |
| Values | Valitse **Different value for each deploy context** ja liitä avain **vain kohtaan Production**. Jätä muut tyhjiksi. |

Paina **Create variable**.

**Toinen muuttuja – sivuston salasana:**

| Kenttä | Mitä laitat |
|---|---|
| Key | `SITE_PASSWORD` |
| Contains secret values | ✅ ruksi |
| Values | Keksi oma salasana, jolla kirjaudut treenisivulle. Laita se kohtaan **Production**. Älä käytä samaa salasanaa kuin Garminissa. |

Paina **Create variable**.

**Lopuksi:** mene **Deploys**-välilehdelle ja valitse **Trigger deploy → Deploy site**. Tämä tarvitaan, jotta sivusto saa avaimen käyttöön.

---

## Vaihe 5: Ota sivu käyttöön

1. Kun julkaisu on valmis (vihreä **Published**), avaa sivustosi osoite. Se näkyy Netlifyn etusivulla, esim. `https://jotain-satunnaista.netlify.app`.
   Osoitteen voi vaihtaa kohdasta **Site configuration → Change site name**.
2. Kirjaudu `SITE_PASSWORD`-salasanallasi.
3. Sivu hakee tiedot Garminilta ensimmäisellä kerralla automaattisesti. Jos ei, paina oikean yläkulman **Päivitä**.
4. Käy **Asetuksissa**: tarkista treenimäärät viikossa (myös HYROX), viikkotavoite tunteina, lepopäivä ja pitkän treenin päivä. Lisää tavoitetapahtumat ja Garmin-avaimen vanhenemispäivä. Paina **Tallenna asetukset**.
5. Mene **Kehitys**-välilehdelle ja paina **Hae tarkemmat tiedot**. Sivu lukee treenien alkuperäiset tiedostot, joista saadaan VO2max-historia, kierrokset (HYROX-analyysi) ja nopeimmat juoksumatkat.

Asetuksissa näkyy myös, onnistuiko viimeisin haku: jokaisen rivin edessä pitäisi olla vihreä ✓. Yläpalkin pallo kertoo saman yhdellä silmäyksellä: vihreä = ajan tasalla, keltainen = yli vuorokauden vanha, punainen = haku epäonnistui.

**Puhelimeen:** iPhonessa Safari → Jaa → **Lisää Koti-valikkoon**, Androidissa Chrome → ⋮ → **Asenna sovellus**. Sivu toimii silloin kuin sovellus, ja viimeksi haetut tiedot näkyvät myös ilman verkkoa. Kirjautumisessa voit valita **Muista minut**, ettei salasanaa tarvitse antaa joka kerta.

---

## Miten sivu toimii

- **Tiedot päivittyvät automaattisesti joka yö** noin klo 5. Napista **Päivitä** voit hakea ne milloin vain.
- Ensimmäisellä haulla haetaan puolen vuoden treenit. Asetuksista voi valita pidemmän historian (1 tai 2 vuotta), jolloin vanhempia treenejä haetaan 3 kuukautta kerrallaan. Palautumishistoria (HRV, uni, leposyke, Body Battery, stressi) täydentyy 4 viikkoa kerrallaan. Sykealueiden bpm-rajat haetaan suoraan Garminista.

### Välilehdet

- **Tänään**: päivän tilanne eli harjoitusvalmius 0–100 ja sen osatekijät (HRV, uni ja unen vaiheet, Body Battery, leposyke, treenikuorma, stressi). Vieressä tämän päivän treeni kalenterista tarkkoine sisältöineen ja kolme ehdotusta, joista paras on merkitty suositukseksi. "Vaihda" näyttää muita vaihtoehtoja. Sen alla tärkeimmät huomiot, viimeisimmän treenin analyysi (vertailu aiempiin vastaaviin ja HYROX-kierrokset), viikon kuorma ja tilanne sekä kunto (VO2max, kuntoikä) ja tavoitetapahtuman lähtölaskenta. Maanantaisin ja tiistaisin näkyy myös edellisen viikon katsaus.
- **Treenit**: valitse **Kaikki** tai yksittäinen laji (juoksu, pyöräily, HYROX, voima & HIIT, muu). Kaikki-näkymässä summat lajeittain (kuukausi, edellinen kuukausi, vuosi), viikoittaiset tunnit ja **treeniloki**, jota voi suodattaa lajin, tyypin, aikavälin ja nimen mukaan. Lajinäkymissä lisäksi vauhti tai teho vakiosykkeellä, juoksuennätykset (1 km, 5 km, 10 km…), HYROX-juoksujen hidastuminen asemien jälkeen ja sykealueet. **Napauta treeniä** nähdäksesi sykealueet, kierrokset ja vertailun aiempiin.
- **Kehitys**: valitse aikaväli (4 vk – 1 v). Ylhäällä viikkokatsaus ja huomiot, sitten kolme ryhmää: **Kunto** (VO2max, vauhti sykkeellä), **Kuormitus** (kuorma lajeittain, sykealueet ja 80/20-jakauma, treenityypit) ja **Palautuminen** (HRV, leposyke, uni, syvä uni, Body Battery, stressi). Heikkenevät trendit näytetään ensin.
- **Kalenteri**: viikko- tai kuukausinäkymä. Automaattisilla treeneillä on tarkka sisältö (esim. intervallit sykealueineen). Napauta treeniä, niin voit **siirtää** sen toiselle päivälle, piilottaa sen tai muokata omia treenejäsi. **+-napilla** lisäät oman treenin: tulevan, jo tehdyn tai viikoittain toistuvan (esim. joka torstai klo 16). Viikon otsikon alla näkyy suunniteltu ja toteutunut aika. Sivun lopussa on linkki, jolla suunnitelman voi **tilata puhelimen kalenteriin**.
- **Asetukset**: treenimäärät ja viikkotavoite, tavoitetapahtumat (A/B/C), lajien tunnistus (esim. jonkin treenityypin jättäminen pois analyyseistä), historian pituus, Garmin-avaimen vanhenemispäivä, Station guide -linkki, varmuuskopio ja hakujen tila.

### Tavoitetapahtumat ja harjoituskaudet

- **A** = päätavoite: kalenteri keventää 2 viikkoa ennen, ja sivu näyttää harjoituskauden (perusjakso → kehitysjakso → kisaan valmistava jakso → kevennys).
- **B** = tärkeä tapahtuma: kevennys viikkoa ennen.
- **C** = harjoituskisa: vain kisapäivä ja kevyt edellinen päivä.

### Vauhti sykkeellä

Juoksujen ja pyörälenkkien kehitystä seurataan muuntamalla jokaisen treenin vauhti (tai teho) samaan sykkeeseen. Viitesyke on omien peruslenkkiesi tyypillinen syke. Näin eri päivien treenit ovat vertailukelpoisia: kun vauhti samalla sykkeellä nopeutuu, kunto paranee.

### Harjoitusvalmius 0–100

Lasketaan joka päivä viidestä osasta:

| Osa | Paino | Mitä katsotaan |
|---|---|---|
| Treenikuorma | 28 % | Kahden edellisen päivän kuorma ja viikon kuorma suhteessa tavalliseen |
| HRV | 25 % | Viime yön HRV suhteessa Garminin laskemaan normaalialueeseesi |
| Uni | 22 % | Unipisteet tai unen määrä, viime yö painottuu |
| Body Battery | 15 % | Taso herätessä |
| Leposyke | 10 % | Ero 30 päivän keskiarvoon |

**75+** korkea valmius (hyvä päivä kovalle), **50–74** kohtalainen, **30–49** matala (kevyt treeni), **alle 30** lepo. Jos jokin tieto puuttuu, pisteet lasketaan muista. Matalalla valmiudella kalenteri vaihtaa päivän kovan treenin kevyeksi.

### Treenityypit ja sykealueet

Jokainen treeni saa intensiteettityypin. Värit kulkevat kylmästä kuumaan, eli mitä lämpimämpi väri, sitä kovempi treeni:

| Tyyppi | Väri | Mitä tarkoittaa |
|---|---|---|
| Palauttava | sininen | Hyvin kevyt, syke pääosin alueella 1 |
| Peruskestävyys | violetti | Aerobinen perustreeni, pääosin alue 2 |
| Tempo | pinkki | Reipas aerobinen, paljon aikaa alueella 3 |
| Kynnys | punainen | Maitohappokynnyksen tuntumassa, alue 4 |
| VO2max | oranssi | Kovat intervallit, aikaa alueella 5 |
| Anaerobinen | keltainen | Lyhyet maksimaaliset vedot ja sprintit |
| Voima | turkoosi | Voimatreeni, jossa syke ei kuvaa kuormaa |

Jos Garmin on itse arvioinut treenin pääasiallisen vaikutuksen, käytetään sitä. Muuten tyyppi päätellään siitä, kuinka paljon aikaa kullakin sykealueella vietettiin, ja tarvittaessa Training Effect -arvoista. Sykealueet Z1–Z5 käyttävät samoja värejä.

Sivu ei ole valmentaja eikä lääkäri. Ehdotukset ovat suuntaa antavia, ja oma tuntemus menee aina edelle.

---

## Kerran vuodessa: avaimen uusiminen

Garmin lähettää sähköpostia noin viikkoa ennen kuin avain vanhenee. Silloin:

1. Luo uusi avain Garmin Connectissa (vaihe 1).
2. Netlifyssä: **Environment variables → GARMIN_API_KEY → Edit**, liitä uusi avain kohtaan Production ja tallenna.
3. **Deploys → Trigger deploy → Deploy site**.

---

## Ongelmatilanteita

| Ongelma | Ratkaisu |
|---|---|
| Kirjautuminen ei onnistu | Tarkista `SITE_PASSWORD` Netlifyssä ja tee **Trigger deploy** muutoksen jälkeen. |
| Virhe "GARMIN_API_KEY puuttuu" | Avainta ei ole lisätty tai sitä ei ole laitettu kohtaan Production. Lisää ja tee **Trigger deploy**. |
| Asetuksissa punainen ✗ ja virhe 401 | Avain on vanhentunut, poistettu tai kopioitu väärin. Tee uusi avain ja vaihda se Netlifyyn. |
| Kalenterilinkki lakkasi toimimasta | Linkki muodostetaan sivuston salasanasta. Jos vaihdoit salasanan, kopioi uusi linkki Kalenteri-välilehdeltä. |
| HYROX-kierroksia ei näy | Paina kellossa lap-nappia jokaisen juoksun ja aseman vaihtuessa, ja hae tarkemmat tiedot Kehitys-välilehdeltä. |
| Jokin luku näyttää viivaa (–) | Tietoa ei ole vielä haettu tai kello ei mittaa sitä. Paina **Päivitä** ja odota seuraavaa yötä. Harjoitusvalmius tarkentuu, kun palautumishistoriaa kertyy muutama viikko. |
| Sykealueiden bpm-rajat puuttuvat | Tarkista, että sykealueet on asetettu Garmin Connectissa, ja paina **Päivitä**. |
| Sivu on tyhjä | Varmista, että GitHubissa näkyvät kansiot `public`, `lib` ja `netlify` suoraan repon juuressa. |
