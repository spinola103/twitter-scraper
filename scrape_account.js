const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const profileURL = process.argv[2] || "https://twitter.com/phantom";
const MAX_TWEETS = 5;
const SCROLL_DELAY = 2000;

async function autoScroll(page, maxScrolls = 10) {
  console.log('🌀 Starting autoScroll...');
  
  let scrollCount = 0;
  let previousHeight = 0;
  
  while (scrollCount < maxScrolls) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    
    if (currentHeight === previousHeight) {
      console.log('🔄 No new content loaded, stopping scroll');
      break;
    }
    
    previousHeight = currentHeight;
    scrollCount++;
    console.log(`📜 Scroll ${scrollCount}/${maxScrolls}`);
  }
  
  console.log('🌀 autoScroll finished.');
}

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
        
        // Get like count
        const likeElement = article.querySelector('[data-testid="like"]');
        const likesText = likeElement ? likeElement.getAttribute('aria-label').match(/\d+/g) : null;
        const likes = likesText ? parseInt(likesText[0], 10) : 0;
        
        // Get retweet count
        const retweetElement = article.querySelector('[data-testid="retweet"]');
        const retweetsText = retweetElement ? retweetElement.getAttribute('aria-label').match(/\d+/g) : null;
        const retweets = retweetsText ? parseInt(retweetsText[0], 10) : 0;
        
        // Get reply count
        const replyElement = article.querySelector('[data-testid="reply"]');
        const repliesText = replyElement ? replyElement.getAttribute('aria-label').match(/\d+/g) : null;
        const replies = repliesText ? parseInt(repliesText[0], 10) : 0;
        
        // Check for verified badge
        const verified = !!article.querySelector('[data-testid="icon-verified"]');
        
        // Get username
        const userElement = article.querySelector('[data-testid="User-Name"]');
        const username = userElement ? userElement.innerText.split('\n')[0] : '';
        
        // Extract timestamp
        const timeElement = article.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
        
        // Extract media info if present
        const mediaElements = article.querySelectorAll('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]');
        const hasMedia = mediaElements.length > 0;
        const mediaCount = mediaElements.length;
        
        console.log(`Processing article ${i + 1}: text="${text.substring(0, 50)}..." link="${link}"`);
        
        if (text || link) {
          tweetData.push({
            index: i + 1,
            username: username,
            text: text,
            link: link,
            timestamp: timestamp,
            replies: replies,
            retweets: retweets,
            likes: likes,
            verified: verified,
            hasMedia: hasMedia,
            mediaCount: mediaCount,
            extractedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.log('Error extracting tweet:', error);
        continue;
      }
    }
    
    return tweetData;
  }, maxTweets);
  
  return tweets;
}

async function saveTweets(tweets, filename = 'tweets.json') {
  try {
    const filePath = path.join(__dirname, filename);
    fs.writeFileSync(filePath, JSON.stringify(tweets, null, 2));
    console.log(`💾 Saved ${tweets.length} tweets to ${filename}`);
  } catch (error) {
    console.error('❌ Error saving tweets:', error.message);
  }
}

(async () => {
  console.log('🚀 Launching browser...');
  
  // Railway-optimized browser config
  const browser = await puppeteer.launch({
    headless: 'new', // Use new headless mode for Railway
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--window-size=1200,800',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // Important for Railway
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'
    ],
    defaultViewport: {
      width: 1200,
      height: 800
    }
  });

  const page = await browser.newPage();
  
  // Set additional headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  // Load cookies if available (but don't fail if not found)
  const cookiePath = path.join(__dirname, 'cookie.json');
  try {
    if (fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
      await page.setCookie(...cookies);
      console.log('✅ Loaded cookies');
    } else {
      console.log('ℹ️ No cookies found - proceeding without authentication');
    }
  } catch (err) {
    console.error('❌ Cookie load error:', err.message);
  }

  try {
    console.log('🌐 Navigating to:', profileURL);
    await page.goto(profileURL, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    console.log('⏳ Waiting for page to fully render...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('⏳ Waiting for tweets to load...');
    
    let tweetsFound = false;
    const selectors = [
      'article', 
      '[data-testid="tweet"]',
      '[role="article"]',
      'div[data-testid="primaryColumn"] div',
      'main div'
    ];
    
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        console.log(`✅ Found tweets using selector: ${selector}`);
        tweetsFound = true;
        break;
      } catch (e) {
        console.log(`⚠️ Selector ${selector} failed, trying next...`);
      }
    }
    
    if (!tweetsFound) {
      console.log('❌ No tweet selectors worked.');
      throw new Error('Could not find tweets with any selector');
    }

    // Scroll to load more tweets
    let scrollAttempts = 0;
    let tweetCount = 0;
    
    while (scrollAttempts < 5) {
      let currentCount = 0;
      try {
        currentCount = await page.evaluate(() => document.querySelectorAll('article').length);
      } catch (e) {
        console.log('⚠️ Could not count tweets, continuing...');
        currentCount = 0;
      }
      
      console.log(`🔍 Found ${currentCount} articles on page`);
      
      if (currentCount === tweetCount && tweetCount > 0) {
        console.log('🔄 No new tweets loaded, stopping scroll');
        break;
      }
      
      tweetCount = currentCount;
      console.log(`📜 Loaded ${currentCount} tweets (scroll ${scrollAttempts + 1}/5)`);
      
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      
      await new Promise(resolve => setTimeout(resolve, SCROLL_DELAY));
      scrollAttempts++;
    }

    console.log(`✅ Final count: ${tweetCount} tweets loaded`);

    const tweets = await extractTweets(page, MAX_TWEETS);
    
    if (tweets.length === 0) {
      console.log('⚠️ No tweets found. The page structure might have changed.');
    } else {
      console.log(`🎉 Successfully extracted ${tweets.length} tweets`);
      
      tweets.forEach((tweet, index) => {
        console.log(`\n📝 Tweet ${index + 1}:`);
        console.log(`👤 @${tweet.username}`);
        console.log(`🔗 ${tweet.link}`);
        if (tweet.timestamp) console.log(`📅 ${new Date(tweet.timestamp).toLocaleDateString()}`);
        console.log(`💬 ${tweet.text.substring(0, 150)}${tweet.text.length > 150 ? '...' : ''}`);
        console.log(`📊 ${tweet.likes} likes, ${tweet.retweets} retweets, ${tweet.replies} replies`);
        if (tweet.verified) console.log(`✅ Verified account`);
        if (tweet.hasMedia) console.log(`📸 ${tweet.mediaCount} media items`);
      });
      
      await saveTweets(tweets);
      
      console.log('\n📄 JSON Output:');
      console.log(JSON.stringify(tweets, null, 2));
    }

  } catch (error) {
    console.error('❌ Scraping failed:', error.message);
  } finally {
    await browser.close();
    console.log('🛑 Browser closed, script ended.');
  }
})();