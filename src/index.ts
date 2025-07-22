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

// Create minimal valid ICS header if missing
const createMinimalICSHeader = (): string => {
  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Custom ICS Server//EN
METHOD:PUBLISH
CALSCALE:GREGORIAN
`;
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
    
    // Ensure proper ICS headers exist
    let calendarHeader = '';
    const headerEndIndex = rawICS.indexOf('BEGIN:VEVENT');
    
    if (headerEndIndex === -1) {
      console.log('No events found in ICS file');
      // Create minimal valid calendar structure
      calendarHeader = rawICS.includes('BEGIN:VCALENDAR') ? 
        rawICS.substring(0, rawICS.indexOf('END:VCALENDAR')) : 
        createMinimalICSHeader();
    } else {
      calendarHeader = rawICS.substring(0, headerEndIndex);
    }
    
    // Ensure required headers are present
    if (!calendarHeader.includes('VERSION:')) {
      calendarHeader = calendarHeader.replace('BEGIN:VCALENDAR\n', 'BEGIN:VCALENDAR\nVERSION:2.0\n');
    }
    if (!calendarHeader.includes('PRODID:')) {
      calendarHeader = calendarHeader.replace('BEGIN:VCALENDAR\n', 'BEGIN:VCALENDAR\nPRODID:-//Custom ICS Server//EN\n');
    }
    if (!calendarHeader.includes('METHOD:')) {
      calendarHeader += 'METHOD:PUBLISH\n';
    }
    
    if (headerEndIndex === -1) {
      console.log('No events found in ICS file');
      // Still save the calendar structure even without events
      const cleanedICS = rawICS.replace(/\n/g, '\r\n');
      fs.mkdirSync(path.dirname(ICS_LOCAL_PATH), { recursive: true });
      fs.writeFileSync(ICS_LOCAL_PATH, cleanedICS, 'utf-8');
      return;
    }
    
    const eventsSection = rawICS.substring(headerEndIndex);
    
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
    
    let cleanedICS = rawICS.substring(0, headerEndIndex);
    
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

// Add CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.get('/calendar.ics', (req, res) => {
  try {
    if (!fs.existsSync(ICS_LOCAL_PATH)) {
      return res.status(404).send('Calendar file not found');
    }
    
    // Set proper headers for ICS file
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Don't set Content-Disposition as attachment for subscription feeds
    // res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    
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

// Add a route for Google Calendar subscription link
app.get('/subscribe', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const icsUrl = `${baseUrl}/calendar.ics`;
  const googleSubscribeUrl = `https://www.google.com/calendar/render?cid=webcal://${req.get('host')}/calendar.ics`;
  
  res.send(`
    <html>
      <head><title>Calendar Subscription</title></head>
      <body>
        <h1>Subscribe to Calendar</h1>
        <p><strong>ICS URL:</strong> <a href="${icsUrl}">${icsUrl}</a></p>
        <p><strong>Google Calendar:</strong> <a href="${googleSubscribeUrl}">Subscribe in Google Calendar</a></p>
        <p><strong>Manual subscription:</strong> Copy this URL and paste it into your calendar app: <code>${icsUrl}</code></p>
      </body>
    </html>
  `);
});

app.get('/', (_, res) => {
  res.send('Server is running')
})

app.listen(PORT, () => {
  console.log(`ICS server running at http://localhost:${PORT}/calendar.ics`);
});