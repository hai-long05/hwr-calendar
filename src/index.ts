import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';

const app = express();
const PORT = process.env.PORT || 3000;

const ICS_SOURCE_URL =
  'https://moodle.hwr-berlin.de/fb2-stundenplan/download.php?doctype=.ics&url=./fb2-stundenplaene/wi/semester5/kursa';
const ICS_LOCAL_PATH = path.join(__dirname, 'data', 'calendar.ics');

const DESCRIPTIONS_TO_DELETE = [
  'Cross Cultural Management',
  'Ethik in Wirtschaft und Gesellschaft',
  'Recht der Künstlichen Intelligenz',
  'Supply Chain Management',
  'Lean Management',
  'Nachhaltiges Wirtschaften',
  'Wirtschaftsenglisch',
  'Ökonometrie',
  'Trends und Zukunft der WI',
  'Theoretische Informatik',
  'Angewandte Wohlfahrtsstaatentheorie',
];

const DESCRIPTION_REGEX = new RegExp(
  DESCRIPTIONS_TO_DELETE.map(desc => desc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

const shouldDeleteEvent = (event: string): boolean => {
  return DESCRIPTION_REGEX.test(event);
};

// Fetch, clean, and save ICS file
const updateICSFile = async () => {
  try {
    const response = await axios.get(ICS_SOURCE_URL, { responseType: 'text' });
    let rawICS = response.data as string;

    rawICS = rawICS.replace(/\r?\n[ \t]/g, '');

    const parts = rawICS.split(/(?=BEGIN:VEVENT)/);

    const filtered = parts.filter(event => !shouldDeleteEvent(event));

    const cleanedICS = filtered.join('').trim();

    console.log(cleanedICS);
    fs.mkdirSync(path.dirname(ICS_LOCAL_PATH), { recursive: true });
    fs.writeFileSync(ICS_LOCAL_PATH, cleanedICS, 'utf-8');

    console.log(`[${new Date().toISOString()}] ICS fetched and cleaned.`);
  } catch (error) {
    console.error(`Error updating ICS:`, error);
  }
};

updateICSFile();

cron.schedule('0 */6 * * *', updateICSFile);

app.get('/calendar.ics', (req, res) => {
  res.setHeader('Content-Type', 'text/calendar');
  const fileStream = fs.createReadStream(ICS_LOCAL_PATH);
  fileStream.pipe(res);
});

app.listen(PORT, () => {
  console.log(`ICS server running at http://localhost:${PORT}/calendar.ics`);
});
