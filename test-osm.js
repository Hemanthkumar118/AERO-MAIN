const url = 'https://overpass-api.de/api/interpreter';
const query = `[out:json][timeout:60];
(
  node['amenity'~'hospital|clinic|doctors'](around:50000,17.44,78.34);
  way['amenity'~'hospital|clinic|doctors'](around:50000,17.44,78.34);
  relation['amenity'~'hospital|clinic|doctors'](around:50000,17.44,78.34);
);
out center;`;
fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  .then(r => {
    console.log(r.status, r.statusText);
    return r.json();
  })
  .then(data => console.log('Count:', data.elements ? data.elements.length : 0))
  .catch(e => console.error(e.message));
