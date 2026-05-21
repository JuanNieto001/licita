const urls = [
  "https://www.datos.gov.co/resource/dmgg-8hin.json",
  "https://www.datos.gov.co/resource/3skv-9na7.json",
  "https://www.datos.gov.co/resource/kgcd-kt7i.json",
  "https://www.datos.gov.co/resource/f8va-cf4m.json",
];

for (const url of urls) {
  try {
    const params = new URLSearchParams({
      "$select": "proceso",
      "$group": "proceso",
      "$limit": "3",
      "$order": "proceso DESC",
    });
    const r = await fetch(url + "?" + params.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    console.log(url.split("/resource/")[1], ":", Array.isArray(data) ? data.length + " resultados" : "ERROR: " + JSON.stringify(data));
  } catch (e) {
    console.log(url.split("/resource/")[1], ": TIMEOUT/ERROR -", e.code || e.message);
  }
}
