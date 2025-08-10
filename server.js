const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
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
  if (res.headersSent) {
    return;
  }
  
  try {
    const command = `node scrape_account.js "${url}"`;
    const timeout = 120000; // 2 minutes
    
    const { stdout, stderr } = await execAsync(command, { 
      timeout,
      cwd: __dirname,
      maxBuffer: 1024 * 1024 * 20, // 20MB buffer
      encoding: 'utf8'
    });

    // Parse the JSON output directly
    const result = JSON.parse(stdout.trim());
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({
        error: 'Scraping failed',
        message: result.error,
        url: url
      });
    }

  } catch (error) {
    if (res.headersSent) {
      return;
    }
    
    let errorMessage = error.message;
    
    if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Request timeout - the scraping took too long';
    } else if (error.stdout) {
      // Try to parse partial JSON output
      try {
        const result = JSON.parse(error.stdout.trim());
        return res.status(500).json(result);
      } catch (parseError) {
        errorMessage = `Execution failed: ${errorMessage}`;
      }
    }
    
    res.status(500).json({
      error: 'Scraping failed',
      message: errorMessage,
      url: url
    });
  }
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
  process.exit(1);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Twitter Scraper API running on port ${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   GET  /                     - Health check`);
  console.log(`   POST /scrape               - Scrape with JSON body`);
  console.log(`   GET  /scrape/:username     - Scrape by username`);
});