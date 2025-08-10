const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const profileURL = process.argv[2] || "https://twitter.com/phantom";
const MAX_TWEETS = 10;

async function extractTweets(page, maxTweets) {
  console.log('🔍 Extracting tweets...');
  
  const tweets = await page.evaluate((maxTweets) => {
    const tweetData = [];
    const articles = document.querySelectorAll('article');
    
    for (let i = 0; i < Math.min(articles.length, maxTweets); i++) {
      const article = articles[i];
      
      try {
        // Get tweet text
        const textElement = article.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.innerText : '';
        
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
        const username = userElement ? userElement.innerText.split('\n')[0] : '';
        
        // Get timestamp
        const timeElement = article.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
        
        // Check for media
        const mediaElements = article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]');
        const hasMedia = mediaElements.length > 0;
        
        // Only include tweets with text or media
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
        console.log(`Error processing tweet ${i}:`, error.message);
        continue;
      }
    }
    
    // Helper function to extract numbers from aria-labels
    function extractNumber(ariaLabel) {
      if (!ariaLabel) return 0;
      const match = ariaLabel.match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    }
    
    return tweetData;
  }, maxTweets);
  
  return tweets;
}

(async () => {
  let browser;
  
  try {
    console.log('🚀 Launching browser...');
    
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
        '--no-zygote'
      ],
      defaultViewport: { width: 1200, height: 800 }
    });

    const page = await browser.newPage();
    
    // Set realistic headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('🌐 Navigating to:', profileURL);
    await page.goto(profileURL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    // Wait for initial content
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('⏳ Waiting for tweets to load...');
    
    // Try multiple selectors to find tweets
    const selectors = ['article', '[data-testid="tweet"]', '[role="article"]'];
    let tweetsFound = false;
    
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        console.log(`✅ Found tweets using selector: ${selector}`);
        tweetsFound = true;
        break;
      } catch (e) {
        console.log(`⚠️ Selector ${selector} not found, trying next...`);
      }
    }
    
    if (!tweetsFound) {
      throw new Error('Could not find any tweets on the page');
    }

    // Scroll to load more tweets
    console.log('📜 Scrolling to load more tweets...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const tweetCount = await page.evaluate(() => document.querySelectorAll('article').length);
      console.log(`Scroll ${i + 1}: Found ${tweetCount} tweets`);
    }

    // Extract tweets
    const tweets = await extractTweets(page, MAX_TWEETS);
    
    if (tweets.length === 0) {
      console.log('⚠️ No tweets extracted. Page structure may have changed.');
      console.log('📄 JSON Output:');
      console.log('[]');
    } else {
      console.log(`🎉 Successfully extracted ${tweets.length} tweets`);
      
      // Log summary
      tweets.forEach((tweet, index) => {
        console.log(`\n📝 Tweet ${index + 1}:`);
        console.log(`👤 @${tweet.username}`);
        console.log(`💬 ${tweet.text.substring(0, 100)}${tweet.text.length > 100 ? '...' : ''}`);
        console.log(`📊 ${tweet.likes} likes, ${tweet.retweets} retweets, ${tweet.replies} replies`);
      });
      
      console.log('\n📄 JSON Output:');
      console.log(JSON.stringify(tweets, null, 2));
    }

  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
    console.log('📄 JSON Output:');
    console.log('[]');
  } finally {
    if (browser) {
      await browser.close();
      console.log('🛑 Browser closed');
    }
  }
})();