const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const profileURL = process.argv[2] || "https://twitter.com/phantom";
const MAX_TWEETS = 10;

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
    
    for (let i = 0; i < Math.min(articles.length, maxTweets); i++) {
      const article = articles[i];
      
      try {
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
          index: i + 1,
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
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(profileURL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    await new Promise(resolve => setTimeout(resolve, 3000));

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

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

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