const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function test() {
  const lat = 17.4339; 
  const lng = 78.5280;
  const radiusMeters = 5000;

  const query = `
    [out:json][timeout:30];
    (
      node["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lng});
      way["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lng});
      relation["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lng});
      node["healthcare"~"hospital|clinic|doctor"](around:${radiusMeters},${lat},${lng});
      way["healthcare"~"hospital|clinic|doctor"](around:${radiusMeters},${lat},${lng});
      relation["healthcare"~"hospital|clinic|doctor"](around:${radiusMeters},${lat},${lng});
    );
    out center;
  `;

  console.log("Fetching...");
  try {
    const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'AERO-Ambulance-App/1.0'
        },
        body: new URLSearchParams({ data: query }).toString(),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response text length:", text.length);
    if(res.status === 200) {
      const json = JSON.parse(text);
      console.log("Elements count:", json.elements?.length);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
