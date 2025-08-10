const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

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

// Unified scraping function using spawn for better control
async function scrapeTwitterProfile(url, res) {
  if (res.headersSent) {
    return;
  }
  
  return new Promise((resolve) => {
    let jsonOutput = '';
    let hasResponded = false;
    
    const child = spawn('node', ['scrape_account.js', url], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Set timeout
    const timeout = setTimeout(() => {
      if (!hasResponded) {
        hasResponded = true;
        child.kill();
        res.status(408).json({
          error: 'Request timeout',
          message: 'Scraping took too long',
          url: url
        });
        resolve();
      }
    }, 120000); // 2 minutes
    
    // Collect stdout data
    child.stdout.on('data', (data) => {
      jsonOutput += data.toString();
    });
    
    // Handle process completion
    child.on('close', (code) => {
      if (hasResponded) return;
      
      clearTimeout(timeout);
      hasResponded = true;
      
      try {
        // Clean the output - remove any extra whitespace or newlines
        const cleanOutput = jsonOutput.trim();
        
        if (!cleanOutput) {
          return res.status(500).json({
            error: 'No output received',
            message: 'The scraper produced no output',
            url: url
          });
        }
        
        // Parse JSON
        const result = JSON.parse(cleanOutput);
        
        if (result.success) {
          res.json(result);
        } else {
          res.status(500).json({
            error: 'Scraping failed',
            message: result.error || 'Unknown error occurred',
            url: url
          });
        }
        
      } catch (parseError) {
        res.status(500).json({
          error: 'Failed to parse response',
          message: 'Invalid JSON output from scraper',
          url: url,
          rawOutput: jsonOutput.substring(0, 500) // First 500 chars for debugging
        });
      }
      
      resolve();
    });
    
    // Handle errors
    child.on('error', (error) => {
      if (hasResponded) return;
      
      clearTimeout(timeout);
      hasResponded = true;
      
      res.status(500).json({
        error: 'Process error',
        message: error.message,
        url: url
      });
      
      resolve();
    });
    
    // Handle stderr
    child.stderr.on('data', (data) => {
      const errorMessage = data.toString();
      if (errorMessage.includes('Error') && !hasResponded) {
        clearTimeout(timeout);
        hasResponded = true;
        
        res.status(500).json({
          error: 'Scraper error',
          message: errorMessage.trim(),
          url: url
        });
        
        resolve();
      }
    });
  });
}

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
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

  await scrapeTwitterProfile(url, res);
});

// GET endpoint for usernames
app.get('/scrape/:username', async (req, res) => {
  const url = `https://twitter.com/${req.params.username}`;
  await scrapeTwitterProfile(url, res);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (res.headersSent) {
    return next(err);
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Twitter Scraper API running on port ${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   GET  /                     - Health check`);
  console.log(`   POST /scrape               - Scrape with JSON body`);
  console.log(`   GET  /scrape/:username     - Scrape by username`);
});