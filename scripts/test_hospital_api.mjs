async function testApi() {
  const url = 'http://localhost:3001/api/places/hospitals?lat=17.44&lng=78.34&radius=15000&query=Apollo';
  console.log('Testing query:', url);
  try {
    const res = await fetch(url);
    const json = await res.json();
    console.log('Results count:', json.results?.length);
    if (json.results?.length > 0) {
      console.log('First 3 results:', json.results.slice(0, 3).map(r => ({ name: r.name, dist: r.distanceMeters, addr: r.address })));
    }
  } catch (e) {
    console.error('Fetch error:', e.message);
  }
}

testApi();
