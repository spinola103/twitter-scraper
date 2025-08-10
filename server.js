const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Twitter Scraper API is running', 
    timestamp: new Date().toISOString()
  });
});

// Unified scraping function
async function scrapeTwitterProfile(url, res) {
  console.log(`🚀 Starting scrape for: ${url}`);
  
  const command = `node scrape_account.js "${url}"`;
  const timeout = 180000; // 3 minutes for Railway
  
  exec(command, { 
    timeout, 
    cwd: __dirname,
    maxBuffer: 1024 * 1024 * 10 // 10MB buffer
  }, (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Scraping failed:', error.message);
      return res.status(500).json({
        error: 'Scraping failed',
        message: error.message
      });
    }

    try {
      // Find JSON output in stdout
      const lines = stdout.split('\n');
      let jsonStartIndex = lines.findIndex(line => line.includes('📄 JSON Output:'));
      
      if (jsonStartIndex !== -1) {
        jsonStartIndex += 1; // Skip the marker line
      } else {
        // Fallback: look for array start
        jsonStartIndex = lines.findIndex(line => line.trim().startsWith('['));
      }
      
      if (jsonStartIndex !== -1) {
        const jsonString = lines.slice(jsonStartIndex).join('\n').trim();
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
        throw new Error('Could not find JSON output');
      }
      
    } catch (parseError) {
      console.error('❌ JSON parsing failed:', parseError.message);
      res.status(500).json({
        error: 'Failed to parse scraping results',
        message: parseError.message
      });
    }
  });
}

// Main scraping endpoint
app.post('/scrape', (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      error: 'URL is required',
      example: { url: 'https://twitter.com/username' }
    });
  }

  // Validate Twitter URL
  if (!url.includes('twitter.com') && !url.includes('x.com')) {
    return res.status(400).json({
      error: 'Invalid URL. Must be a Twitter/X profile URL'
    });
  }

  scrapeTwitterProfile(url, res);
});

// GET endpoint for usernames
app.get('/scrape/:username', (req, res) => {
  const url = `https://twitter.com/${req.params.username}`;
  scrapeTwitterProfile(url, res);
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Twitter Scraper API running on port ${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   GET  /                     - Health check`);
  console.log(`   POST /scrape               - Scrape with JSON body`);
  console.log(`   GET  /scrape/:username     - Scrape by username`);
});