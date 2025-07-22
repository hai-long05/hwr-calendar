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
    
    console.log('Raw ICS file size:', rawICS.length);
    
    // Normalize line endings first
    rawICS = rawICS.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Unfold lines (join continuation lines)
    rawICS = rawICS.replace(/\n[ \t]/g, '');
    
    // Validate basic ICS structure
    if (!rawICS.includes('BEGIN:VCALENDAR') || !rawICS.includes('END:VCALENDAR')) {
      throw new Error('Invalid ICS file: Missing VCALENDAR wrapper');
    }
    
    // Split into events - but preserve the calendar header
    const headerEndIndex = rawICS.indexOf('BEGIN:VEVENT');
    
    if (headerEndIndex === -1) {
      console.log('No events found in ICS file');
      // Still save the calendar structure even without events
      const cleanedICS = rawICS.replace(/\n/g, '\r\n');
      fs.mkdirSync(path.dirname(ICS_LOCAL_PATH), { recursive: true });
      fs.writeFileSync(ICS_LOCAL_PATH, cleanedICS, 'utf-8');
      return;
    }
    
    const calendarHeader = rawICS.substring(0, headerEndIndex);
    const eventsSection = rawICS.substring(headerEndIndex);
    const calendarFooter = eventsSection.includes('END:VCALENDAR') ? 
      eventsSection.substring(eventsSection.lastIndexOf('END:VCALENDAR')) : 'END:VCALENDAR\n';
    
    // Split events properly
    const eventParts = eventsSection.split('BEGIN:VEVENT').filter(event => event.trim());
    
    console.log(`Found ${eventParts.length} total events`);
    
    // Filter and validate events
    const validFilteredEvents = eventParts.map(eventPart => {
      const fullEvent = 'BEGIN:VEVENT' + eventPart;
      return fullEvent;
    }).filter(event => {
      // Basic validation: ensure event has END:VEVENT
      if (!event.includes('END:VEVENT')) {
        console.log('Skipping invalid event (no END:VEVENT)');
        return false;
      }
      
      // Filter out unwanted events
      const shouldDelete = shouldDeleteEvent(event);
      if (shouldDelete) {
        const summaryMatch = event.match(/SUMMARY:([^\r\n]*)/);
        const summary = summaryMatch ? summaryMatch[1] : 'Unknown';
        console.log(`Filtering out event: ${summary}`);
        return false;
      }
      
      return true;
    });
    
    console.log(`Keeping ${validFilteredEvents.length} valid events after filtering`);
    
    // Reconstruct ICS file with proper formatting
    let cleanedICS = calendarHeader;
    
    // Add events
    validFilteredEvents.forEach(event => {
      cleanedICS += event;
    });
    
    // Ensure proper calendar ending
    if (!cleanedICS.endsWith('END:VCALENDAR')) {
      if (cleanedICS.includes('END:VCALENDAR')) {
        // Remove existing END:VCALENDAR and add it properly
        cleanedICS = cleanedICS.substring(0, cleanedICS.lastIndexOf('END:VCALENDAR'));
      }
      cleanedICS += 'END:VCALENDAR\n';
    }
    
    // Convert to CRLF line endings as required by ICS standard
    cleanedICS = cleanedICS.replace(/\n/g, '\r\n');
    
    // Ensure directory exists
    fs.mkdirSync(path.dirname(ICS_LOCAL_PATH), { recursive: true });
    fs.writeFileSync(ICS_LOCAL_PATH, cleanedICS, 'utf-8');
    
    console.log(`[${new Date().toISOString()}] ICS fetched and cleaned. Final events: ${validFilteredEvents.length}`);
    console.log('Final ICS file size:', cleanedICS.length);
    
    // Log first few lines for debugging
    const firstLines = cleanedICS.split('\r\n').slice(0, 10).join('\r\n');
    console.log('First 10 lines of ICS file:');
    console.log(firstLines);
    
  } catch (error) {
    console.error(`Error updating ICS:`, error);
  }
};

// Initial update
updateICSFile();

// Schedule updates every 6 hours (fixed cron syntax)
cron.schedule('0 */6 * * *', updateICSFile);

app.get('/calendar.ics', (req, res) => {
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