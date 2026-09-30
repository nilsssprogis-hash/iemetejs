# Iemetējs

Disku golfa rezultātu lietotne Android telefonam. Darbojas bez interneta — visi dati glabājas telefonā.

## Uzstādīšana telefonā

1. Telefonā atver **https://github.com/nilsssprogis-hash/iemetejs/releases/latest**
2. Sadaļā *Assets* lejupielādē failu `Iemetejs-1.0.X.apk`.
3. Atver lejupielādēto failu. Ja telefons prasa, atļauj uzstādīt lietotnes no šī avota (pārlūka).
4. Jauna versija tiek uzstādīta pāri vecajai — laukumi un raundi saglabājas.

## Datu pārnešana no tīmekļa versijas

Tīmekļa versijā: **Laukumi → Eksportēt datus**. Android lietotnē: **Laukumi → Importēt Iemetēja failu**.

## Rezerves kopija

Dati ir tikai telefonā. Ik pa laikam: **Laukumi → Eksportēt datus** un saglabā failu, piemēram, Google Drive.

## Kā tiek būvēts

Katrs `push` uz `main` palaiž GitHub Actions (`.github/workflows/build-apk.yml`), kas ar Capacitor
uzbūvē APK un publicē to kā jaunu laidienu.

- `src/app.html` — visa lietotne (viens HTML fails)
- `src/native.js` — glabāšana telefonā un eksports caur Android kopīgošanu
- `scripts/build-www.mjs` — sagatavo `www/` ar lokāliem fontiem
- `assets/` — ikona un sākuma ekrāns
- `signing/debug.keystore` — parakstīšanas atslēga, lai atjauninājumi uzstādītos pāri vecajai versijai
