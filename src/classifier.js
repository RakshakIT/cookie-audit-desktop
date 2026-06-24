const rules = [
  {
    category: 'Necessary',
    confidence: 'high',
    reason: 'Security, session, consent or load-balancing cookie required for website operation',
    patterns: [
      /requestverificationtoken/i,
      /__requestverificationtoken/i,
      /xsrf/i,
      /csrf/i,
      /nonce/i,
      /session/i,
      /sess/i,
      /auth/i,
      /token/i,
      /wordpress_logged_in/i,
      /woocommerce_cart/i,
      /woocommerce_items/i,
      /cart/i,
      /checkout/i,
      /applicationgatewayaffinity/i,
      /affinity/i,
      /laravel_session/i,
      /phpsessid/i,
      /asp\.net/i,
      /cookieyes-consent/i,
      /cookieconsent/i,
      /cookiebot/i,
      /onetrust/i,
      /optanon/i,
      /cmplz/i,
      /gdpr/i,
      /consent/i
    ]
  },

  {
    category: 'Security',
    confidence: 'high',
    reason: 'Security or bot-protection cookie',
    patterns: [
      /captcha/i,
      /recaptcha/i,
      /cf_clearance/i,
      /__cf_bm/i,
      /ak_bmsc/i,
      /bm_sv/i,
      /bm_sz/i
    ]
  },

  {
    category: 'Analytics',
    confidence: 'high',
    reason: 'Analytics cookie used to measure website usage',
    patterns: [
      /^_ga$/i,
      /^_ga_/i,
      /^_gid$/i,
      /^_gat/i,
      /google-analytics/i,
      /gtag/i,
      /analytics/i,
      /matomo/i,
      /plausible/i,
      /clarity/i,
      /^_clck$/i,
      /^_clsk$/i,
      /hotjar/i,
      /^_hj/i
    ]
  },

  {
    category: 'Advertising',
    confidence: 'high',
    reason: 'Advertising, tracking or embedded media cookie',
    patterns: [
      /^_fbp$/i,
      /^fr$/i,
      /^ide$/i,
      /^test_cookie$/i,
      /^nid$/i,
      /^anid$/i,
      /^1p_jar$/i,
      /^_gcl_au$/i,
      /doubleclick/i,
      /googleads/i,
      /ads?/i,
      /gcl/i,
      /utm/i,
      /facebook/i,
      /youtube/i,
      /^ysc$/i,
      /^visitor_info1_live$/i,
      /^visitor_privacy_metadata$/i,
      /^__secure-ynid$/i,
      /^__secure-rollout_token$/i
    ]
  },

  {
    category: 'Functional',
    confidence: 'high',
    reason: 'Cookie used for live chat, preferences or embedded service functionality',
    patterns: [
      /moneypenny/i,
      /chat/i,
      /wp-settings/i,
      /language/i,
      /\blang\b/i,
      /currency/i,
      /preferences?/i,
      /recently_viewed/i,
      /trustpilot/i,
      /yoshki/i,
      /sra/i
    ]
  }
];

function classifyCookie(cookie) {
  const haystack = [
    cookie.name || '',
    cookie.domain || '',
    cookie.path || ''
  ].join(' ');

  for (const rule of rules) {
    if (rule.patterns.some(pattern => pattern.test(haystack))) {
      return {
        category: rule.category,
        confidence: rule.confidence,
        reason: rule.reason
      };
    }
  }

  return {
    category: 'Unknown',
    confidence: 'low',
    reason: 'No matching classification rule found; manual review required'
  };
}

module.exports = { classifyCookie };
