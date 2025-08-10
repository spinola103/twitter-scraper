const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
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
    version: '1.0.0',
    node_version: process.version
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
  
  // Use spawn instead of exec to avoid stream issues
  const child = spawn('node', ['scrape_account.js', url], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('❌ Scraping failed with code:', code);
      return res.status(500).json({
        error: 'Scraping failed',
        message: `Process exited with code ${code}`,
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
        rawOutput: stdout.substring(0, 1000)
      });
    }
  });

  // Set timeout for the request
  const timeout = setTimeout(() => {
    child.kill();
    res.status(408).json({
      error: 'Request timeout',
      message: 'Scraping took too long (>3 minutes)'
    });
  }, 180000); // 3 minutes

  child.on('close', () => {
    clearTimeout(timeout);
  });
});

// GET endpoint for simple URL-based scraping
app.get('/scrape/:username', (req, res) => {
  const { username } = req.params;
  const url = `https://twitter.com/${username}`;
  
  // Create a new request object and pass to POST handler
  const newReq = {
    ...req,
    method: 'POST',
    body: { url }
  };
  
  // Call the POST handler directly
  app._router.stack.find(layer => 
    layer.route && layer.route.path === '/scrape' && layer.route.methods.post
  ).route.stack[0].handle(newReq, res);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'Endpoint not found',
    availableEndpoints: [
      'GET /',
      'POST /scrape',
      'GET /scrape/:username'
    ]
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Twitter Scraper API running on port ${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   GET  /                     - Health check`);
  console.log(`   POST /scrape               - Scrape with JSON body`);
  console.log(`   GET  /scrape/:username     - Scrape Twitter username`);
  console.log(`🚀 Ready for Railway deployment!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});