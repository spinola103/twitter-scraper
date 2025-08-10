const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const profileURL = process.argv[2] || "https://twitter.com/phantom";
const MAX_TWEETS = 6;

async function extractTweets(page, maxTweets) {
  const tweets = await page.evaluate((maxTweets) => {
    const tweetData = [];
    const articles = document.querySelectorAll('article');
    
    // Helper function to extract numbers from aria-labels
    function extractNumber(ariaLabel) {
      if (!ariaLabel) return 0;
      const match = ariaLabel.match(/[\d,]+/);
      if (!match) return 0;
      return parseInt(match[0].replace(/,/g, ''), 10) || 0;
    }
    
    for (let i = 0; i < Math.min(articles.length, maxTweets); i++) {
      const article = articles[i];
      
      try {
        // Get tweet text
        const textElement = article.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.innerText.trim() : '';
        
        // Get tweet link
        const linkElement = article.querySelector('a[href*="/status/"]');
        const link = linkElement ? 'https://twitter.com' + linkElement.getAttribute('href') : '';
        
        // Get engagement metrics
        const likeElement = article.querySelector('[data-testid="like"]');
        const retweetElement = article.querySelector('[data-testid="retweet"]');
        const replyElement = article.querySelector('[data-testid="reply"]');
        
        const likes = likeElement ? extractNumber(likeElement.getAttribute('aria-label')) : 0;
        const retweets = retweetElement ? extractNumber(retweetElement.getAttribute('aria-label')) : 0;
        const replies = replyElement ? extractNumber(replyElement.getAttribute('aria-label')) : 0;
        
        // Get user info
        const userElement = article.querySelector('[data-testid="User-Name"]');
        const username = userElement ? userElement.innerText.split('\n')[0].trim() : '';
        
        // Get timestamp
        const timeElement = article.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
        
        // Check for media
        const mediaElements = article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]');
        const hasMedia = mediaElements.length > 0;
        
        // Only include tweets with content
        if (text || hasMedia || link) {
          tweetData.push({
            username: username,
            text: text,
            link: link,
            timestamp: timestamp,
            replies: replies,
            retweets: retweets,
            likes: likes,
            hasMedia: hasMedia,
            extractedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        // Skip failed tweets silently
        continue;
      }
    }
    
    return tweetData;
  }, maxTweets);
  
  return tweets;
}

(async () => {
  let browser;
  
  try {
    // Railway-optimized configuration
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--window-size=1200,800',
        '--single-process',
        '--no-zygote',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images'
      ],
      defaultViewport: { width: 1200, height: 800 }
    });

    const page = await browser.newPage();
    
    // Set realistic headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to profile
    await page.goto(profileURL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // Wait for initial content
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Try to find tweets
    const selectors = ['article', '[data-testid="tweet"]', '[role="article"]'];
    let tweetsFound = false;
    
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        tweetsFound = true;
        break;
      } catch (e) {
        continue;
      }
    }
    
    if (!tweetsFound) {
      throw new Error('Could not find any tweets on the page');
    }

    // Scroll to load more tweets
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Extract tweets
    const tweets = await extractTweets(page, MAX_TWEETS);
    
    // Output only clean JSON
    console.log(JSON.stringify({
      success: true,
      url: profileURL,
      tweetsCount: tweets.length,
      tweets: tweets,
      scrapedAt: new Date().toISOString()
    }));

  } catch (error) {
    // Output error as JSON
    console.log(JSON.stringify({
      success: false,
      error: error.message,
      url: profileURL,
      tweetsCount: 0,
      tweets: [],
      scrapedAt: new Date().toISOString()
    }));
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();