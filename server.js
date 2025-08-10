const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Twitter Scraper API is running on Railway', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      error: 'URL is required',
      example: { url: 'https://twitter.com/phantom' }
    });
  }

  // Validate Twitter URL
  if (!url.includes('twitter.com') && !url.includes('x.com')) {
    return res.status(400).json({
      error: 'Invalid URL. Must be a Twitter/X profile URL',
      example: { url: 'https://twitter.com/phantom' }
    });
  }

  console.log(`🚀 Starting scrape for: ${url}`);
  
  const command = `node scrape_account.js "${url}"`;
  const timeout = 180000; // 3 minutes timeout for Railway
  
  exec(command, { 
    timeout, 
    cwd: __dirname,
    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
  }, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Scraping failed:', error.message);
      return res.status(500).json({
        error: 'Scraping failed',
        message: error.message,
        stderr: stderr
      });
    }

    try {
      // Extract JSON from stdout
      const lines = stdout.split('\n');
      let jsonStartIndex = -1;
      
      // Find the line that starts the JSON output
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('📄 JSON Output:')) {
          jsonStartIndex = i + 1;
          break;
        }
      }
      
      if (jsonStartIndex === -1) {
        // Fallback: look for array start
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith('[')) {
            jsonStartIndex = i;
            break;
          }
        }
      }
      
      if (jsonStartIndex !== -1) {
        const jsonLines = lines.slice(jsonStartIndex);
        const jsonString = jsonLines.join('\n').trim();
        const tweets = JSON.parse(jsonString);
        
        console.log(`✅ Successfully scraped ${tweets.length} tweets`);
        
        res.json({
          success: true,
          url: url,
          tweetsCount: tweets.length,
          tweets: tweets,
          scrapedAt: new Date().toISOString()
        });
      } else {
        throw new Error('Could not find JSON output in response');
      }
      
    } catch (parseError) {
      console.error('❌ JSON parsing failed:', parseError.message);
      console.log('Raw stdout:', stdout);
      
      res.status(500).json({
        error: 'Failed to parse scraping results',
        message: parseError.message,
        rawOutput: stdout.substring(0, 1000) // Limit output size
      });
    }
  });
});

// GET endpoint for simple URL-based scraping
app.get('/scrape/:username', (req, res) => {
  const { username } = req.params;
  const url = `https://twitter.com/${username}`;
  
  // Forward to POST endpoint
  req.body = { url };
  const mockReq = { body: { url }, method: 'POST' };
  return app.handle(mockReq, res);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Twitter Scraper API running on port ${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   GET  /                     - Health check`);
  console.log(`   POST /scrape               - Scrape with JSON body`);
  console.log(`   GET  /scrape/:username     - Scrape Twitter username`);
  console.log(`🚀 Ready for Railway deployment!`);
});