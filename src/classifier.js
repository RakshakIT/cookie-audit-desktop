const rules = [
  { category: 'Analytics', confidence: 'high', patterns: [/^_ga/i, /^_gid/i, /^_gat/i, /analytics/i, /google-analytics/i, /gtag/i, /matomo/i, /plausible/i] },
  { category: 'Advertising', confidence: 'high', patterns: [/_fbp/i, /fr/i, /IDE/i, /NID/i, /ANID/i, /ads?/i, /doubleclick/i, /gcl/i, /utm/i] },
  { category: 'Functional', confidence: 'medium', patterns: [/wp-settings/i, /language/i, /lang/i, /currency/i, /preferences?/i, /recently_viewed/i] },
  { category: 'Security', confidence: 'high', patterns: [/csrf/i, /xsrf/i, /nonce/i, /captcha/i, /cf_clearance/i, /__cf_bm/i] },
  { category: 'Necessary', confidence: 'high', patterns: [/session/i, /sess/i, /auth/i, /token/i, /wordpress_logged_in/i, /woocommerce_cart/i, /woocommerce_items/i, /cart/i, /checkout/i] },
  { category: 'Consent', confidence: 'high', patterns: [/consent/i, /cookieyes/i, /cookiebot/i, /onetrust/i, /Optanon/i, /cmplz/i, /gdpr/i] }
];

function classifyCookie(cookie) {
  const haystack = `${cookie.name || ''} ${cookie.domain || ''} ${cookie.path || ''}`;
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return { category: rule.category, confidence: rule.confidence, reason: `Matched ${rule.category.toLowerCase()} rule` };
    }
  }
  return { category: 'Unknown', confidence: 'low', reason: 'No rule matched; needs manual review' };
}

module.exports = { classifyCookie };
