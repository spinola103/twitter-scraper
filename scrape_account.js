const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const profileURL = process.argv[2] || "https://twitter.com/phantom";
const MAX_TWEETS = 5;

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
    
    // Enhanced function to check if tweet is pinned
    function isPinnedTweet(article) {
      const pinnedIndicators = [
        '[data-testid="socialContext"]',
        '[aria-label*="Pinned"]',
        '[aria-label*="pinned"]',
        'svg[aria-label*="Pinned"]',
        'svg[aria-label*="pinned"]',
        '[data-testid="pin"]'
      ];
      
      for (const selector of pinnedIndicators) {
        const element = article.querySelector(selector);
        if (element) {
          const text = (element.textContent || element.getAttribute('aria-label') || '').toLowerCase();
          if (text.includes('pinned') || text.includes('pin')) {
            return true;
          }
        }
      }
      
      // Check parent containers for pinned indicators
      const socialContext = article.querySelector('[data-testid="socialContext"]');
      if (socialContext) {
        const contextText = socialContext.textContent.toLowerCase();
        if (contextText.includes('pinned') || contextText.includes('pin')) {
          return true;
        }
      }
      
      return false;
    }
    
    // Function to check if tweet is too old (more than 30 days)
    function isTweetTooOld(timestamp) {
      if (!timestamp) return false;
      const tweetDate = new Date(timestamp);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return tweetDate < thirtyDaysAgo;
    }
    
    let processedTweets = 0;
    let recentTweetsFound = 0;
    
    // Sort articles by their position on page (newest first)
    const sortedArticles = Array.from(articles).sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top;
    });
    
    for (let i = 0; i < sortedArticles.length && processedTweets < maxTweets; i++) {
      const article = sortedArticles[i];
      
      try {
        // Skip pinned tweets
        if (isPinnedTweet(article)) {
          continue;
        }
        
        const textElement = article.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.innerText.trim() : '';
        
        // Multiple selectors for tweet links
        const linkSelectors = [
          'a[href*="/status/"]',
          'a[href*="/statuses/"]',
          '[data-testid="tweet"] a[href*="/"]'
        ];
        
        let linkElement = null;
        let link = '';
        
        for (const selector of linkSelectors) {
          linkElement = article.querySelector(selector);
          if (linkElement) {
            const href = linkElement.getAttribute('href');
            if (href && (href.includes('/status/') || href.includes('/statuses/'))) {
              link = href.startsWith('http') ? href : 'https://twitter.com' + href;
              break;
            }
          }
        }
        
        if (!link) continue;
        
        const likeElement = article.querySelector('[data-testid="like"]');
        const retweetElement = article.querySelector('[data-testid="retweet"]');
        const replyElement = article.querySelector('[data-testid="reply"]');
        
        const likes = likeElement ? extractNumber(likeElement.getAttribute('aria-label')) : 0;
        const retweets = retweetElement ? extractNumber(retweetElement.getAttribute('aria-label')) : 0;
        const replies = replyElement ? extractNumber(replyElement.getAttribute('aria-label')) : 0;
        
        // Multiple selectors for username
        const userSelectors = [
          '[data-testid="User-Name"]',
          '[data-testid="User-Names"]',
          '[data-testid="UserName"]'
        ];
        
        let username = '';
        for (const selector of userSelectors) {
          const userElement = article.querySelector(selector);
          if (userElement) {
            const usernameText = userElement.innerText;
            const lines = usernameText.split('\n');
            username = lines[0] ? lines[0].trim() : '';
            if (username) break;
          }
        }
        
        // Multiple selectors for timestamp
        const timeSelectors = ['time', '[datetime]', '[data-testid="Time"]'];
        let timestamp = '';
        
        for (const selector of timeSelectors) {
          const timeElement = article.querySelector(selector);
          if (timeElement) {
            timestamp = timeElement.getAttribute('datetime') || timeElement.getAttribute('title') || '';
            if (timestamp) break;
          }
        }
        
        // Skip tweets that are too old
        if (timestamp && isTweetTooOld(timestamp)) {
          continue;
        }
        
        const mediaElements = article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], img[alt*="Image"], video');
        const hasMedia = mediaElements.length > 0;
        
        const verifiedElement = article.querySelector('[data-testid="icon-verified"]') || 
                               article.querySelector('svg[aria-label*="Verified"]') ||
                               article.querySelector('[data-testid="verified"]');
        const isVerified = !!verifiedElement;
        
        // Count recent tweets (last 7 days)
        if (timestamp) {
          const tweetDate = new Date(timestamp);
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          if (tweetDate >= sevenDaysAgo) {
            recentTweetsFound++;
          }
        }
        
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
    
    return {
      tweets: tweetData,
      recentTweetsFound: recentTweetsFound,
      totalArticles: articles.length
    };
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
        '--disable-background-networking',
        '--disable-blink-features=AutomationControlled'
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
    
    // Enhanced cache-busting headers
    await page.setExtraHTTPHeaders({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
    
    // Randomize user agent
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
    
    // Add cache-busting parameter and try multiple attempts
    for (let attempt = 0; attempt < 3; attempt++) {
      const cacheBustURL = profileURL + (profileURL.includes('?') ? '&' : '?') + 'cb=' + Date.now() + '&v=' + attempt;
      
      try {
        await page.goto(cacheBustURL, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        
        // Extended wait for different account types
        await new Promise(resolve => setTimeout(resolve, 8000 + (attempt * 2000)));
        
        // Enhanced scrolling strategy
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          return new Promise(resolve => setTimeout(resolve, 1000));
        });
        
        // Check if we can find recent tweets
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
          if (attempt < 2) continue;
          throw new Error('Could not find any tweets on the page');
        }

        // Smart scrolling based on content loading
        for (let scroll = 0; scroll < 4; scroll++) {
          await page.evaluate((scrollIndex) => {
            const scrollAmount = window.innerHeight * (1.2 + scrollIndex * 0.3);
            window.scrollBy(0, scrollAmount);
          }, scroll);
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Check if we have enough content
          const articleCount = await page.evaluate(() => document.querySelectorAll('article').length);
          if (articleCount >= 10) break;
        }

        // Return to top for extraction
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(resolve => setTimeout(resolve, 2000));

        const extractedData = await extractTweets(page, MAX_TWEETS);
        
        // If we got recent tweets or this is our last attempt, use the data
        if (extractedData.recentTweetsFound > 0 || attempt === 2) {
          result.success = true;
          result.tweetsCount = extractedData.tweets.length;
          result.tweets = extractedData.tweets;
          result.metadata = {
            recentTweetsFound: extractedData.recentTweetsFound,
            totalArticles: extractedData.totalArticles,
            attempts: attempt + 1
          };
          break;
        }
        
        // If no recent tweets, try again with different approach
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
    }

  } catch (error) {
    result.error = error.message;
  } finally {
    if (browser) {
      await browser.close();
    }
    
    process.stdout.write(JSON.stringify(result));
  }
})();