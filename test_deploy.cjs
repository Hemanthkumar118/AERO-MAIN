const https = require('https');
https.get('https://aero-ambulance.netlify.app/ambulance', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // Check if Google Maps API is loaded in the deployed app
    const match = data.match(/maps\.googleapis\.com/);
    console.log('Google Maps loaded:', match ? 'YES' : 'NO');
    
    // Check for any remaining Mappls references
    const mapplsMatch = data.match(/mappls/i);
    console.log('Mappls references:', mapplsMatch ? 'FOUND (needs cleanup)' : 'NONE (clean)');
  });
});
