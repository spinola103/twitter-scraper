const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ 
    status: 'Twitter Scraper API is running', 
    timestamp: new Date().toISOString()
  });
});

async function scrapeTwitterProfile(url, res) {
  if (res.headersSent) {
    return;
  }
  
  return new Promise((resolve) => {
    let jsonOutput = '';
    let errorOutput = '';
    let hasResponded = false;
    
    const child = spawn('node', ['scrape_account.js', url], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8'
    });
    
    const timeout = setTimeout(() => {
      if (!hasResponded) {
        hasResponded = true;
        child.kill('SIGKILL');
        res.status(408).json({
          error: 'Request timeout',
          message: 'Scraping took too long',
          url: url
        });
        resolve();
      }
    }, 120000);
    
    child.stdout.on('data', (data) => {
      jsonOutput += data.toString('utf8');
    });
    
    child.stderr.on('data', (data) => {
      errorOutput += data.toString('utf8');
    });
    
    child.on('close', (code) => {
      if (hasResponded) return;
      
      clearTimeout(timeout);
      hasResponded = true;
      
      try {
        const cleanOutput = jsonOutput.trim();
        
        if (!cleanOutput) {
          return res.status(500).json({
            error: 'No output received',
            message: 'The scraper produced no output',
            url: url,
            stderr: errorOutput
          });
        }
        
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
          message: parseError.message,
          url: url,
          rawOutput: jsonOutput.substring(0, 200),
          stderr: errorOutput
        });
      }
      
      resolve();
    });
    
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
  });
}

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      error: 'URL is required',
      example: { url: 'https://twitter.com/username' }
    });
  }

  if (!url.includes('twitter.com') && !url.includes('x.com')) {
    return res.status(400).json({
      error: 'Invalid URL. Must be a Twitter/X profile URL'
    });
  }

  await scrapeTwitterProfile(url, res);
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Twitter Scraper API running on port ${PORT}`);
  console.log(`📝 Endpoint: POST /scrape`);
});