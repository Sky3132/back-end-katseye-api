/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const https = require('https');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  console.log(`WROTE: ${filePath}`);
}

async function main() {
  const outDir = path.join(__dirname, '..', 'prisma', 'data');
  const callingCodesUrl =
    'https://gist.githubusercontent.com/anubhavshrimal/75f6183458db8c453306f93521e93d37/raw/f77e7598a8503f1f70528ae1cbf9f66755698a16/CountryCodes.json';

  const callingText = await fetchText(callingCodesUrl);
  const callingRows = JSON.parse(callingText);

  const callingCodes = (Array.isArray(callingRows) ? callingRows : [])
    .map((row) => ({
      country_code: String(row.code ?? '').trim().toUpperCase(),
      country_name: String(row.name ?? '').trim(),
      calling_code: String(row.dial_code ?? '').trim(),
    }))
    .filter((r) => r.country_code && r.calling_code);

  writeJson(path.join(outDir, 'calling-codes.json'), callingCodes);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

