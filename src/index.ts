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
    
    // Unfold lines (join continuation lines)
    rawICS = rawICS.replace(/\r?\n[ \t]/g, '');
    
    // Split into events - but preserve the calendar header
    const headerEndIndex = rawICS.indexOf('BEGIN:VEVENT');
    
    if (headerEndIndex === -1) {
      console.log('No events found in ICS file');
      return;
    }
    
    const calendarHeader = rawICS.substring(0, headerEndIndex);
    const eventsSection = rawICS.substring(headerEndIndex);
    
    // Split events properly
    const events = eventsSection.split('BEGIN:VEVENT').filter(event => event.trim());
    
    console.log(`Found ${events.length} total events`);
    
    // Filter events
    const filteredEvents = events.filter(event => {
      const fullEvent = 'BEGIN:VEVENT' + event;
      const shouldDelete = shouldDeleteEvent(fullEvent);
      if (shouldDelete) {
        // Extract summary for logging
        const summaryMatch = fullEvent.match(/SUMMARY:([^\r\n]*)/);
        const summary = summaryMatch ? summaryMatch[1] : 'Unknown';
        console.log(`Filtering out event: ${summary}`);
      }
      return !shouldDelete;
    });
    
    console.log(`Keeping ${filteredEvents.length} events after filtering`);
    
    // Reconstruct ICS file
    const cleanedEvents = filteredEvents.map(event => 'BEGIN:VEVENT' + event).join('');
    const cleanedICS = calendarHeader + cleanedEvents;
    
    // Ensure directory exists
    fs.mkdirSync(path.dirname(ICS_LOCAL_PATH), { recursive: true });
    fs.writeFileSync(ICS_LOCAL_PATH, cleanedICS, 'utf-8');
    
    console.log(`[${new Date().toISOString()}] ICS fetched and cleaned. Final events: ${filteredEvents.length}`);
  } catch (error) {
    console.error(`Error updating ICS:`, error);
  }
};

// Initial update
updateICSFile();

// Schedule updates every 6 hours (fixed cron syntax)
cron.schedule('0 */6 * * *', updateICSFile);

app.get('/calendar.ics', (_, res) => {
  try {
    if (!fs.existsSync(ICS_LOCAL_PATH)) {
      return res.status(404).send('Calendar file not found');
    }
    
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    
    const fileStream = fs.createReadStream(ICS_LOCAL_PATH);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error('Error reading ICS file:', err);
      res.status(500).send('Error reading calendar file');
    });
  } catch (error) {
    console.error('Error serving ICS file:', error);
    res.status(500).send('Server error');
  }
});

app.get('/', (_, res) => {
  res.send('Server is running')
})

app.listen(PORT, () => {
  console.log(`ICS server running at http://localhost:${PORT}/calendar.ics`);
});