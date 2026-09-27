const https = require('https');
https.get('https://aero-ambulance.netlify.app/ambulance', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const match = data.match(/src="\/assets\/(index-[^\.]+\.js)"/);
    if (match) {
      https.get('https://aero-ambulance.netlify.app/assets/' + match[1], res2 => {
        let jsData = '';
        res2.on('data', chunk => jsData += chunk);
        res2.on('end', () => {
          const keyMatch = jsData.match(/apis\.mappls\.com\/advancedmaps\/api\/([^\/]+)\/map_sdk/);
          console.log('Deployed Key:', keyMatch ? keyMatch[1] : 'Not Found');
        });
      });
    } else {
      console.log('JS file not found in HTML');
    }
  });
});
