const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const profileURL = process.argv[2] || "https://twitter.com/phantom";
const MAX_TWEETS = 5; // Changed to 5 tweets

async function extractTweets(page, maxTweets) {
  const tweets = await page.evaluate((maxTweets) => {
    const tweetData = [];
    const articles = document.querySelectorAll('article');
    
    function extractNumber(ariaLabel) {
      if (!ariaLabel) return 0;
      const match = ariaLabel.match(/[\d,]+/);
      if (!match) return 0;
      return parseInt(match[0].replace(/,/g, ''), 10) || 0;
    }
    
    // Function to check if tweet is pinned
    function isPinnedTweet(article) {
      // Look for pinned tweet indicators
      const pinnedIndicators = [
        '[data-testid="socialContext"]', // Common pinned tweet indicator
        '[aria-label*="Pinned"]',
        '[aria-label*="pinned"]',
        'svg[aria-label*="Pinned"]',
        'svg[aria-label*="pinned"]'
      ];
      
      for (const selector of pinnedIndicators) {
        const element = article.querySelector(selector);
        if (element) {
          const text = element.textContent || element.getAttribute('aria-label') || '';
          if (text.toLowerCase().includes('pinned')) {
            return true;
          }
        }
      }
      
      // Check for "Pinned Tweet" text in social context
      const socialContext = article.querySelector('[data-testid="socialContext"]');
      if (socialContext && socialContext.textContent.toLowerCase().includes('pinned')) {
        return true;
      }
      
      return false;
    }
    
    let processedTweets = 0;
    
    for (let i = 0; i < articles.length && processedTweets < maxTweets; i++) {
      const article = articles[i];
      
      try {
        // Skip pinned tweets
        if (isPinnedTweet(article)) {
          continue;
        }
        
        const textElement = article.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.innerText.trim() : '';
        
        const linkElement = article.querySelector('a[href*="/status/"]');
        const link = linkElement ? 'https://twitter.com' + linkElement.getAttribute('href') : '';
        
        if (!link) continue;
        
        const likeElement = article.querySelector('[data-testid="like"]');
        const retweetElement = article.querySelector('[data-testid="retweet"]');
        const replyElement = article.querySelector('[data-testid="reply"]');
        
        const likes = likeElement ? extractNumber(likeElement.getAttribute('aria-label')) : 0;
        const retweets = retweetElement ? extractNumber(retweetElement.getAttribute('aria-label')) : 0;
        const replies = replyElement ? extractNumber(replyElement.getAttribute('aria-label')) : 0;
        
        const userElement = article.querySelector('[data-testid="User-Name"]');
        let username = '';
        if (userElement) {
          const usernameText = userElement.innerText;
          const lines = usernameText.split('\n');
          username = lines[0] ? lines[0].trim() : '';
        }
        
        const timeElement = article.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
        
        const mediaElements = article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], img[alt*="Image"]');
        const hasMedia = mediaElements.length > 0;
        
        const verifiedElement = article.querySelector('[data-testid="icon-verified"]') || 
                               article.querySelector('svg[aria-label*="Verified"]');
        const isVerified = !!verifiedElement;
        
        tweetData.push({
          index: processedTweets + 1,
          username: username,
          text: text,
          link: link,
          timestamp: timestamp,
          replies: replies,
          retweets: retweets,
          likes: likes,
          verified: isVerified,
          hasMedia: hasMedia,
          mediaCount: mediaElements.length,
          extractedAt: new Date().toISOString()
        });
        
        processedTweets++;
        
      } catch (error) {
        continue;
      }
    }
    
    return tweetData;
  }, maxTweets);
  
  return tweets;
}

(async () => {
  let browser;
  let result = {
    success: false,
    url: profileURL,
    tweetsCount: 0,
    tweets: [],
    scrapedAt: new Date().toISOString()
  };
  
  try {
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
        '--disable-images',
        '--disable-notifications',
        '--disable-background-networking'
      ],
      defaultViewport: { width: 1200, height: 800 }
    });

    const page = await browser.newPage();
    
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Add cache-busting headers and random parameters to try to get fresh content
    await page.setExtraHTTPHeaders({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT'
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Add random parameter to URL to bypass caching
    const cacheBustURL = profileURL + (profileURL.includes('?') ? '&' : '?') + 'cb=' + Date.now();
    
    await page.goto(cacheBustURL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // Wait longer and try multiple refresh techniques
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Try to force refresh by multiple scroll actions
    await page.evaluate(() => {
      // Simulate human-like scrolling behavior
      window.scrollTo(0, 50);
      setTimeout(() => window.scrollTo(0, 0), 500);
    });
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try refreshing the page once more to get latest content
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 5000));

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

    // Scroll to load enough tweets, but start from top to get latest ones
    await page.evaluate(() => window.scrollTo(0, 0)); // Ensure we're at top
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
      await new Promise(resolve => setTimeout(resolve, 2500)); // Increased wait time
    }
    
    // Scroll back to top to process from newest tweets
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(resolve => setTimeout(resolve, 2000));

    const tweets = await extractTweets(page, MAX_TWEETS);
    
    result.success = true;
    result.tweetsCount = tweets.length;
    result.tweets = tweets;

  } catch (error) {
    result.error = error.message;
  } finally {
    if (browser) {
      await browser.close();
    }
    
    process.stdout.write(JSON.stringify(result));
  }
})();